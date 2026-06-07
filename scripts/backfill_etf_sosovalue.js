// Backfill ETF-Flows via SoSoValue API (bereit für Key)
// AUDFIX_ETF_V2 [2026-05-18]
// 
// USAGE:
//   1. Christian registriert auf https://sosovalue.com/developer
//   2. Demo-Key in .env eintragen: SOSOVALUE_API_KEY=<key>
//   3. Script ausführen: node scripts/backfill_etf_sosovalue.js
//
// Free-Plan: 20 calls/min — 500 Tage in ~30 Min

const axios = require('axios');
const Database = require('better-sqlite3');
require('dotenv').config({ path: '/Users/christianheilig/NEXUS_CLEAN/.env' });

const API_KEY = process.env.SOSOVALUE_API_KEY;
if (!API_KEY) {
  console.error('FEHLER: SOSOVALUE_API_KEY nicht in .env gefunden.');
  console.error('Registriere auf https://sosovalue.com/developer, dann SOSOVALUE_API_KEY=<key> in .env.');
  process.exit(1);
}

const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db');

(async () => {
  console.log('Fetching SoSoValue historical ETF flows...');
  try {
    const r = await axios.get('https://api.sosovalue.com/openapi/v2/etf/historicalInflowChart', {
      params: { type: 'us-btc-spot' },
      headers: { 'x-soso-api-key': API_KEY },
      timeout: 30000,
    });
    const data = r.data?.data || [];
    console.log('Records:', data.length);
    const stmt = db.prepare(`INSERT INTO etf_flows (ts, net_flow_usd, source, flow_date) VALUES (?, ?, ?, ?)
      ON CONFLICT(flow_date) DO UPDATE SET net_flow_usd=excluded.net_flow_usd, source=excluded.source`);
    let imported = 0;
    const tx = db.transaction((rows) => {
      for (const row of rows) {
        const dateStr = row.date || row.tradeDate;
        const flow = parseFloat(row.totalNetInflow || row.flow || 0);
        if (!dateStr || !Number.isFinite(flow)) continue;
        const ts = new Date(dateStr + 'T00:00:00Z').getTime();
        stmt.run(ts, flow, 'sosovalue', dateStr);
        imported++;
      }
    });
    tx(data);
    console.log('Imported:', imported);
  } catch(e) {
    console.error('API error:', e.response?.status, e.message);
  }
  db.close();
})();
