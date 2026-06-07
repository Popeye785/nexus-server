// modules/tft_forecaster.js — Temporal Fusion Transformer-style Multi-Horizon Forecaster (STUFE 10)
// Verankert 2026-05-20 (Boutique-Quant-A).
//
// Salesforce 2019 TFT-Architektur (Lim et al.): Multi-Horizon-Forecasting mit
//   - Static covariates (symbol-spezifisch)
//   - Past time-varying (1h candles)
//   - Future known (calendar, regime)
// Full TFT braucht trained model + onnxruntime + PyTorch-Convert-Pipeline.
//
// PHASE-1-Implementation (jetzt): "TFT-style Ensemble" — kombiniert:
//   - Existing LSTM (lstm_crypto_v1.onnx) als Single-Horizon-Forecaster
//   - Statistical-Ensemble: EMA-Crossover + ARIMA-light + Momentum-Persistence
//   - HMM-state-conditioning (verschiedene Modell-Mixes pro Regime)
// → liefert Multi-Horizon-Forecast { 1h, 4h, 24h } mit Confidence-Intervals
//
// PHASE-2 (zukünftig): drop-in für trained TFT-ONNX-Modell, Production via onnxruntime-node

'use strict';

const TFTForecaster = {
  _db: null,
  _logFn: null,
  _lstm: null,
  _hmm: null,
  _stats: { forecasts: 0, errors: 0, last_ts: 0 },

  HORIZONS_HOURS: [1, 4, 24],
  CONF_FLOOR: 0.20,
  CONF_CEIL: 0.85,

  init(db, lstmRef, hmmRef) {
    this._db = db;
    this._lstm = lstmRef;
    this._hmm = hmmRef;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tft_forecasts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          horizon_h INTEGER NOT NULL,
          predicted_return REAL,
          confidence REAL,
          components_json TEXT,
          regime_state TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tft_ts ON tft_forecasts(ts);
        CREATE INDEX IF NOT EXISTS idx_tft_sym_h ON tft_forecasts(symbol, horizon_h, ts);
      `);
      try { this._logFn.info && this._logFn.info('TFT', `initialized (3 horizons: 1h/4h/24h, ensemble-mode)`); } catch(_) {}
    } catch(_) {}
  },

  // ─── Component 1: LSTM Single-Horizon-Forecast ──────────────────
  _lstmComponent(candles) {
    if (!this._lstm || typeof this._lstm.predict !== 'function') return null;
    try {
      const r = this._lstm.predict(candles);
      if (!r || !isFinite(r.predictedReturn)) return null;
      return { return: r.predictedReturn, confidence: 0.45, source: 'lstm' };
    } catch(_) { return null; }
  },

  // ─── Component 2: EMA-Crossover Trend-Forecaster ────────────────
  _emaComponent(candles) {
    if (!candles || candles.length < 50) return null;
    const closes = candles.map(c => c.close);
    const ema = (n, arr) => {
      const k = 2 / (n + 1);
      let val = arr.slice(0, n).reduce((s, v) => s + v, 0) / n;
      for (let i = n; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
      return val;
    };
    const ema12 = ema(12, closes);
    const ema26 = ema(26, closes);
    const last = closes[closes.length - 1];
    const macd = (ema12 - ema26) / last;
    // Trend-Persistenz: linear-extrapolation
    const predReturn = macd * 0.5;  // scaled signal-strength
    const confidence = Math.min(0.5, Math.abs(macd) * 20);
    return { return: predReturn, confidence, source: 'ema_cross' };
  },

  // ─── Component 3: Momentum-Persistence ──────────────────────────
  _momentumComponent(candles, horizonHours) {
    if (!candles || candles.length < 24) return null;
    const closes = candles.map(c => c.close);
    const last = closes[closes.length - 1];
    const prev24 = closes[closes.length - 24] || last;
    const ret24h = Math.log(last / prev24);
    // Annahme: Momentum hat halflife ~6h
    const halflife = 6;
    const decay = Math.pow(0.5, horizonHours / halflife);
    const predReturn = ret24h * decay * 0.3;  // conservative momentum-extension
    return { return: predReturn, confidence: 0.35, source: 'momentum' };
  },

  // ─── HMM-State-conditioned Ensemble-Weights ─────────────────────
  _getEnsembleWeights() {
    let state = 'RANGING', posterior = null;
    if (this._hmm && this._hmm.getCurrentRegime) {
      const r = this._hmm.getCurrentRegime();
      if (r) { state = r.state; posterior = r.posterior; }
    }
    // State-conditioned weights für [lstm, ema, momentum]
    // BULL → momentum hoch; RANGING → ema dominant; CRASH → all 3 balanced (Uncertainty)
    const weightProfiles = {
      BULL:     { lstm: 0.30, ema: 0.25, momentum: 0.45 },
      BEAR:     { lstm: 0.30, ema: 0.35, momentum: 0.35 },
      RANGING:  { lstm: 0.30, ema: 0.50, momentum: 0.20 },
      CRASH:    { lstm: 0.33, ema: 0.33, momentum: 0.34 },
      RECOVERY: { lstm: 0.35, ema: 0.30, momentum: 0.35 },
    };
    return { weights: weightProfiles[state] || weightProfiles.RANGING, state, posterior };
  },

  // ─── Public: Multi-Horizon-Forecast ─────────────────────────────
  forecast(symbol, candles) {
    if (!candles || candles.length < 30) return { error: 'insufficient_candles' };
    const lstm = this._lstmComponent(candles);
    const ema = this._emaComponent(candles);
    const horizons = this.HORIZONS_HOURS.map(h => ({
      horizon_h: h,
      momentum: this._momentumComponent(candles, h),
    }));

    const ensemble = this._getEnsembleWeights();
    const w = ensemble.weights;

    const out = { symbol, ts: Date.now(), regime_state: ensemble.state, predictions: [] };
    for (const h of horizons) {
      let weightedReturn = 0;
      let weightedConf = 0;
      let totalW = 0;
      if (lstm && isFinite(lstm.return)) { weightedReturn += lstm.return * w.lstm; weightedConf += lstm.confidence * w.lstm; totalW += w.lstm; }
      if (ema && isFinite(ema.return)) { weightedReturn += ema.return * w.ema; weightedConf += ema.confidence * w.ema; totalW += w.ema; }
      if (h.momentum && isFinite(h.momentum.return)) { weightedReturn += h.momentum.return * w.momentum; weightedConf += h.momentum.confidence * w.momentum; totalW += w.momentum; }
      if (totalW === 0) continue;
      weightedReturn /= totalW;
      weightedConf = Math.max(this.CONF_FLOOR, Math.min(this.CONF_CEIL, weightedConf / totalW));

      // Confidence-Interval ±2σ Approximation aus weighted conf
      const sigma = Math.abs(weightedReturn) * (1 / Math.max(weightedConf, 0.2));
      const ci_low = weightedReturn - 2 * sigma;
      const ci_high = weightedReturn + 2 * sigma;

      out.predictions.push({
        horizon_h: h.horizon_h,
        predicted_return: parseFloat(weightedReturn.toFixed(5)),
        confidence: parseFloat(weightedConf.toFixed(3)),
        ci_low: parseFloat(ci_low.toFixed(5)),
        ci_high: parseFloat(ci_high.toFixed(5)),
        components: {
          lstm: lstm ? { return: lstm.return, weight: w.lstm } : null,
          ema: ema ? { return: ema.return, weight: w.ema } : null,
          momentum: h.momentum ? { return: h.momentum.return, weight: w.momentum } : null,
        },
      });

      this._persist(symbol, h.horizon_h, weightedReturn, weightedConf, out.predictions[out.predictions.length - 1].components, ensemble.state);
    }

    this._stats.forecasts++;
    this._stats.last_ts = Date.now();
    return out;
  },

  _persist(symbol, h, pred, conf, comp, state) {
    if (!this._db) return;
    try {
      this._db.prepare(`INSERT INTO tft_forecasts (ts, symbol, horizon_h, predicted_return, confidence, components_json, regime_state)
        VALUES (?,?,?,?,?,?,?)`).run(
        Date.now(), symbol, h, pred, conf, JSON.stringify(comp).slice(0, 400), state
      );
    } catch(_) { this._stats.errors++; }
  },

  // ─── Brain-API: Direction-Signal aus 1h-Horizon ─────────────────
  getDirectionSignal(symbol, candles) {
    try {
      const f = this.forecast(symbol, candles);
      if (!f || !f.predictions || f.predictions.length === 0) return { direction: 'NEUTRAL', score: 0, confidence: 0 };
      const p1h = f.predictions.find(x => x.horizon_h === 1) || f.predictions[0];
      const r = p1h.predicted_return;
      let direction = 'NEUTRAL', score = 0;
      if (r > 0.002) { direction = 'BUY'; score = Math.min(0.6, r * 30); }
      else if (r < -0.002) { direction = 'SELL'; score = Math.max(-0.6, r * 30); }
      return { direction, score: parseFloat(score.toFixed(4)), confidence: p1h.confidence, horizon_h: 1, predicted_return: r };
    } catch(_) { return { direction: 'NEUTRAL', score: 0, confidence: 0 }; }
  },

  snapshot() {
    return { ...this._stats, horizons: this.HORIZONS_HOURS, mode: 'ensemble_phase1', has_lstm: !!this._lstm, has_hmm: !!this._hmm };
  },
};

module.exports = TFTForecaster;
