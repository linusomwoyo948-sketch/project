'use strict';

const { METHODS } = require('./payments');
const { ordinal } = require('./billing');

const APP_NAME = 'RentLink';
const CURRENCY = process.env.CURRENCY || 'KES';
const LOCALE = process.env.LOCALE || 'en-KE';
const moneyFormat = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const money = (cents) => esc(moneyFormat.format(cents / 100));
const amountInput = (cents) => (Math.max(cents, 0) / 100).toFixed(2);

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

function dateLabel(iso) {
  return new Date(iso).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}

const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;
const badge = (status) => `<span class="badge badge-${esc(status.code)}">${esc(status.label)}</span>`;

function layout({ title, user, csrf, flash, body }) {
  const nav = user
    ? `<nav>
        <a href="/dashboard">Dashboard</a>
        <a href="/payments">Payments</a>
        <span class="who">${esc(user.name)} · ${user.role === 'landlord' ? 'Landlord' : 'Tenant'}</span>
        <form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="link">Log out</button></form>
      </nav>`
    : `<nav><a href="/login">Log in</a><a class="btn btn-small" href="/signup">Sign up</a></nav>`;
  const flashHtml = flash ? `<div class="flash flash-${esc(flash.type)}" role="status">${esc(flash.message)}</div>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ${APP_NAME}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar"><div class="wrap">
    <a class="logo" href="/">${APP_NAME}</a>
    ${nav}
  </div></header>
  <main class="wrap">
    ${flashHtml}
    ${body}
  </main>
  <footer class="wrap muted">${APP_NAME} — simple rent payments between landlords and tenants.</footer>
</body>
</html>`;
}

function home() {
  return `
  <section class="hero">
    <h1>Rent, paid and tracked in one place.</h1>
    <p>Landlords list their units and invite tenants with a join code. Tenants see exactly what they owe,
       pay by M-Pesa, card or bank transfer, and get an instant receipt. Both sides share the same record.</p>
    <div class="actions">
      <a class="btn" href="/signup?role=landlord">I'm a landlord</a>
      <a class="btn btn-secondary" href="/signup?role=tenant">I'm a tenant</a>
    </div>
  </section>
  <section class="grid3">
    <div class="card"><h3>1. List your units</h3><p>Add properties and units with their monthly rent and due date.</p></div>
    <div class="card"><h3>2. Invite tenants</h3><p>Each unit has a join code. Share it and your tenant links to the unit.</p></div>
    <div class="card"><h3>3. Get paid</h3><p>Tenants pay online. You see who has paid, who is due, and who is overdue.</p></div>
  </section>`;
}

function signup({ values = {}, error }) {
  const role = values.role === 'tenant' ? 'tenant' : 'landlord';
  return `
  <section class="narrow card">
    <h1>Create your account</h1>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <form method="post" action="/signup">
      <fieldset class="roles">
        <legend>I am a</legend>
        <label><input type="radio" name="role" value="landlord" ${role === 'landlord' ? 'checked' : ''}> Landlord</label>
        <label><input type="radio" name="role" value="tenant" ${role === 'tenant' ? 'checked' : ''}> Tenant</label>
      </fieldset>
      <label>Full name <input name="name" required maxlength="80" value="${esc(values.name)}"></label>
      <label>Email <input type="email" name="email" required maxlength="120" value="${esc(values.email)}"></label>
      <label>Phone <input name="phone" maxlength="20" placeholder="0712 345 678" value="${esc(values.phone)}"></label>
      <label>Password <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn">Sign up</button>
    </form>
    <p class="muted">Already have an account? <a href="/login">Log in</a></p>
  </section>`;
}

function login({ values = {}, error }) {
  return `
  <section class="narrow card">
    <h1>Log in</h1>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <form method="post" action="/login">
      <label>Email <input type="email" name="email" required value="${esc(values.email)}"></label>
      <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn">Log in</button>
    </form>
    <p class="muted">New here? <a href="/signup">Create an account</a></p>
  </section>`;
}

function landlordDashboard({ csrf, stats, properties, rentRoll }) {
  const props = properties.length
    ? properties
        .map(
          (p) => `<a class="card prop" href="/properties/${esc(p.id)}">
            <h3>${esc(p.name)}</h3><p class="muted">${esc(p.address)}</p>
            <p>${p.unitCount} unit(s) · ${p.occupied} occupied</p></a>`
        )
        .join('')
    : '<p class="muted">No properties yet. Add your first one below.</p>';

  const roll = rentRoll.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Tenant</th><th>Unit</th><th>Rent</th><th>Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>${rentRoll
          .map(
            (r) => `<tr>
              <td>${esc(r.tenant.name)}<br><span class="muted small">${esc(r.tenant.phone || r.tenant.email)}</span></td>
              <td>${esc(r.property.name)} · ${esc(r.unit.name)}</td>
              <td>${money(r.statement.currentRent)}</td>
              <td>${money(r.statement.balance)}</td>
              <td>${badge(r.statement.status)}</td>
              <td><a href="/units/${esc(r.unit.id)}">Open</a></td>
            </tr>`
          )
          .join('')}</tbody></table></div>`
    : '<p class="muted">No tenants yet. Open a unit to get its join code and share it with your tenant.</p>';

  return `
  <h1>Landlord dashboard</h1>
  <section class="stats">
    <div class="stat"><span>Collected this month</span><strong>${money(stats.collectedThisMonth)}</strong></div>
    <div class="stat"><span>Outstanding</span><strong>${money(stats.outstanding)}</strong></div>
    <div class="stat"><span>Occupied units</span><strong>${stats.occupied} / ${stats.units}</strong></div>
    <div class="stat"><span>Overdue tenants</span><strong>${stats.overdue}</strong></div>
  </section>
  <h2>Rent roll</h2>
  ${roll}
  <h2>Properties</h2>
  <div class="grid3">${props}</div>
  <section class="card">
    <h3>Add a property</h3>
    <form method="post" action="/properties" class="row">
      ${csrfField(csrf)}
      <label>Name <input name="name" required maxlength="80" placeholder="Sunrise Apartments"></label>
      <label>Address <input name="address" maxlength="160" placeholder="Ngong Road, Nairobi"></label>
      <button class="btn">Add property</button>
    </form>
  </section>`;
}

function tenantDashboard({ csrf, leases, recentPayments }) {
  const cards = leases.length
    ? leases
        .map(
          (l) => `<div class="card">
            <div class="spread"><h3>${esc(l.property.name)} · ${esc(l.unit.name)}</h3>${badge(l.statement.status)}</div>
            <p class="muted">${esc(l.property.address)}</p>
            <p>Landlord: ${esc(l.landlord.name)}${l.landlord.phone ? ` · ${esc(l.landlord.phone)}` : ''}</p>
            <div class="stats">
              <div class="stat"><span>Monthly rent</span><strong>${money(l.statement.currentRent)}</strong></div>
              <div class="stat"><span>Balance</span><strong>${money(l.statement.balance)}</strong></div>
              <div class="stat"><span>Due day</span><strong>${ordinal(l.unit.dueDay)} of each month</strong></div>
            </div>
            <a class="btn" href="/leases/${esc(l.lease.id)}/pay">Pay rent</a>
          </div>`
        )
        .join('')
    : '<p class="muted">You are not linked to a rental unit yet. Ask your landlord for the join code.</p>';

  return `
  <h1>My rent</h1>
  ${cards}
  <section class="card">
    <h3>Join a unit</h3>
    <form method="post" action="/join" class="row">
      ${csrfField(csrf)}
      <label>Join code from your landlord <input name="code" required maxlength="12" placeholder="e.g. 7KQ2MX" autocapitalize="characters"></label>
      <button class="btn">Join</button>
    </form>
  </section>
  <h2>Recent payments</h2>
  ${paymentsTable(recentPayments, 'tenant')}`;
}

function paymentsTable(payments, role) {
  if (!payments.length) return '<p class="muted">No payments yet.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Date</th>${role === 'landlord' ? '<th>Tenant</th>' : ''}<th>Unit</th><th>Method</th><th>Reference</th><th>Amount</th><th></th></tr></thead>
    <tbody>${payments
      .map(
        (p) => `<tr>
          <td>${esc(dateLabel(p.createdAt))}</td>
          ${role === 'landlord' ? `<td>${esc(p.tenant.name)}</td>` : ''}
          <td>${esc(p.property.name)} · ${esc(p.unit.name)}</td>
          <td>${esc(METHODS[p.method] || p.method)}</td>
          <td><code>${esc(p.reference)}</code></td>
          <td>${money(p.amount)}</td>
          <td><a href="/receipts/${esc(p.id)}">Receipt</a></td>
        </tr>`
      )
      .join('')}</tbody></table></div>`;
}

function paymentsPage({ payments, role, total }) {
  return `
  <h1>${role === 'landlord' ? 'Payments received' : 'My payments'}</h1>
  <p class="muted">${payments.length} payment(s) · ${money(total)} in total</p>
  ${paymentsTable(payments, role)}`;
}

function propertyPage({ csrf, property, units }) {
  const rows = units.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Unit</th><th>Rent</th><th>Due day</th><th>Tenant</th><th>Join code</th><th></th></tr></thead>
        <tbody>${units
          .map(
            (u) => `<tr>
              <td>${esc(u.unit.name)}</td>
              <td>${money(u.unit.rent)}</td>
              <td>${ordinal(u.unit.dueDay)}</td>
              <td>${u.tenant ? esc(u.tenant.name) : '<span class="muted">Vacant</span>'}</td>
              <td>${u.tenant ? '—' : `<code>${esc(u.unit.joinCode)}</code>`}</td>
              <td><a href="/units/${esc(u.unit.id)}">Manage</a></td>
            </tr>`
          )
          .join('')}</tbody></table></div>`
    : '<p class="muted">No units yet.</p>';

  return `
  <p><a href="/dashboard">← Dashboard</a></p>
  <h1>${esc(property.name)}</h1>
  <p class="muted">${esc(property.address)}</p>
  ${rows}
  <section class="card">
    <h3>Add a unit</h3>
    <form method="post" action="/properties/${esc(property.id)}/units" class="row">
      ${csrfField(csrf)}
      <label>Unit name <input name="name" required maxlength="40" placeholder="A1"></label>
      <label>Monthly rent (${esc(CURRENCY)}) <input name="rent" required inputmode="decimal" placeholder="15000"></label>
      <label>Due day <input type="number" name="dueDay" min="1" max="28" value="5" required></label>
      <button class="btn">Add unit</button>
    </form>
  </section>`;
}

function statementTable(st) {
  if (!st.rows.length) return '<p class="muted">The lease has not started yet, so no rent has been charged.</p>';
  return `<div class="table-wrap"><table class="statement">
    <thead><tr><th>Month</th><th>Rent</th><th>Paid</th><th>Outstanding</th></tr></thead>
    <tbody>${st.rows
      .slice()
      .reverse()
      .map(
        (r) => `<tr class="${r.outstanding > 0 ? 'unpaid' : ''}">
          <td>${esc(monthLabel(r.period))}</td><td>${money(r.due)}</td><td>${money(r.paid)}</td><td>${money(r.outstanding)}</td>
        </tr>`
      )
      .join('')}</tbody>
    <tfoot><tr><th>Total</th><th>${money(st.totalCharged)}</th><th>${money(st.totalPaid)}</th><th>${money(st.balance)}</th></tr></tfoot>
  </table></div>`;
}

function unitPage({ csrf, property, unit, lease, tenant, statement, payments, pastLeases, currentMonth }) {
  const tenantSection = lease
    ? `<section class="card">
        <div class="spread"><h3>Tenant: ${esc(tenant.name)}</h3>${badge(statement.status)}</div>
        <p class="muted">${esc(tenant.email)}${tenant.phone ? ` · ${esc(tenant.phone)}` : ''} · since ${esc(monthLabel(lease.start))}</p>
        <div class="stats">
          <div class="stat"><span>Monthly rent</span><strong>${money(statement.currentRent)}</strong></div>
          <div class="stat"><span>Total paid</span><strong>${money(statement.totalPaid)}</strong></div>
          <div class="stat"><span>Balance</span><strong>${money(statement.balance)}</strong></div>
        </div>
        <h4>Statement</h4>
        ${statementTable(statement)}
        <h4>Payments</h4>
        ${paymentsTable(payments, 'tenant')}
        <h4>Record a cash or offline payment</h4>
        <form method="post" action="/leases/${esc(lease.id)}/record-payment" class="row">
          ${csrfField(csrf)}
          <label>Amount (${esc(CURRENCY)}) <input name="amount" required inputmode="decimal" value="${amountInput(statement.balance)}"></label>
          <label>Note <input name="note" maxlength="120" placeholder="Cash received"></label>
          <button class="btn btn-secondary">Record payment</button>
        </form>
        <form method="post" action="/leases/${esc(lease.id)}/end" class="danger-zone"
              onsubmit="return confirm('End this lease? The tenant will be unlinked from the unit.')">
          ${csrfField(csrf)}
          <button class="btn btn-danger">End lease / tenant moved out</button>
        </form>
      </section>`
    : `<section class="card">
        <h3>Vacant</h3>
        <p>Share this join code with your tenant. They sign up as a tenant and enter it on their dashboard.</p>
        <p class="code">${esc(unit.joinCode)}</p>
        <form method="post" action="/units/${esc(unit.id)}/new-code">${csrfField(csrf)}<button class="btn btn-secondary">Generate a new code</button></form>
      </section>`;

  const history = pastLeases.length
    ? `<h3>Previous tenants</h3><ul>${pastLeases
        .map((p) => `<li>${esc(p.tenant.name)} — ${esc(monthLabel(p.lease.start))} to ${esc(dateLabel(p.lease.endedAt))}</li>`)
        .join('')}</ul>`
    : '';

  return `
  <p><a href="/properties/${esc(property.id)}">← ${esc(property.name)}</a></p>
  <h1>Unit ${esc(unit.name)}</h1>
  ${tenantSection}
  <section class="card">
    <h3>Unit settings</h3>
    <form method="post" action="/units/${esc(unit.id)}/settings" class="row">
      ${csrfField(csrf)}
      <label>Unit name <input name="name" required maxlength="40" value="${esc(unit.name)}"></label>
      <label>Monthly rent (${esc(CURRENCY)}) <input name="rent" required inputmode="decimal" value="${amountInput(unit.rent)}"></label>
      ${lease ? `<label>New rent applies from <input type="month" name="rentFrom" value="${esc(currentMonth)}" required></label>` : ''}
      <label>Due day <input type="number" name="dueDay" min="1" max="28" value="${unit.dueDay}" required></label>
      ${lease ? `<label>Lease start month <input type="month" name="leaseStart" value="${esc(lease.start)}" required></label>` : ''}
      <button class="btn btn-secondary">Save</button>
    </form>
  </section>
  ${history}`;
}

function payPage({ csrf, property, unit, landlord, statement, lease, error, values = {} }) {
  const method = values.method || 'mpesa';
  const suggested = values.amount ?? amountInput(statement.balance > 0 ? statement.balance : statement.currentRent);
  return `
  <p><a href="/dashboard">← Dashboard</a></p>
  <h1>Pay rent</h1>
  <p>${esc(property.name)} · Unit ${esc(unit.name)} — paid to ${esc(landlord.name)}</p>
  <div class="stats">
    <div class="stat"><span>Balance</span><strong>${money(statement.balance)}</strong></div>
    <div class="stat"><span>Status</span><strong>${badge(statement.status)}</strong></div>
  </div>
  <div class="split">
    <section class="card">
      <h3>Make a payment</h3>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <form method="post" action="/leases/${esc(lease.id)}/pay">
        ${csrfField(csrf)}
        <label>Amount (${esc(CURRENCY)}) <input name="amount" required inputmode="decimal" value="${esc(suggested)}"></label>
        <fieldset class="methods">
          <legend>Pay with</legend>
          <label><input type="radio" name="method" value="mpesa" ${method === 'mpesa' ? 'checked' : ''}> M-Pesa</label>
          <label><input type="radio" name="method" value="card" ${method === 'card' ? 'checked' : ''}> Card</label>
          <label><input type="radio" name="method" value="bank" ${method === 'bank' ? 'checked' : ''}> Bank transfer</label>
        </fieldset>
        <label>M-Pesa phone number <span class="muted small">(for M-Pesa)</span>
          <input name="phone" placeholder="0712 345 678" value="${esc(values.phone)}"></label>
        <label>Bank transfer reference <span class="muted small">(for bank transfer)</span>
          <input name="bankReference" maxlength="40" value="${esc(values.bankReference)}"></label>
        <button class="btn">Pay now</button>
        <p class="muted small">Demo mode: payments are simulated and no real money is moved.</p>
      </form>
    </section>
    <section class="card">
      <h3>Statement</h3>
      ${statementTable(statement)}
    </section>
  </div>`;
}

function receipt({ payment, tenant, landlord, property, unit, recorder }) {
  return `
  <section class="card receipt narrow">
    <h1>Payment receipt</h1>
    <p class="muted">Receipt no. <code>${esc(payment.id.slice(0, 8).toUpperCase())}</code></p>
    <dl>
      <dt>Amount</dt><dd><strong>${money(payment.amount)}</strong></dd>
      <dt>Date</dt><dd>${esc(dateLabel(payment.createdAt))}</dd>
      <dt>Paid by</dt><dd>${esc(tenant.name)}</dd>
      <dt>Paid to</dt><dd>${esc(landlord.name)}</dd>
      <dt>Property</dt><dd>${esc(property.name)} · Unit ${esc(unit.name)}</dd>
      <dt>Method</dt><dd>${esc(METHODS[payment.method] || payment.method)}</dd>
      <dt>Reference</dt><dd><code>${esc(payment.reference)}</code></dd>
      ${payment.note ? `<dt>Note</dt><dd>${esc(payment.note)}</dd>` : ''}
      ${recorder ? `<dt>Recorded by</dt><dd>${esc(recorder.name)}</dd>` : ''}
    </dl>
    <button class="btn btn-secondary" onclick="window.print()">Print</button>
    <a href="/dashboard">Back to dashboard</a>
  </section>`;
}

function errorPage(status, message) {
  return `<section class="narrow card"><h1>${status}</h1><p>${esc(message)}</p><p><a href="/">Go home</a></p></section>`;
}

module.exports = {
  layout, home, signup, login, landlordDashboard, tenantDashboard, propertyPage,
  unitPage, payPage, paymentsPage, receipt, errorPage,
};
