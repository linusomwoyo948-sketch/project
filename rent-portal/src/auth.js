'use strict';

const crypto = require('node:crypto');

const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(store, userId) {
  return store.insert('sessions', {
    token: crypto.randomBytes(32).toString('hex'),
    csrf: crypto.randomBytes(16).toString('hex'),
    userId,
    flash: null,
    expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function findSession(store, token) {
  if (!token) return null;
  const session = store.find('sessions', (s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    store.remove('sessions', (s) => s.token === token);
    return null;
  }
  return session;
}

function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 24 * 60 * 60 : 0;
  return `sid=${token || ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { hashPassword, verifyPassword, parseCookies, createSession, findSession, sessionCookie, safeEqual };
