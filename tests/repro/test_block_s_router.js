// Block S — Final-Decision-Router + Strategy-Veto + Analysis-Symbols + Pair-FinalDecision Tests
'use strict';
const SU = require('../../modules/symbol_universe.js');
const SV = require('../../modules/strategy_veto.js');
const PG = require('../../modules/whitelist_pair_guard.js');
const FR = require('../../modules/final_decision_router.js');

let pass=0, fail=0;
function t(name, fn){ try{ fn(); console.log('  ✓',name); pass++; } catch(e){ console.log('  ✗',name,'·',e.message); fail++; } }
function eq(a,b,msg){ if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg||'')+` got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function ok(cond,msg){ if(!cond) throw new Error(msg||'expected truthy'); }

console.log('── SymbolUniverse A5: ANALYSIS_SYMBOLS + isTradable + isAnalysisOnly');
t('TRADING_SYMBOLS unverändert 12', ()=>eq(SU.TRADING_SYMBOLS.length, 12));
t('ANALYSIS_SYMBOLS 9 phantom-coins', ()=>eq(SU.ANALYSIS_SYMBOLS.length, 9));
t('SEI ∈ ANALYSIS_SYMBOLS', ()=>ok(SU.ANALYSIS_SYMBOLS.includes('SEIUSDT')));
t('isTradable BTC=true', ()=>ok(SU.isTradable('BTCUSDT')));
t('isTradable SEI=false', ()=>ok(!SU.isTradable('SEIUSDT')));
t('isTradable UNKNOWN=false', ()=>ok(!SU.isTradable('XYZUSDT')));
t('isAnalysisOnly SEI=true', ()=>ok(SU.isAnalysisOnly('SEIUSDT')));
t('isAnalysisOnly BTC=false', ()=>ok(!SU.isAnalysisOnly('BTCUSDT')));
t('SEI cfg has analysis_only=true', ()=>ok(SU.getCoinConfig('SEIUSDT').analysis_only === true));
t('SEI floor=0.999 (sperrt Trade-Routing)', ()=>eq(SU.getCoinConfig('SEIUSDT').floor, 0.999));

console.log('── StrategyVeto A3');
t('BTC + TREND → STRATEGY_FORBIDDEN', ()=>{
  const v = SV.validateStrategy('BTCUSDT','TREND');
  ok(!v.ok); eq(v.reason,'STRATEGY_FORBIDDEN');
});
t('BTC + MR → OK', ()=>{
  const v = SV.validateStrategy('BTCUSDT','MR');
  ok(v.ok);
});
t('NEAR + TREND → OK', ()=>{
  const v = SV.validateStrategy('NEARUSDT','TREND');
  ok(v.ok);
});
t('NEAR + MR → STRATEGY_NOT_ALLOWED', ()=>{
  const v = SV.validateStrategy('NEARUSDT','MR');
  ok(!v.ok); eq(v.reason,'STRATEGY_NOT_ALLOWED');
});
t('SEI + TREND → STRATEGY_FORBIDDEN (analysis-only)', ()=>{
  const v = SV.validateStrategy('SEIUSDT','TREND');
  ok(!v.ok); eq(v.reason,'STRATEGY_FORBIDDEN');
});
t('DCA bot-type normalisiert auf TREND', ()=>eq(SV.normalize('DCA'),'TREND'));
t('DEMO_DCA_BTCUSDT → TREND', ()=>eq(SV.normalize('DEMO_DCA_BTCUSDT'),'TREND'));
t('isAllowed convenience: NEAR+TREND=true', ()=>ok(SV.isAllowed('NEARUSDT','TREND')));

console.log('── WhitelistPairGuard A4: checkFinalDecision');
t('checkFinalDecision NEAR (no pair) → allowed', ()=>{
  const r = PG.checkFinalDecision('NEARUSDT', null);
  ok(r.allowed); eq(r.reason,'NO_PAIR_REQUIREMENT');
});
t('checkFinalDecision SUI ohne DB → fallback allow', ()=>{
  const r = PG.checkFinalDecision('SUIUSDT', null);
  ok(r.allowed); ok(r.reason.includes('FALLBACK'));
});
t('checkFinalDecision SUI mit NEAR-inactive-DB → blocked', ()=>{
  const mockDB = { prepare: () => ({ get: () => ({ n: 0 }) }) };
  const r = PG.checkFinalDecision('SUIUSDT', mockDB);
  ok(!r.allowed); eq(r.reason,'PRIMARY_INACTIVE');
});

console.log('── FinalDecisionRouter A2: Vollintegration');
t('BTC + BUY + MR → tradeAllowed=true (rawSignal===finalDecision)', ()=>{
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'BTCUSDT', {selectedStrategy:'MR'});
  ok(r.tradeAllowed);
  eq(r.finalDecision.direction,'BUY');
  eq(r.finalDecision.status,'ALLOWED');
  eq(r.rawSignal.direction,'BUY');
  eq(r.vetoReason,null);
});
t('BTC + BUY + TREND → STRATEGY_FORBIDDEN, finalDecision=HOLD', ()=>{
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'BTCUSDT', {selectedStrategy:'TREND'});
  ok(!r.tradeAllowed);
  eq(r.finalDecision.direction,'HOLD');
  eq(r.vetoReason,'STRATEGY_FORBIDDEN');
  eq(r.rawSignal.direction,'BUY','rawSignal MUSS BUY bleiben');
});
t('SEI + BUY → ANALYSIS_ONLY, finalDecision=HOLD', ()=>{
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'SEIUSDT', {selectedStrategy:'TREND'});
  ok(!r.tradeAllowed);
  eq(r.vetoReason,'ANALYSIS_ONLY');
  eq(r.finalDecision.status,'ANALYSIS_ONLY');
  eq(r.rawSignal.direction,'BUY');
});
t('XYZ (unknown) + BUY → NOT_IN_TRADING_UNIVERSE', ()=>{
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'XYZUSDT', {selectedStrategy:'TREND'});
  ok(!r.tradeAllowed);
  eq(r.vetoReason,'NOT_IN_TRADING_UNIVERSE');
  eq(r.finalDecision.status,'BLOCKED');
});
t('SUI + BUY ohne DB → tradeAllowed=true (fallback allow)', ()=>{
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'SUIUSDT', {selectedStrategy:'TREND', db:null});
  ok(r.tradeAllowed);
});
t('SUI + BUY + NEAR-inactive → PAIR_REQUIRED, finalDecision=HOLD', ()=>{
  const mockDB = { prepare: () => ({ get: () => ({ n: 0 }) }) };
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'SUIUSDT', {selectedStrategy:'TREND', db:mockDB});
  ok(!r.tradeAllowed);
  eq(r.vetoReason,'PAIR_REQUIRED');
  ok(r.pairContext);
  eq(r.pairContext.required,'NEARUSDT');
  ok(!r.pairContext.satisfied);
});
t('SUI + BUY + NEAR-active → tradeAllowed=true, pairContext.satisfied=true', ()=>{
  const mockDB = { prepare: () => ({ get: () => ({ n: 50 }) }) };
  const r = FR.finalize({decision:'BUY',confidence:0.5}, 'SUIUSDT', {selectedStrategy:'TREND', db:mockDB});
  ok(r.tradeAllowed);
  ok(r.pairContext.satisfied);
});
t('HOLD passthrough — kein Veto-Bedarf', ()=>{
  const r = FR.finalize({decision:'HOLD',confidence:0.1}, 'BTCUSDT', {});
  ok(!r.tradeAllowed);
  eq(r.finalDecision.direction,'HOLD');
  eq(r.vetoReason,null);
});
t('vetoTag mapping', ()=>{
  const sei = FR.finalize({decision:'BUY',confidence:0.5}, 'SEIUSDT', {selectedStrategy:'TREND'});
  eq(FR.vetoTag(sei), '[ANALYSIS_ONLY]');
  const btcF = FR.finalize({decision:'BUY',confidence:0.5}, 'BTCUSDT', {selectedStrategy:'TREND'});
  eq(FR.vetoTag(btcF), '[STRATEGY_VETO]');
  const xyz = FR.finalize({decision:'BUY',confidence:0.5}, 'XYZUSDT', {selectedStrategy:'TREND'});
  eq(FR.vetoTag(xyz), '[UNIVERSE_VETO]');
});

// Block Router-Coverage [27.05.2026]: gateExecution Helper Tests
console.log('── gateExecution — alle Bot-Pfade');
t('GridBot SOL GRID → STRATEGY_NOT_ALLOWED', ()=>{
  const r = FR.gateExecution({sourceBot:'GRID', symbol:'SOLUSDT', direction:'BUY', selectedStrategy:'GRID'});
  ok(!r.ok); eq(r.vetoReason,'STRATEGY_NOT_ALLOWED');
  ok(r.logLine.includes('[FINAL_VETO]'));
  ok(r.logLine.includes('sourceBot=GRID'));
  ok(r.logLine.includes('symbol=SOLUSDT'));
  ok(r.logLine.includes('strategy=GRID'));
});
t('BTCUSDT TREND any source → STRATEGY_FORBIDDEN', ()=>{
  const r = FR.gateExecution({sourceBot:'EXECFLOW', symbol:'BTCUSDT', direction:'BUY', selectedStrategy:'TREND'});
  ok(!r.ok); eq(r.vetoReason,'STRATEGY_FORBIDDEN');
});
t('ETHUSDT GRID → STRATEGY_NOT_ALLOWED (MEGA allowed only MR)', ()=>{
  const r = FR.gateExecution({sourceBot:'GRID', symbol:'ETHUSDT', direction:'SELL', selectedStrategy:'GRID'});
  ok(!r.ok); eq(r.vetoReason,'STRATEGY_NOT_ALLOWED');
});
t('NEARUSDT TREND → ALLOWED (MID)', ()=>{
  const r = FR.gateExecution({sourceBot:'DEMO', symbol:'NEARUSDT', direction:'BUY', selectedStrategy:'TREND'});
  ok(r.ok); eq(r.vetoReason,null); ok(r.logLine===null);
});
t('SUI ohne NEAR-Kontext → PAIR_REQUIRED', ()=>{
  const mockDB = { prepare: () => ({ get: () => ({ n: 0 }) }) };
  const r = FR.gateExecution({sourceBot:'GRID', symbol:'SUIUSDT', direction:'BUY', selectedStrategy:'TREND', db:mockDB});
  ok(!r.ok); eq(r.vetoReason,'PAIR_REQUIRED');
});
t('SUI mit NEAR-aktiv → ALLOWED', ()=>{
  const mockDB = { prepare: () => ({ get: () => ({ n: 50 }) }) };
  const r = FR.gateExecution({sourceBot:'GRID', symbol:'SUIUSDT', direction:'BUY', selectedStrategy:'TREND', db:mockDB});
  ok(r.ok);
});
t('SEIUSDT any → ANALYSIS_ONLY', ()=>{
  const r = FR.gateExecution({sourceBot:'GRID', symbol:'SEIUSDT', direction:'BUY', selectedStrategy:'GRID'});
  ok(!r.ok); eq(r.vetoReason,'ANALYSIS_ONLY');
});
t('Unknown symbol → NOT_IN_TRADING_UNIVERSE', ()=>{
  const r = FR.gateExecution({sourceBot:'EXECFLOW', symbol:'XYZUSDT', direction:'BUY', selectedStrategy:'TREND'});
  ok(!r.ok); eq(r.vetoReason,'NOT_IN_TRADING_UNIVERSE');
});
t('HOLD → no veto, no order (rawSignal=HOLD)', ()=>{
  const r = FR.gateExecution({sourceBot:'DEMO', symbol:'BTCUSDT', direction:'HOLD', selectedStrategy:null});
  ok(!r.ok);  // HOLD = kein Trade
  ok(r.vetoReason === undefined || r.vetoReason === null);
});

// Block NACH-STAB [27.05.2026]: ExchangeRegistry-Hook Pflicht-Tests
console.log('── ★ EXCHANGE_REGISTRY 5 Pflicht-Tests');
t('ExchangeRegistry SOL GRID → STRATEGY_NOT_ALLOWED', ()=>{
  const r = FR.gateExecution({sourceBot:'MULTIEX', symbol:'SOLUSDT', direction:'BUY', selectedStrategy:'GRID'});
  ok(!r.ok); eq(r.vetoReason,'STRATEGY_NOT_ALLOWED');
  ok(r.logLine.includes('sourceBot=MULTIEX'));
});
t('ExchangeRegistry SEI any → ANALYSIS_ONLY', ()=>{
  const r = FR.gateExecution({sourceBot:'MULTIEX', symbol:'SEIUSDT', direction:'BUY', selectedStrategy:'TREND'});
  ok(!r.ok); eq(r.vetoReason,'ANALYSIS_ONLY');
});
t('ExchangeRegistry NEAR TREND → ALLOWED', ()=>{
  const r = FR.gateExecution({sourceBot:'MULTIEX', symbol:'NEARUSDT', direction:'BUY', selectedStrategy:'TREND'});
  ok(r.ok); ok(r.vetoReason === null || r.vetoReason === undefined);
});
t('ExchangeRegistry sell-Direction wird BUY/SELL korrekt erkannt', ()=>{
  // Even if 'sell' lowercase, gate must work
  const r = FR.gateExecution({sourceBot:'MULTIEX', symbol:'NEARUSDT', direction:'SELL', selectedStrategy:'TREND'});
  ok(r.ok);
});
t('ExchangeRegistry BTC TREND → STRATEGY_FORBIDDEN', ()=>{
  const r = FR.gateExecution({sourceBot:'MULTIEX', symbol:'BTCUSDT', direction:'BUY', selectedStrategy:'TREND'});
  ok(!r.ok); eq(r.vetoReason,'STRATEGY_FORBIDDEN');
});

console.log(`\n──────── PASS ${pass} / FAIL ${fail} ────────`);
process.exit(fail === 0 ? 0 : 1);
