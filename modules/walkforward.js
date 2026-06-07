// modules/walkforward.js — TIER2-A Walk-Forward Backtest
// Reference: anchored vs rolling, WFE (out/in Sharpe-ratio), train/test split.
// READ-ONLY: liest Bitget-Candles, computed Sharpe/WFE, persistiert NICHTS außer Jobs in-memory.
// Wird über Endpoints /api/walkforward/* triggered.

'use strict';

const jobs = {};
let _counter = 0;

function newJobId() {
  return `WF-${Date.now()}-${++_counter}`;
}

function parseDuration(s) {
  if (typeof s === 'number') return s;
  const m = String(s).match(/^(\d+)([dhm])$/);
  if (!m) return 180 * 86400000;
  const n = parseInt(m[1], 10);
  const u = m[2];
  if (u === 'd') return n * 86400000;
  if (u === 'h') return n * 3600000;
  if (u === 'm') return n * 60000;
  return 180 * 86400000;
}

// Simple fitness: SMA-crossover strategy on candles → equity-curve → Sharpe
function evalStrategy(candles, params) {
  if (!candles || candles.length < 60) return { sharpe: 0, ret: 0, trades: 0, maxDD: 0 };
  const fast = Math.max(5, params.fast || 20);
  const slow = Math.max(fast + 1, params.slow || 50);
  let pos = 0, entry = 0;
  let equity = 1.0;
  const rets = [];
  let peak = equity, maxDD = 0, trades = 0;
  for (let i = slow; i < candles.length; i++) {
    let smaF = 0, smaS = 0;
    for (let j = i - fast; j < i; j++) smaF += candles[j].close;
    for (let j = i - slow; j < i; j++) smaS += candles[j].close;
    smaF /= fast; smaS /= slow;
    const price = candles[i].close;
    if (pos === 0 && smaF > smaS * 1.001) { pos = 1; entry = price; trades++; }
    else if (pos === 1 && smaF < smaS * 0.999) {
      const r = (price - entry) / entry - 0.0012; // fees both sides
      equity *= (1 + r);
      rets.push(r);
      pos = 0;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  if (pos === 1) {
    const r = (candles[candles.length - 1].close - entry) / entry - 0.0012;
    equity *= (1 + r);
    rets.push(r);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  return { sharpe, ret: equity - 1, trades, maxDD };
}

function generateWindows(startTs, endTs, trainMs, testMs, stepMs, mode) {
  const wins = [];
  let cursor = startTs;
  while (cursor + trainMs + testMs <= endTs) {
    const trainStart = (mode === 'anchored') ? startTs : cursor;
    const trainEnd = cursor + trainMs;
    const testStart = trainEnd;
    const testEnd = trainEnd + testMs;
    wins.push({ trainStart, trainEnd, testStart, testEnd });
    cursor += stepMs;
  }
  return wins;
}

async function runJob(jobId, opts, ctx) {
  const job = jobs[jobId];
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const Bitget = ctx.Bitget;
    if (!Bitget || typeof Bitget.fetchCandles !== 'function') {
      throw new Error('Bitget.fetchCandles not available');
    }
    const symbol = opts.symbol || 'BTCUSDT';
    const trainMs = parseDuration(opts.trainSize || '180d');
    const testMs = parseDuration(opts.testSize || '60d');
    const stepMs = parseDuration(opts.step || '60d');
    const mode = opts.mode === 'anchored' ? 'anchored' : 'rolling';
    const granularity = opts.granularity || '4h';
    const endTs = Date.now();
    const startTs = endTs - parseDuration(opts.lookback || '720d');

    // limited fetch for fast simulation: get ~720d of 4h candles ≈ 4320 candles
    const candles = await Bitget.fetchCandles(symbol, granularity, 4400);
    if (!candles || candles.length < 200) {
      throw new Error(`insufficient candles for ${symbol} (${candles ? candles.length : 0})`);
    }
    // Map ts → index for slicing
    const sliceByTs = (a, b) => candles.filter(c => c.ts >= a && c.ts <= b);

    // Param-grid for "optimization" (small to keep fast)
    const grid = [
      { fast: 10, slow: 30 }, { fast: 15, slow: 45 }, { fast: 20, slow: 50 },
      { fast: 25, slow: 75 }, { fast: 30, slow: 90 }, { fast: 50, slow: 150 },
    ];

    const winsDef = generateWindows(startTs, endTs, trainMs, testMs, stepMs, mode);
    const windows = [];
    for (const w of winsDef) {
      const trainData = sliceByTs(w.trainStart, w.trainEnd);
      const testData = sliceByTs(w.testStart, w.testEnd);
      if (trainData.length < 100 || testData.length < 30) continue;
      // 1. Optimize on train
      let best = null;
      for (const p of grid) {
        const r = evalStrategy(trainData, p);
        if (!best || r.sharpe > best.sharpe) best = { ...r, params: p };
      }
      // 2. Eval on test (out-of-sample)
      const oos = evalStrategy(testData, best.params);
      windows.push({
        trainStart: w.trainStart, trainEnd: w.trainEnd,
        testStart: w.testStart, testEnd: w.testEnd,
        bestParams: best.params,
        inSample: { sharpe: best.sharpe, ret: best.ret, trades: best.trades, maxDD: best.maxDD },
        outOfSample: { sharpe: oos.sharpe, ret: oos.ret, trades: oos.trades, maxDD: oos.maxDD },
      });
    }

    // Aggregation
    const inSampleSharpes = windows.map(w => w.inSample.sharpe);
    const oosSharpes = windows.map(w => w.outOfSample.sharpe);
    const meanIS = inSampleSharpes.reduce((a, b) => a + b, 0) / (inSampleSharpes.length || 1);
    const meanOOS = oosSharpes.reduce((a, b) => a + b, 0) / (oosSharpes.length || 1);
    const wfe = meanIS !== 0 ? meanOOS / meanIS : 0;
    const oosVariance = oosSharpes.length
      ? oosSharpes.reduce((a, b) => a + (b - meanOOS) ** 2, 0) / oosSharpes.length
      : 0;
    const oosStd = Math.sqrt(oosVariance);
    const overfittingScore = meanIS > 0 ? 1 - Math.max(0, Math.min(1, meanOOS / meanIS)) : 1;

    job.status = 'complete';
    job.completedAt = Date.now();
    job.result = {
      symbol, granularity, mode,
      trainSize: opts.trainSize || '180d',
      testSize: opts.testSize || '60d',
      step: opts.step || '60d',
      candleCount: candles.length,
      windows,
      aggregated: {
        inSampleMeanSharpe: +meanIS.toFixed(4),
        outOfSampleMeanSharpe: +meanOOS.toFixed(4),
        outOfSampleStd: +oosStd.toFixed(4),
        walkForwardEfficiency: +wfe.toFixed(4),  // >0.5 = healthy
        overfittingScore: +overfittingScore.toFixed(4),  // <0.5 = healthy
        verdict: (wfe > 0.5 && overfittingScore < 0.5) ? 'HEALTHY' : 'OVERFIT_SUSPECTED',
      },
    };
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
    job.completedAt = Date.now();
  }
}

function startJob(opts, ctx) {
  const jobId = newJobId();
  jobs[jobId] = { jobId, status: 'queued', opts, startedAt: null, completedAt: null, result: null };
  // run async (don't await)
  setImmediate(() => runJob(jobId, opts, ctx));
  return { jobId, status: 'queued' };
}

function getStatus(jobId) {
  const j = jobs[jobId];
  if (!j) return { error: 'JOB_NOT_FOUND' };
  return { jobId, status: j.status, startedAt: j.startedAt, completedAt: j.completedAt, error: j.error };
}

function getResult(jobId) {
  const j = jobs[jobId];
  if (!j) return { error: 'JOB_NOT_FOUND' };
  if (j.status !== 'complete') return { jobId, status: j.status, error: j.error };
  return { jobId, status: j.status, ...j.result };
}

function listJobs() {
  return Object.values(jobs).map(j => ({ jobId: j.jobId, status: j.status, startedAt: j.startedAt }));
}

module.exports = { startJob, getStatus, getResult, listJobs, generateWindows, evalStrategy };
