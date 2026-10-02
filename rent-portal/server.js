'use strict';

const http = require('node:http');
const path = require('node:path');
const { Store } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

const store = new Store(DATA_FILE);
const app = createApp({ store, secureCookies: process.env.SECURE_COOKIES === '1' });

http.createServer(app).listen(PORT, () => {
  console.log(`RentLink running at http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
