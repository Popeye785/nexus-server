const Database = require('better-sqlite3');
const src = process.argv[2], dest = process.argv[3];
if (!src || !dest) { process.stderr.write('usage: nexus_dbbackup.js <src> <dest>\n'); process.exit(2); }
const db = new Database(src, { fileMustExist: true });
db.pragma('busy_timeout = 10000');
db.backup(dest)
  .then(() => { db.close(); process.stdout.write('ok\n'); process.exit(0); })
  .catch((e) => { try { db.close(); } catch (_) {} process.stderr.write('backup_error: ' + e.message + '\n'); process.exit(1); });
