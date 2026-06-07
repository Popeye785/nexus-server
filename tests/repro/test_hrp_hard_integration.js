// Standalone-Test der HRP-Hard-Integration Math
// Erwartung:
//   1. mit HRP-Snapshot vorhanden + weight=0.10 (equal) → finalSize ≈ tradingBalance × 0.10 × stackedNonHRP
//   2. ohne HRP-Snapshot → alte sizeRisk-Formel
//   3. hrpWeight < HRP_MIN_WEIGHT → skip mit reason='HRP_ZERO_WEIGHT'

const tests = [];

function pseudoCalc({ tradingBalance, confidence, slPct, hrpWeight, hrpAvailable, MIN_WEIGHT=0.001 }) {
  const RISK_PER_TRADE = 0.01;
  const MAX_POSITION_PCT = 0.10;
  const REGIME_MULT_CAP = 1.4;
  const SKIP_BELOW_SIZE = 2.5;

  const confMult = confidence > 0.20 ? 1.0 : confidence > 0.10 ? 0.75 : confidence > 0.05 ? 0.5 : 0;
  const slPctEff = Math.max(0.005, slPct);
  const regimeMult = 1.0, volatilityMult = 1.0, sentimentMult = 1.0;
  const profitLockMult = 1.0, newsRiskMult = 1.0, kellyMult = 1.0, sortinoMult = 1.0;
  let hrpMult = 1.0;
  if (hrpAvailable && hrpWeight != null) {
    const ratio = hrpWeight / 0.10; // n=10 → eqWeight=0.10
    hrpMult = Math.max(0.4, Math.min(1.5, ratio));
  }
  const stackedRaw = confMult * regimeMult * volatilityMult * sentimentMult * profitLockMult * newsRiskMult * kellyMult * sortinoMult * hrpMult;
  const stackedMult = Math.min(REGIME_MULT_CAP, stackedRaw);

  let sizingPath = 'RISK_PER_TRADE', hrpZeroSkip = false, sizeRisk;
  if (hrpAvailable && hrpWeight != null) {
    if (hrpWeight < MIN_WEIGHT) {
      hrpZeroSkip = true; sizingPath = 'HRP_ZERO_SKIP'; sizeRisk = 0;
    } else {
      const stackedNonHRP = stackedMult / Math.max(0.0001, hrpMult);
      sizeRisk = tradingBalance * hrpWeight * stackedNonHRP;
      sizingPath = 'HRP_DIRECT';
    }
  } else {
    sizeRisk = (RISK_PER_TRADE * tradingBalance * stackedMult) / slPctEff;
  }
  const sizeCap = tradingBalance * MAX_POSITION_PCT;
  const finalSize = Math.min(sizeRisk, sizeCap);

  if (hrpZeroSkip) return { skip:true, reason:'HRP_ZERO_WEIGHT', size:0, sizingPath };
  if (finalSize < SKIP_BELOW_SIZE) return { skip:true, reason:'BELOW_MIN_POSITION', size:0, sizingPath, sizeRisk, sizeCap, finalSize };
  return { skip:false, size:Number(finalSize.toFixed(2)), sizingPath, sizeRisk:Number(sizeRisk.toFixed(2)), sizeCap, hrpMult, stackedMult };
}

// Test 1: HRP-Snapshot vorhanden, equal weight (n=10, w=0.10)
const t1 = pseudoCalc({ tradingBalance: 1000, confidence: 0.25, slPct: 0.02, hrpWeight: 0.10, hrpAvailable: true });
tests.push({ name: 'HRP equal-weight 0.10', r: t1, expect: 'HRP_DIRECT, size≈100 (capped at MAX_POSITION_PCT)' });

// Test 2: HRP weight 0.26 (BNB Top-Pick → über-allocated, cap greift)
const t2 = pseudoCalc({ tradingBalance: 1000, confidence: 0.25, slPct: 0.02, hrpWeight: 0.26, hrpAvailable: true });
tests.push({ name: 'HRP top-pick 0.26', r: t2, expect: 'HRP_DIRECT, size=100 (cap)' });

// Test 3: HRP weight 0.04 (low diversification) — sollte unter cap kommen
const t3 = pseudoCalc({ tradingBalance: 1000, confidence: 0.25, slPct: 0.02, hrpWeight: 0.04, hrpAvailable: true });
tests.push({ name: 'HRP low weight 0.04', r: t3, expect: 'HRP_DIRECT, size≈40 (below cap)' });

// Test 4: HRP weight 0.0005 (below MIN) → SKIP
const t4 = pseudoCalc({ tradingBalance: 1000, confidence: 0.25, slPct: 0.02, hrpWeight: 0.0005, hrpAvailable: true });
tests.push({ name: 'HRP weight below MIN', r: t4, expect: 'skip HRP_ZERO_WEIGHT' });

// Test 5: HRP nicht verfügbar (cache null) → Fallback alte Formel
const t5 = pseudoCalc({ tradingBalance: 1000, confidence: 0.25, slPct: 0.02, hrpAvailable: false });
tests.push({ name: 'HRP unavailable fallback', r: t5, expect: 'RISK_PER_TRADE, size=(0.01*1000*1.0)/0.02 = 500 → cap 100' });

// Test 6: low confidence → confMult=0 → 0 size → BELOW_MIN
const t6 = pseudoCalc({ tradingBalance: 1000, confidence: 0.03, slPct: 0.02, hrpWeight: 0.10, hrpAvailable: true });
tests.push({ name: 'low confidence (mult=0)', r: t6, expect: 'skip BELOW_MIN_POSITION' });

tests.forEach((t,i) => {
  console.log(`\nTest ${i+1}: ${t.name}`);
  console.log(`  Expected: ${t.expect}`);
  console.log(`  Got:     `, t.r);
});

// Assertions
let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } }

console.log('\n─── Assertions');
assert(t1.sizingPath === 'HRP_DIRECT', 'T1 sizingPath=HRP_DIRECT');
assert(t1.size === 100, `T1 size=100 (cap), got ${t1.size}`);
assert(t2.sizingPath === 'HRP_DIRECT' && t2.size === 100, `T2 cap-applied, got size=${t2.size}`);
assert(t3.sizingPath === 'HRP_DIRECT' && t3.size > 35 && t3.size < 45, `T3 size near 40, got ${t3.size}`);
assert(t4.skip && t4.reason === 'HRP_ZERO_WEIGHT', 'T4 skip HRP_ZERO_WEIGHT');
assert(t5.sizingPath === 'RISK_PER_TRADE', 'T5 fallback RISK_PER_TRADE');
assert(t6.skip && t6.reason === 'BELOW_MIN_POSITION', 'T6 skip BELOW_MIN_POSITION');

console.log(`\n─── Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
