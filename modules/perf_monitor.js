// modules/perf_monitor.js
// Performance-Monitoring für 24-48h-Beobachtungsfenster nach Block O.
// Snapshots in DB: per-Symbol Trade-Stats + Brain-Health + CUSUM-Events + MR-Signals + Bayesian-Priors.
//
// Cron-Trigger via setInterval (1h) im Server.

'use strict';

// Block O A4: Module dependencies (require statt global-scope check)
let _ACW_dep = null;
try { _ACW_dep = require('./asset_class_weights.js'); } catch(_) {}
let _CUSUM_dep = null;
try { _CUSUM_dep = require('./cusum_filter.js'); } catch(_) {}

const PerfMonitor = {
  enabled: true,
  intervalMs: 3600 * 1000, // 1h
  bootDelayMs: 120 * 1000, // 2 min nach Boot
  timer: null,
  running: false,
  stats: { snapshots: 0, last_snapshot_ts: 0, errors: 0 },

  ensureTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS performance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        symbol TEXT,
        class TEXT,
        decisions_24h INTEGER,
        trades_24h INTEGER,
        wins_24h INTEGER,
        pnl_24h REAL,
        cusum_events_24h INTEGER,
        cusum_ticks_24h INTEGER,
        bayesian_bull REAL,
        bayesian_bear REAL,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_perfsnap_ts ON performance_snapshots(ts);
      CREATE INDEX IF NOT EXISTS idx_perfsnap_symbol ON performance_snapshots(symbol);
    `);
  },

  async _tick(opts = {}) {
    if (!this.enabled || this.running) return;
    this.running = true;
    const t0 = Date.now();
    try {
      // Versuche DB/RiskEngine via globalThis (server.js hängt sie dort auf — siehe Bitget-Pattern)
      const db = opts.db || (typeof globalThis !== 'undefined' && globalThis.DB && globalThis.DB.db);
      if (!db) throw new Error('DB nicht verfügbar');
      this.ensureTable(db);
      const symbols = opts.symbols || ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','NEARUSDT','SUIUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','LINKUSDT','TONUSDT','AVAXUSDT'];
      const _ACW = opts._ACW || _ACW_dep;
      const _CUSUMmod = opts._CUSUM || _CUSUM_dep;
      const _RE = opts._RE || (typeof globalThis !== 'undefined' && globalThis.RiskEngine);
      const since24h = Date.now() - 86400000;

      // Per-Symbol
      for (const sym of symbols) {
        try {
          const dec = db.prepare("SELECT COUNT(*) n FROM aladdin_decisions WHERE symbol=? AND ts > ?").get(sym, since24h);
          const tr = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) w, COALESCE(SUM(realized_pnl),0) pnl FROM trades WHERE symbol=? AND state='CLOSED' AND closed_at > ?").get(sym, since24h);
          const cls = _ACW ? _ACW.classOf(sym) : 'UNKNOWN';
          let cusumSt = null;
          if (_CUSUMmod) cusumSt = _CUSUMmod.snapshot(sym);
          const bay = (_RE && _RE.bayesian && _RE.bayesian.priors) ? _RE.bayesian.priors : null;
          db.prepare(`
            INSERT INTO performance_snapshots
            (ts, symbol, class, decisions_24h, trades_24h, wins_24h, pnl_24h,
             cusum_events_24h, cusum_ticks_24h, bayesian_bull, bayesian_bear, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            Date.now(), sym, cls,
            dec.n || 0, tr.n || 0, tr.w || 0, tr.pnl || 0,
            cusumSt ? cusumSt.totalEvents : null,
            cusumSt ? cusumSt.totalTicks : null,
            bay ? bay.bull : null,
            bay ? bay.bear : null,
            null
          );
        } catch(e) {
          this.stats.errors++;
        }
      }
      this.stats.snapshots++;
      this.stats.last_snapshot_ts = Date.now();
      try { Log.info('PERF_MON', `snapshot #${this.stats.snapshots}: ${symbols.length} symbols, took ${Date.now()-t0}ms`); } catch(_) {}
    } catch(e) {
      try { Log.warn('PERF_MON', 'tick err: ' + e.message); } catch(_) {}
      this.stats.errors++;
    } finally {
      this.running = false;
    }
  },

  start() {
    if (this.timer) return;
    setTimeout(() => {
      this._tick();
      this.timer = setInterval(() => this._tick(), this.intervalMs);
      try { Log.boot('PerfMonitor gestartet (1h-cron, 12 Symbole)'); } catch(_) {}
    }, this.bootDelayMs);
  },

  snapshot() {
    return { enabled: this.enabled, intervalMs: this.intervalMs, stats: this.stats };
  },
};

module.exports = PerfMonitor;
