#!/usr/bin/env node
// nexus_dbq.js — read-only DB-Check via better-sqlite3 (gleiche SQLite-Familie wie Bot)
// Nutzung: node nexus_dbq.js <db> [quick_check|version]
const Database = require('better-sqlite3');
const dbPath = process.argv[2];
const mode = process.argv[3] || 'quick_check';
if (!dbPath) { console.error('usage: nexus_dbq.js <db> [quick_check|version]'); process.exit(2); }
let db;
try { db = new Database(dbPath, { readonly: true, fileMustExist: true }); }
catch (e) { console.error('open failed: ' + e.message); process.exit(2); }
try { db.pragma('busy_timeout = 10000'); } catch (_) {}
try {
  if (mode === 'version') { console.log(db.prepare('select sqlite_version() v').get().v); db.close(); process.exit(0); }
  const qc = db.prepare('PRAGMA quick_check').get().quick_check;
  const v  = db.prepare('select sqlite_version() v').get().v;
  db.close();
  console.log(qc);
  console.error('sqlite ' + v);
  process.exit(qc === 'ok' ? 0 : 1);
} catch (e) { try { db.close(); } catch (_) {} console.error('check failed: ' + e.message); process.exit(1); }
