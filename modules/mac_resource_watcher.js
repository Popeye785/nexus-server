// modules/mac_resource_watcher.js
// P7.2 [2026-06-04]: Mac-Systemdaten-Wächter.
//
// Liefert macOS-konsistente System-Metriken:
//   - macAvailableGb (Apple-Finder-Sicht via NSURLVolumeAvailableCapacityForImportantUsageKey)
//   - hardFreeGb (df / Container Free, technische Sicht)
//   - purgeableApproxGb = macAvailable − hardFree
//   - totalDiskGb (Volume Total Capacity)
//   - botRamMb (process.memoryUsage().rss)
//   - systemMemoryPressure (vm_stat → free/active/inactive/wired/compressed/swap)
//   - botCpuPct (ps -p)
//   - eventLoopP99Ms (via Refs)
//   - walMb
//
// HARD RULES:
//   - KEIN Trading-Eingriff
//   - KEINE Wallet-Mutation
//   - KEIN VACUUM
//   - KEINE Order, KEIN Router
//
// Aufruf-Pattern:
//   const W = require('./mac_resource_watcher');
//   W.init({ eventLoopRef, walPath });
//   const snap = W.snapshot();   // sync, ca. 50-500 ms (osascript + ps + vm_stat)
//
// Sync-Cost-Hinweis: osascript-Aufruf ~100-500 ms; bei 60 s-Intervall OK.
// Über _cache wird letzter Snapshot vorgehalten falls Aufrufer parallel kommt.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MacResourceWatcher = {
  _initDone: false,
  _refs: {},
  _cache: null,
  _cacheTs: 0,
  _cacheMs: 30_000,   // Cache 30 s; Governor sample alle 60 s → hot cache nicht relevant

  init(refs = {}) {
    if (this._initDone) return;
    this._refs = refs;
    this._initDone = true;
    try { console.log('[MAC_WATCHER] init OK'); } catch(_){}
  },

  /**
   * snapshot() — synchron, sammelt alle Metriken.
   * Returns: { macAvailableGb, hardFreeGb, purgeableApproxGb, totalDiskGb,
   *            botRamMb, systemMemoryPressure, botCpuPct, eventLoopP99Ms,
   *            walMb, diskDecisionSource, claims, raw }
   */
  snapshot() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTs) < this._cacheMs) return this._cache;

    const out = {
      ts: now,
      macAvailableGb: -1,
      hardFreeGb: -1,
      purgeableApproxGb: -1,
      totalDiskGb: -1,
      botRamMb: -1,
      systemMemoryPressure: null,
      botCpuPct: -1,
      eventLoopP99Ms: -1,
      walMb: -1,
      diskDecisionSource: 'unknown',
      claims: {},
      raw: {},
    };

    // ── 1) Disk: hardFreeGb via df -k ────────────────────────────────
    try {
      const dfOut = execSync('df -k /', { encoding: 'utf8', timeout: 2000 });
      const cols = dfOut.split('\n')[1].split(/\s+/);
      // df -k: $4 = Available KB
      const availKb = parseInt(cols[3]);
      if (Number.isFinite(availKb) && availKb > 0) {
        out.hardFreeGb = Math.round(availKb / 1024 / 1024 * 10) / 10;
        out.claims.hardFreeGb = 'VERIFIZIERT';
      }
    } catch(_) { out.claims.hardFreeGb = 'UNBEKANNT'; }

    // ── 2) Disk: macAvailableGb + totalDiskGb via NSURLVolumeAvailableCapacityForImportantUsageKey ──
    // Via osascript (Cocoa Foundation API). Liefert Apple-Finder-Sicht inkl. purgeable Space.
    // Multi-line osa-Script via mehrere `-e` Flags (osascript fügt jede -e als neue Zeile).
    try {
      const osaLines = [
        'use framework "Foundation"',
        'use scripting additions',
        'set u to current application\'s NSURL\'s fileURLWithPath:"/"',
        'set k to {(current application\'s NSURLVolumeAvailableCapacityForImportantUsageKey), (current application\'s NSURLVolumeTotalCapacityKey)}',
        'set {v, e} to (u\'s resourceValuesForKeys:k |error|:(reference))',
        'if v is missing value then return "-1|-1"',
        'set i to (v\'s valueForKey:"NSURLVolumeAvailableCapacityForImportantUsageKey")',
        'set t to (v\'s valueForKey:"NSURLVolumeTotalCapacityKey")',
        'return (i\'s longLongValue() as text) & "|" & (t\'s longLongValue() as text)'
      ];
      const cmd = 'osascript ' + osaLines.map(l => '-e ' + JSON.stringify(l)).join(' ');
      const buf = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
      // osascript-Lokale: `,` → `.` für Float-Parse (en-US/de-DE Mix)
      const s = (buf || '').toString().trim().replace(/,/g, '.');
      const parts = s.split('|');
      if (parts.length >= 2) {
        const importantBytes = Number(parts[0]);
        const totalBytes = Number(parts[1]);
        const GB = 1024 * 1024 * 1024;
        if (Number.isFinite(importantBytes) && importantBytes > 0) {
          out.macAvailableGb = Math.round(importantBytes / GB * 10) / 10;
          out.claims.macAvailableGb = 'VERIFIZIERT';
        }
        if (Number.isFinite(totalBytes) && totalBytes > 0) {
          out.totalDiskGb = Math.round(totalBytes / GB * 10) / 10;
        }
        out.raw.osascriptOutput = s;
      }
    } catch(e) {
      out.claims.macAvailableGb = 'UNBEKANNT';
      out.raw.osascriptErr = e.message;
    }

    // ── 3) Disk: purgeableApproxGb ────────────────────────────────────
    if (out.macAvailableGb >= 0 && out.hardFreeGb >= 0) {
      out.purgeableApproxGb = Math.max(0, Math.round((out.macAvailableGb - out.hardFreeGb) * 10) / 10);
      out.claims.purgeableApproxGb = 'PLAUSIBEL';
    } else {
      out.claims.purgeableApproxGb = 'UNBEKANNT';
    }

    // ── 4) Disk-Decision-Source ─────────────────────────────────────
    if (out.macAvailableGb >= 0) {
      out.diskDecisionSource = 'macAvailableGb';
    } else if (out.hardFreeGb >= 0) {
      out.diskDecisionSource = 'hardFreeGb';
    }

    // ── 5) Bot RAM via process.memoryUsage().rss ────────────────────
    try {
      const m = process.memoryUsage();
      out.botRamMb = Math.round(m.rss / 1024 / 1024);
      out.claims.botRamMb = 'VERIFIZIERT';
    } catch(_) { out.claims.botRamMb = 'UNBEKANNT'; }

    // ── 6) System-Memory-Pressure via vm_stat ──────────────────────
    try {
      const vm = execSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
      const pageSizeMatch = vm.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1]) : 16384;
      const parse = (name) => {
        const re = new RegExp('Pages ' + name + ':\\s+(\\d+)', 'i');
        const m = vm.match(re);
        return m ? parseInt(m[1]) * pageSize : 0;
      };
      const free = parse('free');
      const active = parse('active');
      const inactive = parse('inactive');
      const wired = parse('wired down');
      const compressed = parse('occupied by compressor');
      const totalRam = free + active + inactive + wired + compressed;
      // Swap-Nutzung via sysctl
      let swapUsedMb = 0;
      try {
        const sw = execSync('sysctl vm.swapusage', { encoding: 'utf8', timeout: 1000 });
        const swMatch = sw.match(/used\s*=\s*([\d.,]+)M/i);
        if (swMatch) swapUsedMb = Math.round(parseFloat(swMatch[1].replace(',', '.')));
      } catch(_){}
      out.systemMemoryPressure = {
        freeGb: Math.round(free / 1024 / 1024 / 1024 * 10) / 10,
        activeGb: Math.round(active / 1024 / 1024 / 1024 * 10) / 10,
        inactiveGb: Math.round(inactive / 1024 / 1024 / 1024 * 10) / 10,
        wiredGb: Math.round(wired / 1024 / 1024 / 1024 * 10) / 10,
        compressedGb: Math.round(compressed / 1024 / 1024 / 1024 * 10) / 10,
        totalRamGb: Math.round(totalRam / 1024 / 1024 / 1024 * 10) / 10,
        swapUsedMb,
      };
      out.claims.systemMemoryPressure = 'VERIFIZIERT';
    } catch(_) { out.claims.systemMemoryPressure = 'UNBEKANNT'; }

    // ── 7) Bot CPU via ps -p ──────────────────────────────────────
    try {
      const psOut = execSync('ps -p ' + process.pid + ' -o %cpu= -o rss=', {
        encoding: 'utf8', timeout: 1000,
      });
      const psFields = psOut.trim().split(/\s+/);
      if (psFields.length >= 1) {
        out.botCpuPct = Math.round(parseFloat(psFields[0].replace(',', '.')) * 10) / 10;
        out.claims.botCpuPct = 'VERIFIZIERT';
      }
    } catch(_) { out.claims.botCpuPct = 'UNBEKANNT'; }

    // ── 8) EventLoop p99 via Ref ──────────────────────────────────
    try {
      const elr = this._refs.eventLoopRef;
      const ls = elr && elr.lastSample;
      if (ls && typeof ls.p99 === 'number') {
        out.eventLoopP99Ms = ls.p99;
        out.claims.eventLoopP99Ms = 'VERIFIZIERT';
      }
    } catch(_) { out.claims.eventLoopP99Ms = 'UNBEKANNT'; }

    // ── 9) WAL-Größe ──────────────────────────────────────────────
    try {
      const walPath = this._refs.walPath || path.join(__dirname, '..', 'nexus.db-wal');
      if (fs.existsSync(walPath)) {
        const st = fs.statSync(walPath);
        out.walMb = Math.round(st.size / 1024 / 1024 * 10) / 10;
        out.claims.walMb = 'VERIFIZIERT';
      } else {
        out.walMb = 0;
        out.claims.walMb = 'VERIFIZIERT';
      }
    } catch(_) { out.claims.walMb = 'UNBEKANNT'; }

    this._cache = out;
    this._cacheTs = now;
    return out;
  },
};

module.exports = MacResourceWatcher;
