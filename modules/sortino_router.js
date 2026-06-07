// modules/sortino_router.js — Sortino-Ratio-Capital-Routing (STUFE 4)
// Verankert 2026-05-20 (Boutique-Quant-A).
//
// Sortino-Ratio = (mean_return − target_return) / downside_deviation
// Im Gegensatz zu Sharpe: nur DOWNSIDE-volatility penalisiert (upside-vola ist gut).
//
// Pro (bot_type × regime) wird Sortino aus strategy_regime_performance.pnl_usdt berechnet.
// Capital-Pool-Tilt: je höher Sortino, desto höhere Allocation (innerhalb erlaubter Bandbreite).
//
// MODI:
//   SHADOW (default)     → berechnet Tilt, loggt nur. Capital-Split bleibt fix 40/25/20/15.
//   PRODUCTIVE           → bei CFG.SORTINO_PRODUCTIVE=true UND 14d+ Daten → tilt wird angewendet
//
// Bandbreite: kein bot_type < 10% allocation, kein bot_type > 50%. Stability > Optimum.
//
// Re-Compute alle 6h via Cron. Latest in `sortino_allocations`-Tabelle persistiert.

'use strict';

const DEFAULTS = {
  TARGET_RETURN: 0,                  // 0 = MAR (Minimum Acceptable Return), conservative
  MIN_TRADES: 5,                     // pro (bot_type × regime) min 5 trades für Sortino-Berechnung
  MIN_DAYS_HISTORY: 14,              // production-mode erst ab 14d trade-data
  LOOKBACK_DAYS: 30,                 // sliding window
  MIN_ALLOCATION_PCT: 0.10,          // keine bot_type unter 10%
  MAX_ALLOCATION_PCT: 0.50,          // keine bot_type über 50%
  FIXED_FALLBACK: {                  // Status-quo Allocation
    SINGLE:   0.40,
    GRID:     0.25,
    INFGRID:  0.20,
    DCA:      0.15,
  },
  RECOMPUTE_INTERVAL_MS: 6 * 3600 * 1000,  // 6h
};

const SortinoRouter = {
  _db: null,
  _logFn: null,
  _cronTimer: null,
  _stats: { compute_runs: 0, last_compute_ts: 0, last_mode: 'SHADOW', last_allocation: null, last_sortino: {} },
  _opts: { ...DEFAULTS },
  _productiveFlag: false,

  init(db, opts = {}) {
    this._db = db;
    this._opts = { ...DEFAULTS, ...opts };
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sortino_allocations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          mode TEXT NOT NULL,
          history_days REAL,
          allocation_json TEXT NOT NULL,
          sortino_json TEXT NOT NULL,
          tilt_magnitude REAL,
          applied INTEGER DEFAULT 0,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sa_ts ON sortino_allocations(ts);
      `);
      try { this._logFn.info && this._logFn.info('SORTINO', 'initialized (SHADOW default, target_return=0, lookback=30d, recompute=6h)'); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('SORTINO', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  // ─── Sortino-Berechnung pro bot_type ──────────────────────────────
  // Sortino = (mean(returns) - target) / std(downside_returns)
  // Bei <MIN_TRADES → returns null (signals NEUTRAL)
  _computeSortino(returns, target) {
    if (!Array.isArray(returns) || returns.length < this._opts.MIN_TRADES) return null;
    const t = (typeof target === 'number' ? target : 0);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const downside = returns.filter(r => r < t);
    if (downside.length === 0) {
      // No downside: very high sortino, cap arbitrary
      return mean > t ? 5.0 : 0;
    }
    const variance = downside.reduce((s, r) => s + Math.pow(r - t, 2), 0) / downside.length;
    const downsideStd = Math.sqrt(variance);
    if (downsideStd === 0) return mean > t ? 5.0 : 0;
    return (mean - t) / downsideStd;
  },

  // ─── Tilt-Logik: Allocation aus Sortino-Werten ───────────────────
  _tiltFromSortinos(sortinos) {
    const botTypes = Object.keys(this._opts.FIXED_FALLBACK);
    const validSortinos = {};
    let usableCount = 0;
    for (const bt of botTypes) {
      const s = sortinos[bt];
      if (typeof s === 'number' && isFinite(s)) {
        validSortinos[bt] = s;
        usableCount++;
      }
    }

    // Fallback wenn <50% der bot_types brauchbare Sortinos haben
    if (usableCount < botTypes.length / 2) {
      return { allocation: { ...this._opts.FIXED_FALLBACK }, basis: 'fallback', reason: 'insufficient_sortinos' };
    }

    // Shift: Sortino kann negativ sein. Wir verschieben um min damit alle ≥ 0.
    // Dann normalisieren auf summe = 1, dann Bandbreite-Constraints anwenden.
    const sortinosVals = botTypes.map(bt => validSortinos[bt] != null ? validSortinos[bt] : 0);
    const minS = Math.min(...sortinosVals);
    const shifted = sortinosVals.map(s => s - minS + 0.01);  // alle > 0
    const sumS = shifted.reduce((a, b) => a + b, 0);
    let allocation = {};
    botTypes.forEach((bt, i) => { allocation[bt] = shifted[i] / sumS; });

    // Bandbreite-Constraints: clip + renormalize
    let adjusted = true, iterations = 0;
    while (adjusted && iterations < 10) {
      adjusted = false;
      iterations++;
      for (const bt of botTypes) {
        if (allocation[bt] < this._opts.MIN_ALLOCATION_PCT) {
          allocation[bt] = this._opts.MIN_ALLOCATION_PCT;
          adjusted = true;
        } else if (allocation[bt] > this._opts.MAX_ALLOCATION_PCT) {
          allocation[bt] = this._opts.MAX_ALLOCATION_PCT;
          adjusted = true;
        }
      }
      const totalSum = Object.values(allocation).reduce((a, b) => a + b, 0);
      if (Math.abs(totalSum - 1.0) > 0.001) {
        // Renormalisierung
        for (const bt of botTypes) allocation[bt] = allocation[bt] / totalSum;
      }
    }

    return { allocation, basis: 'sortino', reason: 'computed_from_history' };
  },

  // ─── Public: Re-Compute (Cron) ───────────────────────────────────
  recompute() {
    if (!this._db) return null;
    const now = Date.now();
    const lookbackMs = this._opts.LOOKBACK_DAYS * 86400000;

    let trades = [];
    try {
      trades = this._db.prepare(`
        SELECT bot_type, regime, pnl_usdt, ts
        FROM strategy_regime_performance
        WHERE ts > ?
        ORDER BY ts ASC
      `).all(now - lookbackMs);
    } catch(_) {}

    if (!trades || trades.length === 0) {
      const result = {
        mode: 'SHADOW',
        history_days: 0,
        allocation: { ...this._opts.FIXED_FALLBACK },
        sortino: {},
        tilt_magnitude: 0,
        reason: 'no_trades_in_lookback',
      };
      this._persist(result);
      return result;
    }

    // History-Days = (now - oldest_trade) in days
    const oldestTs = trades[0].ts;
    const historyDays = (now - oldestTs) / 86400000;

    // Sortinos pro bot_type
    const byBot = {};
    for (const t of trades) {
      if (!byBot[t.bot_type]) byBot[t.bot_type] = [];
      byBot[t.bot_type].push(t.pnl_usdt || 0);
    }
    const sortinos = {};
    for (const [bt, returns] of Object.entries(byBot)) {
      const s = this._computeSortino(returns, this._opts.TARGET_RETURN);
      sortinos[bt] = s != null ? parseFloat(s.toFixed(4)) : null;
    }

    // Modus-Entscheidung
    const productive = this._productiveFlag && historyDays >= this._opts.MIN_DAYS_HISTORY;
    const mode = productive ? 'PRODUCTIVE' : 'SHADOW';

    // Tilt computation
    const tilt = this._tiltFromSortinos(sortinos);
    let allocation = tilt.allocation;
    if (!productive) {
      // SHADOW: keep fixed-fallback as authoritative, log computed-tilt as "would-be"
      allocation = { ...this._opts.FIXED_FALLBACK };
    }

    // Tilt-Magnitude: L1-distance zw computed-tilt und fixed-fallback
    let tiltMag = 0;
    for (const bt of Object.keys(this._opts.FIXED_FALLBACK)) {
      tiltMag += Math.abs((tilt.allocation[bt] || 0) - this._opts.FIXED_FALLBACK[bt]);
    }
    tiltMag = parseFloat((tiltMag / 2).toFixed(4));  // /2 = normalized

    const result = {
      mode,
      history_days: parseFloat(historyDays.toFixed(2)),
      allocation,
      computed_tilt: tilt.allocation,
      sortino: sortinos,
      tilt_magnitude: tiltMag,
      basis: tilt.basis,
      reason: tilt.reason,
      productive_flag: this._productiveFlag,
      min_days_for_productive: this._opts.MIN_DAYS_HISTORY,
      trades_count: trades.length,
    };
    this._persist(result);
    this._stats.compute_runs++;
    this._stats.last_compute_ts = now;
    this._stats.last_mode = mode;
    this._stats.last_allocation = allocation;
    this._stats.last_sortino = sortinos;
    try {
      this._logFn.info && this._logFn.info('SORTINO',
        `recompute mode=${mode} history=${historyDays.toFixed(1)}d trades=${trades.length} tiltMag=${tiltMag} sortino=${JSON.stringify(sortinos)}`);
    } catch(_) {}
    return result;
  },

  _persist(result) {
    if (!this._db) return;
    try {
      this._db.prepare(`INSERT INTO sortino_allocations (ts, mode, history_days, allocation_json, sortino_json, tilt_magnitude, applied, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        Date.now(), result.mode, result.history_days || 0,
        JSON.stringify(result.allocation),
        JSON.stringify(result.sortino || {}),
        result.tilt_magnitude || 0,
        result.mode === 'PRODUCTIVE' ? 1 : 0,
        JSON.stringify({ reason: result.reason, basis: result.basis, computed_tilt: result.computed_tilt }).slice(0, 1000)
      );
    } catch(_) {}
  },

  // ─── Public: hole aktuelle Allocation (z.B. Capital-Pool-Tilt) ──
  getAllocation() {
    return this._stats.last_allocation ? { ...this._stats.last_allocation } : { ...this._opts.FIXED_FALLBACK };
  },

  getMode() {
    return this._stats.last_mode || 'SHADOW';
  },

  setProductive(enabled) {
    this._productiveFlag = !!enabled;
    try { this._logFn.info && this._logFn.info('SORTINO', `productive flag set to ${this._productiveFlag}`); } catch(_) {}
  },

  startCron() {
    if (this._cronTimer) return;
    setTimeout(() => this.recompute(), 45000);  // First nach 45s
    this._cronTimer = setInterval(() => this.recompute(), this._opts.RECOMPUTE_INTERVAL_MS);
  },

  stopCron() {
    if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; }
  },

  snapshot() {
    return {
      ...this._stats,
      productive_flag: this._productiveFlag,
      options: this._opts,
    };
  },

  DEFAULTS,
};

module.exports = SortinoRouter;
