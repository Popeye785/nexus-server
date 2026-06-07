const CUSUM = require('../../modules/cusum_filter.js');

function assert(c, m) { if(!c) { console.log('FAIL:', m); process.exit(1); } console.log('  ✓', m); }

console.log('── Test 1: Init + first tick (no event)');
CUSUM.resetAll();
const r1 = CUSUM.update('BTC', 75000, 1);
assert(!r1.event, 'first tick: no event');
assert(CUSUM.snapshot('BTC').totalTicks === 1, '1 tick');

console.log('── Test 2: Constant prices → no event');
for (let i = 0; i < 100; i++) CUSUM.update('BTC', 75000, i+2);
const snap2 = CUSUM.snapshot('BTC');
console.log('   Stats:', snap2);
assert(snap2.totalEvents === 0, `constant → 0 events, got ${snap2.totalEvents}`);

console.log('── Test 3: Large jump → event triggered');
CUSUM.resetAll();
CUSUM.initSymbol('BTC');
CUSUM.setThreshold('BTC', 0.01); // 1% threshold
CUSUM.update('BTC', 75000, 1);
const big = CUSUM.update('BTC', 76000, 2); // ~1.32% up → event
console.log('   Result:', big);
assert(big.event && big.side === 'UP', 'big up move → UP event');

console.log('── Test 4: Drift threshold not breached');
CUSUM.resetAll();
CUSUM.initSymbol('BTC');
CUSUM.setThreshold('BTC', 0.02);
CUSUM.update('BTC', 75000, 1);
let totalEvents = 0;
let p = 75000;
for (let i = 0; i < 50; i++) {
  p = p * (1 + 0.001); // 0.1% per step, drift but threshold 2%
  const r = CUSUM.update('BTC', p, i+2);
  if (r.event) totalEvents++;
}
console.log(`   Events after 50× 0.1%-drift: ${totalEvents}`);
assert(totalEvents >= 2, `drift cumulates → at least 2 events, got ${totalEvents}`);

console.log('── Test 5: Calibrate threshold from synthetic series');
const closes = [];
let p2 = 75000;
let seed = 42;
const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
for (let i = 0; i < 200; i++) {
  p2 *= 1 + (rand() - 0.5) * 0.01; // ±0.5% noise
  closes.push(p2);
}
const thresh = CUSUM.calibrateThreshold(closes);
console.log(`   Auto-Threshold (h_mult=2, ~0.5%-sigma): ${thresh}`);
assert(thresh > 0.002 && thresh < 0.02, `threshold reasonable, got ${thresh}`);

console.log('── Test 6: Reset on event');
CUSUM.resetAll();
CUSUM.initSymbol('BTC');
CUSUM.setThreshold('BTC', 0.01);
CUSUM.update('BTC', 100, 1);
CUSUM.update('BTC', 102, 2); // big up
const after = CUSUM.snapshot('BTC');
console.log('   After event:', after);
assert(after.S_plus === 0 && after.S_minus === 0, 'S resets after event');

console.log('\n✓ ALL TESTS PASS');
