# RentLink: rent payments between landlords and tenants

A small website where **landlords** list their rental units and **tenants** pay rent online.
Both sides see the same record of what is owed, what is paid, and the receipts.

## Features

**Landlords**
- Sign up and add properties and units (monthly rent and due day)
- Each vacant unit gets a **join code**, which you share with your tenant to link them to the unit
- Dashboard with money collected this month, total outstanding, occupancy, and a **rent roll**
  showing every tenant as *Paid up*, *Due*, or *Overdue*
- Per-unit monthly statement, payment history, and receipts
- Record cash or offline payments
- Change the rent from a chosen month onwards (earlier months keep the old rent)
- End a lease when a tenant moves out (the unit gets a fresh join code)

**Tenants**
- Sign up and join a unit with the landlord's code
- See monthly rent, current balance, due date, and a month-by-month statement
- Pay by **M-Pesa**, **card**, or **bank transfer** and get an instant, printable receipt
- Full payment history

## Run it

Requires Node.js 20 or later. There are no dependencies to install.

```bash
cd rent-portal
npm start          # http://localhost:3000
npm test           # run the test suite
```

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_FILE` | `./data/db.json` | Where data is saved |
| `CURRENCY` | `KES` | Currency code for amounts |
| `LOCALE` | `en-KE` | Number and date formatting |
| `SECURE_COOKIES` | unset | Set to `1` when serving over HTTPS |
| `PAYMENT_PROVIDER` | `simulated` | Payment backend (see below) |

## Payments: demo mode

Out of the box, payments are **simulated**: the flow, validation, and receipts all work,
but no real money moves. To accept real payments, add a provider in `src/payments.js`
with the same `charge()` function, for example:

- **M-Pesa** via Safaricom Daraja *STK Push* (Lipa na M-Pesa Online). The tenant gets a PIN prompt on their phone.
- **Cards** via Stripe, Flutterwave, or Paystack checkout

Then select it with `PAYMENT_PROVIDER`. Real providers confirm payments asynchronously
through a callback URL, so a production setup also needs a callback route that marks the
payment as complete.

## How it works

```
server.js          starts the HTTP server
src/app.js         routes, access control, and request handling
src/billing.js     rent maths: monthly charges, oldest-month-first allocation, status
src/payments.js    payment providers (simulated by default)
src/auth.js        password hashing (scrypt), sessions, cookies
src/db.js          JSON-file storage with atomic writes
src/views.js       HTML pages
public/styles.css  styling (mobile friendly, printable receipts)
```

Amounts are stored in cents. Rent is charged once per calendar month from the lease start
month to the current month. Payments are applied to the oldest unpaid month first.

Security basics are in place: hashed passwords, HttpOnly session cookies, CSRF tokens on
every form, HTML escaping, and checks so that landlords and tenants only see their own data.

## Before going live

- Connect a real payment provider (above) and serve the site over HTTPS
- Move from the JSON file to a database such as PostgreSQL or SQLite if you expect many users
- Add password reset, login rate limiting, and email or SMS rent reminders
