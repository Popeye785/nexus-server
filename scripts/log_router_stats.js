#!/usr/bin/env node
// scripts/log_router_stats.js
// Block T A1 [27.05.2026]: stündlicher Snapshot der Router-Veto-Stats für 24h-Beobachtung.
//
// Cron-Aufruf:
//   0 * * * * cd ~/NEXUS_CLEAN && node scripts/log_router_stats.js >> /tmp/router_stats_history.jsonl
//
// Standalone-Aufruf:
//   node scripts/log_router_stats.js                # JSON, einzeiler
//   node scripts/log_router_stats.js --pretty       # JSON pretty
//   node scripts/log_router_stats.js --aggregate    # alle bisherigen Snapshots aggregiert

'use strict';

const fs = require('fs');
const http = require('http');

const HISTORY_FILE = '/tmp/router_stats_history.jsonl';
const args = process.argv.slice(2);
const PRETTY = args.includes('--pretty');
const AGGREGATE = args.includes('--aggregate');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function snapshot() {
  const ts = Date.now();
  const stats = await fetchJson('http://localhost:3000/api/router/veto-stats?hours=1');
  const universe = await fetchJson('http://localhost:3000/api/symbol-universe/snapshot');
  const out = {
    ts,
    ts_iso: new Date(ts).toISOString(),
    window_hours: stats.window_hours,
    total: stats.total,
    allowed: stats.allowed,
    blocked: stats.blocked,
    analysis_only: stats.analysis_only,
    by_veto: stats.by_veto || {},
    by_symbol: stats.by_symbol || {},
    universe_total_trading: universe.total_symbols || null,
    universe_total_analysis: universe.total_analysis_only || null,
  };
  // Append to history
  try { fs.appendFileSync(HISTORY_FILE, JSON.stringify(out) + '\n'); } catch (e) { /* log file unwritable */ }
  return out;
}

async function aggregate() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(JSON.stringify({ error: 'no history file yet', file: HISTORY_FILE }));
    return;
  }
  const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
  const snaps = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (snaps.length === 0) { console.log(JSON.stringify({ error: 'empty history' })); return; }
  const first = snaps[0], last = snaps[snaps.length - 1];
  const agg = {
    snapshots: snaps.length,
    earliest: first.ts_iso,
    latest: last.ts_iso,
    total_decisions_sum: snaps.reduce((s,x) => s + (x.total||0), 0),
    total_allowed_sum: snaps.reduce((s,x) => s + (x.allowed||0), 0),
    total_blocked_sum: snaps.reduce((s,x) => s + (x.blocked||0), 0),
    total_analysis_only_sum: snaps.reduce((s,x) => s + (x.analysis_only||0), 0),
    by_veto_aggregate: {},
    by_symbol_aggregate: {},
  };
  for (const s of snaps) {
    for (const [k,v] of Object.entries(s.by_veto || {})) agg.by_veto_aggregate[k] = (agg.by_veto_aggregate[k]||0) + v;
    for (const [sym,st] of Object.entries(s.by_symbol || {})) {
      if (!agg.by_symbol_aggregate[sym]) agg.by_symbol_aggregate[sym] = { total:0, allowed:0, blocked:0 };
      agg.by_symbol_aggregate[sym].total += st.total||0;
      agg.by_symbol_aggregate[sym].allowed += st.allowed||0;
      agg.by_symbol_aggregate[sym].blocked += st.blocked||0;
    }
  }
  console.log(JSON.stringify(agg, null, PRETTY ? 2 : 0));
}

(async () => {
  try {
    if (AGGREGATE) { await aggregate(); return; }
    const s = await snapshot();
    console.log(JSON.stringify(s, null, PRETTY ? 2 : 0));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
})();
