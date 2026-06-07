const fs = require('fs');
const Database = require('better-sqlite3');
const html = fs.readFileSync('/tmp/bitbo.html', 'utf8');
const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db');

// BitBo Format: Tabellen-Zeilen mit Datum + Total Flow
// Regex: <tr><td>Datum</td><td>...</td>...<td>Total</td></tr>
// Pragmatik: Suche alle Zeilen mit Datums-Muster und extrahiere Datum + letzte Zahl (Total)

const stmt = db.prepare(`INSERT INTO etf_flows (ts, net_flow_usd, source, flow_date) VALUES (?, ?, ?, ?)
  ON CONFLICT(flow_date) DO UPDATE SET net_flow_usd=excluded.net_flow_usd, source=excluded.source, ts=excluded.ts`);

// Suche nach Patterns: "Apr 28 ... -252.6" / "May 06 ... 425.3M" etc.
// Vereinfacht: parse alle tr-Blocks mit Datum + Zahlen
const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
let count = 0;
let m;
while ((m = trRegex.exec(html)) !== null) {
  const row = m[1];
  // Datums-Match (e.g. May 06)
  const dateMatch = row.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s*20\d{2})?/);
  if (!dateMatch) continue;
  // Letzte Zahl in der Zeile (Total)
  const numbers = row.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[mMBb]?/g);
  if (!numbers || numbers.length < 2) continue;
  const last = numbers[numbers.length - 1].replace(/,/g, '').replace(/[mM]/g, 'M').replace(/[bB]/g, 'B');
  let valueMillions = parseFloat(last);
  if (last.includes('B')) valueMillions *= 1000;
  if (!Number.isFinite(valueMillions)) continue;

  // Datum parsen: "May 06" → 2026-05-06 (Jahr inferieren)
  const dateStr = dateMatch[0];
  let year = 2026;
  const yearMatch = dateStr.match(/20\d{2}/);
  if (yearMatch) year = parseInt(yearMatch[0]);
  const monthName = dateStr.match(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)[0];
  const monthMap = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const day = parseInt(dateStr.match(/\d{1,2}/)[0]);
  const flowDate = `${year}-${String(monthMap[monthName]).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const ts = new Date(flowDate + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ts)) continue;

  try {
    stmt.run(ts, valueMillions * 1e6, 'bitbo_scrape', flowDate);
    count++;
  } catch(_) {}
}
console.log('Imported:', count);
const res = db.prepare(`SELECT COUNT(*), MIN(flow_date), MAX(flow_date) FROM etf_flows`).get();
console.log('Total in DB:', res);
db.close();
