// modules/gru_engine.js — GRU (Gated Recurrent Unit)
// AUDFIX_MLV2_P3 [2026-05-18]
// PMC 2025 zeigt: GRU > LSTM für Crypto-Price-Prediction
// Backend: @tensorflow/tfjs pure-JS (Fallback wegen tfjs-node-Build-Fail)

'use strict';

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

const LOOKBACK = 30;
const FEATURE_DIM = 56;

function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.gru({ units: 64, returnSequences: true, inputShape: [LOOKBACK, FEATURE_DIM] }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.gru({ units: 32 }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'binaryCrossentropy', metrics: ['accuracy'] });
  return model;
}

// Buildet Sequenzen aus Feature-Vektoren: jeder Sample = [60][N_FEATURES]
function buildSequences(featureRows, labels) {
  const X = [], y = [];
  for (let i = LOOKBACK; i < featureRows.length; i++) {
    X.push(featureRows.slice(i - LOOKBACK, i));
    y.push(labels[i]);
  }
  return { X, y };
}

async function train(featureRows, labels, opts = {}) {
  const epochs = opts.epochs || 8;
  const batchSize = opts.batchSize || 32;
  const valSplit = opts.valSplit || 0.2;
  const earlyStopPatience = opts.earlyStopPatience || 3;
  const seq = buildSequences(featureRows, labels);
  if (seq.X.length < 100) return { ok: false, error: 'Too few sequences' };
  const splitIdx = Math.floor(seq.X.length * (1 - valSplit));
  const Xtrain = seq.X.slice(0, splitIdx), ytrain = seq.y.slice(0, splitIdx);
  const Xval = seq.X.slice(splitIdx), yval = seq.y.slice(splitIdx);
  const XtrainT = tf.tensor3d(Xtrain);
  const ytrainT = tf.tensor2d(ytrain.map(v => [v]));
  const XvalT = tf.tensor3d(Xval);
  const yvalT = tf.tensor2d(yval.map(v => [v]));
  const model = buildModel();
  console.log(`[GRU] Train ${Xtrain.length} / Val ${Xval.length}, ${epochs} epochs`);
  model.summary();
  const history = { loss: [], val_loss: [], acc: [], val_acc: [] };
  let bestValLoss = Infinity, bestWeights = null, patience = 0;
  for (let ep = 0; ep < epochs; ep++) {
    const h = await model.fit(XtrainT, ytrainT, { epochs: 1, batchSize, validationData: [XvalT, yvalT], verbose: 0 });
    const loss = h.history.loss[0], valLoss = h.history.val_loss[0];
    const acc = h.history.acc[0], valAcc = h.history.val_acc[0];
    history.loss.push(loss); history.val_loss.push(valLoss);
    history.acc.push(acc); history.val_acc.push(valAcc);
    console.log(`[GRU] Epoch ${ep + 1}/${epochs} loss=${loss.toFixed(4)} val_loss=${valLoss.toFixed(4)} acc=${acc.toFixed(4)} val_acc=${valAcc.toFixed(4)}`);
    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;
      bestWeights = model.getWeights().map(w => w.clone());
      patience = 0;
    } else {
      patience++;
      if (patience >= earlyStopPatience) { console.log(`[GRU] Early stop`); break; }
    }
  }
  if (bestWeights) { model.setWeights(bestWeights); bestWeights.forEach(w => w.dispose()); }
  XtrainT.dispose(); ytrainT.dispose(); XvalT.dispose(); yvalT.dispose();
  return { ok: true, model, history, bestValLoss };
}

async function evaluate(model, featureRows, labels) {
  const seq = buildSequences(featureRows, labels);
  if (seq.X.length === 0) return { ok: false, error: 'No test sequences' };
  const Xt = tf.tensor3d(seq.X);
  const predT = model.predict(Xt);
  const preds = await predT.array();
  Xt.dispose(); predT.dispose();
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i][0] > 0.5 ? 1 : 0;
    const t = seq.y[i];
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
  return { ok: true, total, tp, tn, fp, fn, accuracy, precision, recall, f1 };
}

module.exports = { buildModel, train, evaluate, buildSequences, LOOKBACK, FEATURE_DIM };
