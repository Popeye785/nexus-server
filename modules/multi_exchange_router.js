// modules/multi_exchange_router.js — Smart Order Routing PAPER-Mode (STUFE 9)
// Verankert 2026-05-20 (Boutique-Quant-A).
//
// Vergleicht Bid/Ask-Preise zwischen 5 Exchanges (Bitget + Binance + Bybit + OKX + Kraken).
// Identifiziert "best venue" pro Side (BUY uses lowest ask, SELL uses highest bid).
// PAPER-MODE: NUR Logging, kein actual order-routing. Live-Bot bleibt Bitget-only.
// Wird in STUFE 9-phase-2 für LIVE-Routing aktiviert (nach Compliance/KYC für alle exchanges).
//
// Output:
//   getBestVenue(symbol, side) → { exchange, price, edge_bps, prices: {...} }
//   edge_bps = (price_diff_to_bitget * 10000) — wieviele Basispunkte besser als Bitget
//
// DB: best_route_log persistiert jeden compare-run.

'use strict';

const axios = require('axios');

const MultiExchangeRouter = {
  _db: null,
  _logFn: null,
  _cronTimer: null,
  _cache: {},  // symbol → { prices: {...}, ts }
  TTL_MS: 15 * 1000,
  TRACKED_SYMBOLS: ['BTCUSDT', 'ETHUSDT'],
  _stats: { compares: 0, edges_logged: 0, errors: 0, last_run_ts: 0 },

  init(db) {
    this._db = db;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS best_route_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          best_exchange TEXT NOT NULL,
          best_price REAL,
          bitget_price REAL,
          edge_bps REAL,
          prices_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_brl_ts ON best_route_log(ts);
        CREATE INDEX IF NOT EXISTS idx_brl_sym_ts ON best_route_log(symbol, ts);
      `);
      try { this._logFn.info && this._logFn.info('SOR', 'initialized (PAPER mode, 5 exchanges, 2 symbols)'); } catch(_) {}
    } catch(_) {}
  },

  // ─── Exchange-Symbol-Mapping ─────────────────────────────────────
  _mapSymbol(exchange, sym) {
    const base = sym.replace('USDT', '');
    switch (exchange) {
      case 'bitget':  return sym;
      case 'binance': return sym;
      case 'bybit':   return sym;
      case 'okx':     return `${base}-USDT`;
      case 'kraken': {
        // Kraken uses XBT for Bitcoin
        const kbase = base === 'BTC' ? 'XBT' : base;
        return `X${kbase}ZUSD`;
      }
      default: return sym;
    }
  },

  // ─── Fetcher: best bid/ask pro Exchange ──────────────────────────
  async _fetchBitget(sym) {
    try {
      const r = await axios.get(`https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${sym}&limit=1`, { timeout: 4000 });
      const d = r.data?.data;
      const bid = parseFloat(d?.bids?.[0]?.[0]);
      const ask = parseFloat(d?.asks?.[0]?.[0]);
      return isFinite(bid) && isFinite(ask) ? { bid, ask } : null;
    } catch(_) { return null; }
  },
  async _fetchBinance(sym) {
    try {
      const r = await axios.get(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=5`, { timeout: 4000 });
      const bid = parseFloat(r.data?.bids?.[0]?.[0]);
      const ask = parseFloat(r.data?.asks?.[0]?.[0]);
      return isFinite(bid) && isFinite(ask) ? { bid, ask } : null;
    } catch(_) { return null; }
  },
  async _fetchBybit(sym) {
    try {
      const r = await axios.get(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${sym}&limit=1`, { timeout: 4000 });
      const d = r.data?.result;
      const bid = parseFloat(d?.b?.[0]?.[0]);
      const ask = parseFloat(d?.a?.[0]?.[0]);
      return isFinite(bid) && isFinite(ask) ? { bid, ask } : null;
    } catch(_) { return null; }
  },
  async _fetchOKX(sym) {
    try {
      const m = this._mapSymbol('okx', sym);
      const r = await axios.get(`https://www.okx.com/api/v5/market/books?instId=${m}&sz=1`, { timeout: 4000 });
      const d = r.data?.data?.[0];
      const bid = parseFloat(d?.bids?.[0]?.[0]);
      const ask = parseFloat(d?.asks?.[0]?.[0]);
      return isFinite(bid) && isFinite(ask) ? { bid, ask } : null;
    } catch(_) { return null; }
  },
  async _fetchKraken(sym) {
    try {
      const m = this._mapSymbol('kraken', sym);
      const r = await axios.get(`https://api.kraken.com/0/public/Depth?pair=${m}&count=1`, { timeout: 4000 });
      const keys = Object.keys(r.data?.result || {});
      if (!keys.length) return null;
      const d = r.data.result[keys[0]];
      const bid = parseFloat(d?.bids?.[0]?.[0]);
      const ask = parseFloat(d?.asks?.[0]?.[0]);
      return isFinite(bid) && isFinite(ask) ? { bid, ask } : null;
    } catch(_) { return null; }
  },

  // ─── Public: Best-Venue für Symbol+Side ──────────────────────────
  async getBestVenue(symbol, side) {
    const cached = this._cache[symbol];
    if (cached && Date.now() - cached.ts < this.TTL_MS) return this._pickBest(cached.prices, symbol, side);
    const prices = await this._gatherPrices(symbol);
    this._cache[symbol] = { prices, ts: Date.now() };
    return this._pickBest(prices, symbol, side);
  },

  async _gatherPrices(symbol) {
    const [bitget, binance, bybit, okx, kraken] = await Promise.all([
      this._fetchBitget(symbol),
      this._fetchBinance(symbol),
      this._fetchBybit(symbol),
      this._fetchOKX(symbol),
      this._fetchKraken(symbol),
    ]);
    return { bitget, binance, bybit, okx, kraken };
  },

  _pickBest(prices, symbol, side) {
    // BUY → lowest ask. SELL → highest bid.
    const isBuy = side === 'BUY' || side === 'buy';
    const valid = Object.entries(prices).filter(([_, v]) => v && isFinite(v.bid) && isFinite(v.ask));
    if (valid.length === 0) return { exchange: null, price: null, edge_bps: 0, prices };

    let best = valid[0];
    let bestPrice = isBuy ? valid[0][1].ask : valid[0][1].bid;
    for (const [ex, v] of valid) {
      const p = isBuy ? v.ask : v.bid;
      if ((isBuy && p < bestPrice) || (!isBuy && p > bestPrice)) {
        best = [ex, v]; bestPrice = p;
      }
    }
    const bitgetPrice = prices.bitget ? (isBuy ? prices.bitget.ask : prices.bitget.bid) : null;
    let edgeBps = 0;
    if (bitgetPrice && bestPrice) {
      const diff = isBuy ? (bitgetPrice - bestPrice) : (bestPrice - bitgetPrice);
      edgeBps = (diff / bitgetPrice) * 10000;
    }
    const result = {
      exchange: best[0], price: bestPrice,
      edge_bps: parseFloat(edgeBps.toFixed(2)),
      bitget_price: bitgetPrice,
      prices,
      side: isBuy ? 'BUY' : 'SELL', symbol,
    };

    // Persist nur wenn edge >= 1 bp
    if (Math.abs(edgeBps) >= 1) {
      try {
        this._db && this._db.prepare(`INSERT INTO best_route_log (ts, symbol, side, best_exchange, best_price, bitget_price, edge_bps, prices_json) VALUES (?,?,?,?,?,?,?,?)`).run(
          Date.now(), symbol, result.side, result.exchange, bestPrice, bitgetPrice, edgeBps,
          JSON.stringify(prices).slice(0, 600)
        );
        this._stats.edges_logged++;
      } catch(_) {}
    }
    return result;
  },

  // ─── Cron: ständige Compare-Runs für tracked symbols ─────────────
  startCron() {
    if (this._cronTimer) return;
    const tick = async () => {
      this._stats.compares++;
      this._stats.last_run_ts = Date.now();
      for (const sym of this.TRACKED_SYMBOLS) {
        try {
          // Beide Sides messen für vollständiges Audit
          await this.getBestVenue(sym, 'BUY');
          await this.getBestVenue(sym, 'SELL');
        } catch(_) { this._stats.errors++; }
      }
    };
    setTimeout(tick, 40000);  // First nach 40s
    this._cronTimer = setInterval(tick, 60 * 1000);  // 1min
  },

  // ─── Aggregated Audit-Stats (welche exchange wann der best war) ─
  getRecentEdges(limit = 100) {
    if (!this._db) return [];
    try {
      return this._db.prepare(`SELECT ts, symbol, side, best_exchange, best_price, bitget_price, edge_bps
        FROM best_route_log ORDER BY ts DESC LIMIT ?`).all(limit);
    } catch(_) { return []; }
  },

  getEdgeSummary(windowMs = 24 * 3600 * 1000) {
    if (!this._db) return { exchanges: {}, total: 0 };
    try {
      const rows = this._db.prepare(`SELECT best_exchange, side, COUNT(*) as n, AVG(edge_bps) as avg_edge, MAX(edge_bps) as max_edge
        FROM best_route_log WHERE ts > ?
        GROUP BY best_exchange, side`).all(Date.now() - windowMs);
      const summary = { exchanges: {}, total: 0 };
      for (const r of rows) {
        summary.total += r.n;
        if (!summary.exchanges[r.best_exchange]) summary.exchanges[r.best_exchange] = { BUY: null, SELL: null };
        summary.exchanges[r.best_exchange][r.side] = {
          count: r.n, avg_edge_bps: parseFloat((r.avg_edge||0).toFixed(2)), max_edge_bps: parseFloat((r.max_edge||0).toFixed(2)),
        };
      }
      return summary;
    } catch(_) { return { exchanges: {}, total: 0 }; }
  },

  snapshot() {
    return { ...this._stats, mode: 'PAPER', tracked_symbols: this.TRACKED_SYMBOLS, cache_ttl_s: this.TTL_MS / 1000 };
  },
};

module.exports = MultiExchangeRouter;
