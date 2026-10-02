'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('./auth');
const views = require('./views');
const billing = require('./billing');
const { getProvider } = require('./payments');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'));
const MAX_BODY = 64 * 1024;
const MAX_AMOUNT = 100_000_000 * 100; // 100 million, in cents
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// "15,000.50" -> 1500050 cents. Returns null if not a positive amount.
function parseAmount(raw) {
  const cleaned = String(raw ?? '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 && cents <= MAX_AMOUNT ? cents : null;
}

function parseDueDay(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
}

function clean(raw, max) {
  return String(raw ?? '').trim().slice(0, max);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
    req.on('error', reject);
  });
}

function createApp({ store, today = () => new Date(), secureCookies = false } = {}) {
  const provider = getProvider();

  // ---------- helpers ----------
  const userById = (id) => store.get('users', id);
  const propertyOf = (unit) => store.get('properties', unit.propertyId);
  const activeLease = (unitId) => store.find('leases', (l) => l.unitId === unitId && l.active);
  const leasePayments = (leaseId) => store.filter('payments', (p) => p.leaseId === leaseId);

  function statementFor(lease) {
    const unit = store.get('units', lease.unitId);
    return billing.statement(lease, leasePayments(lease.id), unit.dueDay, today());
  }

  function newJoinCode() {
    for (;;) {
      const bytes = crypto.randomBytes(6);
      const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!store.find('units', (u) => u.joinCode === code)) return code;
    }
  }

  function requireUser(ctx, role) {
    if (!ctx.user) throw redirectTo('/login');
    if (role && ctx.user.role !== role) throw new HttpError(403, 'This page is not available for your account type.');
    return ctx.user;
  }

  function ownedUnit(ctx, unitId) {
    const user = requireUser(ctx, 'landlord');
    const unit = store.get('units', unitId);
    if (!unit || propertyOf(unit).landlordId !== user.id) throw new HttpError(404, 'Unit not found.');
    return unit;
  }

  function ownedLease(ctx, leaseId) {
    const lease = store.get('leases', leaseId);
    if (!lease) throw new HttpError(404, 'Lease not found.');
    ownedUnit(ctx, lease.unitId);
    return lease;
  }

  // Everything needed to show a payment, plus whether `user` may see it.
  function paymentDetails(payment) {
    const lease = store.get('leases', payment.leaseId);
    const unit = store.get('units', lease.unitId);
    const property = propertyOf(unit);
    return { ...payment, lease, unit, property, tenant: userById(lease.tenantId), landlord: userById(property.landlordId) };
  }

  function paymentsVisibleTo(user) {
    return store
      .all('payments')
      .map(paymentDetails)
      .filter((p) => (user.role === 'landlord' ? p.landlord.id === user.id : p.tenant.id === user.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function flash(ctx, type, message) {
    ctx.session.flash = { type, message };
    store.save();
  }

  function render(ctx, title, body, status = 200) {
    let flashMsg = null;
    if (ctx.session && ctx.session.flash) {
      flashMsg = ctx.session.flash;
      ctx.session.flash = null;
      store.save();
    }
    const html = views.layout({ title, user: ctx.user, csrf: ctx.session?.csrf, flash: flashMsg, body });
    ctx.res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    ctx.res.end(html);
  }

  function redirectTo(location, headers = {}) {
    return { redirect: location, headers };
  }

  function startSession(ctx, user) {
    if (ctx.session) store.remove('sessions', (s) => s.token === ctx.session.token);
    const session = auth.createSession(store, user.id);
    return redirectTo('/dashboard', { 'Set-Cookie': auth.sessionCookie(session.token, secureCookies) });
  }

  // ---------- route handlers ----------
  const handlers = {
    home(ctx) {
      if (ctx.user) return redirectTo('/dashboard');
      render(ctx, 'Welcome', views.home());
    },

    signupForm(ctx) {
      if (ctx.user) return redirectTo('/dashboard');
      render(ctx, 'Sign up', views.signup({ values: { role: ctx.url.searchParams.get('role') } }));
    },

    signup(ctx) {
      const b = ctx.body;
      const values = {
        role: b.role === 'tenant' ? 'tenant' : 'landlord',
        name: clean(b.name, 80),
        email: clean(b.email, 120).toLowerCase(),
        phone: clean(b.phone, 20),
      };
      let error = null;
      if (!values.name) error = 'Please enter your name.';
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) error = 'Please enter a valid email address.';
      else if (String(b.password || '').length < 8) error = 'Password must be at least 8 characters.';
      else if (store.find('users', (u) => u.email === values.email)) error = 'An account with that email already exists.';
      if (error) return render(ctx, 'Sign up', views.signup({ values, error }), 400);

      const user = store.insert('users', { ...values, passwordHash: auth.hashPassword(String(b.password)) });
      return startSession(ctx, user);
    },

    loginForm(ctx) {
      if (ctx.user) return redirectTo('/dashboard');
      render(ctx, 'Log in', views.login({}));
    },

    login(ctx) {
      const email = clean(ctx.body.email, 120).toLowerCase();
      const user = store.find('users', (u) => u.email === email);
      if (!user || !auth.verifyPassword(String(ctx.body.password || ''), user.passwordHash)) {
        return render(ctx, 'Log in', views.login({ values: { email }, error: 'Incorrect email or password.' }), 401);
      }
      return startSession(ctx, user);
    },

    logout(ctx) {
      if (ctx.session) store.remove('sessions', (s) => s.token === ctx.session.token);
      return redirectTo('/', { 'Set-Cookie': auth.sessionCookie(null, secureCookies) });
    },

    dashboard(ctx) {
      const user = requireUser(ctx);
      return user.role === 'landlord' ? landlordDashboard(ctx, user) : tenantDashboard(ctx, user);
    },

    createProperty(ctx) {
      const user = requireUser(ctx, 'landlord');
      const name = clean(ctx.body.name, 80);
      if (!name) {
        flash(ctx, 'error', 'Property name is required.');
        return redirectTo('/dashboard');
      }
      const property = store.insert('properties', { landlordId: user.id, name, address: clean(ctx.body.address, 160) });
      flash(ctx, 'success', `${name} added. Now add its units.`);
      return redirectTo(`/properties/${property.id}`);
    },

    showProperty(ctx) {
      const user = requireUser(ctx, 'landlord');
      const property = store.get('properties', ctx.params.id);
      if (!property || property.landlordId !== user.id) throw new HttpError(404, 'Property not found.');
      const units = store
        .filter('units', (u) => u.propertyId === property.id)
        .map((unit) => {
          const lease = activeLease(unit.id);
          return { unit, tenant: lease && userById(lease.tenantId) };
        });
      render(ctx, property.name, views.propertyPage({ csrf: ctx.session.csrf, property, units }));
    },

    createUnit(ctx) {
      const user = requireUser(ctx, 'landlord');
      const property = store.get('properties', ctx.params.id);
      if (!property || property.landlordId !== user.id) throw new HttpError(404, 'Property not found.');
      const name = clean(ctx.body.name, 40);
      const rent = parseAmount(ctx.body.rent);
      const dueDay = parseDueDay(ctx.body.dueDay);
      if (!name || rent === null || dueDay === null) {
        flash(ctx, 'error', 'Enter a unit name, a rent amount and a due day between 1 and 28.');
      } else {
        store.insert('units', { propertyId: property.id, name, rent, dueDay, joinCode: newJoinCode() });
        flash(ctx, 'success', `Unit ${name} added.`);
      }
      return redirectTo(`/properties/${property.id}`);
    },

    showUnit(ctx) {
      const unit = ownedUnit(ctx, ctx.params.id);
      const lease = activeLease(unit.id);
      const pastLeases = store
        .filter('leases', (l) => l.unitId === unit.id && !l.active)
        .map((l) => ({ lease: l, tenant: userById(l.tenantId) }));
      const payments = lease ? paymentsVisibleTo(ctx.user).filter((p) => p.leaseId === lease.id) : [];
      render(
        ctx,
        `Unit ${unit.name}`,
        views.unitPage({
          csrf: ctx.session.csrf,
          property: propertyOf(unit),
          unit,
          lease,
          tenant: lease && userById(lease.tenantId),
          statement: lease && statementFor(lease),
          payments,
          pastLeases,
          currentMonth: billing.monthKey(today()),
        })
      );
    },

    updateUnit(ctx) {
      const unit = ownedUnit(ctx, ctx.params.id);
      const lease = activeLease(unit.id);
      const name = clean(ctx.body.name, 40);
      const rent = parseAmount(ctx.body.rent);
      const dueDay = parseDueDay(ctx.body.dueDay);
      const back = redirectTo(`/units/${unit.id}`);
      if (!name || rent === null || dueDay === null) {
        flash(ctx, 'error', 'Enter a unit name, a rent amount and a due day between 1 and 28.');
        return back;
      }
      if (lease) {
        const { rentFrom, leaseStart } = ctx.body;
        if (!billing.isMonthKey(rentFrom) || !billing.isMonthKey(leaseStart)) {
          flash(ctx, 'error', 'Choose valid months for the rent change and lease start.');
          return back;
        }
        lease.start = leaseStart;
        if (rent !== billing.rentFor(lease.rentHistory, rentFrom)) {
          lease.rentHistory = billing.setRent(lease.rentHistory, rentFrom, rent);
        }
        // The first rent entry must cover the lease start.
        if (lease.rentHistory[0].from > lease.start) lease.rentHistory[0].from = lease.start;
      }
      Object.assign(unit, { name, rent, dueDay });
      flash(ctx, 'success', 'Unit updated.');
      return back;
    },

    newCode(ctx) {
      const unit = ownedUnit(ctx, ctx.params.id);
      unit.joinCode = newJoinCode();
      flash(ctx, 'success', 'A new join code was generated. The old code no longer works.');
      return redirectTo(`/units/${unit.id}`);
    },

    recordPayment(ctx) {
      const lease = ownedLease(ctx, ctx.params.id);
      if (!lease.active) throw new HttpError(400, 'This lease has ended.');
      const amount = parseAmount(ctx.body.amount);
      if (amount === null) {
        flash(ctx, 'error', 'Enter a valid amount.');
        return redirectTo(`/units/${lease.unitId}`);
      }
      const payment = store.insert('payments', {
        leaseId: lease.id,
        amount,
        method: 'cash',
        reference: `CASH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        note: clean(ctx.body.note, 120),
        recordedBy: ctx.user.id,
      });
      flash(ctx, 'success', 'Payment recorded. The tenant can see it on their dashboard.');
      return redirectTo(`/receipts/${payment.id}`);
    },

    endLease(ctx) {
      const lease = ownedLease(ctx, ctx.params.id);
      lease.active = false;
      lease.endedAt = today().toISOString();
      const unit = store.get('units', lease.unitId);
      unit.joinCode = newJoinCode();
      flash(ctx, 'success', 'Lease ended. The unit is vacant and has a new join code.');
      return redirectTo(`/units/${unit.id}`);
    },

    join(ctx) {
      const user = requireUser(ctx, 'tenant');
      const code = clean(ctx.body.code, 12).toUpperCase().replace(/\s/g, '');
      const unit = code && store.find('units', (u) => u.joinCode === code);
      if (!unit) {
        flash(ctx, 'error', 'That join code was not recognised. Check it with your landlord.');
      } else if (activeLease(unit.id)) {
        flash(ctx, 'error', 'That unit already has a tenant. Ask your landlord for a new code.');
      } else {
        const start = billing.monthKey(today());
        store.insert('leases', {
          unitId: unit.id,
          tenantId: user.id,
          start,
          rentHistory: [{ from: start, amount: unit.rent }],
          active: true,
          endedAt: null,
        });
        unit.joinCode = newJoinCode();
        flash(ctx, 'success', `You are now linked to ${propertyOf(unit).name}, unit ${unit.name}.`);
      }
      return redirectTo('/dashboard');
    },

    payForm(ctx) {
      renderPay(ctx, tenantLease(ctx));
    },

    async pay(ctx) {
      const lease = tenantLease(ctx);
      const values = {
        amount: clean(ctx.body.amount, 20),
        method: ctx.body.method,
        phone: clean(ctx.body.phone, 20),
        bankReference: clean(ctx.body.bankReference, 40),
      };
      const amount = parseAmount(values.amount);
      if (amount === null) return renderPay(ctx, lease, { values, error: 'Enter a valid amount.' }, 400);
      if (!['mpesa', 'card', 'bank'].includes(values.method)) {
        return renderPay(ctx, lease, { values, error: 'Choose a payment method.' }, 400);
      }
      const result = await provider.charge({ amount, method: values.method, phone: values.phone, bankReference: values.bankReference });
      if (!result.ok) return renderPay(ctx, lease, { values, error: result.error }, 400);

      const payment = store.insert('payments', {
        leaseId: lease.id,
        amount,
        method: values.method,
        reference: result.reference,
        payerPhone: result.payerPhone || null,
        provider: provider.name,
        recordedBy: null,
      });
      flash(ctx, 'success', 'Payment successful. Your landlord has been credited.');
      return redirectTo(`/receipts/${payment.id}`);
    },

    payments(ctx) {
      const user = requireUser(ctx);
      const payments = paymentsVisibleTo(user);
      const total = payments.reduce((sum, p) => sum + p.amount, 0);
      render(ctx, 'Payments', views.paymentsPage({ payments, role: user.role, total }));
    },

    receipt(ctx) {
      const user = requireUser(ctx);
      const payment = store.get('payments', ctx.params.id);
      const details = payment && paymentDetails(payment);
      if (!details || (details.tenant.id !== user.id && details.landlord.id !== user.id)) {
        throw new HttpError(404, 'Receipt not found.');
      }
      render(ctx, 'Receipt', views.receipt({ ...details, payment, recorder: payment.recordedBy && userById(payment.recordedBy) }));
    },

    css(ctx) {
      ctx.res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      ctx.res.end(CSS);
    },
  };

  function tenantLease(ctx) {
    const user = requireUser(ctx, 'tenant');
    const lease = store.get('leases', ctx.params.id);
    if (!lease || lease.tenantId !== user.id || !lease.active) throw new HttpError(404, 'Lease not found.');
    return lease;
  }

  function renderPay(ctx, lease, extra = {}, status = 200) {
    const unit = store.get('units', lease.unitId);
    const property = propertyOf(unit);
    const body = views.payPage({
      csrf: ctx.session.csrf,
      property,
      unit,
      lease,
      landlord: userById(property.landlordId),
      statement: statementFor(lease),
      ...extra,
    });
    render(ctx, 'Pay rent', body, status);
  }

  function landlordDashboard(ctx, user) {
    const properties = store.filter('properties', (p) => p.landlordId === user.id);
    const propertyIds = new Set(properties.map((p) => p.id));
    const units = store.filter('units', (u) => propertyIds.has(u.propertyId));
    const thisMonth = billing.monthKey(today());

    const rentRoll = [];
    for (const unit of units) {
      const lease = activeLease(unit.id);
      if (lease) {
        rentRoll.push({ unit, lease, property: propertyOf(unit), tenant: userById(lease.tenantId), statement: statementFor(lease) });
      }
    }
    const order = { overdue: 0, due: 1, paid: 2 };
    rentRoll.sort((a, b) => order[a.statement.status.code] - order[b.statement.status.code]);

    const stats = {
      units: units.length,
      occupied: rentRoll.length,
      outstanding: rentRoll.reduce((sum, r) => sum + Math.max(r.statement.balance, 0), 0),
      overdue: rentRoll.filter((r) => r.statement.status.code === 'overdue').length,
      collectedThisMonth: paymentsVisibleTo(user)
        .filter((p) => billing.monthKey(new Date(p.createdAt)) === thisMonth)
        .reduce((sum, p) => sum + p.amount, 0),
    };

    const summaries = properties.map((p) => {
      const own = units.filter((u) => u.propertyId === p.id);
      return { ...p, unitCount: own.length, occupied: own.filter((u) => activeLease(u.id)).length };
    });
    render(ctx, 'Dashboard', views.landlordDashboard({ csrf: ctx.session.csrf, stats, properties: summaries, rentRoll }));
  }

  function tenantDashboard(ctx, user) {
    const leases = store
      .filter('leases', (l) => l.tenantId === user.id && l.active)
      .map((lease) => {
        const unit = store.get('units', lease.unitId);
        const property = propertyOf(unit);
        return { lease, unit, property, landlord: userById(property.landlordId), statement: statementFor(lease) };
      });
    const recentPayments = paymentsVisibleTo(user).slice(0, 5);
    render(ctx, 'My rent', views.tenantDashboard({ csrf: ctx.session.csrf, leases, recentPayments }));
  }

  // ---------- routing ----------
  const table = [
    ['GET', '/', 'home'],
    ['GET', '/styles.css', 'css'],
    ['GET', '/signup', 'signupForm'],
    ['POST', '/signup', 'signup'],
    ['GET', '/login', 'loginForm'],
    ['POST', '/login', 'login'],
    ['POST', '/logout', 'logout'],
    ['GET', '/dashboard', 'dashboard'],
    ['POST', '/properties', 'createProperty'],
    ['GET', '/properties/:id', 'showProperty'],
    ['POST', '/properties/:id/units', 'createUnit'],
    ['GET', '/units/:id', 'showUnit'],
    ['POST', '/units/:id/settings', 'updateUnit'],
    ['POST', '/units/:id/new-code', 'newCode'],
    ['POST', '/leases/:id/record-payment', 'recordPayment'],
    ['POST', '/leases/:id/end', 'endLease'],
    ['POST', '/join', 'join'],
    ['GET', '/leases/:id/pay', 'payForm'],
    ['POST', '/leases/:id/pay', 'pay'],
    ['GET', '/payments', 'payments'],
    ['GET', '/receipts/:id', 'receipt'],
  ].map(([method, pattern, name]) => ({
    method,
    regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)')}$`),
    handler: handlers[name],
  }));

  // Login and signup don't need a CSRF token: there is no session to forge yet.
  const CSRF_EXEMPT = new Set(['/login', '/signup']);

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const session = auth.findSession(store, auth.parseCookies(req.headers.cookie).sid);
    const ctx = { req, res, url, session, user: session ? userById(session.userId) : null, params: {}, body: {} };

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');

    try {
      const route = table.find((r) => r.method === req.method && r.regex.test(url.pathname));
      if (!route) throw new HttpError(404, 'Page not found.');
      ctx.params = url.pathname.match(route.regex).groups || {};

      if (req.method === 'POST') {
        ctx.body = await readBody(req);
        if (!CSRF_EXEMPT.has(url.pathname) && !(session && auth.safeEqual(ctx.body._csrf, session.csrf))) {
          throw new HttpError(403, 'Your session has expired. Please go back, refresh the page and try again.');
        }
      }

      const result = await route.handler(ctx);
      if (result && result.redirect) {
        store.save();
        res.writeHead(303, { Location: result.redirect, ...result.headers });
        res.end();
      }
    } catch (err) {
      if (err && err.redirect) {
        res.writeHead(303, { Location: err.redirect });
        return res.end();
      }
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      render(ctx, `Error ${status}`, views.errorPage(status, status === 500 ? 'Something went wrong.' : err.message), status);
    }
  };
}

module.exports = { createApp, parseAmount };
