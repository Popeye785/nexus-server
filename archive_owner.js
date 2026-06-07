#!/usr/bin/env node
// archive_owner.js — Off-Bot Disk-Hausmeister fuer NEXUS V9
// NICHT in den Live-Bot eingeklinkt. Manueller/Cron-Tool.
//
// Nutzung:
//   node archive_owner.js dry-run                   # default, zeigt nur was passieren wuerde
//   node archive_owner.js execute --i-mean-it       # echte Aktion, nur mit Freigabe
//
// Sicherheit:
//   - Liest nexus.db read-only fuer Inventur, schreibt Live-DB NUR im DELETE-Phase (execute)
//   - Vor dem ersten echten Lauf: online-Backup der Live-DB (DB.db.backup())
//   - Niemals loeschen, ohne dass archivierte Rows == zu loeschende Rows verifiziert sind
//   - Archiv-DB-quick_check muss ok sein, sonst kein Delete
//   - Watermark: hoert auf wenn Mac-Disk >= MIN_FREE_GB hat
//   - Mount-Check auf externe Platte; nicht da -> STOP

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const LIVE_DB = path.join(__dirname, 'nexus.db');
const EXT_MOUNT = '/Volumes/NEXUSBOT V9';
const ARCHIVE_BASE = path.join(EXT_MOUNT, 'NEXUS_ARCHIVE');
const MIN_FREE_GB_MAC = 25;        // niemals unter diesem Mac-Freiraum

// Klasse + Retention-Tage (HISTORY = archivierbar nach N Tagen)
const RULES = [
  { table: 'aladdin_decisions',          ts_col: 'ts', retention_days: 60, klasse: 'HISTORY' },
  { table: 'tft_forecasts',              ts_col: 'ts', retention_days: 14, klasse: 'HISTORY' },
  { table: 'consensus_decisions',        ts_col: 'ts', retention_days: 7,  klasse: 'HISTORY' },
  { table: 'decision_outcomes',          ts_col: 'created_ms', retention_days: 30, klasse: 'HISTORY' },
  { table: 'regime_history',             ts_col: 'ts', retention_days: 30, klasse: 'HISTORY' },
  { table: 'hmm_state',                  ts_col: 'ts', retention_days: 14, klasse: 'HISTORY' },
  { table: 'best_route_log',             ts_col: 'ts', retention_days: 30, klasse: 'HISTORY' },
  { table: 'binance_metrics_history',    ts_col: 'ts', retention_days: 14, klasse: 'HISTORY' },
  { table: 'opportunity_log',            ts_col: 'ts', retention_days: 14, klasse: 'HISTORY' },
  { table: 'shadow_predictions',         ts_col: 'ts', retention_days: 14, klasse: 'HISTORY' },
  { table: 'system_log',                 ts_col: 'ts', retention_days: 30, klasse: 'AUDIT-soft' },
  { table: 'blocked_trades',             ts_col: 'ts', retention_days: 30, klasse: 'LIVE_STATE-soft' },
  // Legacy/Archive (alles raus, sind eh schon Archiv-Daten in der Live-DB):
  { table: 'system_log_archive',                ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'balance_history_archive',           ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'blocked_trades_day_zero_legacy',    ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'brain_input_log_day_zero_legacy',   ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'regime_history_day_zero_legacy',    ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'tft_forecasts_day_zero_legacy',     ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'wallet_ledger_day_zero_legacy',     ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'balance_history_day_zero_legacy',   ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
  { table: 'shadow_predictions_day_zero_legacy',ts_col: 'ts',         retention_days: 0, klasse: 'LEGACY' },
];

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function freeGB(p) {
  try {
    const out = execSync(`df -g "${p}" | tail -1`).toString().trim().split(/\s+/);
    return parseInt(out[3], 10);
  } catch (_) { return -1; }
}

function isMounted() { return fs.existsSync(EXT_MOUNT) && fs.statSync(EXT_MOUNT).isDirectory(); }

function ymOf(unixMs) {
  const d = new Date(unixMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

async function planForTable(db, rule) {
  const { table, ts_col, retention_days } = rule;
  // Verify table + column exist
  let cols;
  try { cols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name); }
  catch(e) { return { skipped: true, reason: `no_table: ${e.message}` }; }
  if (!cols.includes(ts_col) && ts_col !== '__none__') return { skipped: true, reason: `no_col_${ts_col}` };

  const cutoff = Date.now() - retention_days * 86400 * 1000;
  let candidateRows;
  try {
    if (retention_days === 0) {
      candidateRows = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    } else {
      candidateRows = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${ts_col}" < ?`).get(cutoff).n;
    }
  } catch(e) { return { skipped: true, reason: `count_err: ${e.message}` }; }

  // size estimate (avg bytes per page)
  let estMb = 0;
  try {
    const stat = db.prepare(`SELECT SUM(pgsize) AS b, COUNT(*) AS pages FROM dbstat WHERE name=?`).get(table);
    const totalRows = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    if (totalRows > 0 && stat.b) estMb = (stat.b/1024/1024) * (candidateRows / totalRows);
  } catch(_) {}

  // Monat-Bucket fuer Archiv-Files
  let buckets = {};
  if (candidateRows > 0 && retention_days > 0) {
    try {
      const rows = db.prepare(`SELECT "${ts_col}" AS ts FROM "${table}" WHERE "${ts_col}" < ?`).all(cutoff);
      for (const r of rows) {
        const ym = ymOf(r.ts);
        buckets[ym] = (buckets[ym]||0) + 1;
      }
    } catch(_) {}
  } else if (candidateRows > 0 && retention_days === 0) {
    buckets['LEGACY'] = candidateRows;
  }
  return { skipped: false, candidateRows, estMb: Number(estMb.toFixed(2)), buckets, cutoff };
}

async function dryRun() {
  log(`=== DRY-RUN — ArchiveOwner ===`);
  log(`Live-DB: ${LIVE_DB}`);
  log(`Mac frei: ${freeGB(process.env.HOME)} GB (Minimum: ${MIN_FREE_GB_MAC} GB)`);
  log(`Ext mount: ${EXT_MOUNT} -> ${isMounted() ? 'OK' : '🔴 NICHT GEMOUNTET'}`);
  if (isMounted()) log(`Ext frei: ${freeGB(EXT_MOUNT)} GB`);
  log(`Archive-Ziel: ${ARCHIVE_BASE}/`);
  log('');
  log('Plan pro Tabelle:');
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 10000');
  let totalRows = 0, totalMb = 0;
  for (const rule of RULES) {
    const p = await planForTable(db, rule);
    if (p.skipped) {
      log(`  [SKIP] ${rule.table}: ${p.reason}`);
      continue;
    }
    const bucketStr = Object.entries(p.buckets).map(([k,v])=>`${k}=${v}`).join(' ');
    log(`  [${rule.klasse.padEnd(16)}] ${rule.table.padEnd(35)} → archivieren=${String(p.candidateRows).padStart(7)} rows · est=${String(p.estMb).padStart(7)} MB · cutoff=${rule.retention_days}d · buckets={${bucketStr}}`);
    totalRows += p.candidateRows;
    totalMb += p.estMb;
  }
  db.close();
  log('');
  log(`TOTAL archivierbar: ${totalRows} rows ≈ ${totalMb.toFixed(2)} MB ≈ ${(totalMb/1024).toFixed(2)} GB`);
  log(`Erwartete Live-DB-Verkleinerung: NACH VACUUM/Reindex (nicht im Auto-Lauf)`);
  log('');
  log(`Aktionen die im EXECUTE-Modus passieren wuerden:`);
  log(`  1. Online-Backup nexus.db -> ${ARCHIVE_BASE}/_pre_archive_$(ts).db (DB.db.backup())`);
  log(`  2. Pro Tabelle+Monat: SQLite-Archive ${ARCHIVE_BASE}/<table>_<YYYY-MM>.db schreiben`);
  log(`  3. Archive-quick_check: ok -> sonst SKIP diese Tabelle/Monat`);
  log(`  4. Archive-Row-Count == zu-loeschende-Rows -> sonst SKIP`);
  log(`  5. DELETE FROM <table> WHERE ts < cutoff (chunked: 10000 rows / Transaction)`);
  log(`  6. PRAGMA quick_check nach jeder Tabelle; bei FAIL -> ABORT & ALARM`);
  log(`  7. STOP wenn Mac-Frei >= ${MIN_FREE_GB_MAC} GB (Watermark)`);
  log('');
  log(`KEIN VACUUM im Live-Lauf. (Codex-Regel)`);
  log(`Bei nochmaligem Lauf: incrementell — was schon archiviert ist, wird nicht doppelt geschrieben.`);
}

(async () => {
  const mode = process.argv[2] || 'dry-run';
  if (mode === 'dry-run') {
    await dryRun();
  } else if (mode === 'execute') {
    log('🔴 EXECUTE-Modus nicht implementiert in diesem Build.');
    log('   Christian-Freigabe + zusaetzliches --i-mean-it Flag noetig.');
    process.exit(2);
  } else {
    log(`unbekannter mode: ${mode}`);
    process.exit(2);
  }
})().catch(e => { console.error('FATAL', e.stack||e.message); process.exit(1); });
