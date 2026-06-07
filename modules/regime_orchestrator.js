// modules/regime_orchestrator.js — G6 Zentraler Regime-Layout-Orchestrator
// Verankert 2026-05-23 (G6 — Master-Pipeline G).
//
// VISION:
//   "5/5 Slots IMMER aktiv, völlig autonom, pro Regime das beste Layout"
//
// Aufgabe:
//   1. HMM-State lesen alle 60s
//   2. Soll-Slot-Layout pro Regime berechnen (SLOT_MATRIX)
//   3. Vergleich Ist vs Soll
//   4. Sanfte Transitions (keine Schock-Eviction)
//   5. Telegram-Alert bei Regime-Wechsel
//   6. Audit-Log
//
// G6 ist KEIN Trade-Executor — es ist ein READ-ONLY-Audit-Layer + Empfehlungs-Generator.
// Es respektiert: Pool-Limits (CapitalPool), Eviction-Engine, alle Hard-Locks.
// Bei TRANSITIONS triggert es nur bestehende Module (EvictionEngine, MetaBrain via DemoEngine).

'use strict';

const RegimeOrchestrator = {
  _db: null,
  _HMM: null,
  _EvictionEngine: null,
  _CapitalPool: null,
  _telegramFn: null,
  _logFn: null,
  _cronTimer: null,
  _initialized: false,
  _lastRegime: null,
  _lastLayoutCheck: 0,
  _stats: { ticks: 0, regime_transitions: 0, layout_alerts: 0, errors: 0 },

  CFG: {
    SCAN_INTERVAL_MS:    60000,
    MIN_TRANSITION_GAP:  300000,   // 5min zwischen Transition-Alerts
    AUTO_DISABLE_DRIFT:  0.05,     // 5% Wallet-Drift → auto-disable orchestrator
  },

  // SOLL-Layout pro Regime (Christian's Vision)
  SLOT_MATRIX: {
    'BULL_STRONG':  { SINGLE: 3, DCA: 1, INFGRID: 1, GRID: 0, note: '3× LONG-SINGLE + 1× DCA-LONG + 1× INFGRID' },
    'BULL_WEAK':    { SINGLE: 2, DCA: 2, GRID: 1, INFGRID: 0, note: '2× LONG-SINGLE + 2× DCA-LONG + 1× GRID' },
    'BULL':         { SINGLE: 2, DCA: 1, GRID: 1, INFGRID: 1, note: 'allgemeiner Bull-Mix' },
    'RANGING':      { SINGLE: 0, DCA: 1, GRID: 3, INFGRID: 1, note: '0× SINGLE + 1× DCA + 3× GRID + 1× INFGRID' },
    'SQUEEZE':      { SINGLE: 1, DCA: 1, GRID: 2, INFGRID: 1, note: 'Pre-Breakout pending + Range-Fallback' },
    'BEAR_WEAK':    { SINGLE: 1, DCA: 2, GRID: 2, INFGRID: 0, note: '1× SHORT + 2× DCA-defensive + 2× GRID' },
    'BEAR':         { SINGLE: 1, DCA: 1, GRID: 2, INFGRID: 1, note: '1× SHORT + 1× DCA + 2× GRID + 1× INFGRID' },
    'BEAR_STRONG':  { SINGLE: 2, DCA: 1, GRID: 1, INFGRID: 1, note: '2× SHORT + 1× DCA + 1× GRID + 1× INFGRID' },
    'CRASH':        { SINGLE: 2, DCA: 0, GRID: 0, INFGRID: 0, note: '2× SHORT, alles andere flat, DCA×0.3' },
    'RECOVERY':     { SINGLE: 1, DCA: 3, GRID: 1, INFGRID: 0, note: '3× DCA-LONG aggressiv + 1× LONG-SINGLE + 1× GRID' },
    'NEUTRAL':      { SINGLE: 1, DCA: 1, GRID: 2, INFGRID: 1, note: 'balanced default' },
    'EXTREME_VOL':  { SINGLE: 0, DCA: 0, GRID: 1, INFGRID: 0, note: 'nur 1× Grid (defensiv)' },
  },

  init(deps) {
    this._db = deps.db;
    this._HMM = deps.hmm;
    this._EvictionEngine = deps.evictionEngine;
    this._CapitalPool = deps.capitalPool;
    this._telegramFn = deps.telegramFn || null;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS regime_orchestrator_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          regime TEXT NOT NULL,
          ist_json TEXT,
          soll_json TEXT,
          diff_json TEXT,
          transition_from TEXT,
          action TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ro_ts ON regime_orchestrator_log(ts);
      `);
      this._initialized = true;
      try { this._logFn.info && this._logFn.info('REGIME_ORC', `init — 12 Regime-Layouts, scan=${this.CFG.SCAN_INTERVAL_MS/1000}s`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('REGIME_ORC', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  // Ist-Layout berechnen
  _istLayout() {
    try {
      const single = this._db.prepare(`SELECT COUNT(*) n FROM trades WHERE state IN ('POSITION_ACTIVE','SUBMITTED','PARTIAL')`).get().n || 0;
      const grid   = this._db.prepare(`SELECT COUNT(*) n FROM grid_instances WHERE status='OPEN' AND bot_type='GRID'`).get().n || 0;
      const inf    = this._db.prepare(`SELECT COUNT(*) n FROM grid_instances WHERE status='OPEN' AND bot_type='INFGRID'`).get().n || 0;
      const dca    = this._db.prepare(`SELECT COUNT(*) n FROM dca_instances WHERE status='OPEN'`).get().n || 0;
      return { SINGLE: single, GRID: grid, INFGRID: inf, DCA: dca, total: single + grid + inf + dca };
    } catch(_) { return { SINGLE: 0, GRID: 0, INFGRID: 0, DCA: 0, total: 0 }; }
  },

  // Soll-Layout pro Regime
  _sollLayout(regime) {
    return this.SLOT_MATRIX[regime] || this.SLOT_MATRIX['NEUTRAL'];
  },

  // Diff: was fehlt (positive Zahl), was zu viel (negative)
  _diff(ist, soll) {
    return {
      SINGLE:  (soll.SINGLE  || 0) - (ist.SINGLE  || 0),
      GRID:    (soll.GRID    || 0) - (ist.GRID    || 0),
      INFGRID: (soll.INFGRID || 0) - (ist.INFGRID || 0),
      DCA:     (soll.DCA     || 0) - (ist.DCA     || 0),
    };
  },

  // ─── Main Tick ──────────────────────────────────────────────
  tick() {
    if (!this._initialized || !this._HMM) return;
    this._stats.ticks++;
    let regime = 'RANGING';
    try {
      const r = this._HMM.getCurrentRegime();
      if (r) regime = r.state || 'RANGING';
    } catch(_) {}
    const ist = this._istLayout();
    const soll = this._sollLayout(regime);
    const diff = this._diff(ist, soll);
    const needsAction = Object.values(diff).some(v => v !== 0);
    const isTransition = this._lastRegime && this._lastRegime !== regime;
    // Audit-Log
    try {
      this._db.prepare(`INSERT INTO regime_orchestrator_log (ts, regime, ist_json, soll_json, diff_json, transition_from, action) VALUES (?,?,?,?,?,?,?)`).run(
        Date.now(), regime, JSON.stringify(ist), JSON.stringify(soll), JSON.stringify(diff),
        isTransition ? this._lastRegime : null,
        needsAction ? 'NEEDS_ADJUSTMENT' : 'ALIGNED'
      );
    } catch(_) {}
    // Telegram bei Transition (max 1× pro 5min)
    if (isTransition && (Date.now() - this._lastLayoutCheck) > this.CFG.MIN_TRANSITION_GAP) {
      this._stats.regime_transitions++;
      this._lastLayoutCheck = Date.now();
      try {
        if (this._telegramFn) {
          const diffStr = Object.entries(diff).filter(([_,v]) => v!==0).map(([k,v]) => `${k}: ${v>0?'+':''}${v}`).join(', ');
          this._telegramFn(`🔄 REGIME TRANSITION: ${this._lastRegime} → ${regime} | Layout-Δ: ${diffStr || 'aligned'} | ${soll.note}`);
        }
      } catch(_) {}
      try { this._logFn.info && this._logFn.info('REGIME_ORC', `TRANSITION ${this._lastRegime} → ${regime} | ist=${JSON.stringify(ist)} soll=${JSON.stringify(soll)} diff=${JSON.stringify(diff)}`); } catch(_) {}
    }
    this._lastRegime = regime;
  },

  startCron() {
    if (this._cronTimer) return;
    setTimeout(() => this.tick(), 90000);
    this._cronTimer = setInterval(() => this.tick(), this.CFG.SCAN_INTERVAL_MS);
    try { this._logFn.info && this._logFn.info('REGIME_ORC', `cron started (${this.CFG.SCAN_INTERVAL_MS/1000}s)`); } catch(_) {}
  },

  stopCron() { if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; } },

  // Notfall-Override (Christian-API)
  forceRegime(regime, reason) {
    if (!this.SLOT_MATRIX[regime]) return { ok: false, reason: 'INVALID_REGIME' };
    try { this._logFn.info && this._logFn.info('REGIME_ORC', `FORCE override: ${regime} (${reason||'manual'})`); } catch(_) {}
    try { if (this._telegramFn) this._telegramFn(`⚠️ REGIME-FORCE: → ${regime} (${reason||'manual'})`); } catch(_) {}
    return { ok: true, regime, soll: this._sollLayout(regime) };
  },

  snapshot() {
    const regime = (this._HMM && this._HMM.getCurrentRegime) ? (this._HMM.getCurrentRegime().state || 'RANGING') : 'RANGING';
    const ist = this._istLayout();
    const soll = this._sollLayout(regime);
    const diff = this._diff(ist, soll);
    return {
      initialized: this._initialized,
      ts: Date.now(),
      regime, ist, soll, diff,
      ...this._stats,
      matrix: this.SLOT_MATRIX,
    };
  },

  history(limit = 20) {
    if (!this._db) return [];
    try {
      return this._db.prepare(`SELECT * FROM regime_orchestrator_log ORDER BY ts DESC LIMIT ?`).all(limit);
    } catch(_) { return []; }
  },
};

module.exports = RegimeOrchestrator;
