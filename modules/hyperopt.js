// modules/hyperopt.js — SMA_Optimizer (Random-Search + Tournament-Hill-Climb)
// AUDFIX_P1_ETIKETTEN [2026-05-18]: Ehrlicher Display-Name (war "Hyperopt Framework")
// Tatsächlich: KEIN Bayesian/Optuna. Random-Search + Tournament-Hill-Climb auf SMA-Fitness.
// KEINE Auto-Apply der gefundenen Parameter — Christian muss explizit applyResult triggern.
// READ-ONLY zu Trading-Logik.

'use strict';

const jobs = {};
let _counter = 0;
function newJobId() { return `HOPT-${Date.now()}-${++_counter}`; }

// Define-Search-Space per Strategy
const SEARCH_SPACES = {
  SMA_CROSSOVER: {
    fast: { type: 'int', min: 5, max: 50 },
    slow: { type: 'int', min: 30, max: 200 },
  },
  BREAKOUT_HUNT: {
    lookbackWindow: { type: 'int', min: 10, max: 100 },
    breakoutThreshold: { type: 'float', min: 1.5, max: 5.0 },
    stopLossPct: { type: 'float', min: 0.005, max: 0.03 },
    takeProfitPct: { type: 'float', min: 0.01, max: 0.08 },
  },
  TREND_FOLLOW: {
    emaFast: { type: 'int', min: 5, max: 30 },
    emaSlow: { type: 'int', min: 30, max: 100 },
    rsiUpper: { type: 'int', min: 60, max: 80 },
    rsiLower: { type: 'int', min: 20, max: 40 },
  },
  MEAN_REVERT: {
    bbPeriod: { type: 'int', min: 10, max: 30 },
    bbStd: { type: 'float', min: 1.5, max: 3.0 },
    rsiOversold: { type: 'int', min: 20, max: 35 },
    rsiOverbought: { type: 'int', min: 65, max: 80 },
  },
};

function sampleParam(spec) {
  if (spec.type === 'int') return Math.floor(Math.random() * (spec.max - spec.min + 1)) + spec.min;
  return Math.random() * (spec.max - spec.min) + spec.min;
}

function sampleParams(space) {
  const out = {};
  for (const [k, spec] of Object.entries(space)) out[k] = sampleParam(spec);
  return out;
}

// Perturb params by jitter (for hill-climb)
function perturbParams(params, space, scale = 0.15) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const spec = space[k];
    if (!spec) { out[k] = v; continue; }
    const range = spec.max - spec.min;
    const delta = (Math.random() - 0.5) * 2 * range * scale;
    let nv = v + delta;
    if (spec.type === 'int') nv = Math.round(nv);
    nv = Math.max(spec.min, Math.min(spec.max, nv));
    out[k] = nv;
  }
  return out;
}

// AUDFIX_P1_ETIKETTEN [2026-05-18]: Vereinfachte SMA-Crossover-Fitness für alle Strategien.
// Hinweis: Live-Strategie BREAKOUT_HUNT (server.js:8662) nutzt BB-Expansion + Volume-Ratio
// — hier im Hyperopt wird aber nur SMA-Surrogat optimiert (Schnelltest).
function fitnessFn(candles, params) {
  if (!candles || candles.length < (params.slow || 50) + 10) return -999;
  const fast = Math.max(5, Math.round(params.fast || params.emaFast || 20));
  const slow = Math.max(fast + 1, Math.round(params.slow || params.emaSlow || 50));
  let pos = 0, entry = 0;
  const rets = [];
  for (let i = slow; i < candles.length; i++) {
    let sF = 0, sS = 0;
    for (let j = i - fast; j < i; j++) sF += candles[j].close;
    for (let j = i - slow; j < i; j++) sS += candles[j].close;
    sF /= fast; sS /= slow;
    const price = candles[i].close;
    if (pos === 0 && sF > sS * 1.001) { pos = 1; entry = price; }
    else if (pos === 1 && sF < sS * 0.999) {
      rets.push((price - entry) / entry - 0.0012);
      pos = 0;
    }
  }
  if (!rets.length) return -999;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  return std > 0 ? (mean / std) * Math.sqrt(252) : -999;
}

// Cross-validate: 3-fold time-series CV
function crossValidate(candles, params, folds = 3) {
  const len = candles.length;
  const foldSize = Math.floor(len / (folds + 1));
  const scores = [];
  for (let f = 0; f < folds; f++) {
    const trainEnd = foldSize * (f + 1);
    const testEnd = foldSize * (f + 2);
    const trainData = candles.slice(0, trainEnd);
    const testData = candles.slice(trainEnd, testEnd);
    if (testData.length < 30) continue;
    scores.push(fitnessFn(testData, params));
  }
  if (!scores.length) return -999;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

async function runJob(jobId, opts, ctx) {
  const job = jobs[jobId];
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const strategy = opts.strategy || 'SMA_CROSSOVER';
    const space = SEARCH_SPACES[strategy];
    if (!space) throw new Error(`Unknown strategy ${strategy}`);
    const symbol = opts.symbol || 'BTCUSDT';
    const iterations = Math.min(opts.iterations || 30, 100);
    const granularity = opts.granularity || '4h';
    const Bitget = ctx.Bitget;
    if (!Bitget || !Bitget.fetchCandles) throw new Error('Bitget unavailable');
    const candles = await Bitget.fetchCandles(symbol, granularity, 2000);
    if (!candles || candles.length < 200) throw new Error('insufficient candles');

    const useCV = opts.crossValidate !== false;
    const results = [];
    let best = null;

    // Phase 1: random search (60% of iterations)
    const randomN = Math.ceil(iterations * 0.6);
    for (let i = 0; i < randomN; i++) {
      const p = sampleParams(space);
      const sharpe = useCV ? crossValidate(candles, p) : fitnessFn(candles, p);
      results.push({ phase: 'random', iter: i, params: p, sharpe: +sharpe.toFixed(4) });
      if (!best || sharpe > best.sharpe) best = { params: p, sharpe };
      job.progress = { done: i + 1, total: iterations };
    }
    // Phase 2: hill-climb around best (40%)
    const hillN = iterations - randomN;
    for (let i = 0; i < hillN; i++) {
      const p = perturbParams(best.params, space, 0.1);
      const sharpe = useCV ? crossValidate(candles, p) : fitnessFn(candles, p);
      results.push({ phase: 'hillclimb', iter: randomN + i, params: p, sharpe: +sharpe.toFixed(4) });
      if (sharpe > best.sharpe) best = { params: p, sharpe };
      job.progress = { done: randomN + i + 1, total: iterations };
    }

    // Rank top 5
    const top5 = [...results].sort((a, b) => b.sharpe - a.sharpe).slice(0, 5);

    job.status = 'complete';
    job.completedAt = Date.now();
    job.result = {
      strategy, symbol, granularity,
      candleCount: candles.length,
      iterationsCompleted: iterations,
      crossValidated: useCV,
      bestParams: { ...best.params, sharpe: +best.sharpe.toFixed(4) },
      top5,
      allResults: results,
      note: 'Hyperopt result NOT auto-applied. Use POST /api/hyperopt/apply/:id to opt-in (still wired separately).',
    };
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
}

function startJob(opts, ctx) {
  const jobId = newJobId();
  jobs[jobId] = { jobId, status: 'queued', opts };
  setImmediate(() => runJob(jobId, opts, ctx));
  return { jobId, status: 'queued' };
}
function getStatus(jobId) {
  const j = jobs[jobId];
  return j ? { jobId, status: j.status, progress: j.progress, error: j.error } : { error: 'JOB_NOT_FOUND' };
}
function getResult(jobId) {
  const j = jobs[jobId];
  if (!j) return { error: 'JOB_NOT_FOUND' };
  return { jobId, status: j.status, ...j.result };
}
function listJobs() {
  return Object.values(jobs).map(j => ({ jobId: j.jobId, status: j.status }));
}
function listSearchSpaces() { return SEARCH_SPACES; }

module.exports = { startJob, getStatus, getResult, listJobs, listSearchSpaces, SEARCH_SPACES };
