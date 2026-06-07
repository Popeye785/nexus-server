// modules/lstm_engine.js — Echter LSTM (TensorFlow.js)
// AUDFIX_P5_LSTM_ENGINE [2026-05-18]
//
// Echte LSTM-Architektur mit @tensorflow/tfjs (pure-JS Backend wegen
// macOS-arm64 + Node-20 Build-Issue mit tfjs-node).
//
// Architektur:
// - Input: 60 Time-Steps × 9 Features
// - LSTM(64, return_sequences=true)
// - Dropout(0.2)
// - LSTM(32)
// - Dropout(0.2)
// - Dense(16, ReLU)
// - Dense(1, Sigmoid)
//
// Features: Close-Return, Volume-Z, RSI/100, MACD-Norm, BB-Pos,
//           ATR-Norm, Lag1-Return, Lag5-Return, Lag20-Return
//
// SEPARAT vom Live-AladdinBrain — kein Eingriff in Brain-Logik.

'use strict';

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

const LOOKBACK = 60;
const FEATURE_DIM = 9;

// ──────────────────────────────────────────────────────────────────────────
// Indikatoren (pure-JS)
// ──────────────────────────────────────────────────────────────────────────
function ema(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let e = arr[arr.length - period];
  for (let i = arr.length - period + 1; i < arr.length; i++) {
    e = arr[i] * k + e * (1 - k);
  }
  return e;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  const aG = g / period, aL = l / period;
  if (aL === 0) return 100;
  return 100 - 100 / (1 + aG / aL);
}

function atr(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return 0;
  const trs = [];
  for (let i = highs.length - period; i < highs.length; i++) {
    if (i === 0) { trs.push(highs[i] - lows[i]); continue; }
    const a = highs[i] - lows[i];
    const b = Math.abs(highs[i] - closes[i - 1]);
    const c = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(a, b, c));
  }
  return trs.reduce((s, x) => s + x, 0) / trs.length;
}

function bbPosition(closes, period = 20) {
  if (closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period);
  if (sd === 0) return 0.5;
  const upper = mean + 2 * sd;
  const lower = mean - 2 * sd;
  const last = closes[closes.length - 1];
  return Math.max(0, Math.min(1, (last - lower) / (upper - lower)));
}

function macdNorm(closes) {
  if (closes.length < 26) return 0;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  if (!e12 || !e26) return 0;
  return (e12 - e26) / closes[closes.length - 1];
}

function zScore(arr, period = 20) {
  if (arr.length < period) return 0;
  const slice = arr.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period);
  if (sd === 0) return 0;
  return (arr[arr.length - 1] - mean) / sd;
}

// ──────────────────────────────────────────────────────────────────────────
// Feature-Extraktion: 60 Time-Steps × 9 Features
// ──────────────────────────────────────────────────────────────────────────
function extractFeatures(candles, idx) {
  if (idx < LOOKBACK) return null;
  const seq = candles.slice(idx - LOOKBACK, idx);
  const features = [];
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    const prev = i > 0 ? seq[i - 1] : c;
    const ret = (c.close - prev.close) / (prev.close || 1);
    // Sub-window für Indikatoren
    const subStart = Math.max(0, idx - LOOKBACK + i - 30);
    const subEnd = idx - LOOKBACK + i + 1;
    const sub = candles.slice(subStart, subEnd);
    const subCloses = sub.map(x => x.close);
    const subHighs = sub.map(x => x.high);
    const subLows = sub.map(x => x.low);
    const subVols = sub.map(x => x.volume);
    const r14 = rsi(subCloses, 14) / 100;
    const macd = macdNorm(subCloses);
    const bbPos = bbPosition(subCloses, 20);
    const atrV = atr(subHighs, subLows, subCloses, 14);
    const atrNorm = atrV / (c.close || 1);
    const volZ = zScore(subVols, 20);
    const lag1 = i >= 1 ? (seq[i].close - seq[i - 1].close) / (seq[i - 1].close || 1) : 0;
    const lag5 = i >= 5 ? (seq[i].close - seq[i - 5].close) / (seq[i - 5].close || 1) : 0;
    const lag20 = i >= 20 ? (seq[i].close - seq[i - 20].close) / (seq[i - 20].close || 1) : 0;
    features.push([ret, r14, macd, bbPos, atrNorm, volZ, lag1, lag5, lag20]);
  }
  return features; // [60][9]
}

// Label: binary up (1) / down (0) — based on next-hour return
function extractLabel(candles, idx, threshold = 0.001) {
  if (idx + 1 >= candles.length) return null;
  const ret = (candles[idx + 1].close - candles[idx].close) / candles[idx].close;
  if (Math.abs(ret) < threshold) return null; // skip flat
  return ret > 0 ? 1 : 0;
}

// ──────────────────────────────────────────────────────────────────────────
// Normalisierung: Z-Score-fit auf Trainingsset
// ──────────────────────────────────────────────────────────────────────────
function fitNormalizer(X) {
  // X = [N][60][9] → Mean/SD pro Feature über N×60
  const sums = new Array(FEATURE_DIM).fill(0);
  const sqs = new Array(FEATURE_DIM).fill(0);
  let count = 0;
  for (const sample of X) {
    for (const step of sample) {
      for (let f = 0; f < FEATURE_DIM; f++) {
        sums[f] += step[f]; sqs[f] += step[f] * step[f]; count++;
      }
    }
  }
  const cnt = count / FEATURE_DIM;
  const mean = sums.map(s => s / cnt);
  const sd = sums.map((s, f) => Math.sqrt(sqs[f] / cnt - (s / cnt) ** 2) || 1);
  return { mean, sd };
}

function normalize(X, norm) {
  return X.map(sample => sample.map(step => step.map((v, f) => (v - norm.mean[f]) / norm.sd[f])));
}

// ──────────────────────────────────────────────────────────────────────────
// Modell-Architektur
// ──────────────────────────────────────────────────────────────────────────
function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.lstm({ units: 64, returnSequences: true, inputShape: [LOOKBACK, FEATURE_DIM] }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.lstm({ units: 32 }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

// ──────────────────────────────────────────────────────────────────────────
// Dataset bauen aus candles
// ──────────────────────────────────────────────────────────────────────────
function buildDataset(candles, startIdx = 0, endIdx = null) {
  endIdx = endIdx || candles.length;
  const X = [], y = [];
  for (let i = Math.max(LOOKBACK, startIdx); i < endIdx - 1; i++) {
    const feat = extractFeatures(candles, i);
    if (!feat) continue;
    const lbl = extractLabel(candles, i);
    if (lbl === null) continue;
    X.push(feat);
    y.push(lbl);
  }
  return { X, y };
}

// ──────────────────────────────────────────────────────────────────────────
// Training
// ──────────────────────────────────────────────────────────────────────────
async function train(candles, opts = {}) {
  const trainStart = opts.trainStart || LOOKBACK;
  const trainEnd = opts.trainEnd || Math.floor(candles.length * 0.8);
  const epochs = opts.epochs || 10;
  const batchSize = opts.batchSize || 64;
  const valSplit = opts.valSplit || 0.2;
  const earlyStopPatience = opts.earlyStopPatience || 5;

  console.log(`[LSTM] buildDataset candles[${trainStart}..${trainEnd}]...`);
  const ds = buildDataset(candles, trainStart, trainEnd);
  console.log(`[LSTM] Samples: ${ds.X.length}`);
  if (ds.X.length < 100) return { ok: false, error: 'Too few samples' };

  // Train/Val Split chronologisch
  const splitIdx = Math.floor(ds.X.length * (1 - valSplit));
  const Xtrain = ds.X.slice(0, splitIdx);
  const ytrain = ds.y.slice(0, splitIdx);
  const Xval = ds.X.slice(splitIdx);
  const yval = ds.y.slice(splitIdx);

  // Normalisieren (fit auf Train only)
  const norm = fitNormalizer(Xtrain);
  const XtrainN = normalize(Xtrain, norm);
  const XvalN = normalize(Xval, norm);

  // tf.tensor
  const XtrainT = tf.tensor3d(XtrainN);
  const ytrainT = tf.tensor2d(ytrain.map(v => [v]));
  const XvalT = tf.tensor3d(XvalN);
  const yvalT = tf.tensor2d(yval.map(v => [v]));

  const model = buildModel();
  console.log(`[LSTM] Model built. Train ${Xtrain.length} / Val ${Xval.length}`);
  model.summary();

  const history = { loss: [], val_loss: [], acc: [], val_acc: [] };
  let bestValLoss = Infinity;
  let bestWeights = null;
  let patienceCounter = 0;

  for (let ep = 0; ep < epochs; ep++) {
    const h = await model.fit(XtrainT, ytrainT, {
      epochs: 1,
      batchSize,
      validationData: [XvalT, yvalT],
      verbose: 0,
    });
    const loss = h.history.loss[0];
    const valLoss = h.history.val_loss[0];
    const acc = h.history.acc[0];
    const valAcc = h.history.val_acc[0];
    history.loss.push(loss);
    history.val_loss.push(valLoss);
    history.acc.push(acc);
    history.val_acc.push(valAcc);
    console.log(`[LSTM] Epoch ${ep + 1}/${epochs} loss=${loss.toFixed(4)} val_loss=${valLoss.toFixed(4)} acc=${acc.toFixed(4)} val_acc=${valAcc.toFixed(4)}`);

    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;
      bestWeights = model.getWeights().map(w => w.clone());
      patienceCounter = 0;
    } else {
      patienceCounter++;
      if (patienceCounter >= earlyStopPatience) {
        console.log(`[LSTM] Early stop at epoch ${ep + 1}`);
        break;
      }
    }
  }

  if (bestWeights) {
    model.setWeights(bestWeights);
    bestWeights.forEach(w => w.dispose());
  }

  XtrainT.dispose(); ytrainT.dispose(); XvalT.dispose(); yvalT.dispose();

  return { ok: true, model, norm, history, bestValLoss, samplesTrain: Xtrain.length, samplesVal: Xval.length };
}

// ──────────────────────────────────────────────────────────────────────────
// Speichern & Laden (Modell als Weights-Array + Norm)
// ──────────────────────────────────────────────────────────────────────────
async function save(model, norm, dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const weights = model.getWeights();
  const weightsData = await Promise.all(weights.map(w => w.array()));
  fs.writeFileSync(path.join(dir, 'weights.json'), JSON.stringify(weightsData));
  fs.writeFileSync(path.join(dir, 'norm.json'), JSON.stringify(norm));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lookback: LOOKBACK, featureDim: FEATURE_DIM, savedAt: Date.now() }));
  return { ok: true, dir, files: ['weights.json', 'norm.json', 'config.json'] };
}

async function load(dir) {
  const weightsData = JSON.parse(fs.readFileSync(path.join(dir, 'weights.json'), 'utf8'));
  const norm = JSON.parse(fs.readFileSync(path.join(dir, 'norm.json'), 'utf8'));
  const model = buildModel();
  const weights = weightsData.map(arr => tf.tensor(arr));
  model.setWeights(weights);
  return { ok: true, model, norm };
}

// ──────────────────────────────────────────────────────────────────────────
// Test / Inferenz auf Test-Set
// ──────────────────────────────────────────────────────────────────────────
async function evaluate(model, norm, candles, startIdx, endIdx) {
  const ds = buildDataset(candles, startIdx, endIdx);
  if (ds.X.length === 0) return { ok: false, error: 'No test samples' };
  const Xnorm = normalize(ds.X, norm);
  const Xt = tf.tensor3d(Xnorm);
  const predT = model.predict(Xt);
  const preds = await predT.array();
  Xt.dispose(); predT.dispose();
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i][0] > 0.5 ? 1 : 0;
    const t = ds.y[i];
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

module.exports = { buildModel, train, save, load, evaluate, extractFeatures, buildDataset, normalize, fitNormalizer, LOOKBACK, FEATURE_DIM };
