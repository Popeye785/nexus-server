const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db');
const DIR = '/tmp/binance_metrics';
const stmt = db.prepare(`INSERT OR IGNORE INTO binance_metrics_history (ts, symbol, sum_open_interest, sum_open_interest_value, count_toptrader_long_short_ratio, sum_toptrader_long_short_ratio, count_long_short_ratio, sum_taker_long_short_vol_ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.zip'));
console.log('Files:', files.length);
let totalRows = 0;
for (const file of files) {
  try {
    const csv = execSync(`/usr/bin/unzip -p "${path.join(DIR, file)}"`, { encoding: 'utf8' });
    const lines = csv.split('\n').slice(1).filter(l => l.trim()); // skip header
    const tx = db.transaction((rows) => {
      for (const line of rows) {
        const c = line.split(',');
        if (c.length < 8) continue;
        const ts = new Date(c[0].replace(' ', 'T') + 'Z').getTime();
        if (!Number.isFinite(ts)) continue;
        stmt.run(ts, c[1].trim(), parseFloat(c[2]), parseFloat(c[3]), parseFloat(c[4]), parseFloat(c[5]), parseFloat(c[6]), parseFloat(c[7]));
      }
    });
    tx(lines);
    totalRows += lines.length;
  } catch(e) { /* skip bad files */ }
}
console.log('Imported rows:', totalRows);

const stats = db.prepare(`SELECT symbol, COUNT(*) AS c, datetime(MIN(ts)/1000,'unixepoch') AS oldest, datetime(MAX(ts)/1000,'unixepoch') AS newest FROM binance_metrics_history GROUP BY symbol`).all();
for (const s of stats) console.log(' ', s.symbol, s.c, s.oldest, '→', s.newest);
db.close();
