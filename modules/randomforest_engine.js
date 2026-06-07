// modules/randomforest_engine.js — Random Forest als Vergleichsmodell
// AUDFIX_MLV2_P2 [2026-05-18]
// Uses ml-random-forest (pure-JS)

'use strict';

const fs = require('fs');
const path = require('path');
const { RandomForestClassifier } = require('ml-random-forest');

const DEFAULT_PARAMS = {
  nEstimators: 100,
  maxFeatures: 0.8,
  replacement: true,
  seed: 42,
};

function train(X, y, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...opts };
  console.log(`[RF] Training ${X.length} × ${X[0].length} features, ${params.nEstimators} trees`);
  const t0 = Date.now();
  const model = new RandomForestClassifier(params);
  model.train(X, y);
  const t1 = Date.now();
  console.log(`[RF] Train done in ${((t1 - t0) / 1000).toFixed(1)}s`);
  return { ok: true, model, params, durationMs: t1 - t0 };
}

function evaluate(model, X, y) {
  const preds = model.predict(X);
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i];
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
  try {
    const json = model.toJSON();
    fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(json));
    return { ok: true, dir };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { train, evaluate, save, DEFAULT_PARAMS };
