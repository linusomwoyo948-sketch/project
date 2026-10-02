'use strict';

const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('landlord', 'tenant')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'KES',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  monthly_rent INTEGER NOT NULL CHECK (monthly_rent > 0),
  UNIQUE (property_id, label)
);

-- A lease links a tenant to a unit. Invites are leases whose tenant has not
-- signed up yet: they are matched by email when that tenant registers.
CREATE TABLE IF NOT EXISTS leases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id       INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tenant_email  TEXT NOT NULL COLLATE NOCASE,
  monthly_rent  INTEGER NOT NULL CHECK (monthly_rent > 0),
  due_day       INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  start_date    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id   INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,            -- YYYY-MM
  amount     INTEGER NOT NULL,
  due_date   TEXT NOT NULL,            -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lease_id, period)
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0),
  method       TEXT NOT NULL CHECK (method IN ('mpesa', 'card', 'bank', 'cash')),
  reference    TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
`;

function openDb(file = process.env.DB_FILE || 'rent.db') {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
