// modules/incident_waechter.js — Meta-KI Wächter ("Putzmann")
// Verankert 2026-05-19. Aktiviert Routine-Cleanup ohne Trade-Logic-Eingriffe.
//
// SANDBOX-PRINZIPIEN:
// 1. NUR Welt-A-Aktionen (Hygiene): Phantom-Archive, Dedup, Auto-Resolve, Audit
// 2. Whitelist-Filter pro action_type (keine "Improvisation")
// 3. Pre-Check vor Aktion: wallet drift=0, consistent=true, position age, etc.
// 4. dry_run=true → loggt nur in waechter_actions
// 5. enabled=false → Tick macht nichts (Wächter aus)
// 6. Rate-Limit: max_actions_per_hour
// 7. Crash → setzt enabled=false + Telegram-Alarm
//
// KATEGORISCH AUS: pm2, DEPLOY_MODE, API_KEY, Trade-Logic, KillSwitch, Capital-Pool

'use strict';

const IncidentWaechter = {
  intervalMs: 30 * 1000,
  timer: null,
  bootDelay: 60 * 1000,
  _db: null,
  _telegramFn: null,
  _walletGetter: null,
  _tradesGetter: null,
  _demoEngineGetter: null,
  _consistencyGetter: null,
  _logFn: null,

  stats: {
    runs: 0,
    actions_total: 0,
    actions_phantom: 0,
    actions_dedup: 0,
    actions_stress: 0,
    skipped_pre_check: 0,
    skipped_dry_run: 0,
    crashes: 0,
    last_run_ts: null,
    last_action_ts: null,
  },

  init({ db, telegramSend, walletGetter, tradesGetter, demoEngineGetter, consistencyGetter, log }) {
    this._db = db;
    this._telegramFn = telegramSend;
    this._walletGetter = walletGetter;       // () => { drift, consistent, ... } from recon
    this._tradesGetter = tradesGetter;       // Trades.getActive() function
    this._demoEngineGetter = demoEngineGetter;// () => DemoEngine.positions
    this._consistencyGetter = consistencyGetter;// queries consistency_log
    this._logFn = log || ((lvl, mod, msg) => { try { console.log(`[${lvl}][${mod}]`, msg); } catch(_) {} });
  },

  start() {
    if (this.timer) return;
    setTimeout(() => {
      this.tick().catch(() => {});
      this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
    }, this.bootDelay);
    this._logFn('boot', 'WAECHTER', `started (interval=${this.intervalMs/1000}s, bootDelay=${this.bootDelay/1000}s)`);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  _getSettings() {
    try {
      const rows = this._db.prepare('SELECT key, value FROM waechter_settings').all();
      const s = {};
      for (const r of rows) s[r.key] = r.value;
      return s;
    } catch(e) { return {}; }
  },

  _actionsThisHour() {
    try {
      const r = this._db.prepare(
        `SELECT COUNT(*) AS c FROM waechter_actions WHERE ts > ?`
      ).get(Date.now() - 3600000);
      return r ? r.c : 0;
    } catch(_) { return 0; }
  },

  _audit({ action_type, target, reason, pre_state, post_state, success, dry_run, escalated }) {
    try {
      this._db.prepare(
        `INSERT INTO waechter_actions (ts, action_type, target, reason, pre_state, post_state, success, dry_run, escalated)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        Date.now(), action_type, target || null, reason || null,
        pre_state ? JSON.stringify(pre_state).slice(0, 500) : null,
        post_state ? JSON.stringify(post_state).slice(0, 500) : null,
        success ? 1 : 0, dry_run ? 1 : 0, escalated ? 1 : 0
      );
    } catch(_) {}
    if (success && !dry_run) {
      this.stats.actions_total++;
      this.stats.last_action_ts = Date.now();
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // HAUPTZYKLUS
  async tick() {
    this.stats.runs++;
    this.stats.last_run_ts = Date.now();

    const s = this._getSettings();
    if (s.enabled !== 'true') return;
    const dryRun = (s.dry_run === 'true');

    // Pre-Check: Wallet-Reconciler grün?
    if (s.require_wallet_drift_zero === 'true') {
      try {
        const w = this._walletGetter ? this._walletGetter() : null;
        if (!w || w.consistent === false || Math.abs(w.drift || 0) > 0.5) {
          this.stats.skipped_pre_check++;
          return; // Wallet inkonsistent → Wächter macht NICHTS
        }
      } catch(_) { return; }
    }

    // Rate-Limit
    const maxPerHour = parseInt(s.max_actions_per_hour || '50');
    if (this._actionsThisHour() >= maxPerHour) {
      this.stats.skipped_pre_check++;
      return;
    }

    try {
      if (s.auto_phantom_cleanup === 'true') await this._handlePhantomCleanup(s, dryRun);
      if (s.auto_anomaly_dedup === 'true') await this._handleAnomalyDedup(s, dryRun);
      if (s.auto_stress_resolve === 'true') await this._handleStressResolve(s, dryRun);
    } catch(e) {
      this.stats.crashes++;
      this._logFn('warn', 'WAECHTER', `tick crash: ${e.message}`);
      // Auto-Disable bei Crash
      try {
        this._db.prepare(`UPDATE waechter_settings SET value='false', updated_at=? WHERE key='enabled'`).run(Date.now());
        if (this._telegramFn) this._telegramFn(`🛑 Wächter auto-disabled wegen Crash: ${e.message.slice(0,200)}`);
      } catch(_) {}
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // ACTION 1: Phantom-Trade-Cleanup
  //   - DB-Trade state=POSITION_ACTIVE, älter als min_pos_age_seconds
  //   - Strategy startsWith DEMO_
  //   - KEINE RAM-Position dazu (ghost-Pattern)
  //   - Action: state → ARCHIVED_PHANTOM + closed_at_archived + wallet_ledger PHANTOM_ARCHIVE
  //   - HARD-LIMIT: max 5 pro Tick
  async _handlePhantomCleanup(s, dryRun) {
    const minAgeSec = parseInt(s.min_pos_age_seconds || '300');
    const cutoff = Date.now() - minAgeSec * 1000;

    let candidates = [];
    try {
      candidates = this._db.prepare(
        `SELECT id, symbol, strategy, size, entry_price, created_at
         FROM trades
         WHERE state='POSITION_ACTIVE'
           AND created_at < ?
           AND strategy LIKE 'DEMO_%'
         LIMIT 5`
      ).all(cutoff);
    } catch(_) { return; }
    if (!candidates.length) return;

    // RAM-Positionen prüfen
    let ramPos = [];
    try {
      ramPos = this._demoEngineGetter ? Object.values(this._demoEngineGetter() || {}) : [];
    } catch(_) {}

    for (const t of candidates) {
      const hasRam = ramPos.some(p => p && (p.dbTradeId === t.id));
      if (hasRam) continue; // RAM hat ihn → kein Ghost → nicht anfassen

      // Eskalation: Wenn Strategy nicht in bekannter Liste → escalate
      const knownStrategies = ['DEMO_UNIFIED', 'DEMO_SINGLE_TREND_FOLLOW', 'DEMO_GRID', 'DEMO_DCA', 'DEMO_INFGRID'];
      const strategyKnown = knownStrategies.some(k => t.strategy && t.strategy.startsWith(k));

      const pre_state = { id: t.id, symbol: t.symbol, strategy: t.strategy, size: t.size, age_sec: Math.round((Date.now() - t.created_at)/1000) };

      if (!strategyKnown) {
        this._audit({
          action_type: 'PHANTOM_CLEANUP', target: t.id,
          reason: `unknown strategy ${t.strategy} — escalate`,
          pre_state, success: false, dry_run: dryRun, escalated: true,
        });
        if (this._telegramFn && !dryRun) {
          this._telegramFn(`ℹ️ Wächter eskaliert Phantom: ${t.symbol} strategy=${t.strategy} (unbekannt)`);
        }
        continue;
      }

      if (dryRun) {
        this._audit({
          action_type: 'PHANTOM_CLEANUP', target: t.id,
          reason: 'dry_run: would archive',
          pre_state, success: true, dry_run: true, escalated: false,
        });
        this.stats.skipped_dry_run++;
        continue;
      }

      // Echte Aktion: archivieren + ledger
      try {
        const tx = this._db.transaction((tradeId, size) => {
          this._db.prepare(
            `UPDATE trades SET state='ARCHIVED_PHANTOM', closed_at=NULL, closed_at_archived=? WHERE id=?`
          ).run(Date.now(), tradeId);
          this._db.prepare(
            `INSERT INTO wallet_ledger (ts, op, amount, reason, trade_id, mode)
             VALUES (?, 'PHANTOM_ARCHIVE', ?, ?, ?, 'PAPER')`
          ).run(Date.now(), size, `Wächter auto-archive ${t.symbol}`, tradeId);
        });
        tx(t.id, t.size);
        this.stats.actions_phantom++;
        this._audit({
          action_type: 'PHANTOM_CLEANUP', target: t.id, reason: 'archived',
          pre_state, post_state: { state: 'ARCHIVED_PHANTOM' },
          success: true, dry_run: false, escalated: false,
        });
        if (this._telegramFn && s.telegram_info_only === 'true') {
          this._telegramFn(`ℹ️ Wächter: ${t.symbol} Phantom archiviert (age=${pre_state.age_sec}s)`);
        }
      } catch(e) {
        this._audit({
          action_type: 'PHANTOM_CLEANUP', target: t.id,
          reason: 'archive failed: ' + e.message,
          pre_state, success: false, dry_run: false, escalated: true,
        });
      }
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // ACTION 2: Anomaly-Dedup-Cleanup (alte Einträge entfernen)
  //   - DEDUP-Tabelle älter als 1h löschen (geschieht schon in AnomalyDetector,
  //     hier als Backup-Pfad falls AnomalyDetector pausiert)
  async _handleAnomalyDedup(s, dryRun) {
    try {
      const cutoff = Date.now() - 3600 * 1000;
      const before = this._db.prepare(`SELECT COUNT(*) AS c FROM anomaly_alert_dedup WHERE ts < ?`).get(cutoff);
      if (!before || !before.c) return;

      if (dryRun) {
        this._audit({
          action_type: 'ANOMALY_DEDUP_CLEAN', target: 'anomaly_alert_dedup',
          reason: `dry_run: would delete ${before.c} old rows`,
          pre_state: { rows: before.c }, success: true, dry_run: true, escalated: false,
        });
        return;
      }

      const res = this._db.prepare(`DELETE FROM anomaly_alert_dedup WHERE ts < ?`).run(cutoff);
      this.stats.actions_dedup++;
      this._audit({
        action_type: 'ANOMALY_DEDUP_CLEAN', target: 'anomaly_alert_dedup',
        reason: `deleted ${res.changes} rows`,
        pre_state: { rows: before.c }, post_state: { deleted: res.changes },
        success: true, dry_run: false, escalated: false,
      });
    } catch(_) {}
  },

  // ────────────────────────────────────────────────────────────────────────
  // ACTION 3: Veraltete consistency_log-Einträge als auto_fixed markieren
  //   - check_name in Whitelist (MARKET_ANOMALY, memory_ghost)
  //   - älter als min_incident_age_minutes
  //   - severity != EMERGENCY
  async _handleStressResolve(s, dryRun) {
    const minAgeMin = parseInt(s.min_incident_age_minutes || '15');
    const cutoff = Date.now() - minAgeMin * 60 * 1000;

    let stale = [];
    try {
      stale = this._db.prepare(
        `SELECT id, check_name, severity, ts FROM consistency_log
         WHERE ts < ? AND auto_fixed=0
           AND check_name IN ('memory_ghost', 'MARKET_ANOMALY')
           AND severity != 'EMERGENCY'
         LIMIT 10`
      ).all(cutoff);
    } catch(_) { return; }
    if (!stale.length) return;

    if (dryRun) {
      this._audit({
        action_type: 'STRESS_RESOLVE', target: 'consistency_log',
        reason: `dry_run: would auto-resolve ${stale.length} stale entries`,
        pre_state: { count: stale.length, samples: stale.slice(0,3).map(x=>x.id) },
        success: true, dry_run: true, escalated: false,
      });
      return;
    }

    try {
      const ids = stale.map(x => x.id);
      const placeholders = ids.map(() => '?').join(',');
      const res = this._db.prepare(`UPDATE consistency_log SET auto_fixed=1 WHERE id IN (${placeholders})`).run(...ids);
      this.stats.actions_stress++;
      this._audit({
        action_type: 'STRESS_RESOLVE', target: 'consistency_log',
        reason: `auto-resolved ${res.changes} stale entries`,
        pre_state: { count: stale.length }, post_state: { updated: res.changes },
        success: true, dry_run: false, escalated: false,
      });
    } catch(e) {
      this._audit({
        action_type: 'STRESS_RESOLVE', target: 'consistency_log',
        reason: 'failed: ' + e.message, success: false, dry_run: false, escalated: true,
      });
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  snapshot() {
    const settings = this._getSettings();
    const recent = (() => {
      try {
        return this._db.prepare(
          `SELECT action_type, COUNT(*) AS c, SUM(success) AS ok, SUM(escalated) AS esc, SUM(dry_run) AS dry
           FROM waechter_actions WHERE ts > ? GROUP BY action_type`
        ).all(Date.now() - 24*3600*1000);
      } catch(_) { return []; }
    })();
    return {
      enabled: settings.enabled === 'true',
      dry_run: settings.dry_run === 'true',
      settings,
      stats: this.stats,
      recent_24h: recent,
    };
  },
};

module.exports = IncidentWaechter;
