// modules/xgboost_engine.js — XGBoost (DeepAlpha-Stil)
// AUDFIX_MLV2_P2 [2026-05-18]
// Pure-JS WASM Implementation via ml-xgboost

'use strict';

const fs = require('fs');
const path = require('path');

let _xgbClass = null;
async function _getXGBoost() {
  if (_xgbClass) return _xgbClass;
  _xgbClass = await require('ml-xgboost');
  return _xgbClass;
}

const DEFAULT_PARAMS = {
  booster: 'gbtree',
  objective: 'binary:logistic',
  max_depth: 6,
  eta: 0.05,            // learning_rate
  n_estimators: 100,    // wasm-Variante akzeptiert 'iterations' / numRound
  iterations: 100,
  silent: 1,
  subsample: 0.8,
  colsample_bytree: 0.8,
  min_child_weight: 1,
};

async function train(X, y, opts = {}) {
  const XGBoost = await _getXGBoost();
  const params = { ...DEFAULT_PARAMS, ...opts };
  const model = new XGBoost(params);
  console.log(`[XGBoost] Training ${X.length} samples × ${X[0].length} features, ${params.iterations} iterations`);
  const t0 = Date.now();
  model.train(X, y);
  const t1 = Date.now();
  console.log(`[XGBoost] Train done in ${((t1 - t0) / 1000).toFixed(1)}s`);
  return { ok: true, model, params, durationMs: t1 - t0 };
}

async function evaluate(model, X, y) {
  const preds = model.predict(X);
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i] > 0.5 ? 1 : 0;
    const t = y[i];
    if (p === 1 && t === 1) tp++;
    else if (p === 0 && t === 0) tn++;
    else if (p === 1 && t === 0) fp++;
    else fn++;
  }
  const total = preds.length;
  const accuracy = (tp + tn) / total;
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = 2 * precision * recall / Math.max(1e-6, precision + recall);
  return { total, tp, tn, fp, fn, accuracy, precision, recall, f1, preds };
}

function save(model, dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // ml-xgboost has .toJSON() or model.save()
  try {
    const json = model.toJSON ? model.toJSON() : (model.save ? model.save() : null);
    fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(json));
    return { ok: true, dir };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { train, evaluate, save, DEFAULT_PARAMS };
