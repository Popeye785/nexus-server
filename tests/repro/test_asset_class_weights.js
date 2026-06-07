const ACW = require('../../modules/asset_class_weights.js');

function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: Klassen-Lookup');
assert(ACW.classOf('BTCUSDT') === 'MEGA', 'BTC = MEGA');
assert(ACW.classOf('NEARUSDT') === 'MID', 'NEAR = MID');
assert(ACW.classOf('DOGEUSDT') === 'SMALL', 'DOGE = SMALL');
assert(ACW.classOf('UNKNOWN_COIN') === 'UNKNOWN', 'unknown → fallback');

console.log('── Test 2: Weights pro Klasse summieren zu 1.0');
const val = ACW.validate();
console.log(`   validate: ${JSON.stringify(val)}`);
assert(val.ok, 'all weights sum to 1.0');

console.log('── Test 3: MEGA disabled (Block Q A2 — CPCV+HOLDOUT showed no edge)');
const mega = ACW.weightsFor('BTCUSDT');
console.log(`   MEGA weights: ${mega === null ? 'NULL (disabled)' : JSON.stringify(mega)}`);
assert(mega === null, 'MEGA weights = null (deaktiviert in Block Q A2)');

console.log('── Test 4: MID = aktueller Default (kompatibel zu globalen Weights)');
const mid = ACW.weightsFor('NEARUSDT');
console.log(`   MID: TREND=${mid.TREND} RISK=${mid.RISK}`);
assert(mid.TREND === 0.35 && mid.RISK === 0.30, 'MID matches current global defaults');

console.log('── Test 5: SMALL hat höchsten TREND + höchsten SENTIMENT');
const small = ACW.weightsFor('DOGEUSDT');
console.log(`   SMALL: TREND=${small.TREND} SENTIMENT=${small.SENTIMENT}`);
assert(small.TREND >= 0.40, 'SMALL: TREND ≥ 0.40');
assert(small.SENTIMENT >= 0.15, 'SMALL: SENTIMENT ≥ 0.15');

console.log('── Test 6: Snapshot returns full structure');
const snap = ACW.snapshot();
assert(snap.total_symbols >= 12, '12 symbols mapped');
assert(snap.classes.MEGA.length === 4, '4 MEGA coins');
assert(snap.classes.MID.length === 5, '5 MID coins');
assert(snap.classes.SMALL.length === 3, '3 SMALL coins');

console.log('── Test 7: Deep-copy (kein Mutation des Internals) — MID (MEGA is null)');
const w1 = ACW.weightsFor('NEARUSDT');
w1.TREND = 999;
const w2 = ACW.weightsFor('NEARUSDT');
assert(w2.TREND !== 999, 'returned weights are deep-copy');

console.log('\n✓ ALL 7 TESTS PASS');
