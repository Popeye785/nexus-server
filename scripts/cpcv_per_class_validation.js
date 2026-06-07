// scripts/cpcv_per_class_validation.js
// Validiert Per-Class Family-Weights aus Block N gegen alternative Configs.
// CPCV + Deflated Sharpe (LdP) gegen Multiple-Testing-Bias.
//
// Klassen: MEGA (BTC/ETH/SOL/BNB), MID (NEAR/SUI/XRP/ADA/LINK), SMALL (DOGE/TON/AVAX).

const Database = require('better-sqlite3');
const path = require('path');
const CPCV = require('../modules/cpcv_validation.js');
const DS = require('../modules/deflated_sharpe.js');
const ACW = require('../modules/asset_class_weights.js');

const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const FEE = 0.002;
const SINCE = Date.now() - 9 * 86400000;

const db = new Database(DB_PATH, { readonly: true });

console.log('═══ CPCV — PER-CLASS WEIGHTS VALIDATION ═══');

// 1. Lade Decisions mit families-JSON
const decisions = db.prepare(`
  SELECT ad.ts, ad.symbol, ad.decision, ad.confidence, ad.families,
         (SELECT tb.hit_return FROM ml_tb_labels tb
          WHERE tb.symbol = ad.symbol AND tb.t0_ts >= ad.ts AND tb.t0_ts < ad.ts + 3600000
          ORDER BY tb.t0_ts ASC LIMIT 1) as outcome
  FROM aladdin_decisions ad
  WHERE ad.ts > ? AND ad.decision IN ('BUY','SELL') AND ad.confidence >= 0.10 AND ad.families IS NOT NULL
`).all(SINCE);

const samples = decisions.filter(d => d.outcome !== null);
console.log(`Sample-Size: ${samples.length}`);

// Pre-parse families
for (const s of samples) {
  try { s.fams = JSON.parse(s.families); } catch(_) { s.fams = null; }
}
const valid = samples.filter(s => s.fams);
console.log(`Mit valid families-JSON: ${valid.length}`);

// 2. Klassen-Splits
const byClass = { MEGA: [], MID: [], SMALL: [], UNKNOWN: [] };
for (const r of valid) {
  const cls = ACW.classOf(r.symbol);
  byClass[cls].push(r);
}
console.log(`Pro Klasse: MEGA=${byClass.MEGA.length} MID=${byClass.MID.length} SMALL=${byClass.SMALL.length}`);

// 3. Configs pro Klasse
const FAMILIES = ['TREND','MOMENTUM','RISK','SENTIMENT','MICROSTRUCTURE'];

// Hilfsfunktion: recompute confidence aus Sub-Sources mit gegebenen Weights
function recomputeConfidence(famsObj, weights, direction) {
  let weighted = 0, totalW = 0;
  for (const name of FAMILIES) {
    const fam = famsObj[name];
    if (!fam) continue;
    if (fam.dir && fam.dir !== direction) continue;  // nur agreeing zählen
    const w = weights[name] || 0;
    const score = Math.abs(fam.score || 0);
    const conf = fam.conf || 0;
    weighted += score * w * conf;
    totalW += w;
  }
  return totalW > 0 ? weighted / totalW : 0;
}

// Strategy mit gegebenen Weights: simuliere Trade-Outcome
function strategyFn(weights) {
  return (trainSet, testSet) => {
    return testSet.map(r => {
      const recompConf = recomputeConfidence(r.fams, weights, r.decision);
      if (recompConf < 0.10) return null;  // Floor 0.10
      const grossRet = r.decision === 'BUY' ? r.outcome : -r.outcome;
      return grossRet - FEE;
    }).filter(x => x !== null);
  };
}

// MEGA Configs (8)
const megaConfigs = [
  { name: 'INITIAL', w: { TREND:0.20, MOMENTUM:0.05, RISK:0.40, SENTIMENT:0.05, MICROSTRUCTURE:0.30 } },
  { name: 'RISK-Dom', w: { TREND:0.15, MOMENTUM:0.05, RISK:0.50, SENTIMENT:0.05, MICROSTRUCTURE:0.25 } },
  { name: 'MICRO-Dom', w: { TREND:0.15, MOMENTUM:0.05, RISK:0.30, SENTIMENT:0.05, MICROSTRUCTURE:0.45 } },
  { name: 'Balanced', w: { TREND:0.20, MOMENTUM:0.20, RISK:0.20, SENTIMENT:0.20, MICROSTRUCTURE:0.20 } },
  { name: 'MR-Lean', w: { TREND:0.10, MOMENTUM:0.05, RISK:0.40, SENTIMENT:0.05, MICROSTRUCTURE:0.40 } },
  { name: 'Anti-TREND', w: { TREND:0.05, MOMENTUM:0.05, RISK:0.45, SENTIMENT:0.05, MICROSTRUCTURE:0.40 } },
  { name: 'Global-OLD', w: { TREND:0.35, MOMENTUM:0.05, RISK:0.30, SENTIMENT:0.05, MICROSTRUCTURE:0.25 } },
  { name: 'TREND-Dom (Baseline)', w: { TREND:0.50, MOMENTUM:0.10, RISK:0.20, SENTIMENT:0.05, MICROSTRUCTURE:0.15 } },
];

// MID Configs (6)
const midConfigs = [
  { name: 'INITIAL', w: { TREND:0.35, MOMENTUM:0.05, RISK:0.30, SENTIMENT:0.05, MICROSTRUCTURE:0.25 } },
  { name: 'TREND-Dom', w: { TREND:0.45, MOMENTUM:0.10, RISK:0.25, SENTIMENT:0.05, MICROSTRUCTURE:0.15 } },
  { name: 'RISK-Heavy', w: { TREND:0.25, MOMENTUM:0.05, RISK:0.45, SENTIMENT:0.05, MICROSTRUCTURE:0.20 } },
  { name: 'Balanced', w: { TREND:0.20, MOMENTUM:0.20, RISK:0.20, SENTIMENT:0.20, MICROSTRUCTURE:0.20 } },
  { name: 'MOMENTUM-Lean', w: { TREND:0.30, MOMENTUM:0.20, RISK:0.25, SENTIMENT:0.05, MICROSTRUCTURE:0.20 } },
  { name: 'SENTIMENT-In', w: { TREND:0.30, MOMENTUM:0.05, RISK:0.25, SENTIMENT:0.20, MICROSTRUCTURE:0.20 } },
];

// SMALL Configs (4)
const smallConfigs = [
  { name: 'INITIAL', w: { TREND:0.40, MOMENTUM:0.10, RISK:0.25, SENTIMENT:0.15, MICROSTRUCTURE:0.10 } },
  { name: 'TREND-Heavy', w: { TREND:0.55, MOMENTUM:0.10, RISK:0.20, SENTIMENT:0.10, MICROSTRUCTURE:0.05 } },
  { name: 'SENTIMENT-Heavy', w: { TREND:0.30, MOMENTUM:0.10, RISK:0.20, SENTIMENT:0.30, MICROSTRUCTURE:0.10 } },
  { name: 'Global-OLD', w: { TREND:0.35, MOMENTUM:0.05, RISK:0.30, SENTIMENT:0.05, MICROSTRUCTURE:0.25 } },
];

const NUM_TRIALS = megaConfigs.length + midConfigs.length + smallConfigs.length;
console.log(`Total Trials (für DSR-Bonferroni): ${NUM_TRIALS}`);

function runConfigsForClass(cfgs, classSamples, className) {
  console.log(`\n─── ${className} (Sample-Size: ${classSamples.length}) ───`);
  console.log('Config'.padEnd(24) + 'Trades'.padEnd(8) + 'IS-SR'.padEnd(8) + 'CPCV-SR'.padEnd(10) + 'PBO'.padEnd(6) + 'DSR'.padEnd(8) + 'P(skill)'.padEnd(10) + 'Verdict');
  console.log('-'.repeat(95));
  const results = [];
  for (const cfg of cfgs) {
    const filtered = strategyFn(cfg.w)(null, classSamples);
    if (filtered.length < 30) {
      console.log(cfg.name.padEnd(24) + 'too few');
      continue;
    }
    const isSR = DS.sharpe(filtered);
    let cpcv;
    try { cpcv = CPCV.runCPCV(classSamples, strategyFn(cfg.w), { N: 6, k: 2, embargoFrac: 0.01 }); }
    catch(e) { console.log(cfg.name.padEnd(24) + ' CPCV err: ' + e.message); continue; }
    const pbo = DS.pbo(cpcv.pathReturns);
    const skew = DS.skewness(filtered);
    const kurt = DS.kurtosis(filtered);
    const dsr = DS.deflated(isSR, NUM_TRIALS, skew, kurt, filtered.length);
    const verdict = pbo.pbo > 0.5 ? 'OVERFIT'
                  : pbo.pbo > 0.3 ? 'CAUTION'
                  : dsr.prob > 0.95 ? 'STRONG'
                  : dsr.prob > 0.7 ? 'ROBUST'
                  : 'WEAK';
    results.push({ name: cfg.name, weights: cfg.w, trades: filtered.length, isSR, cpcvSR: pbo.sharpeMean, pbo: pbo.pbo, dsr: dsr.dsr, prob: dsr.prob, verdict });
    console.log(cfg.name.padEnd(24) + String(filtered.length).padEnd(8) + isSR.toFixed(2).padEnd(8) + String(pbo.sharpeMean).padEnd(10) + String(pbo.pbo).padEnd(6) + String(dsr.dsr).padEnd(8) + String(dsr.prob).padEnd(10) + verdict);
  }
  // Top-3 nach DSR-prob
  console.log(`\n── TOP-3 ${className} (PBO<0.5 & DSR-prob>0.7):`);
  const robust = results.filter(r => r.pbo < 0.5 && r.prob > 0.7).sort((a,b) => b.dsr - a.dsr).slice(0, 3);
  for (const r of robust) console.log(`  ✓ ${r.name}: DSR=${r.dsr} prob=${r.prob} CPCV-SR=${r.cpcvSR}`);
  return results;
}

const megaR = runConfigsForClass(megaConfigs, byClass.MEGA, 'MEGA');
const midR = runConfigsForClass(midConfigs, byClass.MID, 'MID');
const smallR = runConfigsForClass(smallConfigs, byClass.SMALL, 'SMALL');

console.log('\n═══ ZUSAMMENFASSUNG: optimal weights pro Klasse ═══');
function bestRobust(arr) {
  const robust = arr.filter(r => r.pbo < 0.5 && r.prob > 0.7).sort((a,b) => b.dsr - a.dsr);
  return robust[0] || null;
}
const bestMega = bestRobust(megaR);
const bestMid = bestRobust(midR);
const bestSmall = bestRobust(smallR);

if (bestMega) console.log(`MEGA BEST: ${bestMega.name} → ${JSON.stringify(bestMega.weights)}`);
if (bestMid) console.log(`MID BEST: ${bestMid.name} → ${JSON.stringify(bestMid.weights)}`);
if (bestSmall) console.log(`SMALL BEST: ${bestSmall.name} → ${JSON.stringify(bestSmall.weights)}`);

// Vergleich mit INITIAL
const initMega = megaR.find(r => r.name === 'INITIAL');
const initMid = midR.find(r => r.name === 'INITIAL');
const initSmall = smallR.find(r => r.name === 'INITIAL');
console.log('\n─── Initial-Weights Validation ───');
if (initMega) console.log(`MEGA INITIAL: PBO=${initMega.pbo} DSR=${initMega.dsr} prob=${initMega.prob} → ${initMega.verdict}`);
if (initMid) console.log(`MID INITIAL: PBO=${initMid.pbo} DSR=${initMid.dsr} prob=${initMid.prob} → ${initMid.verdict}`);
if (initSmall) console.log(`SMALL INITIAL: PBO=${initSmall.pbo} DSR=${initSmall.dsr} prob=${initSmall.prob} → ${initSmall.verdict}`);

db.close();
