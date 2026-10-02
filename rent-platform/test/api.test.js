'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

let server;
let base;

test.before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(() => server.close());

// Minimal cookie-keeping client.
function client() {
  let cookie = '';
  return async (path, body, method) => {
    const res = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const month = new Date().toISOString().slice(0, 7);

test('landlord and tenant full rent flow', async () => {
  const landlord = client();
  const tenant = client();

  let r = await landlord('/register', { name: 'Grace L', email: 'grace@example.com', password: 'password123', role: 'landlord' });
  assert.equal(r.status, 201);

  r = await landlord('/properties', { name: 'Sunrise Apartments', address: 'Ngong Rd', currency: 'KES' });
  assert.equal(r.status, 201);
  const propertyId = r.body.id;
  r = await landlord(`/properties/${propertyId}/units`, { label: 'A1', monthly_rent: 15000 });
  const unitId = r.body.id;

  // Invite before the tenant has an account; started two months ago.
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 2);
  r = await landlord(`/units/${unitId}/leases`, { tenant_email: 'Tom@Example.com', due_day: 5, start_date: start.toISOString().slice(0, 10) });
  assert.equal(r.status, 201);
  assert.equal(r.body.tenant_registered, false);

  // A second active lease on the same unit is refused.
  r = await landlord(`/units/${unitId}/leases`, { tenant_email: 'other@example.com' });
  assert.equal(r.status, 409);

  r = await tenant('/register', { name: 'Tom T', email: 'tom@example.com', phone: '0712345678', password: 'password123', role: 'tenant' });
  assert.equal(r.status, 201);

  r = await tenant('/tenant/leases');
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].landlord_name, 'Grace L');

  r = await tenant('/tenant/invoices');
  assert.equal(r.body.length, 3, 'one bill per month since the start');
  const current = r.body.find((i) => i.period === month);
  const old = r.body.find((i) => i.period !== month);
  assert.equal(old.status, 'overdue');

  // Partial M-Pesa payment, then overpayment is refused.
  r = await tenant(`/invoices/${current.id}/pay`, { amount: 5000, method: 'mpesa', phone: '0712345678' });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'completed');
  assert.match(r.body.reference, /^MP/);
  r = await tenant(`/invoices/${current.id}/pay`, { amount: 10001, method: 'card' });
  assert.equal(r.status, 400);

  // Bank transfer stays pending until the landlord confirms it.
  r = await tenant(`/invoices/${current.id}/pay`, { amount: 10000, method: 'bank', reference: 'BNK123' });
  assert.equal(r.body.status, 'pending');
  const bankPaymentId = r.body.id;
  r = await tenant(`/invoices/${current.id}/pay`, { amount: 1, method: 'card' });
  assert.equal(r.status, 409, 'nothing left once pending covers the balance');

  r = await landlord('/landlord/summary');
  assert.equal(r.body.pending_payments, 1);
  assert.equal(r.body.totals[0].collected_this_month, 5000);
  assert.equal(r.body.occupied, 1);

  // Tenants cannot confirm their own payments.
  r = await tenant(`/payments/${bankPaymentId}/confirm`, {});
  assert.equal(r.status, 403);
  r = await landlord(`/payments/${bankPaymentId}/confirm`, {});
  assert.equal(r.body.status, 'completed');

  r = await tenant('/tenant/invoices');
  assert.equal(r.body.find((i) => i.id === current.id).status, 'paid');

  // Both sides can see the receipt.
  r = await tenant(`/payments/${bankPaymentId}`);
  assert.equal(r.body.reference, 'BNK123');
  r = await landlord(`/payments/${bankPaymentId}`);
  assert.equal(r.body.tenant_name, 'Tom T');
});

test('users cannot see or touch other accounts\' data', async () => {
  const a = client();
  const b = client();
  const outsider = client();
  await a('/register', { name: 'A', email: 'a@example.com', password: 'password123', role: 'landlord' });
  await b('/register', { name: 'B', email: 'b@example.com', password: 'password123', role: 'landlord' });
  await outsider('/register', { name: 'O', email: 'o@example.com', password: 'password123', role: 'tenant' });

  const { body: prop } = await a('/properties', { name: 'P', address: 'X' });
  const { body: unit } = await a(`/properties/${prop.id}/units`, { label: 'U', monthly_rent: 100 });
  await a(`/units/${unit.id}/leases`, { tenant_email: 't2@example.com' });

  let r = await b(`/properties/${prop.id}/units`, { label: 'Hack', monthly_rent: 1 });
  assert.equal(r.status, 404);
  r = await b('/properties');
  assert.deepEqual(r.body, []);
  r = await b('/landlord/invoices');
  assert.deepEqual(r.body, []);

  r = await outsider('/tenant/invoices');
  assert.deepEqual(r.body, []);
  const { body: invoices } = await a('/landlord/invoices');
  r = await outsider(`/invoices/${invoices[0].id}/pay`, { amount: 100, method: 'card' });
  assert.equal(r.status, 404);
});

test('auth validation', async () => {
  const c = client();
  let r = await c('/register', { name: 'X', email: 'bad', password: 'password123', role: 'tenant' });
  assert.equal(r.status, 400);
  r = await c('/register', { name: 'X', email: 'x@example.com', password: 'short', role: 'tenant' });
  assert.equal(r.status, 400);
  r = await c('/login', { email: 'nobody@example.com', password: 'whatever1' });
  assert.equal(r.status, 401);
  r = await c('/properties');
  assert.equal(r.status, 401);
  r = await c('/register', { name: 'X', email: 'x@example.com', password: 'password123', role: 'tenant' });
  assert.equal(r.status, 201);
  r = await c('/properties');
  assert.equal(r.status, 403);
  r = await c('/logout', {});
  r = await c('/me');
  assert.equal(r.body, null);
});
