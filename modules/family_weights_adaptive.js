// modules/family_weights_adaptive.js — Adaptive FAMILY_WEIGHTS-Resolver
// Verankert 2026-05-20 (STUFE 1 — HMM-driven Brain-Weight-Adaption).
//
// Hängt sich an HMM-Regime: pro State unterschiedliche Gewichtung der 5 Brain-Familien.
// Output ist eine posterior-gewichtete Mischung — kein hartes Switch.
// Smoothing zusätzlich via EMA über bisherige resolved-weights damit ConsensusEngine
// nicht jeden Tick neu re-balanciert (Stabilität > Reaktivität bei Weights).
//
// Profile sind Aladdin-orientiert:
//   BULL     → TREND dominiert, SENTIMENT support
//   BEAR     → RISK dominiert, MICROSTRUCTURE support, SENTIMENT runter (Über-Pessimismus-Schutz)
//   RANGING  → MICROSTRUCTURE + MOMENTUM, TREND runter (Range-Bias falsch)
//   CRASH    → RISK + SENTIMENT (Veto-Familien), TREND/MOMENTUM stark runter
//   RECOVERY → TREND + MOMENTUM, MICROSTRUCTURE moderate
//
// Brain-Schutzzone: Profile sind code-konstant. Posterior-Gewichtung adaptiert sanft.

'use strict';

const FAMILIES = ['TREND', 'MOMENTUM', 'RISK', 'SENTIMENT', 'MICROSTRUCTURE'];

// Pro State Familien-Gewichte (Summe = 1.0 erwartet, wird beim Resolve normiert)
// T9.1 [24.05.2026]: RANGING aggressiv re-balanciert nach aladdin_perf Hit-Rates (n=28).
// Andere States (BULL/BEAR/CRASH/RECOVERY) bleiben — Bot ist 97.5% in RANGING (HMM posterior).
// Re-Audit in 24-48h falls Posterior-Mix sich ändert.
const WEIGHTS_BY_STATE = {
  // T9.1: TREND 32%Hit→35%Gew · RISK 36%→30% · MICROSTRUCTURE 29%→25%
  //       MOMENTUM 14%→5% · SENTIMENT 14%→5% (Inversion proportional zur Hit-Rate)
  RANGING: { TREND: 0.35, MOMENTUM: 0.05, RISK: 0.30, SENTIMENT: 0.05, MICROSTRUCTURE: 0.25 },

  // BULL: Trend-Follow gewinnt, Sentiment unterstützt
  BULL:    { TREND: 0.32, MOMENTUM: 0.22, RISK: 0.13, SENTIMENT: 0.20, MICROSTRUCTURE: 0.13 },

  // BEAR: Risk-Familie + Mikrostruktur (Order-Flow) sehen Drops, Sentiment-Über-Pessimismus dämpfen
  BEAR:    { TREND: 0.18, MOMENTUM: 0.12, RISK: 0.32, SENTIMENT: 0.13, MICROSTRUCTURE: 0.25 },

  // CRASH: nur Veto-Familien, Trend/Momentum praktisch aus
  CRASH:   { TREND: 0.05, MOMENTUM: 0.05, RISK: 0.45, SENTIMENT: 0.25, MICROSTRUCTURE: 0.20 },

  // RECOVERY: Trend zurück, Momentum gross, Risk gedimmt, Sentiment bleibt
  RECOVERY:{ TREND: 0.30, MOMENTUM: 0.28, RISK: 0.15, SENTIMENT: 0.15, MICROSTRUCTURE: 0.12 },
};

const RESOLVE_SMOOTH_ALPHA = 0.40;  // EMA-Faktor für resolved-weights (0.4 = 60% old + 40% new)

const FamilyWeightsAdaptive = {
  _smoothedWeights: null,  // letzte resolved weights (für stabile UI/Brain-Anzeige)
  _lastState: null,
  _lastResolveTs: 0,

  // Posterior-gewichtete Mischung über alle WEIGHTS_BY_STATE
  // posterior: { BULL: 0.2, BEAR: 0.1, RANGING: 0.6, CRASH: 0.05, RECOVERY: 0.05 }
  resolve(posterior) {
    if (!posterior || typeof posterior !== 'object') return this._cloneStatic('RANGING');

    const mixed = {};
    for (const f of FAMILIES) mixed[f] = 0;

    let totalP = 0;
    for (const state of Object.keys(WEIGHTS_BY_STATE)) {
      const p = posterior[state];
      if (typeof p !== 'number' || !isFinite(p) || p <= 0) continue;
      totalP += p;
      const w = WEIGHTS_BY_STATE[state];
      for (const f of FAMILIES) mixed[f] += w[f] * p;
    }

    if (totalP <= 0) return this._cloneStatic('RANGING');

    // Normieren falls Posterior nicht exakt 1.0 summiert
    if (Math.abs(totalP - 1.0) > 0.001) {
      for (const f of FAMILIES) mixed[f] /= totalP;
    }

    // Final normieren auf Summe 1 (state-Profile sind nicht exakt 1.0 by hand)
    let sum = 0;
    for (const f of FAMILIES) sum += mixed[f];
    if (sum > 0) for (const f of FAMILIES) mixed[f] /= sum;

    // EMA-Smoothing über letzte Resolve damit Brain stable
    const smoothed = {};
    if (!this._smoothedWeights) {
      for (const f of FAMILIES) smoothed[f] = mixed[f];
    } else {
      for (const f of FAMILIES) {
        smoothed[f] = (1 - RESOLVE_SMOOTH_ALPHA) * (this._smoothedWeights[f] || 0)
                    + RESOLVE_SMOOTH_ALPHA * mixed[f];
      }
    }
    this._smoothedWeights = smoothed;
    this._lastResolveTs = Date.now();
    return smoothed;
  },

  _cloneStatic(state) {
    const w = WEIGHTS_BY_STATE[state] || WEIGHTS_BY_STATE.RANGING;
    return { ...w };
  },

  getCurrent() {
    return this._smoothedWeights ? { ...this._smoothedWeights } : this._cloneStatic('RANGING');
  },

  snapshot() {
    return {
      smoothedWeights: this._smoothedWeights,
      lastResolveTs: this._lastResolveTs,
      smoothAlpha: RESOLVE_SMOOTH_ALPHA,
      profiles: WEIGHTS_BY_STATE,
    };
  },

  FAMILIES,
  WEIGHTS_BY_STATE,
};

module.exports = FamilyWeightsAdaptive;
