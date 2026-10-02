'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const billing = require('../src/billing');
const { parseAmount } = require('../src/app');
const { normalisePhone } = require('../src/payments');

const lease = (start, rentHistory) => ({ start, rentHistory });

test('addMonths crosses year boundaries', () => {
  assert.equal(billing.addMonths('2026-11', 2), '2027-01');
  assert.equal(billing.addMonths('2026-01', -1), '2025-12');
});

test('charges one month of rent per month of the lease', () => {
  const st = billing.statement(lease('2026-08', [{ from: '2026-08', amount: 1000 }]), [], 5, new Date(2026, 9, 2));
  assert.equal(st.rows.length, 3); // Aug, Sep, Oct
  assert.equal(st.balance, 3000);
  assert.equal(st.status.code, 'overdue'); // August and September are unpaid
});

test('payments are applied to the oldest month first', () => {
  const st = billing.statement(lease('2026-08', [{ from: '2026-08', amount: 1000 }]), [{ amount: 1500 }], 5, new Date(2026, 9, 2));
  assert.deepEqual(st.rows.map((r) => r.outstanding), [0, 500, 1000]);
});

test('current month is "due" until the due day passes, then "overdue"', () => {
  const l = lease('2026-10', [{ from: '2026-10', amount: 1000 }]);
  assert.equal(billing.statement(l, [], 5, new Date(2026, 9, 3)).status.code, 'due');
  assert.equal(billing.statement(l, [], 5, new Date(2026, 9, 6)).status.code, 'overdue');
  assert.equal(billing.statement(l, [{ amount: 1000 }], 5, new Date(2026, 9, 6)).status.code, 'paid');
});

test('rent changes only affect months from the change onwards', () => {
  let history = [{ from: '2026-01', amount: 1000 }];
  history = billing.setRent(history, '2026-03', 1200);
  const st = billing.statement(lease('2026-01', history), [], 5, new Date(2026, 3, 1));
  assert.deepEqual(st.rows.map((r) => r.due), [1000, 1000, 1200, 1200]);
  assert.equal(st.currentRent, 1200);
});

test('parseAmount converts to cents and rejects junk', () => {
  assert.equal(parseAmount('15,000'), 1500000);
  assert.equal(parseAmount('99.5'), 9950);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1.234'), null);
});

test('normalisePhone accepts Kenyan mobile formats', () => {
  assert.equal(normalisePhone('0712 345 678'), '254712345678');
  assert.equal(normalisePhone('+254712345678'), '254712345678');
  assert.equal(normalisePhone('0112345678'), '254112345678');
  assert.equal(normalisePhone('12345'), null);
});
