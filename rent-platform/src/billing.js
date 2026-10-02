'use strict';

const crypto = require('node:crypto');

const pad = (n) => String(n).padStart(2, '0');
const periodOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

// Creates any missing monthly invoices for active leases, from the lease start
// month up to and including the current month. Safe to call repeatedly.
function generateInvoices(db, now = new Date()) {
  const leases = db.prepare("SELECT id, monthly_rent, due_day, start_date FROM leases WHERE status = 'active'").all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO invoices (lease_id, period, amount, due_date) VALUES (?, ?, ?, ?)`);
  const current = periodOf(now);
  for (const lease of leases) {
    const [y, m] = lease.start_date.split('-').map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, 1));
    while (periodOf(cursor) <= current) {
      const period = periodOf(cursor);
      insert.run(lease.id, period, lease.monthly_rent, `${period}-${pad(lease.due_day)}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
}

// Invoice rows with amounts paid/pending and a derived status.
const INVOICE_SELECT = `
  SELECT i.id, i.lease_id, i.period, i.amount, i.due_date,
         p.name AS property_name, p.currency, un.label AS unit_label,
         l.tenant_email, t.name AS tenant_name,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'completed'), 0) AS paid,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'pending'), 0) AS pending
  FROM invoices i
  JOIN leases l ON l.id = i.lease_id
  JOIN units un ON un.id = l.unit_id
  JOIN properties p ON p.id = un.property_id
  LEFT JOIN users t ON t.id = l.tenant_id`;

function withStatus(inv, today = new Date().toISOString().slice(0, 10)) {
  const balance = inv.amount - inv.paid;
  let status = 'unpaid';
  if (balance <= 0) status = 'paid';
  else if (inv.paid > 0) status = 'partial';
  if (status !== 'paid' && inv.due_date < today) status = 'overdue';
  return { ...inv, balance: Math.max(balance, 0), status };
}

// Stand-in for a real payment gateway (M-Pesa STK push, Stripe, ...).
// Online methods settle instantly; bank transfers and cash need the landlord
// to confirm them, so they start as pending.
function processPayment({ method, reference }) {
  if (method === 'mpesa' || method === 'card') {
    const prefix = method === 'mpesa' ? 'MP' : 'CD';
    return { status: 'completed', reference: `${prefix}${crypto.randomBytes(5).toString('hex').toUpperCase()}` };
  }
  return { status: 'pending', reference };
}

module.exports = { generateInvoices, INVOICE_SELECT, withStatus, processPayment };
