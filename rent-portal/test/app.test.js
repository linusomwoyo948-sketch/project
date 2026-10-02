'use strict';

// End-to-end test of the landlord ↔ tenant flow through real HTTP requests.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Store } = require('../src/db');
const { createApp } = require('../src/app');

function startServer() {
  const store = new Store(null);
  const server = http.createServer(createApp({ store, today: () => new Date(2026, 9, 10) }));
  return new Promise((resolve) => server.listen(0, () => resolve({ store, server, base: `http://localhost:${server.address().port}` })));
}

// A minimal browser: keeps the session cookie and the latest CSRF token.
function client(base) {
  let cookie = '';
  let csrf = '';
  async function request(method, path, form) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams({ _csrf: csrf, ...form }).toString() : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }
  return {
    get: (path) => request('GET', path),
    post: (path, form) => request('POST', path, form),
    async follow(path, form) {
      const r = await request('POST', path, form);
      return r.location ? request('GET', r.location) : r;
    },
  };
}

test('landlord lists a unit, tenant joins and pays, both see the payment', async (t) => {
  const { store, server, base } = await startServer();
  t.after(() => server.close());

  const landlord = client(base);
  let r = await landlord.follow('/signup', { role: 'landlord', name: 'Grace Wanjiru', email: 'grace@example.com', phone: '0722000000', password: 'password123' });
  assert.match(r.text, /Landlord dashboard/);

  r = await landlord.follow('/properties', { name: 'Sunrise Apartments', address: 'Ngong Road' });
  assert.match(r.text, /Sunrise Apartments/);
  const propertyId = store.all('properties')[0].id;

  r = await landlord.follow(`/properties/${propertyId}/units`, { name: 'A1', rent: '15,000', dueDay: '5' });
  assert.match(r.text, /Unit A1 added/);
  const unit = store.all('units')[0];
  assert.equal(unit.rent, 1500000);

  const tenant = client(base);
  await tenant.follow('/signup', { role: 'tenant', name: 'Brian Otieno', email: 'brian@example.com', password: 'password123' });
  r = await tenant.follow('/join', { code: unit.joinCode.toLowerCase() });
  assert.match(r.text, /You are now linked to Sunrise Apartments/);
  assert.match(r.text, /Overdue/); // today is the 10th, rent was due on the 5th
  const lease = store.all('leases')[0];

  // Landlord pages are off-limits to tenants.
  assert.equal((await tenant.get(`/units/${unit.id}`)).status, 403);

  // A bad M-Pesa number is rejected without recording anything.
  r = await tenant.post(`/leases/${lease.id}/pay`, { amount: '15000', method: 'mpesa', phone: '123' });
  assert.equal(r.status, 400);
  assert.equal(store.all('payments').length, 0);

  r = await tenant.follow(`/leases/${lease.id}/pay`, { amount: '15000', method: 'mpesa', phone: '0712345678' });
  assert.match(r.text, /Payment receipt/);
  assert.equal(store.all('payments').length, 1);

  r = await tenant.get('/dashboard');
  assert.match(r.text, /Paid up/);

  r = await landlord.get('/dashboard');
  assert.match(r.text, /Brian Otieno/);
  assert.match(r.text, /Paid up/);

  r = await landlord.get('/payments');
  assert.match(r.text, /Brian Otieno/);

  // Another landlord cannot see the receipt.
  const stranger = client(base);
  await stranger.follow('/signup', { role: 'landlord', name: 'Other', email: 'other@example.com', password: 'password123' });
  assert.equal((await stranger.get(`/receipts/${store.all('payments')[0].id}`)).status, 404);
  assert.equal((await stranger.get(`/units/${unit.id}`)).status, 404);
});

test('POST without a valid CSRF token is rejected', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  await c.follow('/signup', { role: 'landlord', name: 'L', email: 'l@example.com', password: 'password123' });
  const res = await fetch(`${base}/properties`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Evil',
  });
  assert.equal(res.status, 403);
});

test('login rejects a wrong password', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const c = client(base);
  await c.follow('/signup', { role: 'tenant', name: 'T', email: 't@example.com', password: 'password123' });
  const r = await client(base).post('/login', { email: 't@example.com', password: 'wrong-password' });
  assert.equal(r.status, 401);
  assert.equal((await client(base).post('/login', { email: 't@example.com', password: 'password123' })).status, 303);
});
