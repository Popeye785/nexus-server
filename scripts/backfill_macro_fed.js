const Database = require('better-sqlite3');
const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db');

// Hardcoded High-Impact USA Macro-Events 2024-2026 (öffentlich bekannt)
// FOMC: alle 6 Wochen, CPI: monatlich 2. Mittwoch, NFP: 1. Freitag im Monat, PCE: letzter Freitag
const events = [
  // FOMC Meetings 2024
  ['2024-01-31', 'FOMC Statement', 'High'], ['2024-03-20', 'FOMC Statement', 'High'],
  ['2024-05-01', 'FOMC Statement', 'High'], ['2024-06-12', 'FOMC Statement', 'High'],
  ['2024-07-31', 'FOMC Statement', 'High'], ['2024-09-18', 'FOMC Statement', 'High'],
  ['2024-11-07', 'FOMC Statement', 'High'], ['2024-12-18', 'FOMC Statement', 'High'],
  // FOMC 2025
  ['2025-01-29', 'FOMC Statement', 'High'], ['2025-03-19', 'FOMC Statement', 'High'],
  ['2025-04-30', 'FOMC Statement', 'High'], ['2025-06-18', 'FOMC Statement', 'High'],
  ['2025-07-30', 'FOMC Statement', 'High'], ['2025-09-17', 'FOMC Statement', 'High'],
  ['2025-10-29', 'FOMC Statement', 'High'], ['2025-12-10', 'FOMC Statement', 'High'],
  // FOMC 2026
  ['2026-01-28', 'FOMC Statement', 'High'], ['2026-03-18', 'FOMC Statement', 'High'],
  ['2026-04-29', 'FOMC Statement', 'High'],
  // CPI 2024
  ['2024-01-11', 'CPI m/m', 'High'], ['2024-02-13', 'CPI m/m', 'High'],
  ['2024-03-12', 'CPI m/m', 'High'], ['2024-04-10', 'CPI m/m', 'High'],
  ['2024-05-15', 'CPI m/m', 'High'], ['2024-06-12', 'CPI m/m', 'High'],
  ['2024-07-11', 'CPI m/m', 'High'], ['2024-08-14', 'CPI m/m', 'High'],
  ['2024-09-11', 'CPI m/m', 'High'], ['2024-10-10', 'CPI m/m', 'High'],
  ['2024-11-13', 'CPI m/m', 'High'], ['2024-12-11', 'CPI m/m', 'High'],
  // CPI 2025
  ['2025-01-15', 'CPI m/m', 'High'], ['2025-02-12', 'CPI m/m', 'High'],
  ['2025-03-12', 'CPI m/m', 'High'], ['2025-04-10', 'CPI m/m', 'High'],
  ['2025-05-13', 'CPI m/m', 'High'], ['2025-06-11', 'CPI m/m', 'High'],
  ['2025-07-15', 'CPI m/m', 'High'], ['2025-08-12', 'CPI m/m', 'High'],
  ['2025-09-11', 'CPI m/m', 'High'], ['2025-10-15', 'CPI m/m', 'High'],
  ['2025-11-13', 'CPI m/m', 'High'], ['2025-12-10', 'CPI m/m', 'High'],
  // CPI 2026
  ['2026-01-15', 'CPI m/m', 'High'], ['2026-02-13', 'CPI m/m', 'High'],
  ['2026-03-12', 'CPI m/m', 'High'], ['2026-04-10', 'CPI m/m', 'High'],
  ['2026-05-13', 'CPI m/m', 'High'],
  // NFP (Non-Farm Payrolls) - 1. Freitag
  ['2024-01-05', 'Non-Farm Employment Change', 'High'], ['2024-02-02', 'Non-Farm Employment Change', 'High'],
  ['2024-03-08', 'Non-Farm Employment Change', 'High'], ['2024-04-05', 'Non-Farm Employment Change', 'High'],
  ['2024-05-03', 'Non-Farm Employment Change', 'High'], ['2024-06-07', 'Non-Farm Employment Change', 'High'],
  ['2024-07-05', 'Non-Farm Employment Change', 'High'], ['2024-08-02', 'Non-Farm Employment Change', 'High'],
  ['2024-09-06', 'Non-Farm Employment Change', 'High'], ['2024-10-04', 'Non-Farm Employment Change', 'High'],
  ['2024-11-01', 'Non-Farm Employment Change', 'High'], ['2024-12-06', 'Non-Farm Employment Change', 'High'],
  ['2025-01-10', 'Non-Farm Employment Change', 'High'], ['2025-02-07', 'Non-Farm Employment Change', 'High'],
  ['2025-03-07', 'Non-Farm Employment Change', 'High'], ['2025-04-04', 'Non-Farm Employment Change', 'High'],
  ['2025-05-02', 'Non-Farm Employment Change', 'High'], ['2025-06-06', 'Non-Farm Employment Change', 'High'],
  ['2025-07-03', 'Non-Farm Employment Change', 'High'], ['2025-08-01', 'Non-Farm Employment Change', 'High'],
  ['2025-09-05', 'Non-Farm Employment Change', 'High'], ['2025-10-03', 'Non-Farm Employment Change', 'High'],
  ['2025-11-07', 'Non-Farm Employment Change', 'High'], ['2025-12-05', 'Non-Farm Employment Change', 'High'],
  ['2026-01-09', 'Non-Farm Employment Change', 'High'], ['2026-02-06', 'Non-Farm Employment Change', 'High'],
  ['2026-03-06', 'Non-Farm Employment Change', 'High'], ['2026-04-03', 'Non-Farm Employment Change', 'High'],
  ['2026-05-01', 'Non-Farm Employment Change', 'High'],
];

const stmt = db.prepare(`INSERT INTO macro_events (ts, event_date, title, impact, forecast, previous, actual) VALUES (?, ?, ?, ?, '', '', '')`);
let imported = 0;
const tx = db.transaction((rows) => {
  for (const [date, title, impact] of rows) {
    const ts = Date.now();
    const eventTs = new Date(date + 'T14:00:00Z').getTime();
    stmt.run(ts, eventTs, title, impact);
    imported++;
  }
});
tx(events);
console.log('Imported:', imported);
const stats = db.prepare(`SELECT title, COUNT(*) FROM macro_events GROUP BY title ORDER BY 2 DESC`).all();
for (const s of stats) console.log(' ', s.title, s.COUNT);
db.close();
