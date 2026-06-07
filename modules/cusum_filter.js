// modules/cusum_filter.js
// CUSUM Event-Driven Sampling (Lopez de Prado 2018, Ch.2; Page 1954)
//
// Symmetric CUSUM:
//   S_t^+ = max(0, S_{t-1}^+ + y_t − E[y_t])
//   S_t^- = min(0, S_{t-1}^- + y_t − E[y_t])
//   Event bei |S^±| ≥ h → Reset auf 0
//
// Threshold h = h_mult × σ (typisch 2× rolling stddev der returns)
//
// Per-Symbol State, In-Memory + optional persistent.

'use strict';

const CUSUM = {
  // State pro Symbol: { S_plus, S_minus, lastPrice, lastTs, totalEvents, totalTicks, threshold }
  _state: new Map(),

  // Auto-Kalibrierung Cache
  _thresholdCache: new Map(),
  _thresholdCacheTs: 0,

  // CFG-Defaults (override via init/opts)
  H_MULT: 2.0,           // h = H_MULT × σ
  MIN_THRESHOLD: 0.001,  // mindestens 0.1% return-Bewegung
  MAX_THRESHOLD: 0.05,   // maximal 5% (Sanity-Cap)

  /**
   * Initialize/Reset state für ein Symbol.
   */
  initSymbol(symbol, threshold = null) {
    this._state.set(symbol, {
      S_plus: 0, S_minus: 0,
      lastPrice: null, lastTs: 0,
      totalEvents: 0, totalTicks: 0,
      threshold: threshold ?? this.MIN_THRESHOLD * 5,
    });
  },

  /**
   * Auto-Kalibriere Threshold pro Symbol aus historischen Returns.
   * @param {Array<number>} closes - chronologisch sortierte Close-Preise
   * @returns {number} threshold (= H_MULT × σ_returns)
   */
  calibrateThreshold(closes) {
    if (!closes || closes.length < 30) return this.MIN_THRESHOLD * 5;
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      const r = (closes[i] - closes[i-1]) / closes[i-1];
      if (Number.isFinite(r)) returns.push(r);
    }
    if (returns.length < 20) return this.MIN_THRESHOLD * 5;
    const mean = returns.reduce((a,b)=>a+b,0) / returns.length;
    const variance = returns.reduce((a,b)=>a+(b-mean)**2,0) / returns.length;
    const sigma = Math.sqrt(variance);
    const h = Math.max(this.MIN_THRESHOLD, Math.min(this.MAX_THRESHOLD, this.H_MULT * sigma));
    return Number(h.toFixed(6));
  },

  /**
   * Update CUSUM mit neuem Preis. Returns true wenn Event triggered.
   * @param {string} symbol
   * @param {number} price
   * @param {number} ts
   * @returns {Object} { event: bool, side: 'UP'|'DOWN'|null, S_plus, S_minus, threshold }
   */
  update(symbol, price, ts) {
    let st = this._state.get(symbol);
    if (!st) {
      this.initSymbol(symbol);
      st = this._state.get(symbol);
    }
    st.totalTicks++;
    if (st.lastPrice === null) {
      st.lastPrice = price;
      st.lastTs = ts;
      return { event: false, side: null, S_plus: 0, S_minus: 0, threshold: st.threshold };
    }
    // y_t = log-return (numerisch stabiler als raw-diff)
    const y = Math.log(price / st.lastPrice);
    // Drift-Annahme: E[y_t] = 0 (für Crypto-Returns reasonable, kein systematischer Drift in 1-tick-Range)
    st.S_plus = Math.max(0, st.S_plus + y);
    st.S_minus = Math.min(0, st.S_minus + y);

    let event = false, side = null;
    if (st.S_plus >= st.threshold) {
      event = true; side = 'UP';
      st.S_plus = 0; st.S_minus = 0; // Reset on event
      st.totalEvents++;
    } else if (Math.abs(st.S_minus) >= st.threshold) {
      event = true; side = 'DOWN';
      st.S_plus = 0; st.S_minus = 0;
      st.totalEvents++;
    }
    st.lastPrice = price;
    st.lastTs = ts;
    return { event, side, S_plus: st.S_plus, S_minus: st.S_minus, threshold: st.threshold };
  },

  /**
   * Setze Threshold (z.B. nach Auto-Kalibrierung).
   */
  setThreshold(symbol, threshold) {
    let st = this._state.get(symbol);
    if (!st) { this.initSymbol(symbol, threshold); return; }
    st.threshold = threshold;
  },

  /**
   * Stats pro Symbol.
   */
  snapshot(symbol = null) {
    if (symbol) {
      const st = this._state.get(symbol);
      if (!st) return null;
      const eventRate = st.totalTicks > 0 ? st.totalEvents / st.totalTicks : 0;
      return {
        symbol,
        totalEvents: st.totalEvents,
        totalTicks: st.totalTicks,
        eventRatePct: Number((eventRate * 100).toFixed(2)),
        threshold: st.threshold,
        S_plus: st.S_plus,
        S_minus: st.S_minus,
      };
    }
    // All symbols
    const all = {};
    for (const [sym, st] of this._state.entries()) {
      all[sym] = this.snapshot(sym);
    }
    return all;
  },

  /**
   * Reset alle States (für Restart).
   */
  resetAll() {
    this._state.clear();
    this._thresholdCache.clear();
  },
};

module.exports = CUSUM;
