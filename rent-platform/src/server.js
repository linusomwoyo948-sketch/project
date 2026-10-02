'use strict';

const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const auth = require('./auth');
const { generateInvoices, INVOICE_SELECT, withStatus, processPayment } = require('./billing');

const CURRENCIES = ['KES', 'UGX', 'TZS', 'NGN', 'ZAR', 'USD', 'EUR', 'GBP'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const str = (v, field, max = 200) => {
  if (typeof v !== 'string' || !v.trim()) fail(400, `${field} is required.`);
  if (v.length > max) fail(400, `${field} is too long.`);
  return v.trim();
};
const posInt = (v, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, `${field} must be a whole number greater than 0.`);
  return n;
};

function createApp(db = openDb()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use(auth.sessionMiddleware(db));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const landlord = auth.requireRole('landlord');
  const tenant = auth.requireRole('tenant');
  const anyUser = auth.requireRole(null);

  // Wrap handlers so thrown HttpErrors become JSON responses.
  const h = (fn) => (req, res, next) => {
    try { fn(req, res); } catch (err) { next(err); }
  };

  // Ownership helpers -------------------------------------------------------
  const ownProperty = (req, id) =>
    db.prepare('SELECT * FROM properties WHERE id = ? AND landlord_id = ?').get(Number(id), req.user.id)
      || fail(404, 'Property not found.');
  const ownUnit = (req, id) =>
    db.prepare(`SELECT un.*, p.landlord_id FROM units un JOIN properties p ON p.id = un.property_id
                WHERE un.id = ? AND p.landlord_id = ?`).get(Number(id), req.user.id)
      || fail(404, 'Unit not found.');
  const ownLease = (req, id) =>
    db.prepare(`SELECT l.* FROM leases l JOIN units un ON un.id = l.unit_id JOIN properties p ON p.id = un.property_id
                WHERE l.id = ? AND p.landlord_id = ?`).get(Number(id), req.user.id)
      || fail(404, 'Lease not found.');
  const landlordPayment = (req, id) =>
    db.prepare(`SELECT pay.* FROM payments pay
                JOIN invoices i ON i.id = pay.invoice_id JOIN leases l ON l.id = i.lease_id
                JOIN units un ON un.id = l.unit_id JOIN properties p ON p.id = un.property_id
                WHERE pay.id = ? AND p.landlord_id = ?`).get(Number(id), req.user.id)
      || fail(404, 'Payment not found.');

  // Auth ----------------------------------------------------------------------
  app.post('/api/register', h((req, res) => {
    const { role, password } = req.body;
    const name = str(req.body.name, 'Name', 100);
    const email = str(req.body.email, 'Email', 200).toLowerCase();
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : null;
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
    if (!['landlord', 'tenant'].includes(role)) fail(400, 'Choose landlord or tenant.');
    if (typeof password !== 'string' || password.length < 8) fail(400, 'Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'An account with that email already exists.');

    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(name, email, phone, role, auth.hashPassword(password));
    const userId = Number(lastInsertRowid);
    if (role === 'tenant') {
      // Claim any leases a landlord already created for this email.
      db.prepare('UPDATE leases SET tenant_id = ? WHERE tenant_email = ? AND tenant_id IS NULL').run(userId, email);
    }
    auth.createSession(db, res, userId);
    res.status(201).json({ id: userId, name, email, phone, role });
  }));

  app.post('/api/login', h((req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
      fail(401, 'Wrong email or password.');
    }
    auth.createSession(db, res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role });
  }));

  app.post('/api/logout', (req, res) => {
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json(req.user));
  app.get('/api/currencies', (req, res) => res.json(CURRENCIES));

  // Landlord: properties, units, leases ----------------------------------------
  app.get('/api/properties', landlord, h((req, res) => {
    const properties = db.prepare('SELECT * FROM properties WHERE landlord_id = ? ORDER BY name').all(req.user.id);
    const units = db.prepare('SELECT * FROM units WHERE property_id = ? ORDER BY label');
    const lease = db.prepare(`
      SELECT l.*, t.name AS tenant_name, t.phone AS tenant_phone FROM leases l
      LEFT JOIN users t ON t.id = l.tenant_id
      WHERE l.unit_id = ? AND l.status = 'active'`);
    res.json(properties.map((p) => ({
      ...p,
      units: units.all(p.id).map((u) => ({ ...u, lease: lease.get(u.id) || null })),
    })));
  }));

  app.post('/api/properties', landlord, h((req, res) => {
    const name = str(req.body.name, 'Property name', 100);
    const address = str(req.body.address, 'Address', 200);
    const currency = req.body.currency || 'KES';
    if (!CURRENCIES.includes(currency)) fail(400, 'Unsupported currency.');
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO properties (landlord_id, name, address, currency) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, name, address, currency);
    res.status(201).json({ id: Number(lastInsertRowid) });
  }));

  app.delete('/api/properties/:id', landlord, h((req, res) => {
    const property = ownProperty(req, req.params.id);
    db.prepare('DELETE FROM properties WHERE id = ?').run(property.id);
    res.json({ ok: true });
  }));

  app.post('/api/properties/:id/units', landlord, h((req, res) => {
    const property = ownProperty(req, req.params.id);
    const label = str(req.body.label, 'Unit name', 50);
    const rent = posInt(req.body.monthly_rent, 'Monthly rent');
    if (db.prepare('SELECT 1 FROM units WHERE property_id = ? AND label = ?').get(property.id, label)) {
      fail(409, 'A unit with that name already exists in this property.');
    }
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO units (property_id, label, monthly_rent) VALUES (?, ?, ?)'
    ).run(property.id, label, rent);
    res.status(201).json({ id: Number(lastInsertRowid) });
  }));

  app.post('/api/units/:id/leases', landlord, h((req, res) => {
    const unit = ownUnit(req, req.params.id);
    if (db.prepare("SELECT 1 FROM leases WHERE unit_id = ? AND status = 'active'").get(unit.id)) {
      fail(409, 'This unit already has an active tenant.');
    }
    const email = str(req.body.tenant_email, 'Tenant email').toLowerCase();
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid tenant email.');
    const rent = req.body.monthly_rent ? posInt(req.body.monthly_rent, 'Monthly rent') : unit.monthly_rent;
    const dueDay = posInt(req.body.due_day || 5, 'Due day');
    if (dueDay > 28) fail(400, 'Due day must be between 1 and 28.');
    const start = req.body.start_date || new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(start) || Number.isNaN(Date.parse(start))) fail(400, 'Start date must be YYYY-MM-DD.');

    const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
    if (existing && existing.role !== 'tenant') fail(400, 'That email belongs to a landlord account.');

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO leases (unit_id, tenant_id, tenant_email, monthly_rent, due_day, start_date)
      VALUES (?, ?, ?, ?, ?, ?)`).run(unit.id, existing ? existing.id : null, email, rent, dueDay, start);
    generateInvoices(db);
    res.status(201).json({ id: Number(lastInsertRowid), tenant_registered: Boolean(existing) });
  }));

  app.post('/api/leases/:id/end', landlord, h((req, res) => {
    const lease = ownLease(req, req.params.id);
    db.prepare("UPDATE leases SET status = 'ended' WHERE id = ?").run(lease.id);
    res.json({ ok: true });
  }));

  // Landlord: money ---------------------------------------------------------
  app.get('/api/landlord/invoices', landlord, h((req, res) => {
    generateInvoices(db);
    const rows = db.prepare(`${INVOICE_SELECT} WHERE p.landlord_id = ? ORDER BY i.period DESC, p.name, un.label`)
      .all(req.user.id).map((r) => withStatus(r));
    res.json(rows);
  }));

  app.get('/api/landlord/summary', landlord, h((req, res) => {
    generateInvoices(db);
    const month = new Date().toISOString().slice(0, 7);
    const invoices = db.prepare(`${INVOICE_SELECT} WHERE p.landlord_id = ?`).all(req.user.id).map((r) => withStatus(r));
    // Totals are grouped per currency since a landlord may use several.
    const byCurrency = {};
    for (const inv of invoices) {
      const c = (byCurrency[inv.currency] ||= { currency: inv.currency, expected_this_month: 0, collected_this_month: 0, outstanding: 0 });
      if (inv.period === month) {
        c.expected_this_month += inv.amount;
        c.collected_this_month += inv.paid;
      }
      c.outstanding += inv.balance;
    }
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM properties WHERE landlord_id = $id) AS properties,
        (SELECT COUNT(*) FROM units un JOIN properties p ON p.id = un.property_id WHERE p.landlord_id = $id) AS units,
        (SELECT COUNT(*) FROM leases l JOIN units un ON un.id = l.unit_id JOIN properties p ON p.id = un.property_id
           WHERE p.landlord_id = $id AND l.status = 'active') AS occupied,
        (SELECT COUNT(*) FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN leases l ON l.id = i.lease_id
           JOIN units un ON un.id = l.unit_id JOIN properties p ON p.id = un.property_id
           WHERE p.landlord_id = $id AND pay.status = 'pending') AS pending_payments`).get({ $id: req.user.id });
    res.json({
      ...counts,
      overdue_invoices: invoices.filter((i) => i.status === 'overdue').length,
      totals: Object.values(byCurrency),
    });
  }));

  const PAYMENT_SELECT = `
    SELECT pay.*, i.period, i.lease_id, p.name AS property_name, p.currency, un.label AS unit_label,
           t.name AS tenant_name, t.email AS tenant_email, ll.name AS landlord_name
    FROM payments pay
    JOIN invoices i ON i.id = pay.invoice_id
    JOIN leases l ON l.id = i.lease_id
    JOIN units un ON un.id = l.unit_id
    JOIN properties p ON p.id = un.property_id
    JOIN users ll ON ll.id = p.landlord_id
    LEFT JOIN users t ON t.id = pay.tenant_id`;

  app.get('/api/landlord/payments', landlord, h((req, res) => {
    res.json(db.prepare(`${PAYMENT_SELECT} WHERE p.landlord_id = ? ORDER BY pay.created_at DESC, pay.id DESC`).all(req.user.id));
  }));

  for (const [action, status] of [['confirm', 'completed'], ['reject', 'rejected']]) {
    app.post(`/api/payments/:id/${action}`, landlord, h((req, res) => {
      const payment = landlordPayment(req, req.params.id);
      if (payment.status !== 'pending') fail(409, 'Only pending payments can be changed.');
      db.prepare("UPDATE payments SET status = ?, confirmed_at = datetime('now') WHERE id = ?").run(status, payment.id);
      res.json({ ok: true, status });
    }));
  }

  // Tenant ----------------------------------------------------------------------
  app.get('/api/tenant/leases', tenant, h((req, res) => {
    res.json(db.prepare(`
      SELECT l.*, un.label AS unit_label, p.name AS property_name, p.address, p.currency,
             ll.name AS landlord_name, ll.email AS landlord_email, ll.phone AS landlord_phone
      FROM leases l JOIN units un ON un.id = l.unit_id JOIN properties p ON p.id = un.property_id
      JOIN users ll ON ll.id = p.landlord_id
      WHERE l.tenant_id = ? ORDER BY l.status, l.start_date DESC`).all(req.user.id));
  }));

  app.get('/api/tenant/invoices', tenant, h((req, res) => {
    generateInvoices(db);
    res.json(db.prepare(`${INVOICE_SELECT} WHERE l.tenant_id = ? ORDER BY i.period DESC`)
      .all(req.user.id).map((r) => withStatus(r)));
  }));

  app.get('/api/tenant/payments', tenant, h((req, res) => {
    res.json(db.prepare(`${PAYMENT_SELECT} WHERE l.tenant_id = ? ORDER BY pay.created_at DESC, pay.id DESC`).all(req.user.id));
  }));

  app.post('/api/invoices/:id/pay', tenant, h((req, res) => {
    const row = db.prepare(`${INVOICE_SELECT} WHERE i.id = ? AND l.tenant_id = ?`).get(Number(req.params.id), req.user.id)
      || fail(404, 'Invoice not found.');
    const invoice = withStatus(row);
    const amount = posInt(req.body.amount, 'Amount');
    const method = req.body.method;
    if (!['mpesa', 'card', 'bank', 'cash'].includes(method)) fail(400, 'Choose a payment method.');
    const payable = invoice.amount - invoice.paid - invoice.pending;
    if (payable <= 0) fail(409, 'Nothing left to pay on this invoice.');
    if (amount > payable) fail(400, `You can pay at most ${payable} ${invoice.currency} on this invoice.`);

    let reference = '';
    if (method === 'mpesa') {
      const phone = str(req.body.phone, 'M-Pesa phone number', 20);
      if (!/^\+?\d{9,15}$/.test(phone.replace(/\s/g, ''))) fail(400, 'Enter a valid phone number.');
    } else if (method === 'bank' || method === 'cash') {
      reference = method === 'bank' ? str(req.body.reference, 'Bank transfer reference', 60)
        : (typeof req.body.reference === 'string' && req.body.reference.trim()) || 'Cash';
    }
    const result = processPayment({ method, reference });
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) || null : null;
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO payments (invoice_id, tenant_id, amount, method, reference, status, note, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'completed' THEN datetime('now') END)`)
      .run(invoice.id, req.user.id, amount, method, result.reference, result.status, note, result.status);
    res.status(201).json({ id: Number(lastInsertRowid), status: result.status, reference: result.reference });
  }));

  // Receipt: visible to the paying tenant and the property's landlord.
  app.get('/api/payments/:id', anyUser, h((req, res) => {
    const payment = db.prepare(`${PAYMENT_SELECT} WHERE pay.id = ? AND (l.tenant_id = ? OR p.landlord_id = ?)`)
      .get(Number(req.params.id), req.user.id, req.user.id) || fail(404, 'Payment not found.');
    res.json(payment);
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`RentLink running at http://localhost:${port}`));
}

module.exports = { createApp };
