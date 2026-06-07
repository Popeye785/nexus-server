// modules/black_swan_replay.js — Black-Swan-Replay Stress-Test
// Verankert 2026-05-26 (Phase 4 Validation — Tag 22+)
//
// Konzept:
//   Lade historische Crash-Periode (z.B. 15.03.2020 BTC: -50% in 24h via "Black Thursday")
//   und replay sie gegen aktuelle Strategy + Risk-Management.
//   Misst: Max-Drawdown, Slippage, Liquidations, Survivor-Rate, Recovery-Time.
//
// Bekannte Crash-Events (in Binance CSV verfügbar):
//   - 2020-03-12 BTC -50% in 24h (COVID-Panic)
//   - 2022-05-11 LUNA-Collapse → BTC -25%
//   - 2022-11-08 FTX-Implosion → BTC -25%
//   - 2024-08-05 Yen-Carry-Unwind → BTC -15% in 4h
//
// API:
//   BlackSwanReplay.run(csvPath, crashStartTs, crashEndTs, startEquity, opts) → metrics
//   BlackSwanReplay.knownCrashes → list of pre-defined events

'use strict';

const fs = require('fs');

const BlackSwanReplay = {
  knownCrashes: [
    { name: 'COVID-Black-Thursday', start: '2020-03-12 00:00', end: '2020-03-13 23:00', description: 'BTC -50% in 24h' },
    { name: 'LUNA-Collapse',        start: '2022-05-09 00:00', end: '2022-05-14 23:00', description: 'BTC -25% on UST depeg' },
    { name: 'FTX-Implosion',         start: '2022-11-07 00:00', end: '2022-11-10 23:00', description: 'BTC -25% FTX bankruptcy' },
    { name: 'Yen-Carry-Unwind',      start: '2024-08-05 00:00', end: '2024-08-06 23:00', description: 'BTC -15% in 4h' },
  ],

  /**
   * Parse Binance CSV (Reuse aus walk_forward.js Pattern).
   */
  parseCsv(csvPath) {
    if (!fs.existsSync(csvPath)) throw new Error('CSV not found: ' + csvPath);
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < 7) continue;
      const ts = Number(parts[0]);
      const c = Number(parts[6]);
      const h = Number(parts[4]);
      const l = Number(parts[5]);
      if (!Number.isFinite(ts) || !Number.isFinite(c) || c <= 0) continue;
      out.push({ ts, h, l, c });
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  },

  /**
   * Find candles within [startTs, endTs] inclusive.
   */
  slice(candles, startTs, endTs) {
    return candles.filter(c => c.ts >= startTs && c.ts <= endTs);
  },

  /**
   * Simulate position-holding through crash with risk-management.
   * @param {Array} candles - crash-period candles
   * @param {Object} opts - { entryPrice, positionSize, stopLossPct, takeProfitPct, leverage }
   * @returns {Object} { exit_reason, exit_price, max_dd_pct, max_loss_usdt, hold_duration }
   */
  simulatePosition(candles, opts = {}) {
    const entry = opts.entryPrice || candles[0].c;
    const size = opts.positionSize || 1000;     // USDT
    const slPct = opts.stopLossPct || 0.05;     // 5% SL
    const tpPct = opts.takeProfitPct || 0.10;   // 10% TP
    const lev = opts.leverage || 1;
    const slTrigger = entry * (1 - slPct);
    const tpTrigger = entry * (1 + tpPct);
    const liqTrigger = entry * (1 - 1/lev * 0.95);  // ~95% loss with leverage
    let maxDD = 0;
    let exit_reason = 'SURVIVED';
    let exit_price = entry;
    let hold_idx = candles.length;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      // Track max-drawdown via intra-bar low
      const dd = (entry - c.l) / entry;
      if (dd > maxDD) maxDD = dd;
      // Check liquidation (most extreme first)
      if (c.l <= liqTrigger) { exit_reason = 'LIQUIDATED'; exit_price = liqTrigger; hold_idx = i; break; }
      if (c.l <= slTrigger)  { exit_reason = 'STOP_LOSS'; exit_price = slTrigger; hold_idx = i; break; }
      if (c.h >= tpTrigger)  { exit_reason = 'TAKE_PROFIT'; exit_price = tpTrigger; hold_idx = i; break; }
    }
    if (exit_reason === 'SURVIVED') {
      exit_price = candles[candles.length - 1].c;
    }
    const finalPnlPct = (exit_price - entry) / entry * lev;
    const finalPnlUsdt = size * finalPnlPct;
    const maxLossUsdt = size * maxDD * lev;
    return {
      exit_reason, exit_price, entry_price: entry,
      max_dd_pct: Number((maxDD * 100).toFixed(2)),
      max_loss_usdt: Number(maxLossUsdt.toFixed(2)),
      final_pnl_pct: Number((finalPnlPct * 100).toFixed(2)),
      final_pnl_usdt: Number(finalPnlUsdt.toFixed(2)),
      hold_periods: hold_idx,
      total_periods: candles.length,
    };
  },

  /**
   * Multi-Scenario Stress-Test: läuft 3 typische Positionen durch crash.
   * @param {string} csvPath
   * @param {Object} crashEvent - { name, start, end, description }
   * @returns {Object} { event, scenarios, summary }
   */
  runEvent(csvPath, crashEvent, opts = {}) {
    const candles = this.parseCsv(csvPath);
    const startTs = new Date(crashEvent.start + 'Z').getTime();
    const endTs = new Date(crashEvent.end + 'Z').getTime();
    const slice = this.slice(candles, startTs, endTs);
    if (slice.length === 0) return { error: 'NO_CANDLES_IN_RANGE', startTs, endTs, csv_first: candles[0]?.ts, csv_last: candles[candles.length-1]?.ts };

    const scenarios = {
      conservative: this.simulatePosition(slice, { entryPrice: slice[0].c, positionSize: 100, stopLossPct: 0.03, takeProfitPct: 0.10, leverage: 1 }),
      moderate:     this.simulatePosition(slice, { entryPrice: slice[0].c, positionSize: 100, stopLossPct: 0.05, takeProfitPct: 0.15, leverage: 1 }),
      aggressive:   this.simulatePosition(slice, { entryPrice: slice[0].c, positionSize: 100, stopLossPct: 0.10, takeProfitPct: 0.30, leverage: 2 }),
    };

    const priceAtStart = slice[0].c;
    const priceAtEnd = slice[slice.length - 1].c;
    const marketChangePct = (priceAtEnd - priceAtStart) / priceAtStart * 100;
    const lowestPrice = Math.min(...slice.map(c => c.l));
    const peakDrawdownPct = (priceAtStart - lowestPrice) / priceAtStart * 100;

    return {
      event: crashEvent,
      candles_in_event: slice.length,
      market: {
        price_start: priceAtStart,
        price_end: priceAtEnd,
        market_change_pct: Number(marketChangePct.toFixed(2)),
        peak_drawdown_pct: Number(peakDrawdownPct.toFixed(2)),
      },
      scenarios,
      summary: {
        conservative_survived: scenarios.conservative.exit_reason !== 'LIQUIDATED',
        aggressive_survived:   scenarios.aggressive.exit_reason !== 'LIQUIDATED',
        worst_drawdown: Math.max(...Object.values(scenarios).map(s => s.max_dd_pct)),
      },
    };
  },

  /**
   * Replay ALL known crashes for one symbol.
   */
  runAllKnown(csvPath, opts = {}) {
    const results = [];
    for (const ev of this.knownCrashes) {
      try {
        results.push(this.runEvent(csvPath, ev, opts));
      } catch(e) {
        results.push({ event: ev, error: e.message });
      }
    }
    return { csvPath, results, ts: Date.now() };
  },
};

module.exports = BlackSwanReplay;
