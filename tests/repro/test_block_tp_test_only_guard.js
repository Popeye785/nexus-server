// Block T+ TEST_ONLY_GUARD Tests
'use strict';
const G = require('../../modules/test_only_guard.js');

let pass=0, fail=0;
function t(name, fn){ try{ fn(); console.log('  ✓',name); pass++; } catch(e){ console.log('  ✗',name,'·',e.message); fail++; } }
function eq(a,b,msg){ if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg||'')+` got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function ok(c,m){ if(!c) throw new Error(m||'expected truthy'); }

const mkDB = (val) => ({ prepare: () => ({ get: () => val ? { value: val } : undefined }) });

console.log('── isActive: Default-True (anti-brick)');
t('CFG undefined → active', ()=>ok(G.isActive(undefined, null)));
t('CFG={} → active', ()=>ok(G.isActive({}, null)));
t('CFG.TEST_ONLY_MODE=true → active', ()=>ok(G.isActive({TEST_ONLY_MODE:true}, null)));
t('CFG.TEST_ONLY_MODE=undefined → active', ()=>ok(G.isActive({TEST_ONLY_MODE:undefined}, null)));
t('CFG.TEST_ONLY_MODE=false → inactive', ()=>ok(!G.isActive({TEST_ONLY_MODE:false}, null)));

console.log('── isActive: DB-Override');
t('CFG=false + DB=true → active (DB überschreibt)', ()=>ok(G.isActive({TEST_ONLY_MODE:false}, mkDB('true'))));
t('CFG=false + DB=false → inactive (beide false)', ()=>ok(!G.isActive({TEST_ONLY_MODE:false}, mkDB('false'))));
t('CFG=true + DB=false → active (CFG wins über DB-false wenn CFG nicht explizit false)', ()=>ok(G.isActive({TEST_ONLY_MODE:true}, mkDB('false'))));

console.log('── validateLiveOrder');
t('CFG=true → block', ()=>{
  const r = G.validateLiveOrder({TEST_ONLY_MODE:true}, null, {source:'BitgetSpot', symbol:'BTCUSDT', side:'buy', size:0.001});
  ok(!r.ok); eq(r.reason,'TEST_ONLY_MODE_ACTIVE');
  ok(r.ctx.source==='BitgetSpot');
  ok(r.ctx.symbol==='BTCUSDT');
});
t('CFG=false → allow', ()=>{
  const r = G.validateLiveOrder({TEST_ONLY_MODE:false}, null, {source:'BitgetSpot'});
  ok(r.ok);
});

console.log('── validateModeSwitch');
t('LIVE_FULL + active → block', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'LIVE_FULL');
  ok(!r.ok); eq(r.reason,'TEST_ONLY_BLOCKS_LIVE_MODE');
});
t('LIVE_RESTRICTED + active → block', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'LIVE_RESTRICTED');
  ok(!r.ok);
});
t('PAPER + active → allow', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'PAPER');
  ok(r.ok);
});
t('DRY_LIVE + active → allow (read-only OK)', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'DRY_LIVE');
  ok(r.ok);
});
t('LIVE_FULL + inactive → allow', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:false}, null, 'LIVE_FULL');
  ok(r.ok);
});

console.log('── Log-Tag und Format');
t('LOG_TAG = [TEST_ONLY_BLOCK]', ()=>eq(G.LOG_TAG,'[TEST_ONLY_BLOCK]'));
t('formatBlockLog mit Kontext', ()=>{
  const s = G.formatBlockLog({source:'Bitget',symbol:'BTCUSDT',side:'buy',size:0.001});
  ok(s.includes('[TEST_ONLY_BLOCK]'));
  ok(s.includes('src=Bitget'));
  ok(s.includes('sym=BTCUSDT'));
  ok(s.includes('side=buy'));
});

console.log('── Snapshot');
t('snapshot active=true bei default', ()=>{
  const s = G.snapshot({TEST_ONLY_MODE:true}, null);
  ok(s.active);
  ok(s.blocks.length >= 5);
});
t('snapshot active=false bei CFG=false', ()=>{
  const s = G.snapshot({TEST_ONLY_MODE:false}, null);
  ok(!s.active);
});

// Block T+ Mini [27.05.2026]: zusätzliche Härtung-Tests
console.log('── /api/deploy Target-Validierung (Mini-Härtung)');
t('validateModeSwitch LIVE_FULL → block', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'LIVE_FULL');
  ok(!r.ok); eq(r.reason,'TEST_ONLY_BLOCKS_LIVE_MODE');
});
t('validateModeSwitch LIVE_RESTRICTED → block', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'LIVE_RESTRICTED');
  ok(!r.ok); eq(r.reason,'TEST_ONLY_BLOCKS_LIVE_MODE');
});
t('validateModeSwitch live_full (lowercase) → block (case-insensitive)', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'live_full');
  ok(!r.ok);
});
t('validateModeSwitch DRY_LIVE → allow (read-only target)', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'DRY_LIVE');
  ok(r.ok);
});
t('validateModeSwitch PAPER → allow', ()=>{
  const r = G.validateModeSwitch({TEST_ONLY_MODE:true}, null, 'PAPER');
  ok(r.ok);
});

console.log('── ExchangeRegistry Block-Behavior (Schema)');
t('validateLiveOrder ctx.exchange wird in Block-Return weitergegeben (Schema-Test)', ()=>{
  const r = G.validateLiveOrder({TEST_ONLY_MODE:true}, null, {source:'ExchangeRegistry', symbol:'BTCUSDT', side:'buy', size:0.001});
  ok(!r.ok);
  ok(r.ctx.source === 'ExchangeRegistry');
});

console.log(`\n──────── PASS ${pass} / FAIL ${fail} ────────`);
process.exit(fail === 0 ? 0 : 1);
