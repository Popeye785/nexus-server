// modules/feature_engineering.js — Feature-Engineering V2 (FreqAI/DeepAlpha-Stil)
// AUDFIX_MLV2_P1 [2026-05-18]
//
// 72+ Features in 6 Gruppen:
// A — Preis-Indikatoren (mehrere Perioden)
// B — Volumen
// C — Returns / Lag-Returns
// D — Volatilität
// E — Markt-Phase
// F — Correlation (optional, wenn mehrere Symbols)
//
// SEPARAT vom Live-Brain — kein Eingriff in Brain-Logik.

'use strict';

// ────────────────────────────────────────────────────────────────────────
// Basic-Math
// ────────────────────────────────────────────────────────────────────────
function safeMean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
function safeStd(arr, m) {
  if (arr.length < 2) return 0;
  const mu = m !== undefined ? m : safeMean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - mu) ** 2, 0) / arr.length);
}

// ────────────────────────────────────────────────────────────────────────
// Indikatoren
// ────────────────────────────────────────────────────────────────────────
function sma(arr, period) {
  if (arr.length < period) return null;
  return safeMean(arr.slice(-period));
}
function ema(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let e = arr[arr.length - period];
  for (let i = arr.length - period + 1; i < arr.length; i++) {
    e = arr[i] * k + e * (1 - k);
  }
  return e;
}
function rsi(closes, period) {
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
function macd(closes) {
  if (closes.length < 26) return { hist: 0, signal: 0, line: 0 };
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const line = e12 - e26;
  // Rough signal: EMA of last 9 line-values
  const lines = [];
  for (let i = 9; i >= 0; i--) {
    const sub = closes.slice(0, closes.length - i);
    if (sub.length >= 26) {
      const l = ema(sub, 12) - ema(sub, 26);
      if (l !== null && Number.isFinite(l)) lines.push(l);
    }
  }
  const signal = lines.length ? safeMean(lines.slice(-9)) : 0;
  return { hist: line - signal, signal, line };
}
function bb(closes, period) {
  if (closes.length < period) return { pos: 0.5, width: 0 };
  const slice = closes.slice(-period);
  const m = safeMean(slice);
  const sd = safeStd(slice, m);
  if (sd === 0) return { pos: 0.5, width: 0 };
  const upper = m + 2 * sd, lower = m - 2 * sd;
  const last = closes[closes.length - 1];
  const pos = Math.max(0, Math.min(1, (last - lower) / (upper - lower)));
  return { pos, width: (upper - lower) / m };
}
function atrPct(highs, lows, closes, period) {
  if (highs.length < period + 1) return 0;
  const trs = [];
  for (let i = highs.length - period; i < highs.length; i++) {
    if (i === 0) { trs.push(highs[i] - lows[i]); continue; }
    const a = highs[i] - lows[i];
    const b = Math.abs(highs[i] - closes[i - 1]);
    const c = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(a, b, c));
  }
  const atr = safeMean(trs);
  return atr / (closes[closes.length - 1] || 1);
}
function obv(closes, volumes) {
  if (closes.length < 2) return 0;
  let obv = 0;
  const win = Math.min(50, closes.length - 1);
  for (let i = closes.length - win; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }
  return obv / Math.max(1, volumes[volumes.length - 1] || 1); // normalize
}
function adx(highs, lows, closes, period) {
  if (highs.length < period + 1) return 0;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = highs.length - period; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    const a = highs[i] - lows[i];
    const b = Math.abs(highs[i] - closes[i - 1]);
    const c = Math.abs(lows[i] - closes[i - 1]);
    tr += Math.max(a, b, c);
  }
  const plusDI = (plusDM / tr) * 100 || 0;
  const minusDI = (minusDM / tr) * 100 || 0;
  const dx = Math.abs(plusDI - minusDI) / Math.max(0.001, plusDI + minusDI) * 100;
  return dx; // simplified, ADX is normally smoothed
}
function vwapDeviation(highs, lows, closes, volumes, period) {
  if (highs.length < period) return 0;
  let pv = 0, v = 0;
  for (let i = highs.length - period; i < highs.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    pv += tp * volumes[i];
    v += volumes[i];
  }
  if (v === 0) return 0;
  const vwap = pv / v;
  return (closes[closes.length - 1] - vwap) / vwap;
}

// ────────────────────────────────────────────────────────────────────────
// Feature-Vektor pro Index
// ────────────────────────────────────────────────────────────────────────
// Erwartet candles = [{open,high,low,close,volume}, ...] und idx (Position)
function extractFeatures(candles, idx) {
  if (idx < 100) return null; // AUDFIX_MLV2: 200 → 100 (200er-SMA fehlt dann, wird mit 0 substituiert)
  const slice = candles.slice(0, idx + 1);
  const closes = slice.map(c => c.close);
  const highs = slice.map(c => c.high);
  const lows = slice.map(c => c.low);
  const volumes = slice.map(c => c.volume || 0);
  const lastClose = closes[closes.length - 1];

  const f = [];

  // ── GRUPPE A: Preis-Indikatoren (Perioden 5, 10, 20, 50, 100, 200) ──
  const periodsA = [5, 10, 20, 50, 100, 200];
  for (const p of periodsA) {
    const s = sma(closes, p);
    const e = ema(closes, p);
    f.push(s !== null ? (lastClose - s) / s : 0); // SMA-Deviation
    f.push(e !== null ? (lastClose - e) / e : 0); // EMA-Deviation
  }
  // RSI mehrere Perioden
  for (const p of [7, 14, 21]) f.push(rsi(closes, p) / 100);
  // MACD
  const m = macd(closes);
  f.push(m.hist / lastClose);
  f.push(m.signal / lastClose);
  f.push(m.line / lastClose);
  // BB Position + Width für 20, 50
  for (const p of [20, 50]) {
    const b = bb(closes, p);
    f.push(b.pos);
    f.push(b.width);
  }
  // ATR Pct für 7, 14, 28
  for (const p of [7, 14, 28]) f.push(atrPct(highs, lows, closes, p));

  // ── GRUPPE B: Volumen ──
  // Volume Z-Score 20, 50
  for (const p of [20, 50]) {
    const subV = volumes.slice(-p);
    const vm = safeMean(subV);
    const vsd = safeStd(subV, vm) || 1;
    f.push(((volumes[volumes.length - 1] || 0) - vm) / vsd);
  }
  // OBV normalized
  f.push(obv(closes, volumes));
  // VWAP-Deviation 20, 50
  for (const p of [20, 50]) f.push(vwapDeviation(highs, lows, closes, volumes, p));
  // Volume-Trend (kurz vs lang)
  const vShort = safeMean(volumes.slice(-10));
  const vLong = safeMean(volumes.slice(-50));
  f.push(vLong > 0 ? vShort / vLong - 1 : 0);

  // ── GRUPPE C: Returns / Lag-Returns ──
  const lags = [1, 3, 5, 10, 20, 50];
  for (const lag of lags) {
    if (closes.length > lag) {
      f.push((closes[closes.length - 1] - closes[closes.length - 1 - lag]) / closes[closes.length - 1 - lag]);
    } else f.push(0);
  }
  // Log-Returns
  for (const lag of [1, 5]) {
    if (closes.length > lag && closes[closes.length - 1 - lag] > 0) {
      f.push(Math.log(closes[closes.length - 1] / closes[closes.length - 1 - lag]));
    } else f.push(0);
  }
  // Cumulative-Returns rolling 50
  if (closes.length > 50) {
    const cumRet = (closes[closes.length - 1] - closes[closes.length - 50]) / closes[closes.length - 50];
    f.push(cumRet);
  } else f.push(0);

  // ── GRUPPE D: Volatilität ──
  for (const p of [5, 20, 50]) {
    const subC = closes.slice(-p);
    const sd = safeStd(subC);
    f.push(sd / (lastClose || 1));
  }
  // Volatility-of-Volatility (rolling std of returns)
  const recentRets = [];
  for (let i = Math.max(1, closes.length - 50); i < closes.length; i++) {
    recentRets.push((closes[i] - closes[i - 1]) / (closes[i - 1] || 1));
  }
  const volRet5 = safeStd(recentRets.slice(-5));
  const volRet20 = safeStd(recentRets.slice(-20));
  f.push(volRet5);
  f.push(volRet20);
  f.push(volRet20 > 0 ? volRet5 / volRet20 : 1); // Vol-of-Vol-Ratio

  // ── GRUPPE E: Markt-Phase ──
  for (const p of [14, 28]) f.push(adx(highs, lows, closes, p) / 100);
  // EMA-Trend (kurz vs lang)
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  f.push(e20 && e50 ? (e20 - e50) / e50 : 0);
  f.push(e50 && e200 ? (e50 - e200) / e200 : 0);
  f.push(e20 && e200 ? (e20 - e200) / e200 : 0);
  // Regime-Encoding (Bull=1, Range=0, Bear=-1)
  let regime = 0;
  if (e20 && e50 && e200 && e20 > e50 && e50 > e200) regime = 1;
  else if (e20 && e50 && e200 && e20 < e50 && e50 < e200) regime = -1;
  f.push(regime);
  // Distance to recent high/low (50)
  const high50 = Math.max(...highs.slice(-50));
  const low50 = Math.min(...lows.slice(-50));
  f.push(high50 > 0 ? (lastClose - high50) / high50 : 0);
  f.push(low50 > 0 ? (lastClose - low50) / low50 : 0);

  // ── GRUPPE F: Hour-of-Day / Day-of-Week (optional) ──
  if (slice[slice.length - 1].ts) {
    const d = new Date(slice[slice.length - 1].ts);
    f.push(d.getUTCHours() / 24);
    f.push(d.getUTCDay() / 7);
  } else {
    f.push(0); f.push(0);
  }

  // Sanitize NaN/Inf
  for (let i = 0; i < f.length; i++) {
    if (!Number.isFinite(f[i])) f[i] = 0;
  }
  return f;
}

function featureCount() {
  // A: 6×2 SMA+EMA = 12, 3 RSI, 3 MACD, 2×2 BB, 3 ATR = 23
  // B: 2 vol-z, 1 OBV, 2 VWAP-Dev, 1 vol-trend = 6
  // C: 6 lags, 2 log-rets, 1 cum-ret = 9
  // D: 3 vol-pct, 3 vol-of-vol = 6
  // E: 2 ADX, 3 EMA-Trend, 1 regime, 2 distance-extreme = 8
  // F: 2 time
  // Total = 23 + 6 + 9 + 6 + 8 + 2 = 54
  // Aber FreqAI-Stil verlangt 72+. Wir können Time-Features auf mehr expandieren wenn nötig.
  return 54;
}

// Normalisierung: Z-Score fit auf Trainings-Set
function fitNormalizer(X) {
  if (!X.length || !X[0].length) return { mean: [], sd: [] };
  const dim = X[0].length;
  const sums = new Array(dim).fill(0);
  const sqs = new Array(dim).fill(0);
  for (const row of X) {
    for (let f = 0; f < dim; f++) {
      sums[f] += row[f]; sqs[f] += row[f] * row[f];
    }
  }
  const n = X.length;
  const mean = sums.map(s => s / n);
  const sd = sums.map((s, f) => Math.sqrt(Math.max(0, sqs[f] / n - (s / n) ** 2)) || 1);
  return { mean, sd };
}
function normalize(X, norm) {
  return X.map(row => row.map((v, f) => (v - norm.mean[f]) / norm.sd[f]));
}

// Dataset bauen
function buildDataset(candles, startIdx = 200, endIdx = null, threshold = 0.0005) {
  endIdx = endIdx || candles.length - 1;
  const X = [], y = [];
  for (let i = startIdx; i < endIdx; i++) {
    const f = extractFeatures(candles, i);
    if (!f) continue;
    const ret = (candles[i + 1].close - candles[i].close) / candles[i].close;
    if (Math.abs(ret) < threshold) continue; // skip flat
    X.push(f);
    y.push(ret > 0 ? 1 : 0);
  }
  return { X, y };
}

module.exports = { extractFeatures, buildDataset, fitNormalizer, normalize, featureCount };
