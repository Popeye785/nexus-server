#!/usr/bin/env node
// scripts/race_condition_stress.js — Race-Condition Stress-Test (Block D, Item 7)
// 100 parallele Requests gegen wallet/recon/dashboard endpoints
// Check: drift bleibt stabil, kein Crash, alle Antworten konsistent

const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:3000${path}`, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: null, raw: data.slice(0,100) }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

(async () => {
  console.log('═══ Race-Condition Stress-Test ═══');
  const N = 100;
  console.log(`Spawning ${N} parallel requests to multiple endpoints...`);
  const endpoints = [
    '/api/recon/check', '/api/bots/dashboard', '/api/demo/wallet',
    '/api/health', '/api/kelly/snapshot', '/api/sortino/snapshot',
    '/api/hrp/snapshot', '/api/live-ready/audit',
  ];
  const start = Date.now();
  const promises = [];
  for (let i = 0; i < N; i++) {
    const ep = endpoints[i % endpoints.length];
    promises.push(get(ep).then(r => ({ i, ep, status: r.status, ok: r.body?.ok !== false })).catch(e => ({ i, ep, status: 'ERR', err: e.message })));
  }
  const results = await Promise.all(promises);
  const ms = Date.now() - start;
  const ok = results.filter(r => r.status === 200).length;
  const err = results.filter(r => r.status === 'ERR').length;
  const fourxx = results.filter(r => typeof r.status === 'number' && r.status >= 400 && r.status < 500).length;
  const fivexx = results.filter(r => typeof r.status === 'number' && r.status >= 500).length;
  console.log(`Done in ${ms}ms. Status: ${ok} OK · ${fourxx} 4xx · ${fivexx} 5xx · ${err} errors`);

  // Drift-Consistency check: alle /api/recon/check sollten gleichen drift returnen
  console.log('\n── Drift-Consistency Check (alle /api/recon/check ergebnisse):');
  const reconResults = await Promise.all(
    Array(20).fill(0).map(() => get('/api/recon/check'))
  );
  const drifts = reconResults.map(r => r.body?.drift).filter(d => d !== undefined);
  const uniqueDrifts = [...new Set(drifts)];
  console.log(`  ${drifts.length} responses, unique drifts: ${uniqueDrifts.join(', ')}`);
  if (uniqueDrifts.length === 1) console.log('  ✅ KONSISTENT — drift identisch über 20 parallele calls');
  else console.log('  ⚠️ DRIFT-INKONSISTENZ — multiple values');

  // Wallet-Total consistency
  console.log('\n── Wallet-Total Consistency:');
  const walletResults = await Promise.all(
    Array(20).fill(0).map(() => get('/api/demo/wallet'))
  );
  const totals = walletResults.map(r => r.body?.total).filter(t => t !== undefined);
  const uniqueTotals = [...new Set(totals.map(t => Number(t).toFixed(4)))];
  console.log(`  ${totals.length} responses, unique totals: ${uniqueTotals.join(', ')}`);
  if (uniqueTotals.length === 1) console.log('  ✅ KONSISTENT');
  else console.log('  ⚠️ INKONSISTENZ');

  // Health-Check spam
  console.log('\n── Health-Check Spam (50 parallel):');
  const healthResults = await Promise.all(Array(50).fill(0).map(() => get('/api/health')));
  const aliveCount = healthResults.filter(r => r.body?.ok === true).length;
  console.log(`  ${aliveCount}/50 ok=true responses`);
  if (aliveCount >= 48) console.log('  ✅ ROBUST');

  console.log('\n═══ Done ═══');
  process.exit(0);
})();
