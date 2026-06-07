// modules/sortino_ratio.js — Sortino-Ratio (downside-deviation statt total-vol)
// Verankert 2026-05-26 (Phase 3 Quant-Grade — Tag 15)
//
// Quellen:
//   - Sortino F. & Price L. (1994) "Performance Measurement in a Downside Risk Framework"
//   - Lopez de Prado M. "Advances in Financial Machine Learning" (2018), Ch. 14
//   - Wikipedia Sortino-Ratio: https://en.wikipedia.org/wiki/Sortino_ratio
//
// Formel:
//   Sortino = (R - MAR) / sqrt(mean(min(r_i - MAR, 0)^2))
//     R   = mean return (period)
//     MAR = minimum acceptable return (typisch 0 oder risk-free rate)
//     r_i = period return
//   Nur NEGATIVE deviations zählen → asymmetric, besser als Sharpe für gewinnasymm. Strategien.
//
// Interpretation:
//   Sortino > 2.0  excellent (Quant-Grade)
//   Sortino > 1.0  acceptable
//   Sortino < 0    losing strategy
//
// Special Cases:
//   - keine Negative-Returns → Sortino = +Infinity (cap auf 99)
//   - n < 5 → return null (insufficient sample)

'use strict';

const SortinoRatio = {
  MAR_DEFAULT:    0,       // risk-free rate, typisch 0 für intraday crypto
  CAP_INFINITY:   99,      // cap statt Infinity wenn no negative returns
  MIN_SAMPLE:     5,

  /**
   * Compute Sortino-Ratio aus return-array.
   * @param {Array<number>} returns - period returns (e.g. daily PnL/equity)
   * @param {number} mar - minimum acceptable return (default 0)
   * @returns {Object} { sortino, n, mean, downsideStdDev, reason }
   */
  compute(returns, mar = null) {
    const MAR = (mar !== null && Number.isFinite(mar)) ? mar : this.MAR_DEFAULT;
    if (!Array.isArray(returns) || returns.length < this.MIN_SAMPLE) {
      return { sortino: null, n: (returns || []).length, mean: null, downsideStdDev: null, reason: 'SAMPLE_TOO_SMALL' };
    }
    const validReturns = returns.filter(r => Number.isFinite(r));
    if (validReturns.length < this.MIN_SAMPLE) {
      return { sortino: null, n: validReturns.length, mean: null, downsideStdDev: null, reason: 'INSUFFICIENT_VALID' };
    }
    const n = validReturns.length;
    const mean = validReturns.reduce((s, r) => s + r, 0) / n;
    // Downside deviation: nur negative excess returns
    const downsideSquares = validReturns.map(r => Math.min(r - MAR, 0) ** 2);
    const downsideVar = downsideSquares.reduce((s, x) => s + x, 0) / n;
    const downsideStdDev = Math.sqrt(downsideVar);
    if (downsideStdDev === 0) {
      // Keine negativen Returns → Sortino "perfekt" → cap
      return { sortino: this.CAP_INFINITY, n, mean, downsideStdDev: 0, reason: 'NO_DOWNSIDE' };
    }
    const sortino = (mean - MAR) / downsideStdDev;
    return { sortino, n, mean, downsideStdDev, reason: 'OK' };
  },

  /**
   * Snapshot aus closed trades.
   */
  fromTrades(trades) {
    const returns = (trades || []).map(t => Number(t?.realized_pnl)).filter(r => Number.isFinite(r));
    return { ...this.compute(returns), tradeCount: returns.length };
  },

  /**
   * Snapshot für UI/API.
   */
  snapshot(db) {
    if (!db) return { error: 'no db' };
    try {
      const rows = db.prepare("SELECT realized_pnl FROM trades WHERE state='CLOSED' AND realized_pnl IS NOT NULL ORDER BY closed_at ASC").all();
      const result = this.fromTrades(rows);
      result.timestamp = Date.now();
      return result;
    } catch(e) {
      return { error: e.message };
    }
  },

  /**
   * Helper: classification.
   */
  classify(sortino) {
    if (!Number.isFinite(sortino)) return 'INVALID';
    if (sortino >= 2.0) return 'EXCELLENT';
    if (sortino >= 1.0) return 'GOOD';
    if (sortino >= 0.5) return 'ACCEPTABLE';
    if (sortino > 0)    return 'WEAK';
    return 'LOSING';
  },
};

module.exports = SortinoRatio;
