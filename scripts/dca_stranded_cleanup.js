#!/usr/bin/env node
// scripts/dca_stranded_cleanup.js — DCA-Stranded-Cleanup (FIX 31, Tag 21)
//
// One-shot retroactive script: liquidiert 5 historische DCAs die VOR FIX 20 (Tag 13)
// als status='CLOSED' markiert wurden ohne Inventory-Liquidation.
// Stranded Capital: ~$730 (ETH/LTC/DOGE/AVAX/LINK).
//
// Vorgehen:
//   1. Identify candidates: status='CLOSED' (NICHT CLOSED_MANUAL/CLOSED_MAX_ITER/CLOSED_TP)
//      AND total_size > 0
//   2. Mark-to-Market via Bitget price-API
//   3. Compute realized_pnl = (currentPrice - avg_buy_price) * total_size - fees
//   4. Wallet apply via API call (POST /api/dca/liquidate-stranded oder direkter SQL)
//   5. Log + Audit trail
//
// USAGE:
//   DRY-RUN (default):  node scripts/dca_stranded_cleanup.js
//   EXECUTE:            node scripts/dca_stranded_cleanup.js --execute
//
// SAFETY:
//   - DRY-RUN ist default — zeigt was passieren würde ohne Änderung
//   - Backup-Pflicht vor --execute
//   - Bot soll laufen damit price-cache verfügbar ist

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const axios = require('axios');

const DRY_RUN = !process.argv.includes('--execute');
const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const FEE_RATE = 0.0006;  // Taker fee Bitget VIP-0

async function fetchPrice(symbol) {
  try {
    const url = `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`;
    const r = await axios.get(url, { timeout: 8000 });
    const d = r.data?.data;
    const t = Array.isArray(d) ? d[0] : d;
    return Number(t?.lastPr || t?.last || 0);
  } catch(e) {
    console.error(`  fetch ${symbol} err: ${e.message}`);
    return null;
  }
}

(async () => {
  console.log(`═══ DCA-Stranded-Cleanup ${DRY_RUN ? '(DRY-RUN)' : '🔴 EXECUTE'} ═══`);
  console.log(`  DB: ${DB_PATH}`);
  if (!fs.existsSync(DB_PATH)) { console.error('  DB not found'); process.exit(1); }
  const db = new Database(DB_PATH);
  const candidates = db.prepare(`
    SELECT dca_id, symbol, status, total_size, total_spent, avg_buy_price
    FROM dca_instances
    WHERE status = 'CLOSED'
      AND total_size > 0
      AND total_spent > 0
      AND avg_buy_price > 0
  `).all();
  console.log(`  Found ${candidates.length} stranded DCAs (status='CLOSED' + Inventory>0)`);
  let totalRealized = 0;
  const results = [];
  for (const c of candidates) {
    console.log(`  ─── ${c.dca_id} ${c.symbol}`);
    console.log(`      total_size=${c.total_size} total_spent=${c.total_spent} avg_buy=${c.avg_buy_price}`);
    const currentPrice = await fetchPrice(c.symbol);
    if (!currentPrice || currentPrice <= 0) {
      console.log(`      ❌ price fetch failed`);
      continue;
    }
    const grossPnl = (currentPrice - c.avg_buy_price) * c.total_size;
    const sellValue = currentPrice * c.total_size;
    const fees = (c.total_spent + sellValue) * FEE_RATE;
    const realizedPnl = grossPnl - fees;
    console.log(`      currentPrice=${currentPrice.toFixed(4)} grossPnl=${grossPnl.toFixed(2)} fees=${fees.toFixed(2)} realizedPnl=${realizedPnl.toFixed(2)}`);
    totalRealized += realizedPnl;
    results.push({ dca_id: c.dca_id, symbol: c.symbol, currentPrice, realizedPnl });

    if (!DRY_RUN) {
      // Update DCA status + ledger
      db.prepare(`UPDATE dca_instances SET status='CLOSED_RETRO_LIQ', meta=json_set(COALESCE(meta,'{}'), '$.retro_liquidation_at_price', ?, '$.retro_realized_pnl', ?), updated_at=?, closed_at=? WHERE dca_id=?`)
        .run(currentPrice, realizedPnl, Date.now(), Date.now(), c.dca_id);
      // Wallet ledger: PNL + (optional) PROFIT_SPLIT_RESERVE
      // Lese aktuelle wallet aus demo_wallet.json
      const walletPath = path.join(__dirname, '..', 'data', 'demo_wallet.json');
      const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
      const beforeTotal = wallet.total || 0;
      const beforeTrading = wallet.trading || 0;
      if (realizedPnl > 0) {
        const RR = 0.70;
        const toReserve = realizedPnl * RR;
        const toTrading = realizedPnl * (1 - RR);
        wallet.reserve = (wallet.reserve || 0) + toReserve;
        wallet.trading = (wallet.trading || 0) + toTrading;
      } else {
        wallet.trading = Math.max(0, (wallet.trading || 0) + realizedPnl);
      }
      wallet.total = (wallet.reserve || 0) + (wallet.trading || 0);
      wallet.pnl = (wallet.pnl || 0) + realizedPnl;
      wallet.updatedAt = Date.now();
      fs.writeFileSync(walletPath, JSON.stringify(wallet, null, 2));
      // Ledger entries
      db.prepare(`INSERT INTO wallet_ledger (ts, op, amount, reason, trade_id, before_trading, after_trading, before_total, after_total, mode) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(Date.now(), 'PNL', realizedPnl, 'DCA-stranded retro-liquidation', c.dca_id, beforeTrading, wallet.trading, beforeTotal, wallet.total, 'DEMO');
      if (realizedPnl > 0) {
        db.prepare(`INSERT INTO wallet_ledger (ts, op, amount, reason, trade_id, before_trading, after_trading, before_total, after_total, mode) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(Date.now(), 'PROFIT_SPLIT_RESERVE', realizedPnl * 0.70, 'auto-split-on-profit (DCA retro-liq)', c.dca_id, null, null, beforeTotal, wallet.total, 'DEMO');
      }
      console.log(`      ✅ EXECUTED: wallet ${beforeTotal.toFixed(2)} → ${wallet.total.toFixed(2)}`);
    }
  }
  console.log('');
  console.log(`═══ Total realized PnL: ${totalRealized.toFixed(2)} USDT ═══`);
  if (DRY_RUN) {
    console.log('  (DRY-RUN — keine Änderung. Use --execute zum apply)');
  }
  console.log(JSON.stringify(results, null, 2));
  db.close();
  process.exit(0);
})();
