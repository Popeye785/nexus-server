// modules/deflated_sharpe.js
// Deflated Sharpe Ratio (DSR) + Probability of Backtest Overfitting (PBO)
// Quelle: Bailey & Lopez de Prado (2014) "The Deflated Sharpe Ratio: Correcting for
//         Selection Bias, Backtest Overfitting and Non-Normality"
//         Journal of Portfolio Management 40(5)
//
// Konzept:
//   Wenn man N Strategien testet und die beste auswählt, hat man Multiple-Testing-Bias.
//   DSR korrigiert: DSR > 0 → Strategie hat echte Edge mit hoher Wahrscheinlichkeit.
//   PBO: Wahrscheinlichkeit dass beste in-sample-Strategie out-of-sample underperformt.

'use strict';

const DeflatedSharpe = {
  /**
   * Standard Sharpe Ratio aus Returns.
   * @param {Array<number>} returns
   * @param {number} freq - annualization factor (default 252*24 für hourly)
   */
  sharpe(returns, freq = 252 * 24) {
    if (!returns || returns.length < 2) return 0;
    const n = returns.length;
    const mean = returns.reduce((a,b)=>a+b, 0) / n;
    const variance = returns.reduce((a,b)=>a+(b-mean)**2, 0) / (n-1);
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return 0;
    return (mean / stddev) * Math.sqrt(freq);
  },

  /**
   * Sortino Ratio (downside-stddev only).
   */
  sortino(returns, freq = 252 * 24) {
    if (!returns || returns.length < 2) return 0;
    const n = returns.length;
    const mean = returns.reduce((a,b)=>a+b, 0) / n;
    const downsideRets = returns.filter(r => r < 0);
    if (downsideRets.length === 0) return mean > 0 ? Infinity : 0;
    const downsideStddev = Math.sqrt(downsideRets.reduce((a,b)=>a+b*b, 0) / downsideRets.length);
    if (downsideStddev === 0) return 0;
    return (mean / downsideStddev) * Math.sqrt(freq);
  },

  /**
   * Inverse Standard-Normal CDF (Beasley-Springer-Moro approximation).
   */
  invNormal(p) {
    if (p <= 0 || p >= 1) return 0;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
               3.754408661907416e+00];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p <= pHigh) {
      q = p - 0.5; r = q * q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
             (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    } else {
      q = Math.sqrt(-2 * Math.log(1-p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
  },

  /**
   * Deflated Sharpe Ratio.
   * @param {number} sharpeObserved - beobachteter Sharpe der Strategie
   * @param {number} numTrials - wieviele Strategien wurden getestet (Selection-Bias)
   * @param {number} skew - skewness der Returns (default 0 für normal)
   * @param {number} kurt - kurtosis (default 3 für normal)
   * @param {number} T - Anzahl Beobachtungen
   * @returns {Object} {dsr, prob, eulerGamma, expectedMaxSR}
   */
  deflated(sharpeObserved, numTrials, skew, kurt, T) {
    const eulerGamma = 0.5772156649;
    // Expected max Sharpe under H0 (no skill, N trials)
    // E[max SR] = (1 - γ) * Φ^-1(1 - 1/N) + γ * Φ^-1(1 - 1/(N*e))
    const expectedMaxSR = (1 - eulerGamma) * this.invNormal(1 - 1/numTrials)
                        + eulerGamma * this.invNormal(1 - 1/(numTrials * Math.E));
    // Variance adjustment for skewness/kurtosis (LdP-Standard)
    const sigmaSqr = (1 - skew * sharpeObserved + ((kurt - 1) / 4) * sharpeObserved**2) / (T - 1);
    if (sigmaSqr <= 0) return { dsr: 0, prob: 0.5, expectedMaxSR };
    // Deflated SR
    const dsrNumerator = (sharpeObserved - expectedMaxSR) * Math.sqrt(T - 1);
    const dsrDenom = Math.sqrt(1 - skew * sharpeObserved + ((kurt - 1) / 4) * sharpeObserved**2);
    const dsr = dsrNumerator / dsrDenom;
    // Probability that DSR > 0 (Phi(dsr))
    const prob = 0.5 * (1 + this._erf(dsr / Math.sqrt(2)));
    return {
      dsr: Number(dsr.toFixed(4)),
      prob: Number(prob.toFixed(4)),
      expectedMaxSR: Number(expectedMaxSR.toFixed(4)),
      sharpeObserved,
      numTrials, T,
    };
  },

  _erf(x) {
    // Abramowitz-Stegun approximation
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
    return sign * y;
  },

  /**
   * Probability of Backtest Overfitting (PBO) — vereinfacht.
   * @param {Array<Array<number>>} pathReturns - aus CPCV
   * @returns {Object} {pbo, medianOutSampleRank}
   */
  pbo(pathReturns) {
    if (!pathReturns || pathReturns.length < 2) return { pbo: null, reason: 'INSUFFICIENT_PATHS' };
    const sharpes = pathReturns.map(p => this.sharpe(p));
    const meanSR = sharpes.reduce((a,b)=>a+b,0) / sharpes.length;
    const stdSR = Math.sqrt(sharpes.reduce((a,b)=>a+(b-meanSR)**2,0) / sharpes.length);
    // PBO heuristic: fraction of paths where Sharpe < 0
    const negCount = sharpes.filter(s => s < 0).length;
    const pbo = negCount / sharpes.length;
    return {
      pbo: Number(pbo.toFixed(4)),
      pathCount: sharpes.length,
      sharpeRange: [Math.min(...sharpes), Math.max(...sharpes)].map(x => Number(x.toFixed(2))),
      sharpeMean: Number(meanSR.toFixed(2)),
      sharpeStd: Number(stdSR.toFixed(2)),
      reason: pbo > 0.5 ? 'LIKELY_OVERFIT' : pbo > 0.3 ? 'CAUTION' : 'ROBUST',
    };
  },

  /**
   * Skewness der Returns.
   */
  skewness(returns) {
    const n = returns.length;
    if (n < 3) return 0;
    const mean = returns.reduce((a,b)=>a+b,0) / n;
    const variance = returns.reduce((a,b)=>a+(b-mean)**2,0) / n;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return 0;
    return returns.reduce((a,b)=>a+((b-mean)/stddev)**3,0) / n;
  },

  /**
   * Kurtosis der Returns.
   */
  kurtosis(returns) {
    const n = returns.length;
    if (n < 4) return 3;
    const mean = returns.reduce((a,b)=>a+b,0) / n;
    const variance = returns.reduce((a,b)=>a+(b-mean)**2,0) / n;
    if (variance === 0) return 3;
    return returns.reduce((a,b)=>a+(b-mean)**4,0) / n / (variance**2);
  },
};

module.exports = DeflatedSharpe;
