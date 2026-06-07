// Block-L Re-Run mit CPCV + Deflated Sharpe
// Prüft: sind NEAR/SUI-Edges robust oder Sample-Bias?
// Output: per-Config DSR + PBO + Recommendation.

const Database = require('better-sqlite3');
const path = require('path');
const CPCV = require('../modules/cpcv_validation.js');
const DS = require('../modules/deflated_sharpe.js');

const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const FEE = 0.002;
const SINCE = Date.now() - 9 * 86400000;

const db = new Database(DB_PATH, { readonly: true });

console.log('═══ CPCV + DEFLATED SHARPE — Re-Validation Block-L ═══');

// 1. Lade Decisions+Outcomes
const decisions = db.prepare(`
  SELECT ad.ts, ad.symbol, ad.decision, ad.confidence, ad.unified_conf, ad.regime,
         (SELECT tb.hit_return FROM ml_tb_labels tb
          WHERE tb.symbol = ad.symbol AND tb.t0_ts >= ad.ts AND tb.t0_ts < ad.ts + 3600000
          ORDER BY tb.t0_ts ASC LIMIT 1) as outcome
  FROM aladdin_decisions ad
  WHERE ad.ts > ? AND ad.decision IN ('BUY','SELL') AND ad.confidence >= 0.05
`).all(SINCE);

const samples = decisions.filter(d => d.outcome !== null);
console.log(`Sample-Size: ${samples.length}`);

// 2. Configs aus Block-L
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
];

const NUM_TRIALS = configs.length; // Multiple-testing correction

// 3. Strategy-Funktion: filtere train+test, compute returns
function strategyFn(config) {
  return (trainSet, testSet) => {
    // Train wird ignoriert (Config ist parameter-frei) — wir testen nur OoS-Edge
    const filtered = testSet.filter(config.filter);
    return filtered.map(r => {
      const grossRet = r.decision === 'BUY' ? r.outcome : -r.outcome;
      return grossRet - FEE;
    });
  };
}

// 4. Per Config: CPCV-Run
console.log('\n─── PER-CONFIG CPCV-RESULTS ───');
console.log('Config'.padEnd(28) + 'Trades'.padEnd(8) + 'IS-Sharpe'.padEnd(11) +
            'CPCV-Mean'.padEnd(11) + 'CPCV-Std'.padEnd(10) + 'PBO'.padEnd(7) +
            'DSR'.padEnd(8) + 'P(skill)'.padEnd(10) + 'Verdict');
console.log('-'.repeat(110));

const results = [];
for (const cfg of configs) {
  const filtered = samples.filter(cfg.filter);
  if (filtered.length < 30) {
    console.log(cfg.name.padEnd(28) + String(filtered.length).padEnd(8) + 'too few samples');
    continue;
  }

  // In-Sample Sharpe (Block-L Methode)
  const isRets = filtered.map(r => {
    const grossRet = r.decision === 'BUY' ? r.outcome : -r.outcome;
    return grossRet - FEE;
  });
  const isSharpe = DS.sharpe(isRets);

  // CPCV mit N=6 Groups, k=2 Test
  let cpcv;
  try {
    cpcv = CPCV.runCPCV(samples, strategyFn(cfg), { N: 6, k: 2, embargoFrac: 0.01 });
  } catch (e) {
    console.log(cfg.name.padEnd(28) + 'CPCV-ERROR: ' + e.message);
    continue;
  }

  // PBO + Sharpe-Distribution
  const pboResult = DS.pbo(cpcv.pathReturns);
  const cpcvMeanSR = pboResult.sharpeMean;
  const cpcvStdSR = pboResult.sharpeStd;

  // DSR: korrigiert für NUM_TRIALS multiple testing
  const skew = DS.skewness(isRets);
  const kurt = DS.kurtosis(isRets);
  const dsrResult = DS.deflated(isSharpe, NUM_TRIALS, skew, kurt, isRets.length);

  const verdict = pboResult.pbo > 0.5 ? 'OVERFIT ❌'
              : pboResult.pbo > 0.3 ? 'CAUTION ⚠️'
              : dsrResult.prob > 0.95 ? 'STRONG ✓✓'
              : dsrResult.prob > 0.7 ? 'ROBUST ✓'
              : 'WEAK';

  results.push({ name: cfg.name, isSharpe, cpcvMeanSR, cpcvStdSR, pbo: pboResult.pbo,
                 dsr: dsrResult.dsr, prob: dsrResult.prob, verdict, n: filtered.length });

  console.log(
    cfg.name.padEnd(28) +
    String(filtered.length).padEnd(8) +
    String(isSharpe.toFixed(2)).padEnd(11) +
    String(cpcvMeanSR).padEnd(11) +
    String(cpcvStdSR).padEnd(10) +
    String(pboResult.pbo).padEnd(7) +
    String(dsrResult.dsr).padEnd(8) +
    String(dsrResult.prob).padEnd(10) +
    verdict
  );
}

console.log('\n─── INTERPRETATION ───');
const robust = results.filter(r => r.prob > 0.95 && r.pbo < 0.3);
const overfit = results.filter(r => r.pbo > 0.5);
console.log(`STRONG (DSR-prob>0.95 + PBO<0.3): ${robust.length} configs`);
robust.forEach(r => console.log(`  ✓✓ ${r.name}: DSR=${r.dsr} prob=${r.prob} CPCV-Sharpe=${r.cpcvMeanSR}`));
console.log(`OVERFIT (PBO>0.5): ${overfit.length} configs`);
overfit.forEach(r => console.log(`  ❌ ${r.name}: PBO=${r.pbo} CPCV-Sharpe=${r.cpcvMeanSR}`));

console.log('\n─── EMPFEHLUNG FÜR BLOCK-L ───');
if (overfit.find(r => r.name.includes('NEAR'))) {
  console.log('⚠️  NEAR/SUI-Whitelist zeigt OVERFIT-Pattern — NICHT deployen ohne mehr Daten');
} else if (robust.find(r => r.name.includes('NEAR'))) {
  console.log('✓ NEAR/SUI-Whitelist ist ROBUST — Deploy denkbar');
} else {
  console.log('⚠️  NEAR/SUI-Whitelist liegt im UNCERTAIN-Bereich — mehr Sample empfohlen');
}

db.close();
