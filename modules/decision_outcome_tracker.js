// modules/decision_outcome_tracker.js — Brain-Decision-Outcome-Tracker
// Verankert 2026-05-21 (LIVE-Readiness-Validation).
//
// ZWECK: pro Brain-Decision den tatsächlichen Markt-Outcome 1h/4h/24h später messen.
// Output: Direction-Accuracy pro Sub-Source + Familie + overall.
// Ohne dieses Tracking ist NICHT messbar ob Brain wirklich predictive ist.
//
// Logik:
//   - Cron alle 5 min schaut zurück welche aladdin_decisions ein Outcome-Window erreicht haben
//   - Outcome = log(price_t+window / price_t)
//   - direction_correct = (BUY und outcome > +0.001) ODER (SELL und outcome < -0.001)
//   - Pro Decision: outcome_1h, outcome_4h, outcome_24h + direction_correct_*
//   - Persistiert in `decision_outcomes`-Tabelle
//
// Brain-NICHT-Integration: read-only Audit, kein Trading-Pfad.

'use strict';

const DecisionOutcomeTracker = {
  _db: null,
  _Bitget: null,
  _logFn: null,
  _cronTimer: null,
  _stats: { runs: 0, scored_1h: 0, scored_4h: 0, scored_24h: 0, errors: 0, last_run_ts: 0 },
  WINDOWS_HOURS: [1, 4, 24],
  // T9.3 [24.05.2026]: 0.001 → 0.005 (0.1% → 0.5%)
  // Vorher: 24h-Accuracy zeigte ~92% BUY-Hits in RANGING — zu schön um wahr zu sein.
  // Ursache: 24h hat fast immer >0.1% Move, daher "direction richtig" trivial → Verzerrung.
  // 0.5% ist Bewegung mit echtem trading-relevantem Edge (über Fees+Slippage).
  DECISION_NEUTRAL_BAND: 0.005,  // 0.5% — Bewegung unter dieser Schwelle = NEUTRAL
  MIN_CONFIDENCE_TO_TRACK: 0.05,

  init(db, bitgetClient) {
    this._db = db;
    this._Bitget = bitgetClient;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS decision_outcomes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          decision_id INTEGER NOT NULL,
          decision_ts INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          decision TEXT NOT NULL,
          confidence REAL,
          entry_price REAL,
          horizon_h INTEGER NOT NULL,
          outcome_price REAL,
          outcome_return REAL,
          direction_correct INTEGER,
          scored_at INTEGER,
          UNIQUE(decision_id, horizon_h)
        );
        CREATE INDEX IF NOT EXISTS idx_do_decid ON decision_outcomes(decision_id);
        CREATE INDEX IF NOT EXISTS idx_do_symbol_ts ON decision_outcomes(symbol, decision_ts);
        CREATE INDEX IF NOT EXISTS idx_do_horizon_correct ON decision_outcomes(horizon_h, direction_correct);
      `);
      try { this._logFn.info && this._logFn.info('OUTCOME', `initialized (3 horizons: 1h/4h/24h, neutral_band=±${this.DECISION_NEUTRAL_BAND*100}%)`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('OUTCOME', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  // ─── Score unscored Decisions ─────────────────────────────────
  scoreDue() {
    if (!this._db || !this._Bitget) return;
    const now = Date.now();
    this._stats.runs++;
    this._stats.last_run_ts = now;
    for (const h of this.WINDOWS_HOURS) {
      try { this._scoreHorizon(h, now); } catch(_) { this._stats.errors++; }
    }
  },

  _scoreHorizon(horizonH, now) {
    const windowMs = horizonH * 3600 * 1000;
    // Decisions deren Outcome-Window jetzt offen ist (ts < now - windowMs) UND noch nicht gescored
    const cutoff = now - windowMs;
    // Limit auf 200 pro Run um nicht alles auf einmal zu fetchen
    let rows = [];
    try {
      rows = this._db.prepare(`
        SELECT d.id, d.ts, d.symbol, d.decision, d.confidence
        FROM aladdin_decisions d
        WHERE d.ts < ? AND d.ts > ?
          AND d.confidence > ?
          AND NOT EXISTS (SELECT 1 FROM decision_outcomes o WHERE o.decision_id = d.id AND o.horizon_h = ?)
        ORDER BY d.ts ASC
        LIMIT 200
      `).all(cutoff, cutoff - windowMs, this.MIN_CONFIDENCE_TO_TRACK, horizonH);
    } catch(e) { this._stats.errors++; return; }

    if (!rows.length) return;

    // Group by symbol für effizienten price-fetch
    const bySymbol = {};
    for (const r of rows) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
      bySymbol[r.symbol].push(r);
    }

    for (const [symbol, sRows] of Object.entries(bySymbol)) {
      // Aktuellen Preis (jetzt = ts+horizon) fetchen via Bitget.priceCache
      const currentPrice = this._getCurrentPrice(symbol);
      if (!currentPrice) continue;

      for (const dRow of sRows) {
        try {
          const entryPrice = this._getPriceAtTs(symbol, dRow.ts);
          if (!entryPrice || entryPrice <= 0) continue;
          const outcomeReturn = Math.log(currentPrice / entryPrice);
          let correct = 0;
          if (dRow.decision === 'BUY' && outcomeReturn > this.DECISION_NEUTRAL_BAND) correct = 1;
          else if (dRow.decision === 'SELL' && outcomeReturn < -this.DECISION_NEUTRAL_BAND) correct = 1;
          else if (dRow.decision === 'HOLD' && Math.abs(outcomeReturn) < this.DECISION_NEUTRAL_BAND) correct = 1;

          this._db.prepare(`INSERT OR IGNORE INTO decision_outcomes
            (decision_id, decision_ts, symbol, decision, confidence, entry_price, horizon_h, outcome_price, outcome_return, direction_correct, scored_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            dRow.id, dRow.ts, dRow.symbol, dRow.decision, dRow.confidence,
            entryPrice, horizonH, currentPrice, outcomeReturn, correct, Date.now()
          );
          if (horizonH === 1) this._stats.scored_1h++;
          else if (horizonH === 4) this._stats.scored_4h++;
          else if (horizonH === 24) this._stats.scored_24h++;
        } catch(_) { this._stats.errors++; }
      }
    }
  },

  // ─── Price-Lookup-Helper ───────────────────────────────────────
  _getCurrentPrice(symbol) {
    try {
      if (this._Bitget && this._Bitget.priceCache && this._Bitget.priceCache[symbol]) {
        return this._Bitget.priceCache[symbol].last;
      }
    } catch(_) {}
    return null;
  },

  _getPriceAtTs(symbol, targetTs) {
    // Aus candle_cache: nächste 1h-Kerze um targetTs
    try {
      const row = this._db.prepare(`
        SELECT close FROM candle_cache
        WHERE symbol = ? AND granularity = '1h'
          AND ts BETWEEN ? AND ?
        ORDER BY ABS(ts - ?) ASC
        LIMIT 1
      `).get(symbol, targetTs - 90 * 60 * 1000, targetTs + 90 * 60 * 1000, targetTs);
      return row ? row.close : null;
    } catch(_) { return null; }
  },

  // ─── D5 [23.05.2026] CACHED single-value Accuracy für Brain confidence-multiplier ───────
  // Liefert overall accuracy (0..1) als Single-Number, 5min-Cache (matched cron interval).
  // Default 0.5 wenn keine Daten — neutral, kein Damping.
  _accCache: { value: 0.5, ts: 0, n: 0 },
  _ACC_CACHE_TTL_MS: 300000,  // 5min
  getOverallAccuracy(horizonH = 1, lookbackHours = 24) {
    const now = Date.now();
    if (this._accCache.ts && (now - this._accCache.ts) < this._ACC_CACHE_TTL_MS) {
      return this._accCache;
    }
    let result = { value: 0.5, ts: now, n: 0 };
    try {
      if (!this._db) return result;
      const since = now - lookbackHours * 3600 * 1000;
      const r = this._db.prepare(`
        SELECT COUNT(*) n, AVG(direction_correct) acc
        FROM decision_outcomes
        WHERE horizon_h = ? AND decision_ts > ?
      `).get(horizonH, since);
      if (r && r.n > 0) {
        result = { value: Number(r.acc) || 0.5, ts: now, n: r.n };
      }
    } catch(_) {}
    this._accCache = result;
    return result;
  },

  // ─── Accuracy-Stats ────────────────────────────────────────────
  accuracySummary(horizonH, lookbackHours = 168) {
    if (!this._db) return null;
    const since = Date.now() - lookbackHours * 3600 * 1000;
    try {
      const r = this._db.prepare(`
        SELECT
          decision,
          COUNT(*) as n,
          ROUND(AVG(direction_correct) * 100, 2) as accuracy_pct,
          ROUND(AVG(outcome_return) * 100, 4) as avg_return_pct,
          ROUND(SUM(CASE WHEN direction_correct = 1 THEN outcome_return ELSE -outcome_return END) * 100, 4) as edge_pct
        FROM decision_outcomes
        WHERE horizon_h = ? AND decision_ts > ?
        GROUP BY decision
      `).all(horizonH, since);
      return r;
    } catch(e) { return { error: e.message }; }
  },

  startCron() {
    if (this._cronTimer) return;
    setTimeout(() => this.scoreDue(), 90000);  // First nach 90s
    this._cronTimer = setInterval(() => this.scoreDue(), 5 * 60 * 1000);  // alle 5 min
    try { this._logFn.info && this._logFn.info('OUTCOME', 'cron started (5min interval)'); } catch(_) {}
  },

  snapshot() {
    let totals = {};
    try {
      const r = this._db.prepare(`SELECT horizon_h, COUNT(*) as n, ROUND(AVG(direction_correct)*100,2) as acc_pct
        FROM decision_outcomes GROUP BY horizon_h`).all();
      for (const x of r) totals['h'+x.horizon_h] = { n: x.n, acc_pct: x.acc_pct };
    } catch(_) {}
    return { ...this._stats, totals, windows_hours: this.WINDOWS_HOURS, neutral_band: this.DECISION_NEUTRAL_BAND };
  },
};

module.exports = DecisionOutcomeTracker;
