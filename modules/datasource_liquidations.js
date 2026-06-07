// modules/datasource_liquidations.js — ECHTE Liquidations via Binance WebSocket
// AUDFIX_LIQ_REAL [2026-05-18]
//
// Vorher: OI-Delta-Proxy (Phase 1 heute Mittag)
// Jetzt: Binance Futures forceOrder@arr WebSocket Stream (public, kein API-Key)
// Fallback: OI-Proxy wenn WS down
//
// BRAIN-SCHUTZZONE: Score-Berechnung wird nur ersetzt (besser kalibriert),
// Aggregations-Logik bleibt im Brain unangetastet.

'use strict';

const WebSocket = require('ws');
const axios = require('axios');

const DataSourceLiquidations = {
  _ws: null,
  _wsConnected: false,
  _reconnectTimer: null,
  _reconnectDelay: 5000,
  _MAX_DELAY: 60000,

  _liqEvents: [],          // Rolling 30-Min-Buffer
  _buckets: new Map(),     // symbol → [{bucketStart, longLiqUsd, shortLiqUsd, count, maxSingle}]
  BUCKET_MS: 5 * 60 * 1000, // 5-min Buckets
  MAX_BUCKETS: 24,          // 24 × 5min = 2h Historie

  _cache: new Map(),       // symbol → { ts, payload }
  TTL_MS: 30 * 1000,        // 30s Cache pro Symbol

  _db: null,
  _oiHistoryFallback: new Map(), // Fallback wenn WS down

  init(db) {
    this._db = db;
    this.connect();
  },

  connect() {
    if (this._ws) {
      try { this._ws.close(); } catch(_) {}
    }
    try {
      this._ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
      this._ws.on('open', () => {
        this._wsConnected = true;
        this._reconnectDelay = 5000;
        try { if (typeof Log !== 'undefined') Log.info('LIQ', 'WS connected to Binance forceOrder stream'); } catch(_){}
      });
      this._ws.on('message', (data) => this._handleMessage(data));
      this._ws.on('error', (err) => {
        try { if (typeof Log !== 'undefined') Log.warn('LIQ', 'WS error: ' + err.message); } catch(_){}
      });
      this._ws.on('close', () => {
        this._wsConnected = false;
        try { if (typeof Log !== 'undefined') Log.warn('LIQ', 'WS closed, reconnecting in ' + this._reconnectDelay + 'ms'); } catch(_){}
        this._scheduleReconnect();
      });
    } catch(e) {
      try { if (typeof Log !== 'undefined') Log.warn('LIQ', 'WS connect fail: ' + e.message); } catch(_){}
      this._scheduleReconnect();
    }
  },

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._MAX_DELAY);
      this.connect();
    }, this._reconnectDelay);
  },

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch(_) { return; }
    if (!msg || msg.e !== 'forceOrder' || !msg.o) return;
    const o = msg.o;
    const symbol = o.s;
    const side = o.S; // BUY = short-liq, SELL = long-liq (FORCED)
    const price = parseFloat(o.ap || o.p || 0);
    const qty = parseFloat(o.q || 0);
    const liqUSD = price * qty;
    if (!isFinite(liqUSD) || liqUSD <= 0) return;

    const ts = msg.E || Date.now();
    const ev = { ts, symbol, side, price, qty, liqUSD };
    this._liqEvents.push(ev);
    // Rolling 30-Min-Buffer
    const cutoff = Date.now() - 30 * 60 * 1000;
    while (this._liqEvents.length > 0 && this._liqEvents[0].ts < cutoff) this._liqEvents.shift();

    // Bucket aktualisieren
    this._aggregateBucket(symbol, ev);

    // Persist (rate-limited: nur große Events oder 1-pro-Minute Sample)
    if (this._db && liqUSD > 100000) {
      try {
        this._db.prepare(`INSERT INTO liquidations_24h (ts, symbol, side, price, qty, liq_usd, source)
          VALUES (?, ?, ?, ?, ?, ?, 'binance_ws')`).run(ts, symbol, side, price, qty, liqUSD);
      } catch(_) {}
    }
  },

  _aggregateBucket(symbol, ev) {
    const bucketStart = Math.floor(ev.ts / this.BUCKET_MS) * this.BUCKET_MS;
    let arr = this._buckets.get(symbol) || [];
    let bucket = arr.find(b => b.bucketStart === bucketStart);
    if (!bucket) {
      bucket = { bucketStart, longLiqUsd: 0, shortLiqUsd: 0, count: 0, maxSingle: 0 };
      arr.push(bucket);
      arr.sort((a,b) => a.bucketStart - b.bucketStart);
      if (arr.length > this.MAX_BUCKETS) arr = arr.slice(-this.MAX_BUCKETS);
      this._buckets.set(symbol, arr);
    }
    // SELL = long position got liquidated (forced sell)
    // BUY = short position got liquidated (forced buy)
    if (ev.side === 'SELL') bucket.longLiqUsd += ev.liqUSD;
    else bucket.shortLiqUsd += ev.liqUSD;
    bucket.count++;
    if (ev.liqUSD > bucket.maxSingle) bucket.maxSingle = ev.liqUSD;
  },

  _scoreFromBuckets(symbol) {
    const arr = this._buckets.get(symbol) || [];
    if (arr.length === 0) return null;
    // Letzten 1-2 Buckets (5-10 Min)
    const recent = arr.slice(-2);
    const totalLong = recent.reduce((s,b) => s + b.longLiqUsd, 0);
    const totalShort = recent.reduce((s,b) => s + b.shortLiqUsd, 0);
    const total = totalLong + totalShort;
    const maxSingle = Math.max(...recent.map(b => b.maxSingle));

    let signal = 'NEUTRAL', score = 0, confidence = 0.5, reason = '';
    // AUDFIX_HYPEROPT_P1 [2026-05-18]: Schwellen 5M→10M, 20M→50M (weniger Fehlalarme)
    // Cascade-Detection
    if (total > 50e6) {
      // Severe
      if (totalLong > totalShort * 1.5) {
        signal = 'CASCADE_SEVERE_LONG'; score = -0.70; confidence = 0.85;
        reason = `Long-Cascade SEVERE ${(totalLong/1e6).toFixed(1)}M USD in 10min`;
      } else if (totalShort > totalLong * 1.5) {
        signal = 'CASCADE_SEVERE_SHORT'; score = 0.55; confidence = 0.80;
        reason = `Short-Squeeze SEVERE ${(totalShort/1e6).toFixed(1)}M USD in 10min`;
      } else {
        signal = 'CASCADE_BOTH'; score = -0.30; confidence = 0.7;
        reason = `Severe Volatility both sides ${(total/1e6).toFixed(1)}M USD`;
      }
    } else if (total > 10e6) {
      // Moderate
      if (totalLong > totalShort * 1.5) {
        signal = 'CASCADE_LONG'; score = -0.50; confidence = 0.7;
        reason = `Long-Liquidations ${(totalLong/1e6).toFixed(1)}M USD`;
      } else if (totalShort > totalLong * 1.5) {
        signal = 'CASCADE_SHORT'; score = 0.40; confidence = 0.65;
        reason = `Short-Liquidations ${(totalShort/1e6).toFixed(1)}M USD`;
      } else {
        signal = 'MODERATE_BOTH'; score = -0.15; confidence = 0.5;
        reason = `Moderate liquidations ${(total/1e6).toFixed(1)}M USD`;
      }
    } else if (total > 0) {
      signal = 'LOW'; score = 0; confidence = 0.4;
      reason = `Low liq ${(total/1e3).toFixed(0)}k USD`;
    } else {
      signal = 'NONE'; score = 0; confidence = 0.3;
      reason = 'no recent liquidations';
    }
    return { signal, score, confidence, reason, totalLong, totalShort, maxSingle, bucketsCount: arr.length };
  },

  async getSignal(symbol) {
    symbol = symbol || 'BTCUSDT';
    const cached = this._cache.get(symbol);
    if (cached && Date.now() - cached.ts < this.TTL_MS) return cached.payload;

    let payload;
    const fromWS = this._wsConnected ? this._scoreFromBuckets(symbol) : null;
    if (fromWS) {
      const dir = fromWS.score > 0.1 ? 'BUY' : fromWS.score < -0.1 ? 'SELL' : 'NEUTRAL';
      payload = { direction: dir, score: fromWS.score, confidence: fromWS.confidence,
        reason: fromWS.reason, signal: fromWS.signal,
        totalLongUsd: fromWS.totalLong, totalShortUsd: fromWS.totalShort,
        source: 'binance_ws' };
    } else {
      // Fallback: OI-Proxy (alter Code)
      payload = await this._fallbackOIProxy(symbol);
    }
    this._cache.set(symbol, { ts: Date.now(), payload });
    return payload;
  },

  async _fallbackOIProxy(symbol) {
    try {
      const url = `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`;
      const r = await axios.get(url, { timeout: 5000 });
      const d = r.data?.data?.[0];
      if (!d) return { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'API_FAIL', source: 'fallback' };
      const oi = parseFloat(d.holdingAmount || 0);
      const price = parseFloat(d.lastPr || 0);
      let hist = this._oiHistoryFallback.get(symbol) || [];
      hist.push({ ts: Date.now(), oi, price });
      if (hist.length > 24) hist = hist.slice(-24);
      this._oiHistoryFallback.set(symbol, hist);
      if (hist.length < 3) return { direction: 'NEUTRAL', score: 0, confidence: 0.2, reason: 'PROXY_INIT', source: 'fallback_oi_proxy' };
      // OI-Drop + Price-Drop = Long-Cascade (alter Algorithmus)
      const oldest = hist[0];
      const newest = hist[hist.length-1];
      const oiPct = (newest.oi - oldest.oi) / Math.max(1, oldest.oi);
      const pricePct = (newest.price - oldest.price) / Math.max(1, oldest.price);
      let direction = 'NEUTRAL', score = 0, confidence = 0.4, reason = 'STABLE';
      if (oiPct < -0.02 && pricePct < -0.005) { direction = 'SELL'; score = -0.5; confidence = 0.6; reason = 'OI-DROP+PRICE-DROP=LONG-CASCADE'; }
      else if (oiPct < -0.02 && pricePct > 0.005) { direction = 'BUY'; score = 0.4; confidence = 0.55; reason = 'SHORT-SQUEEZE'; }
      return { direction, score, confidence, reason, source: 'fallback_oi_proxy' };
    } catch(e) { return { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'API_FAIL: '+e.message.slice(0,30), source: 'fallback' }; }
  },

  snapshot() {
    const out = {};
    for (const [s, arr] of this._buckets.entries()) {
      const latest = arr[arr.length-1];
      out[s] = { buckets: arr.length, latest, totalEvents24h: arr.reduce((s,b)=>s+b.count, 0) };
    }
    return {
      wsConnected: this._wsConnected,
      eventsBuffered: this._liqEvents.length,
      symbols: Object.keys(out).length,
      data: out,
    };
  },
};

module.exports = DataSourceLiquidations;
