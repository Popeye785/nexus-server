// modules/meta_labeling.js — Meta-Labeling für Primary-Model-Veredelung
// Verankert 2026-05-26 (Phase 3 Quant-Grade — Tag 19)
//
// Quelle:
//   Lopez de Prado M. (2018) "Advances in Financial Machine Learning"
//   Ch. 3 "Labeling" — Sektion 3.5 "Meta-Labeling"
//
// Konzept:
//   Primary Model:  entscheidet SIDE (long/short/no-trade)
//   Secondary Model (Meta): entscheidet SIZE conditional on primary
//                          = "is the primary's prediction profitable?"
//
//   Meta-Labels werden via Triple-Barrier auf primary's predictions berechnet:
//     Label = 1 wenn primary's call profitable (TP-hit)
//     Label = 0 wenn primary's call unprofitable (SL-hit oder timeout-loss)
//
//   Meta-Model trained binary classifier auf (features, label) → outputs probability p
//   Position-Size = p × base_size (oder Kelly-like sizing)
//
// Vorteile:
//   - Filtert false-positives des primary (höhere precision)
//   - Sizing-Logik trennbar von side-Logik
//   - Recall des primary bleibt erhalten (low-prob predictions get size 0)
//
// API:
//   MetaLabeling.deriveLabels(primaryPredictions, tripleBarrierLabels) → meta-labels
//   MetaLabeling.evaluate(primary, meta, actual) → precision/recall/F1
//
// Use-Case Integration:
//   primary = AladdinBrain.decide() → {direction: BUY/SELL/HOLD}
//   meta    = simple-classifier auf brain-confidence + market-features → p ∈ [0,1]
//   sizing  = p × base_size (oder Kelly mit p,b)

'use strict';

const MetaLabeling = {
  EPSILON: 1e-12,

  /**
   * Derive meta-labels from primary predictions and triple-barrier labels.
   * @param {Array<{t0, side}>} primary - primary model predictions {t0: index, side: 1/-1/0}
   * @param {Array<{t0, label}>} tripleBarrier - triple-barrier labels (LdP Ch.3)
   * @returns {Array<{t0, primary_side, tb_label, meta_label}>}
   *
   * Meta-Label Logic:
   *   meta_label = 1 if (primary_side != 0 AND tb_label == primary_side)  → "primary was right"
   *   meta_label = 0 otherwise                                             → "primary was wrong or no-trade"
   */
  deriveLabels(primary, tripleBarrier) {
    const tbMap = new Map();
    for (const tb of tripleBarrier) tbMap.set(tb.t0, tb.label);
    const out = [];
    for (const p of primary) {
      const tbL = tbMap.has(p.t0) ? tbMap.get(p.t0) : null;
      let meta_label = 0;
      if (p.side !== 0 && tbL !== null && tbL === p.side) meta_label = 1;
      out.push({ t0: p.t0, primary_side: p.side, tb_label: tbL, meta_label });
    }
    return out;
  },

  /**
   * Evaluate precision, recall, F1, accuracy of primary's predictions
   * using triple-barrier labels as ground truth.
   * @param {Array} metaLabels - output of deriveLabels
   * @returns {Object} { tp, fp, fn, tn, precision, recall, f1, accuracy, n }
   */
  evaluate(metaLabels) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const m of metaLabels) {
      const predicted = m.primary_side !== 0;        // primary made a trade-call
      const actual    = m.tb_label !== null && m.tb_label === m.primary_side;  // call was correct
      if (predicted && actual)  tp++;
      else if (predicted && !actual) fp++;
      else if (!predicted && m.tb_label > 0) fn++;   // primary said no-trade but missed profit
      else tn++;
    }
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall    = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1        = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const accuracy  = (tp + tn + fp + fn) > 0 ? (tp + tn) / (tp + tn + fp + fn) : 0;
    return {
      tp, fp, fn, tn,
      precision: Number(precision.toFixed(4)),
      recall:    Number(recall.toFixed(4)),
      f1:        Number(f1.toFixed(4)),
      accuracy:  Number(accuracy.toFixed(4)),
      n: metaLabels.length,
    };
  },

  /**
   * Compute meta-probability p ∈ [0, 1] using a simple logistic-style heuristic
   * based on primary-confidence + recent meta-precision.
   * @param {number} primaryConfidence - 0..1
   * @param {number} recentPrecision - 0..1 (rolling precision over last N trades)
   * @returns {number} meta-probability
   */
  computeMetaProb(primaryConfidence, recentPrecision) {
    const pc = Math.max(0, Math.min(1, primaryConfidence || 0));
    const rp = Math.max(0, Math.min(1, recentPrecision || 0.5));
    // Geometric mean: requires BOTH high primary-conf AND high recent-precision
    return Math.sqrt(pc * rp);
  },

  /**
   * Kelly-like sizing with meta-probability.
   * f* = (p × b - q) / b  where p = meta-prob, b = avg_win/avg_loss
   * Half-Kelly capped at MAX_FRACTION (LdP defensive).
   */
  computeSize(metaProb, avgWinUsd, avgLossUsd, opts = {}) {
    const MAX = opts.maxFraction || 0.40;
    const HALF = opts.fraction || 0.5;
    const p = Math.max(0, Math.min(1, metaProb));
    const q = 1 - p;
    if (avgLossUsd <= this.EPSILON) return MAX * HALF;
    const b = Math.abs(avgWinUsd) / Math.abs(avgLossUsd);
    const kelly = (p * b - q) / b;
    if (kelly <= 0) return 0;
    return Math.min(MAX, kelly * HALF);
  },

  /**
   * Snapshot: end-to-end demo using stored data.
   * Generates synthetic primary predictions from triple-barrier labels for demo
   * (real integration would use AladdinBrain decisions or ML output).
   */
  async snapshot(symbol = 'BTCUSDT', granularity = '1h', limit = 200) {
    try {
      const Bitget = (typeof global !== 'undefined' && global.Bitget) || (typeof globalThis !== 'undefined' && globalThis.Bitget);
      const TB = require('./triple_barrier.js');
      if (!Bitget || !Bitget.fetchCandles) return { error: 'Bitget client not available' };
      const candles = await Bitget.fetchCandles(symbol, granularity, limit);
      if (!candles || candles.length < 30) return { error: 'insufficient candles', n: candles ? candles.length : 0 };
      const prices = candles.map(c => Number(c.close));
      const sigmas = TB.rollingSigma(prices, 20);
      const tbLabels = TB.applyTo(prices, sigmas, { pt: [1.5, 1.5], maxHold: 12 });
      // Synthetic primary: simple EMA-Cross signal (toy demo)
      // In production: replaces with AladdinBrain.decide() or RL/LSTM output
      const primaryPredictions = [];
      const fast = 10, slow = 30;
      if (prices.length > slow + 2) {
        // EMA arrays
        const ef = new Array(prices.length), es = new Array(prices.length);
        const kf = 2/(fast+1), ks = 2/(slow+1);
        ef[0] = prices[0]; es[0] = prices[0];
        for (let i = 1; i < prices.length; i++) {
          ef[i] = prices[i]*kf + ef[i-1]*(1-kf);
          es[i] = prices[i]*ks + es[i-1]*(1-ks);
        }
        for (let i = slow + 1; i < prices.length; i++) {
          if (ef[i-1] <= es[i-1] && ef[i] > es[i])      primaryPredictions.push({ t0: i, side: 1 });
          else if (ef[i-1] >= es[i-1] && ef[i] < es[i]) primaryPredictions.push({ t0: i, side: -1 });
          // sonst kein call (no-trade)
        }
      }
      const metaLabels = this.deriveLabels(primaryPredictions, tbLabels);
      const eval_ = this.evaluate(metaLabels);
      // Meta-probability demo: avg primary-conf 0.6 × precision
      const metaProb = this.computeMetaProb(0.6, eval_.precision);
      return {
        symbol, granularity, candles_count: prices.length,
        primary_calls: primaryPredictions.length,
        meta_eval: eval_,
        meta_prob_demo: Number(metaProb.toFixed(4)),
        kelly_size_demo: Number(this.computeSize(metaProb, 0.04, 0.02).toFixed(4)),  // assume +4%/-2% win/loss
        sample_labels: metaLabels.slice(0, 5),
        ts: Date.now(),
      };
    } catch(e) {
      return { error: e.message };
    }
  },
};

module.exports = MetaLabeling;
