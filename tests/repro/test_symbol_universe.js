const SU = require('../../modules/symbol_universe.js');
function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: Klassen-Lookup');
assert(SU.getClass('BTCUSDT') === 'MEGA', 'BTC = MEGA');
assert(SU.getClass('NEARUSDT') === 'MID', 'NEAR = MID');
assert(SU.getClass('DOGEUSDT') === 'SMALL', 'DOGE = SMALL');
assert(SU.getClass('UNKNOWN_XYZ') === 'UNKNOWN', 'unknown fallback');

console.log('── Test 2: Floor-Lookup (Block O)');
assert(SU.getFloor('NEARUSDT') === 0.10, 'NEAR floor 0.10');
assert(SU.getFloor('SUIUSDT') === 0.10, 'SUI floor 0.10');
assert(SU.getFloor('BTCUSDT') === 0.20, 'BTC floor 0.20');
assert(SU.getFloor('UNKNOWN_XYZ') === 0.20, 'unknown → 0.20 default');

console.log('── Test 3: Allowed/Forbidden Strategies');
const btc = SU.getAllowedStrategies('BTCUSDT');
assert(JSON.stringify(btc) === '["MR"]', `BTC allowed = ['MR'], got ${JSON.stringify(btc)}`);
const btcF = SU.getForbiddenStrategies('BTCUSDT');
assert(JSON.stringify(btcF) === '["TREND"]', 'BTC forbidden = [TREND]');
const near = SU.getAllowedStrategies('NEARUSDT');
assert(JSON.stringify(near) === '["TREND"]', 'NEAR allowed = [TREND]');

console.log('── Test 4: Pair-Requirement (Block Q)');
assert(SU.requiresPair('SUIUSDT') === 'NEARUSDT', 'SUI requires NEAR');
assert(SU.requiresPair('NEARUSDT') === null, 'NEAR no pair-required');
assert(SU.requiresPair('BTCUSDT') === null, 'BTC no pair');

console.log('── Test 5: Risk-Mode');
assert(SU.getRiskMode('BTCUSDT') === 'STRICT', 'BTC STRICT');
assert(SU.getRiskMode('NEARUSDT') === 'NORMAL', 'NEAR NORMAL');
assert(SU.getRiskMode('UNKNOWN_XYZ') === 'STRICT', 'unknown → STRICT (konservativ)');

console.log('── Test 6: CUSUM-Threshold-Mult (default 1.0, SMALL 1.2)');
assert(SU.getCusumThresholdMult('BTCUSDT') === 1.0, 'BTC mult 1.0');
assert(SU.getCusumThresholdMult('DOGEUSDT') === 1.2, 'DOGE mult 1.2 (SMALL höhere Vol)');

console.log('── Test 7: Universe-Komposition');
assert(SU.TRADING_SYMBOLS.length === 12, '12 trading symbols');
assert(SU.CLASSES.MEGA.length === 4, '4 MEGA');
assert(SU.CLASSES.MID.length === 5, '5 MID');
assert(SU.CLASSES.SMALL.length === 3, '3 SMALL');
const sumClasses = SU.CLASSES.MEGA.length + SU.CLASSES.MID.length + SU.CLASSES.SMALL.length;
assert(sumClasses === 12, 'Klassen-Sum = trading-symbols');

console.log('── Test 8: isKnown');
assert(SU.isKnown('BTCUSDT'), 'BTC known');
assert(!SU.isKnown('UNKNOWN_XYZ'), 'unknown not known');

console.log('── Test 9: Deep-copy für getCoinConfig');
const c1 = SU.getCoinConfig('BTCUSDT');
c1.floor = 999;
const c2 = SU.getCoinConfig('BTCUSDT');
assert(c2.floor === 0.20, 'mutation isolated');

console.log('\n✓ ALL 9 TESTS PASS');
