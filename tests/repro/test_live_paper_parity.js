// tests/repro/test_live_paper_parity.js
// Block Live/Paper-Parity [27.05.2026, Option C]:
// Unit-Test PAPER_INTENT vs LIVE_INTENT Parity.
//
// Christian-Pflicht: PAPER und LIVE müssen denselben FinalDecisionRouter durchlaufen
// und identische intent-Felder erzeugen, außer dem mode-Feld.
//
// Test ist READ-ONLY:
//   - keine DB-Writes
//   - kein Bot-Aufruf
//   - kein API-Call
//   - kein Restart
//
// Verwendet:
//   - FinalDecisionRouter.finalize() (bestehender Helper)
//   - TradeIntent (neues Schema)

'use strict';
const TI = require('../../modules/trade_intent.js');
const FR = require('../../modules/final_decision_router.js');

let pass=0, fail=0;
function t(name, fn){ try{ fn(); console.log('  ✓',name); pass++; } catch(e){ console.log('  ✗',name,'·',e.message); fail++; } }
function ok(c,m){ if(!c) throw new Error(m||'expected truthy'); }
function eq(a,b,m){ if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error((m||'')+` got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }

/**
 * Test-Helper: erzeuge TradeIntent + füttere durch FinalDecisionRouter.
 * Simuliert was nach Stab-Ende der Production-Pfad sein wird.
 */
function buildIntent(mode, params) {
  const intent = TI.create({ ...params, mode });
  const router = FR.finalize(
    { decision: intent.direction, confidence: intent.confidence },
    intent.symbol,
    { db: params.db || null, selectedStrategy: intent.selectedStrategy }
  );
  // Router-Output ins Intent kopieren (das macht später gateExecution())
  intent.rawSignal = router.rawSignal;
  intent.finalDecision = router.finalDecision;
  intent.tradeAllowed = router.tradeAllowed;
  intent.vetoReason = router.vetoReason;
  intent.symbolConfig = router.symbolConfig;
  intent.pairContext = router.pairContext;
  intent.vetoTag = FR.vetoTag(router);
  return intent;
}

console.log('── TradeIntent Schema-Validation');
t('create returns Pflicht-Felder', () => {
  const i = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  ok(i.sourceBot === 'GRID');
  ok(i.mode === 'PAPER');
  ok(i.finalDecision === null);  // wird später befüllt
});
t('validate ok für valide intent', () => {
  const i = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  const v = TI.validate(i);
  ok(v.ok); eq(v.errors,[]);
});
t('validate fehlt sourceBot', () => {
  const i = TI.create({symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  const v = TI.validate(i);
  ok(!v.ok); ok(v.errors.includes('missing_sourceBot'));
});
t('validate invalid mode', () => {
  const i = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'BANANA'});
  const v = TI.validate(i);
  ok(!v.ok); ok(v.errors.some(e => e.startsWith('invalid_mode:')));
});
t('validate confidence outside [0,1]', () => {
  const i = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER',confidence:1.5});
  const v = TI.validate(i);
  ok(!v.ok);
});

console.log('── diffForParity');
t('identical intents → equal', () => {
  const a = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  const b = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  const d = TI.diffForParity(a,b);
  ok(d.equal, 'diff='+JSON.stringify(d.diff));
});
t('mode-Diff wird IGNORIERT (Christian-Spec)', () => {
  const a = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  const b = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'LIVE'});
  const d = TI.diffForParity(a,b);
  ok(d.equal, 'Mode-only-diff sollte als equal gelten');
});
t('Strategy-Diff wird ERKANNT', () => {
  const a = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'GRID',mode:'PAPER'});
  const b = TI.create({sourceBot:'GRID',symbol:'BTCUSDT',direction:'BUY',selectedStrategy:'TREND',mode:'PAPER'});
  const d = TI.diffForParity(a,b);
  ok(!d.equal);
  ok(d.diff.some(x => x.field === 'selectedStrategy'));
});

console.log('── ★ PARITY TEST: PAPER_INTENT == LIVE_INTENT (außer mode)');

t('Case 1: SOL GRID → STRATEGY_NOT_ALLOWED (PAPER/LIVE identisch)', () => {
  const paperIntent = buildIntent('PAPER', {sourceBot:'GRID', symbol:'SOLUSDT', direction:'BUY', selectedStrategy:'GRID'});
  const liveIntent  = buildIntent('LIVE',  {sourceBot:'GRID', symbol:'SOLUSDT', direction:'BUY', selectedStrategy:'GRID'});
  console.log('     PAPER_INTENT:', JSON.stringify({
    symbol:paperIntent.symbol, mode:paperIntent.mode, finalDecision:paperIntent.finalDecision,
    vetoReason:paperIntent.vetoReason, tradeAllowed:paperIntent.tradeAllowed, class:(paperIntent.symbolConfig||{}).class
  }));
  console.log('     LIVE_INTENT: ', JSON.stringify({
    symbol:liveIntent.symbol, mode:liveIntent.mode, finalDecision:liveIntent.finalDecision,
    vetoReason:liveIntent.vetoReason, tradeAllowed:liveIntent.tradeAllowed, class:(liveIntent.symbolConfig||{}).class
  }));
  const d = TI.diffForParity(paperIntent, liveIntent);
  console.log('     DIFF (sollte leer sein):', JSON.stringify(d.diff));
  ok(d.equal, 'PAPER vs LIVE intent diff='+JSON.stringify(d.diff));
  eq(paperIntent.vetoReason, 'STRATEGY_NOT_ALLOWED');
  eq(liveIntent.vetoReason, 'STRATEGY_NOT_ALLOWED');
  ok(!paperIntent.tradeAllowed && !liveIntent.tradeAllowed);
});

t('Case 2: BTC TREND → STRATEGY_FORBIDDEN (PAPER/LIVE identisch)', () => {
  const paperIntent = buildIntent('PAPER', {sourceBot:'EXECFLOW', symbol:'BTCUSDT', direction:'BUY', selectedStrategy:'TREND'});
  const liveIntent  = buildIntent('LIVE',  {sourceBot:'EXECFLOW', symbol:'BTCUSDT', direction:'BUY', selectedStrategy:'TREND'});
  console.log('     PAPER_INTENT:', JSON.stringify({symbol:paperIntent.symbol, mode:paperIntent.mode, vetoReason:paperIntent.vetoReason, tradeAllowed:paperIntent.tradeAllowed}));
  console.log('     LIVE_INTENT: ', JSON.stringify({symbol:liveIntent.symbol,  mode:liveIntent.mode,  vetoReason:liveIntent.vetoReason,  tradeAllowed:liveIntent.tradeAllowed}));
  const d = TI.diffForParity(paperIntent, liveIntent);
  console.log('     DIFF:', JSON.stringify(d.diff));
  ok(d.equal);
  eq(paperIntent.vetoReason, 'STRATEGY_FORBIDDEN');
  eq(liveIntent.vetoReason, 'STRATEGY_FORBIDDEN');
});

t('Case 3: NEAR TREND → ALLOWED (PAPER/LIVE identisch)', () => {
  const paperIntent = buildIntent('PAPER', {sourceBot:'DEMO', symbol:'NEARUSDT', direction:'BUY', selectedStrategy:'TREND'});
  const liveIntent  = buildIntent('LIVE',  {sourceBot:'DEMO', symbol:'NEARUSDT', direction:'BUY', selectedStrategy:'TREND'});
  console.log('     PAPER_INTENT:', JSON.stringify({symbol:paperIntent.symbol, mode:paperIntent.mode, tradeAllowed:paperIntent.tradeAllowed, finalDir:(paperIntent.finalDecision||{}).direction}));
  console.log('     LIVE_INTENT: ', JSON.stringify({symbol:liveIntent.symbol,  mode:liveIntent.mode,  tradeAllowed:liveIntent.tradeAllowed,  finalDir:(liveIntent.finalDecision||{}).direction}));
  const d = TI.diffForParity(paperIntent, liveIntent);
  console.log('     DIFF:', JSON.stringify(d.diff));
  ok(d.equal);
  ok(paperIntent.tradeAllowed);
  ok(liveIntent.tradeAllowed);
});

t('Case 4: SEI ANALYSIS_ONLY (PAPER/LIVE identisch)', () => {
  const paperIntent = buildIntent('PAPER', {sourceBot:'INFGRID', symbol:'SEIUSDT', direction:'BUY', selectedStrategy:'GRID'});
  const liveIntent  = buildIntent('LIVE',  {sourceBot:'INFGRID', symbol:'SEIUSDT', direction:'BUY', selectedStrategy:'GRID'});
  const d = TI.diffForParity(paperIntent, liveIntent);
  ok(d.equal, 'diff='+JSON.stringify(d.diff));
  eq(paperIntent.vetoReason, 'ANALYSIS_ONLY');
  eq(liveIntent.vetoReason, 'ANALYSIS_ONLY');
});

t('Case 5: SUI ohne NEAR-Kontext → PAIR_REQUIRED (PAPER/LIVE identisch)', () => {
  const mockDB = { prepare: () => ({ get: () => ({ n: 0 }) }) };
  const paperIntent = buildIntent('PAPER', {sourceBot:'DEMO', symbol:'SUIUSDT', direction:'BUY', selectedStrategy:'TREND', db:mockDB});
  const liveIntent  = buildIntent('LIVE',  {sourceBot:'DEMO', symbol:'SUIUSDT', direction:'BUY', selectedStrategy:'TREND', db:mockDB});
  const d = TI.diffForParity(paperIntent, liveIntent);
  ok(d.equal, 'diff='+JSON.stringify(d.diff));
  eq(paperIntent.vetoReason, 'PAIR_REQUIRED');
  eq(liveIntent.vetoReason, 'PAIR_REQUIRED');
});

t('Case 6: SUI mit NEAR-Kontext → ALLOWED (PAPER/LIVE identisch)', () => {
  const mockDB = { prepare: () => ({ get: () => ({ n: 50 }) }) };
  const paperIntent = buildIntent('PAPER', {sourceBot:'DEMO', symbol:'SUIUSDT', direction:'BUY', selectedStrategy:'TREND', db:mockDB});
  const liveIntent  = buildIntent('LIVE',  {sourceBot:'DEMO', symbol:'SUIUSDT', direction:'BUY', selectedStrategy:'TREND', db:mockDB});
  const d = TI.diffForParity(paperIntent, liveIntent);
  ok(d.equal, 'diff='+JSON.stringify(d.diff));
  ok(paperIntent.tradeAllowed);
  ok(liveIntent.tradeAllowed);
  ok(paperIntent.pairContext && paperIntent.pairContext.satisfied);
});

console.log('── Cross-Source-Bot Parity (LIVE-Shadow gleicher Symbol/Strategy verschiedener sourceBot)');
t('GRID vs EXECFLOW SOLUSDT GRID → beide STRATEGY_NOT_ALLOWED', () => {
  const gridIntent = buildIntent('LIVE', {sourceBot:'GRID', symbol:'SOLUSDT', direction:'BUY', selectedStrategy:'GRID'});
  const execIntent = buildIntent('LIVE', {sourceBot:'EXECFLOW', symbol:'SOLUSDT', direction:'BUY', selectedStrategy:'GRID'});
  eq(gridIntent.vetoReason, 'STRATEGY_NOT_ALLOWED');
  eq(execIntent.vetoReason, 'STRATEGY_NOT_ALLOWED');
  // Diff sollte nur sourceBot zeigen
  const d = TI.diffForParity(gridIntent, execIntent);
  ok(!d.equal);
  ok(d.diff.length === 1);
  ok(d.diff[0].field === 'sourceBot');
});

console.log(`\n──────── PASS ${pass} / FAIL ${fail} ────────`);
process.exit(fail === 0 ? 0 : 1);
