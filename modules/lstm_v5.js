// modules/lstm_v5.js — LogReg_v5 (LSTM-shaped Surrogate)
// AUDFIX_P1_ETIKETTEN [2026-05-18]: Ehrlicher Display-Name
// Inference via onnxruntime-node gegen models/lstm_*.onnx
// Tatsächlich: rolling logistic regression mit Online-SGD (KEIN echter LSTM)
// Echter LSTM in PHASE 5+ als modules/lstm_engine.js separat gebaut.
// Predictions NICHT automatisch in UnifiedScore — READ-ONLY zur Analyse.

'use strict';

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'models');
let ort = null;
try { ort = require('onnxruntime-node'); } catch (e) { /* ONNX optional */ }

const jobs = {};
let _counter = 0;
function newJobId() { return `LSTM-${Date.now()}-${++_counter}`; }

// Feature extraction: 21-dimensional UnifiedScore-style vector aus candle sequence
function extractFeatures(candles, idx, lookback = 60) {
  if (idx < lookback) return null;
  const seq = candles.slice(idx - lookback, idx);
  const closes = seq.map(c => c.close);
  const volumes = seq.map(c => c.volume || 0);
  const highs = seq.map(c => c.high);
  const lows = seq.map(c => c.low);

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = (arr, m = mean(arr)) => Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  const mc = mean(closes), sc = std(closes, mc);
  const mv = mean(volumes), sv = std(volumes, mv);

  // Returns over different windows
  const ret1 = (closes[lookback - 1] - closes[lookback - 2]) / closes[lookback - 2];
  const ret5 = (closes[lookback - 1] - closes[lookback - 6]) / closes[lookback - 6];
  const ret20 = (closes[lookback - 1] - closes[lookback - 21]) / closes[lookback - 21];
  const ret60 = (closes[lookback - 1] - closes[0]) / closes[0];

  // High-Low range avg
  const ranges = highs.map((h, i) => (h - lows[i]) / closes[i]);
  const avgRange = mean(ranges);

  // Z-score price
  const zPrice = (closes[lookback - 1] - mc) / (sc || 1);
  const zVol = (volumes[lookback - 1] - mv) / (sv || 1);

  // Simple RSI approximation
  let gains = 0, losses = 0;
  for (let i = 1; i < lookback; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = losses > 0 ? gains / losses : 99;
  const rsi = 100 - 100 / (1 + rs);

  // EMA-fast/slow + cross
  let emaF = closes[0], emaS = closes[0];
  const kF = 2 / (10 + 1), kS = 2 / (30 + 1);
  for (let i = 1; i < lookback; i++) {
    emaF = closes[i] * kF + emaF * (1 - kF);
    emaS = closes[i] * kS + emaS * (1 - kS);
  }
  const emaCross = (emaF - emaS) / emaS;

  return [
    ret1, ret5, ret20, ret60, avgRange,
    zPrice, zVol, rsi / 100, emaCross,
    sc / mc, // CV of close
    sv / (mv || 1), // CV of vol
    closes[lookback - 1] / mc - 1, // distance from mean
    Math.min(...closes.slice(-5)) / mc - 1, // recent min vs mean
    Math.max(...closes.slice(-5)) / mc - 1, // recent max vs mean
    ranges[lookback - 1], // current range
    avgRange / ranges[lookback - 1] - 1, // range vs avg
    emaF / closes[lookback - 1] - 1,
    emaS / closes[lookback - 1] - 1,
    Math.log1p(volumes[lookback - 1] / (mv || 1)),
    closes[lookback - 1] > closes[lookback - 5] ? 1 : 0,
    closes[lookback - 1] > closes[lookback - 20] ? 1 : 0,
  ]; // 21 features
}

// Light surrogate "trainer" — logistic regression with online SGD on direction labels
function surrogateTrain(candles, opts) {
  const lookback = opts.lookback || 60;
  const horizon = opts.horizon || 5; // predict 5 candles ahead direction
  const lr = opts.lr || 0.01;
  const epochs = opts.epochs || 3;
  let w = new Array(21).fill(0).map(() => (Math.random() - 0.5) * 0.01);
  let b = 0;

  const samples = [];
  for (let i = lookback; i < candles.length - horizon; i++) {
    const x = extractFeatures(candles, i, lookback);
    if (!x) continue;
    const future = candles[i + horizon].close;
    const now = candles[i].close;
    const y = future > now ? 1 : 0;
    samples.push({ x, y });
  }
  // Split 80/20 train/test
  const trainEnd = Math.floor(samples.length * 0.8);
  const train = samples.slice(0, trainEnd);
  const test = samples.slice(trainEnd);

  for (let e = 0; e < epochs; e++) {
    for (const s of train) {
      const z = s.x.reduce((acc, v, i) => acc + v * w[i], b);
      const p = 1 / (1 + Math.exp(-z));
      const err = p - s.y;
      for (let i = 0; i < 21; i++) w[i] -= lr * err * s.x[i];
      b -= lr * err;
    }
  }
  // Eval on test
  let correct = 0, total = test.length;
  for (const s of test) {
    const z = s.x.reduce((acc, v, i) => acc + v * w[i], b);
    const p = 1 / (1 + Math.exp(-z));
    const pred = p > 0.5 ? 1 : 0;
    if (pred === s.y) correct++;
  }
  return {
    weights: w, bias: b,
    trainSamples: train.length,
    testSamples: test.length,
    directionalAccuracy: total ? +(correct / total).toFixed(4) : 0,
    note: 'Logistic-regression surrogate. Real LSTM training pipeline needs Python-side trainer producing .onnx.',
  };
}

function predictSurrogate(model, features) {
  const z = features.reduce((acc, v, i) => acc + v * model.weights[i], model.bias);
  const p = 1 / (1 + Math.exp(-z));
  return { probability: +p.toFixed(4), prediction: p > 0.5 ? 'UP' : 'DOWN' };
}

async function inferONNX(modelPath, features) {
  if (!ort) throw new Error('onnxruntime-node not loaded');
  if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  const session = await ort.InferenceSession.create(modelPath);
  // Adapt input name/shape based on model. We try generic input name.
  const inputName = session.inputNames[0];
  // Construct Float32Array tensor [1, 60, 21] shape (placeholder)
  const tensor = new ort.Tensor('float32', new Float32Array(features), [1, features.length]);
  const result = await session.run({ [inputName]: tensor });
  return result;
}

const modelCache = {}; // symbol → surrogate model

async function runTrain(jobId, opts, ctx) {
  const job = jobs[jobId];
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const symbol = opts.symbol || 'BTCUSDT';
    const granularity = opts.granularity || '4h';
    const Bitget = ctx.Bitget;
    if (!Bitget || !Bitget.fetchCandles) throw new Error('Bitget unavailable');
    const candles = await Bitget.fetchCandles(symbol, granularity, opts.candleLimit || 1500);
    if (!candles || candles.length < 200) throw new Error('insufficient candles');
    const result = surrogateTrain(candles, opts);
    modelCache[symbol] = result;
    // Save model to disk for persistence
    try {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(MODELS_DIR, `lstm_v5_surrogate_${symbol}.json`),
        JSON.stringify({ ...result, symbol, granularity, trainedAt: Date.now() }, null, 2)
      );
    } catch (e) { /* non-fatal */ }
    job.status = 'complete';
    job.completedAt = Date.now();
    job.result = { symbol, granularity, ...result };
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
}

function startTrain(opts, ctx) {
  const jobId = newJobId();
  jobs[jobId] = { jobId, status: 'queued', opts };
  setImmediate(() => runTrain(jobId, opts, ctx));
  return { jobId, status: 'queued' };
}
function getStatus(jobId) {
  const j = jobs[jobId];
  return j ? { jobId, status: j.status, error: j.error } : { error: 'JOB_NOT_FOUND' };
}
function getResult(jobId) {
  const j = jobs[jobId];
  if (!j) return { error: 'JOB_NOT_FOUND' };
  return { jobId, status: j.status, ...j.result };
}

async function predict(symbol, ctx, opts = {}) {
  let model = modelCache[symbol];
  if (!model) {
    // Try load from disk
    const p = path.join(MODELS_DIR, `lstm_v5_surrogate_${symbol}.json`);
    if (fs.existsSync(p)) {
      model = JSON.parse(fs.readFileSync(p, 'utf8'));
      modelCache[symbol] = model;
    } else {
      return { error: 'MODEL_NOT_TRAINED', symbol, hint: 'POST /api/lstm/train/' + symbol + ' first' };
    }
  }
  const Bitget = ctx.Bitget;
  const candles = await Bitget.fetchCandles(symbol, opts.granularity || '4h', 100);
  if (!candles || candles.length < 65) return { error: 'insufficient_recent_candles' };
  const features = extractFeatures(candles, candles.length - 1, 60);
  if (!features) return { error: 'feature_extraction_failed' };
  const out = predictSurrogate(model, features);
  return {
    symbol,
    ts: Date.now(),
    features,
    ...out,
    trainedAt: model.trainedAt,
    directionalAccuracyOnTrain: model.directionalAccuracy,
    note: 'Surrogate prediction. NOT piped into UnifiedScore.',
  };
}

function listTrainedModels() {
  try {
    return fs.readdirSync(MODELS_DIR)
      .filter(f => f.startsWith('lstm_v5_surrogate_') && f.endsWith('.json'))
      .map(f => f.replace('lstm_v5_surrogate_', '').replace('.json', ''));
  } catch (_) { return []; }
}

module.exports = { startTrain, getStatus, getResult, predict, listTrainedModels, extractFeatures, inferONNX };
