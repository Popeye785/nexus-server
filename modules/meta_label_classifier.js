// modules/meta_label_classifier.js — Echter trainierter ML-Classifier (Block F Item 1)
// Lopez de Prado Ch.3.5 — sekundärer Classifier auf Brain-Sub-Source-Votes.
//
// Ersetzt FIX 42 brain-precision-Approximation durch trainierten RandomForest.
// Lädt models/meta_label_classifier.json (vom scripts/train_meta_label_classifier.js erzeugt).
// Fallback: brain-precision wenn Modell nicht da oder n<50 Training-Samples.
//
// API:
//   MLC.isAvailable()      → true wenn Modell geladen + brauchbar
//   MLC.meta()             → Modell-Meta (accuracy, n_train, etc)
//   MLC.predictProba(features) → P(Brain-Entscheidung-korrekt) ∈ [0,1]
//   MLC.featuresFromBrain({ scores, decisionConf, unifiedConf, regime }) → 10-dim Vektor

'use strict';

const fs = require('fs');
const path = require('path');
const { RandomForestClassifier } = require('ml-random-forest');

const MODEL_PATH = path.join(__dirname, '..', 'models', 'meta_label_classifier.json');
const MIN_N_TRAIN = 50;

let _modelMeta = null;
let _classifier = null;
let _loadErr = null;

function _load() {
  if (_modelMeta || _loadErr) return;
  try {
    if (!fs.existsSync(MODEL_PATH)) { _loadErr = 'MODEL_FILE_MISSING'; return; }
    const raw = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
    if (!raw || !raw.meta || !raw.model) { _loadErr = 'MODEL_FORMAT_INVALID'; return; }
    if (raw.meta.n_train < MIN_N_TRAIN) { _loadErr = `N_TRAIN_TOO_SMALL_${raw.meta.n_train}`; return; }
    _classifier = RandomForestClassifier.load(raw.model);
    _modelMeta = raw.meta;
  } catch (e) {
    _loadErr = 'LOAD_ERROR_' + (e.message || e).slice(0, 80);
  }
}

const MLC = {
  isAvailable() { _load(); return _classifier !== null && _modelMeta !== null; },
  loadError() { return _loadErr; },
  meta() { _load(); return _modelMeta ? { ..._modelMeta } : null; },

  featuresFromBrain({ scores, decisionConf, unifiedConf, regime } = {}) {
    const fam = (k) => {
      const f = scores && scores[k];
      return f && typeof f.score === 'number' ? f.score : 0;
    };
    const r = String(regime || 'NEUTRAL').toUpperCase();
    return [
      fam('TREND'),
      fam('MOMENTUM'),
      fam('RISK'),
      fam('SENTIMENT'),
      fam('MICROSTRUCTURE'),
      Number.isFinite(decisionConf) ? decisionConf : 0.5,
      Number.isFinite(unifiedConf)  ? unifiedConf  : 0.5,
      r.includes('BULL') ? 1 : 0,
      r.includes('BEAR') ? 1 : 0,
      r.includes('SQUEEZE') ? 1 : 0,
    ];
  },

  predictProba(features) {
    _load();
    if (!_classifier) return null;
    if (!Array.isArray(features) || features.length !== 10) return null;
    try {
      // ml-random-forest's predictProbability is unreliable here (returns near-0 for all binary class=1 cases).
      // We compute the proba manually as mean over estimators' hard predictions.
      // This matches the standard RF interpretation: P(class=1) = fraction of trees voting class=1.
      const ests = _classifier.estimators;
      if (Array.isArray(ests) && ests.length > 0) {
        let sum = 0;
        for (const tree of ests) {
          const p = tree.predict([features]);
          if (p && p[0] === 1) sum += 1;
        }
        return sum / ests.length;
      }
      // Fallback: hard predict
      const pred = _classifier.predict([features]);
      return pred && pred[0] === 1 ? 1.0 : 0.0;
    } catch (_) {
      return null;
    }
  },

  // Brain-Confidence-Modulator basierend auf classifier prediction.
  // Block G Item 1 [26.05.2026] — Schwellen-Tuning: alte 0.40/0.55/0.75 → 0.20/0.40/0.65
  // Begründung: Modell-Sample-Verteilung 0.14-0.38 → ALLE waren CLASSIFIER_LOW (100%) — zu konservativ.
  // Mit neuen Schwellen: nur extreme low (<0.20) wird Decay-stark (×0.6), mid-range modulates lighter.
  modulator(prob) {
    if (prob === null || prob === undefined || !Number.isFinite(prob)) return { mult: 1.0, source: 'NULL_FALLBACK' };
    if (prob >= 0.65) return { mult: 1.10, source: 'CLASSIFIER_HIGH' };
    if (prob >= 0.40) return { mult: 1.00, source: 'CLASSIFIER_NEUTRAL' };
    if (prob >= 0.20) return { mult: 0.85, source: 'CLASSIFIER_DOUBT' };
    return { mult: 0.60, source: 'CLASSIFIER_LOW' };
  },
};

module.exports = MLC;
