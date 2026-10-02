'use strict';

// Rent maths. Rent is charged once per calendar month ("period", written YYYY-MM)
// from the month the lease starts up to and including the current month.
// Payments are applied oldest-period-first, so the statement always shows which
// months are settled and which are still outstanding. Amounts are in cents.

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function isMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value));
}

function periodsBetween(start, end) {
  const out = [];
  for (let k = start; k <= end; k = addMonths(k, 1)) out.push(k);
  return out;
}

// rentHistory is a list of { from: 'YYYY-MM', amount } sorted by `from`.
function rentFor(rentHistory, period) {
  let amount = 0;
  for (const entry of rentHistory) if (entry.from <= period) amount = entry.amount;
  return amount;
}

// Record a rent change that applies from `from` onwards, replacing later changes.
function setRent(rentHistory, from, amount) {
  const kept = rentHistory.filter((e) => e.from < from);
  kept.push({ from, amount });
  return kept;
}

function statement(lease, payments, dueDay, today = new Date()) {
  const current = monthKey(today);
  const periods = lease.start <= current ? periodsBetween(lease.start, current) : [];
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  let pool = totalPaid;
  const rows = periods.map((period) => {
    const due = rentFor(lease.rentHistory, period);
    const paid = Math.min(pool, due);
    pool -= paid;
    return { period, due, paid, outstanding: due - paid };
  });

  const totalCharged = rows.reduce((sum, r) => sum + r.due, 0);
  const balance = totalCharged - totalPaid;

  let status;
  if (balance <= 0) {
    status = { code: 'paid', label: balance < 0 ? 'Paid up (in credit)' : 'Paid up' };
  } else {
    const firstUnpaid = rows.find((r) => r.outstanding > 0);
    const overdue = firstUnpaid.period < current || today.getDate() > dueDay;
    status = overdue ? { code: 'overdue', label: 'Overdue' } : { code: 'due', label: `Due on the ${ordinal(dueDay)}` };
  }

  return { rows, totalCharged, totalPaid, balance, status, currentRent: rentFor(lease.rentHistory, current) };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports = { monthKey, addMonths, isMonthKey, periodsBetween, rentFor, setRent, statement, ordinal };
