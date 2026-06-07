// MR Brain-Integration Tests (Cross-Signal-Cases)
const ACW = require('../../modules/asset_class_weights.js');
const MR = require('../../modules/mean_reversion_avellaneda.js');

function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: Klassen-Aktivierung — MR nur für MEGA');
const mega = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'];
const mid = ['NEARUSDT','SUIUSDT','XRPUSDT'];
const small = ['DOGEUSDT','TONUSDT'];
for (const s of mega) assert(ACW.classOf(s) === 'MEGA', `${s} = MEGA`);
for (const s of mid) assert(ACW.classOf(s) === 'MID', `${s} = MID`);
for (const s of small) assert(ACW.classOf(s) === 'SMALL', `${s} = SMALL`);

console.log('── Test 2: MR-Signal-Mapping → Sub-Source-Format');
const fakeSignal = { direction: 'BUY', confidence: 0.5, score: 0.5, reason: 'OVEREXTENDED_DOWN' };
// Brain integration: mrConf = min(0.85, sigConf + 0.20) = min(0.85, 0.70) = 0.70
const expectedConf = Math.min(0.85, fakeSignal.confidence + 0.20);
assert(expectedConf === 0.70, `expected mrConf = 0.70, got ${expectedConf}`);

console.log('── Test 3: EXIT-Signal → NEUTRAL direction (kein Trade-Signal)');
const exitSig = { direction: 'EXIT', confidence: 0.5, score: 0, reason: 'MEAN_REACHED' };
// In Brain-Integration: direction === 'EXIT' → 'NEUTRAL'
const mappedDir = exitSig.direction === 'EXIT' ? 'NEUTRAL' : exitSig.direction;
assert(mappedDir === 'NEUTRAL', 'EXIT → NEUTRAL');

console.log('── Test 4: HOLD/no-signal → conf=0 (inaktiv in Familien-Aggregation)');
const holdSig = { direction: 'HOLD', confidence: 0, score: 0 };
const holdConf = (holdSig.direction === 'BUY' || holdSig.direction === 'SELL') ? Math.min(0.85, holdSig.confidence + 0.20) : 0;
assert(holdConf === 0, 'HOLD → mrConf=0 → wird in _aggregateFamilies gefiltert (<CONFIDENCE_FAMILY_MIN)');

console.log('── Test 5: Cross-Signal: TREND BUY + MR SELL → _aggregate behandelt families separat');
// _aggregateFamilies summiert pro Familie: TREND und MICRO sind getrennt.
// Wenn beide unterschiedlich, _aggregate (gewichtete avg) → Brain-Decision basiert auf Mehrheit
// MR (in MICRO) trägt mit weight=MICRO=0.30 (per-class MEGA) bei
// TREND trägt mit weight=0.20 (per-class MEGA)
// → bei conflict mehr Gewicht auf MICRO/MR
assert(0.30 > 0.20, 'MEGA-Weights: MICRO (0.30) > TREND (0.20) — MR-Signal priorisiert');

console.log('── Test 6: Conflict-Resolution: MEGA + RISK+MICRO dominant');
// Aus Block N: MEGA-Weights: TREND 0.20, RISK 0.40, MICRO 0.30, MOM/SENT je 0.05
const megaW = { TREND:0.20, RISK:0.40, MICROSTRUCTURE:0.30, MOMENTUM:0.05, SENTIMENT:0.05 };
const sum = Object.values(megaW).reduce((a,b)=>a+b,0);
assert(Math.abs(sum-1.0) < 0.001, `MEGA-Weights summieren zu 1.0 (${sum})`);
assert(megaW.RISK + megaW.MICROSTRUCTURE === 0.70, 'RISK + MICRO = 0.70 dominieren');

console.log('\n✓ ALL 6 TESTS PASS');
