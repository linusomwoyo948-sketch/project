'use strict';

// Payment providers. The app ships with a *simulated* provider so you can try the
// whole flow without real money moving. To take real payments, add a provider here
// with the same `charge()` shape, for example:
//   - M-Pesa: Safaricom Daraja "STK Push" (Lipa na M-Pesa Online)
//   - Cards:  Stripe Checkout / Flutterwave / Paystack
// and select it with the PAYMENT_PROVIDER environment variable.

const crypto = require('node:crypto');

const METHODS = {
  mpesa: 'M-Pesa',
  card: 'Debit / credit card',
  bank: 'Bank transfer',
  cash: 'Cash (recorded by landlord)',
};

function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[\s-]/g, '');
  if (/^\+?254[17]\d{8}$/.test(digits)) return digits.replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  return null;
}

const simulated = {
  name: 'simulated',
  async charge({ method, phone, bankReference }) {
    if (method === 'mpesa') {
      const msisdn = normalisePhone(phone);
      if (!msisdn) return { ok: false, error: 'Enter a valid M-Pesa phone number, e.g. 0712 345 678.' };
      return { ok: true, reference: `SIM${randomRef()}`, payerPhone: msisdn };
    }
    if (method === 'card') return { ok: true, reference: `CARD-${randomRef()}` };
    if (method === 'bank') {
      const ref = String(bankReference || '').trim();
      if (ref.length < 4) return { ok: false, error: 'Enter the reference from your bank transfer.' };
      return { ok: true, reference: ref.slice(0, 40) };
    }
    return { ok: false, error: 'Choose a payment method.' };
  },
};

function randomRef() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

const providers = { simulated };

function getProvider(name = process.env.PAYMENT_PROVIDER || 'simulated') {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
  return provider;
}

module.exports = { METHODS, getProvider, normalisePhone };
