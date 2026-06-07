#!/usr/bin/env node
// scripts/cusum_veto_summary.js
// Block S-Prep A2.1 [27.05.2026]: 24h-Beobachtungs-Auswertung CUSUM-Trade-Gate.
//
// Liest pm2-Logs (out + error) der letzten N Stunden, zählt:
//   - CUSUM_TRADE_VETO Events pro Symbol
//   - Trade-Attempts (DemoEngine-_executeTrade-Marker)
//   - DemoEngine-Crash/Restart-Indikatoren
//   - Veto-Rate = vetos / (vetos + passes)
//
// Output: JSON (stdout) + Markdown-Report (--report).
//
// Usage:
//   node scripts/cusum_veto_summary.js                  # JSON last 24h
//   node scripts/cusum_veto_summary.js --hours 1        # JSON last 1h
//   node scripts/cusum_veto_summary.js --report         # Markdown

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Optionaler DB-Access (better-sqlite3 vorhanden im Bot-Projekt)
let Database = null;
try { Database = require('better-sqlite3'); } catch { /* optional */ }
const DB_PATH = path.join(os.homedir(), 'NEXUS_CLEAN', 'nexus.db');

const args = process.argv.slice(2);
const HOURS = (() => {
  const i = args.indexOf('--hours');
  return i >= 0 ? Number(args[i+1]) || 24 : 24;
})();
const REPORT = args.includes('--report');

const LOG_DIR = path.join(os.homedir(), '.pm2', 'logs');
const cutoffMs = Date.now() - HOURS * 3600 * 1000;

function listLogs() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('nexus-') && f.endsWith('.log'))
    .map(f => path.join(LOG_DIR, f))
    .filter(p => {
      try { return fs.statSync(p).mtimeMs > cutoffMs - 86400000; } // pad 24h
      catch { return false; }
    });
}

function parseTs(line) {
  // pm2 format: "0|nexus    | 2026-05-27 14:15:20.860: …"
  const m = line.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return Date.parse(`${m[1]}T${m[2]}`);
}

const stats = {
  scanned_files: 0,
  scanned_lines: 0,
  window_hours: HOURS,
  cusum_vetos_total: 0,
  cusum_vetos_per_symbol: {},
  trade_attempts_total: 0,
  trade_attempts_per_symbol: {},
  crash_indicators: 0,
  restart_indicators: 0,
  earliest_log_ts: null,
  latest_log_ts: null,
};

const RE_VETO = /CUSUM_TRADE_VETO[^\n]*?(\w+USDT)/;
// Echte Crash-Indikatoren (CRASH_HANDLER init = Boot-Log, NICHT crash)
const RE_CRASH = /\b(FATAL|uncaughtException|TypeError|ReferenceError|unhandledRejection)\b/;
const RE_RESTART = /\b(App\s+name:nexus\s+id:0\s+started|nexus\s+restarted)\b/i;

for (const file of listLogs()) {
  stats.scanned_files++;
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const ts = parseTs(line);
    if (ts !== null) {
      if (ts < cutoffMs) continue;
      if (!stats.earliest_log_ts || ts < stats.earliest_log_ts) stats.earliest_log_ts = ts;
      if (!stats.latest_log_ts || ts > stats.latest_log_ts) stats.latest_log_ts = ts;
    }
    stats.scanned_lines++;
    let m;
    if ((m = line.match(RE_VETO))) {
      stats.cusum_vetos_total++;
      stats.cusum_vetos_per_symbol[m[1]] = (stats.cusum_vetos_per_symbol[m[1]] || 0) + 1;
    }
    if (RE_CRASH.test(line) && !/ERROR_RATE/.test(line) && !/reason.*ERROR/.test(line)) {
      stats.crash_indicators++;
    }
    if (RE_RESTART.test(line)) {
      stats.restart_indicators++;
    }
  }
}

// Trade-Attempts via DB (Source-of-Truth)
if (Database && fs.existsSync(DB_PATH)) {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(`
      SELECT symbol, COUNT(*) AS n FROM trades
      WHERE created_at > ?
      GROUP BY symbol
    `).all(cutoffMs);
    for (const r of rows) {
      stats.trade_attempts_per_symbol[r.symbol] = r.n;
      stats.trade_attempts_total += r.n;
    }
    db.close();
  } catch (e) {
    stats.db_error = e.message;
  }
}

const passed = Math.max(0, stats.trade_attempts_total - stats.cusum_vetos_total);
stats.veto_rate = (stats.cusum_vetos_total + passed) > 0
  ? Number((stats.cusum_vetos_total / (stats.cusum_vetos_total + passed)).toFixed(4))
  : null;
stats.trade_attempts_passed_estimate = passed;

if (!REPORT) {
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

// Markdown report
const fmt = ts => ts ? new Date(ts).toISOString().replace('T',' ').substring(0,19) : 'n/a';
const md = `# CUSUM-Veto-Summary (last ${HOURS}h)

**Window:** ${fmt(stats.earliest_log_ts)} → ${fmt(stats.latest_log_ts)}
**Scanned:** ${stats.scanned_files} files / ${stats.scanned_lines.toLocaleString()} lines

## Trade-Gate-Stats

| Metric | Value |
|---|---:|
| CUSUM-Vetos total | **${stats.cusum_vetos_total}** |
| Trade-Attempts total | ${stats.trade_attempts_total} |
| Trade-Attempts passed (estimate) | ${passed} |
| Veto-Rate | ${stats.veto_rate !== null ? (stats.veto_rate*100).toFixed(2)+'%' : 'n/a (no attempts)'} |

## Per-Symbol Vetos

${Object.keys(stats.cusum_vetos_per_symbol).length === 0 ? '*Keine CUSUM-Vetos in der Beobachtungszeit.*' :
  '| Symbol | Vetos | Attempts | Veto-%-of-attempts |\n|---|---:|---:|---:|\n' +
  Object.entries(stats.cusum_vetos_per_symbol).sort((a,b)=>b[1]-a[1])
    .map(([s,v]) => {
      const att = stats.trade_attempts_per_symbol[s] || 0;
      const pct = att > 0 ? ((v/att)*100).toFixed(1)+'%' : 'n/a';
      return `| ${s} | ${v} | ${att} | ${pct} |`;
    }).join('\n')}

## Stability

| Metric | Value | Healthy? |
|---|---:|:---:|
| Crash-Indicators | ${stats.crash_indicators} | ${stats.crash_indicators === 0 ? '✅' : '⚠️'} |
| Restart-Indicators | ${stats.restart_indicators} | ${stats.restart_indicators <= 2 ? '✅' : '⚠️'} |

## Interpretation

- **Veto-Rate 0%:** CUSUM-Gate hat keine Trades blockiert. Entweder Markt war volatil genug ODER zu wenig Trade-Attempts.
- **Veto-Rate 100%:** CUSUM-Gate blockt alle Trades → flat-Markt ODER Threshold zu hoch.
- **Crash/Restart > 0:** DemoEngine instabil → Diagnose vor Block S.
`;
console.log(md);
