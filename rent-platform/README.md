# RentLink

A website that connects **landlords** and **tenants** for paying rent.

## What it does

**Landlords**
- Add properties (with currency: KES, UGX, TZS, NGN, ZAR, USD, EUR, GBP) and units with a monthly rent.
- Add a tenant to a unit by email. If the tenant has no account yet, the invite waits and links automatically when they sign up with that email.
- A rent bill is created automatically every month for each tenancy, from the start date onward.
- Dashboard: occupancy, collected this month vs. expected, outstanding balance, overdue bills.
- Confirm or reject bank transfers and cash payments; end a tenancy.

**Tenants**
- See their rental, landlord contacts, and what they owe.
- Pay any bill in full or in parts by M-Pesa, card, bank transfer, or cash.
- Full payment history with printable receipts (Print / save as PDF).

**Both** see the same receipt for every payment, so there are no disputes about who paid what.

## Run it

Requires Node.js 22.5 or newer (it uses Node's built-in SQLite, so there's no database to install).

```bash
cd rent-platform
npm install
npm start          # http://localhost:3000
npm test           # API tests
```

Environment variables:

| Variable   | Default   | Purpose                                   |
|------------|-----------|-------------------------------------------|
| `PORT`     | `3000`    | HTTP port                                 |
| `DB_FILE`  | `rent.db` | SQLite database file                      |
| `NODE_ENV` |           | Set to `production` to send `Secure` cookies (needs HTTPS) |

## About payments (important)

Payments are **simulated** so the whole flow works out of the box:
- M-Pesa and card payments succeed straight away and get a generated reference.
- Bank transfer and cash payments stay *pending* until the landlord confirms them.

To take real money, replace `processPayment()` in `src/billing.js` with a real provider, for example
Safaricom **M-Pesa Daraja** (STK Push + a callback route that marks the payment completed) or **Stripe / Flutterwave / Paystack** for cards.
No card details are collected by this app.

## Project layout

```
src/server.js    Express app and all API routes
src/db.js        SQLite schema
src/auth.js      Password hashing (scrypt) and cookie sessions
src/billing.js   Monthly bill generation, bill status, payment stub
public/          Front end (plain HTML/CSS/JS, no build step)
test/            API tests (node:test)
```

Amounts are stored as whole currency units.
