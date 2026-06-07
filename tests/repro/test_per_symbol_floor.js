function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

const SYMBOL_FLOORS = { NEARUSDT: 0.10, SUIUSDT: 0.10 };
const SCORE_FLOOR_REGIME_MAP = { BULL:0.08, NEUTRAL:0.10, RANGING:0.12, BEAR:0.15 };
const GLOBAL_FLOOR = 0.08;

function getFloor(symbol, regime, perSymbolEnabled, regimeEnabled) {
  if (perSymbolEnabled && SYMBOL_FLOORS[symbol] !== undefined) return SYMBOL_FLOORS[symbol];
  if (regimeEnabled && SCORE_FLOOR_REGIME_MAP[regime] !== undefined) return SCORE_FLOOR_REGIME_MAP[regime];
  return GLOBAL_FLOOR;
}

console.log('── Test 1: NEAR + per-symbol enabled → 0.10');
assert(getFloor('NEARUSDT', 'NEUTRAL', true, true) === 0.10, 'NEAR floor 0.10');

console.log('── Test 2: BTC unknown → fallback regime/global');
assert(getFloor('BTCUSDT', 'BEAR', true, true) === 0.15, 'BTC BEAR → regime-floor 0.15');
assert(getFloor('BTCUSDT', 'NEUTRAL', true, false) === 0.08, 'BTC NEUTRAL kein regime → global 0.08');

console.log('── Test 3: SUI in BEAR → per-symbol overrides regime');
assert(getFloor('SUIUSDT', 'BEAR', true, true) === 0.10, 'SUI per-symbol > regime');

console.log('── Test 4: PER_SYMBOL disabled → fallback regime');
assert(getFloor('NEARUSDT', 'BULL', false, true) === 0.08, 'NEAR ohne PER_SYMBOL → BULL-regime');

console.log('\n✓ ALL 4 TESTS PASS');
