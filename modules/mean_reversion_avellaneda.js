// modules/mean_reversion_avellaneda.js
// Statistical Arbitrage Mean-Reversion (Avellaneda & Lee 2010 SSRN 1153505)
//
// Konzept:
//   1. Cumulative residual X_t (für Single-Asset = log-price detrended)
//   2. Modelliere als Ornstein-Uhlenbeck: dX = κ(m − X)dt + σdW
//   3. s-score = (X − m) / σ_eq  (standardisierte Distanz vom Mittelwert)
//   4. Signal:
//      s > +1.25 → SELL (überdehnt nach oben, Erwartung: Rückgang)
//      s < −1.25 → BUY  (überdehnt nach unten, Erwartung: Anstieg)
//      |s| < 0.5 → EXIT (mean reached)
//
// Für Single-Asset-Variante (kein Pairs-Trading): wir nutzen log-price detrended via
// rolling-mean als "residual" — simplified Avellaneda für Crypto-Mega-Caps.

'use strict';

const MRAvellaneda = {
  // Defaults aus LdP/Avellaneda
  WINDOW_MIN: 30,
  WINDOW_MAX: 200,
  S_ENTRY: 1.25,
  S_EXIT: 0.50,

  /**
   * Fit Ornstein-Uhlenbeck via OLS auf AR(1) Form:
   *   X_t - X_{t-1} = a + b * X_{t-1} + ε_t
   *   κ = -log(1 + b)  (mean-reversion-rate)
   *   m = -a / b       (equilibrium-mean)
   *   half_life = log(2) / κ
   *   σ_eq = stddev(residuals) * sqrt(-1 / (2*log(1+b)))
   * @param {Array<number>} series - log-price series oder cumulative-residuals
   * @returns {Object} {kappa, mean, sigmaEq, halfLife, ok}
   */
  fitOU(series) {
    if (!series || series.length < this.WINDOW_MIN) return { ok: false, reason: 'TOO_SHORT' };
    const x = series.filter(v => Number.isFinite(v));
    if (x.length < this.WINDOW_MIN) return { ok: false, reason: 'INSUFFICIENT_FINITE' };
    const n = x.length;
    // AR(1) regression: x_t - x_{t-1} = a + b * x_{t-1} + ε_t
    const dy = [];
    const xLag = [];
    for (let i = 1; i < n; i++) {
      dy.push(x[i] - x[i-1]);
      xLag.push(x[i-1]);
    }
    const meanX = xLag.reduce((a,b)=>a+b,0) / xLag.length;
    const meanDY = dy.reduce((a,b)=>a+b,0) / dy.length;
    let numB = 0, denomB = 0;
    for (let i = 0; i < dy.length; i++) {
      numB += (xLag[i] - meanX) * (dy[i] - meanDY);
      denomB += (xLag[i] - meanX) ** 2;
    }
    if (denomB === 0) return { ok: false, reason: 'NO_VARIANCE' };
    const b = numB / denomB;
    const a = meanDY - b * meanX;
    // Convert AR(1) to OU
    if (b >= 0) return { ok: false, reason: 'NOT_MEAN_REVERTING', b, a }; // need b<0 for MR
    const kappa = -Math.log(1 + b);
    if (!Number.isFinite(kappa) || kappa <= 0) return { ok: false, reason: 'INVALID_KAPPA', b };
    const mean = -a / b;
    // Residuals
    const resids = dy.map((d,i) => d - (a + b * xLag[i]));
    const sigma2 = resids.reduce((s,r)=>s+r*r,0) / (resids.length - 2); // var with 2 dof loss
    const sigmaEq = Math.sqrt(sigma2 / (1 - (1 + b)**2));
    const halfLife = Math.log(2) / kappa;
    return {
      ok: true,
      kappa: Number(kappa.toFixed(6)),
      mean: Number(mean.toFixed(6)),
      sigmaEq: Number(sigmaEq.toFixed(6)),
      halfLife: Number(halfLife.toFixed(2)),
      b: Number(b.toFixed(6)),
      a: Number(a.toFixed(6)),
    };
  },

  /**
   * Compute s-score für aktuellen X-Wert.
   */
  sScore(currentX, fit) {
    if (!fit.ok || fit.sigmaEq <= 0) return null;
    return Number(((currentX - fit.mean) / fit.sigmaEq).toFixed(4));
  },

  /**
   * Generate signal from s-score.
   */
  signal(sScore) {
    if (sScore === null || !Number.isFinite(sScore)) return { direction: 'HOLD', confidence: 0, score: 0 };
    if (sScore > this.S_ENTRY) {
      // überdehnt nach oben → Mean-Reversion SELL
      const conf = Math.min(1.0, (sScore - this.S_ENTRY) / 2.0); // 0 bei 1.25, 1.0 bei 3.25
      return { direction: 'SELL', confidence: conf, score: -conf, reason: 'OVEREXTENDED_UP', sScore };
    }
    if (sScore < -this.S_ENTRY) {
      // überdehnt nach unten → Mean-Reversion BUY
      const conf = Math.min(1.0, (-sScore - this.S_ENTRY) / 2.0);
      return { direction: 'BUY', confidence: conf, score: conf, reason: 'OVEREXTENDED_DOWN', sScore };
    }
    if (Math.abs(sScore) < this.S_EXIT) {
      return { direction: 'EXIT', confidence: 0.5, score: 0, reason: 'MEAN_REACHED', sScore };
    }
    return { direction: 'HOLD', confidence: 0, score: 0, reason: 'NEUTRAL_ZONE', sScore };
  },

  /**
   * Convenience: full pipeline aus Close-Prices.
   * @param {Array<number>} closes
   * @returns {Object} {fit, sScore, signal}
   */
  fromCloses(closes) {
    if (!closes || closes.length < this.WINDOW_MIN) {
      return { fit: { ok: false, reason: 'TOO_SHORT' }, sScore: null, signal: { direction: 'HOLD', confidence: 0, score: 0 } };
    }
    // Log-prices als X (Standardpraxis im OU-Fit auf Crypto)
    const logPrices = closes.map(p => Math.log(p));
    const fit = this.fitOU(logPrices);
    const currentX = logPrices[logPrices.length - 1];
    const sScore = this.sScore(currentX, fit);
    const signal = this.signal(sScore);
    return { fit, sScore, signal };
  },

  // ── Cache pro Symbol ──
  _cache: new Map(),
  _cacheTs: 0,

  /**
   * Cached fit pro Symbol (10min TTL).
   */
  getCached(symbol, closes) {
    const now = Date.now();
    if (now - this._cacheTs > 600000) {
      this._cache.clear();
      this._cacheTs = now;
    }
    if (this._cache.has(symbol)) return this._cache.get(symbol);
    const result = this.fromCloses(closes);
    this._cache.set(symbol, result);
    return result;
  },
};

module.exports = MRAvellaneda;
