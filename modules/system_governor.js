// modules/system_governor.js
// P7.1 [2026-06-04]: SystemGovernor — Ober-Hausmeister.
//
// Überwacht alle 60s: Bot-RSS, EventLoop p99/max, DB qc (alle 10 min light),
// WAL-Größe, Disk-Container-Free, Storm-Counters (ONCHAIN/SECURITY/EVENT_LOOP),
// Reserve, LIVE/TEST_ONLY/PAPER-Status.
//
// Stufen + Aktionen (P7.1):
//   GREEN  → nur messen + loggen
//   YELLOW → coalesced Telegram-WARN (max 1/30min)
//   ORANGE → + ListingHunter.enabled=false + Onchain-Pause (idempotent)
//   RED    → + Forensik-Snapshot + Telegram-EMERGENCY · KEIN Auto-Restart in P7.1
//
// HARD RULES:
//   - KEIN LIVE einschalten
//   - KEIN Trade-Enable
//   - KEIN Router-Patch
//   - KEIN Force-Buy
//   - KEIN VACUUM
//   - KEINE Backup-Löschung
//   - Reserve NIE anfassen
//   - DemoEngine NIE stoppen
//   - KEIN Auto-Restart in P7.1

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data', 'system_governor');
const FORENSIC_DIR = path.join(DATA_DIR, 'forensic');
const RETENTION_DAYS = 30;
const RING_SIZE = 200;
const ACTION_RING_SIZE = 50;

const RESERVE_FLOOR_USDT = 4.2661642227906995;

const SystemGovernor = {
  enabled: true,
  _initDone: false,
  _refs: {},
  _timer: null,
  _ringBuffer: [],         // recent samples
  _actionLog: [],          // recent actions taken
  _warningsLog: [],        // recent warnings
  _activeCooldowns: {},    // moduleName → { reason, sinceTs }
  _lastStage: 'GREEN',
  _lastStageChangeTs: 0,
  _lastTelegramTs: { YELLOW: 0, ORANGE: 0, RED: 0 },
  _stormSamplePrev: { fileSize: 0, ts: 0 },
  _eventLoopCritCount: 0,
  _lastDbQcTs: 0,
  _lastDbQcResult: 'unknown',
  _todayCsvFile: null,
  _todayHeaderWritten: false,
  _stats: {
    samples: 0,
    stage: { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 },
    telegramSent: 0,
    telegramSuppressed: 0,
    forensicSnapshots: 0,
    csvWriteOK: 0,
    csvWriteErrors: 0,
  },

  INTERVAL_MS: 60_000,
  DB_QC_INTERVAL_MS: 10 * 60_000,         // DB qc only every 10 min
  COALESCE_MS: 30 * 60_000,                // Telegram max 1/30min per level
  THRESHOLDS: {
    RAM_WARN_MB: 500,
    RAM_CRIT_MB: 800,
    RAM_RED_MB: 1000,
    DISK_WARN_GB: 20,
    DISK_CRIT_GB: 10,
    LOOP_P99_WARN_MS: 500,
    LOOP_P99_CRIT_MS: 3000,
    LOOP_P99_CRIT_CONSEC: 3,             // 3 aufeinanderfolgende Samples
    STORM_PER_MIN: 10,
  },

  // CSV header (stabil)
  CSV_HEADER: [
    'ts','stage','ram_mb','heap_mb','loop_p50','loop_p95','loop_p99','loop_max',
    'db_qc','wal_mb','disk_free_gb','reserve','is_live','test_only',
    'storm_onchain','storm_security','storm_eventloop','bot_uptime_s',
    'cooldowns','actions_this_sample'
  ].join(','),

  /**
   * init({ eventLoopRef, dbRef, walletRef, demoEngineRef, listingHunterRef, onchainRef, testOnlyGuardRef, cfgRef })
   */
  init(refs = {}) {
    if (this._initDone) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(FORENSIC_DIR)) fs.mkdirSync(FORENSIC_DIR, { recursive: true });
      this._refs = refs;
      this._cleanupOldFiles();
      this._initDone = true;
      try { console.log('[GOVERNOR] init OK · refs=' + Object.keys(refs).filter(k => !!refs[k]).join(',')); } catch(_){}
    } catch(e) {
      try { console.warn('[GOVERNOR] init err: ' + e.message); } catch(_){}
    }
  },

  start() {
    if (this._timer || !this._initDone) return;
    // Sofort 1× messen, dann interval
    this.sample().catch(()=>{});
    this._timer = setInterval(() => { this.sample().catch(()=>{}); }, this.INTERVAL_MS);
    try { console.log('[GOVERNOR] timer started · interval=' + this.INTERVAL_MS/1000 + 's · DB-qc every ' + this.DB_QC_INTERVAL_MS/60000 + 'min'); } catch(_){}
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  _cleanupOldFiles() {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 86400000;
      for (const dir of [DATA_DIR, FORENSIC_DIR]) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (!/\.(csv|json)$/.test(f)) continue;
          const p = path.join(dir, f);
          try {
            const st = fs.statSync(p);
            if (st.mtimeMs < cutoff) fs.unlinkSync(p);
          } catch(_){}
        }
      }
    } catch(_){}
  },

  _dailyCsvPath() {
    const d = new Date();
    const ymd = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(d.getUTCDate()).padStart(2,'0');
    return path.join(DATA_DIR, ymd + '.csv');
  },

  // ─── METRICS COLLECTION ─────────────────────────────────────────────

  async _collect() {
    const now = Date.now();
    const snap = {
      ts: now,
      stage: 'GREEN',
      botUptimeS: Math.round(process.uptime()),
    };

    // RAM
    try {
      const m = process.memoryUsage();
      snap.ramMb = Math.round(m.rss / 1024 / 1024);
      snap.heapMb = Math.round(m.heapUsed / 1024 / 1024);
    } catch(_){ snap.ramMb = 0; snap.heapMb = 0; }

    // EventLoop snapshot (read from EventLoopHealthMonitor if ref)
    const elr = this._refs.eventLoopRef;
    const ls = elr && elr.lastSample;
    snap.loopP50 = ls ? ls.p50 : 0;
    snap.loopP95 = ls ? ls.p95 : 0;
    snap.loopP99 = ls ? ls.p99 : 0;
    snap.loopMax = ls ? ls.max : 0;

    // DB quick_check (light — only every 10 min)
    if (now - this._lastDbQcTs > this.DB_QC_INTERVAL_MS) {
      try {
        const db = this._refs.dbRef;
        if (db && db.prepare) {
          const r = db.prepare('PRAGMA quick_check').get();
          this._lastDbQcResult = (r && r.quick_check === 'ok') ? 'ok' : 'fail';
        }
      } catch(e) { this._lastDbQcResult = 'error'; }
      this._lastDbQcTs = now;
    }
    snap.dbQc = this._lastDbQcResult;

    // WAL size
    try {
      const walPath = path.join(__dirname, '..', 'nexus.db-wal');
      if (fs.existsSync(walPath)) {
        const st = fs.statSync(walPath);
        snap.walMb = Math.round(st.size / 1024 / 1024 * 10) / 10;
      } else snap.walMb = 0;
    } catch(_){ snap.walMb = 0; }

    // P7.2 [2026-06-04]: Disk-Metrik aus MacResourceWatcher (macOS-konsistent).
    // macAvailableGb (Apple-Finder-Sicht) ist primäre Entscheidungs-Quelle.
    // hardFreeGb (df) als technischer Wert separat ausgewiesen.
    snap.diskFreeGb = -1;
    snap.hardFreeGb = -1;
    snap.macAvailableGb = -1;
    snap.purgeableApproxGb = -1;
    snap.totalDiskGb = -1;
    snap.diskDecisionSource = 'unknown';
    snap.systemMemoryPressure = null;
    snap.botCpuPct = -1;
    try {
      const mw = this._refs.macWatcherRef;
      if (mw && typeof mw.snapshot === 'function') {
        const m = mw.snapshot();
        snap.hardFreeGb = m.hardFreeGb;
        snap.macAvailableGb = m.macAvailableGb;
        snap.purgeableApproxGb = m.purgeableApproxGb;
        snap.totalDiskGb = m.totalDiskGb;
        snap.diskDecisionSource = m.diskDecisionSource;
        snap.systemMemoryPressure = m.systemMemoryPressure;
        snap.botCpuPct = m.botCpuPct;
        // Backward-compat-Feld für CSV/alte Logik:
        // diskFreeGb = macAvailableGb wenn vorhanden, sonst hardFreeGb
        snap.diskFreeGb = (m.macAvailableGb >= 0) ? m.macAvailableGb
                        : (m.hardFreeGb >= 0    ? m.hardFreeGb : -1);
      } else {
        // Fallback (alte Logik) falls Watcher nicht injiziert
        const out = execSync('df -k /', { encoding: 'utf8', timeout: 2000 });
        const cols = out.split('\n')[1].split(/\s+/);
        snap.hardFreeGb = Math.round(parseInt(cols[3]) / 1024 / 1024 * 10) / 10;
        snap.diskFreeGb = snap.hardFreeGb;
        snap.diskDecisionSource = 'hardFreeGb';
      }
    } catch(_){}

    // Reserve
    try {
      const wr = this._refs.walletRef;
      snap.reserve = wr ? Number(wr.reserve || 0) : 0;
    } catch(_){ snap.reserve = 0; }

    // LIVE / TEST_ONLY
    try {
      const de = this._refs.demoEngineRef;
      snap.isLive = de ? !!de.liveMode : false;
    } catch(_){ snap.isLive = false; }
    try {
      const cfg = this._refs.cfgRef;
      snap.testOnly = cfg ? (cfg.TEST_ONLY !== false) : true;
    } catch(_){ snap.testOnly = true; }

    // Storm-Counters (in der letzten Minute — read inkrementell aus pm2-log)
    snap.storms = this._countStorms();

    return snap;
  },

  _countStorms() {
    try {
      const fpath = path.join(process.env.HOME, '.pm2', 'logs', 'nexus-out.log');
      if (!fs.existsSync(fpath)) return { onchain: 0, security: 0, eventLoop: 0, bitget: 0 };
      const stat = fs.statSync(fpath);
      const prev = this._stormSamplePrev;
      this._stormSamplePrev = { fileSize: stat.size, ts: Date.now() };
      // First sample / log rotation / shrinkage → kein Delta
      if (prev.fileSize === 0 || prev.fileSize >= stat.size) {
        return { onchain: 0, security: 0, eventLoop: 0, bitget: 0 };
      }
      const newSize = stat.size - prev.fileSize;
      // Schutz: keine sync-Read > 5 MB
      if (newSize > 5 * 1024 * 1024) {
        return { onchain: 0, security: 0, eventLoop: 0, bitget: 0 };
      }
      const buf = Buffer.alloc(newSize);
      const fd = fs.openSync(fpath, 'r');
      fs.readSync(fd, buf, 0, newSize, prev.fileSize);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const lines = text.split('\n');
      let onchain = 0, security = 0, eventLoop = 0, bitget = 0;
      for (const l of lines) {
        if (l.indexOf('ONCHAIN eth_gas') >= 0 && (l.indexOf('rate-limit') >= 0 || l.indexOf('fail') >= 0)) onchain++;
        if (l.indexOf('[WARN][SECURITY]') >= 0) security++;
        if (l.indexOf('SEVERE block') >= 0) eventLoop++;
        if (l.indexOf('[WARN][BITGET]') >= 0) bitget++;
      }
      return { onchain, security, eventLoop, bitget };
    } catch(_) {
      return { onchain: 0, security: 0, eventLoop: 0, bitget: 0 };
    }
  },

  // ─── STAGE CLASSIFIER ──────────────────────────────────────────────

  _upgrade(current, next) {
    const order = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
    return order[next] > order[current] ? next : current;
  },

  _classify(snap) {
    let level = 'GREEN';
    const reasons = [];

    // Hard-Safety failsafes (RED)
    if (snap.dbQc === 'fail' || snap.dbQc === 'error') {
      level = this._upgrade(level, 'RED');
      reasons.push('DB_QC_' + snap.dbQc);
    }
    if (snap.reserve > 0 && snap.reserve < RESERVE_FLOOR_USDT) {
      level = this._upgrade(level, 'RED');
      reasons.push('RESERVE_FLOOR_VIOLATED_' + snap.reserve.toFixed(2));
    }
    if (snap.isLive === true) {
      level = this._upgrade(level, 'RED');
      reasons.push('LIVE_MODE_DETECTED');
    }

    // RAM
    if (snap.ramMb >= this.THRESHOLDS.RAM_RED_MB) {
      level = this._upgrade(level, 'RED');
      reasons.push('RAM_RED_' + snap.ramMb + 'MB');
    } else if (snap.ramMb >= this.THRESHOLDS.RAM_CRIT_MB) {
      level = this._upgrade(level, 'ORANGE');
      reasons.push('RAM_CRIT_' + snap.ramMb + 'MB');
    } else if (snap.ramMb >= this.THRESHOLDS.RAM_WARN_MB) {
      level = this._upgrade(level, 'YELLOW');
      reasons.push('RAM_WARN_' + snap.ramMb + 'MB');
    }

    // P7.2 [2026-06-04]: Disk-Klassifikation primär nach macAvailableGb (Apple-Sicht).
    // hardFreeGb darf NICHT alleine eskalieren, wenn macAvailableGb gesund ist.
    // Christian-Thresholds: GREEN>=50 · YELLOW<50 · ORANGE<20 · RED<10.
    if (snap.macAvailableGb >= 0) {
      if (snap.macAvailableGb < 10) {
        level = this._upgrade(level, 'RED');
        reasons.push('DISK_RED_macAvail_' + snap.macAvailableGb + 'GB');
      } else if (snap.macAvailableGb < 20) {
        level = this._upgrade(level, 'ORANGE');
        reasons.push('DISK_ORANGE_macAvail_' + snap.macAvailableGb + 'GB');
      } else if (snap.macAvailableGb < 50) {
        level = this._upgrade(level, 'YELLOW');
        reasons.push('DISK_INFO_macAvail_' + snap.macAvailableGb + 'GB');
      }
      // Sonderfall: hardFreeGb sehr niedrig aber macAvail gesund → nur INFO, kein eskalieren
      if (snap.hardFreeGb >= 0 && snap.hardFreeGb < 5 && snap.macAvailableGb >= 50) {
        // KEIN level-upgrade — Reason als INFO eintragen für Telegram-Kontext
        reasons.push('DISK_INFO_purgeable_pressure_hardFree_' + snap.hardFreeGb + 'GB');
      }
    } else if (snap.hardFreeGb >= 0) {
      // Fallback (macAvailable unbekannt) — alte Logik
      if (snap.hardFreeGb < this.THRESHOLDS.DISK_CRIT_GB) {
        level = this._upgrade(level, 'ORANGE');
        reasons.push('DISK_CRIT_hardFree_' + snap.hardFreeGb + 'GB_fallback');
      } else if (snap.hardFreeGb < this.THRESHOLDS.DISK_WARN_GB) {
        level = this._upgrade(level, 'YELLOW');
        reasons.push('DISK_WARN_hardFree_' + snap.hardFreeGb + 'GB_fallback');
      }
    }

    // EventLoop p99 — wiederholt-Logik
    if (snap.loopP99 >= this.THRESHOLDS.LOOP_P99_CRIT_MS) {
      this._eventLoopCritCount++;
      if (this._eventLoopCritCount >= this.THRESHOLDS.LOOP_P99_CRIT_CONSEC) {
        level = this._upgrade(level, 'ORANGE');
        reasons.push('LOOP_P99_CRIT_' + snap.loopP99 + 'ms_x' + this._eventLoopCritCount);
      } else {
        level = this._upgrade(level, 'YELLOW');
        reasons.push('LOOP_P99_CRIT_' + snap.loopP99 + 'ms_x' + this._eventLoopCritCount);
      }
    } else {
      this._eventLoopCritCount = 0;
      if (snap.loopP99 >= this.THRESHOLDS.LOOP_P99_WARN_MS) {
        level = this._upgrade(level, 'YELLOW');
        reasons.push('LOOP_P99_WARN_' + snap.loopP99 + 'ms');
      }
    }

    // Storms (per Minute)
    if (snap.storms.onchain >= this.THRESHOLDS.STORM_PER_MIN) {
      level = this._upgrade(level, 'YELLOW');
      reasons.push('STORM_ONCHAIN_' + snap.storms.onchain);
    }
    if (snap.storms.security >= this.THRESHOLDS.STORM_PER_MIN) {
      level = this._upgrade(level, 'YELLOW');
      reasons.push('STORM_SECURITY_' + snap.storms.security);
    }
    if (snap.storms.eventLoop >= this.THRESHOLDS.STORM_PER_MIN) {
      level = this._upgrade(level, 'YELLOW');
      reasons.push('STORM_EVENTLOOP_' + snap.storms.eventLoop);
    }

    return { level, reasons };
  },

  // ─── ACTIONS ──────────────────────────────────────────────────────

  _handleStage(stage, reasons, snap) {
    const now = Date.now();
    const actionsTaken = [];

    if (stage === 'YELLOW') {
      this._maybeSendTelegram('YELLOW', 'WARN', 'GOVERNOR_YELLOW', reasons, snap);
    } else if (stage === 'ORANGE') {
      this._maybeSendTelegram('ORANGE', 'CRITICAL', 'GOVERNOR_ORANGE', reasons, snap);
      // ORANGE-Cooldowns: nicht-kritische Module pausieren (idempotent)
      try {
        if (this._refs.listingHunterRef && this._refs.listingHunterRef.enabled !== false) {
          this._refs.listingHunterRef.enabled = false;
          if (typeof this._refs.listingHunterRef.stop === 'function') this._refs.listingHunterRef.stop();
          this._activeCooldowns.ListingHunter = { reason: reasons.join(','), sinceTs: now };
          actionsTaken.push('LISTING_HUNTER_PAUSED');
        }
      } catch(_){}
      try {
        if (this._refs.onchainRef && this._refs.onchainRef._cronTimer) {
          clearInterval(this._refs.onchainRef._cronTimer);
          this._refs.onchainRef._cronTimer = null;
          this._activeCooldowns.OnchainCron = { reason: reasons.join(','), sinceTs: now };
          actionsTaken.push('ONCHAIN_CRON_PAUSED');
        }
      } catch(_){}
    } else if (stage === 'RED') {
      this._maybeSendTelegram('RED', 'EMERGENCY', 'GOVERNOR_RED', reasons, snap);
      // RED: Forensik-Snapshot · KEIN Auto-Restart in P7.1 (Christian-Pflicht)
      try { this._writeForensicSnapshot(snap, reasons); actionsTaken.push('FORENSIC_SNAPSHOT'); } catch(_){}
      // ORANGE-Cooldowns auch in RED
      try {
        if (this._refs.listingHunterRef && this._refs.listingHunterRef.enabled !== false) {
          this._refs.listingHunterRef.enabled = false;
          if (typeof this._refs.listingHunterRef.stop === 'function') this._refs.listingHunterRef.stop();
          this._activeCooldowns.ListingHunter = { reason: reasons.join(','), sinceTs: now };
          actionsTaken.push('LISTING_HUNTER_PAUSED');
        }
      } catch(_){}
    }

    // GREEN → optional resume of cooldowns: in P7.1 NICHT auto-resume
    // (Christian kann manuell resumen). Verhindert Flapping.

    if (actionsTaken.length > 0) {
      this._actionLog.unshift({ ts: now, stage, reasons, actions: actionsTaken });
      if (this._actionLog.length > ACTION_RING_SIZE) this._actionLog.length = ACTION_RING_SIZE;
    }
    return actionsTaken;
  },

  _maybeSendTelegram(stageKey, level, telegramKey, reasons, snap) {
    const now = Date.now();
    const last = this._lastTelegramTs[stageKey] || 0;
    if (now - last < this.COALESCE_MS) {
      this._stats.telegramSuppressed++;
      return;
    }
    try {
      const TA = this._refs.telegramAlarmRef;
      if (TA && TA.alert) {
        // P7.2 [2026-06-04]: Telegram zeigt macAvailable + hard + purgeable getrennt.
        const diskPart = (snap.macAvailableGb >= 0)
          ? `Disk macOS=${snap.macAvailableGb}GB · hard=${snap.hardFreeGb}GB · purgeable≈${snap.purgeableApproxGb}GB`
          : `Disk hard=${snap.hardFreeGb}GB`;
        const cpuPart = (snap.botCpuPct >= 0) ? `CPU=${snap.botCpuPct}%` : '';
        const msg = `${stageKey}: ${reasons.join(', ')} | RAM=${snap.ramMb}MB · ${cpuPart} · p99=${snap.loopP99}ms · ${diskPart} · WAL=${snap.walMb}MB · Reserve=${(snap.reserve||0).toFixed(2)}`;
        TA.alert(level, telegramKey, msg);
        this._stats.telegramSent++;
        this._lastTelegramTs[stageKey] = now;
        this._warningsLog.unshift({ ts: now, stage: stageKey, level, msg });
        if (this._warningsLog.length > ACTION_RING_SIZE) this._warningsLog.length = ACTION_RING_SIZE;
      }
    } catch(_){}
  },

  _writeForensicSnapshot(snap, reasons) {
    try {
      const ts = Date.now();
      const fpath = path.join(FORENSIC_DIR, 'red_' + ts + '.json');
      const data = {
        ts, reasons, snapshot: snap,
        process: {
          pid: process.pid,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        },
        eventLoopSnapshot: (this._refs.eventLoopRef && this._refs.eventLoopRef.snapshot) ? this._refs.eventLoopRef.snapshot() : null,
        activeCooldowns: this._activeCooldowns,
        recentActions: this._actionLog.slice(0, 10),
        recentWarnings: this._warningsLog.slice(0, 10),
      };
      fs.writeFileSync(fpath, JSON.stringify(data, null, 2));
      this._stats.forensicSnapshots++;
    } catch(e) {
      try { console.warn('[GOVERNOR] forensic snapshot err: ' + e.message); } catch(_){}
    }
  },

  // ─── CSV LOG ─────────────────────────────────────────────────────

  _writeCsv(snap, stage, actionsTaken) {
    try {
      const fpath = this._dailyCsvPath();
      if (fpath !== this._todayCsvFile) {
        this._todayCsvFile = fpath;
        this._todayHeaderWritten = fs.existsSync(fpath);
      }
      if (!this._todayHeaderWritten) {
        fs.writeFileSync(fpath, this.CSV_HEADER + '\n', { flag: 'a' });
        this._todayHeaderWritten = true;
      }
      const row = [
        snap.ts, stage, snap.ramMb, snap.heapMb,
        snap.loopP50, snap.loopP95, snap.loopP99, snap.loopMax,
        snap.dbQc, snap.walMb, snap.diskFreeGb, (snap.reserve||0).toFixed(4),
        snap.isLive ? 1 : 0, snap.testOnly ? 1 : 0,
        snap.storms.onchain, snap.storms.security, snap.storms.eventLoop,
        snap.botUptimeS,
        Object.keys(this._activeCooldowns).join('|'),
        actionsTaken.join('|'),
      ].join(',');
      fs.appendFileSync(fpath, row + '\n');
      this._stats.csvWriteOK++;
    } catch(e) {
      this._stats.csvWriteErrors++;
      if (this._stats.csvWriteErrors < 5) {
        try { console.warn('[GOVERNOR] csv err: ' + e.message); } catch(_){}
      }
    }
  },

  // ─── MAIN SAMPLE ─────────────────────────────────────────────────

  async sample() {
    if (!this.enabled || !this._initDone) return;
    this._stats.samples++;
    try {
      const snap = await this._collect();
      const cls = this._classify(snap);
      snap.stage = cls.level;
      snap.reasons = cls.reasons;
      this._lastStage = cls.level;
      this._stats.stage[cls.level]++;
      const actionsTaken = this._handleStage(cls.level, cls.reasons, snap);
      this._writeCsv(snap, cls.level, actionsTaken);
      this._ringBuffer.unshift({
        ts: snap.ts, stage: cls.level, reasons: cls.reasons,
        ramMb: snap.ramMb, loopP99: snap.loopP99,
        diskFreeGb: snap.diskFreeGb,
        // P7.2: separate Disk-Felder im Ring für API
        hardFreeGb: snap.hardFreeGb,
        macAvailableGb: snap.macAvailableGb,
        purgeableApproxGb: snap.purgeableApproxGb,
        diskDecisionSource: snap.diskDecisionSource,
        botCpuPct: snap.botCpuPct,
        reserve: snap.reserve, storms: snap.storms,
      });
      if (this._ringBuffer.length > RING_SIZE) this._ringBuffer.length = RING_SIZE;
    } catch(e) {
      try { console.warn('[GOVERNOR] sample err: ' + e.message); } catch(_){}
    }
  },

  // ─── API SNAPSHOT ───────────────────────────────────────────────

  snapshot() {
    const latest = this._ringBuffer[0] || null;
    return {
      enabled: this.enabled,
      initDone: this._initDone,
      status: this._lastStage,
      thresholds: this.THRESHOLDS,
      intervalMs: this.INTERVAL_MS,
      coalesceMs: this.COALESCE_MS,
      lastSample: latest,
      activeCooldowns: this._activeCooldowns,
      lastActions: this._actionLog.slice(0, 10),
      lastWarnings: this._warningsLog.slice(0, 10),
      stats: { ...this._stats },
      recentSamples: this._ringBuffer.slice(0, 20),
    };
  },
};

module.exports = SystemGovernor;
