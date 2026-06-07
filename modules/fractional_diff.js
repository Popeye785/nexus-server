// modules/fractional_diff.js
// ╔════════════════════════════════════════════════════════════════════╗
// ║ STATUS: PARKED (Block R A4, 27.05.2026)                            ║
// ║                                                                    ║
// ║ Reason: MR-Modul (Avellaneda) ist aktuell live (Block O A2).       ║
// ║   FracDiff jetzt dazu = 2 neue Variablen gleichzeitig → schwer zu  ║
// ║   attribuieren wer was tut. Sauberer wenn MR-Effekt erst isoliert  ║
// ║   messbar ist.                                                     ║
// ║                                                                    ║
// ║ Reaktivierungs-Trigger: siehe docs/PARKED_MODULES.md               ║
// ║   - MR-Edge nach 14d nicht bestätigt → FracDiff aktivieren         ║
// ║   - ODER: explizite Christian-Empfehlung aus Validation-Daten      ║
// ║                                                                    ║
// ║ Modul-Funktionalität BLEIBT ERHALTEN (Tests + API verfügbar).      ║
// ║ Nur KEINE Integration in UnifiedScore/Brain-Pipeline aktuell.      ║
// ╚════════════════════════════════════════════════════════════════════╝
//
// Fractional Differentiation (Lopez de Prado 2018, Ch.5)
// Macht Time-Series stationär bei maximaler Memory-Erhaltung.
//
// Konzept: (1-B)^d = Σ ω_k · B^k mit Gewichten:
//   ω_0 = 1
//   ω_k = ω_{k-1} · (-1) · (d - k + 1) / k
//
// FFD (Fixed-Width Window): drop weights mit |ω_k| < thresh, fixed window.
// Optimal-d: kleinstes d sodass ADF-stat < critical-value (stationär).

'use strict';

const FractionalDiff = {
  /**
   * Generiere Gewichte für gegebenes d und size.
   * @param {number} d - fractional differencing exponent
   * @param {number} size - maximale Anzahl Gewichte
   */
  getWeights(d, size) {
    const w = [1.0];
    for (let k = 1; k < size; k++) {
      w.push(w[k-1] * -(d - k + 1) / k);
    }
    return w;
  },

  /**
   * FFD-Gewichte mit Threshold-Cutoff.
   * @param {number} d
   * @param {number} thresh - drop weights mit |w|<thresh
   * @param {number} maxSize - hard-cap
   */
  getWeightsFFD(d, thresh = 1e-3, maxSize = 200) {
    const w = [1.0];
    for (let k = 1; k < maxSize; k++) {
      const wk = w[k-1] * -(d - k + 1) / k;
      if (Math.abs(wk) < thresh) break;
      w.push(wk);
    }
    return w;
  },

  /**
   * Apply fractional differentiation on series.
   * @param {Array<number>} series - input price/value series
   * @param {number} d
   * @param {number} thresh
   * @returns {Array<number>} - fracDiff series (with leading NaN's for warmup)
   */
  fracDiff(series, d = 0.4, thresh = 1e-3) {
    if (!series || series.length < 5) return [];
    const w = this.getWeightsFFD(d, thresh, Math.min(series.length, 200));
    const width = w.length;
    const result = new Array(series.length).fill(NaN);
    for (let i = width - 1; i < series.length; i++) {
      let sum = 0;
      for (let k = 0; k < width; k++) {
        sum += w[k] * series[i - k];
      }
      result[i] = sum;
    }
    return result;
  },

  /**
   * Simplified Dickey-Fuller test stat (no critical-table lookup; nutze t-stat).
   * Test: Δy_t = ρ·y_{t-1} + e_t. Wenn ρ stark negativ → stationär.
   * @param {Array<number>} series
   * @returns {number} - ADF-Test-Statistik (t-stat des ρ-Koeffizienten)
   */
  adfStat(series) {
    const cleanSeries = series.filter(x => Number.isFinite(x));
    const n = cleanSeries.length;
    if (n < 20) return 0;
    // Compute Δy_t = y_t - y_{t-1}
    const dy = [];
    const yLag = [];
    for (let i = 1; i < n; i++) {
      dy.push(cleanSeries[i] - cleanSeries[i-1]);
      yLag.push(cleanSeries[i-1]);
    }
    // OLS: dy = ρ * yLag + ε  (no intercept for simplicity)
    const sumXY = yLag.reduce((a,b,i) => a + b * dy[i], 0);
    const sumXX = yLag.reduce((a,b) => a + b * b, 0);
    if (sumXX === 0) return 0;
    const rho = sumXY / sumXX;
    // Residuals
    const residuals = dy.map((d, i) => d - rho * yLag[i]);
    const sse = residuals.reduce((a,b) => a + b*b, 0);
    const variance = sse / (residuals.length - 1);
    const seRho = Math.sqrt(variance / sumXX);
    if (seRho === 0) return 0;
    // t-stat
    return rho / seRho;
  },

  /**
   * Finde kleinstes d ∈ [0, 1] mit step-size, sodass ADF-stat < target (typisch -2.86 für 95%).
   * @param {Array<number>} series
   * @param {Object} opts {step, targetStat, thresh}
   */
  findOptimalD(series, opts = {}) {
    const step = opts.step || 0.1;
    const targetStat = opts.targetStat || -2.86; // approx ADF 95% critical value
    const thresh = opts.thresh || 1e-3;
    const results = [];
    for (let d = 0.0; d <= 1.0 + 1e-9; d += step) {
      const diff = this.fracDiff(series, d, thresh);
      const stat = this.adfStat(diff);
      // Korrelation zur Original-Series (für Memory-Check)
      const cleanOriginal = [], cleanDiff = [];
      for (let i = 0; i < series.length; i++) {
        if (Number.isFinite(diff[i])) {
          cleanOriginal.push(series[i]);
          cleanDiff.push(diff[i]);
        }
      }
      const corr = cleanDiff.length > 5 ? this._pearson(cleanOriginal, cleanDiff) : 0;
      results.push({ d: Number(d.toFixed(2)), adfStat: Number(stat.toFixed(3)), corr: Number(corr.toFixed(4)) });
      if (stat < targetStat) {
        return { optimalD: Number(d.toFixed(2)), adfStat: stat, corr, results };
      }
    }
    // Falls keine stationär gefunden → letztes Ergebnis
    const last = results[results.length - 1];
    return { optimalD: last.d, adfStat: last.adfStat, corr: last.corr, results, warning: 'NOT_STATIONARY' };
  },

  /**
   * Pearson-Korrelation (für Memory-Check).
   */
  _pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const meanX = x.reduce((a,b)=>a+b,0)/n;
    const meanY = y.reduce((a,b)=>a+b,0)/n;
    let num = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX, dy = y[i] - meanY;
      num += dx * dy;
      sumX2 += dx*dx;
      sumY2 += dy*dy;
    }
    const denom = Math.sqrt(sumX2 * sumY2);
    return denom > 0 ? num / denom : 0;
  },

  // ── Cache pro Symbol ──
  _dCache: new Map(),
  _dCacheTs: 0,

  /**
   * Cached optimal-d lookup pro Symbol (24h TTL).
   */
  getCachedOptimalD(symbol, prices) {
    const now = Date.now();
    if (now - this._dCacheTs > 86400000) {
      this._dCache.clear();
      this._dCacheTs = now;
    }
    if (this._dCache.has(symbol)) return this._dCache.get(symbol);
    const result = this.findOptimalD(prices, { step: 0.1 });
    this._dCache.set(symbol, result);
    return result;
  },
};

module.exports = FractionalDiff;
