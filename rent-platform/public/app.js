'use strict';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $modal = document.getElementById('modal');
const $modalBody = document.getElementById('modal-body');
let me = null;

// Helpers -------------------------------------------------------------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (amount, currency) => `${esc(currency)} ${Number(amount).toLocaleString()}`;
const monthName = (period) => new Date(`${period}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const fmtDate = (d) => d ? new Date(d.replace(' ', 'T') + (d.length > 10 ? 'Z' : 'T00:00:00')).toLocaleDateString() : '';
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const METHODS = { mpesa: 'M-Pesa', card: 'Card', bank: 'Bank transfer', cash: 'Cash' };

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

// Binds a form to an async handler with error display and a busy button.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function openModal(html) {
  $modalBody.innerHTML = html;
  $modal.showModal();
  $modalBody.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $modal.close()));
  return $modalBody;
}

// Navigation ---------------------------------------------------------------
const LINKS = {
  landlord: [['#/dashboard', 'Dashboard'], ['#/properties', 'Properties'], ['#/invoices', 'Rent bills'], ['#/payments', 'Payments']],
  tenant: [['#/home', 'My rent'], ['#/history', 'Payment history']],
};

function renderNav() {
  if (!me) { $nav.innerHTML = ''; return; }
  const here = location.hash.split('/').slice(0, 2).join('/');
  $nav.innerHTML = LINKS[me.role].map(([href, label]) =>
    `<a href="${href}" class="${href === here ? 'active' : ''}">${label}</a>`).join('')
    + `<span class="muted small" style="padding:0 .5rem">${esc(me.name)}</span>`
    + '<button class="link" id="logout">Log out</button>';
  document.getElementById('logout').onclick = async () => {
    await api('/logout', { method: 'POST' });
    me = null;
    location.hash = '#/';
  };
}

async function route() {
  const [, page = '', id] = location.hash.split('/');
  if (!me && page !== '') { location.hash = '#/'; return; }
  if (me && page === '') { location.hash = me.role === 'landlord' ? '#/dashboard' : '#/home'; return; }
  renderNav();
  const pages = me ? (me.role === 'landlord'
    ? { dashboard: landlordDashboard, properties: landlordProperties, invoices: landlordInvoices, payments: landlordPayments, receipt }
    : { home: tenantHome, history: tenantHistory, receipt })
    : { '': landing };
  const view = pages[page];
  if (!view) { location.hash = '#/'; return; }
  $app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await view(id);
  } catch (err) {
    $app.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

// Landing / auth ------------------------------------------------------------
function landing() {
  $app.innerHTML = `
  <section class="hero">
    <div>
      <h1>Rent payments that just work, for landlords and tenants.</h1>
      <p class="muted">RentLink connects you in one place: monthly rent bills are created automatically,
      tenants pay by M-Pesa, card or bank transfer, and everyone gets instant receipts.</p>
      <ul>
        <li><b>Landlords:</b> add properties and units, invite tenants by email, see who has paid and who is overdue.</li>
        <li><b>Tenants:</b> see what you owe, pay in full or in parts, and keep a record of every payment.</li>
        <li><b>Both:</b> a shared, trustworthy payment history with downloadable receipts.</li>
      </ul>
    </div>
    <div class="card">
      <div class="tabs"><button class="on" data-tab="login">Log in</button><button data-tab="register">Create account</button></div>
      <form id="login-form">
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <button type="submit">Log in</button>
      </form>
      <form id="register-form" hidden>
        <div class="choice">
          <label><input type="radio" name="role" value="landlord" required> I'm a landlord</label>
          <label><input type="radio" name="role" value="tenant" required> I'm a tenant</label>
        </div>
        <label>Full name <input name="name" required autocomplete="name"></label>
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Phone <input name="phone" type="tel" placeholder="e.g. 0712 345 678" autocomplete="tel"></label>
        <label>Password <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <p class="small muted">Tenants: sign up with the same email your landlord invited.</p>
        <button type="submit">Create account</button>
      </form>
    </div>
  </section>`;
  const tabs = $app.querySelectorAll('[data-tab]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.toggle('on', x === t));
    $app.querySelector('#login-form').hidden = t.dataset.tab !== 'login';
    $app.querySelector('#register-form').hidden = t.dataset.tab !== 'register';
  }));
  const done = (user) => { me = user; location.hash = user.role === 'landlord' ? '#/dashboard' : '#/home'; };
  onSubmit($app.querySelector('#login-form'), async (data) => done(await api('/login', { body: data })));
  onSubmit($app.querySelector('#register-form'), async (data) => done(await api('/register', { body: data })));
}

// Landlord views -------------------------------------------------------------
async function landlordDashboard() {
  const [s, invoices] = await Promise.all([api('/landlord/summary'), api('/landlord/invoices')]);
  const attention = invoices.filter((i) => i.status === 'overdue' || i.pending > 0).slice(0, 8);
  const totals = s.totals.length ? s.totals : [{ currency: '', expected_this_month: 0, collected_this_month: 0, outstanding: 0 }];
  $app.innerHTML = `
    <div class="page-head"><div><h1>Welcome, ${esc(me.name)}</h1><p class="muted">Here's how rent collection is going.</p></div></div>
    <div class="grid">
      <div class="card stat"><div class="label">Occupied units</div><div class="value">${s.occupied} / ${s.units}</div></div>
      ${totals.map((t) => `
        <div class="card stat"><div class="label">Collected this month ${esc(t.currency)}</div>
          <div class="value">${money(t.collected_this_month, t.currency)}</div>
          <div class="small muted">of ${money(t.expected_this_month, t.currency)} expected</div></div>
        <div class="card stat"><div class="label">Outstanding ${esc(t.currency)}</div><div class="value">${money(t.outstanding, t.currency)}</div></div>`).join('')}
      <div class="card stat"><div class="label">Overdue bills</div><div class="value">${s.overdue_invoices}</div></div>
      <div class="card stat"><div class="label">Payments to confirm</div><div class="value">${s.pending_payments}</div>
        ${s.pending_payments ? '<a href="#/payments" class="small">Review now →</a>' : ''}</div>
    </div>
    <div class="card">
      <h2>Needs attention</h2>
      ${attention.length ? invoiceTable(attention) : `<p class="empty">${s.units ? 'All caught up. No overdue rent.' : 'Start by <a href="#/properties">adding a property</a>.'}</p>`}
    </div>`;
}

function invoiceTable(rows) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Month</th><th>Property / unit</th><th>Tenant</th><th>Due</th><th class="num">Rent</th><th class="num">Paid</th><th>Status</th></tr></thead>
    <tbody>${rows.map((i) => `<tr>
      <td>${monthName(i.period)}</td>
      <td>${esc(i.property_name)} · ${esc(i.unit_label)}</td>
      <td>${esc(i.tenant_name || i.tenant_email)}</td>
      <td>${fmtDate(i.due_date)}</td>
      <td class="num">${money(i.amount, i.currency)}</td>
      <td class="num">${money(i.paid, i.currency)}${i.pending ? `<div class="small muted">+${money(i.pending, i.currency)} pending</div>` : ''}</td>
      <td>${badge(i.status)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function landlordProperties() {
  const [properties, currencies] = await Promise.all([api('/properties'), api('/currencies')]);
  $app.innerHTML = `
    <div class="page-head"><div><h1>Properties</h1><p class="muted">Add your buildings and units, then invite tenants.</p></div>
      <button id="add-property">+ Add property</button></div>
    ${properties.length ? '' : '<div class="card empty">No properties yet. Add your first one to get started.</div>'}
    ${properties.map((p) => `
      <div class="card">
        <div class="page-head" style="margin:0">
          <div><h2>${esc(p.name)}</h2><p class="muted small">${esc(p.address)} · ${esc(p.currency)}</p></div>
          <div class="actions"><button class="sm" data-add-unit="${p.id}">+ Add unit</button>
            <button class="sm danger" data-del-property="${p.id}">Delete</button></div>
        </div>
        ${p.units.length ? p.units.map((u) => `
          <div class="unit">
            <div><b>${esc(u.label)}</b> <span class="muted">· ${money(u.lease ? u.lease.monthly_rent : u.monthly_rent, p.currency)}/month</span>
              ${u.lease ? `<div class="small">${esc(u.lease.tenant_name || u.lease.tenant_email)} ${badge(u.lease.tenant_id ? 'active' : 'invited')}
                <span class="muted">· due on day ${u.lease.due_day} · since ${fmtDate(u.lease.start_date)}</span></div>`
                : '<div class="small muted">Vacant</div>'}</div>
            <div>${u.lease
              ? `<button class="sm secondary" data-end-lease="${u.lease.id}">End tenancy</button>`
              : `<button class="sm" data-invite="${u.id}" data-rent="${u.monthly_rent}">Add tenant</button>`}</div>
          </div>`).join('') : '<p class="muted small">No units yet.</p>'}
      </div>`).join('')}`;

  $app.querySelector('#add-property').onclick = () => {
    const m = openModal(`<h2>Add property</h2><form>
      <label>Name <input name="name" required placeholder="e.g. Sunrise Apartments"></label>
      <label>Address <input name="address" required placeholder="Street, town"></label>
      <label>Currency <select name="currency">${currencies.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <div class="actions"><button type="submit">Save</button><button type="button" class="secondary" data-close>Cancel</button></div></form>`);
    onSubmit(m.querySelector('form'), async (d) => { await api('/properties', { body: d }); $modal.close(); toast('Property added'); route(); });
  };
  $app.querySelectorAll('[data-add-unit]').forEach((b) => b.onclick = () => {
    const m = openModal(`<h2>Add unit</h2><form>
      <label>Unit name / number <input name="label" required placeholder="e.g. A1"></label>
      <label>Monthly rent <input name="monthly_rent" type="number" min="1" step="1" required></label>
      <div class="actions"><button type="submit">Save</button><button type="button" class="secondary" data-close>Cancel</button></div></form>`);
    onSubmit(m.querySelector('form'), async (d) => { await api(`/properties/${b.dataset.addUnit}/units`, { body: d }); $modal.close(); toast('Unit added'); route(); });
  });
  $app.querySelectorAll('[data-invite]').forEach((b) => b.onclick = () => {
    const today = new Date().toISOString().slice(0, 10);
    const m = openModal(`<h2>Add tenant</h2>
      <p class="muted small">Enter your tenant's email. If they don't have an account yet, they'll see this unit as soon as they sign up with that email.</p>
      <form>
      <label>Tenant email <input name="tenant_email" type="email" required></label>
      <div class="row">
        <label>Monthly rent <input name="monthly_rent" type="number" min="1" value="${esc(b.dataset.rent)}" required></label>
        <label>Rent due day <input name="due_day" type="number" min="1" max="28" value="5" required></label>
      </div>
      <label>Tenancy start date <input name="start_date" type="date" value="${today}" required></label>
      <div class="actions"><button type="submit">Add tenant</button><button type="button" class="secondary" data-close>Cancel</button></div></form>`);
    onSubmit(m.querySelector('form'), async (d) => {
      const r = await api(`/units/${b.dataset.invite}/leases`, { body: d });
      $modal.close();
      toast(r.tenant_registered ? 'Tenant added' : 'Invite saved. Ask your tenant to sign up with that email.');
      route();
    });
  });
  $app.querySelectorAll('[data-end-lease]').forEach((b) => b.onclick = async () => {
    if (!confirm('End this tenancy? No new rent bills will be created for it.')) return;
    try { await api(`/leases/${b.dataset.endLease}/end`, { method: 'POST' }); toast('Tenancy ended'); route(); } catch (e) { toast(e.message, true); }
  });
  $app.querySelectorAll('[data-del-property]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this property with all its units, bills and payment records?')) return;
    try { await api(`/properties/${b.dataset.delProperty}`, { method: 'DELETE' }); toast('Property deleted'); route(); } catch (e) { toast(e.message, true); }
  });
}

async function landlordInvoices() {
  const invoices = await api('/landlord/invoices');
  $app.innerHTML = `
    <div class="page-head"><div><h1>Rent bills</h1><p class="muted">A bill is created automatically each month for every tenancy.</p></div>
      <label style="min-width:180px">Show <select id="filter">
        <option value="">All</option><option value="open">Not fully paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option></select></label></div>
    <div class="card" id="list"></div>`;
  const draw = (f) => {
    const rows = invoices.filter((i) => !f || (f === 'open' ? i.status !== 'paid' : i.status === f));
    $app.querySelector('#list').innerHTML = rows.length ? invoiceTable(rows) : '<p class="empty">No bills to show.</p>';
  };
  $app.querySelector('#filter').onchange = (e) => draw(e.target.value);
  draw('');
}

function paymentTable(rows, { landlordView }) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>For</th>${landlordView ? '<th>Tenant</th>' : ''}<th>Method</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td>${fmtDate(p.created_at)}</td>
      <td>${monthName(p.period)}<div class="small muted">${esc(p.property_name)} · ${esc(p.unit_label)}</div></td>
      ${landlordView ? `<td>${esc(p.tenant_name || '-')}</td>` : ''}
      <td>${METHODS[p.method]}<div class="small muted">${esc(p.reference)}</div></td>
      <td class="num">${money(p.amount, p.currency)}</td>
      <td>${badge(p.status)}</td>
      <td>${landlordView && p.status === 'pending'
        ? `<div class="actions"><button class="sm" data-confirm="${p.id}">Confirm</button><button class="sm danger" data-reject="${p.id}">Reject</button></div>`
        : `<a href="#/receipt/${p.id}" class="small">Receipt</a>`}</td></tr>`).join('')}</tbody></table></div>`;
}

async function landlordPayments() {
  const payments = await api('/landlord/payments');
  $app.innerHTML = `
    <div class="page-head"><div><h1>Payments</h1><p class="muted">M-Pesa and card payments are recorded automatically. Confirm bank transfers and cash once you've received them.</p></div></div>
    <div class="card">${payments.length ? paymentTable(payments, { landlordView: true }) : '<p class="empty">No payments yet.</p>'}</div>`;
  for (const action of ['confirm', 'reject']) {
    $app.querySelectorAll(`[data-${action}]`).forEach((b) => b.onclick = async () => {
      if (action === 'reject' && !confirm('Reject this payment? Choose this only if the money never arrived.')) return;
      try { await api(`/payments/${b.dataset[action]}/${action}`, { method: 'POST' }); toast(`Payment ${action}ed`); route(); } catch (e) { toast(e.message, true); }
    });
  }
}

// Tenant views ----------------------------------------------------------------
async function tenantHome() {
  const [leases, invoices] = await Promise.all([api('/tenant/leases'), api('/tenant/invoices')]);
  const open = invoices.filter((i) => i.status !== 'paid');
  const owedBy = {};
  for (const i of open) owedBy[i.currency] = (owedBy[i.currency] || 0) + i.balance - i.pending;
  const owedText = Object.entries(owedBy).filter(([, v]) => v > 0).map(([c, v]) => money(v, c)).join(' + ');
  $app.innerHTML = `
    <div class="page-head"><div><h1>Hi, ${esc(me.name)}</h1>
      <p class="muted">${owedText ? `You owe <b>${owedText}</b>.` : (leases.length ? "You're all paid up. 🎉" : '')}</p></div></div>
    ${leases.length ? '' : `<div class="card empty">You're not linked to a rental yet. Ask your landlord to add you using <b>${esc(me.email)}</b>.</div>`}
    <div class="grid">${leases.map((l) => `
      <div class="card">
        <h2>${esc(l.property_name)} · ${esc(l.unit_label)} ${badge(l.status)}</h2>
        <p class="muted small">${esc(l.address)}</p>
        <p>${money(l.monthly_rent, l.currency)} per month, due on day ${l.due_day}</p>
        <p class="small muted">Landlord: ${esc(l.landlord_name)} · <a href="mailto:${esc(l.landlord_email)}">${esc(l.landlord_email)}</a>${l.landlord_phone ? ` · ${esc(l.landlord_phone)}` : ''}</p>
      </div>`).join('')}</div>
    ${invoices.length ? `<div class="card"><h2>Rent bills</h2>${invoices.map((i) => {
      const payable = i.balance - i.pending;
      return `<div class="bill">
        <div><b>${monthName(i.period)}</b> ${badge(i.status)}
          <div class="small muted">${esc(i.property_name)} · ${esc(i.unit_label)} · due ${fmtDate(i.due_date)}</div>
          ${i.pending ? `<div class="small muted">${money(i.pending, i.currency)} awaiting landlord confirmation</div>` : ''}</div>
        <div class="actions" style="align-items:center">
          <div style="text-align:right"><div class="amount">${money(i.balance, i.currency)}</div>
            <div class="small muted">${i.balance ? `left of ${money(i.amount, i.currency)}` : `${money(i.amount, i.currency)} paid`}</div></div>
          ${payable > 0 ? `<button data-pay="${i.id}">Pay</button>` : ''}</div>
      </div>`;
    }).join('')}</div>` : ''}`;

  $app.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => payDialog(invoices.find((i) => i.id === Number(b.dataset.pay))));
}

function payDialog(inv) {
  const payable = inv.balance - inv.pending;
  const m = openModal(`<h2>Pay rent</h2>
    <p class="muted">${esc(inv.property_name)} · ${esc(inv.unit_label)}, ${monthName(inv.period)}</p>
    <form>
      <label>Amount (${esc(inv.currency)}) <input name="amount" type="number" min="1" max="${payable}" value="${payable}" required></label>
      <label>Pay with <select name="method">
        <option value="mpesa">M-Pesa</option><option value="card">Card</option>
        <option value="bank">Bank transfer</option><option value="cash">Cash (paid to landlord)</option></select></label>
      <label data-for="mpesa">M-Pesa phone number <input name="phone" type="tel" value="${esc(me.phone || '')}" placeholder="0712 345 678"></label>
      <label data-for="bank" hidden>Bank transfer reference <input name="reference" placeholder="Reference from your bank"></label>
      <p class="small muted" data-for="card" hidden>Card payments are simulated in this demo. No card details are collected.</p>
      <p class="small muted" data-for="bank cash" hidden>Your landlord will confirm this payment once they receive it.</p>
      <label>Note (optional) <input name="note" maxlength="200"></label>
      <div class="actions"><button type="submit">Pay now</button><button type="button" class="secondary" data-close>Cancel</button></div>
    </form>`);
  const form = m.querySelector('form');
  const sync = () => {
    const method = form.method.value;
    form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(method); });
    form.phone.required = method === 'mpesa';
    form.reference.required = method === 'bank';
  };
  form.method.onchange = sync;
  sync();
  onSubmit(form, async (d) => {
    const r = await api(`/invoices/${inv.id}/pay`, { body: d });
    $modal.close();
    toast(r.status === 'completed' ? `Payment successful. Ref ${r.reference}` : 'Payment submitted for landlord confirmation');
    location.hash = `#/receipt/${r.id}`;
  });
}

async function tenantHistory() {
  const payments = await api('/tenant/payments');
  $app.innerHTML = `
    <div class="page-head"><div><h1>Payment history</h1><p class="muted">Every payment you've made, with receipts.</p></div></div>
    <div class="card">${payments.length ? paymentTable(payments, { landlordView: false }) : '<p class="empty">No payments yet.</p>'}</div>`;
}

// Shared ----------------------------------------------------------------------
async function receipt(id) {
  const p = await api(`/payments/${encodeURIComponent(id)}`);
  $app.innerHTML = `
    <div class="card receipt" style="max-width:520px;margin:0 auto">
      <div class="page-head" style="margin:0"><h1>Payment receipt</h1>${badge(p.status)}</div>
      <p class="muted small">Receipt #${String(p.id).padStart(6, '0')}</p>
      <dl>
        <dt>Amount</dt><dd>${money(p.amount, p.currency)}</dd>
        <dt>For</dt><dd>Rent for ${monthName(p.period)}</dd>
        <dt>Property</dt><dd>${esc(p.property_name)} · ${esc(p.unit_label)}</dd>
        <dt>Tenant</dt><dd>${esc(p.tenant_name || '-')}</dd>
        <dt>Landlord</dt><dd>${esc(p.landlord_name)}</dd>
        <dt>Method</dt><dd>${METHODS[p.method]}</dd>
        <dt>Reference</dt><dd>${esc(p.reference)}</dd>
        <dt>Paid on</dt><dd>${fmtDate(p.created_at)}</dd>
        ${p.confirmed_at ? `<dt>${p.status === 'rejected' ? 'Rejected' : 'Confirmed'} on</dt><dd>${fmtDate(p.confirmed_at)}</dd>` : ''}
        ${p.note ? `<dt>Note</dt><dd>${esc(p.note)}</dd>` : ''}
      </dl>
      <div class="actions no-print"><button onclick="window.print()">Print / save PDF</button>
        <button class="secondary" onclick="history.back()">Back</button></div>
    </div>`;
}

// Boot ----------------------------------------------------------------------
window.addEventListener('hashchange', route);
api('/me').then((u) => { me = u; route(); }).catch(() => route());
