const PG = require('../../modules/whitelist_pair_guard.js');
function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: NEAR ist nicht Pair-Secondary (allowed)');
const r1 = PG.isAllowed('NEARUSDT', null);
assert(r1.allowed, 'NEAR allowed');
assert(r1.reason === 'NOT_PAIR_SECONDARY', 'reason correct');

console.log('── Test 2: BTC nicht Pair (allowed)');
assert(PG.isAllowed('BTCUSDT', null).allowed, 'BTC allowed');

console.log('── Test 3: SUI ohne DB-conn (fallback allow)');
const r3 = PG.isAllowed('SUIUSDT', null);
console.log('   reason:', r3.reason);
assert(r3.allowed && r3.primary === 'NEARUSDT', 'SUI requires NEAR');

console.log('── Test 4: effectiveFloor wenn pair-guard SPERRT');
// Mock DB die 0 NEAR-Activity returnt
const mockDB = { prepare: () => ({ get: () => ({ n: 0 }) }) };
const eff = PG.effectiveFloor('SUIUSDT', 0.10, 0.20, mockDB);
console.log('   eff:', JSON.stringify(eff));
assert(eff.floor === 0.20, 'SUI falls auf 0.20 (fallback) wenn NEAR inaktiv');
assert(!eff.guard.allowed, 'guard sagt nicht erlaubt');

console.log('── Test 5: effectiveFloor wenn NEAR aktiv');
const mockDBActive = { prepare: () => ({ get: () => ({ n: 50 }) }) };
const eff2 = PG.effectiveFloor('SUIUSDT', 0.10, 0.20, mockDBActive);
console.log('   eff active:', JSON.stringify(eff2));
assert(eff2.floor === 0.10, 'SUI bekommt 0.10 wenn NEAR aktiv');
assert(eff2.guard.allowed, 'guard sagt erlaubt');

console.log('── Test 6: BTC ist nicht Pair → kein Guard-Effect');
const eff3 = PG.effectiveFloor('BTCUSDT', 0.10, 0.20, mockDB);
assert(eff3.floor === 0.10, 'BTC bekommt whitelist-floor (kein Guard)');

console.log('── Test 7 [Block S-Prep A1]: getRequiredPair single-source');
assert(PG.getRequiredPair('SUIUSDT') === 'NEARUSDT', 'getRequiredPair(SUI)=NEAR');
assert(PG.getRequiredPair('NEARUSDT') === null, 'getRequiredPair(NEAR)=null');
assert(PG.getRequiredPair('BTCUSDT') === null, 'getRequiredPair(BTC)=null');
assert(PG.getRequiredPair('UNKNOWN_XYZ') === null, 'getRequiredPair(unknown)=null');

console.log('── Test 8 [Block S-Prep A1]: Konsistenz SymbolUniverse ↔ Pair-Guard');
const SU = require('../../modules/symbol_universe.js');
const pgPairs = PG.listPairs();
const suPairs = {};
for (const [sym, cfg] of Object.entries(SU.COIN_CONFIG)) {
  if (cfg.requires_pair) suPairs[sym] = cfg.requires_pair;
}
console.log('   PG pairs:', JSON.stringify(pgPairs));
console.log('   SU pairs:', JSON.stringify(suPairs));
assert(JSON.stringify(pgPairs) === JSON.stringify(suPairs), 'Pair-Maps identisch');

console.log('── Test 9 [Block S-Prep A1]: snapshot.source = SymbolUniverse');
const snap = PG.snapshot(null);
console.log('   snapshot:', JSON.stringify(snap).substring(0, 200));
assert(snap.source === 'SymbolUniverse', 'snapshot meldet SymbolUniverse als Source');
assert(snap.pairs.SUIUSDT.requires_primary === 'NEARUSDT', 'snapshot enthält SUI→NEAR');

console.log('── Test 10 [Block S-Prep A1]: Pair-Guard greift wenn SU SUI auf null setzt');
// Mutiere temporär — testet die single-source-Logik
const orig = SU.COIN_CONFIG.SUIUSDT.requires_pair;
SU.COIN_CONFIG.SUIUSDT.requires_pair = null;
delete require.cache[require.resolve('../../modules/whitelist_pair_guard.js')];
const PG2 = require('../../modules/whitelist_pair_guard.js');
const eff4 = PG2.effectiveFloor('SUIUSDT', 0.10, 0.20, mockDB);
console.log('   eff nach SU-Disable:', JSON.stringify(eff4));
assert(eff4.floor === 0.10, 'SUI bekommt whitelist-floor (Pair-Constraint weg)');
assert(eff4.guard.allowed, 'guard allowed=true (kein Pair mehr)');
SU.COIN_CONFIG.SUIUSDT.requires_pair = orig; // restore

console.log('\n✓ ALL TESTS PASS');
