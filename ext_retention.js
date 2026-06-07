#!/usr/bin/env node
// ext_retention.js — externer Retention-Hausmeister (deterministisch, off-bot)
// Tool, NICHT im Live-Bot-Pfad. Aufruf:
//   node ext_retention.js              # default = dry-run
//   node ext_retention.js --execute    # gated, real prune (braucht Christian-Go)
//
// Sicherheit:
//   - Live-DB ~/NEXUS_CLEAN/nexus.db NICHT anfassen.
//   - Mac NICHT loeschen.
//   - Nur unter ext/NEXUS_BACKUPS_SORTED + bekannte Top-Level Backup-Patterns operieren.
//   - Mount-Check.
//   - Verify-vor-Prune: neuester Behalte-Backup quick_check=ok via better-sqlite3 3.51.3.
//   - Nie den letzten guten Backup loeschen.
//   - 03_FORENSIC_CORRUPT_KEEP nie prunen.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

// ============ KONSTANTEN (leicht aenderbar) ============
const EXT_MOUNT = '/Volumes/NEXUSBOT V9';
const SORTED_DIR = path.join(EXT_MOUNT, 'NEXUS_BACKUPS_SORTED');
const CAPACITY_GB = 300;                  // Plattenkapazitaet ca.
const LOW_WM_FREE_GB = 100;               // unter dem -> prunen
const HIGH_WM_FREE_GB = 150;              // bis hier hoch prunen
// Boden-Verzeichnisse die NIE geprunt werden duerfen:
const FLOOR_DIRS = new Set([
  '00_CURRENT_RESTORE_ANCHOR',
  '03_FORENSIC_CORRUPT_KEEP',
]);
// Boden-Top-Level-Patterns die NIE angefasst werden:
const FLOOR_TOPLEVEL_PATTERNS = [
  /^NEXUS_PORTABLE_.*\.zip$/i,
  /\.docx$/i,
  /\.md$/i,
];
// Bekannte Backup-Top-Level Patterns (die geprunt werden DUERFEN wenn nicht im Boden):
const BACKUP_TOPLEVEL_PATTERNS = [
  /^NEXUS_BACKUPS_/i,
  /^NEXUS_BACKUP_/i,
  /^BOT_KOMPLETT_/i,
];
// ========================================================

function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

function freeGB(p) {
  try {
    const out = execSync(`df -g "${p}" | tail -1`).toString().trim().split(/\s+/);
    return parseInt(out[3], 10);
  } catch (e) { return -1; }
}

function dirSizeGB(p) {
  try {
    const out = execSync(`du -sk "${p}" 2>/dev/null | awk '{print $1}'`).toString().trim();
    return parseFloat(out) / 1024 / 1024;
  } catch (_) { return 0; }
}

function mountCheck() {
  try {
    const st = fs.statSync(EXT_MOUNT);
    if (!st.isDirectory()) return false;
    const test = fs.readdirSync(EXT_MOUNT);
    return Array.isArray(test);
  } catch (_) { return false; }
}

// ===== Date-Parser =====
function parseFromName(name) {
  // Format 1: YYYYMMDD_HHMMSS
  let m = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (m) return { dateStr: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'name (YYYYMMDD_HHMMSS)' };
  // Format 2: YYYY-MM-DDTHH-MM-SS
  m = name.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (m) return { dateStr: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'name (YYYY-MM-DDTHH-MM-SS)' };
  // Format 3: YYYY-MM-DD
  m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { dateStr: `${m[1]}-${m[2]}-${m[3]}T00:00:00`, source: 'name (YYYY-MM-DD)' };
  // Format 4: YYYYMMDD (no time)
  m = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return { dateStr: `${m[1]}-${m[2]}-${m[3]}T00:00:00`, source: 'name (YYYYMMDD)' };
  return null;
}

function parseSetDate(p) {
  const name = path.basename(p);
  const fromName = parseFromName(name);
  if (fromName) {
    const t = new Date(fromName.dateStr).getTime();
    if (isFinite(t)) return { ts: t, dateStr: fromName.dateStr, source: fromName.source };
  }
  // Fallback mtime
  try {
    const st = fs.statSync(p);
    const d = new Date(st.mtime);
    return { ts: d.getTime(), dateStr: d.toISOString().slice(0, 19), source: 'mtime (geschaetzt)' };
  } catch (_) { return null; }
}

// ===== Set-Enumeration =====
function listSetsUnderSorted() {
  const sets = [];
  if (!fs.existsSync(SORTED_DIR)) return sets;
  const cats = fs.readdirSync(SORTED_DIR);
  for (const cat of cats) {
    const catPath = path.join(SORTED_DIR, cat);
    let st;
    try { st = fs.statSync(catPath); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    let subs = [];
    try { subs = fs.readdirSync(catPath); } catch (_) { continue; }
    for (const sub of subs) {
      if (sub.startsWith('.')) continue;
      const subPath = path.join(catPath, sub);
      let sst;
      try { sst = fs.statSync(subPath); } catch (_) { continue; }
      if (sst.isDirectory()) {
        sets.push({ path: subPath, name: sub, category: cat, kind: 'dir' });
      }
    }
  }
  return sets;
}

function listTopLevelBackups() {
  const sets = [];
  if (!fs.existsSync(EXT_MOUNT)) return sets;
  const items = fs.readdirSync(EXT_MOUNT);
  for (const it of items) {
    if (it.startsWith('.')) continue;
    if (it === 'NEXUS_BACKUPS_SORTED') continue;
    const p = path.join(EXT_MOUNT, it);
    let st; try { st = fs.statSync(p); } catch (_) { continue; }
    // Floor-Top-Level (NEXUS_PORTABLE_*.zip, *.docx, *.md): mit, aber als FLOOR
    let isFloor = FLOOR_TOPLEVEL_PATTERNS.some(re => re.test(it));
    let isBackup = BACKUP_TOPLEVEL_PATTERNS.some(re => re.test(it));
    if (isFloor) {
      sets.push({ path: p, name: it, category: '_TOPLEVEL_FLOOR_', kind: st.isDirectory() ? 'dir' : 'file', forceFloor: true });
    } else if (isBackup) {
      sets.push({ path: p, name: it, category: '_TOPLEVEL_BACKUP_', kind: st.isDirectory() ? 'dir' : 'file' });
    }
    // Andere Top-Level: NICHT anfassen (Codex-Spec: nur NEXUS-Backup-Sets)
  }
  return sets;
}

function enumerateAllSets() {
  const a = listSetsUnderSorted();
  const b = listTopLevelBackups();
  return [...a, ...b];
}

// ===== qc =====
function qcCheck(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const r = db.prepare('PRAGMA quick_check').get();
    db.close();
    return r.quick_check;
  } catch (e) { return 'ERR: ' + e.message; }
}

function findOneGoodDB(setPath) {
  // Suche die ERSTE .db die nicht *-wal/*-shm ist
  let found = null;
  (function walk(dir) {
    if (found) return;
    let items;
    try { items = fs.readdirSync(dir); } catch (_) { return; }
    for (const it of items) {
      if (found) return;
      const fp = path.join(dir, it);
      let st; try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.isDirectory()) { walk(fp); continue; }
      if (/\.db$/.test(it) && !/-wal$|-shm$/.test(it)) { found = fp; return; }
    }
  })(setPath);
  return found;
}

// ===== Klassifikation: ist Set FLOOR / CURRENT_FULL ? =====
function classifyFloor(set, latestCurrentFullName) {
  if (set.forceFloor) return { floor: true, reason: 'top-level floor pattern' };
  if (FLOOR_DIRS.has(set.category)) return { floor: true, reason: `category ${set.category} ist Floor` };
  if (set.name.startsWith('CURRENT_FULL_')) return { floor: true, reason: 'CURRENT_FULL Anker' };
  return { floor: false };
}

// ===== Hauptlogik =====
function main() {
  const argv = process.argv.slice(2);
  const EXECUTE = argv.includes('--execute');
  const MODE = EXECUTE ? 'EXECUTE' : 'dry-run';

  log('INFO', `ext_retention START — mode=${MODE}`);
  log('INFO', `Konstanten: KAPAZITAET=${CAPACITY_GB}G LOW_WM_FREE_GB=${LOW_WM_FREE_GB} HIGH_WM_FREE_GB=${HIGH_WM_FREE_GB}`);
  log('INFO', `EXT_MOUNT=${EXT_MOUNT}`);

  if (!mountCheck()) {
    log('ABORT', `${EXT_MOUNT} nicht gemountet`);
    process.exit(2);
  }
  const freeBefore = freeGB(EXT_MOUNT);
  log('INFO', `df extern: frei=${freeBefore} GB`);

  if (freeBefore >= LOW_WM_FREE_GB && !EXECUTE) {
    log('INFO', `frei (${freeBefore}) >= LOW_WM (${LOW_WM_FREE_GB}) → KEIN Prune-Trigger. Trotzdem Dry-Run-Simulation:`);
  } else if (freeBefore >= LOW_WM_FREE_GB && EXECUTE) {
    log('INFO', `frei (${freeBefore}) >= LOW_WM (${LOW_WM_FREE_GB}) → kein Prune-Trigger, EXECUTE NO-OP.`);
    process.exit(0);
  } else {
    log('INFO', `frei (${freeBefore}) < LOW_WM (${LOW_WM_FREE_GB}) → Prune-Trigger aktiv.`);
  }

  // Sets enumerieren
  const sets = enumerateAllSets();
  log('INFO', `Sets gefunden: ${sets.length}`);

  // Date parsen
  for (const s of sets) {
    const d = parseSetDate(s.path);
    s.date = d;
    s.sizeGB = dirSizeGB(s.path);
  }

  // CURRENT_FULL_ -> latest
  const cfs = sets.filter(s => s.name.startsWith('CURRENT_FULL_')).sort((a, b) => (b.date?.ts || 0) - (a.date?.ts || 0));
  const latestCurrentFullName = cfs[0]?.name || null;

  // Sortieren NEUESTE -> AELTESTE
  sets.sort((a, b) => (b.date?.ts || 0) - (a.date?.ts || 0));

  // Boden bestimmen
  for (const s of sets) {
    s.floor = classifyFloor(s, latestCurrentFullName);
  }

  // 3 NEUESTE datierte non-Floor Sets als zusaetzliche FLOOR markieren
  const pruneCandidates = sets.filter(s => !s.floor.floor);
  // Sortiere candidates nach Datum descending
  pruneCandidates.sort((a, b) => (b.date?.ts || 0) - (a.date?.ts || 0));
  const top3 = pruneCandidates.slice(0, 3);
  for (const t of top3) t.floor = { floor: true, reason: 'Top-3 NEUESTE Backup-Set' };

  // Tabelle vorbereiten
  log('INFO', '=== Set-Tabelle (neueste -> aelteste) ===');
  console.log(
    'STATUS'.padEnd(10) +
    'DATUM'.padEnd(22) +
    'QUELLE'.padEnd(30) +
    'GROESSE'.padEnd(10) +
    'KAT'.padEnd(28) +
    'NAME'
  );
  for (const s of sets) {
    const status = s.floor.floor ? 'FLOOR' : '(prune-Kandidat)';
    const dateStr = s.date?.dateStr || '?';
    const source = s.date?.source || '?';
    const sz = s.sizeGB.toFixed(2) + 'G';
    console.log(
      status.padEnd(10) +
      dateStr.padEnd(22) +
      source.padEnd(30) +
      sz.padEnd(10) +
      s.category.padEnd(28) +
      s.name
    );
  }

  // Prune-Simulation: von AELTESTEN nicht-Floor-Sets, bis HIGH_WM erreicht ODER nichts mehr
  const aeltesteZuerst = pruneCandidates.filter(s => !s.floor.floor).sort((a, b) => (a.date?.ts || 0) - (b.date?.ts || 0));
  let simFree = freeBefore;
  const wouldPrune = [];
  for (const s of aeltesteZuerst) {
    if (simFree >= HIGH_WM_FREE_GB) break;
    wouldPrune.push(s);
    simFree += s.sizeGB;
  }

  console.log('');
  log('INFO', `=== Prune-Simulation ===`);
  log('INFO', `frei VORHER:  ${freeBefore} GB`);
  log('INFO', `wuerde prunen: ${wouldPrune.length} Sets`);
  for (const s of wouldPrune) {
    console.log(`  → ${s.date?.dateStr || '?'}  ${s.sizeGB.toFixed(2)} GB  ${s.name}`);
  }
  log('INFO', `frei NACHHER (simuliert): ${simFree.toFixed(2)} GB (Ziel HIGH_WM=${HIGH_WM_FREE_GB})`);
  if (simFree < HIGH_WM_FREE_GB && wouldPrune.length === aeltesteZuerst.length) {
    log('WARN', `Selbst nach Prune aller non-Floor-Sets bleibt frei < HIGH_WM. Nichts weiter loeschbar (nur Boden).`);
  }

  // Verify-vor-Prune (auch im dry-run als Test)
  if (wouldPrune.length > 0) {
    console.log('');
    log('INFO', '=== Verify-vor-Prune (Behalte-Backup qc) ===');
    // Neuester FLOOR-Backup (nicht CURRENT_FULL) zum Verify
    const verifyCandidates = sets.filter(s => s.floor.floor && !s.forceFloor);
    verifyCandidates.sort((a, b) => (b.date?.ts || 0) - (a.date?.ts || 0));
    const verifySet = verifyCandidates[0];
    if (verifySet) {
      const db = findOneGoodDB(verifySet.path);
      if (db) {
        const qc = qcCheck(db);
        log('INFO', `Verify-DB: ${db}`);
        log('INFO', `quick_check: ${qc}`);
        if (qc !== 'ok') {
          log('ABORT', `Verify-FAIL → ABBRUCH. Im EXECUTE-Modus waere KEINE Loeschung erfolgt.`);
          if (EXECUTE) process.exit(3);
        } else {
          log('INFO', '✅ Verify-OK');
        }
      } else {
        log('WARN', `keine .db zum Verify in ${verifySet.path} gefunden`);
      }
    }
  }

  // EXECUTE
  if (EXECUTE && wouldPrune.length > 0) {
    log('WARN', 'EXECUTE-Modus: jetzt wuerden rm -rf laufen');
    log('ABORT', 'EXECUTE in diesem Build NICHT freigegeben — separate Christian-Direktive noetig');
    process.exit(4);
  }

  console.log('');
  log('INFO', `=== ${MODE} fertig ===`);
}

try { main(); } catch (e) { console.error('FATAL', e.stack || e.message); process.exit(99); }
