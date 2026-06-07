// modules/orderbook_snapshots.js — Order-Book-Snapshots-Historie (STUFE 8)
// Verankert 2026-05-20 (Boutique-Quant-A Niveau).
//
// Persistiert OB-Bid/Ask-Snapshots (Top-5 Levels + Depth-Sums) als Time-Series in DB.
// Enables:
//   - Order-Flow-Imbalance-Historie für Microstructure-Familie
//   - Slippage-Calibration (post-trade-Comparison)
//   - Liquidity-Trend-Detection
//   - Market-Impact-Modelling
//
// Schema (orderbook_history): {
//   ts, symbol,
//   bid1_p, bid1_q, ..., bid5_p, bid5_q,    -- Top 5 bid levels
//   ask1_p, ask1_q, ..., ask5_p, ask5_q,    -- Top 5 ask levels
//   bid_depth_top5, ask_depth_top5,         -- summe quantities top-5
//   imbalance,                              -- (bidQ - askQ) / (bidQ + askQ) ∈ [-1, +1]
//   spread, mid_price
// }
//
// Retention: 7 Tage (configurable). Auto-Prune im Cron.

'use strict';

const OrderbookSnapshots = {
  _db: null,
  _Bitget: null,
  _logFn: null,
  _cronTimer: null,
  _pruneTimer: null,
  _insertStmt: null,
  _stats: { snapshots: 0, errors: 0, last_ts: 0 },
  RETENTION_DAYS: 7,
  // FIX 19 [26.05.2026 / B15-2]: 3 → 20 Symbole für MICROSTRUCTURE-Familie volle Coverage.
  // Bitget-API Rate-Limit: 20 req/sec. Cron alle 30s → 20 calls / 30s = 0.67 req/sec — sicher unter Limit.
  // Storage: 20 × 30s × 86400s/day × 7d = ~404k rows × 32 cols, ~120 MB für 7d retention.
  // FIX 27 [26.05.2026 / Bug 19a]: MATICUSDT → POLUSDT (MATIC removed bei Bitget per curl 40309)
  TRACKED_SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'NEARUSDT', 'SUIUSDT', 'ATOMUSDT', 'OPUSDT', 'UNIUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'POLUSDT', 'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'ARBUSDT', 'SEIUSDT', 'APTUSDT'],

  init(db, bitgetClient) {
    this._db = db;
    this._Bitget = bitgetClient;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS orderbook_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          bid1_p REAL, bid1_q REAL,
          bid2_p REAL, bid2_q REAL,
          bid3_p REAL, bid3_q REAL,
          bid4_p REAL, bid4_q REAL,
          bid5_p REAL, bid5_q REAL,
          ask1_p REAL, ask1_q REAL,
          ask2_p REAL, ask2_q REAL,
          ask3_p REAL, ask3_q REAL,
          ask4_p REAL, ask4_q REAL,
          ask5_p REAL, ask5_q REAL,
          bid_depth_top5 REAL,
          ask_depth_top5 REAL,
          imbalance REAL,
          spread REAL,
          mid_price REAL
        );
        CREATE INDEX IF NOT EXISTS idx_obh_ts ON orderbook_history(ts);
        CREATE INDEX IF NOT EXISTS idx_obh_sym_ts ON orderbook_history(symbol, ts);
      `);
      this._insertStmt = db.prepare(`INSERT INTO orderbook_history (
        ts, symbol,
        bid1_p, bid1_q, bid2_p, bid2_q, bid3_p, bid3_q, bid4_p, bid4_q, bid5_p, bid5_q,
        ask1_p, ask1_q, ask2_p, ask2_q, ask3_p, ask3_q, ask4_p, ask4_q, ask5_p, ask5_q,
        bid_depth_top5, ask_depth_top5, imbalance, spread, mid_price
      ) VALUES (?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?)`);
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('OB_HIST', 'init fail: ' + e.message); } catch(_){}
    }
  },

  // ─── Persist single OB-Snapshot ──────────────────────────────────
  persist(symbol, ob) {
    if (!this._db || !this._insertStmt) return false;
    if (!ob || !Array.isArray(ob.bids) || !Array.isArray(ob.asks)) return false;
    if (ob.bids.length < 1 || ob.asks.length < 1) return false;

    try {
      const bids = ob.bids.slice(0, 5);
      const asks = ob.asks.slice(0, 5);
      const bid_depth = bids.reduce((s, b) => s + parseFloat(b[1] || 0), 0);
      const ask_depth = asks.reduce((s, a) => s + parseFloat(a[1] || 0), 0);
      const sumDepth = bid_depth + ask_depth;
      const imbalance = sumDepth > 0 ? (bid_depth - ask_depth) / sumDepth : 0;
      const bid1 = parseFloat(bids[0][0]);
      const ask1 = parseFloat(asks[0][0]);
      const spread = isFinite(bid1) && isFinite(ask1) ? ask1 - bid1 : 0;
      const mid_price = isFinite(bid1) && isFinite(ask1) ? (bid1 + ask1) / 2 : 0;

      const args = [Date.now(), symbol];
      for (let i = 0; i < 5; i++) {
        args.push(bids[i] ? parseFloat(bids[i][0]) : null);
        args.push(bids[i] ? parseFloat(bids[i][1]) : null);
      }
      for (let i = 0; i < 5; i++) {
        args.push(asks[i] ? parseFloat(asks[i][0]) : null);
        args.push(asks[i] ? parseFloat(asks[i][1]) : null);
      }
      args.push(bid_depth, ask_depth, parseFloat(imbalance.toFixed(6)), spread, mid_price);
      this._insertStmt.run(...args);
      this._stats.snapshots++;
      this._stats.last_ts = Date.now();
      return true;
    } catch(e) {
      this._stats.errors++;
      return false;
    }
  },

  // ─── Brain-API: Imbalance über Time-Window ───────────────────────
  // Output: { direction, score, confidence, imbalance_avg, samples }
  getImbalanceSignal(symbol, windowMs = 5 * 60 * 1000) {
    if (!this._db) return { direction: 'NEUTRAL', score: 0, confidence: 0, samples: 0 };
    try {
      const rows = this._db.prepare(`
        SELECT imbalance, bid_depth_top5, ask_depth_top5
        FROM orderbook_history
        WHERE symbol = ? AND ts > ?
        ORDER BY ts DESC
        LIMIT 200
      `).all(symbol, Date.now() - windowMs);
      if (!rows || rows.length < 3) return { direction: 'NEUTRAL', score: 0, confidence: 0, samples: rows.length };

      const avgImb = rows.reduce((s, r) => s + (r.imbalance || 0), 0) / rows.length;
      // Score-Stufen:
      let direction = 'NEUTRAL', score = 0, confidence = 0;
      if (avgImb > 0.20) { direction = 'BUY'; score = Math.min(0.6, avgImb * 1.5); confidence = Math.min(0.75, 0.4 + Math.abs(avgImb)); }
      else if (avgImb > 0.05) { direction = 'BUY'; score = avgImb * 1.0; confidence = 0.4; }
      else if (avgImb < -0.20) { direction = 'SELL'; score = Math.max(-0.6, avgImb * 1.5); confidence = Math.min(0.75, 0.4 + Math.abs(avgImb)); }
      else if (avgImb < -0.05) { direction = 'SELL'; score = avgImb * 1.0; confidence = 0.4; }
      else { direction = 'NEUTRAL'; score = 0; confidence = 0.3; }

      return {
        direction, score: parseFloat(score.toFixed(4)), confidence: parseFloat(confidence.toFixed(3)),
        imbalance_avg: parseFloat(avgImb.toFixed(4)), samples: rows.length, window_ms: windowMs,
      };
    } catch(e) {
      return { direction: 'NEUTRAL', score: 0, confidence: 0, samples: 0, error: e.message };
    }
  },

  // ─── History-Query für API ───────────────────────────────────────
  getHistory(symbol, windowMs = 60 * 60 * 1000, limit = 1000) {
    if (!this._db) return [];
    try {
      return this._db.prepare(`
        SELECT ts, symbol, bid1_p, ask1_p, bid_depth_top5, ask_depth_top5, imbalance, spread, mid_price
        FROM orderbook_history
        WHERE symbol = ? AND ts > ?
        ORDER BY ts DESC
        LIMIT ?
      `).all(symbol, Date.now() - windowMs, Math.min(limit, 10000));
    } catch(e) { return []; }
  },

  // ─── Cron: snapshot alle 30s + prune täglich ─────────────────────
  startCron() {
    if (this._cronTimer) return;
    const tick = async () => {
      if (!this._Bitget || typeof this._Bitget.fetchOrderbook !== 'function') return;
      for (const sym of this.TRACKED_SYMBOLS) {
        try {
          const ob = await this._Bitget.fetchOrderbook(sym);
          if (ob) this.persist(sym, ob);
        } catch(_) { this._stats.errors++; }
      }
    };
    // First tick nach 20s (Bot-Boot-Stabilität)
    setTimeout(tick, 20000);
    this._cronTimer = setInterval(tick, 30000);
    // Prune täglich
    this._pruneTimer = setInterval(() => this.prune(), 24 * 3600 * 1000);
    setTimeout(() => this.prune(), 60 * 60 * 1000);  // 1h nach Boot
    try { this._logFn.info && this._logFn.info('OB_HIST', `cron started (30s, ${this.TRACKED_SYMBOLS.length} symbols, retention ${this.RETENTION_DAYS}d)`); } catch(_) {}
  },

  stopCron() {
    if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; }
    if (this._pruneTimer) { clearInterval(this._pruneTimer); this._pruneTimer = null; }
  },

  prune() {
    if (!this._db) return 0;
    const cutoff = Date.now() - this.RETENTION_DAYS * 24 * 3600 * 1000;
    try {
      const r = this._db.prepare(`DELETE FROM orderbook_history WHERE ts < ?`).run(cutoff);
      try { this._logFn.info && this._logFn.info('OB_HIST', `pruned ${r.changes} rows older than ${this.RETENTION_DAYS}d`); } catch(_) {}
      return r.changes;
    } catch(_) { return 0; }
  },

  snapshot() {
    let count = 0, oldest = null, newest = null;
    try {
      if (this._db) {
        const r = this._db.prepare(`SELECT COUNT(*) as n, MIN(ts) as oldest, MAX(ts) as newest FROM orderbook_history`).get();
        count = r.n; oldest = r.oldest; newest = r.newest;
      }
    } catch(_) {}
    return {
      ...this._stats,
      tracked_symbols: this.TRACKED_SYMBOLS,
      retention_days: this.RETENTION_DAYS,
      total_rows: count,
      oldest_ts: oldest,
      newest_ts: newest,
    };
  },
};

module.exports = OrderbookSnapshots;
