// Test-First: CPCV + DSR
const CPCV = require('../../modules/cpcv_validation.js');
const DS = require('../../modules/deflated_sharpe.js');

function assert(cond, msg) { if (!cond) { console.log('  FAIL:', msg); process.exit(1); } console.log('  ✓', msg); }

console.log('── Test 1: CPCV combinations(6, 2)');
const combos = CPCV.combinations(6, 2);
assert(combos.length === 15, `C(6,2) = 15, got ${combos.length}`);

console.log('── Test 2: numPaths(6, 2) = 2*15/6 = 5');
const paths = CPCV.numPaths(6, 2);
assert(paths === 5, `φ[6,2] = 5, got ${paths}`);

console.log('── Test 3: Synthetic random returns (zero-mean) → kein klarer Edge erkennbar');
let seed = 42;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
const randomReturns = Array.from({length: 500}, () => (rand() - 0.5) * 0.02);
const sr = DS.sharpe(randomReturns, 252*24);
console.log('   Random Sharpe (seeded):', sr.toFixed(2));
const skew = DS.skewness(randomReturns);
const kurt = DS.kurtosis(randomReturns);
const dsrRand = DS.deflated(sr, 20, skew, kurt, randomReturns.length);
console.log('   DSR random (N=20 trials):', JSON.stringify(dsrRand));
// Mathematisch korrekt: bei Zero-mean Sharpe<E[max SR] → DSR<0 → prob<0.5
assert(dsrRand.prob < 0.6, `Random DSR-prob should be <0.6 (no clear edge), got ${dsrRand.prob}`);

console.log('── Test 4: Synthetic edge series (positive mean) → DSR > 0');
const edgeReturns = Array.from({length: 500}, () => 0.002 + (Math.random() - 0.5) * 0.02);
const sr2 = DS.sharpe(edgeReturns, 252*24);
console.log('   Edge Sharpe:', sr2.toFixed(2));
const dsrEdge = DS.deflated(sr2, 20, DS.skewness(edgeReturns), DS.kurtosis(edgeReturns), edgeReturns.length);
console.log('   DSR edge:', JSON.stringify(dsrEdge));
assert(dsrEdge.prob > 0.8, `Edge DSR-prob should be >0.8, got ${dsrEdge.prob}`);

console.log('── Test 5: CPCV split structure (10 samples, N=5, k=2)');
const samples = Array.from({length: 100}, (_, i) => ({ ts: i * 1000, val: Math.random() }));
const splits = CPCV.generateSplits(samples, 5, 2, 0.01);
console.log(`   Splits: ${splits.splits.length} (expected C(5,2)=10)`);
assert(splits.splits.length === 10, 'Splits count');
const firstSplit = splits.splits[0];
console.log(`   First split: train=${firstSplit.train.length} test=${firstSplit.test.length} testGroups=[${firstSplit.testGroups}]`);
assert(firstSplit.train.length + firstSplit.test.length <= 100, 'No data duplication');
assert(firstSplit.test.length === 40, `Test size should be 2/5 * 100 = 40, got ${firstSplit.test.length}`);

console.log('── Test 6: PBO on robust series (all positive)');
const robustPaths = [
  Array.from({length:50},()=>0.001+(Math.random()-0.4)*0.01),
  Array.from({length:50},()=>0.001+(Math.random()-0.4)*0.01),
  Array.from({length:50},()=>0.001+(Math.random()-0.4)*0.01),
];
const pboRobust = DS.pbo(robustPaths);
console.log('   PBO robust:', JSON.stringify(pboRobust));
assert(pboRobust.pbo < 0.5, `Robust PBO should be <0.5, got ${pboRobust.pbo}`);

console.log('\n✓ ALL TESTS PASS');
