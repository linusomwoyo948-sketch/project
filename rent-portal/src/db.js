'use strict';

// A tiny JSON-file data store. Every write is flushed to disk atomically
// (write to a temp file, then rename) so a crash never leaves a half-written file.
// Pass `null` as the file to keep everything in memory (used by the tests).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLLECTIONS = ['users', 'properties', 'units', 'leases', 'payments', 'sessions'];

class Store {
  constructor(file) {
    this.file = file;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    if (file && fs.existsSync(file)) {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) this.data[c] = loaded[c] || [];
    }
  }

  all(collection) {
    return this.data[collection];
  }

  find(collection, predicate) {
    return this.data[collection].find(predicate);
  }

  filter(collection, predicate) {
    return this.data[collection].filter(predicate);
  }

  get(collection, id) {
    return this.data[collection].find((row) => row.id === id);
  }

  insert(collection, row) {
    const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...row };
    this.data[collection].push(record);
    this.save();
    return record;
  }

  remove(collection, predicate) {
    this.data[collection] = this.data[collection].filter((row) => !predicate(row));
    this.save();
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
