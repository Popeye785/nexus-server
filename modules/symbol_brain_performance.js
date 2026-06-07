// modules/symbol_brain_performance.js — Per-Symbol Brain Walk-Forward
// Verankert 2026-05-23 (STUFE D6).
//
// ZWECK: pro Symbol+Decision die rollende 24h-Accuracy aus decision_outcomes berechnen
// und einen confidence_adj liefern, der das Brain pro Symbol differenziert dämpft/boostet.
//
// Beispiel: SUIUSDT BUY hat aktuell 0% Accuracy (n=267) → adj=-0.5 → conf×0.5.
// Beispiel: NEARUSDT BUY hat 27% Accuracy → adj=-0.2.
// Beispiel: hypothetisch BTC SELL 55% → adj=+0.1.
//
// Cron 1h refresh. In-Memory Map für schnellen Brain-Read.
// Min N=20 für Trust (sonst neutral 0.0).

'use strict';

const SymbolBrainPerformance = {
  _db: null,
  _logFn: null,
  _cronTimer: null,
  _cache: new Map(),   // key: `${symbol}|${decision}` → { acc, n, adj, ts }
  _lastRefresh: 0,
  _stats: { refreshes: 0, errors: 0, last_n: 0, last_keys: 0 },

  // Tunables — bewusst konservativ
  MIN_SAMPLES: 20,        // unter dieser Stichprobe → adj=0
  HORIZON_H: 1,            // 1h-horizon ist Brain-Closest
  LOOKBACK_H: 24,          // rollendes 24h-Fenster
  REFRESH_MS: 3600000,     // 1h Cron
  // Adjustment-Curve (acc → adj): kaskadiert von strenger Strafe zu Boost
  // adj wird auf confidence angewandt als: confidence × (1 + adj)
  CURVE: [
    { max: 0.10, adj: -0.50 },   // <10% → 50% Dämpfung
    { max: 0.25, adj: -0.30 },   // 10-25% → 30% Dämpfung
    { max: 0.50, adj:  0.00 },   // 25-50% → neutral
    { max: 0.65, adj: +0.10 },   // 50-65% → +10% Boost
    { max: 1.01, adj: +0.20 },   // 65%+ → +20% Boost
  ],

  init(db) {
    this._db = db;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS symbol_brain_performance (
          symbol TEXT NOT NULL,
          decision TEXT NOT NULL,
          horizon_h INTEGER NOT NULL,
          lookback_h INTEGER NOT NULL,
          accuracy REAL,
          n INTEGER,
          confidence_adj REAL,
          last_updated INTEGER,
          PRIMARY KEY (symbol, decision, horizon_h, lookback_h)
        );
        CREATE INDEX IF NOT EXISTS idx_sbp_updated ON symbol_brain_performance(last_updated);
      `);
      try { this._logFn.info && this._logFn.info('SYM_BRAIN', `init (min_n=${this.MIN_SAMPLES} horizon=${this.HORIZON_H}h lookback=${this.LOOKBACK_H}h)`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('SYM_BRAIN', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  _curveAdjust(acc) {
    for (const tier of this.CURVE) { if (acc < tier.max) return tier.adj; }
    return 0;
  },

  // ─── Refresh aus decision_outcomes ────────────────────────────
  refresh() {
    if (!this._db) return;
    this._stats.refreshes++;
    try {
      const since = Date.now() - this.LOOKBACK_H * 3600000;
      const rows = this._db.prepare(`
        SELECT symbol, decision, COUNT(*) n, AVG(direction_correct) acc
        FROM decision_outcomes
        WHERE horizon_h = ? AND decision_ts > ?
        GROUP BY symbol, decision
      `).all(this.HORIZON_H, since);
      const newCache = new Map();
      const ins = this._db.prepare(`INSERT OR REPLACE INTO symbol_brain_performance
        (symbol, decision, horizon_h, lookback_h, accuracy, n, confidence_adj, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const now = Date.now();
      let writtenN = 0;
      for (const r of rows) {
        const acc = Number(r.acc) || 0;
        const n   = Number(r.n) || 0;
        const adj = n >= this.MIN_SAMPLES ? this._curveAdjust(acc) : 0;
        const key = `${r.symbol}|${r.decision}`;
        newCache.set(key, { symbol: r.symbol, decision: r.decision, acc, n, adj, ts: now });
        try { ins.run(r.symbol, r.decision, this.HORIZON_H, this.LOOKBACK_H, acc, n, adj, now); writtenN++; } catch(_) {}
      }
      this._cache = newCache;
      this._lastRefresh = now;
      this._stats.last_n = writtenN;
      this._stats.last_keys = newCache.size;
      try { this._logFn.info && this._logFn.info('SYM_BRAIN', `refresh ${writtenN} entries (${newCache.size} symbol+decision pairs)`); } catch(_) {}
    } catch(e) {
      this._stats.errors++;
      try { this._logFn.warn && this._logFn.warn('SYM_BRAIN', 'refresh fail: ' + e.message); } catch(_) {}
    }
  },

  // ─── Public: Brain-Hook ───────────────────────────────────────
  // Liefert adj ∈ [-0.5, +0.2]. 0 = neutral (zu wenig Daten ODER Mittel-Range Accuracy).
  getAdjustment(symbol, decision) {
    if (!symbol || !decision || decision === 'HOLD') return 0;
    const key = `${symbol}|${decision}`;
    const v = this._cache.get(key);
    if (!v) return 0;
    return v.adj || 0;
  },

  getDetail(symbol, decision) {
    const key = `${symbol}|${decision}`;
    return this._cache.get(key) || null;
  },

  startCron() {
    if (this._cronTimer) return;
    // First refresh nach 60s (gibt Outcome-Tracker Zeit) — danach 1h-Intervall
    setTimeout(() => this.refresh(), 60000);
    this._cronTimer = setInterval(() => this.refresh(), this.REFRESH_MS);
    try { this._logFn.info && this._logFn.info('SYM_BRAIN', `cron started (refresh every ${this.REFRESH_MS/60000}min)`); } catch(_) {}
  },

  stopCron() {
    if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; }
  },

  snapshot() {
    const top = [];
    for (const [, v] of this._cache.entries()) top.push(v);
    top.sort((a, b) => a.adj - b.adj);  // most-damped first
    return {
      ...this._stats,
      last_refresh: this._lastRefresh,
      min_samples: this.MIN_SAMPLES,
      horizon_h: this.HORIZON_H,
      lookback_h: this.LOOKBACK_H,
      total_keys: this._cache.size,
      worst: top.slice(0, 5),
      best:  top.slice(-5).reverse(),
    };
  },
};

module.exports = SymbolBrainPerformance;
