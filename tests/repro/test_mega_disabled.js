const ACW = require('../../modules/asset_class_weights.js');
function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: MEGA returns null (fallback signal)');
const btc = ACW.weightsFor('BTCUSDT');
console.log('   BTC:', btc);
assert(btc === null, 'BTC weightsFor → null');

console.log('── Test 2: MID weiter aktiv');
const near = ACW.weightsFor('NEARUSDT');
console.log('   NEAR:', JSON.stringify(near));
assert(near && near.TREND === 0.35, 'NEAR aktiv (TREND 0.35)');

console.log('── Test 3: SMALL weiter aktiv');
const doge = ACW.weightsFor('DOGEUSDT');
assert(doge && doge.TREND === 0.40, 'DOGE aktiv');

console.log('── Test 4: UNKNOWN fallback');
const unk = ACW.weightsFor('UNKNOWN_XYZ');
assert(unk && unk.TREND === 0.35, 'UNKNOWN → fallback MID-defaults');

console.log('── Test 5: validate() weiter ok');
const val = ACW.validate();
console.log('   validate:', val);
assert(val.ok || val.issues.every(i => i.class === 'MEGA'), 'validate ok oder nur MEGA-issue');

console.log('\n✓ ALL TESTS PASS');
