const PSB = require('../../modules/bayesian_per_symbol.js');
function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: Module lädt ohne crash');
assert(typeof PSB.getPosterior === 'function', 'getPosterior method exists');
assert(typeof PSB.updatePosterior === 'function', 'updatePosterior method exists');
assert(typeof PSB.loadAll === 'function', 'loadAll method exists');

console.log('── Test 2: getPosterior für unknown symbol → global fallback');
const global = { bull: 0.33, bear: 0.33, sideways: 0.34 };
const r1 = PSB.getPosterior('NEW_SYMBOL', global);
console.log(' ', JSON.stringify(r1));
assert(r1.source === 'global', 'unknown → global');
assert(r1.posterior.bull === 0.33, 'returnt global prior');
assert(r1.n_observations === 0, 'n=0');

console.log('── Test 3: updatePosterior bei nicht-existent → erstellt');
const u1 = PSB.updatePosterior('TEST_BTC', 'bull', null);
assert(u1.ok, 'update ok');
assert(u1.posterior.bull > 0.33, `bull nudge: ${u1.posterior.bull}`);

console.log('── Test 4: Mehrfach-Update zeigt Konvergenz');
for (let i = 0; i < 50; i++) PSB.updatePosterior('TEST_BTC', 'bear', null);
const after = PSB.getPosterior('TEST_BTC', global);
console.log(' ', JSON.stringify(after));
// nach 50 bear-updates: source=symbol (n>30) + bear hoch
assert(after.source === 'symbol', `source=symbol nach n>30, got ${after.source}, n=${after.n_observations}`);
assert(after.posterior.bear > 0.45, `bear-prior gestiegen: ${after.posterior.bear}`);

console.log('── Test 5: Caps verhindern Kollaps (bull nicht 0)');
for (let i = 0; i < 200; i++) PSB.updatePosterior('TEST_BTC', 'bear', null);
const ext = PSB.getPosterior('TEST_BTC', global);
assert(ext.posterior.bull >= 0.04, `bull über Cap 0.05, got ${ext.posterior.bull}`);

console.log('── Test 6: loadAll ohne DB → graceful');
const ld = PSB.loadAll(null);
assert(!ld.ok && ld.error === 'NO_DB', 'NO_DB error');

console.log('── Test 7: Snapshot returnt richtige Form');
const snap = PSB.snapshot();
assert(typeof snap.total_symbols === 'number', 'snapshot has total_symbols');
assert(snap.min_obs_for_symbol === 30, 'MIN_OBS_FOR_SYMBOL = 30');

console.log('── Test 8: Invalid regime returnt error');
const inv = PSB.updatePosterior('TEST_BTC', 'choppy', null);
assert(!inv.ok, 'INVALID_REGIME caught');

console.log('\n✓ ALL 8 TESTS PASS');
