const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'kds.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    station TEXT NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    ticket_name TEXT,
    status TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    target_minutes INTEGER NOT NULL,
    due_at TEXT NOT NULL,
    is_late INTEGER NOT NULL DEFAULT 0,
    has_eighty_six INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    ready_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    station TEXT NOT NULL,
    status TEXT NOT NULL,
    position INTEGER NOT NULL,
    is_eighty_sixed INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    started_at TEXT,
    ready_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
  );

  CREATE TABLE IF NOT EXISTS kitchen_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    order_id TEXT,
    order_item_id TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_station_status ON order_items(station, status);
  CREATE INDEX IF NOT EXISTS idx_orders_status_priority_due ON orders(status, priority, due_at);
  CREATE INDEX IF NOT EXISTS idx_events_order_id ON kitchen_events(order_id);
`);

const seedMenuCount = db.prepare('SELECT COUNT(*) as count FROM menu_items').get().count;
if (seedMenuCount === 0) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO menu_items (id, name, station, is_available, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
  );

  const items = [
    ['burger', 'Burger', 'grill'],
    ['steak', 'Steak', 'grill'],
    ['fries', 'Fries', 'fryer'],
    ['onion-rings', 'Onion Rings', 'fryer'],
    ['caesar-salad', 'Caesar Salad', 'salad'],
    ['garden-salad', 'Garden Salad', 'salad']
  ];

  const tx = db.transaction((rows) => {
    for (const [id, name, station] of rows) {
      insert.run(id, name, station, now, now);
    }
  });

  tx(items);
}

module.exports = db;