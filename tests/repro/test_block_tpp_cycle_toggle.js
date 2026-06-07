// Block T++ [27.05.2026]: Aladdin-Cycle-Toggle Validation Tests
'use strict';

// Mock DemoEngine.setIntervalMs Logic (unit-level)
const ALLOWED = [120000, 60000, 30000];
function setIntervalMs(newMs, allowed = ALLOWED) {
  const ms = parseInt(newMs);
  if (!allowed.includes(ms)) {
    if (ms === 10000) return { ok:false, error:'CYCLE_10S_REQUIRES_WEBSOCKET' };
    return { ok:false, error:'INVALID_CYCLE_MS', allowed };
  }
  return { ok:true, newMs:ms };
}

let pass=0, fail=0;
function t(name, fn){ try{ fn(); console.log('  ✓',name); pass++; } catch(e){ console.log('  ✗',name,'·',e.message); fail++; } }
function ok(c,m){ if(!c) throw new Error(m||'expected truthy'); }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+` got=${a} want=${b}`); }

console.log('── Validation: Codex-Skala');
t('120000 → OK',  ()=>ok(setIntervalMs(120000).ok));
t('60000 → OK',   ()=>ok(setIntervalMs(60000).ok));
t('30000 → OK',   ()=>ok(setIntervalMs(30000).ok));
t('10000 → REJECT (WebSocket required)', ()=>{
  const r = setIntervalMs(10000);
  ok(!r.ok);
  eq(r.error, 'CYCLE_10S_REQUIRES_WEBSOCKET');
});
t('45000 → REJECT (nicht in Skala)', ()=>{
  const r = setIntervalMs(45000);
  ok(!r.ok);
  eq(r.error, 'INVALID_CYCLE_MS');
});
t('0 → REJECT', ()=>ok(!setIntervalMs(0).ok));
t('-30000 → REJECT', ()=>ok(!setIntervalMs(-30000).ok));
t('null → REJECT', ()=>ok(!setIntervalMs(null).ok));
t('"30000" (string) → OK (parseInt)', ()=>ok(setIntervalMs("30000").ok));

console.log('── Module-Loader (DB-Override-Logik)');
function loadInterval(dbRow, cfgVal) {
  if (dbRow && dbRow.value) {
    const v = parseInt(dbRow.value);
    if (ALLOWED.includes(v)) return v;
  }
  return cfgVal || 120000;
}
t('no DB-row, CFG=30000 → 30000', ()=>eq(loadInterval(null, 30000), 30000));
t('DB-row=60000, CFG=30000 → 60000 (DB wins)', ()=>eq(loadInterval({value:'60000'}, 30000), 60000));
t('DB-row=45000 (invalid), CFG=30000 → 30000 (fallback)', ()=>eq(loadInterval({value:'45000'}, 30000), 30000));
t('DB-row=null, CFG=null → 120000 (fallback)', ()=>eq(loadInterval(null, null), 120000));

console.log(`\n──────── PASS ${pass} / FAIL ${fail} ────────`);
process.exit(fail === 0 ? 0 : 1);
