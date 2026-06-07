// scripts/walk_forward_holdout.js
// Block P: TRAIN / VALIDATION (CPCV) / FINAL HOLDOUT Walk-Forward
// Lopez de Prado Standard — out-of-distribution-Test gegen Sample-Bias.
//
// Splits (in-Sample 9 Tage):
//   TRAIN:      20.05.-23.05. (4d)  → für Config-Identifikation
//   EMBARGO 1:  6h Gap (Purging)
//   VALIDATION: 24.05.-25.05. (2d)  → CPCV + Pre-Selection
//   EMBARGO 2:  6h Gap
//   HOLDOUT:    26.05.-27.05. (2d)  → finaler unsignaller OoS-Test
//
// 🔴 HOLDOUT-DATEN DÜRFEN NICHT FÜR PRE-SELECTION ODER TUNING GENUTZT WERDEN.

const Database = require('better-sqlite3');
const path = require('path');
const CPCV = require('../modules/cpcv_validation.js');
const DS = require('../modules/deflated_sharpe.js');

const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const FEE = 0.002;

const db = new Database(DB_PATH, { readonly: true });

// ── Zeitfenster (UTC-basiert, 00:00 als Tag-Grenze ist OK)
const TRAIN_FROM = new Date('2026-05-20T00:00:00Z').getTime();
const TRAIN_TO   = new Date('2026-05-23T18:00:00Z').getTime();
const VAL_FROM   = new Date('2026-05-24T00:00:00Z').getTime(); // 6h embargo
const VAL_TO     = new Date('2026-05-25T18:00:00Z').getTime();
const HOLD_FROM  = new Date('2026-05-26T00:00:00Z').getTime(); // 6h embargo
const HOLD_TO    = new Date('2026-05-27T23:59:59Z').getTime();

console.log('═══ BLOCK P — WALK-FORWARD FINAL HOLDOUT ═══');
console.log(`TRAIN:      ${new Date(TRAIN_FROM).toISOString().slice(0,10)} → ${new Date(TRAIN_TO).toISOString().slice(0,10)}`);
console.log(`VALIDATION: ${new Date(VAL_FROM).toISOString().slice(0,10)} → ${new Date(VAL_TO).toISOString().slice(0,10)}`);
console.log(`HOLDOUT:    ${new Date(HOLD_FROM).toISOString().slice(0,10)} → ${new Date(HOLD_TO).toISOString().slice(0,10)}`);

// ── Lade Decisions+Outcomes pro Window
function loadWindow(from, to) {
  return db.prepare(`
    SELECT ad.ts, ad.symbol, ad.decision, ad.confidence, ad.regime,
           (SELECT tb.hit_return FROM ml_tb_labels tb
            WHERE tb.symbol = ad.symbol AND tb.t0_ts >= ad.ts AND tb.t0_ts < ad.ts + 3600000
            ORDER BY tb.t0_ts ASC LIMIT 1) as outcome
    FROM aladdin_decisions ad
    WHERE ad.ts >= ? AND ad.ts < ? AND ad.decision IN ('BUY','SELL') AND ad.confidence >= 0.05
  `).all(from, to).filter(r => r.outcome !== null);
}

const trainSet = loadWindow(TRAIN_FROM, TRAIN_TO);
const valSet = loadWindow(VAL_FROM, VAL_TO);
const holdSet = loadWindow(HOLD_FROM, HOLD_TO);

console.log(`\nSample-Größen:`);
console.log(`  TRAIN:      ${trainSet.length} decisions`);
console.log(`  VALIDATION: ${valSet.length} decisions`);
console.log(`  HOLDOUT:    ${holdSet.length} decisions`);

// ── Sanity: keine Überlappung
const trainMaxTs = Math.max(...trainSet.map(r => r.ts));
const valMinTs = Math.min(...valSet.map(r => r.ts));
const holdMinTs = Math.min(...holdSet.map(r => r.ts));
console.log(`\nEmbargo-Check:`);
console.log(`  TRAIN max → VAL min: ${((valMinTs - trainMaxTs)/3600000).toFixed(2)}h gap`);
console.log(`  VAL max  → HOLD min: ${((holdMinTs - Math.max(...valSet.map(r=>r.ts)))/3600000).toFixed(2)}h gap`);

// ── Configs
const configs = [
  { name: 'A0-Baseline-0.20', filter: r => r.confidence >= 0.20 },
  { name: 'A2-Floor-0.10', filter: r => r.confidence >= 0.10 },
  { name: 'C1-Regime-Adapt', filter: r => {
    const fl = { BULL:0.08, NEUTRAL:0.10, RANGING:0.12, CHOPPY:0.15, BEAR:0.15,
                 STRONG_BULL:0.10, EXTREME:0.20, SQUEEZE:0.08 };
    return r.confidence >= (fl[r.regime] || 0.10);
  } },
  { name: 'D1-WinnerSymbols-0.10', filter: r => r.confidence >= 0.10 &&
    ['NEARUSDT','ATOMUSDT','BTCUSDT','ETHUSDT'].includes(r.symbol) },
  { name: 'NEAR+SUI-0.10 ⭐', filter: r => r.confidence >= 0.10 &&
    ['NEARUSDT','SUIUSDT'].includes(r.symbol) },
  { name: 'NEAR-only-0.10 ⭐', filter: r => r.confidence >= 0.10 && r.symbol === 'NEARUSDT' },
  { name: 'BTC-only-0.10', filter: r => r.confidence >= 0.10 && r.symbol === 'BTCUSDT' },
  { name: 'ETH-only-0.10', filter: r => r.confidence >= 0.10 && r.symbol === 'ETHUSDT' },
  { name: 'MEGA-Class-0.10', filter: r => r.confidence >= 0.10 &&
    ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'].includes(r.symbol) },
  { name: 'MID-Class-0.10', filter: r => r.confidence >= 0.10 &&
    ['NEARUSDT','SUIUSDT','XRPUSDT','ADAUSDT','LINKUSDT'].includes(r.symbol) },
  { name: 'SUI-only-0.10', filter: r => r.confidence >= 0.10 && r.symbol === 'SUIUSDT' },
];

const NUM_TRIALS = configs.length;

function computeStats(samples, cfg) {
  const filtered = samples.filter(cfg.filter);
  if (filtered.length < 30) return { trades: filtered.length, sharpe: 0, sortino: 0, winRate: 0, pnl: 0, maxDD: 0, reason: 'TOO_FEW' };
  const rets = filtered.map(r => {
    const gross = r.decision === 'BUY' ? r.outcome : -r.outcome;
    return gross - FEE;
  });
  const n = rets.length;
  const sum = rets.reduce((a,b)=>a+b,0);
  const mean = sum / n;
  const wins = rets.filter(r => r > 0).length;
  const sharpe = DS.sharpe(rets);
  const sortino = DS.sortino(rets);
  let cum = 0, peak = 0, maxDD = 0;
  for (const r of rets) { cum += r; if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxDD) maxDD = dd; }
  return { trades: n, sharpe: +sharpe.toFixed(2), sortino: +sortino.toFixed(2), winRate: +(wins/n*100).toFixed(1), pnl: +sum.toFixed(4), maxDD: +maxDD.toFixed(4) };
}

// ── Phase 1: TRAIN
console.log('\n─── PHASE 1: TRAIN (Performance ohne Tuning) ───');
console.log('Config'.padEnd(28) + 'Trades  WR%   Sharpe  Sortino  PnL    MaxDD');
console.log('-'.repeat(82));
const trainStats = {};
for (const cfg of configs) {
  const s = computeStats(trainSet, cfg);
  trainStats[cfg.name] = s;
  console.log(cfg.name.padEnd(28) + `${s.trades}`.padEnd(8) + `${s.winRate}`.padEnd(6) + `${s.sharpe}`.padEnd(8) + `${s.sortino}`.padEnd(9) + `${s.pnl}`.padEnd(7) + `${s.maxDD}`);
}

// ── Phase 2: VALIDATION mit CPCV
console.log('\n─── PHASE 2: VALIDATION CPCV ───');
console.log('Config'.padEnd(28) + 'Trades  IS-Sharpe  CPCV-SR  PBO   DSR   Prob  Verdict');
console.log('-'.repeat(95));
const valResults = [];
function strategyFn(cfg) {
  return (train, test) => {
    return test.filter(cfg.filter).map(r => {
      const gross = r.decision === 'BUY' ? r.outcome : -r.outcome;
      return gross - FEE;
    });
  };
}
for (const cfg of configs) {
  const s = computeStats(valSet, cfg);
  if (s.trades < 30) {
    console.log(cfg.name.padEnd(28) + 'too few (' + s.trades + ')');
    continue;
  }
  const isRets = valSet.filter(cfg.filter).map(r => (r.decision === 'BUY' ? r.outcome : -r.outcome) - FEE);
  let cpcv;
  try { cpcv = CPCV.runCPCV(valSet, strategyFn(cfg), { N: 6, k: 2, embargoFrac: 0.01 }); }
  catch(e) { console.log(cfg.name.padEnd(28) + ' CPCV err'); continue; }
  const pbo = DS.pbo(cpcv.pathReturns);
  const skew = DS.skewness(isRets);
  const kurt = DS.kurtosis(isRets);
  const dsr = DS.deflated(s.sharpe, NUM_TRIALS, skew, kurt, isRets.length);
  const verdict = pbo.pbo > 0.5 ? 'OVERFIT'
                : pbo.pbo > 0.3 ? 'CAUTION'
                : dsr.prob > 0.95 ? 'STRONG'
                : dsr.prob > 0.7 ? 'ROBUST'
                : 'WEAK';
  valResults.push({ ...cfg, ...s, cpcvSR: pbo.sharpeMean, pbo: pbo.pbo, dsr: dsr.dsr, prob: dsr.prob, verdict });
  console.log(cfg.name.padEnd(28) + `${s.trades}`.padEnd(8) + `${s.sharpe}`.padEnd(11) + `${pbo.sharpeMean}`.padEnd(9) + `${pbo.pbo}`.padEnd(6) + `${dsr.dsr}`.padEnd(6) + `${dsr.prob}`.padEnd(6) + verdict);
}

// ── PreSelection für HOLDOUT
const preSelected = valResults.filter(r => r.pbo < 0.5 && r.prob > 0.7);
console.log(`\n── Pre-Selected für HOLDOUT (PBO<0.5 & DSR-prob>0.7): ${preSelected.length} Configs`);
for (const r of preSelected) console.log(`  ✓ ${r.name}`);

// ── Phase 3: FINAL HOLDOUT
console.log('\n─── PHASE 3: FINAL HOLDOUT (NIE GESEHENE DATEN) ───');
console.log('Config'.padEnd(28) + 'Trades  WR%   Sharpe  Sortino  PnL    MaxDD  Verdict-vs-VAL');
console.log('-'.repeat(95));
const holdResults = [];
for (const cfg of preSelected) {
  const h = computeStats(holdSet, cfg);
  holdResults.push({ name: cfg.name, ...h, valSharpe: cfg.sharpe, valPnl: cfg.pnl });
  let verdict;
  if (h.sharpe > 0 && cfg.sharpe > 0) {
    const drop = (cfg.sharpe - h.sharpe) / Math.abs(cfg.sharpe);
    verdict = drop < 0.30 ? 'ROBUST ✓✓' : drop < 0.50 ? 'STABLE ✓' : drop < 0.80 ? 'FRAGIL ⚠️' : 'KOLLAPS ❌';
  } else if (h.sharpe <= 0 && cfg.sharpe > 0) {
    verdict = 'KOLLAPS ❌ (HOLDOUT negativ)';
  } else {
    verdict = 'INCONCLUSIVE';
  }
  console.log(cfg.name.padEnd(28) + `${h.trades}`.padEnd(8) + `${h.winRate}`.padEnd(6) + `${h.sharpe}`.padEnd(8) + `${h.sortino}`.padEnd(9) + `${h.pnl}`.padEnd(7) + `${h.maxDD}`.padEnd(7) + verdict);
}

console.log('\n─── FINAL VERDICT pro Config ───');
for (const r of holdResults) {
  const ratioSharpe = r.valSharpe > 0 ? (r.sharpe / r.valSharpe).toFixed(2) : 'n/a';
  console.log(`${r.name.padEnd(28)} TRAIN-SR=${trainStats[r.name]?.sharpe || 'n/a'} VAL-SR=${r.valSharpe} HOLDOUT-SR=${r.sharpe} (HOLDOUT/VAL ratio: ${ratioSharpe})`);
}

db.close();
