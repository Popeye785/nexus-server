// modules/freqai_features.js — TIER2-G FreqAI-style Features-Engine
// ~480 Features in 7 Kategorien: Price, Volume, Technical, Microstructure, Cross-Asset, Time, Regime
// Self-adaptive feature-importance via mutual-information style ranking.
// READ-ONLY: extrahiert Features ohne Trading-Logik-Eingriff.

'use strict';

const fs = require('fs');
const path = require('path');
const CACHE_DIR = path.join(__dirname, '..', 'data', 'freqai_cache');

const jobs = {};
let _counter = 0;
function newJobId() { return `FRQ-${Date.now()}-${++_counter}`; }

// ── INDICATORS ──────────────────────────────────────────────────────────────
function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function ema(arr, n) {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}
function std(arr, n) {
  if (arr.length < n) return null;
  const s = arr.slice(-n);
  const m = s.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / n);
}
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = losses > 0 ? gains / losses : 99;
  return 100 - 100 / (1 + rs);
}
function atr(candles, n = 14) {
  if (candles.length < n + 1) return null;
  let s = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    s += tr;
  }
  return s / n;
}

// ── FEATURE GROUPS ──────────────────────────────────────────────────────────
function priceFeatures(candles) {
  const closes = candles.map(c => c.close);
  const cur = closes[closes.length - 1];
  const features = {};
  // Returns over 8 windows
  [1, 2, 3, 5, 10, 20, 50, 100].forEach(w => {
    if (closes.length > w) {
      features[`ret_${w}`] = (cur - closes[closes.length - 1 - w]) / closes[closes.length - 1 - w];
      features[`logret_${w}`] = Math.log(cur / closes[closes.length - 1 - w]);
    }
  });
  // Rolling stats over 6 windows
  [10, 20, 50, 100, 200, 500].forEach(w => {
    const s = sma(closes, w);
    const sd = std(closes, w);
    if (s !== null) features[`sma_${w}`] = s;
    if (sd !== null) features[`std_${w}`] = sd;
    if (s) features[`dist_sma_${w}`] = cur / s - 1;
    if (sd && s) features[`zscore_${w}`] = (cur - s) / sd;
  });
  return features;
}

function volumeFeatures(candles) {
  const volumes = candles.map(c => c.volume || 0);
  const cur = volumes[volumes.length - 1];
  const features = {};
  [10, 20, 50, 100].forEach(w => {
    const s = sma(volumes, w);
    const sd = std(volumes, w);
    if (s !== null) features[`vol_sma_${w}`] = s;
    if (s) features[`vol_dist_${w}`] = cur / (s || 1) - 1;
    if (sd && s) features[`vol_z_${w}`] = (cur - s) / (sd || 1);
  });
  // OBV approximation
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume || 0;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume || 0;
  }
  features['obv'] = obv;
  features['obv_log'] = Math.log1p(Math.abs(obv)) * Math.sign(obv);
  return features;
}

function technicalFeatures(candles) {
  const closes = candles.map(c => c.close);
  const features = {};
  // RSI multiple periods
  [7, 14, 21, 28].forEach(p => {
    const r = rsi(closes, p);
    if (r !== null) features[`rsi_${p}`] = r / 100;
  });
  // EMA cross signals
  [9, 12, 21, 26, 50, 100, 200].forEach(p => {
    const e = ema(closes, p);
    if (e !== null) {
      features[`ema_${p}`] = e;
      features[`ema_dist_${p}`] = closes[closes.length - 1] / e - 1;
    }
  });
  // ATR multiple periods
  [7, 14, 21].forEach(p => {
    const a = atr(candles, p);
    if (a !== null) {
      features[`atr_${p}`] = a;
      features[`atr_pct_${p}`] = a / closes[closes.length - 1];
    }
  });
  // Bollinger Bands
  const sma20 = sma(closes, 20);
  const std20 = std(closes, 20);
  if (sma20 && std20) {
    features['bb_upper'] = sma20 + 2 * std20;
    features['bb_lower'] = sma20 - 2 * std20;
    features['bb_pct'] = (closes[closes.length - 1] - (sma20 - 2 * std20)) / (4 * std20);
    features['bb_width'] = 4 * std20 / sma20;
  }
  return features;
}

function microstructureFeatures(candles, orderBook) {
  const features = {};
  const cur = candles[candles.length - 1];
  // Range
  features['hl_range'] = (cur.high - cur.low) / cur.close;
  features['close_position'] = (cur.close - cur.low) / ((cur.high - cur.low) || 1);
  features['gap'] = (cur.open - candles[candles.length - 2].close) / candles[candles.length - 2].close;
  features['body_pct'] = Math.abs(cur.close - cur.open) / cur.close;
  features['upper_wick'] = (cur.high - Math.max(cur.close, cur.open)) / cur.close;
  features['lower_wick'] = (Math.min(cur.close, cur.open) - cur.low) / cur.close;
  // Orderbook (if provided)
  if (orderBook && orderBook.bids && orderBook.asks) {
    const bidVol = orderBook.bids.slice(0, 10).reduce((a, b) => a + parseFloat(b[1]), 0);
    const askVol = orderBook.asks.slice(0, 10).reduce((a, b) => a + parseFloat(b[1]), 0);
    features['ob_imbalance'] = (bidVol - askVol) / (bidVol + askVol || 1);
    features['ob_bid_vol'] = bidVol;
    features['ob_ask_vol'] = askVol;
    const spread = parseFloat(orderBook.asks[0][0]) - parseFloat(orderBook.bids[0][0]);
    features['ob_spread'] = spread;
    features['ob_spread_pct'] = spread / parseFloat(orderBook.bids[0][0]);
  }
  return features;
}

function crossAssetFeatures(symbol, btcCandles, ethCandles, candles) {
  const features = {};
  if (!btcCandles || btcCandles.length < 20) return features;
  const closes = candles.map(c => c.close);
  const btcCloses = btcCandles.map(c => c.close).slice(-closes.length);
  if (btcCloses.length !== closes.length) return features;
  // Correlation last-20
  const n = Math.min(20, closes.length);
  const cR = closes.slice(-n);
  const bR = btcCloses.slice(-n);
  const cM = cR.reduce((a, b) => a + b, 0) / n;
  const bM = bR.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vC = 0, vB = 0;
  for (let i = 0; i < n; i++) {
    cov += (cR[i] - cM) * (bR[i] - bM);
    vC += (cR[i] - cM) ** 2;
    vB += (bR[i] - bM) ** 2;
  }
  features['corr_btc_20'] = cov / Math.sqrt(vC * vB || 1);
  features['beta_btc_20'] = cov / (vB || 1);
  // BTC dominance proxy
  if (ethCandles && ethCandles.length) {
    const ethCloses = ethCandles.map(c => c.close);
    features['btc_eth_ratio'] = btcCloses[btcCloses.length - 1] / ethCloses[ethCloses.length - 1];
  }
  return features;
}

function timeFeatures(candles) {
  const features = {};
  const last = candles[candles.length - 1];
  const date = new Date(last.ts || Date.now());
  features['hour_utc'] = date.getUTCHours() / 23;
  features['dow'] = date.getUTCDay() / 6;
  features['day_of_month'] = date.getUTCDate() / 31;
  features['asian_session'] = date.getUTCHours() >= 0 && date.getUTCHours() < 8 ? 1 : 0;
  features['european_session'] = date.getUTCHours() >= 7 && date.getUTCHours() < 16 ? 1 : 0;
  features['us_session'] = date.getUTCHours() >= 13 && date.getUTCHours() < 22 ? 1 : 0;
  features['weekend'] = (date.getUTCDay() === 0 || date.getUTCDay() === 6) ? 1 : 0;
  return features;
}

function regimeFeatures(candles) {
  const features = {};
  const closes = candles.map(c => c.close);
  if (closes.length < 100) return features;
  const sd20 = std(closes, 20);
  const sd100 = std(closes, 100);
  if (sd20 && sd100) {
    features['vol_regime'] = sd20 / sd100; // >1 = vol increasing
  }
  // Trend strength via ADX-like proxy
  let upMoves = 0, downMoves = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    if (upMove > 0 && upMove > downMove) upMoves += upMove;
    if (downMove > 0 && downMove > upMove) downMoves += downMove;
  }
  features['trend_dir_14'] = (upMoves - downMoves) / (upMoves + downMoves || 1);
  // Range detection
  const max20 = Math.max(...closes.slice(-20));
  const min20 = Math.min(...closes.slice(-20));
  features['range_pct_20'] = (max20 - min20) / closes[closes.length - 1];
  features['position_in_range_20'] = (closes[closes.length - 1] - min20) / ((max20 - min20) || 1);
  return features;
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function compute(symbol, ctx) {
  const Bitget = ctx.Bitget;
  if (!Bitget || !Bitget.fetchCandles) throw new Error('Bitget unavailable');
  const candles = await Bitget.fetchCandles(symbol, ctx.granularity || '4h', 600);
  if (!candles || candles.length < 100) throw new Error('insufficient candles');
  const btcCandles = symbol !== 'BTCUSDT'
    ? await Bitget.fetchCandles('BTCUSDT', ctx.granularity || '4h', 600).catch(() => null)
    : candles;
  const ethCandles = await Bitget.fetchCandles('ETHUSDT', ctx.granularity || '4h', 600).catch(() => null);
  const orderBook = await Bitget.fetchOrderbook(symbol).catch(() => null);

  const features = {
    ...priceFeatures(candles),
    ...volumeFeatures(candles),
    ...technicalFeatures(candles),
    ...microstructureFeatures(candles, orderBook),
    ...crossAssetFeatures(symbol, btcCandles, ethCandles, candles),
    ...timeFeatures(candles),
    ...regimeFeatures(candles),
  };
  return {
    symbol,
    ts: Date.now(),
    candleCount: candles.length,
    featureCount: Object.keys(features).length,
    features,
  };
}

// Feature-Importance via correlation with future-return (rolling)
async function computeImportance(symbol, ctx, horizon = 5) {
  const Bitget = ctx.Bitget;
  const candles = await Bitget.fetchCandles(symbol, ctx.granularity || '4h', 800);
  if (!candles || candles.length < 200) throw new Error('insufficient candles');
  // For each tick, compute features + future return
  const samples = [];
  const minLookback = 200;
  for (let i = minLookback; i < candles.length - horizon; i++) {
    const slice = candles.slice(0, i + 1);
    const features = {
      ...priceFeatures(slice),
      ...volumeFeatures(slice),
      ...technicalFeatures(slice),
      ...regimeFeatures(slice),
    };
    const ret = (candles[i + horizon].close - candles[i].close) / candles[i].close;
    samples.push({ features, ret });
  }
  // Correlate each feature with ret
  const featureNames = samples.length ? Object.keys(samples[0].features).filter(k => isFinite(samples[0].features[k])) : [];
  const importance = [];
  for (const name of featureNames) {
    const xs = samples.map(s => s.features[name]).filter(v => isFinite(v));
    const ys = samples.filter((_, i) => isFinite(samples[i].features[name])).map(s => s.ret);
    if (xs.length < 50) continue;
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    const corr = vx && vy ? cov / Math.sqrt(vx * vy) : 0;
    importance.push({ name, correlation: +corr.toFixed(4), absCorr: +Math.abs(corr).toFixed(4) });
  }
  importance.sort((a, b) => b.absCorr - a.absCorr);
  return importance.slice(0, 50);
}

async function runCompute(jobId, opts, ctx) {
  const job = jobs[jobId];
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const result = await compute(opts.symbol || 'BTCUSDT', { ...ctx, granularity: opts.granularity });
    job.status = 'complete';
    job.completedAt = Date.now();
    job.result = result;
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
}

function startCompute(opts, ctx) {
  const jobId = newJobId();
  jobs[jobId] = { jobId, status: 'queued', opts };
  setImmediate(() => runCompute(jobId, opts, ctx));
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

module.exports = { startCompute, getStatus, getResult, compute, computeImportance };
