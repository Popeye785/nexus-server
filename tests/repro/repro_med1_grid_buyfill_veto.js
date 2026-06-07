// MED-1 test-first: GRID BUY_FILL-Veto fuer NEAR/SUI/BNB.
// RED (vor Fix): validateStrategy(sym,'GRID').ok===false (STRATEGY_NOT_ALLOWED) fuer alle 3.
// GREEN (nach Fix): ===true fuer die 3; gateExecution(op=BUY_FILL) ok fuer NEAR/BNB;
//   Regression: XRPUSDT bleibt GRID-false, DCA->TREND/MR unveraendert, Exposure-Veto intakt.
'use strict';
const SV = require('../../modules/strategy_veto');
const Router = require('../../modules/final_decision_router');

const TARGETS = ['NEARUSDT', 'SUIUSDT', 'BNBUSDT'];
let red = 0, green = 0, fail = 0;
const log = (s) => process.stdout.write(s + '\n');

function expect(name, cond) {
  if (cond) { green++; log('  GREEN ' + name); }
  else { fail++; log('  FAIL  ' + name); }
}

log('=== MED-1 GRID BUY_FILL Veto — Status der 3 Ziel-Symbole ===');
for (const sym of TARGETS) {
  const v = SV.validateStrategy(sym, 'GRID');
  log(`  ${sym}: validateStrategy('GRID') ok=${v.ok} reason=${v.reason} allowed=[${v.allowed}]`);
  if (!v.ok && v.reason === 'STRATEGY_NOT_ALLOWED') red++;
}

if (red === TARGETS.length) {
  log(`\n[RED CONFIRMED] alle ${TARGETS.length} Symbole STRATEGY_NOT_ALLOWED fuer GRID — Fix noch nicht aktiv.`);
  process.exit(2);
}

log('\n=== GREEN-Checks (nach Fix erwartet) ===');
// 1) Core: validateStrategy GRID ===true fuer die 3
for (const sym of TARGETS) expect(`${sym} validateStrategy('GRID').ok`, SV.validateStrategy(sym, 'GRID').ok === true);

// 2) gateExecution(op=BUY_FILL) ok fuer NEAR/BNB (kein requires_pair, db=null)
for (const sym of ['NEARUSDT', 'BNBUSDT']) {
  const g = Router.gateExecution({ sourceBot: 'GRID', symbol: sym, direction: 'BUY', selectedStrategy: 'GRID', operation: 'BUY_FILL', db: null });
  expect(`${sym} gateExecution(BUY_FILL).ok`, g.ok === true);
}

log('\n=== Regression ===');
// 3) ein anderes Symbol bleibt GRID-false
{
  const v = SV.validateStrategy('XRPUSDT', 'GRID');
  expect('XRPUSDT GRID bleibt verboten (STRATEGY_NOT_ALLOWED)', v.ok === false && v.reason === 'STRATEGY_NOT_ALLOWED');
}
// 4) DCA->TREND unveraendert (MID erlaubt TREND)
expect('NEARUSDT DCA(->TREND) weiterhin ok', SV.validateStrategy('NEARUSDT', 'DCA').ok === true);
// 5) MR unveraendert (BTC MEGA)
expect('BTCUSDT MR weiterhin ok', SV.validateStrategy('BTCUSDT', 'MR').ok === true);
// 6) TREND unveraendert (NEAR behaelt TREND)
expect('NEARUSDT TREND weiterhin ok', SV.validateStrategy('NEARUSDT', 'TREND').ok === true);
// 7) BNB: TREND bleibt verboten (forbidden_strategies enthaelt TREND) — Fix darf das nicht aufweichen
{
  const v = SV.validateStrategy('BNBUSDT', 'TREND');
  expect('BNBUSDT TREND bleibt forbidden', v.ok === false && v.reason === 'STRATEGY_FORBIDDEN');
}
// 8) Exposure-Veto intakt: nicht-gelistetes Symbol GRID BUY_FILL bleibt geblockt
{
  const g = Router.gateExecution({ sourceBot: 'GRID', symbol: 'XRPUSDT', direction: 'BUY', selectedStrategy: 'GRID', operation: 'BUY_FILL', db: null });
  expect('XRPUSDT gateExecution(BUY_FILL) bleibt geblockt', g.ok === false && g.vetoReason === 'STRATEGY_NOT_ALLOWED');
}
// 9) Maintenance bypass unveraendert: SELL_FILL laeuft trotz GRID-Strategie
{
  const g = Router.gateExecution({ sourceBot: 'GRID', symbol: 'XRPUSDT', direction: 'SELL', selectedStrategy: 'GRID', operation: 'SELL_FILL', db: null });
  expect('XRPUSDT SELL_FILL (maintenance) bleibt erlaubt', g.ok === true);
}

log(`\n=== ERGEBNIS: GREEN=${green} FAIL=${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
