#!/usr/bin/env node
// nexus_dbset.js — gezielter Write via better-sqlite3 (3.51.3). Nur fuer Restore-Cycle-Reset (Bot gestoppt).
// Nutzung: node nexus_dbset.js <db> <key> <value>
const Database = require('better-sqlite3');
const [,, dbPath, key, value] = process.argv;
if (!dbPath || !key || value === undefined) { console.error('usage: nexus_dbset.js <db> <key> <value>'); process.exit(2); }
let db; try { db = new Database(dbPath, { fileMustExist: true }); } catch (e) { console.error('open failed: '+e.message); process.exit(2); }
db.pragma('busy_timeout = 10000');
const r = db.prepare('UPDATE bot_settings SET value=? WHERE key=?').run(String(value), key);
db.close();
console.error('write via sqlite 3.51.3, rows=' + r.changes);
process.exit(r.changes === 1 ? 0 : 1);
