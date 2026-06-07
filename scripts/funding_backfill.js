const axios = require('axios');
const Database = require('better-sqlite3');
const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const stmt = db.prepare(`INSERT OR IGNORE INTO funding_oi_history (ts, symbol, funding, oi, price, funding_signal, oi_signal) VALUES (?, ?, ?, NULL, NULL, 'backfill_funding', NULL)`);

async function backfillSymbol(symbol) {
  console.log(`Backfill ${symbol}...`);
  let total = 0;
  let nextEndTime = Date.now();
  const DAYS = 90;
  const cutoff = Date.now() - DAYS * 86400000;

  for (let page = 0; page < 30; page++) {
    if (nextEndTime < cutoff) break;
    try {
      const url = `https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=${symbol}&productType=USDT-FUTURES&pageSize=100&endTime=${nextEndTime}`;
      const r = await axios.get(url, { timeout: 8000 });
      const data = r.data?.data || [];
      if (data.length === 0) break;
      const tx = db.transaction((rows) => {
        for (const row of rows) stmt.run(parseInt(row.fundingTime), row.symbol, parseFloat(row.fundingRate));
      });
      tx(data);
      total += data.length;
      // Older endTime = oldest in page
      nextEndTime = parseInt(data[data.length-1].fundingTime) - 1;
      await new Promise(r => setTimeout(r, 250));
    } catch(e) { console.log('  page err:', e.message); break; }
  }
  console.log(`  ${symbol}: ${total} entries`);
  return total;
}

(async () => {
  let totalAll = 0;
  for (const s of SYMBOLS) totalAll += await backfillSymbol(s);
  console.log('Total funding entries imported:', totalAll);
  const res = db.prepare(`SELECT symbol, COUNT(*), datetime(MIN(ts)/1000,'unixepoch') AS oldest, datetime(MAX(ts)/1000,'unixepoch') AS newest FROM funding_oi_history GROUP BY symbol`).all();
  for (const r of res) console.log(' ', JSON.stringify(r));
  db.close();
})();
