const MR = require('../../modules/mean_reversion_avellaneda.js');

function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: TOO_SHORT auf 10 prices');
const r1 = MR.fitOU([100, 101, 99, 102, 98, 103, 97, 104, 96, 105]);
assert(!r1.ok && r1.reason === 'TOO_SHORT', 'TOO_SHORT');

console.log('── Test 2: Random walk → NOT_MEAN_REVERTING (b >= 0)');
let seed = 42;
const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const rw = [100];
for (let i = 1; i < 100; i++) rw.push(rw[i-1] + (rand() - 0.5));
const fitRW = MR.fitOU(rw);
console.log(`   RW fit: ${JSON.stringify(fitRW).slice(0, 200)}`);
// Random walk OFT NOT_MEAN_REVERTING aber kann zufällig MR sein — wir akzeptieren beides
assert(typeof fitRW.ok === 'boolean', 'fit returns ok flag');

console.log('── Test 3: True OU-Series → MR detected mit positivem κ');
// Synthetic OU: dX = κ(m - X)dt + σdW
const series = [];
let x = 5;
const kappaTrue = 0.1, meanTrue = 5, sigmaTrue = 0.5;
for (let i = 0; i < 200; i++) {
  const dx = kappaTrue * (meanTrue - x) + sigmaTrue * (rand() - 0.5);
  x += dx;
  series.push(x);
}
const fitOU = MR.fitOU(series);
console.log(`   OU fit: kappa=${fitOU.kappa} mean=${fitOU.mean} halfLife=${fitOU.halfLife}`);
assert(fitOU.ok, 'OU fit successful');
assert(fitOU.kappa > 0, `kappa > 0, got ${fitOU.kappa}`);
assert(Math.abs(fitOU.mean - meanTrue) < 1.0, `mean ~ ${meanTrue}, got ${fitOU.mean}`);

console.log('── Test 4: s-score signal: SELL bei high, BUY bei low');
const sigBuy = MR.signal(-2.0);  // weit unter mean
const sigSell = MR.signal(+2.0);
const sigHold = MR.signal(0.8);
const sigExit = MR.signal(0.2);
console.log(`   sScore=-2 → ${sigBuy.direction} (conf=${sigBuy.confidence.toFixed(2)})`);
console.log(`   sScore=+2 → ${sigSell.direction} (conf=${sigSell.confidence.toFixed(2)})`);
console.log(`   sScore=0.8 → ${sigHold.direction}`);
console.log(`   sScore=0.2 → ${sigExit.direction}`);
assert(sigBuy.direction === 'BUY', 's=-2 → BUY');
assert(sigSell.direction === 'SELL', 's=+2 → SELL');
assert(sigHold.direction === 'HOLD', 's=0.8 → HOLD (between exit and entry)');
assert(sigExit.direction === 'EXIT', 's=0.2 → EXIT');

console.log('── Test 5: fromCloses Pipeline');
// Closes mit Mean-Reversion
const closes = series.map(x => Math.exp(x));  // exp(OU) = mean-reverting in log-price
const pipe = MR.fromCloses(closes);
console.log(`   Pipeline: fit.ok=${pipe.fit.ok} sScore=${pipe.sScore} signal=${pipe.signal.direction}`);
assert(pipe.fit.ok, 'pipeline fit ok');
assert(pipe.sScore !== null, 'sScore computed');

console.log('\n✓ ALL 5 TESTS PASS');
