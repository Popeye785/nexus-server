// modules/mbt_profit_realizer.js — Daily MBT-Profit-Realizer Cron
// Verankert 2026-05-23 (STUFE C.3, Day-Zero-Backfill war C.2).
//
// ZWECK: Täglich 23:55 lokal die unrealized MBT-Profits (GRID+INFGRID seit letztem Cron)
// in WalletProvider.applyPnL() einbuchen → 70/30-Split greift via bot_settings.reserve_split_ratio.
//
// IDEMPOTENT: nutzt strategy_regime_performance.realized_at als Marker.
// Doppel-Cron-Run (Crash+Restart) bucht nichts doppelt.
//
// 7-TAGE-DRY-RUN-PHASE: _dry_run=true → nur Log+Telegram, kein applyPnL.
// Nach erfolgreicher Dry-Run-Phase: Flag-Flip auf false (Stufe C.5).

'use strict';

const MBTProfitRealizer = {
  _db: null,
  _walletProvider: null,
  _telegramFn: null,
  _logFn: null,
  _dry_run: true,   // ZWINGEND true bis 7-Tage-Verify abgeschlossen (Stufe C.5)
  _cronTimer: null,
  _lastTickMinute: -1,  // verhindert mehrfaches Feuern in derselben Minute
  _stats: { runs: 0, dry_runs: 0, productive_runs: 0, errors: 0, last_ts: 0, last_amount: 0 },

  // Trigger-Zeit: 23:55 lokal
  TRIGGER_HOUR: 23,
  TRIGGER_MINUTE: 55,

  init(db, walletProvider, telegramFn) {
    this._db = db;
    this._walletProvider = walletProvider;
    this._telegramFn = telegramFn || null;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      this._logFn.info && this._logFn.info('MBT_REALIZER', `init (dry_run=${this._dry_run}, trigger=${this.TRIGGER_HOUR}:${this.TRIGGER_MINUTE})`);
    } catch(_) {}
  },

  setDryRun(v) { this._dry_run = !!v; },

  // ─── Compute pending realize ──────────────────────────────────
  computePending() {
    if (!this._db) return { total: 0, perBot: [] };
    try {
      const rows = this._db.prepare(`
        SELECT bot_type, COUNT(*) n, ROUND(SUM(pnl_usdt), 4) AS total
        FROM strategy_regime_performance
        WHERE realized_at IS NULL AND bot_type IN ('GRID','INFGRID')
        GROUP BY bot_type
      `).all();
      const total = rows.reduce((s, r) => s + (r.total || 0), 0);
      return { total: Number(total.toFixed(4)), perBot: rows };
    } catch(e) {
      return { total: 0, perBot: [], error: e.message };
    }
  },

  // ─── Tick: prüft Zeit + führt Realize aus ─────────────────────
  tick() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const minuteKey = h * 60 + m;

    // Nur 1× pro Trigger-Minute (verhindert pm2-restart-Doppelfeuer)
    if (h !== this.TRIGGER_HOUR || m !== this.TRIGGER_MINUTE) return;
    if (this._lastTickMinute === minuteKey) return;
    this._lastTickMinute = minuteKey;

    // E.4 [23.05.2026] Live-aware: in LIVE arbeitet Realizer trotzdem via WalletProvider.applyPnL,
    // welches dann auf LiveWallet (statt LIVE_READONLY) routet. Solange WalletProvider Live-fähig ist,
    // kann der Realizer den 70/30-Split auch in LIVE anwenden — strp wird ja in beiden Modi gefüllt.
    // Wir loggen den Mode-Kontext für Audit-Klarheit.
    let _mode = 'DEMO';
    try { _mode = (typeof WalletProvider !== 'undefined' && WalletProvider._mode) ? WalletProvider._mode() : 'DEMO'; } catch(_) {}

    this._stats.runs++;
    this._stats.last_ts = Date.now();
    this._stats.last_mode = _mode;

    const pending = this.computePending();
    if (pending.total <= 0.01) {
      try { this._logFn.info && this._logFn.info('MBT_REALIZER', `No pending realize (${pending.total} USDT)`); } catch(_) {}
      return;
    }

    if (this._dry_run) {
      this._stats.dry_runs++;
      const msg = `Daily MBT-Realize DRY-RUN: would apply +${pending.total} USDT (${pending.perBot.map(r => r.bot_type+':'+r.total).join(', ')})`;
      try { this._logFn.info && this._logFn.info('MBT_REALIZER', msg); } catch(_) {}
      if (this._telegramFn) {
        try { this._telegramFn(`💤 [DRY/${_mode}] Daily-Realize ${new Date().toISOString().slice(0,10)}: would apply +${pending.total.toFixed(2)} USDT → Reserve+${(pending.total*0.7).toFixed(2)}, Trading+${(pending.total*0.3).toFixed(2)}`); } catch(_) {}
      }
      try {
        this._db.prepare(`INSERT INTO system_log (ts, level, module, msg, data) VALUES (?,?,?,?,?)`).run(
          Date.now(), 'INFO', 'mbt_realizer_dry', msg, JSON.stringify(pending)
        );
      } catch(_) {}
      this._stats.last_amount = pending.total;
      return;
    }

    // PRODUCTIVE: realize via WalletProvider.applyPnL
    try {
      const r = this._walletProvider.applyPnL(pending.total, 'DAILY_MBT_REALIZE_'+new Date().toISOString().slice(0,10));
      if (r && r.ok !== false) {
        // Mark realized
        this._db.prepare(`UPDATE strategy_regime_performance SET realized_at = ? WHERE realized_at IS NULL AND bot_type IN ('GRID','INFGRID')`).run(Date.now());
        this._stats.productive_runs++;
        this._stats.last_amount = pending.total;
        const msg = `Daily MBT-Realize PRODUCTIVE: applied +${pending.total} USDT (${pending.perBot.length} bot_types)`;
        try { this._logFn.info && this._logFn.info('MBT_REALIZER', msg); } catch(_) {}
        if (this._telegramFn) {
          try { this._telegramFn(`💰 [${_mode}] Daily-Realize ${new Date().toISOString().slice(0,10)}: +${pending.total.toFixed(2)} USDT → Reserve+${(pending.total*0.7).toFixed(2)}, Trading+${(pending.total*0.3).toFixed(2)}`); } catch(_) {}
        }
        try {
          this._db.prepare(`INSERT INTO system_log (ts, level, module, msg, data) VALUES (?,?,?,?,?)`).run(
            Date.now(), 'CRITICAL', 'mbt_realizer_prod', msg, JSON.stringify(pending)
          );
        } catch(_) {}
      } else {
        this._stats.errors++;
        try { this._logFn.warn && this._logFn.warn('MBT_REALIZER', 'applyPnL returned not-ok: ' + JSON.stringify(r)); } catch(_) {}
      }
    } catch(e) {
      this._stats.errors++;
      try { this._logFn.warn && this._logFn.warn('MBT_REALIZER', 'tick error: ' + e.message); } catch(_) {}
    }
  },

  startCron() {
    if (this._cronTimer) return;
    this._cronTimer = setInterval(() => this.tick(), 30000);  // alle 30s prüfen (greift bei 23:55 minute-genau)
    try { this._logFn.info && this._logFn.info('MBT_REALIZER', 'cron started (30s-tick, fires at 23:55 daily)'); } catch(_) {}
  },

  stopCron() {
    if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; }
  },

  snapshot() {
    return {
      ...this._stats,
      dry_run: this._dry_run,
      trigger: `${this.TRIGGER_HOUR}:${this.TRIGGER_MINUTE}`,
      pending: this.computePending(),
    };
  },
};

module.exports = MBTProfitRealizer;
