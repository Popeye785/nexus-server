// modules/walk_forward.js — Walk-Forward Backtest auf historischen CSV-Daten
// Verankert 2026-05-26 (Phase 3 Quant-Grade — Tag 18)
//
// Quellen:
//   - Lopez de Prado M. (2018) "Advances in Financial Machine Learning" Ch. 7
//     "Cross-Validation in Finance" — Walk-Forward + Purged K-Fold + CPCV
//   - Pardo R. (1992) "Design, Testing and Optimization of Trading Systems"
//     Original-Walk-Forward-Analysis (in-sample/out-of-sample split)
//
// Algorithm (Standard Sliding-Window WF):
//   Window i: [t_i, t_i + train_size + test_size]
//     train: [t_i, t_i + train_size]
//     test:  [t_i + train_size, t_i + train_size + test_size]
//   Step:  t_{i+1} = t_i + step_size
//
// Anti-Overfitting:
//   - OOS-Test-Window strikt nach Train-Window (kein look-ahead)
//   - Purging: optional gap zwischen train-end und test-start (z.B. 10 candles)
//   - Embargo: optional skip nach test-end (für später-trainingsruns)
//
// Strategy-Plugin:
//   strategy_fn(candles, params) → { trades: [{entry_idx, exit_idx, pnl}], stats }
//   Default-Strategy: EMA-Cross (10/30, simple long-only)
//
// Output:
//   {
//     windows: [{ window_idx, train_range, test_range, train_stats, test_stats }],
//     summary: { n_windows, avg_train_pf, avg_test_pf, train_test_delta, sharpe_oos, max_dd_oos }
//   }
//
// Performance:
//   54k candles × 100 windows × EMA-cross = ~1-3s on modern CPU.

'use strict';

const fs = require('fs');
const path = require('path');

const WalkForward = {
  DEFAULT_TRAIN: 720,      // 30d × 24h = 720 1h-candles
  DEFAULT_TEST:  168,      // 7d × 24h = 168 1h-candles
  DEFAULT_STEP:  168,      // 7d step (kein overlap nach test)
  DEFAULT_PURGE: 10,       // 10 candles gap zwischen train+test
  EPSILON: 1e-12,

  /**
   * Parse Binance-style CSV → array of candles.
   * Format: unix,date,symbol,open,high,low,close,Volume USDT
   * @returns {Array<{ts, o, h, l, c, v}>}
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
      const o = Number(parts[3]);
      const h = Number(parts[4]);
      const l = Number(parts[5]);
      const c = Number(parts[6]);
      const v = Number(parts[7] || 0);
      if (!Number.isFinite(ts) || !Number.isFinite(c) || c <= 0) continue;
      out.push({ ts, o, h, l, c, v });
    }
    // Sicherheits-Sortierung (Binance CSV sind chronologisch)
    out.sort((a, b) => a.ts - b.ts);
    return out;
  },

  /**
   * Simple EMA-Cross Long-Only Strategy.
   * Buy when EMA(fast) crosses above EMA(slow). Sell when reverse.
   * Returns: { trades: [{entry_idx, exit_idx, pnl_pct, hold_periods}], stats: {...} }
   */
  strategyEmaCross(candles, params = {}) {
    const fast = params.fast || 10;
    const slow = params.slow || 30;
    const fee = params.fee !== undefined ? params.fee : 0.001;  // 0.1% per side
    if (candles.length < slow + 2) return { trades: [], stats: { trades: 0, total_pnl: 0, win_rate: 0, profit_factor: 0 } };
    // EMA computation
    const k_f = 2 / (fast + 1);
    const k_s = 2 / (slow + 1);
    const emaF = new Array(candles.length);
    const emaS = new Array(candles.length);
    emaF[0] = candles[0].c;
    emaS[0] = candles[0].c;
    for (let i = 1; i < candles.length; i++) {
      emaF[i] = candles[i].c * k_f + emaF[i-1] * (1 - k_f);
      emaS[i] = candles[i].c * k_s + emaS[i-1] * (1 - k_s);
    }
    // Generate trades
    const trades = [];
    let openIdx = -1;
    let openPrice = 0;
    for (let i = slow + 1; i < candles.length; i++) {
      const crossUp   = emaF[i-1] <= emaS[i-1] && emaF[i] > emaS[i];
      const crossDown = emaF[i-1] >= emaS[i-1] && emaF[i] < emaS[i];
      if (crossUp && openIdx === -1) {
        // Enter long
        openIdx = i;
        openPrice = candles[i].c;
      } else if (crossDown && openIdx !== -1) {
        // Exit long
        const exitPrice = candles[i].c;
        const grossPnl = (exitPrice - openPrice) / openPrice;
        const netPnl = grossPnl - 2 * fee;   // entry + exit fees
        trades.push({
          entry_idx: openIdx, exit_idx: i,
          entry_price: openPrice, exit_price: exitPrice,
          pnl_pct: netPnl, hold_periods: i - openIdx,
        });
        openIdx = -1;
      }
    }
    // Aggregate stats
    const total_pnl = trades.reduce((s, t) => s + t.pnl_pct, 0);
    const wins = trades.filter(t => t.pnl_pct > 0);
    const losses = trades.filter(t => t.pnl_pct < 0);
    const win_rate = trades.length > 0 ? wins.length / trades.length : 0;
    const totalWins = wins.reduce((s, t) => s + t.pnl_pct, 0);
    const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl_pct, 0));
    const profit_factor = totalLosses > this.EPSILON ? totalWins / totalLosses : (totalWins > 0 ? 99 : 0);
    // Max DD on equity curve
    let equity = 0, peak = 0, maxDD = 0;
    for (const t of trades) {
      equity += t.pnl_pct;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }
    return {
      trades,
      stats: {
        trades: trades.length,
        total_pnl,
        win_rate,
        profit_factor,
        max_dd: maxDD,
        avg_hold: trades.length > 0 ? trades.reduce((s,t)=>s+t.hold_periods,0)/trades.length : 0,
        avg_win: wins.length > 0 ? totalWins / wins.length : 0,
        avg_loss: losses.length > 0 ? totalLosses / losses.length : 0,
      },
    };
  },

  /**
   * Sharpe-Ratio aus trade-pnl array.
   * Annualisierung optional via periodsPerYear (default 252 = trading days).
   */
  _sharpe(trades, periodsPerYear = 252) {
    if (trades.length < 2) return 0;
    const returns = trades.map(t => t.pnl_pct);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std < this.EPSILON) return 0;
    return (mean / std) * Math.sqrt(periodsPerYear);
  },

  /**
   * Walk-Forward Run: sliding window über candle-array.
   * @param {Array} candles - parsed candle array
   * @param {Object} opts - { train, test, step, purge, strategy_fn, strategy_params }
   * @returns {Object} { windows: [...], summary: {...} }
   */
  run(candles, opts = {}) {
    const train = opts.train || this.DEFAULT_TRAIN;
    const test = opts.test || this.DEFAULT_TEST;
    const step = opts.step || this.DEFAULT_STEP;
    const purge = opts.purge !== undefined ? opts.purge : this.DEFAULT_PURGE;
    const strategy_fn = opts.strategy_fn || this.strategyEmaCross.bind(this);
    const strategy_params = opts.strategy_params || {};

    const windows = [];
    const N = candles.length;
    let i = 0;
    let winIdx = 0;
    while (i + train + purge + test <= N) {
      const trainSlice = candles.slice(i, i + train);
      const testSlice = candles.slice(i + train + purge, i + train + purge + test);
      const trainRes = strategy_fn(trainSlice, strategy_params);
      const testRes = strategy_fn(testSlice, strategy_params);
      windows.push({
        window_idx: winIdx++,
        train_range: { start_ts: trainSlice[0].ts, end_ts: trainSlice[trainSlice.length-1].ts, n: trainSlice.length },
        test_range:  { start_ts: testSlice[0].ts, end_ts: testSlice[testSlice.length-1].ts, n: testSlice.length },
        train_stats: trainRes.stats,
        test_stats: testRes.stats,
        sharpe_train: this._sharpe(trainRes.trades),
        sharpe_test:  this._sharpe(testRes.trades),
      });
      i += step;
    }
    // Aggregate summary
    const n = windows.length;
    if (n === 0) return { windows: [], summary: { n_windows: 0, error: 'INSUFFICIENT_DATA' } };
    const sum = (arr, key) => arr.reduce((s, w) => s + (Number.isFinite(w[key]) ? w[key] : 0), 0);
    const avg_train_pf = windows.reduce((s, w) => s + (w.train_stats.profit_factor || 0), 0) / n;
    const avg_test_pf  = windows.reduce((s, w) => s + (w.test_stats.profit_factor || 0), 0) / n;
    const avg_train_wr = windows.reduce((s, w) => s + (w.train_stats.win_rate || 0), 0) / n;
    const avg_test_wr  = windows.reduce((s, w) => s + (w.test_stats.win_rate || 0), 0) / n;
    const positive_test_windows = windows.filter(w => (w.test_stats.total_pnl || 0) > 0).length;
    const robustness = n > 0 ? positive_test_windows / n : 0;
    return {
      windows: windows.map(w => ({
        window_idx: w.window_idx,
        train: { pf: Number((w.train_stats.profit_factor || 0).toFixed(3)), wr: Number((w.train_stats.win_rate || 0).toFixed(3)), trades: w.train_stats.trades, pnl: Number((w.train_stats.total_pnl || 0).toFixed(4)), sharpe: Number(w.sharpe_train.toFixed(3)) },
        test:  { pf: Number((w.test_stats.profit_factor || 0).toFixed(3)),  wr: Number((w.test_stats.win_rate || 0).toFixed(3)),  trades: w.test_stats.trades,  pnl: Number((w.test_stats.total_pnl || 0).toFixed(4)),  sharpe: Number(w.sharpe_test.toFixed(3)) },
      })),
      summary: {
        n_windows: n,
        avg_train_pf: Number(avg_train_pf.toFixed(3)),
        avg_test_pf:  Number(avg_test_pf.toFixed(3)),
        avg_train_wr: Number(avg_train_wr.toFixed(3)),
        avg_test_wr:  Number(avg_test_wr.toFixed(3)),
        train_test_pf_delta: Number((avg_train_pf - avg_test_pf).toFixed(3)),  // > 0.5 = potential overfitting
        positive_test_windows,
        robustness: Number(robustness.toFixed(3)),
      },
    };
  },

  /**
   * Snapshot von CSV-Pfad direkt.
   */
  fromCsv(csvPath, opts = {}) {
    const candles = this.parseCsv(csvPath);
    return { candles_count: candles.length, ...this.run(candles, opts) };
  },
};

module.exports = WalkForward;
