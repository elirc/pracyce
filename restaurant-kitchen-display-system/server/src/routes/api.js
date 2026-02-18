const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const {
  createOrderSchema,
  updateItemStatusSchema,
  bumpPrioritySchema,
  eightySixSchema,
  listOrdersSchema,
  availabilitySchema,
  validateOrRespond
} = require('../lib/validation');
const {
  recordEvent,
  recomputeOrder,
  refreshLateFlags,
  getLateOrders,
  getMenuItems,
  getOrderById,
  getOrders,
  getStationBoard
} = require('../lib/kdsService');

const STATIONS = new Set(['grill', 'fryer', 'salad']);
const TRANSITIONS = {
  queued: ['started', 'cooking', 'ready'],
  started: ['cooking', 'ready'],
  cooking: ['ready'],
  ready: [],
  eighty_sixed: []
};

function createApiRouter(io) {
  const router = express.Router();

  function emit(type, payload) {
    io.emit('kds_event', {
      type,
      payload,
      timestamp: new Date().toISOString()
    });
  }

  router.get('/menu-items', (_req, res) => {
    return res.json({ items: getMenuItems() });
  });

  router.patch('/menu-items/:menuItemId/availability', (req, res) => {
    const payload = validateOrRespond(availabilitySchema, req.body, res);
    if (!payload) return;

    const item = db
      .prepare('SELECT id, name, station, is_available FROM menu_items WHERE id = ?')
      .get(req.params.menuItemId);

    if (!item) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    const now = new Date().toISOString();

    db.prepare('UPDATE menu_items SET is_available = ?, updated_at = ? WHERE id = ?').run(
      payload.isAvailable ? 1 : 0,
      now,
      item.id
    );

    recordEvent('menu_item.availability_changed', null, null, {
      menuItemId: item.id,
      isAvailable: payload.isAvailable,
      reason: payload.reason || null
    });

    const affectedOrderIds = [];

    if (!payload.isAvailable) {
      const affected = db
        .prepare(
          `SELECT id, order_id
           FROM order_items
           WHERE menu_item_id = ?
             AND status IN ('queued', 'started', 'cooking')`
        )
        .all(item.id);

      for (const orderItem of affected) {
        db.prepare(
          'UPDATE order_items SET status = ?, is_eighty_sixed = 1, notes = ?, updated_at = ? WHERE id = ?'
        ).run('eighty_sixed', payload.reason || '86d mid-service', now, orderItem.id);

        affectedOrderIds.push(orderItem.order_id);

        recordEvent('order_item.eighty_sixed', orderItem.order_id, orderItem.id, {
          reason: payload.reason || '86d mid-service',
          source: 'menu_item_availability'
        });
      }

      for (const orderId of new Set(affectedOrderIds)) {
        const order = recomputeOrder(orderId);
        if (order) {
          emit('order_updated', order);
        }
      }
    }

    const updatedMenuItem = db
      .prepare('SELECT id, name, station, is_available, updated_at FROM menu_items WHERE id = ?')
      .get(item.id);

    emit('menu_item_updated', updatedMenuItem);

    return res.json({
      item: updatedMenuItem,
      affectedOrders: Array.from(new Set(affectedOrderIds))
    });
  });

  router.post('/orders', (req, res) => {
    const data = validateOrRespond(createOrderSchema, req.body, res);
    if (!data) return;

    const uniqueMenuIds = Array.from(new Set(data.items.map((item) => item.menuItemId)));
    const placeholders = uniqueMenuIds.map(() => '?').join(',');

    const menuRows = db
      .prepare(`SELECT id, name, station, is_available FROM menu_items WHERE id IN (${placeholders})`)
      .all(...uniqueMenuIds);

    if (menuRows.length !== uniqueMenuIds.length) {
      return res.status(400).json({ message: 'One or more menu items do not exist' });
    }

    const menuMap = new Map(menuRows.map((row) => [row.id, row]));

    for (const line of data.items) {
      const menuItem = menuMap.get(line.menuItemId);
      if (!menuItem || menuItem.is_available !== 1) {
        return res.status(400).json({ message: `Menu item unavailable: ${menuItem?.name || line.menuItemId}` });
      }
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const targetMinutes = data.targetMinutes || 20;
    const dueAt = new Date(now.getTime() + targetMinutes * 60000).toISOString();

    const orderId = uuidv4();

    const insertOrder = db.prepare(
      `INSERT INTO orders (
         id, channel, ticket_name, status, priority, target_minutes, due_at,
         is_late, has_eighty_six, created_at, updated_at
       ) VALUES (?, ?, ?, 'queued', 'normal', ?, ?, 0, 0, ?, ?)`
    );

    const insertItem = db.prepare(
      `INSERT INTO order_items (
         id, order_id, menu_item_id, item_name, station, status, position, is_eighty_sixed,
         notes, started_at, ready_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, NULL, NULL, ?, ?)`
    );

    const tx = db.transaction(() => {
      insertOrder.run(orderId, data.channel, data.ticketName || null, targetMinutes, dueAt, createdAt, createdAt);

      data.items.forEach((line, index) => {
        const menu = menuMap.get(line.menuItemId);
        const itemId = uuidv4();

        insertItem.run(
          itemId,
          orderId,
          menu.id,
          menu.name,
          menu.station,
          index + 1,
          line.notes || null,
          createdAt,
          createdAt
        );

        recordEvent('order_item.routed', orderId, itemId, {
          station: menu.station,
          menuItemId: menu.id
        });
      });

      recordEvent('order.created', orderId, null, {
        channel: data.channel,
        targetMinutes
      });
    });

    tx();

    const order = recomputeOrder(orderId) || getOrderById(orderId);

    emit('order_created', order);

    return res.status(201).json({ order });
  });

  router.get('/orders', (req, res) => {
    const query = validateOrRespond(listOrdersSchema, req.query, res);
    if (!query) return;

    const orders = getOrders(query);
    return res.json({ items: orders });
  });

  router.get('/orders/:orderId', (req, res) => {
    const order = getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.json({ order });
  });

  router.patch('/orders/:orderId/priority', (req, res) => {
    const data = validateOrRespond(bumpPrioritySchema, req.body, res);
    if (!data) return;

    const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
    if (!existing) {
      return res.status(404).json({ message: 'Order not found' });
    }

    db.prepare('UPDATE orders SET priority = ?, updated_at = ? WHERE id = ?').run(
      data.priority,
      new Date().toISOString(),
      req.params.orderId
    );

    recordEvent('order.priority_bumped', req.params.orderId, null, { priority: data.priority });

    const updated = getOrderById(req.params.orderId);
    emit('order_updated', updated);

    return res.json({ order: updated });
  });

  router.patch('/order-items/:itemId/status', (req, res) => {
    const data = validateOrRespond(updateItemStatusSchema, req.body, res);
    if (!data) return;

    const existing = db
      .prepare(
        `SELECT id, order_id, station, status, is_eighty_sixed
         FROM order_items
         WHERE id = ?`
      )
      .get(req.params.itemId);

    if (!existing) {
      return res.status(404).json({ message: 'Order item not found' });
    }

    if (existing.is_eighty_sixed) {
      return res.status(400).json({ message: 'Item already 86d' });
    }

    const allowed = TRANSITIONS[existing.status] || [];
    if (!allowed.includes(data.status)) {
      return res.status(400).json({ message: `Invalid transition from ${existing.status} to ${data.status}` });
    }

    const now = new Date().toISOString();
    const startedAt = data.status === 'started' || data.status === 'cooking' ? now : null;
    const readyAt = data.status === 'ready' ? now : null;

    db.prepare(
      `UPDATE order_items
       SET status = ?,
           started_at = CASE WHEN started_at IS NULL AND ? IS NOT NULL THEN ? ELSE started_at END,
           ready_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(data.status, startedAt, startedAt, readyAt, now, existing.id);

    recordEvent('order_item.status_changed', existing.order_id, existing.id, {
      from: existing.status,
      to: data.status,
      station: existing.station
    });

    const order = recomputeOrder(existing.order_id);
    const item = db
      .prepare(
        `SELECT id, order_id, menu_item_id, item_name, station, status, position, is_eighty_sixed, notes,
                started_at, ready_at, created_at, updated_at
         FROM order_items
         WHERE id = ?`
      )
      .get(existing.id);

    emit('item_updated', item);
    if (order) {
      emit('order_updated', order);
    }

    return res.json({ item, order });
  });

  router.patch('/order-items/:itemId/eighty-six', (req, res) => {
    const data = validateOrRespond(eightySixSchema, req.body || {}, res);
    if (!data) return;

    const existing = db
      .prepare('SELECT id, order_id, status, is_eighty_sixed FROM order_items WHERE id = ?')
      .get(req.params.itemId);

    if (!existing) {
      return res.status(404).json({ message: 'Order item not found' });
    }

    if (existing.status === 'ready') {
      return res.status(400).json({ message: 'Ready item cannot be 86d' });
    }

    const now = new Date().toISOString();

    db.prepare('UPDATE order_items SET status = ?, is_eighty_sixed = 1, notes = ?, updated_at = ? WHERE id = ?').run(
      'eighty_sixed',
      data.reason || '86d by station',
      now,
      existing.id
    );

    recordEvent('order_item.eighty_sixed', existing.order_id, existing.id, {
      reason: data.reason || '86d by station',
      source: 'manual'
    });

    const order = recomputeOrder(existing.order_id);
    const item = db
      .prepare(
        `SELECT id, order_id, menu_item_id, item_name, station, status, position, is_eighty_sixed, notes,
                started_at, ready_at, created_at, updated_at
         FROM order_items
         WHERE id = ?`
      )
      .get(existing.id);

    emit('item_updated', item);
    if (order) emit('order_updated', order);

    return res.json({ item, order });
  });

  router.get('/stations/:station/board', (req, res) => {
    const station = req.params.station;
    if (!STATIONS.has(station)) {
      return res.status(400).json({ message: 'Invalid station' });
    }

    return res.json({ items: getStationBoard(station) });
  });

  router.get('/alerts/late', (_req, res) => {
    refreshLateFlags();
    return res.json({ items: getLateOrders() });
  });

  return router;
}

module.exports = {
  createApiRouter
};