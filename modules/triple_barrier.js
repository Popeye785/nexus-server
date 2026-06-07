// modules/triple_barrier.js — Triple-Barrier-Labeling für ML-Training
// Verankert 2026-05-26 (Phase 3 Quant-Grade — Tag 17)
//
// Quelle:
//   Lopez de Prado M. (2018) "Advances in Financial Machine Learning"
//   Ch. 3 "Labeling" (insbesondere 3.3 "Computing Dynamic Thresholds" + 3.4 "Triple-Barrier Method")
//
// Algorithm (3 Barriers):
//   Für jedes time-index t_0:
//     - Upper Barrier:    price > p_0 * (1 + pt_sl[0] * sigma_t)    → label = +1 (TP-hit)
//     - Lower Barrier:    price < p_0 * (1 - pt_sl[1] * sigma_t)    → label = -1 (SL-hit)
//     - Vertical Barrier: t > t_0 + max_holding_periods             → label =  0 (timeout)
//     Welche Barriere ZUERST hit wird → das ist das Label
//
// Vorteile gegenüber fixed-horizon labels:
//   - Path-dependent (nicht nur final-return)
//   - Side-aware (long/short separat möglich)
//   - Volatility-adjusted (sigma_t scaled barriers)
//   - Triple-Output: {label, hit_barrier, hit_index, hit_return, hit_duration}
//
// Use-cases:
//   - ML-Training-Labels (z.B. für XGBoost classification)
//   - Meta-Labeling (size-decision conditional on side-prediction)
//   - Backtest-Quality-Filter
//
// API:
//   TripleBarrier.applyTo(prices, sigmas, options) → array of labels per t_0
//   TripleBarrier.labelTrade(entryPrice, futurePrices, sigma, opts) → single label

'use strict';

const TripleBarrier = {
  DEFAULT_PT: [1.5, 1.5],           // [Upper, Lower] sigma-multiplier
  DEFAULT_HOLDING_PERIODS: 24,      // max holding (z.B. 24 candles)
  EPSILON: 1e-12,

  /**
   * Label a single trade given entry + future prices + sigma.
   * @param {number} entryPrice - p_0
   * @param {Array<number>} futurePrices - subsequent prices (length >= 1)
   * @param {number} sigma - volatility estimate at t_0 (e.g. 20-period rolling std of returns)
   * @param {Object} opts - { pt: [upperMult, lowerMult], maxHold: int, side: 1/-1 }
   * @returns {Object} { label, hit_barrier, hit_index, hit_return, hit_duration }
   */
  labelTrade(entryPrice, futurePrices, sigma, opts = {}) {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return { label: 0, hit_barrier: 'INVALID_ENTRY', hit_index: -1, hit_return: 0, hit_duration: 0 };
    }
    if (!Array.isArray(futurePrices) || futurePrices.length === 0) {
      return { label: 0, hit_barrier: 'NO_FUTURE_DATA', hit_index: -1, hit_return: 0, hit_duration: 0 };
    }
    const pt = opts.pt || this.DEFAULT_PT;
    const maxHold = Math.min(opts.maxHold || this.DEFAULT_HOLDING_PERIODS, futurePrices.length);
    const side = opts.side || 1;   // 1 = long, -1 = short
    const _sigma = (Number.isFinite(sigma) && sigma > this.EPSILON) ? sigma : 0.01;
    const upperBarrier = entryPrice * (1 + pt[0] * _sigma);
    const lowerBarrier = entryPrice * (1 - pt[1] * _sigma);
    for (let i = 0; i < maxHold; i++) {
      const p = futurePrices[i];
      if (!Number.isFinite(p) || p <= 0) continue;
      // Long side: upper = TP, lower = SL
      // Short side (label flip): upper = SL, lower = TP
      if (p >= upperBarrier) {
        const hit_return = (p - entryPrice) / entryPrice * side;
        return { label: side, hit_barrier: 'UPPER', hit_index: i, hit_return, hit_duration: i + 1 };
      }
      if (p <= lowerBarrier) {
        const hit_return = (p - entryPrice) / entryPrice * side;
        return { label: -side, hit_barrier: 'LOWER', hit_index: i, hit_return, hit_duration: i + 1 };
      }
    }
    // Vertical barrier (timeout): label by final return sign
    const finalP = futurePrices[maxHold - 1];
    const finalReturn = (finalP - entryPrice) / entryPrice * side;
    const label = finalReturn > 0.001 ? side : (finalReturn < -0.001 ? -side : 0);
    return { label, hit_barrier: 'VERTICAL', hit_index: maxHold - 1, hit_return: finalReturn, hit_duration: maxHold };
  },

  /**
   * Batch-apply: für jedes t_0 in der Kerzen-Reihe Labels berechnen.
   * @param {Array<number>} prices - full price series (closes)
   * @param {Array<number>} sigmas - volatility estimate at each t_0 (same length as prices)
   * @param {Object} opts - { pt, maxHold, side }
   * @returns {Array<Object>} labels[t_0] für t_0 in [0, len - 1]
   */
  applyTo(prices, sigmas, opts = {}) {
    const n = prices.length;
    if (n < 2) return [];
    if (!sigmas) sigmas = new Array(n).fill(0.01);
    const labels = new Array(n);
    for (let t = 0; t < n; t++) {
      const futurePrices = prices.slice(t + 1);
      if (futurePrices.length === 0) {
        labels[t] = { label: 0, hit_barrier: 'END_OF_DATA', hit_index: -1, hit_return: 0, hit_duration: 0, t0: t };
        continue;
      }
      const r = this.labelTrade(prices[t], futurePrices, sigmas[t] || 0.01, opts);
      r.t0 = t;
      labels[t] = r;
    }
    return labels;
  },

  /**
   * Compute rolling-std sigmas from a price series.
   * Typische Default: window = 20 (Lopez de Prado).
   */
  rollingSigma(prices, window = 20) {
    const n = prices.length;
    const sigmas = new Array(n).fill(0.01);
    if (n < 2) return sigmas;
    // Returns
    const returns = new Array(n);
    returns[0] = 0;
    for (let i = 1; i < n; i++) {
      returns[i] = (prices[i] - prices[i - 1]) / Math.max(this.EPSILON, prices[i - 1]);
    }
    // Rolling std
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = returns.slice(start, i + 1);
      if (slice.length < 2) { sigmas[i] = 0.01; continue; }
      const mean = slice.reduce((s, r) => s + r, 0) / slice.length;
      const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / slice.length;
      sigmas[i] = Math.sqrt(variance);
    }
    return sigmas;
  },

  /**
   * Snapshot für UI/API: appliziert Triple-Barrier auf live candle-data.
   */
  async snapshot(symbol = 'BTCUSDT', granularity = '1h', limit = 100, opts = {}) {
    try {
      // Lazy global access to Bitget (test-friendly)
      const Bitget = (typeof global !== 'undefined' && global.Bitget) || (typeof globalThis !== 'undefined' && globalThis.Bitget);
      if (!Bitget || !Bitget.fetchCandles) {
        return { error: 'Bitget client not available' };
      }
      const candles = await Bitget.fetchCandles(symbol, granularity, limit);
      if (!candles || candles.length < 20) return { error: 'insufficient candles', n: candles ? candles.length : 0 };
      const prices = candles.map(c => Number(c.close));
      const sigmas = this.rollingSigma(prices, opts.window || 20);
      const labels = this.applyTo(prices, sigmas, opts);
      // Aggregate stats
      const wins = labels.filter(l => l.label > 0).length;
      const losses = labels.filter(l => l.label < 0).length;
      const flats = labels.filter(l => l.label === 0).length;
      const upperHits = labels.filter(l => l.hit_barrier === 'UPPER').length;
      const lowerHits = labels.filter(l => l.hit_barrier === 'LOWER').length;
      const verticalHits = labels.filter(l => l.hit_barrier === 'VERTICAL').length;
      return {
        symbol, granularity, n: prices.length,
        avgSigma: Number((sigmas.reduce((s, x) => s + x, 0) / sigmas.length).toFixed(6)),
        labels_summary: { wins, losses, flats, total: labels.length },
        barriers_hit: { UPPER: upperHits, LOWER: lowerHits, VERTICAL: verticalHits },
        win_rate: labels.length > 0 ? Number((wins / labels.length).toFixed(4)) : 0,
        last_5_labels: labels.slice(-5).map(l => ({ t0: l.t0, label: l.label, barrier: l.hit_barrier, ret: Number((l.hit_return || 0).toFixed(4)), dur: l.hit_duration })),
        ts: Date.now(),
      };
    } catch(e) {
      return { error: e.message };
    }
  },
};

module.exports = TripleBarrier;
