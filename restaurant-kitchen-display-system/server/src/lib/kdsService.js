const db = require('../db/database');

const PRIORITY_SORT_SQL_WITH_ALIAS = `CASE o.priority WHEN 'rush' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`;
const PRIORITY_SORT_SQL_NO_ALIAS = `CASE priority WHEN 'rush' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`;

function recordEvent(eventType, orderId, orderItemId, payload) {
  db.prepare(
    'INSERT INTO kitchen_events (event_type, order_id, order_item_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(eventType, orderId || null, orderItemId || null, payload ? JSON.stringify(payload) : null, new Date().toISOString());
}

function recomputeOrder(orderId) {
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
         SUM(CASE WHEN status = 'eighty_sixed' THEN 1 ELSE 0 END) AS eighty_count,
         SUM(CASE WHEN status IN ('started', 'cooking') THEN 1 ELSE 0 END) AS active_count
       FROM order_items
       WHERE order_id = ?`
    )
    .get(orderId);

  if (!counts || counts.total === 0) {
    return null;
  }

  const terminalCount = (counts.ready_count || 0) + (counts.eighty_count || 0);
  const now = new Date().toISOString();

  let status = 'queued';
  if (terminalCount === counts.total) {
    status = 'ready';
  } else if ((counts.active_count || 0) > 0) {
    status = 'in_progress';
  }

  const order = db.prepare('SELECT status, started_at, ready_at, due_at FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;

  const startedAt = order.started_at || (status !== 'queued' ? now : null);
  const readyAt = status === 'ready' ? order.ready_at || now : null;
  const isLate = status === 'ready' ? 0 : order.due_at < now ? 1 : 0;

  db.prepare(
    'UPDATE orders SET status = ?, has_eighty_six = ?, started_at = ?, ready_at = ?, is_late = ?, updated_at = ? WHERE id = ?'
  ).run(status, (counts.eighty_count || 0) > 0 ? 1 : 0, startedAt, readyAt, isLate, now, orderId);

  return getOrderById(orderId);
}

function refreshLateFlags() {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE orders
     SET is_late = CASE WHEN status != 'ready' AND due_at < ? THEN 1 ELSE 0 END,
         updated_at = CASE WHEN status != 'ready' AND due_at < ? AND is_late = 0 THEN ? ELSE updated_at END`
  ).run(now, now, now);

  return getLateOrders();
}

function getLateOrders() {
  return db
    .prepare(
      `SELECT id, channel, ticket_name, priority, due_at, target_minutes, status
       FROM orders
       WHERE is_late = 1 AND status != 'ready'
       ORDER BY ${PRIORITY_SORT_SQL_NO_ALIAS}, due_at ASC`
    )
    .all();
}

function getMenuItems() {
  return db.prepare('SELECT id, name, station, is_available, updated_at FROM menu_items ORDER BY station, name').all();
}

function getOrderById(orderId) {
  const order = db
    .prepare(
      `SELECT id, channel, ticket_name, status, priority, target_minutes, due_at, is_late, has_eighty_six,
              created_at, started_at, ready_at, updated_at
       FROM orders
       WHERE id = ?`
    )
    .get(orderId);

  if (!order) return null;

  const items = db
    .prepare(
      `SELECT id, order_id, menu_item_id, item_name, station, status, position, is_eighty_sixed, notes,
              started_at, ready_at, created_at, updated_at
       FROM order_items
       WHERE order_id = ?
       ORDER BY position ASC`
    )
    .all(orderId);

  return {
    ...order,
    items
  };
}

function getOrders({ station, status, includeLateOnly }) {
  const where = [];
  const params = [];

  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }

  if (includeLateOnly) {
    where.push('o.is_late = 1');
  }

  if (station) {
    where.push(
      `EXISTS (
        SELECT 1
        FROM order_items oi2
        WHERE oi2.order_id = o.id AND oi2.station = ?
      )`
    );
    params.push(station);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const orders = db
    .prepare(
      `SELECT o.id, o.channel, o.ticket_name, o.status, o.priority, o.target_minutes, o.due_at, o.is_late,
              o.has_eighty_six, o.created_at, o.started_at, o.ready_at, o.updated_at
       FROM orders o
       ${whereClause}
       ORDER BY ${PRIORITY_SORT_SQL_WITH_ALIAS}, o.due_at ASC, o.created_at ASC`
    )
    .all(...params);

  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);
  const placeholders = orderIds.map(() => '?').join(',');

  const items = db
    .prepare(
      `SELECT id, order_id, menu_item_id, item_name, station, status, position, is_eighty_sixed, notes,
              started_at, ready_at, created_at, updated_at
       FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY order_id, position ASC`
    )
    .all(...orderIds);

  const byOrderId = new Map();
  for (const item of items) {
    if (!byOrderId.has(item.order_id)) {
      byOrderId.set(item.order_id, []);
    }
    byOrderId.get(item.order_id).push(item);
  }

  return orders.map((order) => ({
    ...order,
    items: byOrderId.get(order.id) || []
  }));
}

function getStationBoard(station) {
  return db
    .prepare(
      `SELECT
         oi.id,
         oi.order_id,
         oi.item_name,
         oi.menu_item_id,
         oi.status,
         oi.notes,
         oi.updated_at,
         o.channel,
         o.ticket_name,
         o.priority,
         o.due_at,
         o.is_late,
         o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.station = ?
         AND oi.status IN ('queued', 'started', 'cooking')
       ORDER BY ${PRIORITY_SORT_SQL_WITH_ALIAS}, o.due_at ASC, oi.created_at ASC`
    )
    .all(station);
}

module.exports = {
  recordEvent,
  recomputeOrder,
  refreshLateFlags,
  getLateOrders,
  getMenuItems,
  getOrderById,
  getOrders,
  getStationBoard
};
