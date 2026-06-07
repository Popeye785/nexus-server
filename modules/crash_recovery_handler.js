// modules/crash_recovery_handler.js — G3+G4 CRASH/RECOVERY Auto-Aktionen
// Verankert 2026-05-23 (G3+G4 — Master-Pipeline G).
//
// CRASH-Detection: HMM CRASH-State triggert:
//   1. Alle LONG SINGLE-Positionen sofort closen (Capital Preservation)
//   2. Eviction-Engine deaktivieren (zu volatil)
//   3. DCA-Sizing × 0.3 (defensiv, kleinere Käufe)
//   4. Telegram-Alarm mit Aktionsplan
//
// RECOVERY-Detection: HMM RECOVERY-State triggert:
//   1. Alle SHORT closen (Profit-Lock nach Crash)
//   2. Eviction-Engine wieder aktiv
//   3. DCA-Sizing × 1.5 (aggressives LONG-Accumulieren)
//   4. Telegram-Alarm

'use strict';

const CrashRecoveryHandler = {
  _db: null,
  _HMM: null,
  _DemoEngine: null,
  _Trades: null,
  _Bitget: null,
  _EvictionEngine: null,
  _telegramFn: null,
  _logFn: null,
  _cronTimer: null,
  _initialized: false,
  _lastState: null,
  _lastActionTs: 0,
  // P6.3 [2026-06-04]: Telegram-Coalesce-Tracker. Verhindert Spam bei anhaltendem Crash-Mode
  // mit longsClosed=0 (= Zustandswiederholung, keine neue Aktion).
  _lastCrashTelegramTs: 0,
  _lastRecoveryTelegramTs: 0,
  _stats: { crash_actions: 0, recovery_actions: 0, longs_closed: 0, shorts_closed: 0, errors: 0, telegrams_suppressed: 0 },

  CFG: {
    SCAN_INTERVAL_MS:        30000,    // 30s ticks
    MIN_ACTION_INTERVAL_MS:  600000,   // 10min zwischen Aktionen (verhindert Repetition)
    TELEGRAM_COALESCE_MS:    1800000,  // P6.3: 30min Telegram-Coalesce-Fenster bei longsClosed=0
    DCA_SIZE_MULT_CRASH:     0.3,
    DCA_SIZE_MULT_RECOVERY:  1.5,
    DCA_SIZE_MULT_NORMAL:    1.0,
  },

  init(deps) {
    this._db = deps.db;
    this._HMM = deps.hmm;
    this._DemoEngine = deps.demoEngine;
    this._Trades = deps.trades;
    this._Bitget = deps.bitget;
    this._EvictionEngine = deps.evictionEngine;
    this._telegramFn = deps.telegramFn || null;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    this._initialized = true;
    try { this._logFn.info && this._logFn.info('CRASH_HANDLER', 'init — G3+G4 aktivziert (CRASH+RECOVERY auto-actions)'); } catch(_) {}
  },

  // ─── Tick: HMM-State checken, Transition handeln ─────────────
  tick() {
    if (!this._initialized || !this._HMM) return;
    let currentState = null;
    try {
      const r = this._HMM.getCurrentRegime();
      if (r) currentState = r.state;
    } catch(_) {}
    if (!currentState) return;

    const elapsed = Date.now() - this._lastActionTs;

    // CRASH erkannt + neu (oder nach Cooldown)
    if (currentState === 'CRASH' && (this._lastState !== 'CRASH' || elapsed > this.CFG.MIN_ACTION_INTERVAL_MS)) {
      this._triggerCrashActions();
      this._lastActionTs = Date.now();
    }
    // RECOVERY erkannt + neu
    else if (currentState === 'RECOVERY' && (this._lastState !== 'RECOVERY' || elapsed > this.CFG.MIN_ACTION_INTERVAL_MS)) {
      this._triggerRecoveryActions();
      this._lastActionTs = Date.now();
    }
    // Normalisierung (CRASH/RECOVERY → BEAR/BULL/RANGING)
    else if (this._lastState === 'CRASH' && currentState !== 'CRASH' && currentState !== 'RECOVERY') {
      this._triggerNormalize('post_crash');
    } else if (this._lastState === 'RECOVERY' && currentState !== 'RECOVERY' && currentState !== 'CRASH') {
      this._triggerNormalize('post_recovery');
    }
    this._lastState = currentState;
  },

  // ─── CRASH-Aktionen ──────────────────────────────────────────
  _triggerCrashActions() {
    this._stats.crash_actions++;
    let longsClosed = 0;
    try {
      // 1. Alle SINGLE-LONG-Positionen closen
      if (this._DemoEngine && this._DemoEngine.positions) {
        for (const [id, pos] of Object.entries(this._DemoEngine.positions)) {
          if (String(pos.direction || '').toUpperCase() === 'BUY') {
            try {
              const price = this._Bitget?.priceCache?.[pos.symbol]?.last || pos.fillPrice;
              if (pos.dbTradeId && this._Trades && this._Trades.close) {
                this._Trades.close(pos.dbTradeId, price, 'CRASH_AUTO_CLOSE');
                delete this._DemoEngine.positions[id];
                longsClosed++;
              }
            } catch(_) {}
          }
        }
        try { this._DemoEngine._persistDemoPositions && this._DemoEngine._persistDemoPositions(); } catch(_) {}
      }
      this._stats.longs_closed += longsClosed;
      // 2. Eviction-Engine deaktivieren
      if (this._EvictionEngine && this._EvictionEngine.setMode) {
        this._EvictionEngine.setMode('DISABLED', 'crash_mode_active');
      }
      // 3. DCA-Sizing markieren in bot_settings für DemoEngine-Lookup
      try {
        const set = this._db.prepare("INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)");
        set.run('dca_size_multiplier', String(this.CFG.DCA_SIZE_MULT_CRASH), Date.now());
        set.run('crash_mode_since', String(Date.now()), Date.now());
      } catch(_) {}
      // 4. Audit-Log
      try {
        this._db.prepare(`INSERT INTO system_log (ts, level, module, msg, data) VALUES (?,?,?,?,?)`).run(
          Date.now(), 'CRITICAL', 'crash_handler',
          `CRASH detected — ${longsClosed} LONG closed, eviction DISABLED, DCA×${this.CFG.DCA_SIZE_MULT_CRASH}`,
          JSON.stringify({ longsClosed, dcaMult: this.CFG.DCA_SIZE_MULT_CRASH })
        );
      } catch(_) {}
      // 5. Telegram — P6.3 [2026-06-04]: Coalesce-Schutz.
      // Echtes Enter-Crash (vorher KEIN Crash-Mode UND longsClosed > 0) → IMMER Telegram.
      // Wiederholte Detection bei anhaltendem Crash-Mode mit longsClosed=0 → max 1 / 30min.
      // Audit-Log + DCA-Sizing × 0.3 + Eviction DISABLED laufen unverändert weiter.
      if (this._telegramFn) {
        const now = Date.now();
        const isWasCrash = (this._lastState === 'CRASH');
        const noActionsTaken = (longsClosed === 0);
        const sinceLast = now - this._lastCrashTelegramTs;
        // Suppression-Regel: wenn schon im Crash-Mode + nichts neues geschlossen + < 30min seit letztem Telegram
        const suppress = (isWasCrash && noActionsTaken && sinceLast < this.CFG.TELEGRAM_COALESCE_MS);
        if (suppress) {
          this._stats.telegrams_suppressed++;
        } else {
          try { this._telegramFn(`💥 CRASH DETECTED — ${longsClosed} LONG-Positions closed, Eviction-Engine DISABLED, DCA-Sizing × ${this.CFG.DCA_SIZE_MULT_CRASH}`); } catch(_) {}
          this._lastCrashTelegramTs = now;
        }
      }
      try { this._logFn.info && this._logFn.info('CRASH_HANDLER', `CRASH actions: ${longsClosed} LONG closed, DCA×${this.CFG.DCA_SIZE_MULT_CRASH}, eviction OFF`); } catch(_) {}
    } catch(e) {
      this._stats.errors++;
      try { this._logFn.warn && this._logFn.warn('CRASH_HANDLER', 'crash actions err: ' + e.message); } catch(_) {}
    }
  },

  // ─── RECOVERY-Aktionen ───────────────────────────────────────
  _triggerRecoveryActions() {
    this._stats.recovery_actions++;
    let shortsClosed = 0;
    try {
      // 1. Alle SINGLE-SHORT-Positionen closen (Profit-Lock)
      if (this._DemoEngine && this._DemoEngine.positions) {
        for (const [id, pos] of Object.entries(this._DemoEngine.positions)) {
          if (String(pos.direction || '').toUpperCase() === 'SELL') {
            try {
              const price = this._Bitget?.priceCache?.[pos.symbol]?.last || pos.fillPrice;
              if (pos.dbTradeId && this._Trades && this._Trades.close) {
                this._Trades.close(pos.dbTradeId, price, 'RECOVERY_AUTO_CLOSE');
                delete this._DemoEngine.positions[id];
                shortsClosed++;
              }
            } catch(_) {}
          }
        }
        try { this._DemoEngine._persistDemoPositions && this._DemoEngine._persistDemoPositions(); } catch(_) {}
      }
      this._stats.shorts_closed += shortsClosed;
      // 2. Eviction-Engine wieder aktiv (DRY_RUN als sichere Default)
      if (this._EvictionEngine && this._EvictionEngine.setMode) {
        this._EvictionEngine.setMode('DRY_RUN', 'recovery_re_enable');
      }
      // 3. DCA-Sizing aggressiv
      try {
        const set = this._db.prepare("INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)");
        set.run('dca_size_multiplier', String(this.CFG.DCA_SIZE_MULT_RECOVERY), Date.now());
        set.run('recovery_mode_since', String(Date.now()), Date.now());
        set.run('crash_mode_since', null, Date.now());
      } catch(_) {}
      // 4. Audit-Log
      try {
        this._db.prepare(`INSERT INTO system_log (ts, level, module, msg, data) VALUES (?,?,?,?,?)`).run(
          Date.now(), 'CRITICAL', 'crash_handler',
          `RECOVERY detected — ${shortsClosed} SHORT closed, eviction re-enabled, DCA×${this.CFG.DCA_SIZE_MULT_RECOVERY}`,
          JSON.stringify({ shortsClosed, dcaMult: this.CFG.DCA_SIZE_MULT_RECOVERY })
        );
      } catch(_) {}
      // P6.3 [2026-06-04]: Symmetrischer Coalesce-Schutz für Recovery-Telegram.
      // Wenn bereits in Recovery-Mode UND shortsClosed=0 UND < 30min seit letztem Telegram: suppressieren.
      if (this._telegramFn) {
        const now = Date.now();
        const isWasRecovery = (this._lastState === 'RECOVERY');
        const noActionsTaken = (shortsClosed === 0);
        const sinceLast = now - this._lastRecoveryTelegramTs;
        const suppress = (isWasRecovery && noActionsTaken && sinceLast < this.CFG.TELEGRAM_COALESCE_MS);
        if (suppress) {
          this._stats.telegrams_suppressed++;
        } else {
          try { this._telegramFn(`🌱 RECOVERY DETECTED — ${shortsClosed} SHORT-Positions closed (Profit-Lock), DCA-Sizing × ${this.CFG.DCA_SIZE_MULT_RECOVERY}, Eviction-Engine re-enabled`); } catch(_) {}
          this._lastRecoveryTelegramTs = now;
        }
      }
      try { this._logFn.info && this._logFn.info('CRASH_HANDLER', `RECOVERY actions: ${shortsClosed} SHORT closed, DCA×${this.CFG.DCA_SIZE_MULT_RECOVERY}`); } catch(_) {}
    } catch(e) {
      this._stats.errors++;
      try { this._logFn.warn && this._logFn.warn('CRASH_HANDLER', 'recovery actions err: ' + e.message); } catch(_) {}
    }
  },

  // ─── Normalisierung nach Crash/Recovery ──────────────────────
  _triggerNormalize(reason) {
    try {
      const set = this._db.prepare("INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)");
      set.run('dca_size_multiplier', String(this.CFG.DCA_SIZE_MULT_NORMAL), Date.now());
      if (reason === 'post_crash') set.run('crash_mode_since', null, Date.now());
      if (reason === 'post_recovery') set.run('recovery_mode_since', null, Date.now());
      // FIX [2026-06-06]: Eviction symmetrisch re-enablen (war Bug — Normalize ließ Eviction DISABLED).
      // Nur DRY_RUN (Messung/Rotation-Signal, kein Live-Close). setMode ist no-op-sicher bei gleichem Mode.
      if (this._EvictionEngine && this._EvictionEngine.setMode) {
        this._EvictionEngine.setMode('DRY_RUN', 'normalize_' + reason);
      }
      try { this._logFn.info && this._logFn.info('CRASH_HANDLER', `Normalize ${reason} — DCA-Sizing zurück auf 1.0, Eviction → DRY_RUN`); } catch(_) {}
    } catch(_) {}
  },

  startCron() {
    if (this._cronTimer) return;
    setTimeout(() => this.tick(), 60000);
    this._cronTimer = setInterval(() => this.tick(), this.CFG.SCAN_INTERVAL_MS);
    try { this._logFn.info && this._logFn.info('CRASH_HANDLER', `cron started (${this.CFG.SCAN_INTERVAL_MS/1000}s ticks)`); } catch(_) {}
  },

  stopCron() { if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; } },

  snapshot() {
    return {
      initialized: this._initialized,
      lastState: this._lastState,
      lastActionTs: this._lastActionTs,
      ...this._stats,
    };
  },
};

module.exports = CrashRecoveryHandler;
