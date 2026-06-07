// modules/shadow_inference.js — Shadow-Mode-Inferenz
// AUDFIX_SHADOW_PHASE_1 [2026-05-18]
//
// Lädt trainierte ML-Modelle (XGBoost + RF) und führt Predictions PARALLEL
// zum Live-Brain aus. Schreibt in shadow_predictions ohne Live-Brain
// zu beeinflussen.
//
// BRAIN-SCHUTZZONE eingehalten: read-only Feature-Vektor-Zugriff,
// Live-Decision unangetastet.

'use strict';

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'data', 'models', 'mlv2_1779105132641');

const ShadowInference = {
  enabled: true,
  models: {},        // { name: { instance, type, predict } }
  _initialized: false,
  _stats: { totalInferences: 0, errors: 0, byModel: {} },
  _outcomeIntervalMs: 5 * 60 * 1000,  // alle 5 Min
  _outcomeCron: null,
  _db: null,         // wird von server.js gesetzt
  _bitget: null,     // wird von server.js gesetzt für Preise
  _fe: null,         // feature_engineering modul

  async init(dbHandle, bitgetHandle) {
    if (this._initialized) return { ok: true, alreadyInit: true };
    this._db = dbHandle;
    this._bitget = bitgetHandle;
    try {
      this._fe = require('./feature_engineering.js');
    } catch(e) {
      return { ok: false, error: 'feature_engineering load fail: ' + e.message };
    }

    // ─── XGBoost laden ─────────────────────────────────────────
    try {
      const XGBoost = await require('ml-xgboost');
      const xgbDir = path.join(MODELS_DIR, 'xgboost');
      if (fs.existsSync(path.join(xgbDir, 'model.json'))) {
        const json = JSON.parse(fs.readFileSync(path.join(xgbDir, 'model.json'), 'utf8'));
        // ml-xgboost: load via XGBoost.load
        const m = XGBoost.load ? XGBoost.load(json) : null;
        if (m) {
          this.models.xgboost = {
            instance: m,
            type: 'xgboost',
            predict: async (X) => {
              const ps = await m.predict([X]);
              return Array.isArray(ps) ? ps[0] : ps;
            },
          };
          this._stats.byModel.xgboost = { predictions: 0, errors: 0 };
        }
      }
    } catch(e) {
      try { console.warn('[Shadow] XGBoost load fail:', e.message); } catch(_){}
    }

    // ─── RandomForest laden ─────────────────────────────────────
    try {
      const { RandomForestClassifier } = require('ml-random-forest');
      const rfDir = path.join(MODELS_DIR, 'rf');
      if (fs.existsSync(path.join(rfDir, 'model.json'))) {
        const json = JSON.parse(fs.readFileSync(path.join(rfDir, 'model.json'), 'utf8'));
        const m = RandomForestClassifier.load(json);
        this.models.randomforest = {
          instance: m,
          type: 'randomforest',
          predict: async (X) => {
            const ps = m.predict([X]);
            return Array.isArray(ps) ? ps[0] : ps;
          },
        };
        this._stats.byModel.randomforest = { predictions: 0, errors: 0 };
      }
    } catch(e) {
      try { console.warn('[Shadow] RF load fail:', e.message); } catch(_){}
    }

    // GRU wird PARTIAL übersprungen — gru_engine.js hat keine save/load Methode

    this._initialized = true;
    const loaded = Object.keys(this.models);
    return { ok: true, modelsLoaded: loaded, count: loaded.length };
  },

  // ─── Feature-Vektor aus Candle-History bauen ────────────────────
  _extractFeaturesFromCandles(candles) {
    if (!candles || candles.length < 100) { this._lastSkip = 'too_few_candles_' + (candles?.length || 0); return null; }
    try {
      // letzter Index = aktuelle Position
      const idx = candles.length - 1;
      const f = this._fe.extractFeatures(candles, idx);
      if (!f) { this._lastSkip = 'fe_returned_null_idx_' + idx; }
      return f;
    } catch(e) { this._lastSkip = 'fe_err:' + e.message.slice(0,50); return null; }
  },

  // ─── Haupt-Inferenz ─────────────────────────────────────────────
  async runShadowInference(symbol, candles, liveBrainDecision) {
    if (!this.enabled || !this._initialized) { this._stats.skipped = (this._stats.skipped||0) + 1; return { skipped: true, reason: 'not_initialized' }; }
    const features = this._extractFeaturesFromCandles(candles);
    if (!features) {
      this._stats.skipped = (this._stats.skipped||0) + 1;
      this._stats.lastSkipReason = this._lastSkip;
      return { skipped: true, reason: 'no_features', detail: this._lastSkip };
    }

    const featuresHash = this._hashFeatures(features);
    const referencePrice = candles[candles.length - 1].close;
    const ts = Date.now();

    const results = [];
    for (const [name, model] of Object.entries(this.models)) {
      const t0 = Date.now();
      try {
        const rawPred = await model.predict(features);
        // rawPred: bei XGBoost float (sigmoid), bei RF int (0|1)
        const prob = typeof rawPred === 'number' ? rawPred : Number(rawPred);
        const direction = prob > 0.55 ? 'BUY' : prob < 0.45 ? 'SELL' : 'HOLD';
        const confidence = Math.abs(prob - 0.5) * 2;
        const inferenceMs = Date.now() - t0;
        this._stats.totalInferences++;
        this._stats.byModel[name].predictions++;

        try {
          this._db.prepare(`INSERT INTO shadow_predictions
            (ts, symbol, model_name, prediction, confidence, features_hash, feature_count, inference_ms,
             live_brain_decision, live_brain_confidence, reference_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            ts, symbol, name, direction, confidence, featuresHash, features.length, inferenceMs,
            liveBrainDecision?.direction || liveBrainDecision?.decision || null,
            liveBrainDecision?.confidence || null,
            referencePrice,
          );
        } catch(dbErr) {
          this._stats.errors++;
          this._stats.byModel[name].errors++;
        }
        results.push({ name, direction, confidence, inferenceMs });
      } catch(e) {
        this._stats.errors++;
        if (this._stats.byModel[name]) this._stats.byModel[name].errors++;
        results.push({ name, error: e.message });
      }
    }
    return { ok: true, ts, symbol, results };
  },

  // ─── Outcome-Evaluation Cron ────────────────────────────────────
  startOutcomeCron() {
    if (this._outcomeCron) clearInterval(this._outcomeCron);
    this._outcomeCron = setInterval(() => this._evaluateOpenPredictions().catch(()=>{}), this._outcomeIntervalMs);
  },
  stopOutcomeCron() {
    if (this._outcomeCron) { clearInterval(this._outcomeCron); this._outcomeCron = null; }
  },

  async _evaluateOpenPredictions() {
    // AUDFIX_MEGA_FINALE [2026-05-19]: Filter-Fenster erweitert.
    // ALT: ts in [now-90min, now-60min] (30-min-Slot, verlor alle Predictions die in Bot-Down-Lücke fielen)
    // NEU: alle ungewerteten Predictions zwischen 60min-14d alt → holt auch Backlog auf.
    // Outcome-Vergleich nutzt candle_cache (1h-Granularity, +-30min Toleranz) statt nur Live-Ticker.
    const now = Date.now();
    const minAge = 60 * 60 * 1000;       // mind. 1h alt
    const maxAge = 14 * 24 * 60 * 60 * 1000; // max 14d alt
    const open = this._db.prepare(`SELECT id, symbol, prediction, reference_price, ts
      FROM shadow_predictions
      WHERE actual_outcome IS NULL
        AND reference_price IS NOT NULL
        AND ts < ? AND ts > ?
      ORDER BY ts ASC
      LIMIT 200`).all(now - minAge, now - maxAge);
    if (!open.length) return { evaluated: 0 };

    let evaluated = 0, notEvaluable = 0;
    for (const p of open) {
      try {
        // 1. Candle-Cache: nimm den 1h-Candle der ~1h nach prediction-ts liegt
        const targetTs = p.ts + 60 * 60 * 1000;
        const candle = this._db.prepare(`SELECT close FROM candle_cache
          WHERE symbol=? AND granularity='1h' AND ts BETWEEN ? AND ?
          ORDER BY ABS(ts - ?) ASC LIMIT 1`)
          .get(p.symbol, targetTs - 30 * 60 * 1000, targetTs + 30 * 60 * 1000, targetTs);

        let currentPrice = null;
        if (candle && candle.close) {
          currentPrice = parseFloat(candle.close);
        } else if (now - p.ts < 2 * 60 * 60 * 1000 && this._bitget) {
          // Nur für Predictions <2h alt: Live-Ticker als Fallback
          const ticker = await this._bitget.fetchTicker(p.symbol).catch(() => null);
          if (ticker && ticker.lastPr) currentPrice = parseFloat(ticker.lastPr);
        }

        if (!currentPrice || !isFinite(currentPrice)) {
          // Markiere als nicht-evaluierbar (is_correct=-1) damit's nicht jedes mal versucht wird
          this._db.prepare(`UPDATE shadow_predictions
            SET actual_outcome='NO_DATA', outcome_evaluated_at=?, is_correct=-1
            WHERE id=?`).run(Date.now(), p.id);
          notEvaluable++;
          continue;
        }

        const ret = (currentPrice - p.reference_price) / p.reference_price;
        let actualOutcome;
        if (Math.abs(ret) < 0.001) actualOutcome = 'HOLD';
        else if (ret > 0) actualOutcome = 'BUY';
        else actualOutcome = 'SELL';
        const isCorrect = p.prediction === actualOutcome ? 1 : 0;
        this._db.prepare(`UPDATE shadow_predictions
          SET actual_outcome=?, outcome_evaluated_at=?, is_correct=?
          WHERE id=?`).run(actualOutcome, Date.now(), isCorrect, p.id);
        evaluated++;
      } catch(e) { /* skip on error */ }
    }
    try { if (typeof Log !== 'undefined' && (evaluated || notEvaluable)) Log.info('OUTCOME_EVAL', `evaluated=${evaluated} notEvaluable=${notEvaluable} backlog=${open.length}`); } catch(_) {}
    return { evaluated, notEvaluable };
  },

  // ─── Stats ──────────────────────────────────────────────────────
  getStats(modelName, hoursAgo = 24) {
    const since = Date.now() - hoursAgo * 60 * 60 * 1000;
    const sql = modelName
      ? `SELECT COUNT(*) AS total,
           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
           SUM(CASE WHEN actual_outcome IS NOT NULL THEN 1 ELSE 0 END) AS evaluated
         FROM shadow_predictions WHERE model_name=? AND ts > ?`
      : `SELECT model_name, COUNT(*) AS total,
           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
           SUM(CASE WHEN actual_outcome IS NOT NULL THEN 1 ELSE 0 END) AS evaluated
         FROM shadow_predictions WHERE ts > ? GROUP BY model_name`;
    const args = modelName ? [modelName, since] : [since];
    return this._db.prepare(sql).all(...args);
  },

  getCompareReport(hoursAgo = 24) {
    const rows = this.getStats(null, hoursAgo);
    return rows.map(r => ({
      model: r.model_name,
      total: r.total,
      evaluated: r.evaluated,
      correct: r.correct,
      accuracy: r.evaluated > 0 ? r.correct / r.evaluated : null,
    }));
  },

  snapshot() {
    return {
      enabled: this.enabled,
      initialized: this._initialized,
      modelsLoaded: Object.keys(this.models),
      stats: this._stats,
    };
  },

  _hashFeatures(arr) {
    // simple hash
    let h = 0;
    for (let i = 0; i < arr.length; i++) {
      h = ((h << 5) - h + Math.round(arr[i] * 1000)) | 0;
    }
    return String(h);
  },
};

module.exports = ShadowInference;
