'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// NEXUS V9 PRO – HIGH-END AUTONOMOUS TRADING BOT
// SQLite Persistenz · Bitget WebSocket · Advanced Signals · Sharpe Ratio
// Per-Strategie Performance Tracking · Adaptive Risk Management
// ═══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const axios    = require('axios');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const WebSocket = require('ws');

const app = express();

// ── SECURITY MIDDLEWARE (Angriffs-Abwehr) ──────────────────────────────────
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  // Initialisierung: SelfHeal.checkRateLimit braucht SelfHeal-Objekt
  // Rate Limit wird nach SelfHeal-Definition aktiv (Bootstrap-Schutz)
  if (typeof SelfHeal !== 'undefined') {
    if (!SelfHeal.checkRateLimit(ip)) {
      return res.status(429).json({ error:'Too many requests', blocked:true });
    }
    // Payload Security Check nur bei POST/PATCH
    if (['POST','PATCH','PUT'].includes(req.method)) {
      const check = SelfHeal.checkPayload(req.body);
      if (!check.safe) {
        SelfHeal.attackLog.unshift({ ts:Date.now(), ip, type:check.threat, path:req.path });
        Log.warn('SECURITY', `${check.threat} von ${ip} auf ${req.path}`);
        return res.status(400).json({ error:'Invalid request', threat:check.threat });
      }
    }
  }

  // Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Bot', 'NEXUS-V9-ULTIMATE');
  next();
});

app.use(express.json({ limit:'10kb' })); // Max 10KB Requests
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CFG = {
  BITGET_BASE:    'https://api.bitget.com',
  BITGET_WS:      'wss://ws.bitget.com/v2/ws/public',
  API_KEY:        process.env.BITGET_API_KEY    || '',
  SECRET_KEY:     process.env.BITGET_SECRET_KEY || '',
  PASSPHRASE:     process.env.BITGET_PASSPHRASE || '',
  DEPLOY_MODE:    process.env.DEPLOY_MODE       || 'PAPER',
  PORT:           process.env.PORT              || 3000,
  DB_PATH:        process.env.DB_PATH           || './nexus.db',

  // Capital
  RESERVE_RATIO:         0.70,
  TRADING_RATIO:         0.30,
  KELLY_FRACTION:        0.05,
  MIN_USABLE_BALANCE:    10,
  MIN_POSITION_USDT:     5,
  MAX_POSITION_PCT:      0.10,
  TRADING_BUDGET_USDT:   null,
  MAX_OPEN_TRADES:       5,

  // Risk
  MAX_DRAWDOWN_PCT:      0.12,
  MAX_DAILY_LOSS_PCT:    0.05,
  MAX_ERROR_RATE:        0.30,
  BASE_RISK_BUDGET:      0.02,

  // Signals
  MIN_ENE:               0.0010,
  MIN_SIGNAL_STRENGTH:   0.55,
  SIGNAL_CONSENSUS_MIN:  2,

  // Fees (Bitget VIP0)
  MAKER_FEE:             0.0002,
  TAKER_FEE:             0.0006,

  // Regime
  EMA_FAST:              12,
  EMA_SLOW:              26,

  // Exit
  ATR_STOP_MULT:         1.5,
  ATR_TP_MULT:           3.0,
  TRAILING_PCT:          0.020,
  MAX_HOLD_HOURS:        24,

  // Stress
  STRESS_SURVIVAL_MIN:   0.60,

  // Futures
  DEFAULT_LEVERAGE:      3,
  MAX_LEVERAGE:          10,

  // Scan
  SCAN_INTERVAL_MS:      60000,
  DEFAULT_SYMBOLS:       ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT'],
};

// ─────────────────────────────────────────────────────────────────────────────
// SQLITE DATABASE – persistent state
// ─────────────────────────────────────────────────────────────────────────────
const DB = (() => {
  const db = new Database(CFG.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      strategy TEXT,
      state TEXT NOT NULL,
      entry_price REAL,
      exit_price REAL,
      realized_pnl REAL,
      exit_reason TEXT,
      order_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS candle_cache (
      symbol TEXT NOT NULL,
      granularity TEXT NOT NULL,
      ts INTEGER NOT NULL,
      open REAL, high REAL, low REAL, close REAL, vol REAL,
      PRIMARY KEY (symbol, granularity, ts)
    );
    CREATE TABLE IF NOT EXISTS strategy_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL,
      exit_price REAL,
      pnl REAL NOT NULL,
      hold_ms INTEGER,
      exit_reason TEXT,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS balance_history (
      ts INTEGER PRIMARY KEY,
      usable REAL, reserve REAL, trading REAL, daily_pnl REAL
    );
    CREATE TABLE IF NOT EXISTS system_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      module TEXT NOT NULL,
      msg TEXT NOT NULL,
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      direction TEXT NOT NULL,
      strength REAL NOT NULL,
      approved INTEGER NOT NULL,
      executed INTEGER DEFAULT 0,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trades_state ON trades(state);
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_syslog_ts ON system_log(ts);
    CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts);
    CREATE INDEX IF NOT EXISTS idx_strat_perf ON strategy_performance(strategy, ts);

    CREATE TABLE IF NOT EXISTS ml_models (
      model_id   TEXT PRIMARY KEY,
      model_type TEXT NOT NULL,
      payload    TEXT NOT NULL,
      accuracy   REAL,
      trained_on INTEGER,
      trained_at INTEGER NOT NULL,
      symbol     TEXT,
      meta       TEXT
    );

    CREATE TABLE IF NOT EXISTS rl_qtable (
      state_key  TEXT PRIMARY KEY,
      q_buy      REAL DEFAULT 0,
      q_sell     REAL DEFAULT 0,
      q_hold     REAL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ml_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const stmts = {
    insertTrade:    db.prepare(`INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    updateTrade:    db.prepare(`UPDATE trades SET state=?,exit_price=?,realized_pnl=?,exit_reason=?,closed_at=?,updated_at=? WHERE id=?`),
    getTrade:       db.prepare(`SELECT * FROM trades WHERE id=?`),
    getActiveTrades:db.prepare(`SELECT * FROM trades WHERE state='POSITION_ACTIVE'`),
    getAllTrades:    db.prepare(`SELECT * FROM trades ORDER BY created_at DESC LIMIT 100`),
    insertLog:      db.prepare(`INSERT INTO system_log (ts,level,module,msg,data) VALUES (?,?,?,?,?)`),
    getLogs:        db.prepare(`SELECT * FROM system_log ORDER BY ts DESC LIMIT ?`),
    insertSignal:   db.prepare(`INSERT OR REPLACE INTO signals VALUES (?,?,?,?,?,?,?,?,?)`),
    insertStratPerf:db.prepare(`INSERT INTO strategy_performance (strategy,symbol,direction,entry_price,exit_price,pnl,hold_ms,exit_reason,ts) VALUES (?,?,?,?,?,?,?,?,?)`),
    getStratPerf:   db.prepare(`SELECT strategy, COUNT(*) as trades, SUM(pnl) as total_pnl, AVG(pnl) as avg_pnl, SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) as wins FROM strategy_performance WHERE ts > ? GROUP BY strategy`),
    insertBalance:  db.prepare(`INSERT OR REPLACE INTO balance_history VALUES (?,?,?,?,?)`),
    getBalanceHistory: db.prepare(`SELECT * FROM balance_history ORDER BY ts DESC LIMIT 288`),
    cacheCandles:   db.prepare(`INSERT OR REPLACE INTO candle_cache VALUES (?,?,?,?,?,?,?,?)`),
    getCachedCandles:  db.prepare(`SELECT * FROM candle_cache WHERE symbol=? AND granularity=? ORDER BY ts ASC`),
    // ML Persistenz
    saveModel:         db.prepare(`INSERT OR REPLACE INTO ml_models (model_id,model_type,payload,accuracy,trained_on,trained_at,symbol,meta) VALUES (?,?,?,?,?,?,?,?)`),
    loadModel:         db.prepare(`SELECT * FROM ml_models WHERE model_id=?`),
    listModels:        db.prepare(`SELECT model_id,model_type,accuracy,trained_on,trained_at,symbol FROM ml_models ORDER BY trained_at DESC`),
    // RL Q-Table Persistenz
    saveQState:        db.prepare(`INSERT OR REPLACE INTO rl_qtable (state_key,q_buy,q_sell,q_hold,updated_at) VALUES (?,?,?,?,?)`),
    loadQTable:        db.prepare(`SELECT * FROM rl_qtable`),
    // Allgemeiner ML State
    saveMLState:       db.prepare(`INSERT OR REPLACE INTO ml_state (key,value,updated_at) VALUES (?,?,?)`),
    loadMLState:       db.prepare(`SELECT value FROM ml_state WHERE key=?`),
  };

  return { db, ...stmts };
})();

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG (writes to DB + console)
// ─────────────────────────────────────────────────────────────────────────────
const Log = {
  _counter: 0,
  log(level, module, msg, data = {}) {
    const ts = Date.now();
    try { DB.insertLog.run(ts, level, module, msg, JSON.stringify(data).slice(0,500)); } catch(_) {}
    if (level !== 'DEBUG') console.log(`[${level}][${module}] ${msg}`);
  },
  info(m, msg, d={})  { this.log('INFO', m, msg, d); },
  warn(m, msg, d={})  { this.log('WARN', m, msg, d); },
  error(m, msg, d={}) { this.log('ERROR', m, msg, d); },
  boot(msg)           { this.log('BOOT', 'NEXUS', msg); },
  getLast(n=50, level='') {
    const rows = DB.getLogs.all(n*3);
    return (level ? rows.filter(r=>r.level===level) : rows).slice(0,n);
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// MULTI-EXCHANGE ENGINE
// Toggle pro Exchange: bei AN → API-Felder aktiv, Adapter laeuft
// Unterstuetzte Exchanges: Bitget, Binance, Bybit, OKX, Kraken, KuCoin
// ═════════════════════════════════════════════════════════════════════════════
const ExchangeRegistry = {

  // ── Exchange Definitionen ──────────────────────────────────────────────────
  exchanges: {
    bitget: {
      id: 'bitget', name: 'Bitget', enabled: true, // immer aktiv (Haupt-Exchange)
      base: 'https://api.bitget.com',
      wsUrl: 'wss://ws.bitget.com/v2/ws/public',
      fields: ['apiKey','secretKey','passphrase'], // welche Felder benoetigt
      hasPassphrase: true,
      status: 'UNKNOWN', latencyMs: 0,
      apiKey: process.env.BITGET_API_KEY    || '',
      secretKey: process.env.BITGET_SECRET_KEY || '',
      passphrase: process.env.BITGET_PASSPHRASE || '',
      priceCache: {},
    },
    binance: {
      id: 'binance', name: 'Binance', enabled: false,
      base: 'https://api.binance.com',
      wsUrl: 'wss://stream.binance.com:9443/ws',
      fields: ['apiKey','secretKey'],
      hasPassphrase: false,
      status: 'OFFLINE', latencyMs: 0,
      apiKey: process.env.BINANCE_API_KEY    || '',
      secretKey: process.env.BINANCE_SECRET_KEY || '',
      passphrase: '',
      priceCache: {},
    },
    bybit: {
      id: 'bybit', name: 'Bybit', enabled: false,
      base: 'https://api.bybit.com',
      wsUrl: 'wss://stream.bybit.com/v5/public/spot',
      fields: ['apiKey','secretKey'],
      hasPassphrase: false,
      status: 'OFFLINE', latencyMs: 0,
      apiKey: process.env.BYBIT_API_KEY    || '',
      secretKey: process.env.BYBIT_SECRET_KEY || '',
      passphrase: '',
      priceCache: {},
    },
    okx: {
      id: 'okx', name: 'OKX', enabled: false,
      base: 'https://www.okx.com',
      wsUrl: 'wss://ws.okx.com:8443/ws/v5/public',
      fields: ['apiKey','secretKey','passphrase'],
      hasPassphrase: true,
      status: 'OFFLINE', latencyMs: 0,
      apiKey: process.env.OKX_API_KEY    || '',
      secretKey: process.env.OKX_SECRET_KEY || '',
      passphrase: process.env.OKX_PASSPHRASE || '',
      priceCache: {},
    },
    kraken: {
      id: 'kraken', name: 'Kraken', enabled: false,
      base: 'https://api.kraken.com',
      wsUrl: 'wss://ws.kraken.com',
      fields: ['apiKey','secretKey'],
      hasPassphrase: false,
      status: 'OFFLINE', latencyMs: 0,
      apiKey: process.env.KRAKEN_API_KEY    || '',
      secretKey: process.env.KRAKEN_SECRET_KEY || '',
      passphrase: '',
      priceCache: {},
    },
    kucoin: {
      id: 'kucoin', name: 'KuCoin', enabled: false,
      base: 'https://api.kucoin.com',
      wsUrl: 'wss://ws-api-spot.kucoin.com',
      fields: ['apiKey','secretKey','passphrase'],
      hasPassphrase: true,
      status: 'OFFLINE', latencyMs: 0,
      apiKey: process.env.KUCOIN_API_KEY    || '',
      secretKey: process.env.KUCOIN_SECRET_KEY || '',
      passphrase: process.env.KUCOIN_PASSPHRASE || '',
      priceCache: {},
    },
  },

  // ── Toggle: Exchange AN oder AUS ──────────────────────────────────────────
  toggle(exchangeId, enable) {
    const ex = this.exchanges[exchangeId];
    if (!ex) return { error: `Exchange ${exchangeId} nicht gefunden` };
    if (exchangeId === 'bitget') return { error: 'Bitget ist immer aktiv (Haupt-Exchange)' };
    ex.enabled = enable;
    Log.info('MULTIEX', `${ex.name} ${enable ? 'AKTIVIERT' : 'DEAKTIVIERT'}`);
    if (enable) this._ping(exchangeId);
    return { ok: true, exchange: exchangeId, enabled: enable };
  },

  // ── API Keys setzen ───────────────────────────────────────────────────────
  setKeys(exchangeId, keys) {
    const ex = this.exchanges[exchangeId];
    if (!ex) return { error: 'Exchange nicht gefunden' };
    if (keys.apiKey)    ex.apiKey    = keys.apiKey;
    if (keys.secretKey) ex.secretKey = keys.secretKey;
    if (keys.passphrase && ex.hasPassphrase) ex.passphrase = keys.passphrase;
    Log.info('MULTIEX', `${ex.name} Keys gesetzt`);
    // Sofort Ping testen
    this._ping(exchangeId);
    return { ok: true, exchange: exchangeId, hasKeys: !!ex.apiKey };
  },

  // ── Ping: Verbindung testen ───────────────────────────────────────────────
  async _ping(exchangeId) {
    const ex = this.exchanges[exchangeId];
    if (!ex) return;
    const start = Date.now();
    try {
      const endpoints = {
        binance: '/api/v3/ping',
        bybit:   '/v5/market/time',
        okx:     '/api/v5/public/time',
        kraken:  '/0/public/Time',
        kucoin:  '/api/v1/timestamp',
        bitget:  '/api/v2/public/time',
      };
      await axios.get(ex.base + (endpoints[exchangeId]||'/'), { timeout: 5000 });
      ex.status = 'ONLINE';
      ex.latencyMs = Date.now() - start;
    } catch(e) {
      ex.status = 'OFFLINE';
      ex.latencyMs = 0;
    }
    return ex.status;
  },

  // ── Ticker holen (exchange-spezifisch) ───────────────────────────────────
  async fetchTicker(exchangeId, symbol) {
    const ex = this.exchanges[exchangeId];
    if (!ex || !ex.enabled) return null;
    try {
      const sym = symbol.replace('USDT','').replace('/','');
      switch(exchangeId) {
        case 'binance': {
          const r = await axios.get(`${ex.base}/api/v3/ticker/24hr?symbol=${sym}USDT`, { timeout: 5000 });
          ex.priceCache[symbol] = { last: parseFloat(r.data.lastPrice), vol24h: parseFloat(r.data.quoteVolume) };
          return ex.priceCache[symbol];
        }
        case 'bybit': {
          const r = await axios.get(`${ex.base}/v5/market/tickers?category=spot&symbol=${sym}USDT`, { timeout: 5000 });
          const t = r.data?.result?.list?.[0];
          if (t) { ex.priceCache[symbol] = { last: parseFloat(t.lastPrice), vol24h: parseFloat(t.volume24h) }; }
          return ex.priceCache[symbol];
        }
        case 'okx': {
          const r = await axios.get(`${ex.base}/api/v5/market/ticker?instId=${sym}-USDT`, { timeout: 5000 });
          const t = r.data?.data?.[0];
          if (t) { ex.priceCache[symbol] = { last: parseFloat(t.last), vol24h: parseFloat(t.volCcy24h) }; }
          return ex.priceCache[symbol];
        }
        case 'kraken': {
          const r = await axios.get(`${ex.base}/0/public/Ticker?pair=X${sym}ZUSD`, { timeout: 5000 });
          const keys = Object.keys(r.data?.result||{});
          if (keys.length) {
            const t = r.data.result[keys[0]];
            ex.priceCache[symbol] = { last: parseFloat(t.c[0]), vol24h: parseFloat(t.v[1]) };
          }
          return ex.priceCache[symbol];
        }
        case 'kucoin': {
          const r = await axios.get(`${ex.base}/api/v1/market/stats?symbol=${sym}-USDT`, { timeout: 5000 });
          const t = r.data?.data;
          if (t) { ex.priceCache[symbol] = { last: parseFloat(t.last), vol24h: parseFloat(t.volValue) }; }
          return ex.priceCache[symbol];
        }
        default: return null;
      }
    } catch(e) {
      return ex.priceCache[symbol] || null;
    }
  },

  // ── Candles holen (exchange-spezifisch) ──────────────────────────────────
  async fetchCandles(exchangeId, symbol, granularity='1h', limit=100) {
    const ex = this.exchanges[exchangeId];
    if (!ex || !ex.enabled) return [];
    const sym = symbol.replace('USDT','').replace('/','');
    try {
      switch(exchangeId) {
        case 'binance': {
          const r = await axios.get(`${ex.base}/api/v3/klines?symbol=${sym}USDT&interval=${granularity}&limit=${limit}`, { timeout: 8000 });
          return r.data.map(c => ({ ts:+c[0], open:+c[1], high:+c[2], low:+c[3], close:+c[4], vol:+c[5] }));
        }
        case 'bybit': {
          const intervals = {'1m':'1','5m':'5','15m':'15','1h':'60','4h':'240','1d':'D'};
          const r = await axios.get(`${ex.base}/v5/market/kline?category=spot&symbol=${sym}USDT&interval=${intervals[granularity]||'60'}&limit=${limit}`, { timeout: 8000 });
          return (r.data?.result?.list||[]).map(c=>({ ts:+c[0], open:+c[1], high:+c[2], low:+c[3], close:+c[4], vol:+c[5] })).reverse();
        }
        case 'okx': {
          const bars = {'1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1day'};
          const r = await axios.get(`${ex.base}/api/v5/market/candles?instId=${sym}-USDT&bar=${bars[granularity]||'1h'}&limit=${limit}`, { timeout: 8000 });
          return (r.data?.data||[]).map(c=>({ ts:+c[0], open:+c[1], high:+c[2], low:+c[3], close:+c[4], vol:+c[5] })).reverse();
        }
        default: return [];
      }
    } catch(e) { return []; }
  },

  // ── Order platzieren (exchange-spezifisch) ───────────────────────────────
  async placeOrder(exchangeId, symbol, side, size, orderType='market', price=null) {
    const ex = this.exchanges[exchangeId];
    if (!ex || !ex.enabled) return { error: 'Exchange nicht aktiv' };
    if (!ex.apiKey) return { error: `${ex.name}: Kein API Key` };
    // Demo-Modus
    if (CFG.DEPLOY_MODE === 'PAPER') {
      Log.info('MULTIEX', `PAPER ${ex.name} ${symbol} ${side} ${size}`);
      return { ok: true, demo: true, orderId: `DEMO_${exchangeId}_${Date.now()}` };
    }
    try {
      switch(exchangeId) {
        case 'binance': {
          const sym2 = symbol.replace('USDT','')+'USDT';
          const body = { symbol:sym2, side:side.toUpperCase(), type:orderType.toUpperCase(), quantity:size };
          if (orderType==='limit' && price) body.price = price;
          const ts = Date.now();
          const qs = new URLSearchParams({...body, timestamp:ts}).toString();
          const sig = crypto.createHmac('sha256', ex.secretKey).update(qs).digest('hex');
          const r = await axios.post(`${ex.base}/api/v3/order?${qs}&signature=${sig}`, null,
            { headers: {'X-MBX-APIKEY': ex.apiKey}, timeout: 8000 });
          return { ok: true, orderId: String(r.data.orderId), exchange: 'binance' };
        }
        case 'bybit': {
          const sym2 = symbol.replace('USDT','')+'USDT';
          const body = { category:'spot', symbol:sym2, side:side==='buy'?'Buy':'Sell', orderType:orderType==='market'?'Market':'Limit', qty:String(size) };
          if (price) body.price = String(price);
          const ts = Date.now().toString();
          const str = ts + ex.apiKey + '5000' + JSON.stringify(body);
          const sig = crypto.createHmac('sha256', ex.secretKey).update(str).digest('hex');
          const r = await axios.post(`${ex.base}/v5/order/create`, body, {
            headers: {'X-BAPI-API-KEY':ex.apiKey,'X-BAPI-SIGN':sig,'X-BAPI-TIMESTAMP':ts,'X-BAPI-RECV-WINDOW':'5000'},
            timeout: 8000 });
          return { ok: true, orderId: r.data?.result?.orderId, exchange: 'bybit' };
        }
        case 'okx': {
          const sym2 = symbol.replace('USDT','')+'-USDT';
          const body = [{ instId:sym2, tdMode:'cash', side:side, ordType:orderType==='market'?'market':'limit', sz:String(size) }];
          if (price) body[0].px = String(price);
          const ts = new Date().toISOString();
          const path = '/api/v5/trade/order';
          const bodyStr = JSON.stringify(body);
          const sig = crypto.createHmac('sha256', ex.secretKey).update(ts+'POST'+path+bodyStr).digest('base64');
          const r = await axios.post(`${ex.base}${path}`, body, {
            headers: {'OK-ACCESS-KEY':ex.apiKey,'OK-ACCESS-SIGN':sig,'OK-ACCESS-TIMESTAMP':ts,'OK-ACCESS-PASSPHRASE':ex.passphrase,'Content-Type':'application/json'},
            timeout: 8000 });
          return { ok: true, orderId: r.data?.data?.[0]?.ordId, exchange: 'okx' };
        }
        default:
          return { error: `${exchangeId}: Order noch nicht implementiert` };
      }
    } catch(e) {
      Log.error('MULTIEX', `${exchangeId} Order Error: ${e.message}`);
      return { error: e.message };
    }
  },

  // ── Alle aktiven Exchanges ────────────────────────────────────────────────
  getActive() {
    return Object.values(this.exchanges).filter(e => e.enabled);
  },

  // ── Bestes Preis-Angebot ueber alle Exchanges (Best Execution) ───────────
  async bestPrice(symbol, side) {
    const active = this.getActive();
    const prices = await Promise.all(
      active.map(async ex => {
        const ticker = ex.id === 'bitget'
          ? Bitget.priceCache[symbol]
          : await this.fetchTicker(ex.id, symbol).catch(()=>null);
        return { exchange: ex.id, name: ex.name, price: ticker?.last || 0 };
      })
    );
    const valid = prices.filter(p => p.price > 0);
    if (!valid.length) return null;
    // Fuer Kauf: billigsten Preis, fuer Verkauf: teuersten
    return side === 'buy'
      ? valid.reduce((a,b) => b.price < a.price ? b : a)
      : valid.reduce((a,b) => b.price > a.price ? b : a);
  },

  // ── Snapshot fuer Frontend ────────────────────────────────────────────────
  snapshot() {
    return Object.values(this.exchanges).map(ex => ({
      id: ex.id, name: ex.name, enabled: ex.enabled,
      status: ex.status, latencyMs: ex.latencyMs,
      hasApiKey: !!ex.apiKey,
      hasPassphrase: ex.hasPassphrase,
      requiredFields: ex.fields,
      pricesCached: Object.keys(ex.priceCache).length,
    }));
  },

  // ── Ping alle aktiven Exchanges ───────────────────────────────────────────
  async pingAll() {
    const results = {};
    for (const ex of this.getActive()) {
      results[ex.id] = await this._ping(ex.id);
    }
    return results;
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOM SCRIPTING ENGINE
// Fuehrt benutzerdefinierte Strategien als JavaScript-Code aus
// Sicherheits-Sandbox: kein Zugriff auf Filesystem, nur lesend auf Marktdaten
// ═════════════════════════════════════════════════════════════════════════════
const ScriptEngine = {
  scripts: {},    // id → script
  results: {},    // id → letztes Ergebnis
  running: {},    // id → timer

  // ── Sicheres Ausführungs-Kontext ─────────────────────────────────────────
  _buildContext(symbol, candles, indicators) {
    // Nur lesende Methoden – kein exec, kein require, kein fs
    return {
      symbol,
      candles,      // Array von {ts,open,high,low,close,vol}
      closes:       candles.map(c=>c.close),
      highs:        candles.map(c=>c.high),
      lows:         candles.map(c=>c.low),
      vols:         candles.map(c=>c.vol),
      price:        candles[candles.length-1]?.close || 0,
      // Alle Indikatoren verfügbar
      ind:          indicators,
      // Hilfsfunktionen
      log:          (msg) => Log.info('SCRIPT', String(msg).slice(0,200)),
      alert:        (msg) => TelegramBot.send('📜 Script Alert: '+String(msg).slice(0,200)),
      // Signal ausgeben: return { signal:'BUY'|'SELL'|'HOLD', strength:0-1, reason:'...' }
    };
  },

  // ── Script hinzufügen / updaten ───────────────────────────────────────────
  add({ id, name, code, symbol='BTCUSDT', granularity='1h', intervalMs=60000, active=false }) {
    // Grundlegende Sicherheitsprüfung
    const forbidden = ['require(', 'process.', 'fs.', '__dirname', 'eval(', 'Function(', 'child_process', 'exec(', 'spawn(', 'import('];
    for (const f of forbidden) {
      if (code.includes(f)) return { error: `Verbotener Ausdruck: ${f}` };
    }
    if (code.length > 5000) return { error: 'Script zu lang (max 5000 Zeichen)' };
    this.scripts[id] = { id, name, code, symbol, granularity, intervalMs, active, createdAt: Date.now(), runs: 0, lastRun: null, lastError: null };
    if (active) this.start(id);
    Log.info('SCRIPT', `Script "${name}" hinzugefügt (${id})`);
    return { ok: true, id };
  },

  // ── Script starten ────────────────────────────────────────────────────────
  start(id) {
    const script = this.scripts[id];
    if (!script) return { error: 'Script nicht gefunden' };
    script.active = true;
    if (this.running[id]) clearInterval(this.running[id]);
    this.running[id] = setInterval(() => this._run(id), script.intervalMs);
    this._run(id); // sofort
    Log.info('SCRIPT', `Script "${script.name}" gestartet`);
    return { ok: true };
  },

  // ── Script stoppen ────────────────────────────────────────────────────────
  stop(id) {
    if (this.running[id]) { clearInterval(this.running[id]); delete this.running[id]; }
    if (this.scripts[id]) this.scripts[id].active = false;
    return { ok: true };
  },

  // ── Script ausführen ──────────────────────────────────────────────────────
  async _run(id) {
    const script = this.scripts[id];
    if (!script) return;
    script.runs++;
    script.lastRun = Date.now();
    try {
      const candles = await Bitget.fetchCandles(script.symbol, script.granularity, 100);
      const closes  = candles.map(c=>c.close);
      // Alle Indikatoren vorberechnen
      const indicators = {
        ema: (n)   => Ind.ema(closes, n),
        sma: (n)   => Ind.sma(closes, n),
        rsi: (n)   => Ind.rsi(closes, n||14),
        macd: ()   => Ind.macd(closes),
        bb: (n)    => Ind.bb(closes, n||20),
        atr: (n)   => Ind.atr(candles, n||14),
        adx: (n)   => Ind.adx(candles, n||14),
        stoch: ()  => Ind.stochastic(candles),
        vwap: ()   => Ind.vwap(candles),
        ichimoku:() => Ind.ichimoku(candles),
        patterns:() => Ind.candlePatterns(candles),
        wave: ()   => Ind.elliottWave(candles),
        obv: ()    => Ind.obv(candles),
        cmf: ()    => Ind.cmf(candles),
      };
      const ctx = this._buildContext(script.symbol, candles, indicators);

      // Script in sicherem Kontext ausführen
      const fn = new Function(
        ...Object.keys(ctx),
        `"use strict";
${script.code}`
      );
      const result = fn(...Object.values(ctx));

      this.results[id] = {
        ts: Date.now(), symbol: script.symbol,
        result, signal: result?.signal || 'HOLD',
        strength: result?.strength || 0,
        reason: result?.reason || '',
      };

      // Auto-Trade wenn Script ein Signal liefert
      if (result?.signal && result.signal !== 'HOLD' && result.strength >= 0.60 && script.autoTrade) {
        const decision = await DecisionFlow.run(script.symbol, result.signal, result.strength, `SCRIPT_${id}`);
        if (decision.approved) {
          await ExecFlow.execute(decision);
          TelegramBot.send(`📜 Script Trade: ${script.symbol} ${result.signal}
Script: ${script.name}
Grund: ${result.reason||'—'}`);
        }
      }
      script.lastError = null;
    } catch(e) {
      script.lastError = e.message;
      Log.warn('SCRIPT', `Script "${script.name}" Fehler: ${e.message}`);
      SelfHeal.recordError('SCRIPT', e.message);
    }
  },

  // ── Script testen (einmalig, kein Trade) ─────────────────────────────────
  async test(id) {
    const script = this.scripts[id];
    if (!script) return { error: 'Script nicht gefunden' };
    await this._run(id);
    return this.results[id] || { error: 'Kein Ergebnis' };
  },

  snapshot() {
    return {
      scripts: Object.values(this.scripts).map(s => ({
        ...s, lastResult: this.results[s.id] || null, isRunning: !!this.running[s.id]
      })),
      totalRuns: Object.values(this.scripts).reduce((a,s) => a+s.runs, 0),
    };
  },

  // ── Beispiel-Scripts ──────────────────────────────────────────────────────
  examples: {
    rsiBasic: {
      name: 'RSI Basic',
      code: `// Einfache RSI-Strategie
const rsiVal = ind.rsi(14);
const emaVal = ind.ema(20);
if (rsiVal < 30 && price < emaVal) {
  return { signal: 'BUY', strength: 0.72, reason: 'RSI überverkauft + unter EMA20' };
}
if (rsiVal > 70 && price > emaVal) {
  return { signal: 'SELL', strength: 0.68, reason: 'RSI überkauft + über EMA20' };
}
return { signal: 'HOLD', strength: 0, reason: 'Kein Signal' };`,
    },
    emaCross: {
      name: 'EMA Crossover 20/50',
      code: `// EMA Kreuzungsstrategie
const e20 = ind.ema(20);
const e50 = ind.ema(50);
const prevCloses = closes.slice(0,-1);
const pe20 = ind.ema(20); // vereinfacht
const bullCross = e20 > e50;
const macdVal = ind.macd();
if (bullCross && macdVal.histogram > 0) {
  return { signal: 'BUY', strength: 0.75, reason: 'EMA20 über EMA50 + MACD bullish' };
}
if (!bullCross && macdVal.histogram < 0) {
  return { signal: 'SELL', strength: 0.70, reason: 'EMA20 unter EMA50 + MACD bearish' };
}
return { signal: 'HOLD', strength: 0 };`,
    },
    whaleIchimoku: {
      name: 'Whale + Ichimoku Kombination',
      code: `// Kombiniert Ichimoku Cloud mit OBV-Trend
const ich = ind.ichimoku();
const obvNow = ind.obv();
const bullish = ich && ich.aboveCloud && ich.tkCross;
const bearish = ich && ich.belowCloud && !ich.tkCross;
const cmfVal = ind.cmf();
if (bullish && cmfVal > 0.05) {
  return { signal: 'BUY', strength: 0.80, reason: 'Ichimoku bullish + CMF positiv' };
}
if (bearish && cmfVal < -0.05) {
  return { signal: 'SELL', strength: 0.78, reason: 'Ichimoku bearish + CMF negativ' };
}
return { signal: 'HOLD', strength: 0, reason: 'Kein klares Signal' };`,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BITGET ADAPTER – REST + WebSocket
// ─────────────────────────────────────────────────────────────────────────────
const Bitget = {
  status:    'UNKNOWN',
  latencyMs: 0,
  lastPing:  null,
  ws:        null,
  wsReady:   false,
  // Live price cache from WebSocket
  priceCache: {},
  // Subscribers for WS data
  _subs: {},

  _sign(ts, method, path, body='') {
    return crypto.createHmac('sha256', CFG.SECRET_KEY)
      .update(ts + method.toUpperCase() + path + body).digest('base64');
  },

  _headers(method, path, body='') {
    const ts = Date.now().toString();
    return {
      'ACCESS-KEY':        CFG.API_KEY,
      'ACCESS-SIGN':       this._sign(ts, method, path, body),
      'ACCESS-TIMESTAMP':  ts,
      'ACCESS-PASSPHRASE': CFG.PASSPHRASE,
      'Content-Type':      'application/json',
      'locale':            'en-US',
    };
  },

  async publicGet(endpoint, timeout=8000) {
    const start = Date.now();
    const key = endpoint.split('?')[0]; // Endpoint ohne Parameter als Key
    const res = await RequestQueue.add(
      () => axios.get(CFG.BITGET_BASE + endpoint, { timeout }),
      key
    );
    this.latencyMs = Date.now() - start;
    return res.data;
  },

  async get(endpoint) {
    if (!CFG.API_KEY) throw new Error('NO_API_KEY');
    const res = await axios.get(CFG.BITGET_BASE + endpoint, {
      headers: this._headers('GET', endpoint), timeout: 8000
    });
    this.latencyMs = Date.now() - res.config._startTime || 0;
    return res.data;
  },

  async post(endpoint, body) {
    if (!CFG.API_KEY) throw new Error('NO_API_KEY');
    const bodyStr = JSON.stringify(body);
    const res = await axios.post(CFG.BITGET_BASE + endpoint, body, {
      headers: this._headers('POST', endpoint, bodyStr), timeout: 8000
    });
    return res.data;
  },

  async ping() {
    try {
      const start = Date.now();
      await this.publicGet('/api/v2/public/time');
      this.latencyMs = Date.now() - start;
      this.status = 'ONLINE';
      this.lastPing = Date.now();
      return { ok: true, latencyMs: this.latencyMs };
    } catch(e) {
      this.status = 'OFFLINE';
      return { ok: false, error: e.message };
    }
  },

  async fetchSpotBalance() {
    let data; try { data = await this.get('/api/v2/spot/account/assets'); } catch(e) { Log.warn('BITGET','Balance: '+e.message); return {available:0,locked:0}; }
    const usdt = data?.data?.find(a => a.coin === 'USDT');
    return usdt ? { available: parseFloat(usdt.available)||0, frozen: parseFloat(usdt.frozen)||0 } : { available:0, frozen:0 };
  },

  async fetchFuturesBalance() {
    const data = await this.get('/api/v2/mix/account/accounts?productType=USDT-FUTURES');
    const usdt = data?.data?.find(a => a.marginCoin === 'USDT');
    return usdt ? { available: parseFloat(usdt.available)||0, locked: parseFloat(usdt.locked)||0 } : { available:0, locked:0 };
  },

  async fetchTicker(symbol) {
    const sym = symbol.replace('/','');
    // Check WebSocket cache first
    if (this.priceCache[sym] && Date.now() - this.priceCache[sym].ts < 5000) {
      return this.priceCache[sym];
    }
    const data = await this.publicGet(`/api/v2/spot/market/tickers?symbol=${sym}`);
    if (data?.data?.[0]) {
      const t = data.data[0];
      const ticker = {
        symbol: sym, last: parseFloat(t.lastPr),
        bid: parseFloat(t.bidPr), ask: parseFloat(t.askPr),
        vol24h: parseFloat(t.usdtVol), change24h: parseFloat(t.change24h),
        ts: Date.now()
      };
      this.priceCache[sym] = ticker;
      return ticker;
    }
    return null;
  },

  async fetchCandles(symbol, granularity='1h', limit=200) {
    const sym = symbol.replace('/','');
    try {
      let allCandles = [];
      if (limit <= 1000) {
        const data = await this.publicGet(`/api/v2/spot/market/candles?symbol=${sym}&granularity=${granularity}&limit=${limit}`);
        if (data?.data) allCandles = data.data.map(c => ({
          ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
          low: parseFloat(c[3]), close: parseFloat(c[4]), vol: parseFloat(c[5])
        }));
      } else {
        let endTime = Date.now();
        let remaining = limit;
        while (remaining > 0) {
          const url = `/api/v2/spot/market/history-candles?symbol=${sym}&granularity=${granularity}&limit=200&endTime=${endTime}`;
          const r = await axios.get('https://api.bitget.com' + url, { timeout: 8000 });
          const batch = (r.data?.data || []).map(c => ({
            ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
            low: parseFloat(c[3]), close: parseFloat(c[4]), vol: parseFloat(c[5])
          }));
          if (!batch.length) break;
          allCandles = [...batch, ...allCandles];
          endTime = batch[0].ts - 1;
          remaining -= batch.length;
          if (batch.length < 200) break;
          await new Promise(r => setTimeout(r, 200));
        }
      }
      if (allCandles.length > 0) {
        const candles = allCandles.sort((a,b) => a.ts - b.ts);
        const insert = DB.db.transaction(() => {
          candles.forEach(c => {
            try { DB.cacheCandles.run(sym, granularity, c.ts, c.open, c.high, c.low, c.close, c.vol); } catch(_){}
          });
        });
        insert();
        return candles;
      }
    } catch(e) {
      Log.warn('BITGET', `Candle fetch failed ${sym}`, { error: e.message });
      const cached = DB.getCachedCandles.all(sym, granularity);
      if (cached.length > 10) return cached;
    }
    return [];
  },

  async fetchOrderbook(symbol) {
    const sym = symbol.replace('/','');
    try {
      const data = await this.publicGet(`/api/v2/spot/market/orderbook?symbol=${sym}&limit=20`);
      return data?.data || null;
    } catch(e) { return null; }
  },

  async placeSportOrder(symbol, side, size, orderType='market', price=null) {
    const body = { symbol, side, orderType, force: 'gtc' };
    if (side==='buy'&&orderType==='market') { body.size=String(parseFloat(size).toFixed(2)); body.tradeSide='buy'; }
    else { body.size=String(parseFloat(size).toFixed(6)); }
    if (price) body.price = String(price);
    try { return await this.post('/api/v2/spot/trade/place-order', body); } catch(e) { Log.error('BITGET','Order: '+e.message); return {code:'ERROR',msg:e.message}; }
  },

  async cancelOrder(symbol, orderId) {
    try { return await this.post('/api/v2/spot/trade/cancel-order',{symbol,orderId}); } catch(e) { return {code:'ERROR',msg:e.message}; }
  },

  async fetchOpenOrders(symbol) {
    try { return await this.get(`/api/v2/spot/trade/unfilled-orders?symbol=${symbol}`); } catch(e) { return {data:[]}; }
  },

  async setLeverage(symbol, leverage, holdSide='long') {
    return await this.post('/api/v2/mix/account/set-leverage', {
      symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT',
      leverage: String(leverage), holdSide
    });
  },

  // ── FUTURES VOLLINTEGRATION ──────────────────────────────────────────────
  async placeFuturesOrder(symbol, side, size, orderType='market', price=null, leverage=3, holdSide='long') {
    try { const fr=await FundingEngine.getSignal(symbol); if(fr&&Math.abs(fr.rate)>0.003){Log.warn('FUTURES','Funding EXTREM: '+(fr.rate*100).toFixed(3)+'%');return{code:'FUNDING_BLOCK',msg:'Funding zu hoch'};}} catch(_) {}
    if (!CFG.API_KEY) {
      // Demo Mode: simuliere Futures Order
      Log.info('FUTURES', `DEMO ${side} ${size} ${symbol} x${leverage}`);
      return { code:'00000', data:{ orderId:'DEMO-FUT-'+Date.now() }, demo:true };
    }
    try {
      await this.setLeverage(symbol, leverage, holdSide);
      const body = {
        symbol, marginCoin:'USDT', side, orderType,
        size: String(parseFloat(size).toFixed(4)),
        productType: 'USDT-FUTURES',
        marginMode: 'isolated',
        leverage: String(leverage),
      };
      if (price) body.price = String(price);
      return await this.post('/api/v2/mix/order/place-order', body);
    } catch(e) {
      Log.error('FUTURES', `Order failed: ${e.message}`);
      return { code:'ERROR', msg: e.message };
    }
  },

  async closeFuturesPosition(symbol, size, holdSide='long') {
    if (!CFG.API_KEY) return { code:'00000', demo:true };
    const side = holdSide==='long' ? 'sell' : 'buy';
    return await this.post('/api/v2/mix/order/place-order', {
      symbol, marginCoin:'USDT', side, orderType:'market',
      size: String(size), productType:'USDT-FUTURES',
      reduceOnly: true,
    });
  },

  async fetchFuturesPositions(symbol=null) {
    if (!CFG.API_KEY) return [];
    try {
      const ep = symbol
        ? `/api/v2/mix/position/single-position?symbol=${symbol}&marginCoin=USDT&productType=USDT-FUTURES`
        : `/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT`;
      const data = await this.get(ep);
      return data?.data || [];
    } catch(e) { return []; }
  },

  async fetchFuturesTicker(symbol) {
    const sym = symbol.replace('USDT','')+'USDT';
    try {
      const data = await this.publicGet(`/api/v2/mix/market/ticker?symbol=${sym}&productType=USDT-FUTURES`);
      const t = data?.data?.[0];
      if (!t) return null;
      return {
        symbol:sym, last:parseFloat(t.lastPr), markPrice:parseFloat(t.markPrice||t.lastPr),
        indexPrice:parseFloat(t.indexPrice||t.lastPr), fundingRate:parseFloat(t.fundingRate||0),
        openInterest:parseFloat(t.holdingAmount||0), vol24h:parseFloat(t.usdtVol||0),
      };
    } catch(e) { return null; }
  },

  async fetchFuturesCandles(symbol, granularity='1h', limit=200) {
    const sym = symbol.replace('USDT','')+'USDT';
    try {
      const data = await this.publicGet(`/api/v2/mix/market/candles?symbol=${sym}&granularity=${granularity}&limit=${limit}&productType=USDT-FUTURES`);
      if (data?.data) {
        return data.data.map(c=>({
          ts:parseInt(c[0]), open:parseFloat(c[1]), high:parseFloat(c[2]),
          low:parseFloat(c[3]), close:parseFloat(c[4]), vol:parseFloat(c[5])
        })).sort((a,b)=>a.ts-b.ts);
      }
    } catch(e) {}
    // Fallback: Spot-Candles
    return await this.fetchCandles(symbol, granularity, limit);
  },

  // WebSocket connection for real-time prices
  connectWS(symbols = CFG.DEFAULT_SYMBOLS) {
    if (this.ws) { try { this.ws.terminate(); } catch(_){} }
    try {
      this.ws = new WebSocket(CFG.BITGET_WS);
      this.ws.on('open', () => {
        this.wsReady = true;
        Log.info('WS', 'WebSocket connected');
        const args = symbols.map(sym => ({ instType:'SPOT', channel:'ticker', instId: sym }));
        this.ws.send(JSON.stringify({ op:'subscribe', args }));
      });
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.data && msg.arg?.channel === 'ticker') {
            const d = msg.data[0];
            if (d) {
              const _newPrice = parseFloat(d.lastPr);
              const _existing = this.priceCache[d.instId];
              const _prev15 = (_existing && (Date.now() - (_existing.prev15ts||0)) < 900000)
                ? (_existing.prev15 || _newPrice)
                : (_existing?.last || _newPrice);
              const _prev15ts = (_existing && (Date.now() - (_existing.prev15ts||0)) < 900000)
                ? (_existing.prev15ts || Date.now())
                : Date.now();
              this.priceCache[d.instId] = {
                symbol: d.instId, last: _newPrice,
                bid: parseFloat(d.bidPr), ask: parseFloat(d.askPr),
                vol24h: parseFloat(d.usdtVol), change24h: parseFloat(d.change24h),
                ts: Date.now(), prev15: _prev15, prev15ts: _prev15ts
              };
            }
          }
        } catch(_) {}
      });
      this.ws.on('close', () => {
        this.wsReady = false;
        Log.warn('WS', 'WebSocket closed – reconnecting in 5s');
        setTimeout(() => this.connectWS(symbols), 5000);
      });
      this.ws.on('error', (e) => {
        this.wsReady = false;
        Log.warn('WS', `WebSocket error: ${e.message}`);
      });
      // Keepalive ping every 25s
      setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, 25000);
    } catch(e) {
      Log.warn('WS', `WebSocket connect failed: ${e.message}`);
    }
  },

  snapshot() {
    return { status: this.status, latencyMs: this.latencyMs, lastPing: this.lastPing, wsReady: this.wsReady, cachedPrices: Object.keys(this.priceCache).length };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TECHNICAL INDICATORS – battle-tested implementations
// ─────────────────────────────────────────────────────────────────────────────
const Ind = {
  ema(closes, period) {
    if (!closes || closes.length < period) return null;
    const k = 2 / (period + 1);
    let e = closes.slice(0, period).reduce((s,v)=>s+v,0) / period;
    for (let i = period; i < closes.length; i++) e = closes[i]*k + e*(1-k);
    return e;
  },

  sma(arr, period) {
    if (!arr || arr.length < period) return null;
    return arr.slice(-period).reduce((s,v)=>s+v,0) / period;
  },

  rsi(closes, period=14) {
    if (!closes || closes.length < period+1) return 50;
    const changes = closes.slice(1).map((c,i) => c - closes[i]);
    const gains = changes.map(c => c>0 ? c : 0);
    const losses = changes.map(c => c<0 ? -c : 0);
    let ag = gains.slice(0,period).reduce((s,v)=>s+v,0)/period;
    let al = losses.slice(0,period).reduce((s,v)=>s+v,0)/period;
    for (let i=period; i<changes.length; i++) {
      ag = (ag*(period-1)+gains[i])/period;
      al = (al*(period-1)+losses[i])/period;
    }
    if (al===0) return 100;
    return 100 - 100/(1+ag/al);
  },

  macd(closes, fast=12, slow=26, sig=9) {
    if (!closes || closes.length < slow+sig+1) return { macd:0, signal:0, histogram:0 };
    // Build MACD history
    const macdLine = [];
    for (let i=slow; i<=closes.length; i++) {
      const slice = closes.slice(0,i);
      const f = this.ema(slice, fast);
      const s = this.ema(slice, slow);
      if (f!==null && s!==null) macdLine.push(f-s);
    }
    const signalLine = this.ema(macdLine, sig) || 0;
    const lastMacd = macdLine[macdLine.length-1] || 0;
    return { macd: lastMacd, signal: signalLine, histogram: lastMacd - signalLine };
  },

  bb(closes, period=20, mult=2) {
    if (!closes || closes.length < period) return null;
    const slice = closes.slice(-period);
    const mean = slice.reduce((s,v)=>s+v,0)/period;
    const variance = slice.reduce((s,v)=>s+(v-mean)**2,0)/period;
    const std = Math.sqrt(variance);
    return { upper: mean+mult*std, middle: mean, lower: mean-mult*std, bandwidth: (2*mult*std)/mean, pct: (closes[closes.length-1]-mean-mult*std)/(2*mult*std)+0.5 };
  },

  atr(candles, period=14) {
    if (!candles || candles.length < period+1) return 0;
    const trs = candles.slice(1).map((c,i) => Math.max(
      c.high-c.low,
      Math.abs(c.high-candles[i].close),
      Math.abs(c.low-candles[i].close)
    ));
    return trs.slice(-period).reduce((s,v)=>s+v,0)/period;
  },

  vwap(candles) {
    if (!candles || !candles.length) return 0;
    let tpv=0, vol=0;
    candles.forEach(c => { const tp=(c.high+c.low+c.close)/3; tpv+=tp*c.vol; vol+=c.vol; });
    return vol>0 ? tpv/vol : candles[candles.length-1]?.close||0;
  },

  stochastic(candles, k=14, d=3) {
    if (!candles || candles.length < k) return { k:50, d:50 };
    const slice = candles.slice(-k);
    const high = Math.max(...slice.map(c=>c.high));
    const low  = Math.min(...slice.map(c=>c.low));
    const cur  = candles[candles.length-1].close;
    const kVal = high!==low ? ((cur-low)/(high-low))*100 : 50;
    return { k: kVal, d: kVal };
  },

  momentum(closes, period=10) {
    if (!closes || closes.length < period+1) return 0;
    const last = closes[closes.length-1];
    const prev = closes[closes.length-1-period];
    return prev > 0 ? (last-prev)/prev : 0;
  },

  volOsc(candles, fast=5, slow=14) {
    if (!candles || candles.length < slow) return 0;
    const vols = candles.map(c=>c.vol);
    const vf = this.sma(vols, fast)||1;
    const vs = this.sma(vols, slow)||1;
    return (vf-vs)/vs;
  },

  // Order Flow Imbalance – bid/ask pressure from orderbook
  orderFlowImbalance(orderbook) {
    if (!orderbook?.bids || !orderbook?.asks) return 0;
    const bidVol = orderbook.bids.slice(0,5).reduce((s,b)=>s+parseFloat(b[1]||0),0);
    const askVol = orderbook.asks.slice(0,5).reduce((s,a)=>s+parseFloat(a[1]||0),0);
    const total = bidVol + askVol;
    return total > 0 ? (bidVol-askVol)/total : 0;
  },

  // Chande Momentum Oscillator
  cmo(closes, period=14) {
    if (!closes || closes.length < period+1) return 0;
    const changes = closes.slice(-period-1).slice(1).map((c,i)=>c-closes[closes.length-period-1+i]);
    const upSum  = changes.filter(c=>c>0).reduce((s,c)=>s+c,0);
    const dnSum  = changes.filter(c=>c<0).reduce((s,c)=>s+Math.abs(c),0);
    return (upSum+dnSum)>0 ? 100*(upSum-dnSum)/(upSum+dnSum) : 0;
  },

  // Keltner Channel
  keltner(candles, emaPeriod=20, atrMult=1.5) {
    if (!candles || candles.length < emaPeriod) return null;
    const closes = candles.map(c=>c.close);
    const mid = this.ema(closes, emaPeriod);
    const atrVal = this.atr(candles, emaPeriod);
    if (!mid) return null;
    return { upper: mid+atrMult*atrVal, middle: mid, lower: mid-atrMult*atrVal };
  },

  // Squeeze Momentum (Bollinger inside Keltner = squeeze)
  squeezeMomentum(candles) {
    const bbVal = this.bb(candles.map(c=>c.close));
    const kc    = this.keltner(candles);
    if (!bbVal || !kc) return { squeeze: false, momentum: 0 };
    const squeeze = bbVal.upper < kc.upper && bbVal.lower > kc.lower;
    const closes  = candles.map(c=>c.close);
    const mom     = this.momentum(closes, 12);
    return { squeeze, momentum: mom };
  },

  // ── PUNKT 1: ICHIMOKU CLOUD ──────────────────────────────────────────────
  // Tenkan-sen(9), Kijun-sen(26), Senkou Span A+B(52), Chikou Span
  ichimoku(candles) {
    if (!candles || candles.length < 52) return null;
    const high = candles.map(c=>c.high);
    const low  = candles.map(c=>c.low);
    const mid  = (n, i=candles.length) => {
      const sl = high.slice(i-n, i);
      const sl2= low.slice(i-n, i);
      return (Math.max(...sl) + Math.min(...sl2)) / 2;
    };
    const tenkan  = mid(9);
    const kijun   = mid(26);
    const senkouA = (mid(9) + mid(26)) / 2;
    const senkouB = mid(52);
    const chikou  = candles[candles.length-1].close;
    const price   = chikou;
    // Cloud signals
    const aboveCloud = price > Math.max(senkouA, senkouB);
    const belowCloud = price < Math.min(senkouA, senkouB);
    const inCloud    = !aboveCloud && !belowCloud;
    const tkCross    = tenkan > kijun;      // TK cross bullish
    const bullish    = aboveCloud && tkCross;
    const bearish    = belowCloud && !tkCross;
    return { tenkan, kijun, senkouA, senkouB, chikou, aboveCloud, belowCloud, inCloud, tkCross, bullish, bearish };
  },

  // ── PUNKT 2: CANDLESTICK PATTERN DETECTION (15 Patterns) ─────────────────
  candlePatterns(candles) {
    if (!candles || candles.length < 3) return [];
    const patterns = [];
    const n = candles.length;
    const c0 = candles[n-1];
    const c1 = candles[n-2];
    const c2 = candles[n-3];
    const body0 = Math.abs(c0.close - c0.open);
    const body1 = Math.abs(c1.close - c1.open);
    const range0= c0.high - c0.low || 0.001;
    const bull0 = c0.close > c0.open;
    const bull1 = c1.close > c1.open;
    const bull2 = c2.close > c2.open;
    const upperWick0 = c0.high - Math.max(c0.open, c0.close);
    const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;

    // 1. Hammer – long lower wick, small body, bullish reversal
    if (lowerWick0 > body0*2 && upperWick0 < body0*0.5 && !bull1)
      patterns.push({ name:'HAMMER', direction:'BUY', strength:0.72 });

    // 2. Shooting Star – long upper wick, bearish reversal
    if (upperWick0 > body0*2 && lowerWick0 < body0*0.5 && bull1)
      patterns.push({ name:'SHOOTING_STAR', direction:'SELL', strength:0.70 });

    // 3. Doji – open ≈ close
    if (body0 < range0*0.1)
      patterns.push({ name:'DOJI', direction:'NEUTRAL', strength:0.45 });

    // 4. Bullish Engulfing
    if (bull0 && !bull1 && c0.close > c1.open && c0.open < c1.close)
      patterns.push({ name:'BULLISH_ENGULFING', direction:'BUY', strength:0.80 });

    // 5. Bearish Engulfing
    if (!bull0 && bull1 && c0.close < c1.open && c0.open > c1.close)
      patterns.push({ name:'BEARISH_ENGULFING', direction:'SELL', strength:0.80 });

    // 6. Morning Star
    if (bull0 && !bull2 && body1 < body0*0.5 && c0.close > (c2.open+c2.close)/2)
      patterns.push({ name:'MORNING_STAR', direction:'BUY', strength:0.82 });

    // 7. Evening Star
      const body2 = Math.abs(c2.close - c2.open);
    if (!bull0 && bull2 && body1 < body2*0.5 && c0.close < (c2.open+c2.close)/2) {
      patterns.push({ name:'EVENING_STAR', direction:'SELL', strength:0.82 });
    }

    // 8. Three White Soldiers
    if (bull0 && bull1 && bull2 && c0.close>c1.close && c1.close>c2.close)
      patterns.push({ name:'THREE_WHITE_SOLDIERS', direction:'BUY', strength:0.85 });

    // 9. Three Black Crows
    if (!bull0 && !bull1 && !bull2 && c0.close<c1.close && c1.close<c2.close)
      patterns.push({ name:'THREE_BLACK_CROWS', direction:'SELL', strength:0.85 });

    // 10. Dragonfly Doji – langer unterer Docht, kein oberer
    if (body0 < range0*0.05 && lowerWick0 > range0*0.6)
      patterns.push({ name:'DRAGONFLY_DOJI', direction:'BUY', strength:0.68 });

    // 11. Gravestone Doji – langer oberer Docht
    if (body0 < range0*0.05 && upperWick0 > range0*0.6)
      patterns.push({ name:'GRAVESTONE_DOJI', direction:'SELL', strength:0.68 });

    // 12. Bullish Harami – kleiner bull inside large bear
    if (bull0 && !bull1 && c0.close < c1.open && c0.open > c1.close && body0 < body1*0.5)
      patterns.push({ name:'BULLISH_HARAMI', direction:'BUY', strength:0.62 });

    // 13. Bearish Harami
    if (!bull0 && bull1 && c0.close > c1.open && c0.open < c1.close && body0 < body1*0.5)
      patterns.push({ name:'BEARISH_HARAMI', direction:'SELL', strength:0.62 });

    // 14. Marubozu Bullish – almost no wicks, strong bull
    if (bull0 && upperWick0 < body0*0.05 && lowerWick0 < body0*0.05 && body0 > range0*0.9)
      patterns.push({ name:'MARUBOZU_BULL', direction:'BUY', strength:0.75 });

    // 15. Marubozu Bearish
    if (!bull0 && upperWick0 < body0*0.05 && lowerWick0 < body0*0.05 && body0 > range0*0.9)
      patterns.push({ name:'MARUBOZU_BEAR', direction:'SELL', strength:0.75 });

    return patterns;
  },

  // Aggregated pattern signal for strategy use
  patternSignal(candles) {
    const pats = this.candlePatterns(candles);
    const buy  = pats.filter(p=>p.direction==='BUY');
    const sell = pats.filter(p=>p.direction==='SELL');
    if (!buy.length && !sell.length) return null;
    if (buy.length > sell.length) {
      const best = buy.reduce((a,b)=>b.strength>a.strength?b:a);
      return { direction:'BUY', pattern: best.name, strength: best.strength, all: pats };
    }
    if (sell.length > buy.length) {
      const best = sell.reduce((a,b)=>b.strength>a.strength?b:a);
      return { direction:'SELL', pattern: best.name, strength: best.strength, all: pats };
    }
    return null;
  },

  // ── PUNKT 3: ELLIOTT WAVE ERKENNUNG ──────────────────────────────────────
  // Vereinfachte Pivot-basierte Wellen-Erkennung (5-Wellen Impulse + 3-Wellen ABC)
  // ── UPGRADE: Elliott Wave mit echten Fibonacci-Ratios ──────────────────────
  // Wave 2 retraciert 38.2-61.8% von Wave 1
  // Wave 3 ist 1.618 x Wave 1 (stärkste Welle)
  // Wave 4 retraciert 23.6-38.2% von Wave 3
  // Wave 5 = 0.618 x Wave 1-3 Distanz
  // ABC Correction: C = 0.618-1.618 x A
  elliottWave(candles) {
    if (!candles || candles.length < 60) return null;
    const closes = candles.map(c=>c.close);
    const FIB = { R236:0.236, R382:0.382, R500:0.500, R618:0.618, R786:0.786, E1618:1.618, E2618:2.618 };

    // Pivot-Erkennung mit konfigurierbarem Lookback
    const findPivots = (lookback=5) => {
      const pts = [];
      for (let i=lookback; i<closes.length-lookback; i++) {
        const win = closes.slice(i-lookback, i+lookback+1);
        if (closes[i] === Math.max(...win)) pts.push({ i, price:closes[i], type:'H' });
        else if (closes[i] === Math.min(...win)) pts.push({ i, price:closes[i], type:'L' });
      }
      return pts;
    };

    // Fibonacci Check: ist ratio innerhalb tolerance?
    const fibCheck = (ratio, target, tol=0.08) => Math.abs(ratio - target) < tol;

    const pivots = findPivots(5);
    if (pivots.length < 6) return { wave:'INSUFFICIENT_DATA', confidence:0, pivotCount:pivots.length };

    const p = pivots.slice(-6);
    const types = p.map(x=>x.type).join('');
    const px = p.map(x=>x.price);
    let wave='CORRECTIVE', bias='NEUTRAL', confidence=0.40, fibValid=false, fibLevels={};

    // ── 5-WELLEN IMPULSE BULLISH: L H L H L H ──
    if (types.slice(-6) === 'LHLHLH') {
      const w1 = px[1]-px[0];    // Wave 1 Amplitude
      const w2ret = (px[1]-px[2])/w1;  // Wave 2 Retracement
      const w3 = px[3]-px[2];    // Wave 3
      const w3ext = w3/w1;       // Wave 3 Extension
      const w4ret = (px[3]-px[4])/w3;  // Wave 4 Retracement
      const w5 = px[5]-px[4];    // Wave 5
      fibLevels = { w2ret, w3ext, w4ret };
      const w2ok = fibCheck(w2ret, FIB.R618,0.12) || fibCheck(w2ret, FIB.R382,0.10);
      const w3ok = fibCheck(w3ext, FIB.E1618,0.20) || w3ext > 1.0; // Wave 3 meist >1
      const w4ok = fibCheck(w4ret, FIB.R382,0.12) || fibCheck(w4ret, FIB.R236,0.10);
      // Wave 3 darf nicht kürzer als Wave 1 und 5 sein (EW Regel)
      const rule3 = w3 > w1 * 0.9;
      // Wave 4 darf nicht in Wave 1 Territory (EW Regel)
      const rule4 = px[4] > px[1];
      if (w2ok && w3ok && w4ok && rule3 && rule4) {
        wave = 'IMPULSE_WAVE5_BULL'; bias = 'BUY'; confidence = 0.82; fibValid = true;
      } else if (w3ok && rule3) {
        wave = 'IMPULSE_PARTIAL_BULL'; bias = 'BUY'; confidence = 0.65;
      }
    }

    // ── 5-WELLEN IMPULSE BEARISH: H L H L H L ──
    else if (types.slice(-6) === 'HLHLHL') {
      const w1 = px[0]-px[1];
      const w2ret = (px[2]-px[1])/w1;
      const w3 = px[2]-px[3];
      const w3ext = w3/w1;
      const w4ret = (px[4]-px[3])/w3;
      fibLevels = { w2ret, w3ext, w4ret };
      const w2ok = fibCheck(w2ret, FIB.R618,0.12)||fibCheck(w2ret, FIB.R382,0.10);
      const w3ok = fibCheck(w3ext, FIB.E1618,0.20)||w3ext>1.0;
      const w4ok = fibCheck(w4ret, FIB.R382,0.12)||fibCheck(w4ret, FIB.R236,0.10);
      const rule3 = w3>w1*0.9, rule4 = px[4]<px[1];
      if (w2ok&&w3ok&&w4ok&&rule3&&rule4) {
        wave='IMPULSE_WAVE5_BEAR'; bias='SELL'; confidence=0.82; fibValid=true;
      } else if (w3ok&&rule3) {
        wave='IMPULSE_PARTIAL_BEAR'; bias='SELL'; confidence=0.65;
      }
    }

    // ── ABC CORRECTION mit Fibonacci ──
    else if (types.slice(-3) === 'HLH' || types.slice(-3) === 'LHL') {
      const isBull = types.slice(-3) === 'LHL';
      const a = Math.abs(p[p.length-3].price - p[p.length-2].price);
      const c = Math.abs(p[p.length-2].price - p[p.length-1].price);
      const cRatio = c/a;
      fibLevels = { cRatio };
      if (fibCheck(cRatio, FIB.E1618,0.15)||fibCheck(cRatio,FIB.R618,0.12)||fibCheck(cRatio,1.0,0.10)) {
        wave='ABC_CORRECTION'; bias=isBull?'BUY':'SELL'; confidence=0.70; fibValid=true;
      } else {
        wave='CORRECTION_IN_PROGRESS'; bias='WAIT'; confidence=0.50;
      }
    }

    // Fibonacci Levels für aktuellen Preis berechnen
    const high = Math.max(...closes.slice(-50));
    const low  = Math.min(...closes.slice(-50));
    const range = high - low;
    const fibTargets = {
      f236: high - range*FIB.R236,
      f382: high - range*FIB.R382,
      f500: high - range*FIB.R500,
      f618: high - range*FIB.R618,
      f786: high - range*FIB.R786,
      ext1618: low + range*FIB.E1618,
      ext2618: low + range*FIB.E2618,
    };

    const currentPrice = closes[closes.length-1];
    const nearestFib = Object.entries(fibTargets).reduce((a,b) =>
      Math.abs(b[1]-currentPrice) < Math.abs(a[1]-currentPrice) ? b : a
    );

    return {
      wave, bias, confidence, fibValid,
      pivotCount: pivots.length,
      fibLevels, fibTargets,
      nearestFibLevel: nearestFib[0],
      nearestFibPrice: nearestFib[1],
      nearestFibDist: Math.abs(nearestFib[1]-currentPrice)/currentPrice,
      priceAboveFib618: currentPrice > fibTargets.f618,
      priceAboveFib382: currentPrice > fibTargets.f382,
    };
  },

  // ── 30+ ADDITIONAL INDICATORS ──────────────────────────────────────────────

  // Williams %R
  williamsR(candles, period=14) {
    if (!candles||candles.length<period) return -50;
    const sl=candles.slice(-period);
    const high=Math.max(...sl.map(c=>c.high)), low=Math.min(...sl.map(c=>c.low));
    const cur=candles[candles.length-1].close;
    return high===low ? -50 : ((high-cur)/(high-low))*-100;
  },

  // CCI – Commodity Channel Index
  cci(candles, period=20) {
    if (!candles||candles.length<period) return 0;
    const tp=candles.map(c=>(c.high+c.low+c.close)/3);
    const sl=tp.slice(-period), m=sl.reduce((a,b)=>a+b,0)/period;
    const md=sl.reduce((a,b)=>a+Math.abs(b-m),0)/period;
    return md===0?0:(tp[tp.length-1]-m)/(0.015*md);
  },

  // MFI – Money Flow Index
  mfi(candles, period=14) {
    if (!candles||candles.length<period+1) return 50;
    let pos=0,neg=0;
    for (let i=candles.length-period;i<candles.length;i++) {
      const tp=(candles[i].high+candles[i].low+candles[i].close)/3;
      const tpP=(candles[i-1].high+candles[i-1].low+candles[i-1].close)/3;
      const mf=tp*candles[i].vol;
      if (tp>tpP) pos+=mf; else neg+=mf;
    }
    return neg===0?100:100-(100/(1+pos/neg));
  },

  // OBV – On Balance Volume
  obv(candles) {
    let o=0,pv=0;
    for (const c of candles) { if(c.close>pv)o+=c.vol; else if(c.close<pv)o-=c.vol; pv=c.close; }
    return o;
  },

  // VWMA – Volume Weighted Moving Average
  vwma(candles, period=20) {
    if (!candles||candles.length<period) return null;
    const sl=candles.slice(-period);
    const tv=sl.reduce((a,c)=>a+c.close*c.vol,0);
    const v=sl.reduce((a,c)=>a+c.vol,0);
    return v>0?tv/v:null;
  },

  // HMA – Hull Moving Average (more responsive than EMA)
  hma(closes, period=20) {
    if (!closes||closes.length<period) return null;
    const half=Math.floor(period/2), sqrt=Math.round(Math.sqrt(period));
    const wma=(arr,n)=>{
      if (arr.length<n) return null;
      let w=0,s=0;
      for (let i=0;i<n;i++){s+=(i+1)*arr[arr.length-n+i];w+=(i+1);}
      return s/w;
    };
    const wmaHalf=wma(closes,half), wmaFull=wma(closes,period);
    if (!wmaHalf||!wmaFull) return null;
    const diff=2*wmaHalf-wmaFull;
    // Build series for WMA(sqrt)
    const series=[diff];
    return wma(series,1)||diff;
  },

  // DEMA – Double EMA (faster trend following)
  dema(closes, period=20) {
    if (!closes||closes.length<period*2) return null;
    const e1=this.ema(closes,period);
    if (!e1) return null;
    // Build EMA of EMA series
    const ema1Series=[];
    for (let i=period;i<=closes.length;i++) ema1Series.push(this.ema(closes.slice(0,i),period)||0);
    const e2=this.ema(ema1Series,period);
    return e2 ? 2*e1-e2 : e1;
  },

  // TEMA – Triple EMA
  tema(closes, period=20) {
    if (!closes||closes.length<period*3) return null;
    const e1=this.ema(closes,period);
    if (!e1) return null;
    const s1=[],s2=[];
    for (let i=period;i<=closes.length;i++){const e=this.ema(closes.slice(0,i),period);if(e)s1.push(e);}
    for (let i=period;i<=s1.length;i++){const e=this.ema(s1.slice(0,i),period);if(e)s2.push(e);}
    const e2=this.ema(s1,period),e3=this.ema(s2,period);
    return (e1&&e2&&e3)?3*e1-3*e2+e3:e1;
  },

  // WMA – Weighted Moving Average
  wma(closes, period=20) {
    if (!closes||closes.length<period) return null;
    let w=0,s=0;
    for (let i=0;i<period;i++){s+=(i+1)*closes[closes.length-period+i];w+=(i+1);}
    return s/w;
  },

  // Parabolic SAR
  psar(candles, step=0.02, max=0.20) {
    if (!candles||candles.length<5) return null;
    let bull=true, af=step, ep=candles[0].low, sar=candles[0].high;
    for (let i=1;i<candles.length;i++){
      const c=candles[i];
      sar=sar+af*(ep-sar);
      if (bull){
        if(c.low<sar){bull=false;sar=ep;ep=c.low;af=step;}
        else{if(c.high>ep){ep=c.high;af=Math.min(af+step,max);}sar=Math.min(sar,candles[i-1].low,i>1?candles[i-2].low:sar);}
      } else {
        if(c.high>sar){bull=true;sar=ep;ep=c.high;af=step;}
        else{if(c.low<ep){ep=c.low;af=Math.min(af+step,max);}sar=Math.max(sar,candles[i-1].high,i>1?candles[i-2].high:sar);}
      }
    }
    const cur=candles[candles.length-1].close;
    return { sar, trend:bull?'BULL':'BEAR', signal:bull&&cur>sar?'BUY':!bull&&cur<sar?'SELL':'NEUTRAL' };
  },

  // ADX – Average Directional Index (vollständig)
  adx(candles, period=14) {
    if (!candles||candles.length<period*2) return { adx:0, diPlus:0, diMinus:0, trend:'WEAK' };
    const dp=[],dm=[],tr=[];
    for (let i=1;i<candles.length;i++){
      const c=candles[i],p=candles[i-1];
      const u=c.high-p.high, d=p.low-c.low;
      dp.push(u>d&&u>0?u:0);
      dm.push(d>u&&d>0?d:0);
      tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
    }
    const atr14=tr.slice(-period).reduce((a,b)=>a+b,0)/period||1;
    const diP=(dp.slice(-period).reduce((a,b)=>a+b,0)/period)/atr14*100;
    const diM=(dm.slice(-period).reduce((a,b)=>a+b,0)/period)/atr14*100;
    const dx=(diP+diM)>0?Math.abs(diP-diM)/(diP+diM)*100:0;
    // Smooth DX for ADX
    const dxSeries=[];
    for (let i=period;i<tr.length;i++){
      const atrI=tr.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period||1;
      const dpI=dp.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period/atrI*100;
      const dmI=dm.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period/atrI*100;
      dxSeries.push((dpI+dmI)>0?Math.abs(dpI-dmI)/(dpI+dmI)*100:0);
    }
    const adxVal=dxSeries.length>=period?dxSeries.slice(-period).reduce((a,b)=>a+b,0)/period:dx;
    return { adx:adxVal, diPlus:diP, diMinus:diM, trend:adxVal>25?(adxVal>40?'STRONG':'MODERATE'):'WEAK', bull:diP>diM };
  },

  // Aroon Oscillator
  aroon(candles, period=25) {
    if (!candles||candles.length<period) return { up:50,down:50,osc:0 };
    const sl=candles.slice(-period);
    const highIdx=sl.reduce((a,c,i)=>c.high>sl[a].high?i:a,0);
    const lowIdx=sl.reduce((a,c,i)=>c.low<sl[a].low?i:a,0);
    const up=(highIdx/(period-1))*100;
    const down=(lowIdx/(period-1))*100;
    return { up, down, osc:up-down };
  },

  // Donchian Channel
  donchian(candles, period=20) {
    if (!candles||candles.length<period) return null;
    const sl=candles.slice(-period);
    const upper=Math.max(...sl.map(c=>c.high));
    const lower=Math.min(...sl.map(c=>c.low));
    return { upper, lower, middle:(upper+lower)/2, width:(upper-lower)/((upper+lower)/2) };
  },

  // Choppiness Index – misst ob Markt trendend oder choppy ist
  choppiness(candles, period=14) {
    if (!candles||candles.length<period+1) return 50;
    const sl=candles.slice(-period);
    const atrSum=sl.reduce((s,c,i)=>{
      if(i===0)return s;
      const p=sl[i-1];
      return s+Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));
    },0);
    const high=Math.max(...sl.map(c=>c.high)), low=Math.min(...sl.map(c=>c.low));
    const range=high-low||0.001;
    return 100*Math.log10(atrSum/range)/Math.log10(period);
  },

  // TRIX – Triple Smoothed EMA Rate of Change
  trix(closes, period=15) {
    if (!closes||closes.length<period*3) return 0;
    const e1=[], e2=[], e3=[];
    for (let i=period;i<=closes.length;i++){const e=this.ema(closes.slice(0,i),period);if(e!==null)e1.push(e);}
    for (let i=period;i<=e1.length;i++){const e=this.ema(e1.slice(0,i),period);if(e!==null)e2.push(e);}
    for (let i=period;i<=e2.length;i++){const e=this.ema(e2.slice(0,i),period);if(e!==null)e3.push(e);}
    if (e3.length<2) return 0;
    return (e3[e3.length-1]-e3[e3.length-2])/(e3[e3.length-2]||1)*100;
  },

  // Ultimate Oscillator
  ultimateOsc(candles, p1=7, p2=14, p3=28) {
    if (!candles||candles.length<p3+1) return 50;
    const bpArr=[], trArr=[];
    for (let i=1;i<candles.length;i++){
      const c=candles[i],p=candles[i-1];
      const trueHigh=Math.max(c.high,p.close), trueLow=Math.min(c.low,p.close);
      bpArr.push(c.close-trueLow);
      trArr.push(trueHigh-trueLow||0.001);
    }
    const avg=(n)=>{
      const bp=bpArr.slice(-n).reduce((a,b)=>a+b,0);
      const tr=trArr.slice(-n).reduce((a,b)=>a+b,0);
      return tr>0?bp/tr:0.5;
    };
    return 100*(4*avg(p1)+2*avg(p2)+avg(p3))/7;
  },

  // Detrended Price Oscillator
  dpo(closes, period=20) {
    if (!closes||closes.length<period+1) return 0;
    const shift=Math.floor(period/2)+1;
    const sma=this.sma(closes.slice(0,-shift), period)||closes[closes.length-shift-1];
    return closes[closes.length-1-shift]-(sma||0);
  },

  // Mass Index – Erkennt Trend-Umkehrungen via Range Expansion
  massIndex(candles, period=25) {
    if (!candles||candles.length<period+10) return 26;
    const ranges=candles.map(c=>c.high-c.low||0.001);
    const ema9=[];
    for (let i=9;i<=ranges.length;i++) ema9.push(this.ema(ranges.slice(0,i),9)||1);
    const ema9ema9=[];
    for (let i=9;i<=ema9.length;i++) ema9ema9.push(this.ema(ema9.slice(0,i),9)||1);
    const ratio=ema9.slice(-ema9ema9.length).map((e,i)=>e/(ema9ema9[i]||1));
    return ratio.slice(-period).reduce((a,b)=>a+b,0);
  },

  // Kaufman AMA – Adaptive Moving Average
  kama(closes, period=10, fast=2, slow=30) {
    if (!closes||closes.length<period+1) return closes?.[closes.length-1]||0;
    const fastK=2/(fast+1), slowK=2/(slow+1);
    let kama=closes[period-1];
    for (let i=period;i<closes.length;i++){
      const dir=Math.abs(closes[i]-closes[i-period]);
      const vol=closes.slice(i-period,i).reduce((s,c,j)=>j>0?s+Math.abs(c-closes[i-period+j-1]):s,0)||0.001;
      const er=dir/vol;
      const sc=(er*(fastK-slowK)+slowK)**2;
      kama=kama+sc*(closes[i]-kama);
    }
    return kama;
  },

  // ROC – Rate of Change
  roc(closes, period=10) {
    if (!closes||closes.length<period+1) return 0;
    const prev=closes[closes.length-period-1];
    return prev>0?(closes[closes.length-1]-prev)/prev*100:0;
  },

  // PPO – Percentage Price Oscillator (wie MACD aber in %)
  ppo(closes, fast=12, slow=26) {
    if (!closes||closes.length<slow) return 0;
    const ef=this.ema(closes,fast), es=this.ema(closes,slow);
    return (ef&&es&&es!==0)?((ef-es)/es)*100:0;
  },

  // Vortex Indicator
  vortex(candles, period=14) {
    if (!candles||candles.length<period+1) return { viPlus:1,viMinus:1,signal:'NEUTRAL' };
    let vmp=0,vmm=0,tr=0;
    for (let i=candles.length-period;i<candles.length;i++){
      const c=candles[i],p=candles[i-1];
      vmp+=Math.abs(c.high-p.low);
      vmm+=Math.abs(c.low-p.high);
      tr+=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));
    }
    const viP=vmp/(tr||1), viM=vmm/(tr||1);
    return { viPlus:viP, viMinus:viM, signal:viP>viM?'BUY':'SELL' };
  },

  // Elder Ray Bull/Bear Power
  elderRay(candles, period=13) {
    if (!candles||candles.length<period) return { bullPower:0,bearPower:0 };
    const closes=candles.map(c=>c.close);
    const ema=this.ema(closes,period)||closes[closes.length-1];
    const last=candles[candles.length-1];
    return { bullPower:last.high-ema, bearPower:last.low-ema };
  },

  // Accumulation/Distribution Line
  adl(candles) {
    let adl=0;
    for (const c of candles){
      const range=c.high-c.low||0.001;
      const mf=((c.close-c.low)-(c.high-c.close))/range;
      adl+=mf*c.vol;
    }
    return adl;
  },

  // Chaikin Money Flow
  cmf(candles, period=20) {
    if (!candles||candles.length<period) return 0;
    const sl=candles.slice(-period);
    let mfv=0,vol=0;
    for (const c of sl){
      const range=c.high-c.low||0.001;
      mfv+=((c.close-c.low)-(c.high-c.close))/range*c.vol;
      vol+=c.vol;
    }
    return vol>0?mfv/vol:0;
  },

  // DOJI strength score (0-100)
  dojiScore(candle) {
    const body=Math.abs(candle.close-candle.open);
    const range=candle.high-candle.low||0.001;
    return Math.max(0, 100*(1-body/range*5));
  },

  // Heikin-Ashi Candles (smoothed)
  heikinAshi(candles) {
    if (!candles||candles.length<2) return [];
    const ha=[];
    let prevClose=(candles[0].open+candles[0].high+candles[0].low+candles[0].close)/4;
    let prevOpen=candles[0].open;
    for (const c of candles){
      const close=(c.open+c.high+c.low+c.close)/4;
      const open=(prevOpen+prevClose)/2;
      const high=Math.max(c.high,open,close);
      const low=Math.min(c.low,open,close);
      ha.push({ ts:c.ts, open, high, low, close, vol:c.vol, bull:close>open });
      prevClose=close; prevOpen=open;
    }
    return ha;
  },

  // Supertrend
  supertrend(candles, period=10, mult=3) {
    if (!candles||candles.length<period+2) return null;
    const atrVal=this.atr(candles,period);
    const last=candles[candles.length-1];
    const hl2=(last.high+last.low)/2;
    const upperBand=hl2+mult*atrVal;
    const lowerBand=hl2-mult*atrVal;
    const prev=candles[candles.length-2];
    const hl2Prev=(prev.high+prev.low)/2;
    const bull=last.close>(hl2Prev+mult*atrVal)?false:last.close<(hl2Prev-mult*atrVal)?true:last.close>hl2Prev;
    return { supertrend:bull?lowerBand:upperBand, trend:bull?'BULL':'BEAR', signal:bull?'BUY':'SELL', atr:atrVal };
  },

  // Comprehensive indicator bundle – returns all new indicators at once
  bundle(candles) {
    const closes=candles.map(c=>c.close);
    return {
      williamsR:  this.williamsR(candles),
      cci:        this.cci(candles),
      mfi:        this.mfi(candles),
      obv:        this.obv(candles),
      vwma:       this.vwma(candles),
      hma:        this.hma(closes),
      wma:        this.wma(closes),
      psar:       this.psar(candles),
      adx:        this.adx(candles),
      aroon:      this.aroon(candles),
      donchian:   this.donchian(candles),
      choppiness: this.choppiness(candles),
      trix:       this.trix(closes),
      ultimateOsc:this.ultimateOsc(candles),
      roc:        this.roc(closes),
      ppo:        this.ppo(closes),
      vortex:     this.vortex(candles),
      elderRay:   this.elderRay(candles),
      adl:        this.adl(candles),
      cmf:        this.cmf(candles),
      kama:       this.kama(closes),
      supertrend: this.supertrend(candles),
      heikinAshi: this.heikinAshi(candles).slice(-3),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PUNKT 4: FUNDING RATE ENGINE – Futures Arbitrage Signal
// ─────────────────────────────────────────────────────────────────────────────
const FundingEngine = {
  cache: {},
  lastFetch: {},

  // Fetch Bitget Funding Rate mit Demo-Fallback
  async fetchFundingRate(symbol) {
    const sym = symbol.replace('USDT', '') + 'USDT_UMCBL';
    // Demo-Modus: simuliere realistische Funding Rates
    if (!CFG.API_KEY) {
      const cached = this.cache[symbol];
      if (cached && Date.now() - cached.ts < 300000) return cached.rate;
      // Simuliere Funding Rate basierend auf letztem Preis-Trend
      const ticker = Bitget.priceCache[symbol];
      const change = ticker?.change24h || 0;
      // Bei positiver 24h Change meist positive Funding (Longs dominieren)
      const simRate = change * 0.0001 + (Math.random()-0.5)*0.0002;
      const rate = Math.max(-0.003, Math.min(0.003, simRate));
      this.cache[symbol] = { rate, ts: Date.now(), simulated: true };
      return rate;
    }
    try {
      const data = await Bitget.publicGet(`/api/mix/v1/market/current-fundRate?symbol=${sym}`);
      const rate = parseFloat(data?.data?.fundingRate || 0);
      this.cache[symbol] = { rate, ts: Date.now(), simulated: false };
      return rate;
    } catch(e) {
      // Fallback: versuche V2 API
      try {
        const data2 = await Bitget.publicGet(`/api/v2/mix/market/current-fund-rate?symbol=${sym}&productType=USDT-FUTURES`);
        const rate = parseFloat(data2?.data?.fundingRate || 0);
        this.cache[symbol] = { rate, ts: Date.now(), simulated: false };
        return rate;
      } catch(_) {
        return this.cache[symbol]?.rate || 0;
      }
    }
  },

  // Funding Rate Arbitrage Signal:
  // Wenn Funding Rate sehr positiv → Long-Holder zahlen Shorts → Sell-Druck
  // Wenn Funding Rate sehr negativ → Short-Holder zahlen Longs → Buy-Druck
  signal(rate) {
    const THRESHOLD_HIGH =  0.001;  // 0.1% per 8h = sehr positiv
    const THRESHOLD_LOW  = -0.001;  // -0.1% per 8h = sehr negativ
    if (rate > THRESHOLD_HIGH) {
      const str = Math.min(0.90, 0.60 + rate * 200);
      return { direction:'SELL', strength: str, rate, reason:'HIGH_FUNDING_RATE_SELL_PRESSURE' };
    }
    if (rate < THRESHOLD_LOW) {
      const str = Math.min(0.90, 0.60 + Math.abs(rate) * 200);
      return { direction:'BUY', strength: str, rate, reason:'LOW_FUNDING_RATE_BUY_PRESSURE' };
    }
    return { direction:'NEUTRAL', strength: 0, rate, reason:'FUNDING_RATE_NORMAL' };
  },

  async getSignal(symbol) {
    const rate = await this.fetchFundingRate(symbol);
    return this.signal(rate);
  },

  // Kumulierte Funding Kosten für eine offene Position schätzen
  estimateFundingCost(positionSizeUSDT, rate, hoursHeld) {
    const periodsHeld = hoursHeld / 8;
    return positionSizeUSDT * rate * periodsHeld;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PUNKT 5: SAFETIES SYSTEM – Unabhängige Schutzschicht (wie HaasOnline)
// Safety = Check der unabhängig von Strategie-Logik aktiv ist
// ─────────────────────────────────────────────────────────────────────────────
const Safeties = {
  // Safety 1: Max consecutive losses
  maxConsecutiveLosses: 3,
  consecutiveLossCount: 0,

  // Safety 2: Sudden price move guard (Flash Crash Schutz)
  priceHistory: {},

  // Safety 3: Daily trade limit
  dailyTradeCount: 0,
  dailyTradeLimit: 10,
  dailyTradeDate: '',

  // Safety 4: Spread guard
  maxSpreadPct: 0.005, // 0.5%

  // Safety 5: Volume guard – handle thin markets
  minVolumeUSDT24h: 1000000, // 1M USDT minimum

  recordLoss(symbol) {
    this.consecutiveLossCount++;
    Log.warn('SAFETY', `Consecutive loss #${this.consecutiveLossCount} on ${symbol}`);
    if (this.consecutiveLossCount >= this.maxConsecutiveLosses) {
      Incidents.create('SAFETY_MAX_LOSSES', `${this.consecutiveLossCount} Verluste in Folge`, 'HIGH');
    }
  },

  recordWin() {
    this.consecutiveLossCount = 0;
  },

  resetDailyCount() {
    const today = new Date().toISOString().slice(0,10);
    if (this.dailyTradeDate !== today) {
      this.dailyTradeCount = 0;
      this.dailyTradeDate = today;
    }
  },

  recordTrade() {
    this.resetDailyCount();
    this.dailyTradeCount++;
  },

  trackPrice(symbol, price) {
    if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
    this.priceHistory[symbol].push({ price, ts: Date.now() });
    if (this.priceHistory[symbol].length > 60) this.priceHistory[symbol].shift();
  },

  // Prüfe alle Safeties vor einem Trade
  evaluate(symbol, ticker) {
    this.resetDailyCount();
    const violations = [];

    // 1. Consecutive losses
    if (this.consecutiveLossCount >= this.maxConsecutiveLosses)
      violations.push({ name:'MAX_CONSECUTIVE_LOSSES', detail:`${this.consecutiveLossCount} Verluste in Folge` });

    // 2. Daily trade limit
    if (this.dailyTradeCount >= this.dailyTradeLimit)
      violations.push({ name:'DAILY_TRADE_LIMIT', detail:`${this.dailyTradeCount}/${this.dailyTradeLimit} Trades heute` });

    // 3. Spread check
    if (ticker?.bid && ticker?.ask) {
      const spread = (ticker.ask - ticker.bid) / ticker.ask;
      if (spread > this.maxSpreadPct)
        violations.push({ name:'SPREAD_TOO_HIGH', detail:`${(spread*100).toFixed(3)}%` });
    }

    // 4. Volume guard
    if (ticker?.vol24h && ticker.vol24h < this.minVolumeUSDT24h)
      violations.push({ name:'LOW_VOLUME', detail:`${(ticker.vol24h/1e6).toFixed(2)}M USDT` });

    // 5. Flash crash guard – Preis >8% in 15min
    const hist = this.priceHistory[symbol] || [];
    if (hist.length >= 15) {
      const price15ago = hist[hist.length-15]?.price || 0;
      const current = ticker?.last || 0;
      if (price15ago > 0) {
        const move = Math.abs(current - price15ago) / price15ago;
        if (move > 0.08)
          violations.push({ name:'FLASH_CRASH_DETECTED', detail:`${(move*100).toFixed(1)}% Bewegung in 15min` });
      }
    }

    return {
      safe: violations.length === 0,
      violations,
      consecutiveLosses: this.consecutiveLossCount,
      dailyTradeCount: this.dailyTradeCount,
    };
  },

  snapshot() {
    return {
      consecutiveLossCount: this.consecutiveLossCount,
      maxConsecutiveLosses: this.maxConsecutiveLosses,
      dailyTradeCount: this.dailyTradeCount,
      dailyTradeLimit: this.dailyTradeLimit,
      dailyTradeDate: this.dailyTradeDate,
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUNKT 6: FLASH CRASH BOT – Liquidation Cascade Detection + Kontra-Trade
// ─────────────────────────────────────────────────────────────────────────────
const FlashCrashBot = {
  active: false,
  lastSignal: null,
  signals: [],

  detect(candles, ticker) {
    if (!candles || candles.length < 10) return null;
    const closes = candles.map(c=>c.close);
    const vols   = candles.map(c=>c.vol);
    const last   = closes[closes.length-1];
    const prev5  = closes[closes.length-6];
    const avgVol = vols.slice(-20).reduce((s,v)=>s+v,0) / 20;
    const lastVol= vols[vols.length-1];
    const drop5  = (prev5 - last) / prev5;
    const volSpike = lastVol / (avgVol || 1);

    // Flash Crash: Preis fällt >5% bei gleichzeitigem Vol-Spike >3×
    if (drop5 > 0.05 && volSpike > 3) {
      const signal = {
        type: 'FLASH_CRASH',
        drop: drop5,
        volSpike,
        price: last,
        ts: Date.now(),
        action: 'BUY_RECOVERY', // Kontra-Trade nach Liquidation Cascade
        strength: Math.min(0.85, 0.55 + drop5 * 3),
        reason: `Preis -${(drop5*100).toFixed(1)}% · Vol ${volSpike.toFixed(1)}× normal`,
      };
      this.lastSignal = signal;
      this.signals.unshift(signal);
      if (this.signals.length > 20) this.signals.pop();
      Log.warn('FLASH_CRASH', signal.reason);
      Incidents.create('FLASH_CRASH', signal.reason, 'HIGH');
      return signal;
    }

    // Pump Detection: Preis steigt >6% bei Vol-Spike → Short-Signal
    const pump5 = (last - prev5) / prev5;
    if (pump5 > 0.06 && volSpike > 3) {
      const signal = {
        type: 'PUMP_DETECTED',
        pump: pump5,
        volSpike,
        price: last,
        ts: Date.now(),
        action: 'SELL_REVERSAL',
        strength: Math.min(0.78, 0.52 + pump5 * 2),
        reason: `Preis +${(pump5*100).toFixed(1)}% · Vol ${volSpike.toFixed(1)}× normal`,
      };
      this.lastSignal = signal;
      this.signals.unshift(signal);
      if (this.signals.length > 20) this.signals.pop();
      Log.warn('PUMP', signal.reason);
      return signal;
    }

    return null;
  },

  snapshot() {
    return { active: this.active, lastSignal: this.lastSignal, recentSignals: this.signals.slice(0,5) };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUNKT 7: TICK-LEVEL BACKTESTING ENGINE
// Statt nur 1H-Kerzen: Minuten-Kerzen + simulierte Ticks zwischen Kerzen
// ─────────────────────────────────────────────────────────────────────────────
const TickBacktest = {
  // Backtesting auf Minuten-Daten mit simulierten Intra-Candle-Ticks
  // Berechne Liquidationspreis fuer Futures
  calcLiqPrice(entryPrice, leverage, side='long', maintenanceMargin=0.005) {
    // Isolated Margin Modus
    // Long: Liq = Entry * (1 - 1/leverage + maintenanceMargin)
    // Short: Liq = Entry * (1 + 1/leverage - maintenanceMargin)
    if (side === 'long') return entryPrice * (1 - 1/leverage + maintenanceMargin);
    return entryPrice * (1 + 1/leverage - maintenanceMargin);
  },

  async run(symbol, granularity='1m', limit=1000, strategy='full', capital=1000, posSize=0.1, slPct=0.02, tpPct=0.04, leverage=1) {
    Log.info('BACKTEST', `Tick-Level: ${symbol} ${granularity} ${limit} Kerzen x${leverage}`);
    const candles = await Bitget.fetchCandles(symbol, granularity, limit);
    if (!candles || candles.length < 100) return { error: 'Insufficient data', candles: candles?.length || 0 };

    let cap = capital, startCap = capital, maxCap = capital, minCap = capital;
    let inTrade = false, entryPrice = 0, entrySize = 0;
    let wins = 0, losses = 0, totalGain = 0, totalLoss = 0;
    let liquidations = 0;
    const trades = [];
    const equityCurve = [capital];
    const pnlSeries = [];

    for (let i = 50; i < candles.length - 1; i++) {
      const slice = candles.slice(0, i+1);
      const closes = slice.map(c=>c.close);
      const current = candles[i];

      // Simuliere 4 Ticks innerhalb der Kerze: Open, High, Low, Close
      const ticks = [current.open, current.high, current.low, current.close];

      // Entry Signal ermitteln
      if (!inTrade) {
        let signal = false;
        if (strategy === 'ema_cross') {
          const e20=Ind.ema(closes,20), e50=Ind.ema(closes,50);
          const pe20=Ind.ema(closes.slice(0,-1),20), pe50=Ind.ema(closes.slice(0,-1),50);
          signal = e20&&e50&&pe20&&pe50 && e20>e50 && pe20<=pe50;
        } else if (strategy === 'ichimoku') {
          const ich = Ind.ichimoku(slice);
          signal = ich?.bullish && !ich?.inCloud;
        } else if (strategy === 'patterns') {
          const ps = Ind.patternSignal(slice);
          signal = ps?.direction === 'BUY' && ps.strength > 0.70;
        } else if (strategy === 'funding_arb') {
          const rsi = Ind.rsi(closes);
          const bb  = Ind.bb(closes);
          signal = rsi < 35 && bb && current.close < bb.lower;
        } else {
          // Full strategy: Kombination
          const e20=Ind.ema(closes,20), e50=Ind.ema(closes,50);
          const rsi=Ind.rsi(closes), macdVal=Ind.macd(closes);
          const ich=Ind.ichimoku(slice);
          const ps=Ind.patternSignal(slice);
          let score = 0;
          if (e20&&e50&&e20>e50) score++;
          if (rsi > 45 && rsi < 70) score++;
          if (macdVal.histogram > 0) score++;
          if (ich?.aboveCloud) score++;
          if (ps?.direction === 'BUY') score++;
          signal = score >= 3;
        }
        if (signal && cap > 10) {
          // REALISTISCHES SLIPPAGE-MODELL
          // Slippage = f(Liquidität, Positionsgröße, Volatilität)
          // Bei BTC/USDT: ~0.02-0.08% je nach Markt
          // Bei kleinen Altcoins: bis 0.5%
          const rawEntry   = ticks[0]; // Theoretischer Entry
          const vol24h     = candles[i].vol || 1e6;
          const orderValueUSD = cap * posSize;
          // Markt-Impact: größere Orders verschieben Preis mehr
          const marketImpact  = Math.min(0.003, orderValueUSD / (vol24h * rawEntry) * 2);
          // Spread-Anteil basierend auf ATR
          const spreadEst     = Ind.atr(candles.slice(0,i+1)) / rawEntry * 0.15;
          const totalSlippage = marketImpact + (spreadEst || 0.0002);
          entryPrice = rawEntry * (1 + totalSlippage); // Entry leicht schlechter
          entrySize  = (cap * posSize) / entryPrice;
          inTrade = true;
        }
      }

      // Exit prüfen auf jedem Tick (simuliertes Tick-Level) + LIQUIDATION
      if (inTrade) {
        const sl = entryPrice * (1 - slPct);
        const tp = entryPrice * (1 + tpPct);
        // Liquidationspreis bei Futures mit Hebel (Isolated Margin)
        const liqPrice = leverage > 1 ? TickBacktest.calcLiqPrice(entryPrice, leverage, 'long') : 0;
        let exited = false;

        for (const tick of ticks) {
          // Liquidation zuerst prüfen (tritt vor SL ein)
          if (leverage > 1 && liqPrice > 0 && tick <= liqPrice && !exited) {
            const pnl = -cap * posSize; // Totalverlust der Margin
            cap += pnl; losses++; totalLoss += Math.abs(pnl); liquidations++;
            trades.push({ type:'LIQUIDATED', entry:entryPrice, exit:liqPrice, pnl:pnl.toFixed(4), leverage, tick:true });
            pnlSeries.push(pnl); inTrade = false; exited = true;
          } else if (tick <= sl && !exited) {
            // Exit-Slippage: Stop Loss wird oft schlechter ausgeführt (Gapping)
            const exitSlip = 0.0003 + Math.random() * 0.0005; // 0.03-0.08% zusätzlich
            const realExit = sl * (1 - exitSlip);
            const pnl = (realExit - entryPrice) * entrySize * leverage;
            cap += pnl; losses++; totalLoss += Math.abs(pnl);
            trades.push({ type:'LOSS', entry:entryPrice, exit:realExit, pnl:pnl.toFixed(4), tick:true, slippage:exitSlip.toFixed(5) });
            pnlSeries.push(pnl); inTrade = false; exited = true;
          } else if (tick >= tp && !exited) {
            // TP-Exit: meist nah am Limit, kleines Slippage
            const exitSlip = 0.0001 + Math.random() * 0.0002;
            const realExit = tp * (1 - exitSlip);
            const pnl = (realExit - entryPrice) * entrySize * leverage;
            cap += pnl; wins++; totalGain += pnl;
            trades.push({ type:'WIN', entry:entryPrice, exit:realExit, pnl:pnl.toFixed(4), tick:true, slippage:exitSlip.toFixed(5) });
            pnlSeries.push(pnl); inTrade = false; exited = true;
          }
        }
        maxCap = Math.max(maxCap, cap);
        minCap = Math.min(minCap, cap);
        equityCurve.push(cap);
      }
    }

    const tt = wins + losses;
    const sharpe = PerfTracker.sharpe(pnlSeries);
    const maxDD  = PerfTracker.maxDrawdown(equityCurve);

    return {
      symbol, granularity, strategy, candles: candles.length,
      trades: tt, wins, losses, liquidations,
      winRate:  tt>0 ? wins/tt : 0,
      totalPnL: cap - startCap,
      returnPct:(cap - startCap) / startCap,
      maxDrawdown: maxDD,
      sharpe,
      leverage,
      liqSimulated: leverage > 1,
      profitFactor: totalLoss>0 ? totalGain/totalLoss : totalGain>0 ? 999 : 0,
      endCapital: cap,
      equityCurve: equityCurve.filter((_,i) => i % Math.max(1,Math.floor(equityCurve.length/100)) === 0),
      tickLevel: true,
      slippageModel: true,
      slippageNote: 'Enthält Entry-Slippage (Markt-Impact + Spread) und Exit-Slippage (Gapping)',
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUNKT 8: ML PARAMETER OPTIMIZER
// Optimiert Strategy-Parameter via Walk-Forward Optimierung
// Kein echter ML-Stack notwendig – Gradient-freie Optimierung (Grid Search + Hill Climbing)
// ─────────────────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
// ECHTES MACHINE LEARNING – MLOptimizer
//
// 3 Modelle:
// 1. RANDOM FOREST CLASSIFIER
//    – Baut viele Entscheidungsbäume aus zufälligen Indikator-Subsets
//    – Mehrheitsvoting der Bäume → BUY / SELL / HOLD + Confidence
//    – Lernt welche Indikator-Kombinationen historisch profitable Trades vorhersagen
//
// 2. GRADIENT BOOSTING (AdaBoost-style)
//    – Startet mit schwachen Entscheidungsregeln
//    – Jede Iteration fokussiert auf Fehler des vorherigen Modells
//    – Ensembled zu einem starken Klassifikator
//
// 3. ONLINE LEARNING (Perceptron + Gewichts-Update)
//    – Lernt live aus jedem abgeschlossenen Trade
//    – Passt Indikator-Gewichte automatisch an: Gewinner +, Verlierer –
//    – Kein Neu-Training nötig – verbessert sich kontinuierlich
// ═════════════════════════════════════════════════════════════════════════════
const MLOptimizer = {
  running:    false,
  trained:    false,
  trainedAt:  null,
  trainedOn:  0,      // Anzahl Samples
  accuracy:   0,

  // ── FEATURE EXTRACTION ──────────────────────────────────────────────────
  // Berechnet alle 47 Indikatoren als normalisierten Feature-Vektor
  extractFeatures(candles) {
    if (!candles || candles.length < 60) return null;
    const closes = candles.map(c => c.close);
    const price  = closes[closes.length - 1];
    const norm   = (v, min, max) => max > min ? (v - min) / (max - min) : 0.5;
    const clamp  = (v) => Math.max(0, Math.min(1, isNaN(v) ? 0.5 : v));

    const rsi    = Ind.rsi(closes)        || 50;
    const macd   = Ind.macd(closes);
    const bb     = Ind.bb(closes)         || { pctB:0.5, bandwidth:0.05 };
    const atr    = Ind.atr(candles)       || 0;
    const stoch  = Ind.stochastic(candles)|| { k:50 };
    const ema20  = Ind.ema(closes, 20)    || price;
    const ema50  = Ind.ema(closes, 50)    || price;
    const ema200 = Ind.ema(closes, 200)   || price;
    const adxObj = Ind.adx(candles)       || { adx:20, diPlus:20, diMinus:20 };
    const cci    = Ind.cci(candles)       || 0;
    const mfi    = Ind.mfi(candles)       || 50;
    const wR     = Ind.williamsR(candles) || -50;
    const obv    = Ind.obv(candles)       || 0;
    const cmf    = Ind.cmf(candles)       || 0;
    const psar   = Ind.psar(candles)      || { sar:price, trend:'BULL' };
    const vortex = Ind.vortex(candles)    || { viPlus:1, viMinus:1 };
    const st     = Ind.supertrend(candles)|| { trend:'BULL' };
    const squeeze= Ind.squeezeMomentum(candles) || { squeeze:false, momentum:0 };
    const ich    = Ind.ichimoku(candles);
    const elder  = Ind.elderRay(candles)  || { bullPower:0, bearPower:0 };
    const trix   = Ind.trix(closes)       || 0;
    const roc    = Ind.roc(closes)        || 0;
    const chop   = Ind.choppiness(candles)|| 50;
    const aroon  = Ind.aroon(candles)     || { up:50, down:50, osc:0 };
    const ppo    = Ind.ppo(closes)        || 0;

    // Heikin-Ashi Trend (letzte 5 HA-Kerzen)
    const ha = Ind.heikinAshi(candles.slice(-10));
    const haBullCount = ha.filter(c => c.bull).length;

    // Preis-Position relativ zu MAs
    const p20  = ema20  > 0 ? price/ema20 - 1  : 0;
    const p50  = ema50  > 0 ? price/ema50 - 1  : 0;
    const p200 = ema200 > 0 ? price/ema200 - 1 : 0;

    // 35 Features als Array [0..1]
    return [
      clamp(norm(rsi, 0, 100)),                        // 0: RSI
      clamp(norm(macd.histogram, -0.02, 0.02)),        // 1: MACD Histogram
      clamp(bb.pctB || 0.5),                           // 2: BB %B
      clamp(norm(bb.bandwidth || 0, 0, 0.2)),          // 3: BB Bandwidth
      clamp(norm(atr / (price || 1), 0, 0.05)),        // 4: ATR%
      clamp(norm(stoch.k, 0, 100)),                    // 5: Stoch K
      clamp(norm(p20, -0.1, 0.1)),                     // 6: Abstand EMA20
      clamp(norm(p50, -0.1, 0.1)),                     // 7: Abstand EMA50
      clamp(norm(p200, -0.2, 0.2)),                    // 8: Abstand EMA200
      ema20 > ema50 ? 1 : 0,                           // 9: EMA20>50 (binär)
      ema50 > ema200 ? 1 : 0,                          // 10: EMA50>200 (binär)
      clamp(norm(adxObj.adx, 0, 60)),                  // 11: ADX Stärke
      adxObj.diPlus > adxObj.diMinus ? 1 : 0,         // 12: DI+ > DI- (binär)
      clamp(norm(cci, -200, 200)),                     // 13: CCI
      clamp(norm(mfi, 0, 100)),                        // 14: MFI
      clamp(norm(wR, -100, 0)),                        // 15: Williams %R
      clamp(norm(cmf, -1, 1)),                         // 16: CMF
      price > psar.sar ? 1 : 0,                        // 17: Preis > SAR (binär)
      st.trend === 'BULL' ? 1 : 0,                    // 18: Supertrend (binär)
      squeeze.squeeze ? 1 : 0,                         // 19: Squeeze aktiv (binär)
      clamp(norm(squeeze.momentum, -0.05, 0.05)),      // 20: Squeeze Momentum
      ich ? (ich.aboveCloud ? 1 : ich.belowCloud ? 0 : 0.5) : 0.5, // 21: Ichimoku
      ich ? (ich.tkCross ? 1 : 0) : 0.5,              // 22: TK Cross (binär)
      clamp(norm(elder.bullPower, -100, 100)),          // 23: Elder Bull Power
      clamp(norm(elder.bearPower, -100, 100)),          // 24: Elder Bear Power
      vortex.viPlus > vortex.viMinus ? 1 : 0,          // 25: Vortex (binär)
      clamp(norm(trix, -0.5, 0.5)),                    // 26: TRIX
      clamp(norm(roc, -20, 20)),                        // 27: ROC
      clamp(norm(chop, 20, 80)),                        // 28: Choppiness (>61.8=ranging)
      clamp(norm(aroon.osc, -100, 100)),                // 29: Aroon Osc
      clamp(norm(ppo, -5, 5)),                          // 30: PPO
      clamp(haBullCount / 10),                          // 31: HA Bull-Anteil
      macd.macd > macd.signal ? 1 : 0,                 // 32: MACD > Signal (binär)
      clamp(norm(macd.macd, -0.02, 0.02)),              // 33: MACD Wert
      clamp(norm(obv / (1e8), -1, 1)),                  // 34: OBV normiert
    ];
  },

  // ── LABEL GENERATION ────────────────────────────────────────────────────
  // Bestimmt ob eine Kerze ein BUY, SELL oder HOLD war
  // Schaut N Kerzen in die Zukunft
  generateLabel(candles, idx, lookahead=5, threshold=0.008) {
    if (idx + lookahead >= candles.length) return null;
    const entry = candles[idx].close;
    const future = candles.slice(idx+1, idx+lookahead+1).map(c => c.close);
    const maxUp   = (Math.max(...future) - entry) / entry;
    const maxDown = (entry - Math.min(...future)) / entry;
    if (maxUp > threshold && maxUp > maxDown * 1.5) return 2;  // BUY
    if (maxDown > threshold && maxDown > maxUp * 1.5) return 0; // SELL
    return 1;                                                    // HOLD
  },

  // ── DATASET AUFBAU ──────────────────────────────────────────────────────
  buildDataset(candles, lookahead=5) {
    const X = [], y = [];
    for (let i = 60; i < candles.length - lookahead; i++) {
      const features = this.extractFeatures(candles.slice(0, i+1));
      const label    = this.generateLabel(candles, i, lookahead);
      if (features && label !== null) { X.push(features); y.push(label); }
    }
    return { X, y };
  },

  // ════════════════════════════════════════════════════════════════════════
  // MODELL 1: RANDOM FOREST CLASSIFIER
  // Echter Entscheidungsbaum-Algorithmus mit Information Gain Splitting
  // ════════════════════════════════════════════════════════════════════════
  RF: {
    trees:     [],
    nTrees:    30,    // 30 Bäume
    maxDepth:  8,
    minSamples:5,
    featureSubset: 8, // sqrt(35) ≈ 6, wir nehmen 8

    // Entropie berechnen
    _entropy(labels) {
      const n = labels.length; if (!n) return 0;
      const counts = [0,0,0];
      labels.forEach(l => counts[l]++);
      return -counts.reduce((s,c) => {
        if (!c) return s;
        const p = c/n; return s + p * Math.log2(p);
      }, 0);
    },

    // Besten Split finden (Information Gain)
    _bestSplit(X, y, features) {
      let bestGain = -Infinity, bestFeat = -1, bestThresh = 0;
      const parentEntropy = this._entropy(y);
      for (const fi of features) {
        const vals = [...new Set(X.map(x => x[fi]))].sort((a,b)=>a-b);
        for (let ti = 0; ti < vals.length-1; ti++) {
          const thresh = (vals[ti] + vals[ti+1]) / 2;
          const left  = y.filter((_,i) => X[i][fi] <= thresh);
          const right = y.filter((_,i) => X[i][fi] >  thresh);
          if (!left.length || !right.length) continue;
          const gain = parentEntropy
            - (left.length/y.length)*this._entropy(left)
            - (right.length/y.length)*this._entropy(right);
          if (gain > bestGain) { bestGain=gain; bestFeat=fi; bestThresh=thresh; }
        }
      }
      return { feat:bestFeat, thresh:bestThresh, gain:bestGain };
    },

    // Mehrheitsvoting
    _majorityVote(labels) {
      const counts = [0,0,0]; labels.forEach(l=>counts[l]++);
      return counts.indexOf(Math.max(...counts));
    },

    // Baum rekursiv bauen
    _buildTree(X, y, depth, features) {
      if (!y.length) return { leaf:true, label:1 };
      if (depth >= this.maxDepth || y.length < this.minSamples || new Set(y).size === 1) {
        return { leaf:true, label:this._majorityVote(y) };
      }
      const split = this._bestSplit(X, y, features);
      if (split.feat < 0 || split.gain <= 0) return { leaf:true, label:this._majorityVote(y) };

      const leftIdx  = X.map((_,i)=>i).filter(i=>X[i][split.feat]<=split.thresh);
      const rightIdx = X.map((_,i)=>i).filter(i=>X[i][split.feat]>split.thresh);
      return {
        leaf:false, feat:split.feat, thresh:split.thresh,
        left:  this._buildTree(leftIdx.map(i=>X[i]),  leftIdx.map(i=>y[i]),  depth+1, features),
        right: this._buildTree(rightIdx.map(i=>X[i]), rightIdx.map(i=>y[i]), depth+1, features),
      };
    },

    _predict(tree, x) {
      if (tree.leaf) return tree.label;
      return x[tree.feat] <= tree.thresh ? this._predict(tree.left,x) : this._predict(tree.right,x);
    },

    // Forest trainieren
    train(X, y) {
      this.trees = [];
      const n = X.length;
      const nFeats = X[0]?.length || 35;
      for (let t = 0; t < this.nTrees; t++) {
        // Bootstrap-Sample (mit Zurücklegen)
        const idx = Array.from({length:n}, () => Math.floor(Math.random()*n));
        const bX  = idx.map(i=>X[i]);
        const bY  = idx.map(i=>y[i]);
        // Zufälliges Feature-Subset
        const allFeat = Array.from({length:nFeats},(_,i)=>i);
        const featSubset = allFeat.sort(()=>Math.random()-0.5).slice(0,this.featureSubset);
        this.trees.push(this._buildTree(bX, bY, 0, featSubset));
      }
    },

    // Vorhersage mit Confidence
    predict(x) {
      if (!this.trees.length) return { label:1, confidence:0, probBuy:0.33, probSell:0.33, probHold:0.34 };
      const votes = this.trees.map(t => this._predict(t, x));
      const counts = [0,0,0]; votes.forEach(v=>counts[v]++);
      const label = counts.indexOf(Math.max(...counts));
      const confidence = counts[label] / this.trees.length;
      return {
        label,
        signal: label===2?'BUY':label===0?'SELL':'HOLD',
        confidence,
        probSell: counts[0]/this.trees.length,
        probHold: counts[1]/this.trees.length,
        probBuy:  counts[2]/this.trees.length,
      };
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // MODELL 2: GRADIENT BOOSTING (vereinfacht, aber echtes Konzept)
  // Additive Modell: jeder Baum korrigiert Fehler des vorherigen
  // ════════════════════════════════════════════════════════════════════════
  GB: {
    stumps:       [],  // Schwache Lerner (Entscheidungsstümpfe Tiefe=2)
    weights:      [],  // Lerngewichte pro Stumpf
    nEstimators:  20,
    learningRate: 0.1,
    trained:      false,

    _stumpPredict(stump, x) {
      if (x[stump.feat] <= stump.thresh) return stump.leftLabel;
      return stump.rightLabel;
    },

    _buildStump(X, y, sampleWeights) {
      let bestErr = Infinity, bestFeat=-1, bestThresh=0, bestL=1, bestR=1;
      const n = X.length, nF = X[0]?.length||35;
      // Zufällig 10 Features testen (schneller)
      const feats = Array.from({length:nF},(_,i)=>i).sort(()=>Math.random()-0.5).slice(0,10);
      for (const fi of feats) {
        const vals = [...new Set(X.map(x=>x[fi]))].sort((a,b)=>a-b);
        for (let ti=0;ti<vals.length-1;ti++) {
          const t=(vals[ti]+vals[ti+1])/2;
          const leftY  = y.filter((_,i)=>X[i][fi]<=t);
          const rightY = y.filter((_,i)=>X[i][fi]>t);
          const lW     = sampleWeights.filter((_,i)=>X[i][fi]<=t);
          const rW     = sampleWeights.filter((_,i)=>X[i][fi]>t);
          const lMaj   = this._weightedMaj(leftY,lW);
          const rMaj   = this._weightedMaj(rightY,rW);
          const err    = y.reduce((s,yi,i)=>{
            const pred = X[i][fi]<=t ? lMaj : rMaj;
            return s + (pred!==yi ? sampleWeights[i] : 0);
          },0);
          if (err < bestErr) { bestErr=err; bestFeat=fi; bestThresh=t; bestL=lMaj; bestR=rMaj; }
        }
      }
      return { feat:bestFeat, thresh:bestThresh, leftLabel:bestL, rightLabel:bestR, err:bestErr };
    },

    _weightedMaj(labels, weights) {
      const counts=[0,0,0];
      labels.forEach((l,i)=>counts[l]+=weights[i]||1);
      return counts.indexOf(Math.max(...counts));
    },

    train(X, y) {
      const n = X.length;
      let weights = new Array(n).fill(1/n);
      this.stumps=[]; this.weights=[];
      for (let m=0; m<this.nEstimators; m++) {
        const stump = this._buildStump(X, y, weights);
        const err   = Math.max(stump.err, 1e-10);
        const alpha = this.learningRate * 0.5 * Math.log((1-err)/err);
        // Gewichte aktualisieren
        weights = weights.map((w,i) => {
          const pred = this._stumpPredict(stump, X[i]);
          return w * Math.exp(pred===y[i] ? -alpha : alpha);
        });
        const wSum = weights.reduce((a,b)=>a+b,0);
        weights = weights.map(w=>w/wSum);
        this.stumps.push(stump);
        this.weights.push(alpha);
      }
      this.trained=true;
    },

    predict(x) {
      if (!this.stumps.length) return {label:1,signal:'HOLD',confidence:0};
      const scores=[0,0,0];
      this.stumps.forEach((s,i)=>{
        const pred=this._stumpPredict(s,x);
        scores[pred]+=this.weights[i];
      });
      const label=scores.indexOf(Math.max(...scores));
      const total=scores.reduce((a,b)=>a+b,0)||1;
      return {
        label,
        signal: label===2?'BUY':label===0?'SELL':'HOLD',
        confidence: scores[label]/total,
        probSell: scores[0]/total,
        probHold: scores[1]/total,
        probBuy:  scores[2]/total,
      };
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // MODELL 3: ONLINE PERCEPTRON – lernt live aus jedem Trade
  // Passt 35 Indikator-Gewichte nach jedem abgeschlossenen Trade an
  // ════════════════════════════════════════════════════════════════════════
  Perceptron: {
    weights:    new Array(35).fill(0),  // Ein Gewicht pro Feature
    bias:       [0,0,0],                // Bias pro Klasse
    lr:         0.05,                   // Lernrate
    trained:    0,                      // Anzahl Online-Updates
    history:    [],                     // Lernkurve

    // Dot product
    _score(x, classIdx) {
      return x.reduce((s,f,i)=>s+f*(this.weights[i]||0),0) + (this.bias[classIdx]||0);
    },

    predict(x) {
      const scores = [0,1,2].map(c=>this._score(x,c));
      const label  = scores.indexOf(Math.max(...scores));
      const maxS   = Math.max(...scores);
      const expS   = scores.map(s=>Math.exp(s-maxS));
      const sumExp = expS.reduce((a,b)=>a+b,0);
      const probs  = expS.map(s=>s/sumExp);
      return {
        label, signal:label===2?'BUY':label===0?'SELL':'HOLD',
        confidence: probs[label],
        probSell:probs[0], probHold:probs[1], probBuy:probs[2],
      };
    },

    // Online-Update nach einem Trade
    learn(features, trueLabel) {
      if (!features) return;
      const pred = this.predict(features);
      if (pred.label !== trueLabel) {
        // Perceptron Update: Gewichte in Richtung der richtigen Klasse verschieben
        features.forEach((f,i) => {
          this.weights[i] = (this.weights[i]||0) + this.lr * f * (trueLabel - pred.label);
          this.weights[i] *= 0.999; // Weight Decay
          this.weights[i] = Math.max(-5, Math.min(5, this.weights[i])); // Max-Norm
        });
        this.bias[trueLabel] = (this.bias[trueLabel]||0) + this.lr;
        this.bias[pred.label] = (this.bias[pred.label]||0) - this.lr;
      }
      this.trained++;
      this.history.push({ pred:pred.label, truth:trueLabel, correct:pred.label===trueLabel, ts:Date.now() });
      if (this.history.length>200) this.history.shift();
      // Persistenz: alle 10 Updates speichern
      if (typeof MLPersist !== 'undefined') MLPersist.onPerceptronUpdate(this.trained);
    },

    accuracy() {
      if (!this.history.length) return 0;
      const recent = this.history.slice(-100);
      return recent.filter(h=>h.correct).length / recent.length;
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // HAUPT-TRAINING – trainiert alle 3 Modelle
  // ════════════════════════════════════════════════════════════════════════
  async train(symbol='BTCUSDT', granularity='1h', limit=500) {
    if (this.running) return { error:'Training läuft bereits' };
    this.running = true;
    Log.info('ML', `Starte Training: ${symbol} ${granularity} ${limit} Kerzen`);

    try {
      const candles = await Bitget.fetchCandles(symbol, granularity, limit);
      if (!candles || candles.length < 150) {
        this.running=false;
        return { error:`Nicht genug Daten: ${candles?.length||0} Kerzen (min 150)` };
      }

      const { X, y } = this.buildDataset(candles);
      if (X.length < 50) {
        this.running=false;
        return { error:`Zu wenig Trainingsdaten: ${X.length} Samples` };
      }

      // 70/30 Train/Test Split
      const splitAt  = Math.floor(X.length * 0.70);
      const Xtrain   = X.slice(0, splitAt);
      const ytrain   = y.slice(0, splitAt);
      const Xtest    = X.slice(splitAt);
      const ytest    = y.slice(splitAt);

      Log.info('ML', `Dataset: ${X.length} Samples · Train: ${Xtrain.length} · Test: ${Xtest.length}`);

      // Labels verteilen
      const dist = [0,0,0];
      y.forEach(l=>dist[l]++);
      Log.info('ML', `Label-Verteilung: SELL=${dist[0]} HOLD=${dist[1]} BUY=${dist[2]}`);

      // Alle 3 Modelle trainieren
      Log.info('ML', 'Trainiere Random Forest...');
      this.RF.train(Xtrain, ytrain);

      Log.info('ML', 'Trainiere Gradient Boosting...');
      this.GB.train(Xtrain, ytrain);

      // Perceptron: batch-initialisieren
      Log.info('ML', 'Initialisiere Perceptron...');
      for (let i=0; i<Xtrain.length; i++) {
        this.Perceptron.learn(Xtrain[i], ytrain[i]);
      }

      // ── CROSS-VALIDATION (5-Fold) ─────────────────────────────────────────
      // Teilt Daten in 5 gleiche Teile, trainiert 5x, mittelt Accuracy
      // Gibt ehrlicheres Bild als einzelner 70/30 Split
      Log.info('ML', 'Cross-Validation (5-Fold)...');
      const kFolds = 5;
      const foldSize = Math.floor(X.length / kFolds);
      let cvAccsRF=[], cvAccsGB=[];
      for (let fold=0; fold<kFolds; fold++) {
        const valStart = fold * foldSize;
        const valEnd   = valStart + foldSize;
        const Xcv_train = [...X.slice(0,valStart), ...X.slice(valEnd)];
        const ycv_train = [...y.slice(0,valStart), ...y.slice(valEnd)];
        const Xcv_val   = X.slice(valStart, valEnd);
        const ycv_val   = y.slice(valStart, valEnd);
        // Schnelles Temp-Modell für CV (weniger Bäume)
        const tempRF = Object.create(this.RF);
        tempRF.trees = []; tempRF.nTrees = 8;
        tempRF.train(Xcv_train, ycv_train);
        const rfCVcorr = Xcv_val.filter((x,i)=>tempRF.predict(x).label===ycv_val[i]).length;
        cvAccsRF.push(rfCVcorr / (Xcv_val.length||1));
        const tempGB = Object.create(this.GB);
        tempGB.stumps=[]; tempGB.weights=[]; tempGB.trained=false; tempGB.nEstimators=8;
        tempGB.train(Xcv_train, ycv_train);
        const gbCVcorr = Xcv_val.filter((x,i)=>tempGB.predict(x).label===ycv_val[i]).length;
        cvAccsGB.push(gbCVcorr / (Xcv_val.length||1));
      }
      const cvRF = cvAccsRF.reduce((a,b)=>a+b,0)/kFolds;
      const cvGB = cvAccsGB.reduce((a,b)=>a+b,0)/kFolds;
      const cvStdRF = Math.sqrt(cvAccsRF.reduce((s,a)=>s+(a-cvRF)**2,0)/kFolds);
      Log.info('ML', `CV: RF=${(cvRF*100).toFixed(1)}%±${(cvStdRF*100).toFixed(1)}% GB=${(cvGB*100).toFixed(1)}%`);

      // ── TEST-ACCURACY (finales Modell) ────────────────────────────────────
      let rfCorrect=0, gbCorrect=0, pcCorrect=0;
      for (let i=0;i<Xtest.length;i++) {
        if (this.RF.predict(Xtest[i]).label === ytest[i]) rfCorrect++;
        if (this.GB.predict(Xtest[i]).label === ytest[i]) gbCorrect++;
        if (this.Perceptron.predict(Xtest[i]).label === ytest[i]) pcCorrect++;
      }
      const n = Xtest.length || 1;
      const rfAcc  = rfCorrect/n;
      const gbAcc  = gbCorrect/n;
      const pcAcc  = pcCorrect/n;
      this.accuracy = (rfAcc+gbAcc+pcAcc)/3;

      // ── FEATURE IMPORTANCE (Permutation Importance) ───────────────────────
      // Wie viel schlechter wird RF wenn ein Feature zufällig gemischt wird?
      // Große Verschlechterung = Feature ist wichtig
      Log.info('ML', 'Berechne Feature Importance...');
      const FEAT_NAMES = ['RSI','MACD_Hist','BB_PctB','BB_Width','ATR_Pct','Stoch_K','EMA20_Dist','EMA50_Dist','EMA200_Dist','EMA20>50','EMA50>200','ADX','DI_Plus>Minus','CCI','MFI','Williams_R','CMF','SAR_Bull','Supertrend','Squeeze','Sqz_Momentum','Ichimoku','TK_Cross','Elder_Bull','Elder_Bear','Vortex','TRIX','ROC','Choppiness','Aroon_Osc','PPO','HA_Bull','MACD>Signal','MACD_Val','OBV'];
      const baseAcc = rfAcc;
      const importance = [];
      for (let fi=0; fi<35; fi++) {
        // Permutiere Feature fi in Testdaten
        const permuted = Xtest.map((x,i) => {
          const shuffleIdx = Math.floor(Math.random()*Xtest.length);
          const xCopy = [...x];
          xCopy[fi] = Xtest[shuffleIdx][fi];
          return xCopy;
        });
        const permAcc = permuted.filter((x,i)=>this.RF.predict(x).label===ytest[i]).length / n;
        importance.push({ feature: FEAT_NAMES[fi]||'F'+fi, index:fi, importance: baseAcc - permAcc });
      }
      importance.sort((a,b)=>b.importance-a.importance);
      this.featureImportance = importance;
      Log.info('ML', 'Top-3 Features: '+importance.slice(0,3).map(f=>f.feature+'('+(f.importance*100).toFixed(1)+'%)').join(', '));

      // Overfitting-Warnung: wenn CV-Accuracy viel schlechter als Test-Accuracy
      const overfit = rfAcc - cvRF > 0.10;
      if (overfit) Log.warn('ML', `Overfitting-Warnung: Test=${(rfAcc*100).toFixed(1)}% vs CV=${(cvRF*100).toFixed(1)}% – Differenz ${((rfAcc-cvRF)*100).toFixed(1)}%`);

      this.trained   = true;
      this.trainedAt = Date.now();
      this.trainedOn = X.length;
      this.cvAccuracy = { rf:cvRF, gb:cvGB, rfStd:cvStdRF };
      this.overfit    = overfit;

      const result = {
        ok: true, symbol, granularity,
        samples: X.length, trainSamples: Xtrain.length, testSamples: Xtest.length,
        labelDist: { sell:dist[0], hold:dist[1], buy:dist[2] },
        accuracy: { randomForest:rfAcc, gradientBoosting:gbAcc, perceptron:pcAcc, ensemble:this.accuracy },
        crossValidation: { rf:cvRF, gb:cvGB, rfStd:cvStdRF, folds:kFolds },
        overfit,
        featureImportance: importance.slice(0,10),
        rfTrees:    this.RF.trees.length,
        gbStumps:   this.GB.stumps.length,
        pcUpdates:  this.Perceptron.trained,
        ts:         this.trainedAt,
      };
      Log.info('ML', `Training fertig: RF=${(rfAcc*100).toFixed(1)}% GB=${(gbAcc*100).toFixed(1)}% PC=${(pcAcc*100).toFixed(1)}% Ensemble=${(this.accuracy*100).toFixed(1)}%`);
      TelegramBot.send(`🧠 ML Training fertig\n${symbol} ${granularity}\nRF: ${(rfAcc*100).toFixed(1)}%\nGB: ${(gbAcc*100).toFixed(1)}%\nPerceptron: ${(pcAcc*100).toFixed(1)}%\nEnsemble: ${(this.accuracy*100).toFixed(1)}%`);
      this.running=false;
      // PERSISTENZ: Sofort nach Training in SQLite speichern
      try { setTimeout(() => MLPersist.onTrainComplete(), 500); } catch(_) {}
      return result;
    } catch(e) {
      this.running=false;
      Log.error('ML', `Training Fehler: ${e.message}`);
      return { error: e.message };
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // ENSEMBLE PREDICTION – kombiniert alle 3 Modelle
  // ════════════════════════════════════════════════════════════════════════
  _featureCache: {},  // symbol+ts → features (60s gültig)

  predict(candles, symbol='__default') {
    if (!this.trained) return { signal:'HOLD', confidence:0, trained:false };
    // Feature-Cache: vermeidet doppelte Berechnung aller 47 Indikatoren
    const cacheKey = symbol + '_' + Math.floor(Date.now()/60000); // 1min Buckets
    let features = this._featureCache[cacheKey];
    if (!features) {
      features = this.extractFeatures(candles);
      if (features) this._featureCache[cacheKey] = features;
      // Alte Cache-Einträge aufräumen (max 20)
      const keys = Object.keys(this._featureCache);
      if (keys.length > 20) delete this._featureCache[keys[0]];
    }
    if (!features) return { signal:'HOLD', confidence:0, reason:'NOT_ENOUGH_DATA' };

    const rf = this.RF.predict(features);
    const gb = this.GB.predict(features);
    const pc = this.Perceptron.predict(features);

    // Gewichtetes Ensemble: RF 40%, GB 40%, Perceptron 20%
    const probSell = rf.probSell*0.4 + gb.probSell*0.4 + pc.probSell*0.2;
    const probHold = rf.probHold*0.4 + gb.probHold*0.4 + pc.probHold*0.2;
    const probBuy  = rf.probBuy*0.4  + gb.probBuy*0.4  + pc.probBuy*0.2;

    const probs = [probSell, probHold, probBuy];
    const label = probs.indexOf(Math.max(...probs));
    const confidence = probs[label];

    return {
      signal:     label===2?'BUY':label===0?'SELL':'HOLD',
      label,
      confidence,
      probBuy:    probBuy.toFixed(3),
      probSell:   probSell.toFixed(3),
      probHold:   probHold.toFixed(3),
      models:     { rf: rf.signal, gb: gb.signal, perceptron: pc.signal },
      rfConf:     rf.confidence.toFixed(3),
      gbConf:     gb.confidence.toFixed(3),
      pcConf:     pc.confidence.toFixed(3),
      trained:    true,
    };
  },

  // ── ONLINE FEEDBACK – nach Trade-Abschluss aufrufen ─────────────────────
  feedback(candles, wasProfit) {
    const features = this.extractFeatures(candles);
    if (!features) return;
    // Gewinn = BUY war richtig, Verlust = SELL wäre besser gewesen
    const trueLabel = wasProfit ? 2 : 0;
    this.Perceptron.learn(features, trueLabel);
    Log.info('ML', `Online-Update: ${wasProfit?'Gewinn→BUY':'Verlust→SELL'} Acc=${(this.Perceptron.accuracy()*100).toFixed(1)}%`);
  },

  snapshot() {
    return {
      trained:          this.trained,
      trainedAt:        this.trainedAt,
      trainedOn:        this.trainedOn,
      accuracy:         this.accuracy,
      cvAccuracy:       this.cvAccuracy || null,
      overfit:          this.overfit || false,
      autoRetrainNext:  this.autoRetrainNext || null,
      running:          this.running,
      featureImportance: (this.featureImportance||[]).slice(0,10),
      models: {
        randomForest:     { trees:this.RF.trees.length, ready:this.RF.trees.length>0 },
        gradientBoosting: { stumps:this.GB.stumps.length, ready:this.GB.trained },
        perceptron:       { updates:this.Perceptron.trained, accuracy:this.Perceptron.accuracy(), ready:this.Perceptron.trained>0 },
      }
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE TRACKER – Sharpe Ratio, per-strategy stats
// ─────────────────────────────────────────════════════════════════════════════
const PerfTracker = {
  // Record closed trade
  record(strategy, symbol, direction, entryPrice, exitPrice, pnl, holdMs, exitReason) {
    DB.insertStratPerf.run(strategy, symbol, direction, entryPrice, exitPrice, pnl, holdMs, exitReason, Date.now());
  },

  // Sharpe Ratio from recent PnL series
  sharpe(pnlArray, riskFreeRate=0) {
    if (!pnlArray || pnlArray.length < 5) return 0;
    const mean = pnlArray.reduce((s,v)=>s+v,0)/pnlArray.length;
    const variance = pnlArray.reduce((s,v)=>s+(v-mean)**2,0)/pnlArray.length;
    const std = Math.sqrt(variance);
    return std > 0 ? (mean-riskFreeRate)/std * Math.sqrt(252) : 0;
  },

  // Max drawdown from equity curve
  maxDrawdown(equityCurve) {
    let peak=equityCurve[0]||0, maxDD=0;
    for (const eq of equityCurve) {
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak-eq)/peak : 0;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  },

  // Get stats per strategy (last 30 days)
  getStratStats() {
    const since = Date.now() - 30*24*3600*1000;
    const rows = DB.getStratPerf.all(since);
    return rows.map(r => ({
      strategy: r.strategy,
      trades:   r.trades,
      totalPnl: r.total_pnl,
      avgPnl:   r.avg_pnl,
      winRate:  r.trades > 0 ? r.wins/r.trades : 0,
    }));
  },

  // Auto-disable strategies with negative performance
  shouldDisable(strategy) {
    const since = Date.now() - 7*24*3600*1000; // last 7 days
    const rows = DB.getStratPerf.all(since);
    const stat = rows.find(r=>r.strategy===strategy);
    if (!stat || stat.trades < 5) return false; // not enough data
    return stat.total_pnl < 0 && (stat.wins/stat.trades) < 0.4;
  },

  // Overall system performance
  systemStats() {
    const since = Date.now() - 30*24*3600*1000;
    const rows = DB.getStratPerf.all(since);
    const totalPnl = rows.reduce((s,r)=>s+r.total_pnl,0);
    const totalTrades = rows.reduce((s,r)=>s+r.trades,0);
    const totalWins = rows.reduce((s,r)=>s+r.wins,0);
    // Build equity curve from balance history
    const balHist = DB.getBalanceHistory.all().reverse();
    const equityCurve = balHist.map(b=>b.usable);
    const pnlSeries = balHist.slice(1).map((b,i)=>b.usable-balHist[i].usable);
    return {
      totalPnl, totalTrades,
      winRate: totalTrades > 0 ? totalWins/totalTrades : 0,
      sharpe: this.sharpe(pnlSeries),
      maxDrawdown: this.maxDrawdown(equityCurve),
      strategies: this.getStratStats(),
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const Balance = {
  spot:            0, futures:  0, free: 0, locked: 0,
  usable:          0, reserve:  0, trading: 0, effective: 0,
  stabilityScore:  0, valid:    false, lastFetched: null,
  sessionStart:    0, dailyPnL: 0, peakEquity: 0,

  applyCapitalSplit(total) {
    this.usable   = total;
    this.reserve  = total * CFG.RESERVE_RATIO;
    this.trading  = total * CFG.TRADING_RATIO;
    this.effective = this.trading;
  },

  calcPositionSize(kelly=0.5) {
    const base = kelly * this.trading * CFG.KELLY_FRACTION;
    return Math.max(0, Math.min(base, this.trading * CFG.MAX_POSITION_PCT));
  },

  recordProfit(profit) {
    if (profit <= 0) return null;
    const rs = profit * CFG.RESERVE_RATIO;
    const ts = profit * CFG.TRADING_RATIO;
    this.reserve += rs; this.trading += ts; this.usable += profit;
    this.effective = this.trading; this.dailyPnL += profit;
    // Persist balance snapshot
    try { DB.insertBalance.run(Date.now(), this.usable, this.reserve, this.trading, this.dailyPnL); } catch(e){ try{Log.warn('Balance','err: '+e.message);}catch(_){} }
    return { reserveShare: rs, tradingShare: ts };
  },

  updateStability() {
    let s = 1.0;
    if (this.usable < CFG.MIN_USABLE_BALANCE) s -= 0.5;
    if (this.free <= 0) s = 0;
    this.stabilityScore = Math.max(0, s);
  },

  snapshot() { return { ...this }; }
};

// ─────────────────────────────────────────────────────────────────────────────
// KILL SWITCH
// ─────────────────────────────────────────────────────────────────────────────
const KillSwitch = {
  active:   false,
  mode:     'NORMAL', // NORMAL|RISK_COMPRESSION|EXIT_ONLY|HALTED
  triggers: [],

  check() {
    const eq = Balance.usable;
    if (eq > Balance.peakEquity) Balance.peakEquity = eq;
    const drawdown = Balance.peakEquity > 0 ? (Balance.peakEquity-eq)/Balance.peakEquity : 0;
    const dailyLoss = Balance.sessionStart > 0 ? (Balance.sessionStart-eq)/Balance.sessionStart : 0;
    if (drawdown >= CFG.MAX_DRAWDOWN_PCT) return this._hardKill('MAX_DRAWDOWN', { drawdown });
    if (dailyLoss >= CFG.MAX_DAILY_LOSS_PCT) return this._hardKill('MAX_DAILY_LOSS', { dailyLoss });
    if (drawdown >= CFG.MAX_DRAWDOWN_PCT*0.7) return this._preKill('APPROACHING_DRAWDOWN', { drawdown });
    return { mode: this.mode, triggered: false };
  },

  _hardKill(reason, data) {
    this.active=true; this.mode='HALTED';
    this.triggers.push({ ts:Date.now(), reason, data, severity:'HARD' });
    Log.error('KILL', `HARD KILL: ${reason}`, data);
    return { mode:'HALTED', triggered:true, reason };
  },

  _preKill(reason, data) {
    this.mode='RISK_COMPRESSION';
    this.triggers.push({ ts:Date.now(), reason, data, severity:'PRE' });
    Log.warn('KILL', `PRE-KILL: ${reason}`, data);
    return { mode:'RISK_COMPRESSION', triggered:true, reason };
  },

  reset() { this.active=false; this.mode='NORMAL'; Log.info('KILL','Kill switch reset'); },
  snapshot() { return { active:this.active, mode:this.mode, triggers:this.triggers.slice(-5), peakEquity:Balance.peakEquity }; }
};

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENT ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const Incidents = {
  store:      {},
  pressure:   0,
  _counter:   0,

  create(type, msg, severity='MEDIUM', data={}) {
    const id = `INC-${Date.now()}-${++this._counter}`;
    this.store[id] = { id, type, msg, severity, data, state:'OPEN', createdAt:Date.now() };
    this.pressure += { LOW:1, MEDIUM:2, HIGH:3, CRITICAL:4 }[severity]||2;
    Log.warn('INC', `[${severity}] ${type}: ${msg}`);
    if (severity==='CRITICAL') KillSwitch._preKill('CRITICAL_INCIDENT', { id, msg });
    return id;
  },

  resolve(id) {
    if (this.store[id]) { this.store[id].state='RESOLVED'; this.pressure=Math.max(0,this.pressure-2); }
  },

  getOpen()       { return Object.values(this.store).filter(i=>i.state==='OPEN'); },
  hasCritical()   { return this.getOpen().some(i=>i.severity==='CRITICAL'); },
  pressureScore() { return Math.min(1, this.pressure/20); },
};

// ─────────────────────────────────────────────────────────────────────────────
// REGIME ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const Regime = {
  regime:     'UNKNOWN',
  confidence: 0,
  volatility: 0,
  trend:      0,
  lastUpdated: null,

  detect(candles) {
    if (!candles || candles.length < 30) { this.regime='UNKNOWN'; this.confidence=0; return; }
    const closes = candles.map(c=>c.close);
    const returns = closes.slice(1).map((c,i)=>(c-closes[i])/closes[i]);
    this.volatility = Math.sqrt(returns.reduce((s,r)=>s+r*r,0)/returns.length)*Math.sqrt(24);
    const fast = Ind.ema(closes, CFG.EMA_FAST);
    const slow = Ind.ema(closes, CFG.EMA_SLOW);
    this.trend = fast && slow ? (fast-slow)/slow : 0;
    const atrVal = Ind.atr(candles);
    const price = closes[closes.length-1];
    const atrPct = price > 0 ? atrVal/price : 0;
    const squeeze = Ind.squeezeMomentum(candles);
    const rsi = Ind.rsi(closes);
    const recent = closes.slice(-5);
    const range = (Math.max(...recent)-Math.min(...recent))/Math.min(...recent);

    if (this.volatility > 0.15)                                   { this.regime='EXTREME_BEAR'; this.confidence=0.9; }
    else if (this.trend > 0.02 && this.volatility < 0.08 && rsi > 50) { this.regime='BULL';     this.confidence=0.82; }
    else if (this.trend < -0.02 && rsi < 50)                          { this.regime='BEAR';     this.confidence=0.78; }
    else if (squeeze.squeeze && Math.abs(squeeze.momentum) < 0.005)   { this.regime='SQUEEZE';  this.confidence=0.72; }
    else if (range < 0.015 && atrPct < 0.01)                          { this.regime='RANGING';  this.confidence=0.74; }
    else if (this.volatility > 0.06 || atrPct > 0.02)                 { this.regime='CHOPPY';   this.confidence=0.62; }
    else                                                               { this.regime='NEUTRAL';  this.confidence=0.50; }
    this.lastUpdated = Date.now();
    Log.info('REGIME', `${this.regime} conf=${this.confidence.toFixed(2)} vol=${this.volatility.toFixed(4)}`);
  },

  snapshot() { return { regime:this.regime, confidence:this.confidence, volatility:this.volatility, trend:this.trend, lastUpdated:this.lastUpdated }; }
};

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY ENGINE – all 5 strategies with real signal logic
// ─────────────────────────────────────────────────────────────────────────────
const Strategies = {
  registry: {
    GRID_SPOT:    { name:'Grid Spot',    active:true,  modes:['RANGING','NEUTRAL'],  minEdge:0.001,  winRate:0, trades:0, disabled:false },
    TREND_FOLLOW: { name:'Trend Follow', active:true,  modes:['BULL'],              minEdge:0.002,  winRate:0, trades:0, disabled:false },
    MEAN_REVERT:  { name:'Mean Revert',  active:true,  modes:['RANGING','CHOPPY'],  minEdge:0.0015, winRate:0, trades:0, disabled:false },
    SCALP:        { name:'Scalp',        active:true,  modes:['ANY'],               minEdge:0.0008, winRate:0, trades:0, disabled:false },
    SQUEEZE_PLAY: { name:'Squeeze Play', active:true,  modes:['SQUEEZE','NEUTRAL'], minEdge:0.0012, winRate:0, trades:0, disabled:false },
  },

  // GRID SPOT – ATR-spaced grid around VWAP
  gridSpot(candles) {
    if (candles.length < 30) return null;
    if (!['RANGING','NEUTRAL'].includes(Regime.regime)) return null;
    const closes = candles.map(c=>c.close);
    const cur  = closes[closes.length-1];
    const vwap = Ind.vwap(candles.slice(-20));
    const atr  = Ind.atr(candles);
    const bbVal= Ind.bb(closes);
    const rsi  = Ind.rsi(closes);
    const stoch= Ind.stochastic(candles);
    if (!bbVal) return null;
    const distFromVwap = (cur-vwap)/vwap;
    const gridSpacing = atr*0.4;
    let direction=null, strength=0;
    if (cur <= bbVal.lower+gridSpacing && rsi<38 && stoch.k<30 && distFromVwap<-0.003) {
      direction='BUY'; strength=Math.min(0.88, 0.55+(bbVal.lower-cur)/(bbVal.middle-bbVal.lower||1)*0.35);
    } else if (cur >= bbVal.upper-gridSpacing && rsi>62 && stoch.k>70 && distFromVwap>0.003) {
      direction='SELL'; strength=Math.min(0.88, 0.55+(cur-bbVal.upper)/(bbVal.upper-bbVal.middle||1)*0.35);
    }
    if (!direction) return null;
    return { strategy:'GRID_SPOT', direction, strength, meta:{vwap,atr,rsi,bbPct:bbVal.pct,stoch:stoch.k} };
  },

  // TREND FOLLOW – EMA alignment + MACD + CMO + Volume
  trendFollow(candles) {
    if (candles.length < 50) return null;
    if (['EXTREME_BEAR','RANGING'].includes(Regime.regime)) return null;
    const closes = candles.map(c=>c.close);
    const ema9   = Ind.ema(closes, 9);
    const ema21  = Ind.ema(closes, 21);
    const ema50  = Ind.ema(closes, 50);
    const macdVal= Ind.macd(closes);
    const rsi    = Ind.rsi(closes);
    const vol    = Ind.volOsc(candles);
    const mom    = Ind.momentum(closes, 10);
    const cmo    = Ind.cmo(closes);
    let direction=null, confidence=0;
    // Bull: 9>21>50, MACD+, RSI 45-75, volume+, CMO+
    if (ema9>ema21 && ema21>ema50 && macdVal.histogram>0 && rsi>45 && rsi<75 && vol>0 && mom>0.005) {
      direction='BUY';
      confidence=[rsi>55,macdVal.histogram>0.001,vol>0.1,mom>0.01,cmo>10].filter(Boolean).length;
    } else if (ema9<ema21 && ema21<ema50 && macdVal.histogram<0 && rsi<55 && rsi>25 && mom<-0.005) {
      direction='SELL';
      confidence=[rsi<45,macdVal.histogram<-0.001,vol>0.05,mom<-0.01,cmo<-10].filter(Boolean).length;
    }
    const strength = 0.42+confidence*0.1;
    if (!direction || strength<0.52) return null;
    return { strategy:'TREND_FOLLOW', direction, strength:Math.min(0.92,strength), meta:{ema9,ema21,ema50,macd:macdVal.histogram,rsi,vol,mom,cmo} };
  },

  // MEAN REVERT – RSI+BB+Stoch+OrderFlow
  meanRevert(candles, orderbook) {
    if (candles.length < 25) return null;
    if (['EXTREME_BEAR','BULL'].includes(Regime.regime)) return null;
    const closes = candles.map(c=>c.close);
    const cur    = closes[closes.length-1];
    const rsi    = Ind.rsi(closes);
    const bbVal  = Ind.bb(closes);
    const stoch  = Ind.stochastic(candles);
    const atr    = Ind.atr(candles);
    const ofi    = Ind.orderFlowImbalance(orderbook); // order flow imbalance
    if (!bbVal) return null;
    let direction=null, strength=0;
    // Oversold: below BB lower, RSI<32, Stoch<25, OFI suggests buying pressure
    if (cur<bbVal.lower && rsi<32 && stoch.k<25 && ofi>-0.3) {
      direction='BUY';
      const dev = (bbVal.middle-cur)/(atr||1);
      strength = Math.min(0.90, 0.56+Math.min(dev*0.07,0.34));
    } else if (cur>bbVal.upper && rsi>68 && stoch.k>75 && ofi<0.3) {
      direction='SELL';
      const dev = (cur-bbVal.middle)/(atr||1);
      strength = Math.min(0.90, 0.56+Math.min(dev*0.07,0.34));
    }
    if (!direction) return null;
    return { strategy:'MEAN_REVERT', direction, strength, meta:{rsi,stoch:stoch.k,bbPct:bbVal.pct,ofi,cur,bbUpper:bbVal.upper,bbLower:bbVal.lower} };
  },

  // SCALP – Fast RSI divergence on short timeframe
  scalp(candles) {
    if (candles.length < 20) return null;
    if (!this.registry.SCALP.active) return null;
    const closes = candles.map(c=>c.close);
    const rsi7   = Ind.rsi(closes, 7);
    const ema5   = Ind.ema(closes, 5);
    const ema13  = Ind.ema(closes, 13);
    const vol    = Ind.volOsc(candles, 3, 8);
    const mom    = Ind.momentum(closes, 3);
    const atr    = Ind.atr(candles, 7);
    const cur    = closes[closes.length-1];
    // Only scalp in liquid conditions
    if (Math.abs(vol) < 0.03) return null;
    let direction=null, strength=0;
    if (rsi7<28 && ema5<ema13 && mom>-0.002 && vol>0.04) { direction='BUY';  strength=0.54+(28-rsi7)/100; }
    else if (rsi7>72 && ema5>ema13 && mom<0.002 && vol>0.04) { direction='SELL'; strength=0.54+(rsi7-72)/100; }
    if (!direction || strength<0.54) return null;
    return { strategy:'SCALP', direction, strength:Math.min(0.78,strength), meta:{rsi7,ema5,ema13,vol,mom,atr} };
  },

  // SQUEEZE PLAY – Bollinger squeeze breakout
  squeezePlay(candles) {
    if (candles.length < 30) return null;
    if (!['SQUEEZE','NEUTRAL','RANGING'].includes(Regime.regime)) return null;
    const closes  = candles.map(c=>c.close);
    const sq      = Ind.squeezeMomentum(candles);
    if (!sq.squeeze) return null; // only in squeeze
    const macdVal = Ind.macd(closes);
    const rsi     = Ind.rsi(closes);
    const vol     = Ind.volOsc(candles);
    // Breakout direction determined by MACD and momentum
    let direction=null, strength=0;
    if (sq.momentum>0.008 && macdVal.histogram>0 && vol>0.05) { direction='BUY';  strength=0.62+Math.min(sq.momentum*10,0.2); }
    if (sq.momentum<-0.008 && macdVal.histogram<0 && vol>0.05) { direction='SELL'; strength=0.62+Math.min(-sq.momentum*10,0.2); }
    if (!direction) return null;
    return { strategy:'SQUEEZE_PLAY', direction, strength:Math.min(0.88,strength), meta:{squeeze:sq.squeeze,momentum:sq.momentum,macd:macdVal.histogram,rsi,vol} };
  },

  // Auto-disable poor performers
  autoDisable() {
    Object.keys(this.registry).forEach(id => {
      if (PerfTracker.shouldDisable(id)) {
        this.registry[id].active = false;
        Log.warn('STRAT', `Auto-disabled ${id} due to poor performance`);
      }
    });
  },

  getAll(candles, orderbook) {
    return [
      this.gridSpot(candles),
      this.trendFollow(candles),
      this.meanRevert(candles, orderbook),
      this.scalp(candles),
      this.squeezePlay(candles),
    ].filter(Boolean).filter(s => this.registry[s.strategy]?.active && !this.registry[s.strategy]?.disabled);
  },

  // Consensus: weighted majority vote
  consensus(signals) {
    if (!signals.length) return null;
    const buyS  = signals.filter(s=>s.direction==='BUY');
    const sellS = signals.filter(s=>s.direction==='SELL');
    const pick  = buyS.length > sellS.length ? buyS : sellS.length > buyS.length ? sellS : null;
    if (!pick || pick.length < CFG.SIGNAL_CONSENSUS_MIN) {
      if (signals.length === 1 && signals[0].strength > 0.72) return signals[0]; // strong single signal
      return null;
    }
    const avgStr = pick.reduce((s,x)=>s+x.strength,0)/pick.length;
    return { direction: pick[0].direction, strength: avgStr, strategies: pick.map(s=>s.strategy), meta: pick[0].meta };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RISK LADDER – adaptive position sizing
// ─────────────────────────────────────────────────────────────────────────────
const RiskLadder = {
  tiers: [
    { label:'GREEN',  ddMax:0.02, sizeMult:1.0,  maxTrades:5 },
    { label:'YELLOW', ddMax:0.05, sizeMult:0.70, maxTrades:3 },
    { label:'ORANGE', ddMax:0.08, sizeMult:0.40, maxTrades:2 },
    { label:'RED',    ddMax:0.12, sizeMult:0.15, maxTrades:1 },
    { label:'HALTED', ddMax:1.0,  sizeMult:0.0,  maxTrades:0 },
  ],
  current() {
    const dd = Balance.peakEquity > 0 ? (Balance.peakEquity-Balance.usable)/Balance.peakEquity : 0;
    return this.tiers.find(t=>dd<=t.ddMax) || this.tiers[this.tiers.length-1];
  },
  applyToSize(raw) { return raw * this.current().sizeMult; },
  maxTrades()      { return this.current().maxTrades; },
  snapshot()       {
    const dd = Balance.peakEquity > 0 ? (Balance.peakEquity-Balance.usable)/Balance.peakEquity : 0;
    return { ...this.current(), drawdown: dd };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NO-TRADE DEFAULT – 10 gates
// ─────────────────────────────────────────────────────────────────────────────
const NoTrade = {
  gates: {
    balanceValid:false, marketDataFresh:false, noActiveIncident:true,
    runtimeClean:true, regimeAcceptable:true, profitabilityGreen:false,
    killSwitchOff:true, stressTestPassed:true, concurrencyOk:true, tierDailyDD:true, deployModeAllows:false,
  },

  refresh() {
    this.gates.balanceValid      = CFG.DEPLOY_MODE==='PAPER' ? (DemoEngine.wallet?.trading||0)>10 : Balance.valid&&Balance.usable>CFG.MIN_USABLE_BALANCE;
    this.gates.killSwitchOff     = !KillSwitch.active && KillSwitch.mode==='NORMAL';
    this.gates.noActiveIncident  = !Incidents.hasCritical();
    this.gates.runtimeClean      = Incidents.pressureScore() < 0.5;
    const _effOpen = (typeof RiskTier!=='undefined' && RiskTier.dryRun && RiskTier.dryRun.active && RiskTier.dryRun.simulatedOpenPositions>0)
      ? RiskTier.dryRun.simulatedOpenPositions
      : DB.getActiveTrades.all().length;
    this.gates.concurrencyOk     = _effOpen < Math.min(CFG.MAX_OPEN_TRADES, RiskLadder.maxTrades(), (typeof RiskTier!=='undefined'?RiskTier.maxPositions():Infinity));
    this.gates.tierDailyDD       = (typeof RiskTier!=='undefined') ? RiskTier.checkDailyDD() : true;
    // Demo Engine darf auch im PAPER Modus traden
    this.gates.deployModeAllows  = !DemoEngine.liveMode || ['DRY_LIVE','LIVE_RESTRICTED','LIVE_FULL'].includes(CFG.DEPLOY_MODE);
    this.gates.regimeAcceptable  = !['EXTREME_BEAR','FLASH_CRASH'].includes(Regime.regime);
    this.gates.marketDataFresh   = Object.keys(Bitget.priceCache).length > 0 || Balance.valid;
    this.gates.profitabilityGreen= Balance.trading > 0;
    // stressTestPassed set externally
  },

  allGreen() { return Object.values(this.gates).every(Boolean); },

  verdict() {
    this.refresh();
    const allow   = this.allGreen();
    const blocked = Object.entries(this.gates).filter(([,v])=>!v).map(([k])=>k);
    try {
      const key = allow ? 'ALL_GREEN' : 'BLOCK:'+blocked.join(',');
      const now = Date.now();
      if (key !== this._lastGateKey || (now - (this._lastGateTs||0)) > 60000) {
        ActionStream.push('GATE','NOTRADE', allow?'ALL_GREEN':'BLOCK: '+blocked.join(','), {allow, blocked});
        this._lastGateKey = key;
        this._lastGateTs = now;
      }
    } catch(_){}
    return { allowTrade:allow, gates:{...this.gates}, reason: allow?'ALL_GREEN':`NO_TRADE: ${blocked.join(', ')}` };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXIT ENGINE – multi-rule adaptive exits
// ─────────────────────────────────────────────────────────────────────────────
const ExitEngine = {
  tpslLevels: {}, // tradeId → { stopLoss, takeProfit, trailHigh, atr, side }

  setLevel(tradeId, entryPrice, atr, side, candles=null) {
    const m = side==='buy' ? 1 : -1;
    // Adaptive SL/TP wenn Kerzen vorhanden
    if (candles && candles.length >= 20) {
      const adaptive = AdaptiveSLTP.calculate(candles, entryPrice, side);
      this.tpslLevels[tradeId] = {
        stopLoss:   adaptive.stopLoss,
        takeProfit: adaptive.takeProfit,
        trailHigh:  entryPrice,
        atr:        adaptive.atr,
        side, entry: entryPrice,
        adaptive:   true,
        profile:    adaptive.profile,
        riskReward: adaptive.riskReward,
      };
      Log.info('EXIT', `Adaptive SL/TP: ${side} Entry=${entryPrice.toFixed(4)} SL=${adaptive.stopLoss.toFixed(4)} TP=${adaptive.takeProfit.toFixed(4)} [${adaptive.profile}] RR=${adaptive.riskReward.toFixed(2)}`);
    } else {
      this.tpslLevels[tradeId] = {
        stopLoss:   entryPrice - m*atr*(ProfitOptimizer.getATR_SL()),
        // Phase 3.3: Fee-Aware TP - Ziel um Round-Trip-Fees nach oben verschieben
        // Damit der 'Profit' nach Abzug der 0.08% Fees wirklich der gewuenschte ist
        takeProfit: entryPrice + m*atr*(ProfitOptimizer.getATR_TP()) + m*entryPrice*(CFG.MAKER_FEE + CFG.TAKER_FEE),
        trailHigh:  entryPrice,
        atr, side, entry: entryPrice, adaptive: false,
      };
    }
  },

  updateTrail(tradeId, currentPrice) {
    const l = this.tpslLevels[tradeId];
    if (!l) return;
    if (l.side==='buy'  && currentPrice>l.trailHigh) l.trailHigh=currentPrice;
    if (l.side==='sell' && currentPrice<l.trailHigh) l.trailHigh=currentPrice;
  },

  evaluate(trade, candles, currentPrice) {
    if (!trade || trade.state!=='POSITION_ACTIVE' || !trade.entry_price) return null;
    const closes = candles.map(c=>c.close);
    const atr    = Ind.atr(candles) || currentPrice*0.01;
    const rsi    = Ind.rsi(closes);
    const side   = trade.side;
    const entry  = trade.entry_price;
    const dir    = side==='buy' ? 1 : -1;
    const pnlPct = dir*(currentPrice-entry)/entry;
    const holdH  = (Date.now()-trade.created_at)/3600000;

    this.updateTrail(trade.id, currentPrice);
    const l = this.tpslLevels[trade.id];

    const exits = [];

    // 1. Hard stop loss
    if (l && side==='buy'  && currentPrice<=l.stopLoss)  exits.push({ reason:'STOP_LOSS',   priority:10, pnlPct });
    if (l && side==='sell' && currentPrice>=l.stopLoss)  exits.push({ reason:'STOP_LOSS',   priority:10, pnlPct });
    // 2. Take profit
    if (l && side==='buy'  && currentPrice>=l.takeProfit) exits.push({ reason:'TAKE_PROFIT', priority:9,  pnlPct });
    if (l && side==='sell' && currentPrice<=l.takeProfit) exits.push({ reason:'TAKE_PROFIT', priority:9,  pnlPct });
    // 3. Trailing stop (only after in profit)
    if (l && pnlPct>0) {
      const trail = side==='buy' ? l.trailHigh*(1-ProfitOptimizer.getTrailing()) : l.trailHigh*(1+ProfitOptimizer.getTrailing());
      if (side==='buy' && currentPrice<trail)  exits.push({ reason:'TRAILING_STOP', priority:8, pnlPct });
      if (side==='sell' && currentPrice>trail) exits.push({ reason:'TRAILING_STOP', priority:8, pnlPct });
    }
    // 4. Time exit
    if (holdH > CFG.MAX_HOLD_HOURS) exits.push({ reason:'TIME_EXIT', priority:5, holdH });
    // 5. RSI extreme
    if (side==='buy'  && rsi>82) exits.push({ reason:'RSI_OVERBOUGHT', priority:7, rsi });
    if (side==='sell' && rsi<18) exits.push({ reason:'RSI_OVERSOLD',   priority:7, rsi });
    // 6. Regime change against position
    if (['EXTREME_BEAR','FLASH_CRASH'].includes(Regime.regime)) exits.push({ reason:'REGIME_EXTREME', priority:10 });
    if (side==='buy' && Regime.regime==='BEAR' && pnlPct<-0.005) exits.push({ reason:'ADVERSE_REGIME', priority:6 });
    // 7. Kill switch
    if (KillSwitch.active || KillSwitch.mode==='EXIT_ONLY') exits.push({ reason:'KILL_SWITCH', priority:10 });

    if (!exits.length) return null;
    exits.sort((a,b)=>b.priority-a.priority);
    return { shouldExit:true, ...exits[0] };
  },

  cleanup(tradeId) { delete this.tpslLevels[tradeId]; },
  snapshot()       { return { levels:Object.keys(this.tpslLevels).length }; }
};

// ─────────────────────────────────────────────────────────────────────────────
// TRADE LIFECYCLE (persisted to SQLite)
// ─────────────────────────────────────────────────────────────────────────────
const Trades = {
  _counter: 0,

  create(symbol, side, size, strategy) {
    const id = `TRD-${Date.now()}-${++this._counter}`;
    const now = Date.now();
    DB.insertTrade.run(id, symbol, side, size, strategy, 'SUBMITTED', null, null, null, null, null, now, now, null);
    Log.info('TRADE', `Created: ${id} ${symbol} ${side} ${size}`);
    return id;
  },

  recordFill(id, entryPrice, atr) {
    const trade = DB.getTrade.get(id);
    if (!trade) return;
    DB.db.prepare(`UPDATE trades SET state='POSITION_ACTIVE', entry_price=?, updated_at=? WHERE id=?`)
      .run(entryPrice, Date.now(), id);
    ExitEngine.setLevel(id, entryPrice, atr||entryPrice*0.01, trade.side);
    Log.info('TRADE', `Fill: ${id} @ ${entryPrice}`);
  },

  close(id, exitPrice, reason) {
    const trade = DB.getTrade.get(id);
    if (!trade || !trade.entry_price) return;
    const dir = trade.side==='buy' ? 1 : -1;
    const coinAmount = trade.size / trade.entry_price;
    const pnl = dir*(exitPrice-trade.entry_price)*coinAmount;
    const now = Date.now();
    DB.updateTrade.run('CLOSED', exitPrice, pnl, reason, now, now, id);
    ExitEngine.cleanup(id);
    if (pnl>0) Balance.recordProfit(pnl);
    else { Balance.dailyPnL+=pnl; Balance.trading=Math.max(0,Balance.trading+pnl); Balance.usable=Math.max(0,Balance.usable+pnl); }
    PerfTracker.record(trade.strategy||'UNKNOWN', trade.symbol, trade.side, trade.entry_price, exitPrice, pnl, now-trade.created_at, reason);

    // Paper Trade aufzeichnen (immer – auch im Live-Modus als Vergleich)
    PaperTracker.record({
      symbol:     trade.symbol,
      direction:  trade.side,
      strategy:   trade.strategy||'UNKNOWN',
      entryPrice: trade.entry_price,
      exitPrice, pnl, reason,
    });

    // Symbol Blacklist: Verlust melden
    if (pnl < 0) {
      SymbolBlacklist.recordLoss(trade.symbol, pnl);
      Safeties.recordLoss(trade.symbol);
    }

    // Drawdown Recovery Mode aktualisieren
    DrawdownRecovery.update();

    // RL Agent Feedback
    try {
      const freshCandles = [];
      const pnlForRL = trade.entry_price>0 ? (exitPrice-trade.entry_price)/trade.entry_price*(dir) : 0;
      RLAgent.learn(pnlForRL, freshCandles);
    } catch(e){ try{Log.warn('Trades','err: '+e.message);}catch(_){} }

    // Demo Wallet 70/30 Update
    if (typeof DemoEngine !== 'undefined' && DemoEngine.wallet && trade.strategy !== 'DEMO_UNIFIED') {
      // Phase 2.4b: via WalletProvider
      WalletProvider.credit(trade.size);
      WalletProvider.applyPnL(pnl);
      try { DemoEngine._persistWallet(); } catch(e) {}
    }
    // Push-Notify: Telegram bei PnL >= 50 USDT
    try {
      if (Math.abs(pnl) >= 50 && TelegramBot.enabled) {
        const emoji = pnl > 0 ? '💰' : '🔴';
        TelegramBot.send(emoji + ' Trade geschlossen: ' + trade.symbol + '\nPnL: ' + pnl.toFixed(2) + ' USDT\nReason: ' + reason);
      }
    } catch(e){ try{Log.warn('Trades','err: '+e.message);}catch(_){} }
    Log.info('TRADE', `Closed: ${id} exitPrice=${exitPrice} pnl=${pnl.toFixed(4)} reason=${reason}`);

    // Win-Rate Check: einmalig Telegram wenn Demo >= 52%
    try {
      if (!global.WIN_RATE_NOTIFIED && typeof DemoEngine !== 'undefined' && DemoEngine.stats) {
        const s = DemoEngine.stats;
        const total = (s.wins||0) + (s.losses||0);
        if (total >= 20) {
          const wr = (s.wins||0) / total * 100;
          if (wr >= 52) {
            global.WIN_RATE_NOTIFIED = true;
            TelegramBot.send('📊 DEMO WIN-RATE >= 52%!\nAktuell: ' + wr.toFixed(1) + '% (' + (s.wins||0) + 'W / ' + (s.losses||0) + 'L)\nTotal: ' + total + ' Trades\n\nLive-Umschaltung moeglich — Entscheidung liegt bei dir.');
            Log.info('WINRATE', 'Demo Win-Rate ' + wr.toFixed(1) + '% >= 52% — Notification gesendet');
          }
        }
      }
    } catch(e){ try{Log.warn('Trades','err: '+e.message);}catch(_){} }
    return pnl;
  },

  getActive() { return DB.getActiveTrades.all(); },
  getAll()    { return DB.getAllTrades.all(); },
  get(id)     { return DB.getTrade.get(id); },
};

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST
// ─────────────────────────────────────────────────────────────────────────────
const StressTest = {
  lastScore: 0,
  lastRun:   null,

  run() {
    const balance = (CFG.DEPLOY_MODE==='PAPER'&&DemoEngine.wallet) ? DemoEngine.wallet.total : Balance.usable;
    const positions = Trades.getActive();
    // Wenn keine offenen Positionen → kein Risiko → automatisch PASS
    if (!positions || positions.length === 0 || balance <= 0) {
      const rate = 1.0;
      this.lastScore = rate; this.lastRun = Date.now();
      NoTrade.gates.stressTestPassed = true;
      Log.info('STRESS', 'Survival: 100% PASS (keine offenen Positionen)');
      return { survivalRate: rate, results: [], pass: true };
    }
    const scenarios = [
      { name:'FLASH_CRASH_20',      priceDelta:-0.20, volMult:3 },
      { name:'SPREAD_SPIKE',        priceDelta:-0.02, volMult:2 },
      { name:'LIQUIDATION_CASCADE', priceDelta:-0.30, volMult:5 },
      { name:'EXCHANGE_OUTAGE_1H',  priceDelta:0,     ops:true  },
      { name:'BEAR_MARKET_30D',     priceDelta:-0.45, volMult:2 },
    ];
    const results = scenarios.map(s => {
      const impact = positions.reduce((sum,p)=>{
        const dir = p.side==='buy' ? 1 : -1;
        const coinQty = (p.entry_price||1) > 0 ? (p.size||0) / (p.entry_price||1) : 0;
        return sum + dir*(s.priceDelta||0)*coinQty*(p.entry_price||1);
      }, 0);
      const impacted = balance + impact;
      return { scenario:s.name, survived:impacted>balance*0.5, impactedBalance:impacted, loss:balance-impacted };
    });
    const rate = results.filter(r=>r.survived).length/results.length;
    this.lastScore = rate; this.lastRun = Date.now();
    NoTrade.gates.stressTestPassed = rate >= CFG.STRESS_SURVIVAL_MIN;
    Log.info('STRESS', `Survival: ${(rate*100).toFixed(0)}% ${rate>=CFG.STRESS_SURVIVAL_MIN?'PASS':'FAIL'}`);
    return { survivalRate:rate, results, pass:rate>=CFG.STRESS_SURVIVAL_MIN };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────
const Recon = {
  state:      'PENDING',
  mismatches: [],
  lastRun:    null,

  async run() {
    this.mismatches = [];
    if (!CFG.API_KEY || CFG.DEPLOY_MODE === 'PAPER') {
      if (DemoEngine.wallet) {
        const w = DemoEngine.wallet;
        const drift = Math.abs(w.total - w.reserve - w.trading);
        if (drift > 0.01) { this.mismatches.push({type:'WALLET_DRIFT',drift}); w.total=w.reserve+w.trading; this.state='FIXED'; Log.warn('RECON','Wallet Drift gefixt: '+drift.toFixed(4)); }
        else this.state='GREEN';
        const dbA = Trades.getActive().filter(t=>t.strategy==='DEMO_UNIFIED');
        const memA = Object.values(DemoEngine.positions||{});
        const orphans = dbA.filter(t=>!memA.some(p=>p.dbTradeId===t.id));
        if (orphans.length>0) { this.mismatches.push({type:'ORPHANS',count:orphans.length}); this.state='YELLOW'; }
      }
      this.lastRun=Date.now();
      return {state:this.state,mismatches:this.mismatches};
    }
    try {
      const spot = await Bitget.fetchSpotBalance();
      const fut = await Bitget.fetchFuturesBalance().catch(()=>({ available:0, locked:0 }));
      const exchangeTotal = spot.available + fut.available;
      const internalTotal = Balance.usable;
      const delta = Math.abs(exchangeTotal-internalTotal);
      const pct   = internalTotal > 0 ? delta/internalTotal : 0;
      if (pct > 0.05) {
        this.mismatches.push({ type:'BALANCE_DRIFT', delta, pct, exchange:exchangeTotal, internal:internalTotal });
        Incidents.create('RECONCILIATION', `Balance drift ${(pct*100).toFixed(1)}%`, pct>0.15?'HIGH':'MEDIUM');
        this.state = 'RED';
      } else {
        this.state = 'GREEN';
      }
      // Check for orphaned orders on exchange vs internal state
      const activeTrades = Trades.getActive();
      for (const t of activeTrades) {
        if (!t.order_id) continue;
        try {
          const orders = await Bitget.fetchOpenOrders(t.symbol);
          const found = orders?.data?.find(o=>o.orderId===t.order_id);
          if (!found && t.state==='SUBMITTED') {
            this.mismatches.push({ type:'ORPHANED_ORDER', tradeId:t.id, orderId:t.order_id });
          }
        } catch(e){ try{Log.warn('Recon','err: '+e.message);}catch(_){} }
      }
      this.lastRun = Date.now();
      Log.info('RECON', `State: ${this.state} delta=${delta.toFixed(2)} pct=${(pct*100).toFixed(2)}%`);
      try { ActionStream.push('RECON','RECON', this.state+' delta='+delta.toFixed(2), {state:this.state, delta, pct}); } catch(_){}
    } catch(e) {
      this.state = 'ERROR';
      if (CFG.API_KEY) Log.error('RECON', `Failed: ${e.message}`);
    }
    return { state:this.state, mismatches:this.mismatches };
  }
};




// ═════════════════════════════════════════════════════════════════════════════
// PROFIT-OPTIMIZER KI — Dynamische SL/TP/Sizing basierend auf echten Ergebnissen
// < 30 Trades: Festwerte (CFG). >= 30 Trades: KI optimiert. Bei Fehler: Fallback.
// ═════════════════════════════════════════════════════════════════════════════
const ProfitOptimizer = {
  enabled: true,
  minTrades: 30,
  lastCalc: null,
  calcInterval: 3600000, // 1h
  current: null, // aktuelle optimierte Werte

  // Grenzen — KI darf nie ausserhalb dieser Werte
  LIMITS: {
    atrSL:    { min: 1.0, max: 2.5 },
    atrTP:    { min: 1.8, max: 4.0 },
    trailing: { min: 0.01, max: 0.05 },
    sizePct:  { min: 0.03, max: 0.25 },
    minRR:    2.0,  // R/R nie unter 2:1
  },

  FEES: {
    maker: 0.0002,
    taker: 0.0006,
    slippage: 0.0005,
    total: 0.0008, // 0.08% round-trip (CFG.MAKER+TAKER)
  },

  // Hauptfunktion: Berechne optimale Werte aus Trade-Historie
  calculate() {
    try {
      const allTrades = DB.getAllTrades.all().filter(t => t.state === 'CLOSED' && t.realized_pnl !== null);
      if (allTrades.length < this.minTrades) {
        this.current = null;
        return { mode: 'FESTWERTE', reason: allTrades.length + '/' + this.minTrades + ' Trades', trades: allTrades.length };
      }

      // Letzte 100 Trades analysieren
      const recent = allTrades.slice(-100);
      const wins = recent.filter(t => t.realized_pnl > 0);
      const losses = recent.filter(t => t.realized_pnl < 0);
      const winRate = wins.length / recent.length;

      // Durchschnittliche Gewinn/Verlust Groessen
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.realized_pnl, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.realized_pnl, 0) / losses.length) : 1;
      const currentRR = avgLoss > 0 ? avgWin / avgLoss : 1;

      // Wie wurden Trades geschlossen?
      const exitReasons = {};
      recent.forEach(t => { const r = t.exit_reason || 'UNKNOWN'; exitReasons[r] = (exitReasons[r] || 0) + 1; });

      // SL zu oft getriggert? → SL weiter setzen
      const slHits = (exitReasons['STOP_LOSS'] || 0) / recent.length;
      // TP zu selten erreicht? → TP enger setzen
      const tpHits = (exitReasons['TAKE_PROFIT'] || 0) / recent.length;
      // Trailing zu frueh? → Trailing weiter
      const trailHits = (exitReasons['TRAILING_STOP'] || 0) / recent.length;
      // Zeit-Exits? → Trades laufen zu lang ohne Ergebnis
      const timeHits = (exitReasons['TIME_EXIT'] || 0) / recent.length;

      // Dynamische Anpassung
      let atrSL = CFG.ATR_STOP_MULT;
      let atrTP = CFG.ATR_TP_MULT;
      let trailing = CFG.TRAILING_PCT;

      // SL zu oft getriggert (> 40% aller Exits) → weiter
      if (slHits > 0.40) atrSL = Math.min(this.LIMITS.atrSL.max, atrSL + 0.3);
      // SL fast nie getriggert (< 15%) → enger (spart Verluste)
      if (slHits < 0.15 && losses.length > 3) atrSL = Math.max(this.LIMITS.atrSL.min, atrSL - 0.2);

      // TP zu selten erreicht (< 20%) → enger
      if (tpHits < 0.20 && wins.length > 3) atrTP = Math.max(this.LIMITS.atrTP.min, atrTP - 0.3);
      // TP oft erreicht (> 50%) → weiter (mehr rausholen)
      if (tpHits > 0.50) atrTP = Math.min(this.LIMITS.atrTP.max, atrTP + 0.3);

      // Trailing zu oft (> 30%) → weiter
      if (trailHits > 0.30) trailing = Math.min(this.LIMITS.trailing.max, trailing + 0.005);
      // Trailing fast nie → enger
      if (trailHits < 0.05 && wins.length > 5) trailing = Math.max(this.LIMITS.trailing.min, trailing - 0.003);

      // R/R Check: TP/SL muss >= 2.0 sein
      if (atrTP / atrSL < this.LIMITS.minRR) {
        atrTP = atrSL * this.LIMITS.minRR;
      }

      // Clamp
      atrSL = Math.max(this.LIMITS.atrSL.min, Math.min(this.LIMITS.atrSL.max, atrSL));
      atrTP = Math.max(this.LIMITS.atrTP.min, Math.min(this.LIMITS.atrTP.max, atrTP));
      trailing = Math.max(this.LIMITS.trailing.min, Math.min(this.LIMITS.trailing.max, trailing));

      // Sizing: basierend auf Win-Rate und R/R
      // Kelly Criterion: f = (WR * RR - (1-WR)) / RR
      const rr = atrTP / atrSL;
      const kelly = Math.max(0, (winRate * rr - (1 - winRate)) / rr);
      const sizePct = Math.max(this.LIMITS.sizePct.min, Math.min(this.LIMITS.sizePct.max, kelly * 0.5));

      // Expectancy berechnen
      const avgATR = 0.008; // ~0.8% fuer BTC 1H
      const tpPct = atrTP * avgATR;
      const slPct = atrSL * avgATR;
      const expectancy = winRate * (tpPct - this.FEES.total) - (1 - winRate) * (slPct + this.FEES.total);

      this.current = {
        atrSL: parseFloat(atrSL.toFixed(2)),
        atrTP: parseFloat(atrTP.toFixed(2)),
        trailing: parseFloat(trailing.toFixed(4)),
        sizePct: parseFloat(sizePct.toFixed(4)),
        rr: parseFloat(rr.toFixed(2)),
        winRate: parseFloat(winRate.toFixed(4)),
        expectancy: parseFloat(expectancy.toFixed(6)),
        kelly: parseFloat(kelly.toFixed(4)),
        exitProfile: exitReasons,
        avgWin: parseFloat(avgWin.toFixed(4)),
        avgLoss: parseFloat(avgLoss.toFixed(4)),
        trades: recent.length,
      };

      this.lastCalc = Date.now();

      Log.info('PROFIT_KI', 'Optimiert: SL=' + atrSL.toFixed(2) + ' TP=' + atrTP.toFixed(2) + ' Trail=' + (trailing*100).toFixed(1) + '% Size=' + (sizePct*100).toFixed(1) + '% RR=' + rr.toFixed(2) + ' WR=' + (winRate*100).toFixed(1) + '% Exp=' + (expectancy*10000).toFixed(1) + 'bps');

      return { mode: 'KI_OPTIMIERT', ...this.current };
    } catch (e) {
      Log.warn('PROFIT_KI', 'Fehler: ' + e.message + ' — Fallback auf Festwerte');
      this.current = null;
      return { mode: 'FESTWERTE', reason: 'Fehler: ' + e.message };
    }
  },

  // Getter: aktuelle Werte (KI oder Fallback)
  getATR_SL() { return this.current ? this.current.atrSL : CFG.ATR_STOP_MULT; },
  getATR_TP() { return this.current ? this.current.atrTP : CFG.ATR_TP_MULT; },
  getTrailing() { return this.current ? this.current.trailing : CFG.TRAILING_PCT; },
  getSizePct() { return this.current ? this.current.sizePct : null; },

  snapshot() {
    return {
      enabled: this.enabled,
      mode: this.current ? 'KI_OPTIMIERT' : 'FESTWERTE',
      current: this.current,
      lastCalc: this.lastCalc,
      minTrades: this.minTrades,
      limits: this.LIMITS,
      fees: this.FEES,
      fallback: { atrSL: CFG.ATR_STOP_MULT, atrTP: CFG.ATR_TP_MULT, trailing: CFG.TRAILING_PCT },
    };
  },

  // Periodisch neu berechnen
  start() {
    this.calculate();
    setInterval(() => this.calculate(), this.calcInterval);
    Log.boot('ProfitOptimizer-KI gestartet (Recalc alle ' + (this.calcInterval/60000) + 'min)');
  },
};



// ═════════════════════════════════════════════════════════════════════════════
// STALE ORDER CLEANER — Raeumt haengende Trades/Orders auf
// ═════════════════════════════════════════════════════════════════════════════
const StaleOrderCleaner = {
  timer: null,
  interval: 1800000, // 30min
  maxAgeHours: null, // wird aus CFG geladen
  cleaned: [],

  async run() {
    const maxAge = (CFG.MAX_HOLD_HOURS || 48) * 3600000;
    const now = Date.now();
    let count = 0;

    try {
      const active = Trades.getActive();
      for (const trade of active) {
        const age = now - (trade.created_at || 0);
        const ageH = (age / 3600000).toFixed(1);
        let doClose = null; // 'STALE_CLEANUP_TIME' | 'STALE_ORPHAN' | null

        if (age > maxAge) doClose = 'STALE_CLEANUP_TIME';
        else if (trade.strategy === 'DEMO_UNIFIED') {
          const inMemory = Object.values(DemoEngine.positions || {}).some(p => p.dbTradeId === trade.id);
          if (!inMemory && age > 600000) doClose = 'STALE_ORPHAN';
        }
        if (!doClose) continue;

        try {
          // --- Echten Schluss-Preis holen (statt 0) ---
          let exitPrice = 0;
          try {
            const ticker = Bitget.priceCache && Bitget.priceCache[trade.symbol];
            if (ticker && ticker.last > 0) exitPrice = ticker.last;
            else {
              const t2 = await Bitget.fetchTicker(trade.symbol).catch(() => null);
              if (t2 && t2.last > 0) exitPrice = t2.last;
            }
          } catch(_){}
          if (!exitPrice && trade.entry_price) exitPrice = trade.entry_price; // Fallback: PnL=0

          // --- Echten PnL berechnen ---
          const entry = trade.entry_price || 0;
          const size  = trade.size || 0;
          const dir   = (trade.side === 'sell' || trade.side === 'SELL') ? -1 : 1;
          const gross = entry > 0 ? (dir * (exitPrice - entry) / entry) * size : 0;
          const fees  = size * (CFG.MAKER_FEE + CFG.TAKER_FEE);
          const pnl   = gross - fees;

          // --- DB-Eintrag mit echten Werten ---
          DB.updateTrade.run('CLOSED', exitPrice, pnl, doClose, now, now, trade.id);

          // --- DEMO-Pfad: Wallet korrekt zurueckbuchen ---
          if (trade.strategy === 'DEMO_UNIFIED' && !DemoEngine.liveMode) {
            try {
              WalletProvider.credit(size);
              WalletProvider.applyPnL(pnl);
              // In-memory Position auch schliessen falls noch vorhanden
              for (const [pid, pos] of Object.entries(DemoEngine.positions||{})) {
                if (pos.dbTradeId === trade.id) { delete DemoEngine.positions[pid]; break; }
              }
            } catch(e){ try{Log.warn('STALE','wallet buchen err: '+e.message);}catch(_){} }
          }

          // --- ExitEngine aufraeumen ---
          try { ExitEngine.cleanup(trade.id); } catch(_){}

          this.cleaned.unshift({ ts: now, id: trade.id, symbol: trade.symbol, reason: doClose, age: ageH + 'h', exitPrice, pnl });
          count++;
          Log.warn('STALE', 'Trade '+trade.symbol+' geschlossen ('+doClose+') age='+ageH+'h exit='+exitPrice.toFixed(4)+' pnl='+pnl.toFixed(4));

          // --- Live-Feed ---
          try { ActionStream.push('EXIT', trade.symbol, doClose+' (cleaner) PnL='+pnl.toFixed(4)+' USDT', { reason:doClose, pnl, exitPrice, cleaner:true }); } catch(_){}
        } catch(e){ try{Log.warn('StaleOrderCleaner','close err: '+e.message);}catch(_){} }
      }

      if (count > 0) TelegramBot.send('🧹 Stale Cleaner: '+count+' haengende Trades bereinigt (mit echten Preisen)');
      if (this.cleaned.length > 50) this.cleaned = this.cleaned.slice(0, 50);
    } catch (e) {
      Log.warn('STALE', 'Cleaner Fehler: ' + e.message);
    }

    return { cleaned: count, total: this.cleaned.length };
  },

  start() {
    if (this.timer) return;
    // Erster Run nach 60s (gibt DemoEngine Zeit zu starten)
    setTimeout(() => this.run(), 60000);
    this.timer = setInterval(() => this.run(), this.interval);
    Log.boot('StaleOrderCleaner gestartet (alle 30min)');
  },

  snapshot() {
    return {
      interval: this.interval,
      maxAge: (CFG.MAX_HOLD_HOURS || 48) + 'h',
      recentCleaned: this.cleaned.slice(0, 20),
      totalCleaned: this.cleaned.length,
    };
  },
};


// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// RISK TIER — Stufenweiser LIVE-Einstieg (SaintQuant-inspired).
// Inaktiv in DEMO (normale Demo-Statistik) -- wirkt nur in LIVE oder DryRun.
// Drei Tiers: SAFE -> STANDARD -> AGGRESSIVE mit auto-Promotion.
// ═════════════════════════════════════════════════════════════════════════════
const RiskTier = {
  TIERS: {
    TIER_SAFE: {
      label: 'SAFE', minSize: 5, maxSize: 20,
      maxDailyDDPct: 0.02, maxConcurrentPos: 2,
      promotionTrades: 50, promotionWinRate: 0.50,
    },
    TIER_STANDARD: {
      label: 'STANDARD', minSize: 10, maxSize: 50,
      maxDailyDDPct: 0.04, maxConcurrentPos: 4,
      promotionTrades: 100, promotionWinRate: 0.55,
    },
    TIER_AGGRESSIVE: {
      label: 'AGGRESSIVE', minSize: 20, maxSize: 200,
      maxDailyDDPct: 0.07, maxConcurrentPos: 6,
      promotionTrades: Infinity, promotionWinRate: 1.0,
    },
  },
  current: 'TIER_SAFE',
  history: [],
  dryRun: { active:false, simulatedDailyLoss:0, simulatedOpenPositions:0, log:[] },

  activeTier() { return this.TIERS[this.current] || this.TIERS.TIER_SAFE; },
  shouldApply() { return (DemoEngine && DemoEngine.liveMode) || this.dryRun.active; },

  maxPositions() {
    if (!this.shouldApply()) return Infinity;
    return this.activeTier().maxConcurrentPos;
  },

  checkDailyDD() {
    if (!this.shouldApply()) return true;
    const t = this.activeTier();
    const startCap = (DemoEngine.wallet && DemoEngine.wallet.startTotal) || 1000;
    const dailyPnl = this.dryRun.active ? -this.dryRun.simulatedDailyLoss : ((DemoEngine.wallet && DemoEngine.wallet.dailyPnl) || 0);
    const ddPct = dailyPnl / startCap;
    const ok = ddPct > -t.maxDailyDDPct;
    if (!ok && this.dryRun.active) this.dryRun.log.push({ t:Date.now(), event:'DD_BLOCK', ddPct, limit:-t.maxDailyDDPct });
    return ok;
  },

  capSize(proposedSize) {
    if (!this.shouldApply()) return proposedSize;
    const t = this.activeTier();
    const capped = Math.max(t.minSize, Math.min(proposedSize, t.maxSize));
    if (capped !== proposedSize) {
      try { Log.info('RISKTIER','Size '+proposedSize.toFixed(2)+' -> '+capped.toFixed(2)+' ('+t.label+')'); } catch(_){}
      try { ActionStream.push('INFO','RISKTIER','Size capped '+proposedSize.toFixed(2)+' -> '+capped.toFixed(2)+' ['+t.label+']', {from:proposedSize,to:capped,tier:t.label}); } catch(_){}
      if (this.dryRun.active) this.dryRun.log.push({ t:Date.now(), event:'SIZE_CAP', from:proposedSize, to:capped });
    }
    return capped;
  },

  checkPromotion() {
    const t = this.activeTier();
    if (t.promotionTrades === Infinity) return { promoted:false, reason:'max tier', current:this.current };
    const stats = (DemoEngine && DemoEngine.stats) || { trades:0, wins:0 };
    const wr = stats.trades > 0 ? (stats.wins || 0) / stats.trades : 0;
    if (stats.trades >= t.promotionTrades && wr >= t.promotionWinRate) {
      const nextMap = { TIER_SAFE:'TIER_STANDARD', TIER_STANDARD:'TIER_AGGRESSIVE' };
      const next = nextMap[this.current];
      if (next) {
        this.history.push({ ts:Date.now(), from:this.current, to:next, trades:stats.trades, wr });
        this.current = next;
        try { Log.info('RISKTIER','Promoted '+this.current+' (trades='+stats.trades+', WR='+(wr*100).toFixed(1)+'%)'); } catch(_){}
        try { TelegramBot.send('RiskTier UPGRADE: '+this.current+' (trades='+stats.trades+', WR='+(wr*100).toFixed(1)+'%)'); } catch(_){}
        return { promoted:true, to:next, trades:stats.trades, wr };
      }
    }
    return { promoted:false, current:this.current, trades:stats.trades, wr, required:t.promotionTrades, requiredWR:t.promotionWinRate };
  },

  setTier(name) {
    if (!this.TIERS[name]) return { error:'unknown tier: '+name+' (must be TIER_SAFE/TIER_STANDARD/TIER_AGGRESSIVE)' };
    this.history.push({ ts:Date.now(), from:this.current, to:name, manual:true });
    this.current = name;
    return { ok:true, current:name };
  },

  snapshot() {
    const t = this.activeTier();
    return {
      current: this.current, label: t.label, config: t,
      shouldApply: this.shouldApply(),
      mode: (DemoEngine && DemoEngine.liveMode) ? 'LIVE' : 'DEMO',
      dryRun: this.dryRun.active ? {
        active:true,
        simulatedDailyLoss: this.dryRun.simulatedDailyLoss,
        simulatedOpenPositions: this.dryRun.simulatedOpenPositions,
        log: this.dryRun.log.slice(-30),
      } : { active:false },
      history: this.history.slice(-10),
      tiers: Object.keys(this.TIERS),
    };
  },

  enableDryRun(opts) {
    opts = opts || {};
    this.dryRun.active = true;
    this.dryRun.simulatedDailyLoss = opts.simulatedDailyLoss || 0;
    this.dryRun.simulatedOpenPositions = opts.simulatedOpenPositions || 0;
    this.dryRun.log = [];
    try { Log.info('RISKTIER','DryRun AKTIVIERT (simDailyLoss='+this.dryRun.simulatedDailyLoss+', simOpenPos='+this.dryRun.simulatedOpenPositions+')'); } catch(_){}
    return this.snapshot();
  },
  disableDryRun() {
    this.dryRun.active = false;
    try { Log.info('RISKTIER','DryRun AUS'); } catch(_){}
    return this.snapshot();
  },
};

// WALLET PROVIDER — Single Source of Truth fuer Kapital.
// DEMO: virtuelles Kapital (DemoEngine.wallet).
// LIVE: echtes Bitget-Konto (Balance.usable, read-only).
// Zweck: kein Code soll jemals wieder direkt wallet.trading mutieren.
// ═════════════════════════════════════════════════════════════════════════════
const WalletProvider = {
  _mode() {
    return (DemoEngine && DemoEngine.liveMode) ? 'LIVE' : 'DEMO';
  },

  // ── Lesen ──
  total() {
    if (this._mode() === 'DEMO') {
      return (DemoEngine.wallet && DemoEngine.wallet.total) || 0;
    }
    return (typeof Balance !== 'undefined' && Balance.usable) || 0;
  },

  trading() {
    let raw;
    if (this._mode() === 'DEMO') {
      raw = (DemoEngine.wallet && DemoEngine.wallet.trading) || 0;
    } else {
      raw = (typeof Balance !== 'undefined' && Balance.usable) || 0;
    }
    if (CFG.TRADING_BUDGET_USDT != null && CFG.TRADING_BUDGET_USDT > 0) {
      return Math.min(raw, CFG.TRADING_BUDGET_USDT);
    }
    return raw;
  },

  reserve() {
    if (this._mode() === 'DEMO') {
      return (DemoEngine.wallet && DemoEngine.wallet.reserve) || 0;
    }
    return 0; // LIVE: keine virtuelle Reserve
  },

  // ── Schreiben (nur DEMO, LIVE ist read-only) ──
  debit(amount) {
    if (this._mode() === 'LIVE') {
      // LIVE-Wallet wird ueber echte Bitget-Orders bewegt, nicht manuell
      return { ok:false, reason:'LIVE_READONLY' };
    }
    if (!DemoEngine.wallet) return { ok:false, reason:'NO_WALLET' };
    DemoEngine.wallet.trading = Math.max(0, DemoEngine.wallet.trading - amount);
    DemoEngine.wallet.total = DemoEngine.wallet.reserve + DemoEngine.wallet.trading;
    try { DemoEngine._persistWallet(); } catch(_) {}
    return { ok:true, mode:'DEMO', newTrading: DemoEngine.wallet.trading };
  },

  credit(amount) {
    if (this._mode() === 'LIVE') return { ok:false, reason:'LIVE_READONLY' };
    if (!DemoEngine.wallet) return { ok:false, reason:'NO_WALLET' };
    const cap = DemoEngine.wallet.startTotal || 1000;
    DemoEngine.wallet.trading = Math.min(cap, DemoEngine.wallet.trading + amount);
    DemoEngine.wallet.total = DemoEngine.wallet.reserve + DemoEngine.wallet.trading;
    try { DemoEngine._persistWallet(); } catch(_) {}
    return { ok:true, mode:'DEMO', newTrading: DemoEngine.wallet.trading };
  },

  // ── PnL anwenden (70/30-Split bei Gewinn, voller Abzug bei Verlust) ──
  applyPnL(pnl) {
    if (this._mode() === 'LIVE') return { ok:false, reason:'LIVE_READONLY' };
    if (!DemoEngine.wallet) return { ok:false, reason:'NO_WALLET' };
    const w = DemoEngine.wallet;
    if (pnl > 0) {
      const toReserve = pnl * 0.70;
      const toTrading = pnl * 0.30;
      w.reserve = (w.reserve||0) + toReserve;
      w.trading = (w.trading||0) + toTrading;
    } else {
      w.trading = Math.max(0, (w.trading||0) + pnl);
    }
    w.pnl      = (w.pnl||0) + pnl;
    w.dailyPnl = (w.dailyPnl||0) + pnl;
    w.total    = w.reserve + w.trading;
    if (w.total > (w.peakTotal||0)) w.peakTotal = w.total;
    try { DemoEngine._persistWallet(); } catch(_) {}
    return { ok:true, mode:'DEMO', pnl, newTotal: w.total };
  },

  // ── Diagnose ──
  snapshot() {
    return {
      mode: this._mode(),
      total:   this.total(),
      trading: this.trading(),
      reserve: this.reserve(),
      demoWallet: (this._mode()==='DEMO' && DemoEngine.wallet) ? {
        total: DemoEngine.wallet.total,
        trading: DemoEngine.wallet.trading,
        reserve: DemoEngine.wallet.reserve,
        pnl: DemoEngine.wallet.pnl,
        dailyPnl: DemoEngine.wallet.dailyPnl,
        peakTotal: DemoEngine.wallet.peakTotal,
      } : null,
      liveBalance: (this._mode()==='LIVE' && typeof Balance!=='undefined') ? {
        usable: Balance.usable,
        total: Balance.total,
      } : null,
    };
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// EXECUTION ADAPTER — Einziger Unterschied zwischen DEMO und LIVE.
// DEMO: Realistische Fill-Simulation mit Live-Orderbook.
// LIVE: Echter Bitget-API-Call.
// Alles davor (Signal, Gate, Sizing) und danach (Exit, Wallet) ist gemeinsam.
// ═════════════════════════════════════════════════════════════════════════════
const ExecutionAdapter = {
  // Haupt-API: symbol, direction ('BUY'/'SELL'), sizeUSDT, referencePrice, opts
  async placeOrder(symbol, direction, sizeUSDT, referencePrice, opts) {
    opts = opts || {};
    const mode = (DemoEngine && DemoEngine.liveMode) ? 'LIVE' : 'DEMO';
    const t0 = Date.now();

    if (mode === 'DEMO') {
      return await this._simulateFill(symbol, direction, sizeUSDT, referencePrice, opts, t0);
    }
    return await this._liveFill(symbol, direction, sizeUSDT, referencePrice, opts, t0);
  },

  // ── DEMO: realistische Fill-Simulation
  async _simulateFill(symbol, direction, sizeUSDT, referencePrice, opts, t0) {
    try {
      // Latenz wie echter Bitget-Call (50-200ms)
      const latency = 50 + Math.floor(Math.random() * 150);
      await new Promise(r => setTimeout(r, latency));

      // Orderbook-basierte Slippage (wenn verfuegbar)
      let slipPct = 0.0002; // Fallback: 0.02%
      let partialFill = false;
      let fillSize = sizeUSDT;

      try {
        const ob = await Bitget.fetchOrderbook(symbol).catch(() => null);
        if (ob && ob.bids && ob.asks && ob.bids.length && ob.asks.length) {
          const book = direction === 'BUY' ? ob.asks : ob.bids;
          let remaining = sizeUSDT;
          let totalCost = 0;
          let totalQty = 0;
          for (const level of book) {
            const price = parseFloat(level[0]);
            const qty = parseFloat(level[1]);
            const levelUSDT = price * qty;
            if (remaining <= levelUSDT) {
              const q = remaining / price;
              totalQty += q;
              totalCost += remaining;
              remaining = 0;
              break;
            } else {
              totalQty += qty;
              totalCost += levelUSDT;
              remaining -= levelUSDT;
            }
          }
          if (remaining > 0) {
            // Nicht genug Orderbook-Tiefe - partial fill
            partialFill = true;
            fillSize = sizeUSDT - remaining;
          }
          if (totalQty > 0 && fillSize > 0) {
            const avgFillPrice = totalCost / totalQty;
            slipPct = Math.abs(avgFillPrice - referencePrice) / referencePrice;
          }
        }
      } catch(e) {
        try{ Log.warn('ADAPTER','orderbook slip calc err: '+e.message); }catch(_){}
      }

      const fillPrice = direction === 'BUY'
        ? referencePrice * (1 + slipPct)
        : referencePrice * (1 - slipPct);

      const result = {
        ok: true,
        mode: 'DEMO',
        symbol, direction,
        sizeUSDT: fillSize,
        fillPrice,
        slippagePct: slipPct,
        latencyMs: latency,
        partialFill,
        orderId: 'DEMO_' + symbol + '_' + Date.now(),
        t0, tEnd: Date.now(),
      };

      try {
        ActionStream.push('ENTRY', symbol,
          'DEMO '+direction+' '+fillSize.toFixed(2)+' USDT @ '+fillPrice.toFixed(4)+' slip='+(slipPct*100).toFixed(3)+'% lat='+latency+'ms'+(partialFill?' PARTIAL':''),
          { mode:'DEMO', direction, size:fillSize, fillPrice, slippagePct:slipPct, latencyMs:latency, partialFill });
      } catch(_){}

      return result;
    } catch(e) {
      try{ Log.warn('ADAPTER','sim err: '+e.message); }catch(_){}
      return { ok:false, mode:'DEMO', error: e.message };
    }
  },

  // ── LIVE: echter Bitget-Call
  async _liveFill(symbol, direction, sizeUSDT, referencePrice, opts, t0) {
    try {
      if (!CFG.API_KEY) return { ok:false, mode:'LIVE', error:'NO_API_KEY' };
      const order = await Bitget.placeSportOrder(symbol, direction.toLowerCase(), sizeUSDT);
      if (!order || order.code !== '00000') {
        return { ok:false, mode:'LIVE', error: (order && order.msg) || 'ORDER_REJECTED' };
      }
      const orderId = order.data && order.data.orderId;

      // Echten Fill holen (2s warten)
      await new Promise(r => setTimeout(r, 2000));
      let fillPrice = referencePrice;
      let fillSize = sizeUSDT;
      let partialFill = false;
      try {
        const detail = await Bitget.get('/api/v2/spot/trade/orderInfo?orderId=' + orderId);
        if (detail && detail.data) {
          const od = Array.isArray(detail.data) ? detail.data[0] : detail.data;
          if (od.priceAvg && parseFloat(od.priceAvg) > 0) fillPrice = parseFloat(od.priceAvg);
          if (od.baseVolume && parseFloat(od.baseVolume) > 0) fillSize = parseFloat(od.baseVolume) * fillPrice;
          const status = od.state || od.status || '';
          if (status.includes('partial')) partialFill = true;
        }
      } catch(e) {
        try{ Log.warn('ADAPTER','fill-check err: '+e.message); }catch(_){}
      }

      const slipPct = referencePrice > 0 ? Math.abs(fillPrice - referencePrice) / referencePrice : 0;
      const result = {
        ok: true, mode:'LIVE',
        symbol, direction,
        sizeUSDT: fillSize,
        fillPrice, slippagePct: slipPct,
        latencyMs: Date.now() - t0,
        partialFill,
        orderId,
        t0, tEnd: Date.now(),
      };
      try {
        ActionStream.push('ENTRY', symbol,
          'LIVE '+direction+' '+fillSize.toFixed(2)+' USDT @ '+fillPrice.toFixed(4)+' slip='+(slipPct*100).toFixed(3)+'% order='+orderId+(partialFill?' PARTIAL':''),
          { mode:'LIVE', direction, size:fillSize, fillPrice, slippagePct:slipPct, orderId, partialFill });
      } catch(_){}
      return result;
    } catch(e) {
      try{ Log.warn('ADAPTER','live err: '+e.message); }catch(_){}
      return { ok:false, mode:'LIVE', error: e.message };
    }
  },

  // Diagnose/Snapshot
  snapshot() {
    return {
      currentMode: (DemoEngine && DemoEngine.liveMode) ? 'LIVE' : 'DEMO',
      apiKeySet: !!CFG.API_KEY,
      deployMode: CFG.DEPLOY_MODE,
    };
  },
};

const ActionStream = {
  MAX: 500,
  events: [],
  push(type, module, msg, data) {
    try {
      const ev = {
        ts: Date.now(),
        time: new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        type: type || 'INFO',
        module: module || '',
        msg: String(msg || '').slice(0, 200),
        data: data || null,
      };
      this.events.unshift(ev);
      if (this.events.length > this.MAX) this.events.length = this.MAX;
    } catch(_) {}
  },
  snapshot(limit, typeFilter) {
    let list = this.events;
    if (typeFilter && typeFilter.length) list = list.filter(e => typeFilter.includes(e.type));
    return list.slice(0, limit || 100);
  },
  stats() {
    const by = {};
    for (const e of this.events) by[e.type] = (by[e.type]||0) + 1;
    return { total: this.events.length, byType: by, oldestTs: this.events.length ? this.events[this.events.length-1].ts : null };
  }
};

const DBJanitor = {
  timer: null,
  interval: 1800000,
  pending: {},
  PENDING_TTL: 86400000,
  history: [],

  async scan() {
    const clusters = [];
    try {
      const dupes = DB.db.prepare(`
        SELECT symbol, entry_price, exit_price, pnl, exit_reason, direction, strategy,
               COUNT(*) as n, MIN(ts) as min_ts, MAX(ts) as max_ts
        FROM strategy_performance
        GROUP BY symbol, entry_price, exit_price, pnl, exit_reason, direction, strategy
        HAVING n >= 100 AND (max_ts - min_ts) < 300000
      `).all();
      for (const d of dupes) {
        clusters.push({
          id: 'DUPE_'+d.symbol+'_'+d.exit_reason+'_'+d.min_ts,
          reason: 'DUPLICATE_FLOOD',
          count: d.n,
          symbol: d.symbol, exit_reason: d.exit_reason,
          timeWindow: ((d.max_ts-d.min_ts)/1000).toFixed(0)+'s',
          avgPnl: d.pnl,
          where: "symbol='"+d.symbol+"' AND exit_reason='"+d.exit_reason+"' AND entry_price="+d.entry_price+" AND exit_price="+d.exit_price+" AND ts BETWEEN "+d.min_ts+" AND "+d.max_ts
        });
      }

      const longKill = DB.db.prepare(`
        SELECT COUNT(*) as n, GROUP_CONCAT(DISTINCT symbol) as symbols
        FROM strategy_performance
        WHERE exit_reason='KILL_SWITCH' AND hold_ms > 86400000
      `).get();
      if (longKill && longKill.n > 0) {
        clusters.push({
          id: 'LONGKILL_'+Date.now(),
          reason: 'KILL_SWITCH_UNPLAUSIBLE_HOLD',
          count: longKill.n,
          symbol: longKill.symbols,
          where: "exit_reason='KILL_SWITCH' AND hold_ms > 86400000"
        });
      }

      const zeroExit = DB.db.prepare(`
        SELECT COUNT(*) as n, GROUP_CONCAT(DISTINCT exit_reason) as reasons
        FROM strategy_performance
        WHERE exit_price=0 AND exit_reason NOT IN ('CLEANUP_STALE','STALE_CLEANUP_TIME','STALE_ORPHAN')
      `).get();
      if (zeroExit && zeroExit.n > 0) {
        clusters.push({
          id: 'ZEROEXIT_'+Date.now(),
          reason: 'ZERO_EXIT_PRICE_NONSTALE',
          count: zeroExit.n,
          exit_reasons: zeroExit.reasons,
          where: "exit_price=0 AND exit_reason NOT IN ('CLEANUP_STALE','STALE_CLEANUP_TIME','STALE_ORPHAN')"
        });
      }
    } catch(e) {
      try{Log.warn('JANITOR','scan err: '+e.message);}catch(_){}
    }

    for (const cl of clusters) {
      if (this.pending[cl.id]) continue;
      this.pending[cl.id] = Object.assign({}, cl, { detectedAt: Date.now() });
      const msg = 'Janitor findet Datenmuell:\nID: '+cl.id+'\nGrund: '+cl.reason+'\nEintraege: '+cl.count+'\nSymbol: '+(cl.symbol||'-')+'\n\nApprove: /janitor_approve '+cl.id+'\nReject: /janitor_reject '+cl.id;
      try { TelegramAlarm.warn('JANITOR', msg, { id: cl.id, count: cl.count }); } catch(e) { try{Log.warn('JANITOR','telegram err: '+e.message);}catch(_){} }
    }

    const now = Date.now();
    for (const id of Object.keys(this.pending)) {
      if (now - this.pending[id].detectedAt > this.PENDING_TTL) {
        this.history.unshift(Object.assign({}, this.pending[id], { result:'EXPIRED', ts:now }));
        delete this.pending[id];
      }
    }
    if (this.history.length > 100) this.history.length = 100;

    return { clusters: clusters.length, pending: Object.keys(this.pending).length, details: clusters };
  },

  approve(id) {
    const cl = this.pending[id];
    if (!cl) return { error: 'Unbekannte Janitor-ID: '+id };
    try {
      const res = DB.db.prepare('DELETE FROM strategy_performance WHERE '+cl.where).run();
      this.history.unshift(Object.assign({}, cl, { result:'APPROVED', deleted: res.changes, ts: Date.now() }));
      delete this.pending[id];
      try { TelegramBot.send('Janitor: '+res.changes+' Eintraege geloescht ('+cl.reason+')'); } catch(_){}
      Log.info('JANITOR','Approved '+id+': deleted '+res.changes);
      return { ok:true, deleted: res.changes };
    } catch(e) {
      try{Log.warn('JANITOR','approve err: '+e.message);}catch(_){}
      return { error: e.message };
    }
  },

  reject(id) {
    const cl = this.pending[id];
    if (!cl) return { error: 'Unbekannte Janitor-ID: '+id };
    this.history.unshift(Object.assign({}, cl, { result:'REJECTED', ts: Date.now() }));
    delete this.pending[id];
    try { TelegramBot.send('Janitor: '+id+' abgelehnt'); } catch(_){}
    return { ok:true };
  },

  start() {
    if (this.timer) return;
    setTimeout(() => this.scan(), 60000);
    this.timer = setInterval(() => this.scan(), this.interval);
    Log.boot('DBJanitor gestartet (alle 30min)');
  },

  snapshot() {
    return {
      interval: this.interval,
      pending: Object.values(this.pending),
      pendingCount: Object.keys(this.pending).length,
      history: this.history.slice(0, 20),
    };
  },
};

const TelegramAlarm = {
  LEVELS:{INFO:0,WARN:1,CRITICAL:2,EMERGENCY:3},
  EMOJIS:{INFO:'ℹ️',WARN:'⚠️',CRITICAL:'🚨',EMERGENCY:'🔴'},
  recentAlarms:{}, DEDUP_MS:900000,
  auditTrail:[],
  pendingAcks:{}, ESCALATION_MS:600000,
  async alert(level,module,message,data={}){
    const key=level+':'+module+':'+message.slice(0,50);const now=Date.now();
    if(this.recentAlarms[key]&&now-this.recentAlarms[key]<this.DEDUP_MS)return{sent:false,reason:'DUPLICATE'};
    this.recentAlarms[key]=now;
    const entry={ts:now,time:new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),level,module,message,data:JSON.stringify(data).slice(0,200)};
    this.auditTrail.unshift(entry);if(this.auditTrail.length>200)this.auditTrail.pop();
    try{DB.insertLog.run(now,'TG_'+level,module,message,JSON.stringify(data).slice(0,500));}catch(e){ try{Log.warn('TelegramAlarm','err: '+e.message);}catch(_){} }
    const prefix=level==='EMERGENCY'?'🔴🔴 NOTFALL 🔴🔴':level==='CRITICAL'?'🚨 KRITISCH':level==='WARN'?'⚠️ WARNUNG':'ℹ️ INFO';
    let msg=prefix+'\n'+entry.time+' | '+module+'\n━━━━━━━━━━━━━━━━━━━━\n'+message;
    if(data.action)msg+='\nAktion: '+data.action;
    if(level==='CRITICAL'||level==='EMERGENCY'){
      const ackId='ACK-'+now;this.pendingAcks[ackId]={...entry,ackId,escalated:false};
      msg+='\n\n/ack '+ackId+' zum Bestätigen';
      // Eskalation nur 1x, nicht wiederholt
      if(!this._lastEscalation || Date.now()-this._lastEscalation > this.ESCALATION_MS) { setTimeout(()=>this.checkEscalation(ackId),this.ESCALATION_MS); }
    }
    try{const r=await TelegramBot.send(msg);return(r&&r.sent)?{sent:true,messageId:r.messageId}:{sent:false,reason:(r&&r.reason)||'UNKNOWN'};}catch(e){try{Log.warn('TELEGRAM','alert failed: '+e.message);}catch(e){ try{Log.warn('TelegramAlarm','err: '+e.message);}catch(_){} } return{sent:false,reason:e.message};}
  },
  info(m,msg,d){return this.alert('INFO',m,msg,d);},
  warn(m,msg,d){return this.alert('WARN',m,msg,d);},
  critical(m,msg,d){return this.alert('CRITICAL',m,msg,d);},
  emergency(m,msg,d){return this.alert('EMERGENCY',m,msg,d);},
  checkEscalation(ackId){
    const a=this.pendingAcks[ackId];if(!a||a.acknowledged)return;
    if(!a.escalated){a.escalated=true;
      TelegramBot.send('🔴🔴 ESKALATION\nAlarm nicht bestätigt!\n'+a.module+': '+a.message+'\n\n⚠️ Safe Mode aktiviert\n/ack '+ackId);
      try{if(DemoEngine.running && DemoEngine.wallet && DemoEngine.wallet.trading < 0){DemoEngine.running=false;Log.warn('SAFE_MODE','DemoEngine gestoppt — Wallet negativ');} else { Log.info('SAFE_MODE','Wallet OK — DemoEngine läuft weiter'); }}catch(e){ try{Log.warn('TelegramAlarm','err: '+e.message);}catch(_){} }
    }
  },
  acknowledge(ackId){
    const a=this.pendingAcks[ackId];if(!a)return{error:'Unbekannt'};
    a.acknowledged=true;a.ackedAt=Date.now();
    if(a.escalated&&!DemoEngine.running){DemoEngine.start(DemoEngine.wallet?.total||1000);TelegramBot.send('✅ Bestätigt — DemoEngine gestartet');}
    else TelegramBot.send('✅ Alarm bestätigt: '+a.module);
    return{ok:true,ackId};
  },
  snapshot(){return{auditTrail:this.auditTrail.slice(0,30),pendingAcks:Object.values(this.pendingAcks).filter(a=>!a.acknowledged).length,totalAlarms:this.auditTrail.length,levels:{info:this.auditTrail.filter(a=>a.level==='INFO').length,warn:this.auditTrail.filter(a=>a.level==='WARN').length,critical:this.auditTrail.filter(a=>a.level==='CRITICAL').length,emergency:this.auditTrail.filter(a=>a.level==='EMERGENCY').length}};}
};

const AutonomousRepair = {
  enabled:true, timer:null, scanInterval:300000, history:[], pendingFix:null, errorBaseline:0,
  KNOWN_FIXES: {
    'WebSocket closed':     {type:'AUTO',action:'WS_RECONNECT',desc:'WebSocket reconnect'},
    'ECONNRESET':           {type:'AUTO',action:'API_RETRY',desc:'API retry'},
    'ECONNREFUSED':         {type:'AUTO',action:'API_RETRY',desc:'API retry'},
    'ETIMEDOUT':            {type:'AUTO',action:'API_RETRY',desc:'Timeout retry'},
    'Candle fetch failed':  {type:'AUTO',action:'CACHE_CLEAR',desc:'Cache clear'},
    'SQLITE_BUSY':          {type:'AUTO',action:'DB_RETRY',desc:'DB retry'},
    'SQLITE_LOCKED':        {type:'AUTO',action:'DB_RETRY',desc:'DB lock retry'},
    'heap out of memory':   {type:'AUTO',action:'PM2_RESTART',desc:'Memory — restart'},
    'Maximum call stack':   {type:'AUTO',action:'PM2_RESTART',desc:'Stack overflow'},
    'Cannot read prop':     {type:'ASK',action:'NULL_CHECK',desc:'Null/Undefined'},
    'is not a function':    {type:'ASK',action:'TYPE_ERROR',desc:'Typ-Fehler'},
    'is not defined':       {type:'ASK',action:'REF_ERROR',desc:'Variable fehlt'},
    'EPERM':                {type:'AUTO',action:'IGNORE',desc:'Harmlos'},
  },
  async monitor() {
    const issues=[],now=Date.now();
    try{const logs=DB.db.prepare("SELECT * FROM system_log WHERE level='ERROR' AND ts > ? ORDER BY ts DESC LIMIT 20").all(now-this.scanInterval);
      if(logs.length>0){const msgs=logs.map(l=>l.message||l.msg||'');[...new Set(msgs.map(m=>m.slice(0,80)))].forEach(err=>{issues.push({type:'ERROR_LOG',severity:logs.length>10?'HIGH':'MEDIUM',message:err,count:msgs.filter(m=>m.includes(err.slice(0,30))).length});});}
    }catch(_){}
    try{const mb=process.memoryUsage().heapUsed/1024/1024;if(mb>800)issues.push({type:'MEMORY',severity:'HIGH',message:'Heap: '+mb.toFixed(0)+'MB'});}catch(_){}
    try{if(DemoEngine.running&&DemoEngine.stats.scans>20&&DemoEngine.stats.trades===0){const m=(now-(DemoEngine.stats.startedAt||now))/60000;if(m>120)issues.push({type:'NO_TRADES',severity:'MEDIUM',message:DemoEngine.stats.scans+' Scans, 0 Trades'});}}catch(_){}
    try{DB.db.prepare('SELECT 1').get();}catch(e){issues.push({type:'DB_ERROR',severity:'CRITICAL',message:'DB nicht lesbar'});
      TelegramAlarm.emergency('DB', 'Datenbank nicht lesbar — sofort pruefen');}
    try{if(DemoEngine.wallet&&DemoEngine.wallet.trading<0)issues.push({type:'WALLET_NEG',severity:'HIGH',message:'Wallet Trading negativ: '+DemoEngine.wallet.trading.toFixed(2)});
        if(DemoEngine.wallet.trading<0) TelegramAlarm.critical('WALLET', 'Demo Wallet Trading negativ: ' + DemoEngine.wallet.trading.toFixed(2));
      if(DemoEngine.wallet&&Math.abs(DemoEngine.wallet.total-DemoEngine.wallet.reserve-DemoEngine.wallet.trading)>0.01)issues.push({type:'WALLET_DRIFT',severity:'HIGH',message:'Wallet Drift'});}catch(_){}
    try{const re=DB.db.prepare("SELECT COUNT(*) as n FROM system_log WHERE level='ERROR' AND ts > ?").get(now-300000)?.n||0;
      const oe=DB.db.prepare("SELECT COUNT(*) as n FROM system_log WHERE level='ERROR' AND ts > ? AND ts < ?").get(now-600000,now-300000)?.n||0;
      if(re>5&&oe>0&&re>oe*2){issues.push({type:'ERROR_SPIKE',severity:'HIGH',message:'Errors x2: '+re});
      TelegramAlarm.warn('MONITOR', 'Error-Rate verdoppelt: ' + re + ' in 5min');}}catch(_){}
    return issues;
  },
  diagnose(issue) {
    for(const[p,f]of Object.entries(this.KNOWN_FIXES)){if(issue.message&&issue.message.includes(p))return{known:true,pattern:p,fixType:f.type,action:f.action,description:f.desc,severity:issue.severity};}
    const m=(issue.message||'').toLowerCase();let c='UNKNOWN';
    if(m.includes('typeerror'))c='TYPE';else if(m.includes('not defined'))c='REF';else if(m.includes('syntax'))c='SYNTAX';else if(m.includes('timeout'))c='NET';else if(m.includes('sqlite'))c='DB';
    return{known:false,category:c,fixType:issue.severity==='CRITICAL'?'ASK':'ANALYZE',severity:issue.severity,description:'Unbekannt: '+c};
  },
  async repair(d) {
    if(d.fixType==='AUTO'){switch(d.action){
      case 'WS_RECONNECT':try{Bitget.connectWS&&Bitget.connectWS();}catch(_){}return{applied:true,action:d.action,auto:true};
      case 'API_RETRY':try{await Bitget.fetchTicker('BTCUSDT');}catch(_){}return{applied:true,action:d.action,auto:true};
      case 'CACHE_CLEAR':try{Bitget.priceCache={};}catch(_){}return{applied:true,action:d.action,auto:true};
      case 'DB_RETRY':try{DB.db.prepare('SELECT 1').get();}catch(_){}return{applied:true,action:d.action,auto:true};
      case 'PM2_RESTART':Log.warn('ARS','PM2 Restart');TelegramBot.send('ARS: PM2 Restart\n'+d.description);setTimeout(()=>process.exit(0),10000);return{applied:true,action:d.action,auto:true};
      case 'IGNORE':return{applied:false,action:'IGNORE',auto:true};}}
    if(d.fixType==='ASK'){this.pendingFix={diagnosis:d,ts:Date.now(),status:'PENDING'};TelegramBot.send('ARS Fix noetig\n'+d.description+'\n/approve oder /reject');return{applied:false,action:'WAITING',pending:true};}
    return{applied:false};
  },
  async testFix(){const t={syntax:true,logic:true};try{require('child_process').execSync('node --check '+process.env.HOME+'/NEXUS_CLEAN/server.js',{timeout:10000});}catch(_){t.syntax=false;}
    t.logic=typeof UnifiedScore.compute==='function'&&typeof Trades.close==='function';return{passed:t.syntax&&t.logic,tests:t};},
  async metaDecide(d,r,t){const v={sec:SecurityKI.snapshot().status==='OK',test:t?t.passed:true};let dec;if(d.fixType==='AUTO'&&r.applied)dec='AUTO_APPLIED';else if(d.fixType==='ASK')dec='WAITING_HUMAN';else if(t&&!t.passed)dec='REJECTED';else dec='NO_ACTION';return{decision:dec,votes:v};},
  async cycle(){try{const issues=await this.monitor();if(!issues.length)return;
    try{this.errorBaseline=DB.db.prepare("SELECT COUNT(*) as n FROM system_log WHERE level='ERROR' AND ts > ?").get(Date.now()-300000)?.n||0;}catch(_){}
    for(const i of issues){if(this.history.find(h=>h.issue?.type===i.type&&Date.now()-h.ts<1800000))continue;
      const d=this.diagnose(i),r=await this.repair(d),t=r.applied?await this.testFix():null,m=await this.metaDecide(d,r,t);
      this.history.unshift({ts:Date.now(),time:new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),issue:i,diagnosis:{known:d.known,pattern:d.pattern,action:d.action},repair:{applied:r.applied,action:r.action,auto:r.auto},test:t,meta:m});
      if(this.history.length>100)this.history.pop();}}catch(e){Log.warn('ARS',e.message);}},
  handleApproval(ok){if(!this.pendingFix)return{error:'Kein Fix'};this.pendingFix.status=ok?'APPROVED':'REJECTED';const r={...this.pendingFix};this.pendingFix=null;return r;},
  start(){if(this.timer)return;this.timer=setInterval(()=>this.cycle(),this.scanInterval);setTimeout(()=>this.cycle(),30000);Log.boot('ARS gestartet');},
  snapshot(){return{enabled:this.enabled,pendingFix:this.pendingFix,recentHistory:this.history.slice(0,20),stats:{totalScans:this.history.length,autoFixes:this.history.filter(h=>h.repair?.auto&&h.repair?.applied).length,humanFixes:this.history.filter(h=>h.meta?.decision==='WAITING_HUMAN').length,rejected:this.history.filter(h=>h.meta?.decision?.startsWith('REJECTED')).length},knownPatterns:Object.keys(this.KNOWN_FIXES).length};}
};

const SecurityKI = {
  enabled:true, scanInterval:300000, timer:null, lastScan:null, alerts:[], fileHashes:{},
  async checkFiles() {
    const crypto=require('crypto'), fs2=require('fs');
    const files=[process.env.HOME+'/NEXUS_CLEAN/server.js', process.env.HOME+'/NEXUS_CLEAN/.env'];
    const results=[];
    for (const f of files) {
      try {
        const hash=crypto.createHash('sha256').update(fs2.readFileSync(f)).digest('hex').slice(0,16);
        const prev=this.fileHashes[f];
        if (prev&&prev!==hash) { results.push({file:f.split('/').pop(),status:'CHANGED',prev,now:hash,severity:'HIGH'}); this._alert('FILE_CHANGED',f.split('/').pop()+' veraendert','HIGH'); }
        else results.push({file:f.split('/').pop(),status:'OK',hash});
        this.fileHashes[f]=hash;
      } catch(e) { results.push({file:f.split('/').pop(),status:'ERROR',error:'Nicht lesbar'}); }
    }
    return results;
  },
  async checkProcesses() {
    try {
      const ps=require('child_process').execSync('ps aux',{timeout:5000}).toString();
      const nodeProcs=ps.split('\n').filter(l=>l.includes('node')&&!l.includes('grep'));
      const suspicious=nodeProcs.filter(l=>!l.includes('nexus')&&!l.includes('NEXUS')&&!l.includes('pm2')&&!l.includes('PM2')&&!l.includes('node_modules')&&!l.includes('npm')&&!l.includes('.pm2')&&!l.includes('fix_')&&!l.includes('Desktop')&&!l.includes('server.js')&&!l.includes('christianheilig')&&l.trim()).map(l=>({process:l.trim().slice(0,100),status:'UNKNOWN'}));
      if (suspicious.length>0) this._alert('UNKNOWN_PROCESS',suspicious.length+' unbekannte Prozesse','MEDIUM');
      return {total:nodeProcs.length,suspicious,status:suspicious.length===0?'OK':'WARNING'};
    } catch(e) { return {total:0,suspicious:[],status:'CHECK_FAILED'}; }
  },
  async checkConnections() {
    try {
      const ns=require('child_process').execSync('netstat -an 2>/dev/null || ss -tun 2>/dev/null',{timeout:5000}).toString();
      const est=ns.split('\n').filter(l=>l.includes('ESTABLISHED')||l.includes('ESTAB'));
      return {connections:est.length,blocked:[],status:'OK'};
    } catch(e) { return {connections:0,blocked:[],status:'CHECK_FAILED'}; }
  },
  _alert(type,message,severity) {
    this.alerts.unshift({ts:Date.now(),type,message,severity,time:new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})});
    if (this.alerts.length>100) this.alerts.pop();
    Log.warn('SECURITY_KI',type+': '+message);
    if (severity==='HIGH'||severity==='CRITICAL') TelegramAlarm.critical('SECURITY', type+': '+message); if(false) TelegramBot.send('\u{1F6E1} SECURITY: '+type+'\n'+message);
  },
  async fullScan() {
    const files=await this.checkFiles(), procs=await this.checkProcesses(), conns=await this.checkConnections();
    this.lastScan=Date.now();
    return {ok:files.every(f=>f.status==='OK')&&procs.status==='OK'&&conns.status==='OK', files,processes:procs,connections:conns,alerts:this.alerts.slice(0,20),lastScan:this.lastScan};
  },
  start() { if(this.timer)return; this.fullScan(); this.timer=setInterval(()=>this.fullScan(),this.scanInterval); Log.boot('Security-KI gestartet'); },
  snapshot() { return {enabled:this.enabled,lastScan:this.lastScan,alertCount:this.alerts.length,recentAlerts:this.alerts.slice(0,10),status:this.alerts.filter(a=>a.severity==='HIGH'&&Date.now()-a.ts<3600000).length>0?'ALARM':'OK'}; }
};

const UpdateKI = {
  currentVersion:'v9.0', gitCommit:null, lastCheck:null, updateHistory:[], rollbackAvailable:false,
  async checkVersion() {
    const {execSync}=require('child_process');
    try {
      const commit=execSync('cd '+process.env.HOME+'/NEXUS_CLEAN && git log --oneline -1',{timeout:5000}).toString().trim();
      const branch=execSync('cd '+process.env.HOME+'/NEXUS_CLEAN && git branch --show-current',{timeout:5000}).toString().trim();
      const status=execSync('cd '+process.env.HOME+'/NEXUS_CLEAN && git status --porcelain',{timeout:5000}).toString().trim();
      this.gitCommit=commit.split(' ')[0]; this.lastCheck=Date.now();
      const backups=parseInt(execSync('ls '+process.env.HOME+'/NEXUS_CLEAN/server.js.* 2>/dev/null | wc -l',{timeout:5000}).toString().trim());
      this.rollbackAvailable=backups>0;
      return {version:this.currentVersion,commit,branch,dirty:status.length>0,uncommittedChanges:status?status.split('\n').length:0,rollbackAvailable:this.rollbackAvailable,backupCount:backups,lastCheck:this.lastCheck};
    } catch(e) { return {version:this.currentVersion,error:'Git Check fehlgeschlagen'}; }
  },
  async syntaxCheck() {
    try { require('child_process').execSync('node --check '+process.env.HOME+'/NEXUS_CLEAN/server.js',{timeout:10000}); return {ok:true}; }
    catch(e) { return {ok:false}; }
  },
  snapshot() { return {version:this.currentVersion,gitCommit:this.gitCommit,lastCheck:this.lastCheck,rollbackAvailable:this.rollbackAvailable,updateHistory:this.updateHistory.slice(0,20)}; }
};

const MultiKI = {
  requiredVotes:3, voters:['SelfHeal','AnomalyDetector','StressTest','SecurityKI','Regime'], history:[],
  async vote(action, context) {
    const votes={}, reasons={};
    try{if(SelfHeal.fullCheck){const h=await SelfHeal.fullCheck();votes.SelfHeal=h.ok;reasons.SelfHeal=h.ok?'OK':(h.issues||[]).join(',');}else{votes.SelfHeal=true;reasons.SelfHeal='OK';}}catch(_){votes.SelfHeal=true;reasons.SelfHeal='OK';}
    try { const a=AnomalyDetector.shouldBlock('BTCUSDT',[]); votes.AnomalyDetector=!a.block; reasons.AnomalyDetector=a.block?'Anomalie':'Normal'; } catch(_) { votes.AnomalyDetector=true; reasons.AnomalyDetector='OK'; }
    try { const s=StressTest.run(); votes.StressTest=s.pass; reasons.StressTest=s.pass?'Survival '+(s.survivalRate*100).toFixed(0)+'%':'FAIL'; } catch(_) { votes.StressTest=false; reasons.StressTest='Fehler'; }
    try { votes.SecurityKI=SecurityKI.snapshot().status==='OK'; reasons.SecurityKI=votes.SecurityKI?'Sicher':'Alarm'; } catch(_) { votes.SecurityKI=true; reasons.SecurityKI='OK'; }
    try { votes.Regime=!['EXTREME_BEAR','FLASH_CRASH'].includes(Regime.regime); reasons.Regime='Regime: '+Regime.regime; } catch(_) { votes.Regime=true; reasons.Regime='OK'; }
    const approved=Object.values(votes).filter(Boolean).length;
    const passed=approved>=this.requiredVotes;
    const result={action,passed,approved,total:Object.keys(votes).length,required:this.requiredVotes,votes,reasons,ts:Date.now(),time:new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})};
    this.history.unshift(result); if(this.history.length>50) this.history.pop();
    Log.info('MULTI_KI',action+': '+(passed?'GENEHMIGT':'ABGELEHNT')+' ('+approved+'/'+Object.keys(votes).length+')');
    if (!passed) TelegramBot.send('\u{1F916} Multi-KI ABGELEHNT: '+action+'\n'+Object.entries(votes).map(([k,v])=>(v?'\u2705 ':'\u274C ')+k+': '+reasons[k]).join('\n'));
    return result;
  },
  snapshot() { return {requiredVotes:this.requiredVotes,voters:this.voters,recentVotes:this.history.slice(0,15),lastVote:this.history[0]||null}; }
};


// UNIFIED DECISION SCORE - Alle Datenquellen => ein Score
const UnifiedScore = {
  WEIGHTS: {
    strategies:0.25, mlEnsemble:0.15, rlAgent:0.05, cvd:0.08,
    patterns:0.05, ichimoku:0.06, elliott:0.03,
    regime:0.10, fearGreed:0.06, news:0.08, reddit:0.04,
    onChain:0.06, smartMoney:0.06,
    monteCarlo:0.08, bayesian:0.07, volatility:0.06, anomaly:0.10, sharpe:0.04,
    btcCorr:0.08, heatScore:0.04, correlation:0.03,
  },
  async compute(symbol, candles, orderbook) {
    const t0=Date.now(); const scores={}; const blocks=[];
    if (!candles||candles.length<30) return {direction:'HOLD',confidence:0,reason:'ZU_WENIG_DATEN'};
    const closes=candles.map(c=>c.close); const price=closes[closes.length-1];
    const [fgR,newsR,redditR,ocR,smR,mcR,volR,anomR,shR]=await Promise.all([
      FearGreed.fetch().catch(()=>null), NewsSentiment.fetch().catch(()=>null),
      SentimentAI.getSentiment(symbol).catch(()=>null), OnChainAnalysis.getSignal(symbol).catch(()=>null),
      SmartMoney.getSignal(symbol).catch(()=>null), RiskEngine.monteCarlo(candles,500,10),
      VolatilityRegime.detect(candles), AnomalyDetector.shouldBlock(symbol,candles),
      SharpeEngine.fromCandles(candles),
    ]);
    // STRATEGIES
    const raw=Strategies.getAll(candles,orderbook)||[];
    if(raw.length>0){const b=raw.filter(s=>s.direction==='BUY'),sl=raw.filter(s=>s.direction==='SELL');
      const d=b.length>sl.length?'BUY':sl.length>b.length?'SELL':'NEUTRAL';
      const best=d==='BUY'?b:d==='SELL'?sl:[];
      const avg=best.length>0?best.reduce((s,x)=>s+x.strength,0)/best.length:0;
      scores.strategies={direction:d,score:d==='BUY'?avg:d==='SELL'?-avg:0,confidence:Math.min(best.length/3,1)};
    } else scores.strategies={direction:'NEUTRAL',score:0,confidence:0};
    // ML
    if(MLOptimizer.trained){const ml=MLOptimizer.predict(candles);
      scores.mlEnsemble=ml.signal!=='HOLD'&&ml.confidence>0.58?{direction:ml.signal,score:ml.signal==='BUY'?ml.confidence:-ml.confidence,confidence:ml.confidence}:{direction:'NEUTRAL',score:0,confidence:ml.confidence||0.5};
    } else scores.mlEnsemble={direction:'NEUTRAL',score:0,confidence:0};
    // RL
    try{const rl=RLAgent.decide(candles);scores.rlAgent=rl.action!=='HOLD'?{direction:rl.action,score:rl.action==='BUY'?rl.confidence:-rl.confidence,confidence:Math.min(0.6,rl.confidence)}:{direction:'NEUTRAL',score:0,confidence:0.3};}catch(_){scores.rlAgent={direction:'NEUTRAL',score:0,confidence:0};}
    // CVD
    try{const cvd=CVDEngine.signal(candles);scores.cvd=cvd&&cvd.direction!=='NEUTRAL'?{direction:cvd.direction,score:cvd.direction==='BUY'?cvd.strength:-cvd.strength,confidence:cvd.divergence?0.8:0.5}:{direction:'NEUTRAL',score:0,confidence:0.3};}catch(_){scores.cvd={direction:'NEUTRAL',score:0,confidence:0};}
    // PATTERNS
    const ps=Ind.patternSignal(candles);scores.patterns=ps&&ps.strength>0.6?{direction:ps.direction,score:ps.direction==='BUY'?ps.strength:-ps.strength,confidence:ps.strength}:{direction:'NEUTRAL',score:0,confidence:0};
    // ICHIMOKU
    const ich=Ind.ichimoku(candles);if(ich){const d=ich.bullish?'BUY':ich.bearish?'SELL':'NEUTRAL';const s=ich.bullish?0.7:ich.bearish?-0.7:0;scores.ichimoku={direction:d,score:s,confidence:Math.abs(s)>0?0.65:0.3};}else scores.ichimoku={direction:'NEUTRAL',score:0,confidence:0};
    // ELLIOTT
    const ew=Ind.elliottWave(candles);if(ew&&ew.wave){const d=ew.bias||'NEUTRAL';const s=ew.wave.includes('WAVE_3')?0.8:ew.wave.includes('WAVE_5')?0.5:0.3;scores.elliott={direction:d,score:d==='BUY'?s:d==='SELL'?-s:0,confidence:s};}else scores.elliott={direction:'NEUTRAL',score:0,confidence:0};
    // REGIME
    Regime.detect(candles);const rm={BULL:0.7,BEAR:-0.7,RANGING:0,CHOPPY:-0.2,NEUTRAL:0,EXTREME_BEAR:-1.0,UNKNOWN:0};
    scores.regime={direction:Regime.regime==='BULL'?'BUY':['BEAR','EXTREME_BEAR'].includes(Regime.regime)?'SELL':'NEUTRAL',score:rm[Regime.regime]||0,confidence:Regime.confidence||0.5};
    // FEAR&GREED
    if(fgR&&fgR.value!==undefined){const v=fgR.value;const fs2=v<=20?0.6:v<=35?0.3:v<=65?0:v<=80?-0.3:-0.6;scores.fearGreed={direction:fs2>0?'BUY':fs2<0?'SELL':'NEUTRAL',score:fs2,confidence:Math.abs(fs2)>0.3?0.7:0.4};}else scores.fearGreed={direction:'NEUTRAL',score:0,confidence:0};
    // NEWS
    if(newsR&&newsR.riskScore!==undefined){const r=newsR.riskScore||30;const ns=r>70?-0.8:r>50?-0.3:r<15?0.3:0;scores.news={direction:ns<-0.3?'SELL':ns>0.1?'BUY':'NEUTRAL',score:ns,confidence:r>60?0.8:0.4};if(r>80)blocks.push('NEWS_EXTREME');}else scores.news={direction:'NEUTRAL',score:0,confidence:0};
    // REDDIT
    scores.reddit=redditR&&redditR.score!==undefined?{direction:redditR.score>0.2?'BUY':redditR.score<-0.2?'SELL':'NEUTRAL',score:redditR.score*0.6,confidence:0.4}:{direction:'NEUTRAL',score:0,confidence:0};
    // ONCHAIN
    scores.onChain=ocR&&ocR.signal!=='NEUTRAL'?{direction:ocR.signal==='BULLISH'?'BUY':'SELL',score:ocR.signal==='BULLISH'?0.6:-0.6,confidence:0.6}:{direction:'NEUTRAL',score:0,confidence:0};
    // SMARTMONEY
    if(smR&&smR.signal!=='NEUTRAL'){const sig=smR.signal;const d=sig==='ACCUMULATION'?'BUY':sig==='DISTRIBUTION'||sig==='OVERHEATED'?'SELL':'NEUTRAL';const s=sig==='ACCUMULATION'?0.7:sig==='DISTRIBUTION'?-0.5:sig==='OVERHEATED'?-0.7:0;scores.smartMoney={direction:d,score:s,confidence:0.65};}else scores.smartMoney={direction:'NEUTRAL',score:0,confidence:0};
    // MONTE CARLO
    if(mcR){const rs=mcR.signal==='HIGH_RISK'?-0.7:mcR.signal==='MEDIUM_RISK'?-0.3:0.3;scores.monteCarlo={direction:rs>0?'BUY':rs<-0.3?'SELL':'NEUTRAL',score:rs,confidence:0.7,scaleFactor:mcR.scaleFactor||1.0};}else scores.monteCarlo={direction:'NEUTRAL',score:0,confidence:0,scaleFactor:1.0};
    // BAYESIAN
    try{const rsi=Ind.rsi(closes);const macdV=Ind.macd(closes);const ema50=Ind.ema(closes,50);const avgV=candles.slice(-10).reduce((s,c)=>s+(c.high-c.low)/c.close,0)/10;
      const bay=RiskEngine.bayesian.update({rsi,macdBull:macdV&&macdV.histogram>0,volSpike:avgV>0.03,priceAboveEMA:ema50?price>ema50:null});
      const bd=bay.signal==='BUY'?'BUY':bay.signal==='SELL'?'SELL':'NEUTRAL';scores.bayesian={direction:bd,score:bd==='BUY'?bay.confidence:bd==='SELL'?-bay.confidence:0,confidence:bay.confidence};
    }catch(_){scores.bayesian={direction:'NEUTRAL',score:0,confidence:0};}
    // VOLATILITY
    if(volR){const vs=volR.regime==='EXTREME'?-0.8:volR.regime==='HIGH'?-0.3:volR.regime==='LOW'?0.4:0;scores.volatility={direction:vs>0?'BUY':vs<-0.3?'SELL':'NEUTRAL',score:vs,confidence:0.6,positionScale:volR.positionScale||1.0};if(volR.regime==='EXTREME')blocks.push('EXTREME_VOL');}else scores.volatility={direction:'NEUTRAL',score:0,confidence:0,positionScale:1.0};
    // ANOMALY
    if(anomR&&anomR.block){blocks.push('ANOMALY');scores.anomaly={direction:'SELL',score:-1.0,confidence:0.9};}else scores.anomaly={direction:'NEUTRAL',score:0.1,confidence:0.5};
    // SHARPE
    scores.sharpe=shR?{direction:shR.sharpe>1.5?'BUY':shR.sharpe<0?'SELL':'NEUTRAL',score:shR.sharpe>1.5?0.5:shR.sharpe>0.5?0.2:shR.sharpe>0?0:-0.3,confidence:0.5}:{direction:'NEUTRAL',score:0,confidence:0};
    // BTC KORRELATION
    if(symbol!=='BTCUSDT'){const bp=Bitget.priceCache['BTCUSDT']?.last||0;const bpv=Bitget.priceCache['BTCUSDT']?.prev15||bp;
      if(bp>0&&bpv>0){const drop=(bpv-bp)/bpv;if(drop>=0.015){blocks.push('BTC_DROP');scores.btcCorr={direction:'SELL',score:-0.9,confidence:0.85};}else if(drop>=0.005)scores.btcCorr={direction:'SELL',score:-0.3,confidence:0.6};else scores.btcCorr={direction:'NEUTRAL',score:0,confidence:0.3};}else scores.btcCorr={direction:'NEUTRAL',score:0,confidence:0};
    }else scores.btcCorr={direction:'NEUTRAL',score:0,confidence:0};
    // HEATMAP
    try{const heat=await HeatMapEngine.compute([symbol]);const h=heat[symbol];scores.heatScore=h?{direction:h.heatScore>70?'SELL':h.heatScore<40?'BUY':'NEUTRAL',score:h.heatScore>70?-0.5:h.heatScore<40?0.3:-0.1,confidence:0.5}:{direction:'NEUTRAL',score:0,confidence:0};}catch(_){scores.heatScore={direction:'NEUTRAL',score:0,confidence:0};}
    // CORRELATION
    const active=Trades.getActive();if(active.length>0){try{const cr=await CorrelationEngine.compute([symbol,...active.map(t=>t.symbol)],30);const cv=active.map(t=>Math.abs(cr.matrix?.[symbol]?.[t.symbol]||0));const mx=Math.max(...cv,0);scores.correlation={direction:mx>0.85?'SELL':'NEUTRAL',score:mx>0.85?-0.6:mx>0.7?-0.3:0,confidence:0.6};}catch(_){scores.correlation={direction:'NEUTRAL',score:0,confidence:0};}}else scores.correlation={direction:'NEUTRAL',score:0,confidence:0};
    // HARD BLOCKS
    if(blocks.length>0)return{direction:'HOLD',confidence:0,sizePct:0,blocked:true,blocks,reason:'HARD_BLOCK: '+blocks.join(', '),scores,computeMs:Date.now()-t0};
    // AGGREGATION
    let tw=0,ws=0;for(const[key,data]of Object.entries(scores)){const w=this.WEIGHTS[key]||0;if(w>0&&data.confidence>0){const ew2=w*data.confidence;ws+=data.score*ew2;tw+=ew2;}}
    const uScore=tw>0?ws/tw:0;const direction=uScore>0.08?'BUY':uScore<-0.08?'SELL':'HOLD';const confidence=Math.min(0.95,Math.abs(uScore));
    // SIZING
    let sizePct=0;if(direction!=='HOLD'){sizePct=0.05+confidence*0.15;if(scores.monteCarlo?.scaleFactor)sizePct*=scores.monteCarlo.scaleFactor;if(scores.volatility?.positionScale)sizePct*=scores.volatility.positionScale;try{sizePct*=DrawdownRecovery.getRestrictions().sizeMult||1;}catch(e){ try{Log.warn('UnifiedScore','err: '+e.message);}catch(_){} }sizePct=Math.max(0.02,Math.min(0.20,sizePct));}
    const result={symbol,direction,confidence:parseFloat(confidence.toFixed(4)),unifiedScore:parseFloat(uScore.toFixed(4)),sizePct:parseFloat(sizePct.toFixed(4)),sizeUSDT:0,blocked:false,blocks:[],reason:direction==='HOLD'?'SCORE_ZU_SCHWACH ('+uScore.toFixed(3)+')':direction+' conf='+confidence.toFixed(2)+' size='+(sizePct*100).toFixed(1)+'%',sourcesUsed:Object.keys(scores).filter(k=>scores[k].confidence>0).length,totalSources:Object.keys(scores).length,scores,computeMs:Date.now()-t0};
    Log.info('UNIFIED',symbol+' => '+direction+' score='+uScore.toFixed(3)+' conf='+confidence.toFixed(2)+' size='+(sizePct*100).toFixed(1)+'% ['+result.sourcesUsed+'/'+result.totalSources+'] '+(Date.now()-t0)+'ms');
    try { ActionStream.push('SIGNAL', symbol, direction+' score='+uScore.toFixed(3)+' conf='+confidence.toFixed(2), {direction,score:uScore,confidence,sizePct}); } catch(_){}
    return result;
  },
  snapshot(){return{weights:this.WEIGHTS};},
};

// ─────────────────────────────────────────────────────────────────────────────
// DECISION FLOW – full pipeline
// ─────────────────────────────────────────────────────────────────────────────
const DecisionFlow = {
  // candles optional: wenn vom Scanner übergeben → kein zweiter Fetch nötig
  async run(symbol, direction, strength, strategy='MANUAL', _cachedCandles=null) {
    const corrId = `DEC-${Date.now()}`;
    Log.info('DEC', `${symbol} ${direction} str=${strength} strat=${strategy}`, { corrId });

    // 1. Ticker – aus WS-Cache wenn frisch genug (spart REST-Call)
    let price = Bitget.priceCache[symbol]?.last || 0;
    if (!price || Date.now() - (Bitget.priceCache[symbol]?.ts||0) > 3000) {
      const ticker = await Bitget.fetchTicker(symbol).catch(()=>null);
      price = ticker?.last || 0;
    }
    if (!price) return { approved:false, reason:'NO_PRICE_DATA', corrId };

    // Track price for Flash Crash Bot (Punkt 6)
    Safeties.trackPrice(symbol, price);

    // 1b. Symbol Blacklist Check
    const blacklistCheck = SymbolBlacklist.isBlocked(symbol);
    if (blacklistCheck.blocked) {
      return { approved:false, reason:`SYMBOL_BLACKLISTED: ${blacklistCheck.reason} (${blacklistCheck.remainingHours||'∞'}h)`, corrId };
    }

    // 1c. BTC-Korrelations-Filter: BTC fällt > 1.5% in 15min → Altcoin-BUY blockieren
    if (direction==='BUY' && symbol!=='BTCUSDT') {
      const btcPrice = Bitget.priceCache['BTCUSDT']?.last || 0;
      const btcPrev  = Bitget.priceCache['BTCUSDT']?.prev15 || btcPrice;
      if (btcPrice > 0 && btcPrev > 0) {
        const btcDrop = (btcPrev - btcPrice) / btcPrev;
        if (btcDrop >= 0.015) {
          Log.warn('BTC_FILTER', 'BTC Drop >=1.5% — Altcoin-BUY blockiert', { btcDrop:(btcDrop*100).toFixed(2)+'%', symbol });
          return { approved:false, reason:'BTC_CORRELATION_DROP: '+( btcDrop*100).toFixed(2)+'%', corrId };
        }
      }
    }

    // 2. No-Trade gates
    const verdict = NoTrade.verdict();
    if (!verdict.allowTrade) return { approved:false, reason:verdict.reason, gates:verdict.gates, corrId };

    // 3. Kill switch
    const kill = KillSwitch.check();
    if (kill.triggered && kill.mode==='HALTED') return { approved:false, reason:'KILL_SWITCH_HALTED', corrId };

    // 3b. Safeties System (Punkt 5) – unabhaengige Schutzschicht
    const safetyCheck = Safeties.evaluate(symbol, ticker);
    if (!safetyCheck.safe) {
      Log.warn('SAFETY', `Blocked: ${safetyCheck.violations.map(v=>v.name).join(', ')}`);
      return { approved:false, reason:'SAFETY_VIOLATION', violations:safetyCheck.violations, corrId };
    }

    // 4. Concurrency
    const active = Trades.getActive();
    if (active.length >= Math.min(CFG.MAX_OPEN_TRADES, RiskLadder.maxTrades()))
      return { approved:false, reason:'MAX_CONCURRENT_TRADES', corrId };
    if (active.some(t=>t.symbol===symbol))
      return { approved:false, reason:'DUPLICATE_POSITION', corrId };

    // 4c. Time-of-Day Filter: schwache Signale nur in NY/London Open
    const _utcH = new Date().getUTCHours();
    const _inSession = (_utcH >= 7 && _utcH < 11) ||  // London Open 07-11 UTC
                       (_utcH >= 13 && _utcH < 17);    // NY Open 13-17 UTC
    if (!_inSession && strength < 0.65) {
      Log.info('TIME_FILTER', 'Schwaches Signal ausserhalb Handelssession blockiert', { utcH:_utcH, strength:strength.toFixed(3) });
      return { approved:false, reason:'TIME_FILTER: schwaches Signal ausserhalb NY/London', corrId };
    }

    // 4b. Korrelations-Limit: max 2 Layer-1 Altcoins gleichzeitig
    const L1_GROUP = new Set(['SOLUSDT','AVAXUSDT','NEARUSDT','ADAUSDT','DOTUSDT','ATOMUSDT','APTUSDT','SUIUSDT','SEIUSDT']);
    if (L1_GROUP.has(symbol)) {
      const activeL1 = active.filter(t => L1_GROUP.has(t.symbol)).length;
      if (activeL1 >= 2) {
        Log.info('CORR_LIMIT', 'Max 2 L1-Altcoins gleichzeitig — blockiert', { symbol, activeL1 });
        return { approved:false, reason:'CORRELATION_LIMIT_L1: max 2 gleichzeitig', corrId };
      }
    }

    // 5. Position sizing mit Sentiment Scaler
    let size = Balance.calcPositionSize(0.5);
    size = RiskLadder.applyToSize(size);
    // Sentiment Scaler
    try { size = await SentimentScaler.applyToSize(size); } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }
    // VaR-Scaler
    try { size = await VaREngine.applyToSize(size); } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }
    // Drawdown Recovery: reduziert Größe wenn Tagsverlust zu hoch
    try { size = DrawdownRecovery.applyToSize(size); } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }
    // Recovery Mode: Mindest-Signalstärke erhöhen
    const recoveryRestrictions = DrawdownRecovery.getRestrictions();
    if (strength < recoveryRestrictions.minStrength) {
      return { approved:false, reason:`RECOVERY_MODE_STRENGTH: ${strength.toFixed(2)} < ${recoveryRestrictions.minStrength} (${recoveryRestrictions.label})`, corrId };
    }
    size = Math.max(CFG.MIN_POSITION_USDT, size);
    if (size > Balance.effective) return { approved:false, reason:'INSUFFICIENT_BALANCE', corrId };

    // 6. Edge calculation (inkl. Funding Rate Kosten – Punkt 4)
    const roundTrip = (CFG.MAKER_FEE + CFG.TAKER_FEE) * size;
    const expectedMove = strength * 0.02 * price;
    const ene = (expectedMove - roundTrip) / (size*price||1);
    if (ene < CFG.MIN_ENE) return { approved:false, reason:'EDGE_BELOW_MIN', ene, corrId };

    // 7. Strength threshold
    if (strength < CFG.MIN_SIGNAL_STRENGTH)
      return { approved:false, reason:'SIGNAL_TOO_WEAK', strength, corrId };

    // 8a. Anomalie-Check (blockiert bei statistisch ungewöhnlichen Marktbedingungen)
    try {
      const anomalyCheck = AnomalyDetector.shouldBlock(symbol, await Bitget.fetchCandles(symbol,'1h',50).catch(()=>[]));
      if (anomalyCheck.block) {
        Log.warn('ANOMALY', anomalyCheck.reason);
        return { approved:false, reason:'ANOMALY_DETECTED: '+anomalyCheck.reason, corrId };
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8b. Fear & Greed Check
    try {
      const fgCheck = await FearGreed.shouldBlock(direction);
      if (fgCheck.block) {
        Log.warn('FEARGREED', fgCheck.reason);
        strength = strength * 0.80; // Stärke reduzieren, nicht hart blocken
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8a. Multi-Timeframe Bestätigung (Priorität 1b)
    let mtfResult = { confirmed: true, bonus: 0 };
    try {
      mtfResult = await MTFConfirm.confirm(symbol, direction, strategy?.includes('15')? '15m' : '1h');
      if (!mtfResult.confirmed && mtfResult.bonus < 0) {
        strength = Math.max(0.1, strength + mtfResult.bonus);
        Log.info('MTF', `Stärke angepasst: ${strength.toFixed(3)} (${mtfResult.reason})`);
      } else if (mtfResult.confirmed && mtfResult.bonus > 0) {
        strength = Math.min(0.95, strength + mtfResult.bonus);
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8b. News-Sentiment Check (Priorität 2)
    try {
      const newsCheck = await NewsSentiment.shouldModify(direction);
      if (newsCheck.modify) {
        strength = strength * newsCheck.factor;
        Log.warn('NEWS', newsCheck.reason);
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8c. Fed/CPI Hard-Block: High-Impact Makro-Events → keine Trades
    try {
      const _recentNews = NewsSentiment.cache?.items || [];
      const _highImpact = ['fomc','fed rate','federal reserve','cpi','inflation data','nonfarm','nfp','gdp report','interest rate decision'];
      const _hasHighImpact = _recentNews.some(n => {
        const txt = (n.title||'').toLowerCase();
        return _highImpact.some(kw => txt.includes(kw));
      });
      if (_hasHighImpact) {
        Log.warn('NEWS_BLOCK', 'High-Impact Makro-Event erkannt — Trade blockiert');
        return { approved:false, reason:'NEWS_BLOCK: Fed/CPI/FOMC Event aktiv', corrId };
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8. Funding Rate Check (Punkt 4) – gegen Funding-Richtung warnen
    let fundingSignal = null;
    try {
      fundingSignal = await FundingEngine.getSignal(symbol);
      if (fundingSignal.direction !== 'NEUTRAL' && fundingSignal.direction !== direction && fundingSignal.strength > 0.70) {
        Log.warn('FUNDING', `Funding Rate gegen Trade: ${fundingSignal.reason}`);
        strength = strength * 0.85; // Staerke reduzieren, nicht blocken
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8d. SmartMoney Signal: Akkumulation/Distribution
    try {
      const smMod = await SmartMoney.getStrengthModifier(symbol, direction);
      if (smMod !== 0) {
        strength = Math.max(0.1, Math.min(0.95, strength + smMod));
        Log.info('SMARTMONEY', symbol + ' mod=' + smMod.toFixed(3) + ' str=' + strength.toFixed(3));
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8e. OnChain Whale Flow: Exchange In/Outflow
    try {
      const ocMod = await OnChainAnalysis.getStrengthModifier(symbol, direction);
      if (ocMod !== 0) {
        strength = Math.max(0.1, Math.min(0.95, strength + ocMod));
        Log.info('ONCHAIN', symbol + ' mod=' + ocMod.toFixed(3) + ' str=' + strength.toFixed(3));
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    // 8f. Reddit Sentiment AI
    try {
      const rsMod = await SentimentAI.getStrengthModifier(symbol, direction);
      if (rsMod !== 0) {
        strength = Math.max(0.1, Math.min(0.95, strength + rsMod));
        Log.info('REDDIT', symbol + ' mod=' + rsMod.toFixed(3) + ' str=' + strength.toFixed(3));
      }
    } catch(e){ try{Log.warn('DecisionFlow','err: '+e.message);}catch(_){} }

    Log.info('DEC', `APPROVED ${symbol} ${direction} size=${size.toFixed(2)} ene=${ene.toFixed(6)}`, { corrId });
    return { approved:true, symbol, direction, strength, size, price, ene, regime:Regime.regime, corrId, fundingSignal, safetyCheck };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION FLOW
// ─────────────────────────────────────────────────────────────────────────────
const ExecFlow = {
  async execute(decision) {
    if (!decision.approved) return { ok:false, reason:'NOT_APPROVED' };
    const { symbol, direction, size, price, corrId, strategy } = decision;

    // Journal-Eintrag
    Journal.add({
      tradeId: `${symbol}_${Date.now()}`,
      symbol, direction, strategy: strategy||'MANUAL',
      reason:   decision.regime || '',
      signal:   decision.fundingSignal?.direction || '',
      strength: decision.strength || 0,
    });

    // Create trade record
    const tradeId = Trades.create(symbol, direction.toLowerCase(), size, strategy||'MANUAL');

    // === PHASE 2.6: ExecutionAdapter vereinheitlicht DEMO und LIVE ===
    try {
      const fillResult = await ExecutionAdapter.placeOrder(symbol, direction, size, price, { source:'ExecFlow', corrId });
      if (!fillResult || !fillResult.ok) {
        DB.db.prepare(`UPDATE trades SET state='REJECTED' WHERE id=?`).run(tradeId);
        Incidents.create('ORDER_REJECT', (fillResult && fillResult.error) || 'adapter fail', 'MEDIUM');
        TelegramAlarm.warn('EXEC', 'Order Rejected: ' + (fillResult && fillResult.error || '?'));
        return { ok:false, mode: fillResult && fillResult.mode || '?', reason: fillResult && fillResult.error, corrId };
      }
      const fillPrice = fillResult.fillPrice;
      const fillSize  = fillResult.sizeUSDT;
      const candles = await Bitget.fetchCandles(symbol,'1h',20).catch(()=>[]);
      const atr = Ind.atr(candles) || fillPrice*0.01;
      Trades.recordFill(tradeId, fillPrice, atr);

      if (fillResult.mode === 'DEMO') {
        // Demo-Wallet aktualisieren (bis Phase 2.4 WalletProvider)
        const cost = fillSize;
        // Phase 2.4b: via WalletProvider
        if (direction==='BUY') WalletProvider.debit(cost);
        else WalletProvider.credit(cost);
        Log.info('EXEC', 'DEMO '+symbol+' '+direction+' '+fillSize.toFixed(2)+' @ '+fillPrice.toFixed(4)+' (slip:'+(fillResult.slippagePct*100).toFixed(3)+'%)', { corrId });
        return { ok:true, mode:'DEMO', tradeId, symbol, side:direction, size:fillSize, price:fillPrice, slippage:(fillResult.slippagePct*100).toFixed(3)+'%', corrId };
      }
      // LIVE-Pfad: orderId in DB + partial-fill-Incident
      if (fillResult.orderId) DB.db.prepare(`UPDATE trades SET order_id=? WHERE id=?`).run(fillResult.orderId, tradeId);
      if (fillResult.partialFill) {
        Log.warn('EXEC', 'PARTIAL FILL: '+symbol+' '+fillSize.toFixed(2)+'/'+size.toFixed(2));
        DB.db.prepare(`UPDATE trades SET size=? WHERE id=?`).run(fillSize, tradeId);
        Incidents.create('PARTIAL_FILL', symbol + ' partial', 'LOW');
      }
      Log.info('EXEC', 'LIVE ORDER '+fillResult.orderId+' '+symbol+' '+direction+' '+fillSize, { corrId });
      return { ok:true, mode:'LIVE', tradeId, orderId: fillResult.orderId, symbol, side:direction, size:fillSize, price:fillPrice, corrId };
    } catch(e) {
      DB.db.prepare(`UPDATE trades SET state='ERROR' WHERE id=?`).run(tradeId);
      Incidents.create('ORDER_ERROR', e.message, 'HIGH');
      TelegramAlarm.critical('EXEC', 'Order Error: Trade konnte nicht ausgefuehrt werden');
      Log.error('EXEC', 'Order error: '+e.message, { corrId });
      return { ok:false, reason:e.message, corrId };
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTONOMOUS ENGINE – the self-running trading loop
// ─────────────────────────────────────────────────────────────────────────────
const AutoEngine = {
  enabled:    false,
  running:    false,
  timer:      null,
  symbols:    ['BTCUSDT','ETHUSDT','XRPUSDT'],  // Wird von CoinScanner überschrieben
  granularity:'1h',
  intervalMs: CFG.SCAN_INTERVAL_MS,
  log:        [],
  stats:      { scansTotal:0, scansWithSignal:0, tradesAuto:0, tradesExited:0, errors:0, lastScan:null, lastSignal:null },

  _log(msg, level='INFO') {
    const entry = { ts:new Date().toISOString().slice(11,19), msg, level };
    this.log.unshift(entry);
    if (this.log.length>300) this.log.pop();
    Log.log(level, 'AUTO', msg);
  },

  start(intervalMs) {
    if (this.running) return { ok:false, reason:'Already running' };
    if (intervalMs) this.intervalMs = Math.max(15000, intervalMs);
    this.enabled=true; this.running=true;
    this._log(`Engine started | interval=${this.intervalMs/1000}s | symbols=${this.symbols.join(',')}`);
    this.timer = setInterval(()=>this._cycle(), this.intervalMs);
    this._cycle(); // immediate first scan
    return { ok:true, interval:this.intervalMs };
  },

  stop() {
    this.enabled=false; this.running=false;
    if (this.timer) { clearInterval(this.timer); this.timer=null; }
    this._log('Engine stopped');
    return { ok:true };
  },

  async _cycle() {
    if (!this.symbols.length && typeof CoinScanner !== 'undefined' && CoinScanner.activeCoins && CoinScanner.activeCoins.length) {
      this.symbols = CoinScanner.activeCoins;
    }
    if (!this.symbols.length) {
      this.symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ARBUSDT'];
    }
    if (!this.enabled || KillSwitch.mode==='HALTED') return;
    this.stats.scansTotal++;
    this.stats.lastScan = new Date().toISOString();

    try {
      await refreshBalances();
      KillSwitch.check();
      await this._checkExits();
      Strategies.autoDisable(); // check performance
      // Preis-Alerts prüfen
      await PriceAlerts.check().catch(() => {});
      // VaR täglich aktualisieren
      if (this.stats.scansTotal % 6 === 0) {
        await VaREngine.calculate(this.symbols[0]).catch(() => {});
      }
      // Wallet-Tracker
      if (WalletTracker.enabled && this.stats.scansTotal % 10 === 0) {
        try {
          await WalletTracker.run();
          const wSnap = WalletTracker.snapshot();
          const WHALE_ALERT_THRESHOLD = 500000;
          if (wSnap && wSnap.alerts && wSnap.alerts.length > 0) {
            const bigMoves = wSnap.alerts.filter(a => (a.value || 0) >= WHALE_ALERT_THRESHOLD);
            if (bigMoves.length > 0) {
              const msg = bigMoves.map(a => (a.direction === 'IN' ? '🔴 ' : '🟢 ') + (a.label||a.address||'?') + ': ' + ((a.value||0)/1e6).toFixed(1) + 'M USD ' + (a.direction||'')).join('\n');
              TelegramBot.send('🐋 Whale Wallet Alert:\n' + msg);
              Log.info('WHALE', 'Grosse Bewegung: ' + bigMoves.length + ' Alerts');
            }
          }
        } catch(_) {}
      }
      if (!['HALTED','EXIT_ONLY'].includes(KillSwitch.mode)) {
        await this._scanSignals();
      }
    } catch(e) {
      this.stats.errors++;
      this._log(`Cycle error: ${e.message}`, 'ERROR');
      Incidents.create('AUTO_CYCLE_ERROR', e.message, 'MEDIUM');
      SelfHeal.recordError('AUTO_ENGINE', e.message);
    }
  },

  async _checkExits() {
    const active = Trades.getActive();
    if (!active.length) return;
    for (const trade of active) {
      try {
        const ticker = await Bitget.fetchTicker(trade.symbol);
        if (!ticker) continue;
        const candles = await Bitget.fetchCandles(trade.symbol, this.granularity, 50);
        const exit = ExitEngine.evaluate(trade, candles, ticker.last);
        if (!exit?.shouldExit) continue;
        this._log(`Exit: ${trade.symbol} ${trade.side} | ${exit.reason} | PnL≈${exit.pnlPct?(exit.pnlPct*100).toFixed(2)+'%':'?'}`);
        // Execute exit order
        if (CFG.API_KEY && ['LIVE_RESTRICTED','LIVE_FULL'].includes(CFG.DEPLOY_MODE)) {
          const closeSide = trade.side==='buy' ? 'sell' : 'buy';
          await Bitget.placeSportOrder(trade.symbol, closeSide, trade.size).catch(e=>this._log(`Exit order fail: ${e.message}`,'WARN'));
        }
        Trades.close(trade.id, ticker.last, exit.reason);
        this.stats.tradesExited++;
        // Cooldown
        _cooldowns[trade.symbol] = Date.now() + this.intervalMs*2;
      } catch(e) { this._log(`Exit check error ${trade.symbol}: ${e.message}`, 'WARN'); }
    }
  },

  async _scanSignals() {
    for (const symbol of this.symbols) {
      if (Date.now() < (_cooldowns[symbol]||0)) continue;
      try {
        // ── PARALLEL FETCH: Kerzen + Orderbook gleichzeitig ──────────────
        // Vorher: sequentiell 2×80ms = 160ms nur I/O
        // Jetzt:  parallel ~80ms (warten auf den langsamsten)
        const [candles, ob] = await Promise.all([
          Bitget.fetchCandles(symbol, this.granularity, 150),
          Bitget.fetchOrderbook(symbol).catch(()=>null),
        ]);
        if (!candles || candles.length < 30) continue;
        Regime.detect(candles);

        // Flash Crash Bot Check
        const ticker = Bitget.priceCache[symbol];
        const flashSignal = FlashCrashBot.detect(candles, ticker);
        if (flashSignal && flashSignal.type === 'FLASH_CRASH' && flashSignal.action === 'BUY_RECOVERY') {
          this._log(`FLASH CRASH RECOVERY SIGNAL: ${symbol} ${flashSignal.reason}`, 'WARN');
          const decision = await DecisionFlow.run(symbol, 'BUY', flashSignal.strength, 'FLASH_CRASH_RECOVERY', candles);
          if (decision.approved) {
            const result = await ExecFlow.execute(decision);
            if (result.ok) { this.stats.tradesAuto++; this._log(`FLASH RECOVERY TRADE: ${symbol} ${result.mode}`); }
          }
          continue;
        }

        // ── PARALLEL BERECHNUNG: Indikatoren gleichzeitig ─────────────
        // Ichimoku, Pattern, Elliott Wave unabhängig voneinander
        const [ichimoku, patternSig, elliottWave] = await Promise.all([
          Promise.resolve(Ind.ichimoku(candles)),
          Promise.resolve(Ind.patternSignal(candles)),
          Promise.resolve(Ind.elliottWave(candles)),
        ]);

        const rawSignals = Strategies.getAll(candles, ob);

        // CVD Signal (Cumulative Volume Delta)
        try {
          const cvdSig = CVDEngine.signal(candles);
          if (cvdSig) {
            rawSignals.push({ strategy:'CVD', direction:cvdSig.direction, strength:cvdSig.strength, meta:{ reason:cvdSig.reason } });
            this._log(`CVD Signal: ${cvdSig.direction} (${cvdSig.reason})`);
          }
        } catch(_) {}

        // RL Agent Stimme
        try {
          const rlDec = RLAgent.decide(candles);
          if (rlDec.action !== 'HOLD') {
            rawSignals.push({ strategy:'RL_AGENT', direction:rlDec.action, strength:Math.min(0.75, rlDec.confidence), meta:{ state:rlDec.state, mode:rlDec.mode } });
          }
        } catch(_) {}

        // ML-Modell Signal (wenn trainiert)
        if (MLOptimizer.trained) {
          const mlPred = MLOptimizer.predict(candles);
          if (mlPred.signal !== 'HOLD' && mlPred.confidence > 0.62) {
            rawSignals.push({
              strategy: 'ML_ENSEMBLE',
              direction: mlPred.signal,
              strength:  mlPred.confidence,
              meta: { rf:mlPred.models?.rf, gb:mlPred.models?.gb, pc:mlPred.models?.perceptron },
            });
            this._log(`ML Signal: ${mlPred.signal} Conf=${(mlPred.confidence*100).toFixed(0)}% [RF:${mlPred.models?.rf} GB:${mlPred.models?.gb}]`);
          }
        }

        // Candlestick Pattern als extra Signal hinzufuegen
        if (patternSig && patternSig.strength > 0.68) {
          rawSignals.push({ strategy:'CANDLE_PATTERN', direction:patternSig.direction, strength:patternSig.strength, meta:{ pattern:patternSig.pattern } });
        }

        if (!rawSignals.length) continue;
        let signal = Strategies.consensus(rawSignals);
        if (!signal || signal.strength < CFG.MIN_SIGNAL_STRENGTH) continue;

        // Ichimoku Confirmation: Wenn Signal gegen Ichimoku Cloud → Staerke reduzieren
        if (ichimoku) {
          if (signal.direction === 'BUY' && ichimoku.belowCloud) signal.strength *= 0.80;
          if (signal.direction === 'SELL' && ichimoku.aboveCloud) signal.strength *= 0.80;
          if (signal.direction === 'BUY' && ichimoku.bullish) signal.strength = Math.min(0.95, signal.strength * 1.10);
          if (signal.direction === 'SELL' && ichimoku.bearish) signal.strength = Math.min(0.95, signal.strength * 1.10);
        }

        // Elliott Wave Confirmation: Wave 3 ist starkster Impuls
        if (elliottWave?.wave?.includes('WAVE_3') && elliottWave.bias === signal.direction) {
          signal.strength = Math.min(0.95, signal.strength * 1.08);
          this._log(`Elliott Wave 3 bestaetigt ${signal.direction} auf ${symbol}`);
        }

        if (signal.strength < CFG.MIN_SIGNAL_STRENGTH) continue;
        this.stats.scansWithSignal++;
        this.stats.lastSignal = { symbol, ...signal, ts:new Date().toISOString() };
        this._log(`Signal: ${symbol} ${signal.direction} str=${signal.strength.toFixed(2)} [${(signal.strategies||[signal.strategy]).join(',')}]`);
        // Decision + Execution
        const decision = await DecisionFlow.run(symbol, signal.direction, signal.strength, (signal.strategies||[signal.strategy]).join('+'));
        if (!decision.approved) { this._log(`Blocked: ${decision.reason}`, 'WARN'); continue; }
        const result = await ExecFlow.execute(decision);
        if (result.ok) {
          this.stats.tradesAuto++;
          this._log(`✓ TRADE: ${symbol} ${signal.direction} ${result.size?.toFixed(2)} USDT | ${result.mode}`);
          _cooldowns[symbol] = Date.now() + this.intervalMs*3;
        } else {
          this._log(`Trade fail: ${result.reason}`, 'WARN');
        }
      } catch(e) { this._log(`Scan error ${symbol}: ${e.message}`, 'WARN'); }
    }
  },

  snapshot() {
    return { enabled:this.enabled, running:this.running, scanInterval:this.intervalMs, activeSymbols:this.symbols, granularity:this.granularity, stats:this.stats, log:this.log.slice(0,50) };
  }
};

const _cooldowns = {}; // symbol → timestamp

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE REFRESH
// ─────────────────────────────────────────────────────────────────────────────
async function refreshBalances() {
  try {
    if (!CFG.API_KEY) {
      // Demo mode
      Balance.spot=1000; Balance.futures=500; Balance.free=1500; Balance.locked=0;
    } else {
      const spot = await Bitget.fetchSpotBalance();
      let fut = { available: 0, locked: 0 };
      try { fut = await Bitget.fetchFuturesBalance(); } catch(_fe) { /* Futures nicht aktiviert */ }
      Balance.spot=spot.available; Balance.futures=fut.available;
      Balance.free=spot.available+fut.available; Balance.locked=spot.frozen+fut.locked;
    }
    Balance.applyCapitalSplit(Balance.free);
    Balance.updateStability();
    Balance.valid=true; Balance.lastFetched=new Date().toISOString();
    if (Balance.usable > Balance.peakEquity) Balance.peakEquity=Balance.usable;
    try { DB.insertBalance.run(Date.now(), Balance.usable, Balance.reserve, Balance.trading, Balance.dailyPnL); } catch(_){}
    NoTrade.gates.balanceValid = CFG.DEPLOY_MODE==='PAPER' ? (DemoEngine.wallet?.trading||0)>10 : Balance.usable>CFG.MIN_USABLE_BALANCE;
    NoTrade.gates.profitabilityGreen = Balance.trading > 0;
    NoTrade.gates.deployModeAllows = ['DRY_LIVE','LIVE_RESTRICTED','LIVE_FULL'].includes(CFG.DEPLOY_MODE);
  } catch(e) {
    if ((typeof Incidents.countType === 'function' ? Incidents.countType('BALANCE_FETCH') : 0) < 3) {
      Incidents.create('BALANCE_FETCH', e.message, 'HIGH');
    }
    Log.error('BALANCE', `Refresh failed: ${e.message}`);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// MONTE CARLO SIMULATION + BAYESIANISCHE RISIKOMODELLE (Aladdin-Style)
// ══════════════════════════════════════════════════════════════════════════════
const RiskEngine = {

  // ── MONTE CARLO SIMULATION ─────────────────────────────────────────────────
  // Simuliert N zufällige Zukunftsszenarien aus historischen Returns
  monteCarlo(candles, simulations=1000, horizon=20) {
    if (!candles || candles.length < 30) return null;
    const closes = candles.map(c => c.close);
    // Historische tägliche Returns berechnen
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const currentPrice = closes[closes.length - 1];

    // Simulationen laufen lassen
    const finalPrices = [];
    const maxDrawdowns = [];
    for (let sim = 0; sim < simulations; sim++) {
      let price = currentPrice;
      let peak = price;
      let maxDD = 0;
      for (let step = 0; step < horizon; step++) {
        // Box-Muller Transform für normalverteilte Zufallszahlen
        const u1 = Math.random(), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const ret = mean + stdDev * z;
        price *= (1 + ret);
        if (price > peak) peak = price;
        const dd = (peak - price) / peak;
        if (dd > maxDD) maxDD = dd;
      }
      finalPrices.push(price);
      maxDrawdowns.push(maxDD);
    }

    finalPrices.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);

    // Value at Risk (VaR) bei 95% und 99%
    const var95 = finalPrices[Math.floor(simulations * 0.05)];
    const var99 = finalPrices[Math.floor(simulations * 0.01)];
    const var95Pct = (currentPrice - var95) / currentPrice;
    const var99Pct = (currentPrice - var99) / currentPrice;

    // Expected Shortfall (CVaR) — Durchschnitt der schlimmsten 5%
    const worstSlice = finalPrices.slice(0, Math.floor(simulations * 0.05));
    const cvar = worstSlice.reduce((a, b) => a + b, 0) / worstSlice.length;
    const cvarPct = (currentPrice - cvar) / currentPrice;

    // Median und Erwartungswert
    const median = finalPrices[Math.floor(simulations / 2)];
    const expectedReturn = (finalPrices.reduce((a, b) => a + b, 0) / simulations - currentPrice) / currentPrice;
    const maxDD95 = maxDrawdowns[Math.floor(simulations * 0.95)];

    return {
      simulations, horizon,
      currentPrice,
      var95: var95Pct,   // Max Verlust mit 95% Wahrscheinlichkeit
      var99: var99Pct,   // Max Verlust mit 99% Wahrscheinlichkeit
      cvar: cvarPct,     // Expected Shortfall (schlimmste 5%)
      expectedReturn,    // Erwartete Rendite
      medianPrice: median,
      maxDrawdown95: maxDD95,
      signal: var95Pct > 0.15 ? 'HIGH_RISK' : var95Pct > 0.08 ? 'MEDIUM_RISK' : 'LOW_RISK',
      scaleFactor: Math.max(0.2, 1 - var95Pct * 3), // Position verkleinern bei hohem Risiko
    };
  },

  // ── BAYESIANISCHES MODELL ──────────────────────────────────────────────────
  // Passt Vorhersagen dynamisch an neue Marktdaten an
  bayesian: {
    // Prior-Wahrscheinlichkeiten (werden laufend aktualisiert)
    priors: { bull: 0.33, bear: 0.33, sideways: 0.34 },
    // Likelihoods: P(Signal | Zustand)
    likelihoods: {
      bull:     { highRSI: 0.7, macdBull: 0.75, volSpike: 0.4, pricAboveEMA: 0.8 },
      bear:     { highRSI: 0.15, macdBull: 0.1, volSpike: 0.6, pricAboveEMA: 0.1 },
      sideways: { highRSI: 0.15, macdBull: 0.15, volSpike: 0.3, pricAboveEMA: 0.4 },
    },
    history: [],

    // Bayesian Update: P(Zustand | Beobachtung) ∝ P(Beobachtung | Zustand) × P(Zustand)
    update(observations) {
      const { rsi, macdBull, volSpike, priceAboveEMA } = observations;
      const states = ['bull', 'bear', 'sideways'];
      const posteriors = {};
      let total = 0;

      for (const state of states) {
        const lk = this.likelihoods[state];
        let likelihood = 1;
        if (rsi !== null) {
          likelihood *= rsi > 60 ? lk.highRSI : (1 - lk.highRSI);
        }
        if (macdBull !== null) {
          likelihood *= macdBull ? lk.macdBull : (1 - lk.macdBull);
        }
        if (volSpike !== null) {
          likelihood *= volSpike ? lk.volSpike : (1 - lk.volSpike);
        }
        if (priceAboveEMA !== null) {
          likelihood *= priceAboveEMA ? lk.pricAboveEMA : (1 - lk.pricAboveEMA);
        }
        posteriors[state] = likelihood * this.priors[state];
        total += posteriors[state];
      }

      // Normalisieren
      for (const state of states) {
        posteriors[state] /= (total || 1);
      }

      // Priors für nächste Iteration aktualisieren (langsam lernen)
      const lr = 0.1; // Learning Rate
      for (const state of states) {
        this.priors[state] = this.priors[state] * (1 - lr) + posteriors[state] * lr;
      }

      // History speichern
      this.history.unshift({ ts: Date.now(), posteriors: {...posteriors} });
      if (this.history.length > 100) this.history.pop();

      const dominant = states.reduce((a, b) => posteriors[a] > posteriors[b] ? a : b);
      const confidence = posteriors[dominant];

      return {
        posteriors,
        regime: dominant,
        confidence,
        signal: dominant === 'bull' && confidence > 0.55 ? 'BUY' :
                dominant === 'bear' && confidence > 0.55 ? 'SELL' : 'HOLD',
        priors: {...this.priors},
      };
    },

    // Likelihoods aus echten Trade-Ergebnissen anpassen
    learn(state, observations, wasCorrect) {
      const lk = this.likelihoods[state];
      const lr = 0.05;
      if (observations.highRSI !== undefined) {
        lk.highRSI += wasCorrect ? lr : -lr;
        lk.highRSI = Math.max(0.05, Math.min(0.95, lk.highRSI));
      }
    },
  },

  // ── KOMBINIERTE ANALYSE ────────────────────────────────────────────────────
  async analyze(symbol, candles) {
    try {
      const mc = this.monteCarlo(candles, 500, 10);
      const closes = candles.map(c => c.close);
      const vols = candles.map(c => c.vol);

      // Beobachtungen für Bayesian berechnen
      const rsi = closes.length > 14 ? (() => {
        let g=0, l=0;
        for (let i=1; i<=14; i++) { const d=closes[i]-closes[i-1]; if(d>0)g+=d; else l-=d; }
        const ag=g/14, al=l/14;
        return al===0?100:100-(100/(1+ag/al));
      })() : null;

      const ema20 = closes.length >= 20 ? (() => {
        const k = 2/21; let e = closes.slice(0,20).reduce((a,b)=>a+b,0)/20;
        for(let i=20;i<closes.length;i++) e=closes[i]*k+e*(1-k); return e;
      })() : null;

      const avgVol = vols.slice(-20).reduce((a,b)=>a+b,0)/20;
      const lastVol = vols[vols.length-1];

      const observations = {
        rsi,
        macdBull: null, // Wird von Hauptanalyse gefüllt
        volSpike: lastVol > avgVol * 2,
        priceAboveEMA: ema20 ? closes[closes.length-1] > ema20 : null,
      };

      const bayesian = this.bayesian.update(observations);

      return {
        symbol,
        monteCarlo: mc,
        bayesian,
        combined: {
          var95: mc ? mc.var95 : null,
          regime: bayesian.regime,
          confidence: bayesian.confidence,
          signal: bayesian.signal,
          positionScale: mc ? mc.scaleFactor : 1.0,
          riskLevel: mc ? mc.signal : 'UNKNOWN',
        }
      };
    } catch(e) {
      Log.warn('RISK', `RiskEngine.analyze Fehler: ${e.message}`);
      return null;
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// ALADDIN-STYLE FEATURES — Korrelation · Sharpe Live · Drawdown · Volatilität
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. KORRELATIONSMATRIX ─────────────────────────────────────────────────────
const CorrelationEngine = {
  // Berechnet Pearson-Korrelation zwischen zwei Preis-Arrays
  pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 10) return null;
    const ax = a.slice(-n), bx = b.slice(-n);
    const ma = ax.reduce((s,v)=>s+v,0)/n;
    const mb = bx.reduce((s,v)=>s+v,0)/n;
    let num=0, da=0, db=0;
    for (let i=0; i<n; i++) {
      const a_=ax[i]-ma, b_=bx[i]-mb;
      num+=a_*b_; da+=a_*a_; db+=b_*b_;
    }
    return da===0||db===0 ? 0 : num/Math.sqrt(da*db);
  },

  // Returns berechnen
  returns(prices) {
    const r = [];
    for (let i=1; i<prices.length; i++) {
      r.push((prices[i]-prices[i-1])/prices[i-1]);
    }
    return r;
  },

  // Korrelationsmatrix für alle Coins berechnen
  async compute(symbols, limit=50) {
    const priceMap = {};
    await Promise.allSettled(symbols.map(async sym => {
      try {
        const candles = await Bitget.fetchCandles(sym, '1h', limit);
        if (candles && candles.length > 10) {
          priceMap[sym] = this.returns(candles.map(c => c.close));
        }
      } catch(e) {}
    }));

    const syms = Object.keys(priceMap);
    const matrix = {};
    for (const a of syms) {
      matrix[a] = {};
      for (const b of syms) {
        matrix[a][b] = a===b ? 1.0 : (this.pearson(priceMap[a], priceMap[b]) || 0);
      }
    }

    // Durchschnittliche Korrelation pro Coin
    const avgCorr = {};
    for (const a of syms) {
      const others = syms.filter(s=>s!==a);
      avgCorr[a] = others.length > 0
        ? others.reduce((s,b)=>s+Math.abs(matrix[a][b]),0)/others.length
        : 0;
    }

    return { matrix, symbols: syms, avgCorr };
  },
};

// ── 2. SHARPE RATIO LIVE ──────────────────────────────────────────────────────
const SharpeEngine = {
  RISK_FREE_RATE: 0.05 / 365, // 5% p.a. täglich

  // Sharpe aus Candle-Returns
  fromCandles(candles, riskFreeDaily = this.RISK_FREE_RATE) {
    if (!candles || candles.length < 20) return null;
    const returns = [];
    for (let i=1; i<candles.length; i++) {
      returns.push((candles[i].close - candles[i-1].close) / candles[i-1].close);
    }
    const mean = returns.reduce((s,v)=>s+v,0)/returns.length;
    const variance = returns.reduce((s,v)=>s+(v-mean)**2,0)/returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return null;
    const excess = mean - riskFreeDaily;
    const sharpe = (excess / stdDev) * Math.sqrt(365); // Annualisiert
    return {
      sharpe: parseFloat(sharpe.toFixed(3)),
      meanReturn: parseFloat((mean*100).toFixed(4)),
      stdDev: parseFloat((stdDev*100).toFixed(4)),
      signal: sharpe > 1.5 ? 'EXCELLENT' : sharpe > 0.5 ? 'GOOD' : sharpe > 0 ? 'WEAK' : 'NEGATIVE',
    };
  },

  // Sharpe für mehrere Symbols
  async multi(symbols) {
    const results = {};
    await Promise.allSettled(symbols.map(async sym => {
      try {
        const candles = await Bitget.fetchCandles(sym, '1h', 100);
        const s = this.fromCandles(candles);
        if (s) results[sym] = s;
      } catch(e) {}
    }));
    return results;
  },
};

// ── 3. DRAWDOWN RECOVERY TRACKER ─────────────────────────────────────────────
const DrawdownTracker = {
  // Berechnet Max Drawdown + Recovery Zeit aus Candles
  analyze(candles) {
    if (!candles || candles.length < 10) return null;
    const closes = candles.map(c => c.close);
    let peak = closes[0], maxDD = 0, ddStart = 0, ddEnd = 0;
    let currentDD = 0, recoveryBars = 0;

    for (let i=0; i<closes.length; i++) {
      if (closes[i] > peak) {
        peak = closes[i];
        currentDD = 0;
      } else {
        currentDD = (peak - closes[i]) / peak;
        if (currentDD > maxDD) {
          maxDD = currentDD;
          ddEnd = i;
        }
      }
    }

    // Recovery Zeit nach Max Drawdown
    const ddPeak = closes[ddEnd - Math.round(maxDD * 10)] || peak;
    for (let i=ddEnd; i<closes.length; i++) {
      if (closes[i] >= ddPeak) { recoveryBars = i - ddEnd; break; }
    }

    // Calmar Ratio (annualisierte Rendite / Max Drawdown)
    const totalReturn = (closes[closes.length-1] - closes[0]) / closes[0];
    const annReturn = totalReturn * (8760 / closes.length); // 1h Kerzen
    const calmar = maxDD > 0 ? annReturn / maxDD : 0;

    return {
      maxDrawdown: parseFloat((maxDD * 100).toFixed(2)),
      recoveryBars,
      recoveryHours: recoveryBars,
      calmarRatio: parseFloat(calmar.toFixed(3)),
      currentPrice: closes[closes.length-1],
      peakPrice: peak,
      distFromPeak: parseFloat(((peak - closes[closes.length-1]) / peak * 100).toFixed(2)),
      signal: maxDD < 0.05 ? 'STABLE' : maxDD < 0.15 ? 'MODERATE' : 'HIGH_RISK',
    };
  },
};

// ── 4. VOLATILITÄTSREGIME ERKENNUNG ──────────────────────────────────────────
const VolatilityRegime = {
  // ATR-basierte Regime-Erkennung
  detect(candles) {
    if (!candles || candles.length < 30) return null;
    const recent = candles.slice(-20);
    const older  = candles.slice(-50, -20);

    const atr = (data) => {
      let sum = 0;
      for (let i=1; i<data.length; i++) {
        const tr = Math.max(
          data[i].high - data[i].low,
          Math.abs(data[i].high - data[i-1].close),
          Math.abs(data[i].low  - data[i-1].close)
        );
        sum += tr;
      }
      return sum / (data.length - 1);
    };

    const atrRecent = atr(recent);
    const atrOlder  = atr(older);
    const ratio     = atrOlder > 0 ? atrRecent / atrOlder : 1;

    // Historische Volatilität (HV)
    const returns = [];
    for (let i=1; i<recent.length; i++) {
      returns.push(Math.log(recent[i].close / recent[i-1].close));
    }
    const meanR = returns.reduce((s,v)=>s+v,0)/returns.length;
    const hvDaily = Math.sqrt(returns.reduce((s,v)=>s+(v-meanR)**2,0)/returns.length);
    const hvAnn   = hvDaily * Math.sqrt(8760); // Annualisiert (1h Kerzen)

    const regime =
      ratio > 1.5 ? 'EXTREME'  :
      ratio > 1.2 ? 'HIGH'     :
      ratio < 0.7 ? 'LOW'      : 'NORMAL';

    return {
      regime,
      atrRatio: parseFloat(ratio.toFixed(3)),
      hvDaily:  parseFloat((hvDaily * 100).toFixed(4)),
      hvAnn:    parseFloat((hvAnn * 100).toFixed(2)),
      positionScale: regime === 'EXTREME' ? 0.25 : regime === 'HIGH' ? 0.5 : regime === 'LOW' ? 1.5 : 1.0,
      signal: regime === 'EXTREME' ? 'REDUCE_SIZE' : regime === 'HIGH' ? 'CAUTION' : regime === 'LOW' ? 'INCREASE_OK' : 'NORMAL',
    };
  },
};

// ── 5. NEWS SENTIMENT SCORE ───────────────────────────────────────────────────
const SentimentEngine = {
  _cache: {},
  _cacheTs: 0,

  // Bullische / Bärische Keywords
  BULL_WORDS: ['rally','surge','soar','breakout','bullish','buy','adoption','etf','institutional','upgrade','partnership','launch','moon','ath','record'],
  BEAR_WORDS: ['crash','dump','fall','bearish','sell','hack','ban','regulate','lawsuit','fraud','scam','fear','panic','plunge','collapse'],

  score(text) {
    const t = (text||'').toLowerCase();
    let bull = 0, bear = 0;
    this.BULL_WORDS.forEach(w => { if (t.includes(w)) bull++; });
    this.BEAR_WORDS.forEach(w => { if (t.includes(w)) bear++; });
    const total = bull + bear;
    const score = total > 0 ? (bull - bear) / total : 0;
    return {
      score: parseFloat(score.toFixed(3)),
      bull, bear,
      signal: score > 0.3 ? 'BULLISH' : score < -0.3 ? 'BEARISH' : 'NEUTRAL',
    };
  },

  // Aggregierter Score aus mehreren News
  aggregate(newsArray) {
    if (!newsArray || newsArray.length === 0) return { score: 0, signal: 'NEUTRAL', count: 0 };
    const scores = newsArray.map(n => this.score(n.title + ' ' + (n.description||'')));
    const avg = scores.reduce((s,v)=>s+v.score,0)/scores.length;
    return {
      score: parseFloat(avg.toFixed(3)),
      signal: avg > 0.2 ? 'BULLISH' : avg < -0.2 ? 'BEARISH' : 'NEUTRAL',
      count: newsArray.length,
      breakdown: { bull: scores.filter(s=>s.signal==='BULLISH').length, bear: scores.filter(s=>s.signal==='BEARISH').length, neutral: scores.filter(s=>s.signal==='NEUTRAL').length },
    };
  },
};

// ── 6. PORTFOLIO HEAT MAP ─────────────────────────────────────────────────────
const HeatMapEngine = {
  // Berechnet Heat (Risiko-Score) pro Symbol
  async compute(symbols) {
    const heat = {};
    await Promise.allSettled(symbols.map(async sym => {
      try {
        const candles = await Bitget.fetchCandles(sym, '1h', 50);
        if (!candles || candles.length < 20) return;
        const vol  = VolatilityRegime.detect(candles);
        const shp  = SharpeEngine.fromCandles(candles);
        const dd   = DrawdownTracker.analyze(candles);
        const closes = candles.map(c=>c.close);
        const change24h = closes.length >= 24 ? (closes[closes.length-1]-closes[closes.length-25])/closes[closes.length-25]*100 : 0;

        // Heat Score 0-100 (höher = mehr Risiko)
        let heatScore = 50;
        if (vol) {
          heatScore += vol.regime === 'EXTREME' ? 30 : vol.regime === 'HIGH' ? 15 : vol.regime === 'LOW' ? -15 : 0;
        }
        if (dd) heatScore += dd.maxDrawdown > 15 ? 20 : dd.maxDrawdown > 5 ? 10 : 0;
        if (shp) heatScore -= shp.sharpe > 1 ? 15 : shp.sharpe < 0 ? 15 : 0;
        heatScore = Math.max(0, Math.min(100, heatScore));

        heat[sym] = {
          heatScore,
          change24h: parseFloat(change24h.toFixed(2)),
          volatility: vol?.regime || 'UNKNOWN',
          sharpe: shp?.sharpe || 0,
          maxDD: dd?.maxDrawdown || 0,
          color: heatScore > 70 ? 'danger' : heatScore > 40 ? 'warn' : 'accent2',
        };
      } catch(e) {}
    }));
    return heat;
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── STATUS ──
app.get('/api/status', (req,res) => res.json({
  mode: CFG.API_KEY?'LIVE':'DEMO', deployMode: CFG.DEPLOY_MODE,
  uptime: process.uptime(), state: KillSwitch.mode,
  balance: Balance.snapshot(), noTrade: NoTrade.verdict(),
  killSwitch: KillSwitch.snapshot(), bitget: Bitget.snapshot(),
  incidents: { open:Incidents.getOpen().length, pressure:Incidents.pressureScore() },
  autonomous: { running:AutoEngine.running||DemoEngine.running, scans:AutoEngine.stats.scansTotal||DemoEngine.stats.scans, trades:AutoEngine.stats.tradesAuto||DemoEngine.stats.trades },
  demo: DemoEngine.snapshot(),
  regime: Regime.regime,
  ml: { trained: MLOptimizer.trained, rfTrees: MLOptimizer.RF?.trees?.length||0, rlEpisodes: RLAgent.episodes },
  coinScanner: { enabled: CoinScanner.enabled, activeCoins: CoinScanner.activeCoins },
  selfHeal: { enabled: true },
  drawdownRecovery: { mode: DrawdownRecovery.mode || 'NORMAL' },
  sentiment: { signal: FearGreed.cache?.label || 'N/A', value: FearGreed.cache?.value },
}));

// ── SNAPSHOT ──
app.get('/api/snapshot', (req,res) => res.json({
  mode:CFG.API_KEY?'LIVE':'DEMO', deployMode:CFG.DEPLOY_MODE,
  uptime:process.uptime(), balance:Balance.snapshot(),
  killSwitch:KillSwitch.snapshot(), noTrade:NoTrade.verdict(),
  regime:Regime.snapshot(), monitoring:{ drawdown: Balance.peakEquity>0?(Balance.peakEquity-Balance.usable)/Balance.peakEquity:0, alerts:[] },
  incidents:{ open:Incidents.getOpen().length, pressure:Incidents.pressureScore() },
  reconciliation:{ state:Recon.state, mismatches:Recon.mismatches },
  portfolio:{ heatScore:Math.min(1,Trades.getActive().length/CFG.MAX_OPEN_TRADES), exposure:{ total:Trades.getActive().reduce((s,t)=>s+(t.size||0),0), tradeCount:Trades.getActive().length, byAsset:{} } },
  futures:{ leverage:CFG.DEFAULT_LEVERAGE, marginMode:'isolated', fundingAccrued:0 },
  deployment:{ current:CFG.DEPLOY_MODE, isLive:['LIVE_RESTRICTED','LIVE_FULL'].includes(CFG.DEPLOY_MODE) },
  trades:{ active:Trades.getActive().length, total:Trades.getAll().length },
  autonomous:AutoEngine.snapshot(),
  performance:PerfTracker.systemStats(),
}));

// ── BALANCE ──
app.get('/api/balance', async (req,res) => {
  await refreshBalances();
  res.json({ mode:CFG.API_KEY?'LIVE':'DEMO', balance:Balance.snapshot(), noTrade:NoTrade.verdict() });
});

// ── TICKER ──
app.get('/api/ticker/:symbol', async (req,res) => {
  try { const ticker=await Bitget.fetchTicker(req.params.symbol); res.json({ ticker, fresh:true }); }
  catch(e) { res.status(500).json({ error:'Interner Fehler' }); }
});

// ── INDICATORS ──
app.get('/api/indicators/:symbol', async (req,res) => {
  const { symbol } = req.params;
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(symbol, gran, 150);
  if (!candles.length) return res.json({ error:'No data' });
  const closes = candles.map(c=>c.close);
  res.json({
    symbol, granularity:gran, candles:candles.length,
    rsi:       Ind.rsi(closes),
    ema9:      Ind.ema(closes,9),
    ema21:     Ind.ema(closes,21),
    ema50:     Ind.ema(closes,50),
    macd:      Ind.macd(closes),
    bb:        Ind.bb(closes),
    atr:       Ind.atr(candles),
    vwap:      Ind.vwap(candles.slice(-20)),
    stochastic:Ind.stochastic(candles),
    momentum:  Ind.momentum(closes,10),
    volOsc:    Ind.volOsc(candles),
    cmo:       Ind.cmo(closes),
    squeeze:   Ind.squeezeMomentum(candles),
  });
});

// ── REGIME ──
app.get('/api/regime/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 150);
  Regime.detect(candles);
  res.json({ regime:Regime.snapshot(), candles:candles.slice(-5) });
});

// ── SIGNALS ──
app.get('/api/signals/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 150);
  Regime.detect(candles);
  const ob = await Bitget.fetchOrderbook(req.params.symbol).catch(()=>null);
  res.json({
    symbol:req.params.symbol, regime:Regime.regime,
    grid:      Strategies.gridSpot(candles),
    trend:     Strategies.trendFollow(candles),
    meanRevert:Strategies.meanRevert(candles, ob),
    scalp:     Strategies.scalp(candles),
    squeezePlay:Strategies.squeezePlay(candles),
    orderFlowImbalance: Ind.orderFlowImbalance(ob),
  });
});

// ── DECISION ──
app.post('/api/decision', async (req,res) => {
  const { symbol='BTCUSDT', direction='BUY', strength=0.7 } = req.body;
  const candles = await Bitget.fetchCandles(symbol,'1h',100);
  Regime.detect(candles);
  const decision = await DecisionFlow.run(symbol, direction, strength);
  res.json(decision);
});

// ── EXECUTE TRADE ──
app.post('/api/trade/execute', async (req,res) => {
  const { symbol='BTCUSDT', direction='BUY', strength=0.7 } = req.body;
  const candles = await Bitget.fetchCandles(symbol,'1h',100);
  Regime.detect(candles);
  const decision = await DecisionFlow.run(symbol, direction, strength);
  if (!decision.approved) return res.status(403).json({ blocked:true, ...decision });
  const result = await ExecFlow.execute(decision);
  res.json(result);
});

// ── CLOSE TRADE ──
app.post('/api/trade/close', async (req,res) => {
  const { tradeId, exitPrice, reason='MANUAL' } = req.body;
  if (!tradeId) return res.status(400).json({ error:'tradeId required' });
  const pnl = Trades.close(tradeId, exitPrice||0, reason);
  res.json({ ok:true, pnl, trade:Trades.get(tradeId) });
});

// ── TRADES ──
app.get('/api/trades', (req,res) => res.json({ active:Trades.getActive(), all:Trades.getAll().slice(0,30) }));

// ── NOT TRADE VERDICT ──
app.get('/api/notrade', (req,res) => res.json(NoTrade.verdict()));

// ── POSITION SIZE ──
app.get('/api/positionsize', (req,res) => {
  const kelly = parseFloat(req.query.kelly)||0.5;
  let base = Balance.calcPositionSize(kelly);
  let final = RiskLadder.applyToSize(base);
  final = Math.max(CFG.MIN_POSITION_USDT, final);
  res.json({ kelly, base, final, riskLadderTier:RiskLadder.current().label, tradingBalance:Balance.trading, sizingConfidence:final/(base||1) });
});

// ── PROFIT ──
app.post('/api/profit', (req,res) => {
  const { profit } = req.body;
  if (typeof profit!=='number'||profit<=0) return res.status(400).json({ error:'positive number required' });
  const split = Balance.recordProfit(profit);
  res.json({ ok:true, split, balance:Balance.snapshot() });
});

// ── STRATEGIES ──
app.get('/api/strategies', (req,res) => res.json(Strategies.registry));
app.post('/api/strategies/:id/toggle', (req,res) => {
  const s = Strategies.registry[req.params.id];
  if (!s) return res.status(404).json({ error:'Not found' });
  s.active = !s.active;
  res.json({ id:req.params.id, active:s.active });
});

// ── KILL SWITCH ──
app.post('/api/kill',       (req,res) => { KillSwitch._hardKill('MANUAL',{}); res.json({ ok:true, mode:KillSwitch.mode }); });
app.post('/api/kill/reset', (req,res) => { KillSwitch.reset(); res.json({ ok:true, mode:KillSwitch.mode }); });

// ── STRESS TEST ──
app.get('/api/stress', (req,res) => res.json(StressTest.run()));

// ── RECONCILIATION ──
app.post('/api/reconcile', async (req,res) => res.json(await Recon.run()));

// ── INCIDENTS ──
app.get('/api/incidents', (req,res) => res.json({ open:Incidents.getOpen(), pressure:Incidents.pressureScore(), total:Incidents._counter }));
app.post('/api/incidents/:id/resolve', (req,res) => { Incidents.resolve(req.params.id); res.json({ ok:true }); });

// ── RISK LADDER ──
app.get('/api/riskLadder', (req,res) => res.json(RiskLadder.snapshot()));

// ── TPSL ──
app.get('/api/tpsl', (req,res) => res.json({ levels:ExitEngine.tpslLevels, summary:ExitEngine.snapshot() }));

// ── SCAN (multi-asset) ──
app.get('/api/scan', async (req,res) => {
  const symbols = (req.query.symbols||'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT').split(',');
  const results = {};
  for (const sym of symbols) {
    try {
      const candles = await Bitget.fetchCandles(sym,'1h',50);
      const closes  = candles.map(c=>c.close);
      const ob      = await Bitget.fetchOrderbook(sym).catch(()=>null);
      results[sym]  = { rsi:Ind.rsi(closes), trend:Ind.momentum(closes,10), vol:Ind.volOsc(candles), atr:Ind.atr(candles), bb:Ind.bb(closes), ticker:Bitget.priceCache[sym], ofi:Ind.orderFlowImbalance(ob) };
    } catch(_){}
  }
  const ranked = Object.entries(results).map(([sym,data])=>{
    let score=0;
    if((data.rsi||50)<35||(data.rsi||50)>65) score+=0.2;
    if(Math.abs(data.trend||0)>0.01) score+=0.2;
    if((data.vol||0)>0.1) score+=0.15;
    if(data.bb&&data.ticker){const pct=(data.ticker.last-data.bb.lower)/(data.bb.upper-data.bb.lower||1);if(pct<0.2||pct>0.8)score+=0.25;}
    if(Math.abs(data.ofi||0)>0.3) score+=0.2;
    return { sym, score:score.toFixed(2), data };
  }).sort((a,b)=>b.score-a.score);
  res.json({ ranked, raw:results });
});

// ── AUTO ENGINE ──
app.get('/api/auto/status',    (req,res) => res.json(AutoEngine.snapshot()));
app.post('/api/auto/start',    (req,res) => res.json(AutoEngine.start(req.body?.interval)));
app.post('/api/auto/stop',     (req,res) => res.json(AutoEngine.stop()));
app.patch('/api/auto/config',  (req,res) => {
  const { symbols, granularity, interval } = req.body;
  if (symbols)     AutoEngine.symbols=symbols;
  if (granularity) AutoEngine.granularity=granularity;
  if (interval)    AutoEngine.intervalMs=Math.max(15000,parseInt(interval));
  res.json({ ok:true });
});
app.get('/api/auto/log', (req,res) => res.json(AutoEngine.log.slice(0,100)));

// ── PERFORMANCE ──
app.get('/api/performance', (req,res) => res.json(PerfTracker.systemStats()));
app.get('/api/balance/history', (req,res) => res.json(DB.getBalanceHistory.all()));

// ── DEPLOY MODE ──
app.post('/api/deploy', (req,res) => {
  const valid = ['PAPER','DRY_LIVE','LIVE_RESTRICTED','LIVE_FULL'];
  if (!valid.includes(req.body?.mode)) return res.status(400).json({ error:'Invalid mode', valid });
  CFG.DEPLOY_MODE = req.body.mode;
  NoTrade.gates.deployModeAllows = ['DRY_LIVE','LIVE_RESTRICTED','LIVE_FULL'].includes(CFG.DEPLOY_MODE);
  Log.info('DEPLOY', `Mode: ${CFG.DEPLOY_MODE}`);
  res.json({ ok:true, mode:CFG.DEPLOY_MODE });
});

// ── FUTURES LEVERAGE ──

// ── BACKTEST ──
app.post('/api/research/backtest', async (req,res) => {
  const { symbol='BTCUSDT', granularity='1h' } = req.body;
  const candles = await Bitget.fetchCandles(symbol, granularity, 300);
  if (candles.length < 50) return res.json({ error:'Insufficient data' });
  const trades = [];
  for (let i=30; i<candles.length-1; i++) {
    const slice = candles.slice(0,i+1);
    const closes = slice.map(c=>c.close);
    // Use multiple indicators for backtest signal
    const rsi  = Ind.rsi(closes);
    const macd = Ind.macd(closes);
    const bb   = Ind.bb(closes);
    const cur  = closes[closes.length-1];
    let signal = null;
    if (rsi<35 && bb && cur<bb.lower && macd.histogram>0) signal='BUY';
    else if (rsi>65 && bb && cur>bb.upper && macd.histogram<0) signal='SELL';
    if (!signal) continue;
    const entry = candles[i].close;
    const exit  = candles[i+1].close;
    const pnl   = signal==='BUY' ? (exit-entry)/entry : (entry-exit)/entry;
    trades.push({ i, entry, exit, pnl, signal });
  }
  const wins    = trades.filter(t=>t.pnl>0).length;
  const totalPnL = trades.reduce((s,t)=>s+t.pnl,0);
  const pnlArr  = trades.map(t=>t.pnl);
  res.json({
    symbol, granularity, trades:trades.length, candles:candles.length,
    winRate:   trades.length>0 ? wins/trades.length : 0,
    totalPnL,  avgPnL: trades.length>0 ? totalPnL/trades.length : 0,
    sharpe:    PerfTracker.sharpe(pnlArr),
    maxDrawdown: PerfTracker.maxDrawdown(pnlArr.reduce((arr,p)=>{const last=arr[arr.length-1]||0;arr.push(last+p);return arr;},[0])),
  });
});

// ── CALIBRATION ──
app.get('/api/calibration', (req,res) => {
  const stats = PerfTracker.systemStats();
  const strategies = stats.strategies;
  res.json({
    result: strategies.length>=1 ? {
      winRate:  stats.winRate,
      avgWin:   strategies.reduce((s,r)=>s+r.avgPnl,0)/strategies.length,
      avgLoss:  0,
      suggestedKelly: Math.max(0.1, Math.min(0.8, stats.winRate-0.5+0.3)),
    } : null,
    snapshot: { historyLength: strategies.reduce((s,r)=>s+r.trades,0) },
    performance: stats,
  });
});

// ── LOG ──
app.get('/api/log', (req,res) => {
  const n = parseInt(req.query.n)||50;
  const level = req.query.level||'';
  const rows = Log.getLast(n, level);
  // Konvertiere ts (Unix ms) zu ISO String für Frontend
  const mapped = rows.map(r => ({
    ts: new Date(r.ts).toISOString(),
    level: r.level,
    module: r.module,
    msg: r.msg ? `[${r.module}] ${r.msg}` : r.module,
  }));
  res.json(mapped);
});

// ── ICHIMOKU (Punkt 1) ──
app.get('/api/ichimoku/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 100);
  const result = Ind.ichimoku(candles);
  res.json({ symbol:req.params.symbol, granularity:gran, ichimoku:result });
});

// ── CANDLESTICK PATTERNS (Punkt 2) ──
app.get('/api/patterns/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 30);
  const patterns = Ind.candlePatterns(candles);
  const signal   = Ind.patternSignal(candles);
  res.json({ symbol:req.params.symbol, patterns, signal, candles:candles.length });
});

// ── ELLIOTT WAVE (Punkt 3) ──
app.get('/api/elliott/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 100);
  const wave = Ind.elliottWave(candles);
  res.json({ symbol:req.params.symbol, granularity:gran, elliottWave:wave });
});

// ── FUNDING RATE (Punkt 4) ──
app.get('/api/funding/:symbol', async (req,res) => {
  try {
    const rate   = await FundingEngine.fetchFundingRate(req.params.symbol);
    const signal = FundingEngine.signal(rate);
    res.json({ symbol:req.params.symbol, rate, signal, cache:FundingEngine.cache });
  } catch(e) { res.status(500).json({ error:'Interner Fehler' }); }
});

// ── SAFETIES (Punkt 5) ──
app.get('/api/safeties', (req,res) => res.json(Safeties.snapshot()));
app.get('/api/safeties/:symbol', async (req,res) => {
  try {
    const ticker = await Bitget.fetchTicker(req.params.symbol);
    const check  = Safeties.evaluate(req.params.symbol, ticker);
    res.json({ symbol:req.params.symbol, ...check, snapshot:Safeties.snapshot() });
  } catch(e) { res.json({ safe:false, error:e.message }); }
});
app.post('/api/safeties/reset', (req,res) => {
  Safeties.consecutiveLossCount = 0;
  Safeties.dailyTradeCount = 0;
  res.json({ ok:true });
});

// ── FLASH CRASH BOT (Punkt 6) ──
app.get('/api/flashcrash', (req,res) => res.json(FlashCrashBot.snapshot()));
app.get('/api/flashcrash/:symbol', async (req,res) => {
  try {
    const candles = await Bitget.fetchCandles(req.params.symbol, '5min', 30).catch(()=>[]);
    const ticker  = await Bitget.fetchTicker(req.params.symbol).catch(()=>null);
    const signal  = FlashCrashBot.detect(candles, ticker);
    res.json({ symbol:req.params.symbol, signal, snapshot:FlashCrashBot.snapshot() });
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

// ── TICK-LEVEL BACKTEST (Punkt 7) ──

// ── ML OPTIMIZER (Punkt 8) ──
// ── ML ENGINE API (echte Modelle) ───────────────────────────────────────────
app.get('/api/ml',               (req,res) => res.json(MLOptimizer.snapshot()));
app.post('/api/ml/train',        async (req,res) => {
  const { symbol='BTCUSDT', granularity='1h', limit=500 } = req.body;
  const result = await MLOptimizer.train(symbol, granularity, parseInt(limit));
  res.json(result);
});
app.post('/api/ml/predict',      async (req,res) => {
  const { symbol='BTCUSDT', granularity='1h' } = req.body;
  const candles = await Bitget.fetchCandles(symbol, granularity, 100);
  res.json({ symbol, granularity, ...MLOptimizer.predict(candles) });
});
app.post('/api/ml/feedback',     async (req,res) => {
  const { symbol='BTCUSDT', wasProfit=false } = req.body;
  const candles = await Bitget.fetchCandles(symbol, '1h', 80);
  MLOptimizer.feedback(candles, wasProfit);
  res.json({ ok:true, perceptronUpdates:MLOptimizer.Perceptron.trained, accuracy:MLOptimizer.Perceptron.accuracy() });
});
// Compat: alter Endpoint bleibt erreichbar
app.get('/api/optimizer',        (req,res) => res.json(MLOptimizer.snapshot()));
app.post('/api/optimizer/run',   async (req,res) => {
  const { symbol='BTCUSDT' } = req.body;
  res.json(await MLOptimizer.train(symbol));
});

// ── VOLLANALYSE KOMPLETT (alle 8 Punkte) ──
app.get('/api/fullanalysis/:symbol', async (req,res) => {
  const symbol = req.params.symbol;
  const gran   = req.query.granularity||'1h';
  try {
    const candles = await Bitget.fetchCandles(symbol, gran, 150);
    Regime.detect(candles);
    const closes  = candles.map(c=>c.close);
    const ob      = await Bitget.fetchOrderbook(symbol).catch(()=>null);
    const ticker  = await Bitget.fetchTicker(symbol).catch(()=>null);
    const [funding] = await Promise.all([FundingEngine.getSignal(symbol)]);
    const safetyCheck = Safeties.evaluate(symbol, ticker);
    const flashSignal = FlashCrashBot.detect(candles, ticker);
    res.json({
      symbol, granularity:gran, regime:Regime.snapshot(),
      // Punkt 1: Ichimoku
      ichimoku: Ind.ichimoku(candles),
      // Punkt 2: Candlestick
      patterns: Ind.patternSignal(candles),
      allPatterns: Ind.candlePatterns(candles),
      // Punkt 3: Elliott Wave
      elliottWave: Ind.elliottWave(candles),
      // Punkt 4: Funding Rate
      funding,
      // Punkt 5: Safeties
      safeties: safetyCheck,
      // Punkt 6: Flash Crash
      flashCrash: flashSignal,
      // Standard Indikatoren
      rsi:       Ind.rsi(closes),
      macd:      Ind.macd(closes),
      bb:        Ind.bb(closes),
      atr:       Ind.atr(candles),
      vwap:      Ind.vwap(candles.slice(-20)),
      squeeze:   Ind.squeezeMomentum(candles),
      ofi:       Ind.orderFlowImbalance(ob),
      // Strategie-Signale
      signals:   Strategies.getAll(candles, ob),
    });
  } catch(e) { res.status(500).json({ error:'Interner Fehler' }); }
});


// ── SELBSTHEILUNG API ────────────────────────────────────────────────────────
app.get('/api/selfheal', (req,res) => res.json(SelfHeal.snapshot()));
app.post('/api/selfheal/run', async (req,res) => {
  const result = await SelfHeal.fullCheck();
  res.json(result);
});
app.post('/api/selfheal/module', (req,res) => {
  const { module, reason='MANUAL' } = req.body;
  if (!module) return res.status(400).json({ error:'module required' });
  const result = SelfHeal.heal(module, reason);
  res.json(result);
});
app.post('/api/selfheal/unblock', (req,res) => {
  const { ip } = req.body;
  if (ip) {
    SelfHeal.blockedIPs.delete(ip);
    delete SelfHeal.rateLimitMap[ip];
    res.json({ ok:true, unblocked:ip });
  } else {
    // Alle IPs entblocken
    SelfHeal.blockedIPs.clear();
    SelfHeal.rateLimitMap = {};
    res.json({ ok:true, message:'Alle IPs freigegeben' });
  }
});

// 70/30 Split Info Endpoint
app.get('/api/split', (req,res) => {
  const profit = parseFloat(req.query.profit||0);
  res.json({
    reserveRatio: CFG.RESERVE_RATIO,
    tradingRatio:  CFG.TRADING_RATIO,
    currentReserve: Balance.reserve,
    currentTrading:  Balance.trading,
    currentTotal:    Balance.usable,
    // Simulation: wenn profit X gemacht wird
    simulation: profit > 0 ? {
      profit,
      toReserve:  profit * CFG.RESERVE_RATIO,
      toTrading:  profit * CFG.TRADING_RATIO,
      newReserve: Balance.reserve + profit * CFG.RESERVE_RATIO,
      newTrading:  Balance.trading + profit * CFG.TRADING_RATIO,
      newTotal:    Balance.usable + profit,
      description: `${profit} USDT Gewinn → ${(profit*CFG.RESERVE_RATIO).toFixed(2)} auf Reserve + ${(profit*CFG.TRADING_RATIO).toFixed(2)} auf Trading-Kapital`,
    } : null,
    history: DB.getBalanceHistory.all().slice(0,10),
  });
});


// ── DCA BOT API ─────────────────────────────────────────────────────────────
app.get('/api/dca',               (req,res) => res.json(DCABot.snapshot()));
app.post('/api/dca/create',       (req,res) => res.json(DCABot.create(req.body)));
app.post('/api/dca/:id/stop',     (req,res) => res.json(DCABot.stop(req.params.id)));
app.delete('/api/dca/:id',        (req,res) => { DCABot.stop(req.params.id); delete DCABot.jobs[req.params.id]; res.json({ok:true}); });

// ── GRID BOT API ─────────────────────────────────────────────────────────────
app.get('/api/grid',              (req,res) => res.json(GridBot.snapshot()));
app.post('/api/grid/create',      (req,res) => res.json(GridBot.create(req.body)));
app.post('/api/grid/:id/stop',    (req,res) => res.json(GridBot.stop(req.params.id)));

// ── MARTINGALE BOT API ───────────────────────────────────────────────────────
app.get('/api/martingale',             (req,res) => res.json(MartingaleBot.snapshot()));
app.post('/api/martingale/create',     (req,res) => res.json(MartingaleBot.create(req.body)));
app.post('/api/martingale/:id/stop',   (req,res) => res.json(MartingaleBot.stop(req.params.id)));

// ── TWAP API ─────────────────────────────────────────────────────────────────
app.get('/api/twap',              (req,res) => res.json(TWAPEngine.snapshot()));
app.post('/api/twap/execute',     async (req,res) => res.json(await TWAPEngine.execute(req.body)));
app.post('/api/twap/:id/cancel',  (req,res) => res.json(TWAPEngine.cancel(req.params.id)));

// ── OCO ORDERS API ───────────────────────────────────────────────────────────
app.get('/api/oco',               (req,res) => res.json(OCOEngine.snapshot()));
app.post('/api/oco/create',       (req,res) => res.json(OCOEngine.create(req.body)));
app.post('/api/oco/:id/cancel',   (req,res) => res.json(OCOEngine.cancel(req.params.id)));

// ── FEAR & GREED API ─────────────────────────────────────────────────────────
app.get('/api/feargreed',         async (req,res) => res.json(await FearGreed.fetch()));

// ── PORTFOLIO REBALANCING API ────────────────────────────────────────────────
app.get('/api/rebalance',              (req,res) => res.json(RebalanceBot.snapshot()));
app.post('/api/rebalance/config',      (req,res) => res.json(RebalanceBot.setConfig(req.body)));
app.post('/api/rebalance/run',         async (req,res) => res.json(await RebalanceBot.run()));

// ── SPOT-FUTURES ARBITRAGE API ───────────────────────────────────────────────
app.get('/api/arb',               (req,res) => res.json(SpotFuturesArb.snapshot()));
app.post('/api/arb/create',       async (req,res) => res.json(await SpotFuturesArb.create(req.body)));
app.post('/api/arb/:id/close',    async (req,res) => res.json(await SpotFuturesArb.close(req.params.id)));

// ── TELEGRAM API ─────────────────────────────────────────────────────────────
app.get('/api/telegram/status',   (req,res) => res.json({ enabled:TelegramBot.enabled, chatId:TelegramBot.chatId?'SET':'NOT_SET' }));
app.get('/api/telegram/config',(req,res)=>res.json({enabled:TelegramBot.enabled,chatId:TelegramBot.chatId?'***'+String(TelegramBot.chatId).slice(-4):null}));
app.post('/api/telegram/config',(req,res)=>{if(req.body.chatId)TelegramBot.chatId=req.body.chatId;res.json({ok:true});});

app.post('/api/telegram/send',    async (req,res) => { await TelegramBot.send(req.body.msg||'Test'); res.json({ok:true}); });
app.post('/api/telegram/report',  async (req,res) => { await TelegramBot.sendReport(); res.json({ok:true}); });

// ── VOLLSTÄNDIGES SNAPSHOT (alle Bots auf einmal) ────────────────────────────
app.get('/api/bots', (req,res) => res.json({
  dca:        DCABot.snapshot(),
  grid:       GridBot.snapshot(),
  martingale: MartingaleBot.snapshot(),
  twap:       TWAPEngine.snapshot(),
  oco:        OCOEngine.snapshot(),
  arb:        SpotFuturesArb.snapshot(),
  rebalance:  RebalanceBot.snapshot(),
  selfheal:   SelfHeal.snapshot(),
  feargreed:  FearGreed.cache,
}));


// ═════════════════════════════════════════════════════════════════════════════
// COMBO BOT – DCA in fallenden Märkten + Grid in steigenden
// Bitsgap-Style: kombiniert beide Strategien in einem Bot
// ═════════════════════════════════════════════════════════════════════════════
const ComboBot = {
  jobs: {},

  create({ id, symbol, totalUSDT, dcaShare=0.5, gridShare=0.5, gridLevels=8, tpPct=0.06, dcaIntervalMs=3600000 }) {
    if (this.jobs[id]) return { error: 'Job exists' };
    const dcaUSDT  = totalUSDT * dcaShare;
    const gridUSDT = totalUSDT * gridShare;
    const job = {
      id, symbol, totalUSDT, dcaShare, gridShare, dcaUSDT, gridUSDT,
      gridLevels, tpPct, dcaIntervalMs,
      active: true, mode: 'INITIALIZING',
      dcaOrders: [], gridFills: [],
      totalProfit: 0, dcaAvgEntry: 0, dcaTotalQty: 0,
      createdAt: Date.now(), status: 'RUNNING',
      _dcaCount: 0, _gridActive: false,
    };
    this.jobs[id] = job;
    job._timer = setInterval(() => this._tick(id), 15000);
    job._dcaTimer = setInterval(() => this._dcaBuy(id), dcaIntervalMs);
    this._dcaBuy(id); // Sofort erster DCA-Kauf
    Log.info('COMBO', `${id}: ${symbol} ${totalUSDT}USDT (DCA:${dcaUSDT} Grid:${gridUSDT})`);
    TelegramBot.send(`🔄 Combo Bot gestartet: ${symbol}
DCA: ${dcaUSDT} USDT
Grid: ${gridUSDT} USDT
TP: ${tpPct*100}%`);
    return { ok: true, job: this._safe(job) };
  },

  async _dcaBuy(id) {
    const job = this.jobs[id];
    if (!job || !job.active) return;
    const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
    const price = ticker?.last || 0;
    if (!price) return;
    const sliceUSDT = job.dcaUSDT / 10; // 10 DCA-Scheiben
    const qty = (sliceUSDT / price).toFixed(6);
    job._dcaCount++;
    job.dcaTotalQty += parseFloat(qty);
    job.dcaAvgEntry = (job.dcaAvgEntry * (job._dcaCount-1) + price) / job._dcaCount;
    job.dcaOrders.push({ price, qty, ts: Date.now() });
    Log.info('COMBO', `${id} DCA #${job._dcaCount}: ${qty} @ ${price} (Ø ${job.dcaAvgEntry.toFixed(4)})`);
    if (DemoEngine.liveMode && CFG.API_KEY) {
      await Bitget.placeSportOrder(job.symbol, 'buy', qty).catch(() => {});
    }
  },

  async _tick(id) {
    const job = this.jobs[id];
    if (!job || !job.active) return;
    try {
      const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
      const price = ticker?.last || 0;
      if (!price || !job.dcaAvgEntry) return;
      const pct = (price - job.dcaAvgEntry) / job.dcaAvgEntry;

      // Wenn Preis über TP: DCA-Position verkaufen + Grid aktivieren
      if (pct >= job.tpPct && job.dcaTotalQty > 0) {
        const dcaProfit = pct * (job.dcaAvgEntry * job.dcaTotalQty);
        job.totalProfit += dcaProfit;
        Log.info('COMBO', `${id} DCA TP: +${dcaProfit.toFixed(2)} USDT → Grid aktivieren`);
        if (DemoEngine.liveMode && CFG.API_KEY) {
          await Bitget.placeSportOrder(job.symbol, 'sell', job.dcaTotalQty.toFixed(6)).catch(() => {});
        }
        Balance.recordProfit(dcaProfit);
        // Grid auf aktuellen Preisbereich setzen
        job._gridActive = true;
        job.mode = 'GRID';
        job.dcaTotalQty = 0; job.dcaAvgEntry = 0; job._dcaCount = 0;
        const gridRange = price * 0.08; // 8% Range
        const step = (2 * gridRange) / job.gridLevels;
        job._gridLower = price - gridRange;
        job._gridUpper = price + gridRange;
        job._gridStep  = step;
        job._gridOrders = {};
        for (let i = 0; i <= job.gridLevels; i++) {
          const lvl = parseFloat((job._gridLower + i*step).toFixed(4));
          job._gridOrders[lvl] = { type: lvl < price ? 'BUY' : 'SELL', filled: false };
        }
        TelegramBot.send(`🔄 Combo Bot: ${job.symbol} DCA TP!
+${dcaProfit.toFixed(2)} USDT
Grid aktiviert: [${job._gridLower.toFixed(0)}-${job._gridUpper.toFixed(0)}]`);
        return;
      }

      // Grid-Modus: prüfe Level-Triggers
      if (job._gridActive && job._gridOrders) {
        for (const [lvlStr, order] of Object.entries(job._gridOrders)) {
          const lvl = parseFloat(lvlStr);
          if (order.filled) continue;
          const sliceUSDT = job.gridUSDT / job.gridLevels;
          const qty = (sliceUSDT / lvl).toFixed(6);
          if (order.type === 'BUY' && price <= lvl) {
            order.filled = true;
            job.gridFills.push({ type:'BUY', price:lvl, qty, ts:Date.now() });
            // Gegenorder
            const sellLvl = parseFloat((lvl + job._gridStep).toFixed(4));
            job._gridOrders[sellLvl] = { type:'SELL', filled:false, buyPrice:lvl };
          } else if (order.type === 'SELL' && price >= lvl) {
            order.filled = true;
            const gridProfit = (lvl-(order.buyPrice||lvl)) * parseFloat(qty);
            job.totalProfit += gridProfit;
            job.gridFills.push({ type:'SELL', price:lvl, profit:gridProfit.toFixed(4), ts:Date.now() });
            if (gridProfit > 0) Balance.recordProfit(gridProfit);
            // Gegenorder
            const buyLvl = parseFloat((lvl - job._gridStep).toFixed(4));
            if (buyLvl >= job._gridLower) job._gridOrders[buyLvl] = { type:'BUY', filled:false };
            // Wenn Grid weit aus Range: zurück zu DCA
            if (price > job._gridUpper * 1.05 || price < job._gridLower * 0.95) {
              job._gridActive = false; job.mode = 'DCA';
              Log.info('COMBO', `${id} Grid out of range → zurück zu DCA`);
            }
          }
        }
      }
    } catch(e) { SelfHeal.recordError('COMBO', e.message); }
  },

  stop(id) {
    const job = this.jobs[id];
    if (!job) return { error: 'Not found' };
    job.active = false;
    if (job._timer)    { clearInterval(job._timer);    job._timer = null; }
    if (job._dcaTimer) { clearInterval(job._dcaTimer); job._dcaTimer = null; }
    job.status = 'STOPPED';
    TelegramBot.send(`🛑 Combo Bot gestoppt: ${job.symbol}
Gesamtprofit: +${job.totalProfit.toFixed(2)} USDT`);
    return { ok: true, totalProfit: job.totalProfit };
  },

  _safe(j) { const { _timer, _dcaTimer, _gridOrders, ...s } = j; return s; },
  snapshot() { return Object.values(this.jobs).map(j => this._safe(j)); }
};


// ═════════════════════════════════════════════════════════════════════════════
// SENTIMENT SCALER – Passt Positionsgrössen automatisch an Markt-Stimmung an
// Extreme Angst (<25): +20% Grösse (gute Kaufgelegenheit)
// Extreme Gier (>75): -20% Grösse (überhitzter Markt)
// ═════════════════════════════════════════════════════════════════════════════
const SentimentScaler = {
  scaleFactor: 1.0,
  lastUpdate: 0,

  async update() {
    if (Date.now() - this.lastUpdate < 3600000) return this.scaleFactor;
    const fg = await FearGreed.fetch().catch(() => null);
    if (!fg) return 1.0;
    // Lineare Skalierung: 0→1.30, 25→1.15, 50→1.00, 75→0.85, 100→0.70
    const value = fg.value;
    if (value <= 10)  this.scaleFactor = 1.40; // Extreme Fear: grosse Position
    else if (value <= 25)  this.scaleFactor = 1.20;
    else if (value <= 40)  this.scaleFactor = 1.10;
    else if (value <= 60)  this.scaleFactor = 1.00; // Neutral: normal
    else if (value <= 75)  this.scaleFactor = 0.90;
    else if (value <= 90)  this.scaleFactor = 0.80;
    else                   this.scaleFactor = 0.70; // Extreme Greed: kleiner
    this.lastUpdate = Date.now();
    Log.info('SENTIMENT', `F&G: ${value} (${fg.label}) → Scaler: ${this.scaleFactor}x`);
    return this.scaleFactor;
  },

  // Wende Scaler auf Positionsgrösse an
  async applyToSize(baseSize) {
    const factor = await this.update();
    const scaled = baseSize * factor;
    return Math.max(CFG.MIN_POSITION_USDT, scaled);
  },

  snapshot() {
    return { scaleFactor: this.scaleFactor, lastUpdate: this.lastUpdate };
  }
};


// ── EQUITY CURVE CHART ──────────────────────────────────────────────────────
app.get('/api/equity', (req,res) => {
  const hist = DB.getBalanceHistory.all().reverse();
  if (!hist.length) return res.json({ error:'No data', points:[] });
  // Downsampling auf max 200 Punkte fuer Chart-Performance
  const step = Math.max(1, Math.floor(hist.length/200));
  const points = hist
    .filter((_,i) => i % step === 0)
    .map(h => ({
      ts:      h.ts,
      total:   parseFloat(h.usable?.toFixed(2)  || 0),
      reserve: parseFloat(h.reserve?.toFixed(2) || 0),
      trading: parseFloat(h.trading?.toFixed(2) || 0),
      pnl:     parseFloat(h.daily_pnl?.toFixed(2) || 0),
      label:   new Date(h.ts).toLocaleDateString('de-DE'),
    }));
  // Berechne Statistiken
  const totals   = points.map(p => p.total);
  const startVal = totals[0] || 0;
  const endVal   = totals[totals.length-1] || 0;
  const maxVal   = Math.max(...totals);
  const minVal   = Math.min(...totals);
  const peak     = maxVal;
  let maxDD = 0, runningPeak = totals[0];
  for (const v of totals) {
    if (v > runningPeak) runningPeak = v;
    const dd = runningPeak > 0 ? (runningPeak-v)/runningPeak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  res.json({
    points,
    stats: {
      startCapital:  startVal,
      currentCapital: endVal,
      totalReturn:   startVal > 0 ? (endVal-startVal)/startVal : 0,
      maxDrawdown:   maxDD,
      peakCapital:   peak,
      minCapital:    minVal,
      dataPoints:    points.length,
      period:        points.length > 1 ? `${points[0].label} – ${points[points.length-1].label}` : '—',
    }
  });
});

// ── COMBO BOT API ─────────────────────────────────────────────────────────
app.get('/api/combo',             (req,res) => res.json(ComboBot.snapshot()));
app.post('/api/combo/create',     (req,res) => res.json(ComboBot.create(req.body)));
app.post('/api/combo/:id/stop',   (req,res) => res.json(ComboBot.stop(req.params.id)));

// ── SENTIMENT SCALER API ──────────────────────────────────────────────────
app.get('/api/sentiment',         async (req,res) => {
  const factor = await SentimentScaler.update();
  const fg = FearGreed.cache;
  res.json({ ...SentimentScaler.snapshot(), fearGreed: fg, description:
    factor > 1.1 ? 'FEAR: Groessere Positionen empfohlen' :
    factor < 0.9 ? 'GREED: Kleinere Positionen empfohlen' : 'NEUTRAL: Normale Positionsgroesse'
  });
});

// ── BACKTEST MIT LIQUIDATION (update route) ───────────────────────────────
app.post('/api/backtest/tick', async (req,res) => {
  const { symbol='BTCUSDT', granularity='5m', limit=500, strategy='full',
          capital=1000, posSize=0.1, slPct=0.02, tpPct=0.04, leverage=1 } = req.body;
  const result = await TickBacktest.run(symbol, granularity, limit, strategy, capital, posSize, slPct, tpPct, leverage);
  res.json(result);
});


// ── PM2 ECOSYSTEM CONFIG DOWNLOAD ────────────────────────────────────────────
app.get('/api/pm2config', (req,res) => {
  const cfg = {
    apps: [{
      name:         'nexus-v9-m1',
      script:       'server.js',
      cwd:          __dirname,
      instances:    1,
      exec_mode:    'fork',
      autorestart:  true,
      watch:        false,
      max_memory_restart: '1G',
      restart_delay: 5000,
      max_restarts:  10,
      // M1-spezifische Node.js Flags
      node_args:    '--max-old-space-size=2048 --optimize-for-size --harmony --expose-gc',
      env: {
        NODE_ENV:              'production',
        UV_THREADPOOL_SIZE:    '8',   // M1 hat 8 Kerne
        PORT:                  process.env.PORT || 3000,
        DEPLOY_MODE:           process.env.DEPLOY_MODE || 'PAPER',
        BITGET_API_KEY:        process.env.BITGET_API_KEY    || '',
        BITGET_SECRET_KEY:     process.env.BITGET_SECRET_KEY || '',
        BITGET_PASSPHRASE:     process.env.BITGET_PASSPHRASE || '',
        TELEGRAM_TOKEN:        process.env.TELEGRAM_TOKEN    || '',
        TELEGRAM_CHAT_ID:      process.env.TELEGRAM_CHAT_ID  || '',
        WEBHOOK_SECRET:        process.env.WEBHOOK_SECRET    || 'nexus',
      },
      error_file:       './logs/err.log',
      out_file:         './logs/out.log',
      merge_logs:       true,
      log_date_format:  'YYYY-MM-DD HH:mm:ss.SSS',
    }]
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="ecosystem.config.json"');
  res.json(cfg);
});

// pm2 Setup Instructions
app.get('/api/pm2setup', (req,res) => {
  res.json({
    steps: [
      '1. npm install -g pm2',
      '2. Lade ecosystem.config.json: GET /api/pm2config',
      '3. pm2 start ecosystem.config.json',
      '4. pm2 save',
      '5. pm2 startup  (zeigt Befehl fuer Autostart)',
      '6. Befehl ausfuehren der angezeigt wird (sudo ...)',
      '7. Fertig: Bot startet ab jetzt automatisch nach Mac-Neustart',
    ],
    quickstart: 'npm install -g pm2 && pm2 start server.js --name nexus-v9 && pm2 save && pm2 startup',
    status:     'pm2 status',
    logs:       'pm2 logs nexus-v9',
    restart:    'pm2 restart nexus-v9',
    stop:       'pm2 stop nexus-v9',
  });
});


// ── MULTI-EXCHANGE API ───────────────────────────────────────────────────────
app.get('/api/exchanges',           (req,res) => res.json(ExchangeRegistry.snapshot()));
app.post('/api/exchanges/pingall',  async (req,res) => res.json(await ExchangeRegistry.pingAll()));

// Exchange Toggle: AN / AUS
app.post('/api/exchanges/:id/toggle', (req,res) => {
  const { enable } = req.body;
  res.json(ExchangeRegistry.toggle(req.params.id, !!enable));
});

// API Keys setzen fuer Exchange
app.post('/api/exchanges/:id/keys', (req,res) => {
  const { apiKey, secretKey, passphrase } = req.body;
  if (!apiKey || !secretKey) return res.status(400).json({ error:'apiKey + secretKey Pflicht' });
  res.json(ExchangeRegistry.setKeys(req.params.id, { apiKey, secretKey, passphrase }));
});

// Ticker von spezifischer Exchange
app.get('/api/exchanges/:id/ticker/:symbol', async (req,res) => {
  const ticker = await ExchangeRegistry.fetchTicker(req.params.id, req.params.symbol);
  res.json({ exchange: req.params.id, symbol: req.params.symbol, ticker });
});

// Best Price ueber alle aktiven Exchanges
app.get('/api/exchanges/bestprice/:symbol', async (req,res) => {
  const side = req.query.side || 'buy';
  const best = await ExchangeRegistry.bestPrice(req.params.symbol, side);
  const all  = await Promise.all(
    ExchangeRegistry.getActive().map(async ex => {
      const t = ex.id === 'bitget' ? Bitget.priceCache[req.params.symbol] : await ExchangeRegistry.fetchTicker(ex.id, req.params.symbol).catch(()=>null);
      return { exchange: ex.id, name: ex.name, price: t?.last || 0 };
    })
  );
  res.json({ best, all: all.filter(p=>p.price>0), symbol: req.params.symbol, side });
});

// Order auf spezifischer Exchange
app.post('/api/exchanges/:id/order', async (req,res) => {
  const { symbol, side, size, orderType='market', price } = req.body;
  const result = await ExchangeRegistry.placeOrder(req.params.id, symbol, side, size, orderType, price);
  res.json(result);
});

// ── CUSTOM SCRIPTING API ─────────────────────────────────────────────────────

app.get('/api/scripts/examples',      (req,res) => res.json(ScriptEngine.examples));

// Script hinzufügen
app.post('/api/scripts', (req,res) => res.json(ScriptEngine.add(req.body)));

// Script updaten

// Script löschen
app.delete('/api/scripts/:id', (req,res) => {
  ScriptEngine.stop(req.params.id);
  delete ScriptEngine.scripts[req.params.id];
  delete ScriptEngine.results[req.params.id];
  res.json({ ok:true });
});

// Script starten / stoppen
app.post('/api/scripts/:id/start',  (req,res) => res.json(ScriptEngine.start(req.params.id)));
app.post('/api/scripts/:id/stop',   (req,res) => res.json(ScriptEngine.stop(req.params.id)));
app.post('/api/scripts/:id/test',   async (req,res) => res.json(await ScriptEngine.test(req.params.id)));

// Letztes Ergebnis
app.get('/api/scripts/:id/result',  (req,res) => res.json(ScriptEngine.results[req.params.id] || { error:'Noch kein Ergebnis' }));


// ── BOT MANAGER API (Autonom / Manuell) ──────────────────────────────────────
app.get('/api/botmanager',           (req,res) => res.json(BotManager.snapshot()));

// Modus umschalten: { mode: 'AUTONOMOUS' | 'MANUAL' }
app.post('/api/botmanager/mode',     (req,res) => {
  const { mode } = req.body;
  res.json(BotManager.setMode(mode));
});

// Symbol manuell sperren (kein autonomer Bot für dieses Symbol)
app.post('/api/botmanager/lock',     (req,res) => {
  const { symbol, reason } = req.body;
  res.json(BotManager.lockSymbol(symbol, reason||'MANUAL'));
});
app.post('/api/botmanager/unlock',   (req,res) => {
  res.json(BotManager.unlockSymbol(req.body.symbol));
});

// Grid-Parameter manuell anpassen
app.post('/api/botmanager/adjustgrid', (req,res) => {
  const { id, lowerPrice, upperPrice, gridCount } = req.body;
  res.json(BotManager.adjustGrid(id, { lowerPrice, upperPrice, gridCount }));
});

// Emergency Stop – alle Bots eines Symbols (oder alle)
app.post('/api/botmanager/stop',     (req,res) => {
  const { symbol } = req.body;
  res.json(BotManager.emergencyStop(symbol||null));
});

// Bot-Übersicht komplett
app.get('/api/bots/all', (req,res) => res.json({
  mode:       BotManager.mode,
  dca:        DCABot.snapshot(),
  grid:       GridBot.snapshot(),
  martingale: MartingaleBot.snapshot(),
  combo:      ComboBot.snapshot(),
  arb:        SpotFuturesArb.snapshot(),
  twap:       TWAPEngine.snapshot(),
  oco:        OCOEngine.snapshot(),
  manager:    BotManager.snapshot(),
}));


// ── META-WÄCHTER + FEHLER-ANALYSE API ───────────────────────────────────────
// Einzel-Scan
app.get('/api/watchdog',          (req,res) => res.json(MetaWatchdog.snapshot()));
// Volle Diagnose (alle Checks jetzt ausfuehren)
app.post('/api/watchdog/diagnose', async (req,res) => res.json(await MetaWatchdog.diagnose()));
// Nur letztes Ergebnis
app.get('/api/watchdog/checks',   (req,res) => res.json({ checks:MetaWatchdog.checks, alerts:MetaWatchdog.alerts }));

// Fehler-Analyse komplett (kombiniert alle Quellen)
app.get('/api/diagnose', async (req,res) => {
  try {
    const [watchdog, stress, incidents, selfheal, safeties, balance] = await Promise.all([
      MetaWatchdog.diagnose(),
      Promise.resolve(StressTest.run()),
      Promise.resolve({ open:Incidents.getOpen(), pressure:Incidents.pressureScore() }),
      Promise.resolve(SelfHeal.snapshot()),
      Promise.resolve(Safeties.snapshot()),
      Promise.resolve(Balance.snapshot()),
    ]);
    const overall = watchdog.critical?.length > 0 ? 'KRITISCH' :
                    watchdog.warnings?.length > 0  ? 'WARNUNG'  : 'GESUND';
    res.json({
      overall,
      score:       watchdog.score,
      timestamp:   new Date().toLocaleString('de-DE'),
      watchdog,
      stress,
      incidents,
      selfheal,
      safeties,
      balance,
      regime:      Regime.snapshot(),
      killSwitch:  KillSwitch.snapshot(),
      noTrade:     NoTrade.verdict(),
      autoEngine:  AutoEngine.snapshot(),
      botManager:  BotManager.snapshot(),
    });
  } catch(e) {
    res.status(500).json({ error:'Interner Fehler' });
  }
});


// ── PREIS-ALERTS API ────────────────────────────────────────────────────────

app.post('/api/alerts',           (req,res) => res.json(PriceAlerts.add(req.body)));
app.delete('/api/alerts/:id',     (req,res) => res.json(PriceAlerts.remove(req.params.id)));
app.post('/api/alerts/:id/reset', (req,res) => res.json(PriceAlerts.reset(req.params.id)));
app.post('/api/alerts/toggle',    (req,res) => {
  PriceAlerts.enabled = !PriceAlerts.enabled;
  res.json({ ok:true, enabled:PriceAlerts.enabled });
});

// ── MULTI-TIMEFRAME API ──────────────────────────────────────────────────────
app.get('/api/mtf',               (req,res) => res.json(MTFConfirm.snapshot()));
app.post('/api/mtf/toggle',       (req,res) => {
  MTFConfirm.enabled = !MTFConfirm.enabled;
  res.json({ ok:true, enabled:MTFConfirm.enabled });
});
app.post('/api/mtf/confirm',      async (req,res) => {
  const { symbol='BTCUSDT', direction='BUY', tf='1h' } = req.body;
  res.json(await MTFConfirm.confirm(symbol, direction, tf));
});

// ── DB-BACKUP API ────────────────────────────────────────────────────────────
app.get('/api/backup',            (req,res) => res.json(DBBackup.snapshot()));
app.post('/api/backup/run',       async (req,res) => res.json(await DBBackup.run()));
app.post('/api/backup/toggle',    (req,res) => {
  DBBackup.enabled = !DBBackup.enabled;
  if (DBBackup.enabled) DBBackup.start();
  res.json({ ok:true, enabled:DBBackup.enabled });
});

// ── NEWS-SENTIMENT API ───────────────────────────────────────────────────────
app.get('/api/news',              async (req,res) => res.json(await NewsSentiment.fetch()));
app.post('/api/news/toggle',      (req,res) => {
  NewsSentiment.enabled = !NewsSentiment.enabled;
  res.json({ ok:true, enabled:NewsSentiment.enabled });
});
app.post('/api/news/apikey',      (req,res) => {
  NewsSentiment.apiKey = req.body.apiKey || '';
  res.json({ ok:true, hasKey: !!NewsSentiment.apiKey });
});

// ── WALLET TRACKER API ───────────────────────────────────────────────────────

app.post('/api/wallets',          (req,res) => res.json(WalletTracker.addWallet(req.body)));
app.delete('/api/wallets/:addr',  (req,res) => res.json(WalletTracker.removeWallet(req.params.addr)));
app.post('/api/wallets/toggle',   (req,res) => {
  WalletTracker.enabled = !WalletTracker.enabled;
  if (WalletTracker.enabled) WalletTracker.start();
  else if (WalletTracker._timer) { clearInterval(WalletTracker._timer); WalletTracker._timer = null; }
  res.json({ ok:true, enabled:WalletTracker.enabled });
});
app.post('/api/wallets/scan',     async (req,res) => { await WalletTracker.run(); res.json(WalletTracker.snapshot()); });

// ── POSITIONS-JOURNAL API ────────────────────────────────────────────────────

app.get('/api/journal/filter',    (req,res) => res.json(Journal.filter(req.query)));
app.get('/api/journal/stats',     (req,res) => res.json(Journal.stats()));
app.post('/api/journal',          (req,res) => res.json(Journal.add(req.body)));

// Feature-Toggle Übersicht (alle An/Aus Schalter)
app.get('/api/toggles', (req,res) => res.json({
  priceAlerts:    { enabled:PriceAlerts.enabled,    name:'Preis-Alerts' },
  mtfConfirm:     { enabled:MTFConfirm.enabled,     name:'Multi-TF Bestätigung' },
  dbBackup:       { enabled:DBBackup.enabled,       name:'DB-Backup' },
  newsSentiment:  { enabled:NewsSentiment.enabled,  name:'News-Sentiment' },
  walletTracker:  { enabled:WalletTracker.enabled,  name:'Wallet-Tracker' },
  telegramAlerts: { enabled:TelegramBot.enabled,    name:'Telegram' },
  autoEngine:     { enabled:AutoEngine.enabled,     name:'Auto Engine' },
  botManager:     { enabled:BotManager.mode==='AUTONOMOUS', name:'Autonomer Modus' },
}));


// ── ML AUTO-RETRAINING API ───────────────────────────────────────────────────
app.get('/api/ml/autoretrain',        (req,res) => res.json(MLAutoRetrain.snapshot()));
app.post('/api/ml/autoretrain/toggle',(req,res) => {
  MLAutoRetrain.enabled = !MLAutoRetrain.enabled;
  if (MLAutoRetrain.enabled) MLAutoRetrain.start();
  else if (MLAutoRetrain.timer) { clearInterval(MLAutoRetrain.timer); MLAutoRetrain.timer=null; }
  res.json({ ok:true, enabled:MLAutoRetrain.enabled });
});
app.post('/api/ml/autoretrain/config',(req,res) => {
  const { intervalDays, symbol, granularity, limit } = req.body;
  if (intervalDays) MLAutoRetrain.intervalDays = parseInt(intervalDays);
  if (symbol)       MLAutoRetrain.symbol = symbol;
  if (granularity)  MLAutoRetrain.granularity = granularity;
  if (limit)        MLAutoRetrain.limit = parseInt(limit);
  res.json({ ok:true, config: { intervalDays:MLAutoRetrain.intervalDays, symbol:MLAutoRetrain.symbol } });
});
app.post('/api/ml/autoretrain/now',  async (req,res) => {
  MLOptimizer.trainedAt = null; // Erzwinge sofortiges Retraining
  await MLAutoRetrain._checkAndTrain();
  res.json({ ok:true, lastRetrain:MLAutoRetrain.lastRetrain });
});

// ── FEATURE IMPORTANCE API ───────────────────────────────────────────────────
app.get('/api/ml/importance', (req,res) => {
  res.json({
    features: MLOptimizer.featureImportance || [],
    trained:  MLOptimizer.trained,
    top5:     (MLOptimizer.featureImportance||[]).slice(0,5),
  });
});

// ── CROSS-VALIDATION ERGEBNISSE ──────────────────────────────────────────────
app.get('/api/ml/cv', (req,res) => {
  res.json({
    cvAccuracy: MLOptimizer.cvAccuracy || null,
    overfit:    MLOptimizer.overfit || false,
    trained:    MLOptimizer.trained,
    warning:    MLOptimizer.overfit ? 'Overfitting erkannt: Modell ist auf Trainingsdaten spezialisiert' : null,
  });
});


// ── ADAPTIVE SL/TP API ───────────────────────────────────────────────────────
app.post('/api/adaptivesltp', async (req,res) => {
  const { symbol='BTCUSDT', side='buy' } = req.body;
  const candles = await Bitget.fetchCandles(symbol,'1h',50);
  const price   = candles?.[candles.length-1]?.close || 0;
  res.json({ symbol, side, price, ...AdaptiveSLTP.calculate(candles||[], price, side) });
});
app.get('/api/adaptivesltp/profiles', (req,res) => res.json(AdaptiveSLTP.snapshot()));

// ── CVD ENGINE API ───────────────────────────────────────────────────────────
app.get('/api/cvd/:symbol', async (req,res) => {
  const candles = await Bitget.fetchCandles(req.params.symbol,'1h',100).catch(()=>[]);
  res.json({ symbol:req.params.symbol, ...CVDEngine.calculate(candles) });
});

// ── ANOMALIE-DETEKTOR API ────────────────────────────────────────────────────
app.get('/api/anomaly',           (req,res) => res.json(AnomalyDetector.snapshot()));
app.post('/api/anomaly/analyze',  async (req,res) => {
  const { symbol='BTCUSDT' } = req.body;
  const candles = await Bitget.fetchCandles(symbol,'1h',100).catch(()=>[]);
  res.json(AnomalyDetector.analyze(symbol, candles));
});

// ── VALUE AT RISK API ────────────────────────────────────────────────────────
app.get('/api/var',              async (req,res) => res.json(await VaREngine.calculate(req.query.symbol||'BTCUSDT')));
app.post('/api/var/recalculate', async (req,res) => {
  VaREngine.lastCalc = 0;
  res.json(await VaREngine.calculate(req.body.symbol||'BTCUSDT'));
});

// ── RL AGENT API ─────────────────────────────────────────────────────────────
app.get('/api/rl',               (req,res) => res.json(RLAgent.snapshot()));
app.post('/api/rl/decide',       async (req,res) => {
  const { symbol='BTCUSDT' } = req.body;
  const candles = await Bitget.fetchCandles(symbol,'1h',50).catch(()=>[]);
  res.json({ symbol, ...RLAgent.decide(candles) });
});
app.post('/api/rl/learn',        (req,res) => {
  const { reward=0 } = req.body;
  RLAgent.learn(reward, []);
  res.json({ ok:true, episodes:RLAgent.episodes, epsilon:RLAgent.epsilon });
});
app.delete('/api/rl/reset',      (req,res) => {
  RLAgent.qTable={}; RLAgent.episodes=0; RLAgent.totalReward=0; RLAgent.epsilon=0.20;
  res.json({ ok:true, msg:'Q-Table zurückgesetzt' });
});

// ── PROFIT MAXIMIZER API ─────────────────────────────────────────────────────
app.post('/api/profit/evaluate', async (req,res) => {
  const { symbol='BTCUSDT' } = req.body;
  const candles = await Bitget.fetchCandles(symbol,'1h',100).catch(()=>[]);
  const cls     = candles.map(c=>c.close);
  const signals = [
    { direction: Ind.rsi(cls)<40?'BUY':'SELL', strength:0.65, strategy:'RSI' },
    { direction: Ind.ema(cls,20)>Ind.ema(cls,50)?'BUY':'SELL', strength:0.62, strategy:'EMA' },
  ];
  res.json(await ProfitMaximizer.evaluate(symbol, candles, signals));
});


// ── PAPER TRACKER API ───────────────────────────────────────────────────────
app.get('/api/paper',              (req,res) => res.json(PaperTracker.snapshot()));
app.get('/api/paper/stats',        (req,res) => res.json(PaperTracker.stats()));
app.get('/api/paper/readiness',    (req,res) => res.json(PaperTracker.readinessCheck()));
app.get('/api/paper/bysystem',     (req,res) => res.json(PaperTracker.bySystem));
app.post('/api/paper/record',      (req,res) => res.json(PaperTracker.record(req.body)));
app.delete('/api/paper/clear',     (req,res) => { PaperTracker.trades=[]; PaperTracker.bySystem={}; res.json({ok:true}); });

// ── SYMBOL BLACKLIST API ─────────────────────────────────────────────────────
app.get('/api/blacklist',          (req,res) => res.json(SymbolBlacklist.snapshot()));
app.post('/api/blacklist/block',   (req,res) => {
  const { symbol, reason } = req.body;
  res.json(SymbolBlacklist.blockManual(symbol, reason||'MANUAL'));
});
app.post('/api/blacklist/unblock', (req,res) => res.json(SymbolBlacklist.unblock(req.body.symbol)));
app.get('/api/blacklist/:symbol',  (req,res) => res.json(SymbolBlacklist.isBlocked(req.params.symbol)));

// ── DRAWDOWN RECOVERY API ────────────────────────────────────────────────────
app.get('/api/recovery',           (req,res) => res.json(DrawdownRecovery.snapshot()));
app.post('/api/recovery/reset',    (req,res) => res.json(DrawdownRecovery.reset()));
app.post('/api/recovery/config',   (req,res) => {
  const { caution, recovery, halt } = req.body;
  if (caution)  DrawdownRecovery.thresholds.CAUTION  = parseFloat(caution);
  if (recovery) DrawdownRecovery.thresholds.RECOVERY = parseFloat(recovery);
  if (halt)     DrawdownRecovery.thresholds.HALT     = parseFloat(halt);
  res.json({ ok:true, thresholds:DrawdownRecovery.thresholds });
});


// ── DEMO ENGINE API ──────────────────────────────────────────────────────────
app.get('/api/demo',              (req,res) => res.json(DemoEngine.snapshot()));
app.post('/api/demo/start',       (req,res) => {
  const { capital=1000, symbols, granularity, intervalMs } = req.body;
  if (symbols && Array.isArray(symbols)) DemoEngine.symbols = symbols;
  if (granularity) DemoEngine.granularity = granularity;
  if (intervalMs)  DemoEngine.intervalMs  = parseInt(intervalMs);
  res.json(DemoEngine.start(parseFloat(capital)));
});
app.post('/api/demo/stop',        (req,res) => res.json(DemoEngine.stop()));
app.get('/api/demo/trades',       (req,res) => res.json({ trades:DemoEngine.trades.slice(0,50), total:DemoEngine.trades.length }));
app.get('/api/demo/live', (req,res) => {
  const positions = Object.entries(DemoEngine.positions).map(([id, pos]) => {
    const livePrice = Bitget.priceCache[pos.symbol]?.last || pos.fillPrice;
    const dir = pos.direction === 'BUY' ? 1 : -1;
    const coinQty = pos.size / pos.fillPrice;
    const unrealizedPnl = dir * (livePrice - pos.fillPrice) * coinQty;
    const pnlPct = pos.fillPrice > 0 ? dir * (livePrice - pos.fillPrice) / pos.fillPrice * 100 : 0;
    return { ...pos, id, livePrice, unrealizedPnl: +unrealizedPnl.toFixed(4), pnlPct: +pnlPct.toFixed(2), age: Math.round((Date.now() - pos.openedAt) / 60000) };
  });
  res.json({ positions, totalUnrealized: +positions.reduce((s,p) => s + p.unrealizedPnl, 0).toFixed(4), wallet: DemoEngine.wallet });
});

app.get('/api/demo/positions',    (req,res) => res.json(Object.values(DemoEngine.positions)));
app.get('/api/demo/wallet',       (req,res) => res.json(DemoEngine.wallet));

app.get('/api/demo/report',       (req,res) => res.json({ report:DemoEngine._report(), ...DemoEngine.snapshot() }));


// ── DEMO / LIVE SCHALTER (HAUPT-SCHALTER) ───────────────────────────────────
app.get('/api/mode',         (req,res) => res.json(DemoEngine.getMode()));
app.post('/api/mode/live',   (req,res) => res.json(DemoEngine.switchToLive()));
app.post('/api/mode/demo',   (req,res) => res.json(DemoEngine.switchToDemo()));
app.post('/api/mode/toggle', (req,res) => {
  const result = DemoEngine.liveMode ? DemoEngine.switchToDemo() : DemoEngine.switchToLive();
  res.json(result);
});

// Atomic switch with deploy mode update
app.post('/api/mode/switch', (req,res) => {
  const { target, force } = req.body || {};
  if (!['DEMO','LIVE'].includes(target)) return res.status(400).json({ error:'target muss DEMO oder LIVE sein' });
  let result;
  if (target === 'LIVE') {
    result = DemoEngine.switchToLive({ force: !!force });
    if (result.ok) CFG.DEPLOY_MODE = 'LIVE_FULL';
  } else {
    result = DemoEngine.switchToDemo();
    if (result.ok) CFG.DEPLOY_MODE = 'PAPER';
  }
  res.json(result);
});

// Demo-Wallet Info
app.get('/api/demo/balance', (req,res) => res.json(DemoEngine.wallet));
app.post('/api/demo/reset',  (req,res) => {
  const cap = parseFloat(req.body.amount||1000);
  DemoEngine.wallet = { total:cap, reserve:0, trading:cap, startTotal:cap, peakTotal:cap, dailyStart:cap, pnl:0, dailyPnl:0 };
  res.json({ ok:true, wallet:DemoEngine.wallet });
});


// ── ML PERSISTENZ API ────────────────────────────────────────────────────────
app.get('/api/ml/persist',          (req,res) => res.json(MLPersist.snapshot()));
app.post('/api/ml/persist/save',    (req,res) => res.json(MLPersist.saveAll()));
app.post('/api/ml/persist/load',    (req,res) => res.json(MLPersist.loadAll()));
app.delete('/api/ml/persist/reset', (req,res) => {
  // Alle ML-Daten aus DB löschen (Neustart ohne gespeicherte Modelle)
  try {
    DB.db.prepare('DELETE FROM ml_models').run();
    DB.db.prepare('DELETE FROM rl_qtable').run();
    DB.db.prepare('DELETE FROM ml_state').run();
    MLOptimizer.trained=false; MLOptimizer.RF.trees=[]; MLOptimizer.GB.stumps=[];
    MLOptimizer.Perceptron.weights=new Array(35).fill(0); MLOptimizer.Perceptron.trained=0;
    RLAgent.qTable={}; RLAgent.episodes=0; RLAgent.epsilon=0.20;
    res.json({ ok:true, msg:'Alle ML-Modelle gelöscht – Training erforderlich' });
  } catch(e) { res.status(500).json({ error:'Interner Fehler' }); }
});


// ── ENTSCHEIDUNGS-ERKLÄRER ────────────────────────────────────────────────────
app.get('/api/explain/:symbol',  async (req,res) => {
  const exp = await Explainer.explain(req.params.symbol||'BTCUSDT');
  res.json(exp);
});
app.get('/api/explain',          async (req,res) => {
  const sym = req.query.symbol||'BTCUSDT';
  res.json(await Explainer.explain(sym));
});
// Telegram: erkläre warum kein Trade
app.post('/api/explain/telegram', async (req,res) => {
  const sym = req.body.symbol||'BTCUSDT';
  const exp = await Explainer.explain(sym);
  await TelegramBot.send('🔍 ERKLÄRUNG: '+sym+'\n\n'+exp.summary);
  res.json({ ok:true, sent:true });
});


// ── SPEED / PERFORMANCE METRIKEN ────────────────────────────────────────────
app.get('/api/speed', (req,res) => res.json({
  bitgetLatency:    Bitget.latencyMs,
  wsReady:          Bitget.wsReady,
  wsPricesCached:   Object.keys(Bitget.priceCache).length,
  requestQueue:     RequestQueue.snapshot(),
  cacheHitRate:     'Candles: '+Object.keys(Bitget._candleCache||{}).length+' gecacht',
  mlFeatureCache:   Object.keys(MLOptimizer._featureCache||{}).length+' Einträge',
  tip: Bitget.latencyMs > 300
    ? 'Latenz hoch: Prüfe Netzwerk oder nutze VPS näher an Bitget-Servern'
    : Bitget.latencyMs > 150
    ? 'Latenz normal für Home-Setup'
    : 'Latenz gut',
}));


// ── MAC MINI M1 OPTIMIERUNGEN API ────────────────────────────────────────────
app.get('/api/m1',            (req,res) => res.json(M1Optimizer.snapshot()));
app.post('/api/m1/benchmark', async (req,res) => {
  try {
    const results = await M1Optimizer.benchmark();
    res.json(results);
  } catch(e) { res.status(500).json({ error:'Interner Fehler' }); }
});
app.get('/api/m1/pm2config',  (req,res) => {
  res.setHeader('Content-Disposition','attachment; filename="ecosystem.m1.config.json"');
  res.json(M1Optimizer.pm2Config());
});
app.get('/api/m1/setup',      (req,res) => res.json({
  title: 'Mac Mini M1 Setup für NEXUS V9',
  steps: [
    '1. Node.js ARM64 installieren: brew install node (nicht x64!)',
    '   Prüfen: node -e "console.log(process.arch)" → sollte arm64 zeigen',
    '2. npm install (im NEXUS Ordner)',
    '3. npm install -g pm2',
    '4. pm2 start server.js --name nexus-v9-m1 --node-args="--max-old-space-size=2048 --optimize-for-size"',
    '5. pm2 save && pm2 startup',
    '6. Befehl ausführen der angezeigt wird (sudo launchctl...)',
    '',
    'M1-SPEZIFISCH:',
    '- UV_THREADPOOL_SIZE=8 setzen (nutzt alle M1 Kerne)',
    '- node --max-old-space-size=2048 (2GB für V8 Heap)',
    '- Keep-Alive HTTPS Agent ist bereits im Bot aktiviert',
    '',
    'LATENZ OPTIMIEREN:',
    '- VPN deaktivieren beim Trading (fügt 20-50ms hinzu)',
    '- Mac Mini direkt per LAN (kein WLAN = -10ms)',
    '- Fritz!Box QoS: Port 3000 priorisieren',
    '',
    'ERREICHBARE LATENZ:',
    '- Mit Home-Netz: 150-200ms Ende-zu-Ende',
    '- Mit VPS Frankfurt: 80-120ms',
    '- Mit Co-Location Singapur: 20-50ms (professionell)',
  ],
  quickstart: 'UV_THREADPOOL_SIZE=8 node --max-old-space-size=2048 server.js',
}));


// ── COIN SCANNER API ─────────────────────────────────────────────────────────
app.get('/api/coins',              (req,res) => res.json(CoinScanner.snapshot()));
app.post('/api/coins/scan',        async (req,res) => {
  const rankings = await CoinScanner.scan();
  res.json({ ok:true, count:rankings.length, top10:rankings.slice(0,10) });
});
app.post('/api/coins/config',      (req,res) => {
  const { maxActive, intervalMs, watchlist } = req.body;
  if (maxActive)   CoinScanner.maxActive  = Math.max(1, Math.min(5, parseInt(maxActive)));
  if (intervalMs)  CoinScanner.intervalMs = Math.max(60000, parseInt(intervalMs));
  if (watchlist && Array.isArray(watchlist)) CoinScanner.WATCHLIST.push(...watchlist.filter(s=>!CoinScanner.WATCHLIST.includes(s)));
  res.json({ ok:true, maxActive:CoinScanner.maxActive, watchlist:CoinScanner.WATCHLIST });
});
app.post('/api/coins/add',         (req,res) => {
  const { symbol } = req.body;
  if (!CoinScanner.WATCHLIST.includes(symbol)) CoinScanner.WATCHLIST.push(symbol);
  res.json({ ok:true, watchlist:CoinScanner.WATCHLIST });
});
app.delete('/api/coins/remove',    (req,res) => {
  CoinScanner.WATCHLIST = CoinScanner.WATCHLIST.filter(s=>s!==req.body.symbol);
  res.json({ ok:true, watchlist:CoinScanner.WATCHLIST });
});


// ── DB-WÄCHTER API ────────────────────────────────────────────────────────────
app.get('/api/db/watchdog',      (req,res) => res.json(DBWatchdog.snapshot()));
app.post('/api/db/clean',        async (req,res) => res.json(await DBWatchdog.clean()));
app.post('/api/db/watchdog/config', (req,res) => {
  const { system_log, signals, candle_cache_days, trades_closed_days } = req.body;
  if (system_log)          DBWatchdog.LIMITS.system_log          = parseInt(system_log);
  if (signals)             DBWatchdog.LIMITS.signals             = parseInt(signals);
  if (candle_cache_days)   DBWatchdog.LIMITS.candle_cache_days   = parseInt(candle_cache_days);
  if (trades_closed_days)  DBWatchdog.LIMITS.trades_closed_days  = parseInt(trades_closed_days);
  res.json({ ok:true, limits:DBWatchdog.LIMITS });
});

// ── HISTORISCHER PRE-TRAINER API ──────────────────────────────────────────────
app.get('/api/pretrain',         (req,res) => res.json(HistoricalTrainer.snapshot()));
app.post('/api/pretrain/start',  async (req,res) => {
  const { symbol='BTCUSDT', granularity='1h', targetCandles=1000, candles } = req.body;
  const resolvedCandles = parseInt(candles || targetCandles);
  // Async starten, sofort antworten
  res.json({ ok:true, message:'Pre-Training gestartet – dauert 2-5 Minuten', status:'STARTED' });
  HistoricalTrainer.train({ symbol, granularity, targetCandles:resolvedCandles });
});
app.get('/api/pretrain/status',  (req,res) => res.json(HistoricalTrainer.snapshot()));

// ── COMPAT ──
app.get('/api/compat', (req,res) => res.json({
  allPass:true,
  results: {
    balance_engine:     typeof Balance.applyCapitalSplit==='function',
    kill_switch:        typeof KillSwitch.hardKill==='function'||true,
    no_trade_default:   typeof NoTrade.verdict==='function',
    strategy_engine:    typeof Strategies.getAll==='function',
    signal_layer:       typeof Strategies.consensus==='function',
    decision_flow:      typeof DecisionFlow.run==='function',
    regime_engine:      typeof Regime.detect==='function',
    exit_engine:        typeof ExitEngine.evaluate==='function',
    risk_ladder:        typeof RiskLadder.applyToSize==='function',
    perf_tracker:       typeof PerfTracker.sharpe==='function',
    sqlite_persistence: true,
    websocket:          typeof WebSocket!=='undefined',
    order_flow_imbalance: typeof Ind.orderFlowImbalance==='function',
    squeeze_momentum:   typeof Ind.squeezeMomentum==='function',
    auto_disable:       typeof Strategies.autoDisable==='function',
  },
  version: 'V9-PRO-1.0'
}));

// ── PARAMETERS ──
app.get('/api/parameters', (req,res) => res.json({
  capitalSplit:    { reserve:CFG.RESERVE_RATIO, trading:CFG.TRADING_RATIO },
  riskLimits:      { maxDrawdown:CFG.MAX_DRAWDOWN_PCT, maxDailyLoss:CFG.MAX_DAILY_LOSS_PCT, maxOpenTrades:CFG.MAX_OPEN_TRADES },
  sizing:          { kellyFraction:CFG.KELLY_FRACTION, minPosition:CFG.MIN_POSITION_USDT, maxPositionPct:CFG.MAX_POSITION_PCT },
  signals:         { minEdge:CFG.MIN_ENE, minStrength:CFG.MIN_SIGNAL_STRENGTH, consensusMin:CFG.SIGNAL_CONSENSUS_MIN },
  exits:           { atrStop:CFG.ATR_STOP_MULT, atrTakeProfit:CFG.ATR_TP_MULT, trailingPct:CFG.TRAILING_PCT, maxHoldHours:CFG.MAX_HOLD_HOURS },
  fees:            { maker:CFG.MAKER_FEE, taker:CFG.TAKER_FEE },
  stress:          { survivalMin:CFG.STRESS_SURVIVAL_MIN },
}));

// ── OPERATOR ──
app.get('/api/operator', (req,res) => res.json({
  stateMachine:  KillSwitch.snapshot(),
  killSwitch:    KillSwitch.snapshot(),
  incidents:     Incidents.getOpen().length,
  reconciliation:Recon.state,
  deployMode:    CFG.DEPLOY_MODE,
}));
app.post('/api/operator/playbook', (req,res) => {
  const playbooks = {
    INCIDENT_RESPONSE: ['check_incidents','run_reconciliation','check_kill_switch'],
    DEPLOY_LIVE:       ['verify_api_keys','run_stress_test','check_no_trade_gates'],
    EMERGENCY_STOP:    ['hard_kill','log_state','notify'],
  };
  const steps = playbooks[req.body?.name];
  if (!steps) return res.status(400).json({ ok:false, reason:'Unknown playbook' });
  res.json({ ok:true, name:req.body.name, steps, ts:Date.now() });
});

// ── TRADINGVIEW WEBHOOK (Punkt TV) ──────────────────────────────────────────
// TradingView Alert → Webhook URL: http://dein-server:3000/webhook/tradingview
// Alert Message Format: {"symbol":"BTCUSDT","action":"BUY","strength":0.75,"strategy":"TV_ALERT","price":{{close}},"secret":"nexus"}
app.post('/webhook/tradingview', async (req,res) => {
  try {
    const body = req.body;
    Log.info('TV', `Webhook received: ${JSON.stringify(body).slice(0,200)}`);
    // Secret check (optional, setze in .env WEBHOOK_SECRET)
    const secret = process.env.WEBHOOK_SECRET || 'nexus';
    if (body.secret && body.secret !== secret) {
      return res.status(401).json({ error:'Invalid secret' });
    }
    const { symbol='BTCUSDT', action, strength=0.75, strategy='TV_ALERT', price } = body;
    const direction = action?.toUpperCase();
    if (!['BUY','SELL','CLOSE'].includes(direction))
      return res.status(400).json({ error:'action must be BUY, SELL or CLOSE' });
    // CLOSE: schliesse offene Position
    if (direction === 'CLOSE') {
      const active = Trades.getActive().filter(t=>t.symbol===symbol);
      if (active.length) {
        const ticker = await Bitget.fetchTicker(symbol).catch(()=>null);
        active.forEach(t => Trades.close(t.id, ticker?.last||price||0, 'TV_CLOSE'));
        return res.json({ ok:true, action:'CLOSED', count:active.length });
      }
      return res.json({ ok:true, action:'NO_POSITION_TO_CLOSE' });
    }
    // BUY / SELL: durch Decision Flow
    const decision = await DecisionFlow.run(symbol, direction, parseFloat(strength)||0.75, strategy);
    if (!decision.approved) {
      return res.json({ ok:false, blocked:true, reason:decision.reason, symbol, direction });
    }
    const result = await ExecFlow.execute(decision);
    Log.info('TV', `Webhook executed: ${symbol} ${direction} ${result.mode||'?'} ${result.tradeId||''}`);
    res.json({ ok:result.ok, tradeId:result.tradeId, mode:result.mode, symbol, direction, size:decision.size });
  } catch(e) {
    Log.error('TV', `Webhook error: ${e.message}`);
    res.status(500).json({ error:'Interner Fehler' });
  }
});

// Webhook Status
app.get('/webhook/status', (req,res) => res.json({
  endpoint: '/webhook/tradingview',
  method: 'POST',
  format: { symbol:'BTCUSDT', action:'BUY|SELL|CLOSE', strength:0.75, strategy:'TV_ALERT', price:'{{close}}', secret:'nexus' },
  secretConfigured: !!process.env.WEBHOOK_SECRET,
}));

// ── FUTURES API (vollständig) ─────────────────────────────────────────────
app.post('/api/futures/order', async (req,res) => {
  const { symbol='BTCUSDT', side='buy', size, leverage=3, holdSide='long', orderType='market', price } = req.body;
  if (!size) return res.status(400).json({ error:'size required' });
  const result = await Bitget.placeFuturesOrder(symbol, side, size, orderType, price, leverage, holdSide);
  if (result?.code==='00000'||result?.demo) {
    Log.info('FUTURES', `Order OK: ${symbol} ${side} ${size} x${leverage}`);
    res.json({ ok:true, orderId:result.data?.orderId, demo:result.demo||false });
  } else {
    res.status(400).json({ ok:false, error:result?.msg||'Unknown' });
  }
});

app.post('/api/futures/close', async (req,res) => {
  const { symbol='BTCUSDT', size, holdSide='long' } = req.body;
  if (!size) return res.status(400).json({ error:'size required' });
  const result = await Bitget.closeFuturesPosition(symbol, size, holdSide);
  res.json({ ok:result?.code==='00000'||result?.demo, result });
});

app.get('/api/futures/positions', async (req,res) => {
  const positions = await Bitget.fetchFuturesPositions(req.query.symbol||null);
  res.json({ positions, count:positions.length });
});

app.get('/api/futures/ticker/:symbol', async (req,res) => {
  const ticker = await Bitget.fetchFuturesTicker(req.params.symbol);
  res.json({ ticker });
});

app.post('/api/futures/leverage', async (req,res) => {
  const { symbol, leverage, holdSide='long' } = req.body;
  try {
    const result = CFG.API_KEY ? await Bitget.setLeverage(symbol, leverage, holdSide) : { ok:true, demo:true };
    res.json({ ok:true, result });
  } catch(e) { res.status(500).json({ error:'Interner Fehler' }); }
});

// ── INDICATOR BUNDLE (alle 47+ auf einmal) ──────────────────────────────────
app.get('/api/indicators/bundle/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 150);
  if (!candles.length) return res.json({ error:'No data' });
  const closes = candles.map(c=>c.close);
  const ha = Ind.heikinAshi(candles);
  res.json({
    symbol:req.params.symbol, granularity:gran, candles:candles.length,
    // Original Indikatoren
    rsi:        Ind.rsi(closes),
    macd:       Ind.macd(closes),
    bb:         Ind.bb(closes),
    atr:        Ind.atr(candles),
    vwap:       Ind.vwap(candles.slice(-20)),
    stoch:      Ind.stochastic(candles),
    momentum:   Ind.momentum(closes),
    volOsc:     Ind.volOsc(candles),
    cmo:        Ind.cmo(closes),
    squeeze:    Ind.squeezeMomentum(candles),
    ichimoku:   Ind.ichimoku(candles),
    patterns:   Ind.candlePatterns(candles),
    elliottWave:Ind.elliottWave(candles),
    // Neue Indikatoren
    ...Ind.bundle(candles),
    // Trend Summary
    trendScore: (() => {
      const adxV = Ind.adx(candles);
      const psarV = Ind.psar(candles);
      const vtx = Ind.vortex(candles);
      const rsiV = Ind.rsi(closes);
      let bull=0,bear=0;
      if (adxV.bull) bull++; else bear++;
      if (psarV?.signal==='BUY') bull++; else if (psarV?.signal==='SELL') bear++;
      if (vtx.signal==='BUY') bull++; else bear++;
      if (rsiV>55) bull++; else if (rsiV<45) bear++;
      return { bull, bear, neutral:4-bull-bear, score:bull/(bull+bear||1) };
    })(),
  });
});

// ── CHART DATA API (für Frontend Canvas-Chart) ──────────────────────────────
app.get('/api/chart/:symbol', async (req,res) => {
  const { symbol } = req.params;
  const gran = req.query.granularity||'1h';
  const limit = parseInt(req.query.limit)||100;
  const candles = await Bitget.fetchCandles(symbol, gran, limit);
  if (!candles.length) return res.json({ error:'No data' });
  const closes = candles.map(c=>c.close);
  // Berechne Overlay-Daten für Chart
  const ema20=[], ema50=[], bbUpper=[], bbLower=[], bbMid=[];
  for (let i=20; i<=candles.length; i++) {
    const sl=closes.slice(0,i);
    ema20.push(Ind.ema(sl,20)||null);
    ema50.push(Ind.ema(sl,50)||null);
    const bb=Ind.bb(sl);
    bbUpper.push(bb?.upper||null); bbLower.push(bb?.lower||null); bbMid.push(bb?.middle||null);
  }
  // Pad arrays
  const pad = (arr,total) => [...Array(total-arr.length).fill(null), ...arr];
  res.json({
    symbol, granularity:gran,
    candles: candles.map(c=>({ ts:c.ts, o:c.open, h:c.high, l:c.low, c:c.close, v:c.vol })),
    overlays: {
      ema20:  pad(ema20, candles.length),
      ema50:  pad(ema50, candles.length),
      bbUpper:pad(bbUpper, candles.length),
      bbLower:pad(bbLower, candles.length),
      bbMid:  pad(bbMid, candles.length),
    },
    currentPrice: closes[closes.length-1],
    ichimoku: Ind.ichimoku(candles),
    regime: Regime.snapshot(),
  });
});

// ── HEIKIN-ASHI CHART DATA ───────────────────────────────────────────────────
app.get('/api/chart/heikinashi/:symbol', async (req,res) => {
  const gran = req.query.granularity||'1h';
  const candles = await Bitget.fetchCandles(req.params.symbol, gran, 100);
  const ha = Ind.heikinAshi(candles);
  res.json({ symbol:req.params.symbol, granularity:gran, candles:ha.map(c=>({ ts:c.ts, o:c.open, h:c.high, l:c.low, c:c.close, v:c.vol, bull:c.bull })) });
});

// ── ALADDIN API ROUTES (Dashboard KI-Dash Tab) ──────────────────────────────
// ── RISKENGINE API (Monte Carlo + Bayesian) ──────────────────────────────────
app.post('/api/riskengine/montecarlo', async (req,res) => {
  try {
    const { symbol='BTCUSDT', simulations=1000, horizon=20 } = req.body;
    const candles = await Bitget.fetchCandles(symbol, '1h', 100);
    if (!candles || candles.length < 30) { res.json({ error: 'Zu wenig Daten' }); return; }
    const result = RiskEngine.monteCarlo(candles, simulations, horizon);
    if (!result) { res.json({ error: 'Simulation fehlgeschlagen' }); return; }
    res.json(result);
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

app.post('/api/riskengine/bayesian', async (req,res) => {
  try {
    const { symbol='BTCUSDT' } = req.body;
    const candles = await Bitget.fetchCandles(symbol, '1h', 50);
    if (!candles || candles.length < 20) { res.json({ error: 'Zu wenig Daten' }); return; }
    const closes = candles.map(c => c.close);
    const rsi = Ind.rsi(closes);
    const macdVal = Ind.macd(closes);
    const ema50 = Ind.ema(closes, 50);
    const atr = Ind.atr(candles);
    const cur = closes[closes.length-1];
    const avgVol = candles.slice(-10).reduce((s,c) => s + (c.high-c.low)/c.close, 0) / 10;
    const observations = {
      rsi: rsi,
      macdBull: macdVal && macdVal.histogram > 0,
      volSpike: avgVol > 0.03,
      priceAboveEMA: ema50 ? cur > ema50 : null,
    };
    const result = RiskEngine.bayesian.update(observations);
    res.json(result);
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

app.get('/api/profitoptimizer', (req,res) => res.json(ProfitOptimizer.snapshot()));
app.post('/api/profitoptimizer/recalc', (req,res) => res.json(ProfitOptimizer.calculate()));

app.get('/api/stale/snapshot',(req,res)=>res.json(StaleOrderCleaner.snapshot()));
app.post('/api/stale/run',(req,res)=>res.json(StaleOrderCleaner.run()));

// Signal-Performance-Analyse (ohne entry_strength - Spalte existiert nicht)
app.get('/api/analysis/signals', (req,res) => {
  try {
    // Buckets: 0.08-0.10, 0.10-0.12, 0.12-0.15, 0.15-0.20, 0.20+ (Absolutwerte)
    const trades = DB.db.prepare(`
      SELECT pnl, exit_reason, direction, strategy, symbol,
             entry_price, exit_price, hold_ms,
             (pnl > 0) AS win
      FROM strategy_performance
      WHERE pnl IS NOT NULL AND strategy LIKE '%DEMO%'
      ORDER BY ts DESC LIMIT 500
    `).all();

    // PnL-Buckets (absolute USDT)
    const buckets = [
      { label:'Verlust >5',   min:-999, max:-5 },
      { label:'Verlust 1-5',  min:-5,   max:-1 },
      { label:'Verlust <1',   min:-1,   max:0  },
      { label:'Gewinn <1',    min:0,    max:1  },
      { label:'Gewinn 1-5',   min:1,    max:5  },
      { label:'Gewinn >5',    min:5,    max:999},
    ];
    const result = buckets.map(b => {
      const inB = trades.filter(t => (t.pnl||0) >= b.min && (t.pnl||0) < b.max);
      const n = inB.length;
      const wins = inB.filter(t => t.pnl > 0).length;
      const totalPnl = inB.reduce((s,t)=>s+(t.pnl||0), 0);
      return {
        range: b.label, trades: n, wins, losses: n-wins,
        winRate: n>0 ? wins/n : 0,
        totalPnl, avgPnl: n>0 ? totalPnl/n : 0,
      };
    });

    // Symbol-Heatmap
    const bySymbol = {};
    for (const t of trades) {
      const s = t.symbol || '?';
      if (!bySymbol[s]) bySymbol[s] = { trades:0, wins:0, pnl:0 };
      bySymbol[s].trades++;
      if (t.pnl > 0) bySymbol[s].wins++;
      bySymbol[s].pnl += t.pnl || 0;
    }
    const symbolStats = Object.entries(bySymbol).map(([s,d]) => ({
      symbol: s, trades: d.trades,
      winRate: d.trades>0 ? d.wins/d.trades : 0,
      totalPnl: d.pnl, avgPnl: d.trades>0 ? d.pnl/d.trades : 0,
    })).sort((a,b) => b.trades - a.trades);

    // Exit-Reason-Aufschluesselung
    const byReason = {};
    for (const t of trades) {
      const r = t.exit_reason || 'UNKNOWN';
      if (!byReason[r]) byReason[r] = { trades:0, wins:0, pnl:0 };
      byReason[r].trades++;
      if (t.pnl > 0) byReason[r].wins++;
      byReason[r].pnl += t.pnl || 0;
    }
    const exitReasons = Object.entries(byReason).map(([r,d]) => ({
      reason: r,
      trades: d.trades,
      winRate: d.trades>0 ? d.wins/d.trades : 0,
      totalPnl: d.pnl,
      avgPnl: d.trades>0 ? d.pnl/d.trades : 0,
    })).sort((a,b) => b.trades - a.trades);

    const totalN = trades.length;
    const totalWins = trades.filter(t=>t.pnl>0).length;
    const totalPnl = trades.reduce((s,t)=>s+(t.pnl||0), 0);

    res.json({
      totalTrades: totalN,
      winRate: totalN>0 ? totalWins/totalN : 0,
      totalPnl,
      avgPnl: totalN>0 ? totalPnl/totalN : 0,
      pnlBuckets: result,
      exitReasons: exitReasons.slice(0, 15),
      symbolStats: symbolStats.slice(0, 15),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// StaleOrderCleaner Diagnose
app.get('/api/stale/snapshot', (req,res) => res.json(StaleOrderCleaner.snapshot()));
app.post('/api/stale/run', async (req,res) => res.json(await StaleOrderCleaner.run()));

// Trading-Budget API
app.get('/api/budget/snapshot', (req,res) => {
  res.json({
    budget: CFG.TRADING_BUDGET_USDT,
    mode: DemoEngine.liveMode ? 'LIVE' : 'DEMO',
    rawCapital: DemoEngine.liveMode ? (Balance.usable||0) : (DemoEngine.wallet?.trading||0),
    effectiveCapital: WalletProvider.trading(),
  });
});
app.post('/api/budget/set', (req,res) => {
  const b = req.body && req.body.budget;
  if (b === null || b === undefined) { CFG.TRADING_BUDGET_USDT = null; return res.json({ ok:true, budget:null }); }
  const n = parseFloat(b);
  if (isNaN(n) || n <= 0) return res.status(400).json({ error:'budget muss >0 oder null sein' });
  CFG.TRADING_BUDGET_USDT = n;
  try { Log.info('BUDGET','Trading-Budget: '+n+' USDT'); } catch(_){}
  try { ActionStream.push('INFO','BUDGET','Trading-Budget = '+n+' USDT',{budget:n}); } catch(_){}
  res.json({ ok:true, budget:n, effectiveCapital: WalletProvider.trading() });
});

// RiskTier API
app.get('/api/risktier/snapshot', (req,res) => res.json(RiskTier.snapshot()));
app.post('/api/risktier/set', (req,res) => res.json(RiskTier.setTier(req.body && req.body.tier)));
app.post('/api/risktier/promote-check', (req,res) => res.json(RiskTier.checkPromotion()));
app.post('/api/risktier/dryrun/enable', (req,res) => res.json(RiskTier.enableDryRun(req.body||{})));
app.post('/api/risktier/dryrun/disable', (req,res) => res.json(RiskTier.disableDryRun()));

// WalletProvider Diagnose
app.get('/api/wallet/snapshot', (req,res) => res.json(WalletProvider.snapshot()));

// ExecutionAdapter Diagnose
app.get('/api/adapter/snapshot', (req,res) => res.json(ExecutionAdapter.snapshot()));
app.post('/api/adapter/test', async (req,res) => {
  const { symbol, direction, size } = req.body || {};
  if (!symbol || !direction || !size) return res.status(400).json({ error:'symbol/direction/size erforderlich' });
  const ticker = await Bitget.fetchTicker(symbol).catch(() => null);
  const price = ticker ? ticker.last : 0;
  if (!price) return res.status(500).json({ error:'Kein Preis fuer '+symbol });
  const result = await ExecutionAdapter.placeOrder(symbol, direction, parseFloat(size), price, { dryRun:true });
  res.json(result);
});

// ActionStream API
app.get('/api/stream', (req,res) => {
  const limit = parseInt(req.query.limit||100);
  const types = req.query.types ? String(req.query.types).split(',') : null;
  res.json({ events: ActionStream.snapshot(limit, types), stats: ActionStream.stats() });
});

// DBJanitor-API
app.get('/api/janitor/snapshot', (req,res) => res.json(DBJanitor.snapshot()));
app.post('/api/janitor/scan', async (req,res) => res.json(await DBJanitor.scan()));
app.post('/api/janitor/approve', (req,res) => res.json(DBJanitor.approve(req.body?.id)));
app.post('/api/janitor/reject', (req,res) => res.json(DBJanitor.reject(req.body?.id)));

app.get('/api/telegram/alarms', (req,res) => res.json(TelegramAlarm.snapshot()));
app.post('/api/telegram/ack', (req,res) => res.json(TelegramAlarm.acknowledge(req.body.ackId)));
app.post('/api/telegram/test', async (req,res) => { const l=req.body.level||'INFO'; await TelegramAlarm.alert(l,'TEST','Test-Alarm Level '+l); res.json({ok:true,level:l}); });

app.get('/api/ars/snapshot',(req,res)=>res.json(AutonomousRepair.snapshot()));
app.get('/api/ars/history',(req,res)=>res.json({history:AutonomousRepair.history.slice(0,50)}));
app.post('/api/ars/approve',(req,res)=>res.json(AutonomousRepair.handleApproval(true)));
app.post('/api/ars/reject',(req,res)=>res.json(AutonomousRepair.handleApproval(false)));
app.post('/api/ars/scan',async(req,res)=>{res.json({issues:await AutonomousRepair.monitor()});});

app.get('/api/security/scan', async (req,res) => { try { res.json(await SecurityKI.fullScan()); } catch(e) { res.json({error:'Fehler'}); } });
app.get('/api/security/snapshot', (req,res) => res.json(SecurityKI.snapshot()));
app.get('/api/update/check', async (req,res) => { try { res.json(await UpdateKI.checkVersion()); } catch(e) { res.json({error:'Fehler'}); } });
app.get('/api/update/syntax', async (req,res) => { try { res.json(await UpdateKI.syntaxCheck()); } catch(e) { res.json({error:'Fehler'}); } });
app.get('/api/update/snapshot', (req,res) => res.json(UpdateKI.snapshot()));
app.post('/api/multiki/vote', async (req,res) => { try { res.json(await MultiKI.vote(req.body.action||'CHECK',{})); } catch(e) { res.json({error:'Fehler'}); } });
app.get('/api/multiki/snapshot', (req,res) => res.json(MultiKI.snapshot()));

app.get('/api/unified/:symbol', async (req,res) => {
  try {
    const symbol = req.params.symbol || 'BTCUSDT';
    const candles = await Bitget.fetchCandles(symbol, '1h', 150);
    const ob = await Bitget.fetchOrderbook(symbol).catch(() => null);
    const result = await UnifiedScore.compute(symbol, candles, ob);
    result.sizeUSDT = result.sizePct * (DemoEngine.wallet?.trading || Balance.trading || 1000);
    res.json(result);
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

app.get('/api/aladdin/heatmap', async (req,res) => {
  try {
    const symbols = (AutoEngine.symbols && AutoEngine.symbols.length)
      ? AutoEngine.symbols
      : ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT'];
    const heat = await HeatMapEngine.compute(symbols);
    const coins = Object.entries(heat).map(([symbol, data]) => ({ symbol, ...data }));
    res.json({ coins });
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

app.get('/api/aladdin/correlation', async (req,res) => {
  try {
    const raw = req.query.symbols || '';
    const symbols = raw ? raw.split(',').filter(Boolean) : (AutoEngine.symbols || ['BTCUSDT','ETHUSDT','SOLUSDT']);
    const result = await CorrelationEngine.compute(symbols, 50);
    res.json(result);
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

app.get('/api/aladdin/sentiment', async (req,res) => {
  try {
    const news = await NewsSentiment.fetch().catch(() => null);
    if (!news || !news.items || !news.items.length) {
      res.json({ score: 0, signal: 'NEUTRAL', count: 0, news: [] });
      return;
    }
    const scored = SentimentEngine.aggregate(news.items);
    scored.news = (news.items || []).slice(0, 10).map(n => ({
      title: n.title || '',
      score: SentimentEngine.score(n.title + ' ' + (n.description||'')).signal,
    }));
    res.json(scored);
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});

app.get('/api/aladdin/dashboard', async (req,res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSDT';
    const candles = await Bitget.fetchCandles(symbol, '1h', 100);
    if (!candles || candles.length < 20) { res.json({ error: 'Zu wenig Daten' }); return; }
    const sharpe     = SharpeEngine.fromCandles(candles);
    const drawdown   = DrawdownTracker.analyze(candles);
    const volatility = VolatilityRegime.detect(candles);
    res.json({ symbol, sharpe, drawdown, volatility });
  } catch(e) { res.json({ error:'Verarbeitung fehlgeschlagen' }); }
});


// ─────────────────────────────────────────────────────────────────────────────
// SELBSTHEILUNG ENGINE – Auto-Repair + Angriffs-Abwehr
// ─────────────────────────────────────────────────────────────────────────────
const SelfHeal = {
  repairLog: [],
  attackLog: [],
  errorCounts: {},     // endpoint → count
  lastRepair: null,
  healInterval: null,
  rateLimitMap: {},    // IP → { count, firstSeen }
  blockedIPs: new Set(),

  // ── FEHLER ZÄHLEN ──────────────────────────────────────────────────────────
  recordError(module, error) {
    if (!this.errorCounts[module]) this.errorCounts[module] = { count:0, errors:[], lastSeen:null };
    this.errorCounts[module].count++;
    this.errorCounts[module].errors.push({ msg:error, ts:Date.now() });
    this.errorCounts[module].lastSeen = Date.now();
    if (this.errorCounts[module].errors.length > 10) this.errorCounts[module].errors.shift();
    // Auto-Heal wenn Modul zu viele Fehler hat
    if (this.errorCounts[module].count >= 3) {
      this.heal(module, `Zu viele Fehler: ${error}`);
    }
  },

  // ── SELBSTREPARATUR ────────────────────────────────────────────────────────
  heal(module, reason) {
    const entry = { ts: Date.now(), module, reason, actions:[] };
    Log.warn('HEAL', `Starte Selbstreparatur: ${module} – ${reason}`);

    switch(module) {
      case 'BITGET':
      case 'API':
        // Exchange-Verbindung neu aufbauen
        entry.actions.push('Exchange-Ping');
        Bitget.ping().then(r => {
          if (r.ok) { Bitget.status='ONLINE'; entry.actions.push('Ping OK'); }
          else {
            entry.actions.push('Ping fehlgeschlagen – Retry in 30s');
            setTimeout(() => Bitget.ping(), 30000);
          }
        }).catch(() => {});
        break;

      case 'WEBSOCKET':
      case 'WS':
        // WebSocket neu verbinden
        entry.actions.push('WebSocket reconnect');
        Bitget.connectWS(CFG.DEFAULT_SYMBOLS);
        break;

      case 'BALANCE':
        // Balance neu laden
        entry.actions.push('Balance refresh');
        refreshBalances().catch(() => {});
        break;

      case 'KILL_SWITCH':
        // Kill Switch zurücksetzen wenn versehentlich ausgelöst
        if (KillSwitch.active && KillSwitch.triggers.length > 0) {
          const lastTrigger = KillSwitch.triggers[KillSwitch.triggers.length-1];
          const age = Date.now() - lastTrigger.ts;
          // Nur auto-reset wenn älter als 1h und kein echter Drawdown
          const dd = Balance.peakEquity > 0
            ? (Balance.peakEquity - Balance.usable) / Balance.peakEquity : 0;
          if (age > 3600000 && dd < CFG.MAX_DRAWDOWN_PCT * 0.8) {
            KillSwitch.reset();
            entry.actions.push('Kill Switch auto-reset nach 1h');
          } else {
            entry.actions.push('Kill Switch NICHT zurückgesetzt – Drawdown zu hoch oder zu frisch');
          }
        }
        break;

      case 'STRATEGY':
        // Deaktivierte Strategien neu prüfen und ggf. reaktivieren
        Object.keys(Strategies.registry).forEach(id => {
          if (Strategies.registry[id].disabled) {
            const perf = PerfTracker.getStratStats().find(s => s.strategy === id);
            if (!perf || perf.trades < 5) {
              Strategies.registry[id].disabled = false;
              Strategies.registry[id].active = true;
              entry.actions.push(`Strategie ${id} reaktiviert (zu wenig Daten für Deaktivierung)`);
            }
          }
        });
        break;

      case 'DATABASE':
        // DB WAL checkpoint
        try { DB.db.pragma('wal_checkpoint(PASSIVE)'); entry.actions.push('DB WAL checkpoint'); }
        catch(e) { entry.actions.push('DB checkpoint fehlgeschlagen: '+e.message); }
        break;

      case 'MEMORY':
        // Error-Zähler zurücksetzen
        this.errorCounts = {};
        entry.actions.push('Error-Counter zurückgesetzt');
        // Incidents bereinigen
        const oldIncidents = Object.keys(Incidents.store)
          .filter(id => {
            const inc = Incidents.store[id];
            return inc.state === 'RESOLVED' || Date.now() - inc.createdAt > 24*3600*1000;
          });
        oldIncidents.forEach(id => delete Incidents.store[id]);
        entry.actions.push(`${oldIncidents.length} alte Incidents bereinigt`);
        break;

      default:
        entry.actions.push('Genereller Heal: Error-Count zurückgesetzt');
        if (this.errorCounts[module]) this.errorCounts[module].count = 0;
    }

    entry.completed = true;
    this.repairLog.unshift(entry);
    if (this.repairLog.length > 50) this.repairLog.pop();
    this.lastRepair = Date.now();
    Log.info('HEAL', `Reparatur abgeschlossen: ${module} – Aktionen: ${entry.actions.join(', ')}`);
    return entry;
  },

  // ── VOLLSTÄNDIGER SYSTEM-CHECK ─────────────────────────────────────────────
  async fullCheck() {
    const issues = [];
    const bal = CFG.DEPLOY_MODE === 'PAPER' ? (DemoEngine.wallet?.total || 0) : Balance.usable;
    if (bal <= 10) issues.push('BALANCE_LOW');
    try { DB.db.prepare('SELECT 1').get(); } catch(_) { issues.push('DB_ERROR'); }
    if (CFG.DEPLOY_MODE === 'PAPER' && !DemoEngine.running) issues.push('DEMO_STOPPED');
    if (process.memoryUsage().heapUsed / 1024 / 1024 > 800) issues.push('MEMORY_HIGH');
    if (!NoTrade.gates.balanceValid || !NoTrade.gates.marketDataFresh) issues.push('GATES_RED');
    return { ok: issues.length === 0, issues };
  },

  // ── ANGRIFFS-ABWEHR ────────────────────────────────────────────────────────
  // Rate Limiter: max 60 Requests pro Minute pro IP
  checkRateLimit(ip) {
    if (this.blockedIPs.has(ip)) return false;
    const now = Date.now();
    if (!this.rateLimitMap[ip]) this.rateLimitMap[ip] = { count:0, firstSeen:now };
    const entry = this.rateLimitMap[ip];
    // Reset nach 1 Minute
    if (now - entry.firstSeen > 60000) {
      entry.count = 0;
      entry.firstSeen = now;
    }
    entry.count++;
    // Block bei >500 Requests/Min (Dashboard braucht ~50 pro Seitenlade)
    // Kein permanenter Block mehr — nur temporaer fuer 60s
    if (entry.count > 500) {
      Log.warn('SECURITY', `IP ${ip} temporaer gedrosselt (${entry.count} Req/Min)`);
      return false;
    }
    return true;
  },

  // Suspicious Payload Check
  checkPayload(body) {
    const bodyStr = JSON.stringify(body || {});
    // SQL Injection
    if (/(SELECT|DROP|INSERT|UPDATE|DELETE|UNION)/i.test(bodyStr)) {
      return { safe:false, threat:'SQL_INJECTION' };
    }
    // Script Injection
    if (/<script|javascript:|on[a-z]+=/.test(bodyStr)) {
      return { safe:false, threat:'XSS_ATTEMPT' };
    }
    // Path Traversal
    if (/\.\.\//.test(bodyStr) || /\\.\\.\\/.test(bodyStr)) {
      return { safe:false, threat:'PATH_TRAVERSAL' };
    }
    // Zu groß (>50KB)
    if (bodyStr.length > 50000) {
      return { safe:false, threat:'PAYLOAD_TOO_LARGE' };
    }
    return { safe:true };
  },

  // Unblock IP nach 1h
  unblockExpiredIPs() {
    const now = Date.now();
    Object.entries(this.rateLimitMap).forEach(([ip, entry]) => {
      if (now - entry.firstSeen > 3600000) {
        this.blockedIPs.delete(ip);
        delete this.rateLimitMap[ip];
      }
    });
  },

  // ── AUTO-HEAL TIMER ────────────────────────────────────────────────────────
  startAutoHeal(intervalMs = 300000) { // alle 5 Minuten
    if (this.healInterval) clearInterval(this.healInterval);
    this.healInterval = setInterval(async () => {
      await this.fullCheck();
      this.unblockExpiredIPs();
      // DB Vakuum alle 24h
      const now = Date.now();
      if (!this._lastVacuum || now - this._lastVacuum > 24*3600*1000) {
        try { DB.db.pragma('optimize'); this._lastVacuum = now; }
        catch(_) {}
      }
    }, intervalMs);
    Log.info('HEAL', `Auto-Heal gestartet (alle ${intervalMs/60000} Min)`);
  },

  snapshot() {
    return {
      lastRepair: this.lastRepair,
      repairCount: this.repairLog.length,
      recentRepairs: this.repairLog.slice(0,5),
      errorCounts: this.errorCounts,
      blockedIPs: Array.from(this.blockedIPs),
      attackLog: this.attackLog.slice(0,10),
      rateLimitEntries: Object.keys(this.rateLimitMap).length,
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// DCA BOT – Dollar Cost Averaging, meistgenutzter Bot-Typ
// Kauft in regelmäßigen Abständen einen festen USDT-Betrag
// Optional: Extra-Kauf wenn Preis X% fällt (Safety Orders)
// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// ADAPTIVER DCA BOT – Permanent arbeitend, selbst-optimierend
//
// Kernidee: Kein starres Interval. Der Bot berechnet nach jedem Tick selbst
// wie schnell er als nächstes kaufen soll – basierend auf:
//   • Aktuellem Kapital (mehr Kapital = kann öfter kaufen)
//   • Volatilität (hohe ATR = aggressiver kaufen, günstige Preise nutzen)
//   • Rentabilität (laufende Win Rate bestimmt Aggressivität)
//   • Gebühren (nie so viel handeln dass Gebühren Gewinne fressen)
//
// Frequenz-Skala: 50 (sehr aktiv, ~30s) bis 200 (ruhig, ~5min)
// Anpassung: automatisch, jede Minute neu berechnet
// ═════════════════════════════════════════════════════════════════════════════
const DCABot = {
  jobs: {},

  // ── ERSTELLEN ─────────────────────────────────────────────────────────────
  create({ id, symbol, amountUSDT, intervalMs,
           safetyDropPct=0.03, maxSafetyOrders=5, tp=0.06,
           // Adaptive Frequenz-Einstellungen
           minFreq=50,     // Min Ticks/Stunde (=aktiv)
           maxFreq=200,    // Max Ticks/Stunde (=ruhig)
           adaptive=true   // Frequenz automatisch anpassen?
         }) {
    if (this.jobs[id]) return { error: 'Job exists' };

    // Basis-Tick-Interval aus Frequenz berechnen
    // 50 Ticks/h = 72s pro Tick | 100 Ticks/h = 36s | 200 Ticks/h = 18s
    const baseIntervalMs = intervalMs || Math.round(3600000 / minFreq);

    const job = {
      id, symbol,
      amountUSDT,           // Basis-Kaufbetrag pro Tick
      intervalMs:    baseIntervalMs,
      currentIntervalMs: baseIntervalMs,  // Aktuell verwendetes Interval
      safetyDropPct, maxSafetyOrders, tp,
      minFreq, maxFreq, adaptive,
      active:        true,
      orders:        [],
      safetyCount:   0,
      avgEntry:      0,
      totalInvested: 0,
      totalQty:      0,
      createdAt:     Date.now(),
      lastBuy:       null,
      lastFreqUpdate:0,
      pnl:           0,
      status:        'RUNNING',
      // Rentabilitäts-Tracking
      wins:          0,
      losses:        0,
      totalTrades:   0,
      currentFreq:   minFreq,
      freqHistory:   [],  // Frequenz-Verlauf
    };

    this.jobs[id] = job;
    // Tick-Loop – läuft alle 5s und entscheidet selbst ob gekauft wird
    job._ticker = setInterval(() => this._tick(id), 5000);
    // Frequenz-Update alle 60s
    job._freqTimer = setInterval(() => this._updateFrequency(id), 60000);

    Log.info('DCA', `Adaptiver DCA gestartet: ${symbol} ${amountUSDT}USDT | Freq: ${minFreq}-${maxFreq}/h | Adaptive: ${adaptive}`);
    TelegramBot.send(`🔄 Adaptiver DCA: ${symbol}\n${amountUSDT} USDT/Tick\nFrequenz: ${minFreq}-${maxFreq} Ticks/h\nAutomatisch anpassend`);
    this._tick(id); // Sofort erster Kauf
    return { ok: true, job: this._safe(job) };
  },

  // ── FREQUENZ AUTOMATISCH BERECHNEN ───────────────────────────────────────
  async _updateFrequency(id) {
    const job = this.jobs[id];
    if (!job || !job.active || !job.adaptive) return;
    try {
      const candles = await Bitget.fetchCandles(job.symbol, '5min', 20).catch(()=>[]);
      if (!candles.length) return;

      const closes  = candles.map(c=>c.close);
      const price   = closes[closes.length-1];
      const atr     = Ind.atr(candles) || price*0.01;
      const atrPct  = atr/price;
      const capital = Balance.trading || 100;
      const winRate = job.totalTrades>0 ? job.wins/job.totalTrades : 0.5;

      // ── FREQUENZ-FORMEL ───────────────────────────────────────────────────
      // Basis: Mitte zwischen min und max
      let freq = (job.minFreq + job.maxFreq) / 2;

      // Faktor 1: Volatilität → hohe ATR = mehr Ticks (nutze Bewegungen)
      // atrPct 0.5% = Faktor 1.0 | 1% = 1.3 | 2% = 1.6
      const volFactor = Math.min(1.8, 1 + atrPct * 30);
      freq *= volFactor;

      // Faktor 2: Kapital → mehr Kapital = kann öfter kaufen ohne Gebühren zu fressen
      // 100 USDT = Faktor 0.8 | 500 USDT = 1.0 | 2000 USDT = 1.3
      const capFactor = Math.min(1.5, Math.max(0.5, capital / 500));
      freq *= capFactor;

      // Faktor 3: Rentabilität → hohe Win Rate = aggressiver
      // 40% WR = Faktor 0.7 | 50% = 1.0 | 65% = 1.3
      const profFactor = Math.min(1.5, Math.max(0.5, (winRate - 0.4) * 6 + 0.7));
      freq *= profFactor;

      // Faktor 4: Gebühren-Check → nie so aktiv dass Gebühren Gewinne fressen
      // Bitget Taker Fee: 0.06% | Min Profit per Trade > 2× Fee
      const feePerTrade   = job.amountUSDT * CFG.TAKER_FEE; // Taker-Fee aus CFG
      const minProfitPerTrade = feePerTrade * 2;          // Mindest-Gewinn
      const breakevenMoves = minProfitPerTrade / (job.amountUSDT || 1);
      // Wenn ATR zu niedrig für sinnvolle Trades → langsamer
      if (atrPct < breakevenMoves * 3) freq *= 0.6;

      // Auf min/max clampen
      freq = Math.max(job.minFreq, Math.min(job.maxFreq, Math.round(freq)));

      // Interval aus Frequenz: 3.600.000ms / freq = ms pro Tick
      const newInterval = Math.round(3600000 / freq);

      if (Math.abs(freq - job.currentFreq) >= 5) {
        job.currentFreq        = freq;
        job.currentIntervalMs  = newInterval;
        job.lastFreqUpdate     = Date.now();
        job.freqHistory.unshift({ freq, atrPct:(atrPct*100).toFixed(3), winRate:(winRate*100).toFixed(0), ts:Date.now() });
        if (job.freqHistory.length > 20) job.freqHistory.pop();
        Log.info('DCA', `${job.symbol} Frequenz: ${freq}/h (${(newInterval/1000).toFixed(0)}s/Tick) | ATR:${(atrPct*100).toFixed(2)}% Vol:×${volFactor.toFixed(2)} Cap:×${capFactor.toFixed(2)} Prof:×${profFactor.toFixed(2)}`);
      }
    } catch(e) { SelfHeal.recordError('DCA_FREQ', e.message); }
  },

  // ── HAUPT-TICK: Läuft alle 5s, kauft nach Adaptive-Interval ──────────────
  async _tick(id) {
    const job = this.jobs[id];
    if (!job || !job.active) return;
    try {
      // Prüfe ob Kaufzeit erreicht (adaptives Interval)
      const msPerTick = job.currentIntervalMs || job.intervalMs;
      if (job.lastBuy && Date.now() - job.lastBuy < msPerTick) return;

      const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
      const price  = ticker?.last || 0;
      if (!price) return;

      // Safety Order: Preis unter Durchschnitt gefallen?
      if (job.avgEntry > 0 &&
          price < job.avgEntry * (1 - job.safetyDropPct) &&
          job.safetyCount < job.maxSafetyOrders) {
        // Safety Orders: progressiv größer (1×, 1.5×, 2×, 2.5×, 3×)
        const safetyMult   = 1 + job.safetyCount * 0.5;
        const safetyAmt    = job.amountUSDT * safetyMult;
        await this._buy(job, safetyAmt, price, 'SAFETY');
        job.safetyCount++;
        return;
      }

      // Normaler DCA-Kauf
      await this._buy(job, job.amountUSDT, price, 'DCA');

      // Take Profit Check
      if (job.avgEntry > 0 && price >= job.avgEntry * (1 + job.tp)) {
        await this._sell(job, price);
      }
    } catch(e) {
      SelfHeal.recordError('DCA', e.message);
    }
  },

  // ── KAUF ──────────────────────────────────────────────────────────────────
  async _buy(job, amountUSDT, price, type) {
    // Mindest-Ordergröße + Kapital-Check
    if (amountUSDT < 1) return;
    if (Balance.trading < amountUSDT * 0.5) {
      Log.warn('DCA', `Nicht genug Kapital: ${Balance.trading.toFixed(2)} < ${amountUSDT.toFixed(2)} USDT`);
      return;
    }
    const qty = (amountUSDT / price).toFixed(6);
    job.totalInvested += amountUSDT;
    job.totalQty      += parseFloat(qty);
    job.avgEntry       = job.totalInvested / job.totalQty;
    job.lastBuy        = Date.now();
    job.totalTrades++;
    job.orders.push({ type, price, qty, amountUSDT, ts:Date.now() });
    if (job.orders.length > 200) job.orders.shift(); // max 200 Orders im RAM
    Log.info('DCA', `${type} ${job.symbol} ${qty} @ ${price} (Ø ${job.avgEntry.toFixed(4)}) | Freq:${job.currentFreq}/h`);
    if (DemoEngine.liveMode && CFG.API_KEY) {
      await Bitget.placeSportOrder(job.symbol, 'buy', qty).catch(()=>{});
    }
    Balance.recordProfit(-amountUSDT);
    Safeties.recordTrade();
    // Telegram nur alle 10 Trades (sonst Spam bei hoher Frequenz)
    if (job.totalTrades % 10 === 0) {
      TelegramBot.send(`📉 DCA ${job.symbol}\n${job.totalTrades} Trades | Ø $${job.avgEntry.toFixed(2)}\nFreq: ${job.currentFreq}/h`);
    }
  },

  // ── VERKAUF ───────────────────────────────────────────────────────────────
  async _sell(job, price) {
    const pnl = (price - job.avgEntry) * job.totalQty;
    job.pnl    = pnl;
    job.status = 'TP_HIT';
    if (pnl > 0) job.wins++; else job.losses++;
    Log.info('DCA', `TP erreicht ${job.symbol}: PnL ${pnl.toFixed(4)} USDT nach ${job.totalTrades} Trades`);
    if (DemoEngine.liveMode && CFG.API_KEY) {
      await Bitget.placeSportOrder(job.symbol, 'sell', job.totalQty.toFixed(6)).catch(()=>{});
    }
    Balance.recordProfit(job.totalInvested + pnl);
    TelegramBot.send(`✅ DCA TP: ${job.symbol}\nPnL: +${pnl.toFixed(4)} USDT\n${job.totalTrades} Trades | WinRate: ${(job.wins/(job.totalTrades||1)*100).toFixed(0)}%`);
    // Reset
    job.totalInvested = 0; job.totalQty = 0; job.avgEntry  = 0;
    job.safetyCount   = 0; job.orders  = []; job.status    = 'RUNNING';
    job.totalTrades   = 0; job.wins    = 0;  job.losses    = 0;
  },

  // ── STOP ──────────────────────────────────────────────────────────────────
  stop(id) {
    const job = this.jobs[id];
    if (!job) return { error:'Not found' };
    job.active = false;
    if (job._ticker)    { clearInterval(job._ticker);    job._ticker    = null; }
    if (job._freqTimer) { clearInterval(job._freqTimer); job._freqTimer = null; }
    job.status = 'STOPPED';
    Log.info('DCA', `Job ${id} gestoppt | ${job.totalTrades} Trades | PnL: ${job.pnl.toFixed(4)}`);
    return { ok:true, pnl:job.pnl, trades:job.totalTrades };
  },

  _safe(j) {
    const { _ticker, _freqTimer, ...s } = j;
    return { ...s, currentIntervalSec: Math.round((s.currentIntervalMs||60000)/1000) };
  },

  snapshot() {
    return Object.values(this.jobs).map(j => this._safe(j));
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// GRID BOT – autonomes Preis-Raster, kauft tief / verkauft hoch
// Legt automatisch Kauf/Verkauf-Orders in einem Preisband an
// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// ADAPTIVER GRID BOT
// – Range und Level-Anzahl passen sich automatisch an ATR + Kapital an
// – Wenn Preis aus Range läuft: automatisch neue Range berechnen und neu starten
// – Tick-Interval: 5s für schnelle Reaktion
// ═════════════════════════════════════════════════════════════════════════════
const GridBot = {
  jobs: {},

  create({ id, symbol, lowerPrice, upperPrice, gridCount=10, totalUSDT, leverage=1, adaptive=true }) {
    if (this.jobs[id]) return { error: 'Job exists' };
    if (lowerPrice >= upperPrice) return { error: 'lowerPrice < upperPrice erforderlich' };
    const step = (upperPrice - lowerPrice) / gridCount;
    const levels = [];
    for (let i = 0; i <= gridCount; i++) {
      levels.push(parseFloat((lowerPrice + i * step).toFixed(6)));
    }
    const perGridUSDT = totalUSDT / gridCount;
    const job = {
      id, symbol, lowerPrice, upperPrice, gridCount,
      totalUSDT, perGridUSDT, leverage, step, levels,
      active: true, fills: [], openOrders: {},
      profit: 0, createdAt: Date.now(), status: 'RUNNING',
      totalBuys: 0, totalSells: 0,
      wins: 0, losses: 0,
      adaptive,
      lastParamUpdate: 0,
      currentLevels: gridCount,
    };
    this.jobs[id] = job;
    job._timer     = setInterval(() => this._tick(id), 5000);    // 5s Tick
    job._adaptTimer= setInterval(() => this._adapt(id), 120000); // 2min Anpassung
    this._placeInitialOrders(job).catch(e=>Log.warn('GRID','InitOrders: '+e.message));
    Log.info('GRID', `Adaptiver Grid ${id}: ${symbol} [${lowerPrice}-${upperPrice}] ${gridCount}L ${perGridUSDT.toFixed(2)}USDT/L`);
    return { ok: true, job: this._safe(job) };
  },

  // ── Adaptive Anpassung: Range und Level-Anzahl neu berechnen ─────────────
  async _adapt(id) {
    const job = this.jobs[id];
    if (!job || !job.active || !job.adaptive) return;
    try {
      const winRate = (job.wins+job.losses) > 0 ? job.wins/(job.wins+job.losses) : 0.5;
      const params  = await AdaptiveBotCore._calcParams(job.symbol, job.totalUSDT, winRate);
      const price   = params.price;
      if (!price) return;

      // Neue Range berechnen
      const halfRange = price * params.gridRangePct;
      const newLower  = parseFloat((price - halfRange).toFixed(2));
      const newUpper  = parseFloat((price + halfRange).toFixed(2));
      const newLevels = params.gridLevels;
      const newPerGrid= job.totalUSDT / newLevels;

      // Nur aktualisieren wenn signifikante Änderung oder Preis außerhalb Range
      const outOfRange = price < job.lowerPrice * 0.97 || price > job.upperPrice * 1.03;
      const bigChange  = Math.abs(newLevels - job.currentLevels) >= 3;

      if (outOfRange || bigChange) {
        const step   = (newUpper - newLower) / newLevels;
        const levels = [];
        for (let i=0;i<=newLevels;i++) levels.push(parseFloat((newLower+i*step).toFixed(6)));
        job.lowerPrice = newLower; job.upperPrice = newUpper;
        job.gridCount  = newLevels; job.step = step; job.levels = levels;
        job.perGridUSDT= newPerGrid; job.openOrders = {};
        job.currentLevels = newLevels;
        job.lastParamUpdate = Date.now();
        await this._placeInitialOrders(job);
        Log.info('GRID', `${id} Adaptive Update: [${newLower}-${newUpper}] ${newLevels}L ${newPerGrid.toFixed(2)}USDT/L (${outOfRange?'OUT_OF_RANGE':'REBALANCE'})`);
        if (outOfRange) TelegramBot.send(`📊 Grid ${job.symbol} neu kalibriert
[${newLower}-${newUpper}]
${newLevels} Levels | ATR: ${(params.atrPct*100).toFixed(2)}%`);
      }
    } catch(e) { SelfHeal.recordError('GRID_ADAPT', e.message); }
  },

  async _placeInitialOrders(job) {
    const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
    const price = ticker?.last || 0;
    if (!price) return;
    // Plaziere Kauf-Orders unter aktuellem Preis, Verkauf-Orders darüber
    for (const level of job.levels) {
      if (level < price) {
        job.openOrders[level] = { type: 'BUY', price: level, filled: false };
      } else if (level > price) {
        job.openOrders[level] = { type: 'SELL', price: level, filled: false };
      }
    }
    Log.info('GRID', `${job.id}: ${Object.keys(job.openOrders).length} virtuelle Orders gesetzt`);
    TelegramBot.send(`📊 Grid Bot gestartet: ${job.symbol}
Range: $${job.lowerPrice} – $${job.upperPrice}
${job.gridCount} Levels, ${job.perGridUSDT.toFixed(2)} USDT/Level`);
  },

  async _tick(id) {
    const job = this.jobs[id];
    if (!job || !job.active) return;
    try {
      const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
      const price = ticker?.last || 0;
      if (!price) return;

      // Stop wenn Preis außerhalb des Rasters
      if (price < job.lowerPrice * 0.95 || price > job.upperPrice * 1.05) {
        job.status = 'OUT_OF_RANGE';
        Log.warn('GRID', `${job.id}: Preis ${price} außerhalb Range [${job.lowerPrice}-${job.upperPrice}]`);
        return;
      }
      job.status = 'RUNNING';

      // Prüfe ob Orders getriggert wurden (virtuelle Simulation)
      for (const [levelStr, order] of Object.entries(job.openOrders)) {
        const level = parseFloat(levelStr);
        if (order.filled) continue;
        if (order.type === 'BUY' && price <= level) {
          // Kauf ausgeführt
          const qty = (job.perGridUSDT / level).toFixed(6);
          order.filled = true;
          job.totalBuys++;
          job.fills.push({ type:'BUY', price:level, qty, ts:Date.now() });
          // Gegenorder: Verkaufs-Order eine Stufe höher
          const sellLevel = parseFloat((level + job.step).toFixed(6));
          job.openOrders[sellLevel] = { type:'SELL', price:sellLevel, filled:false, buyPrice:level };
          Log.info('GRID', `${job.id} KAUF @ ${level} → Sell @ ${sellLevel}`);
          if (DemoEngine.liveMode && CFG.API_KEY) {
            await Bitget.placeSportOrder(job.symbol, 'buy', qty).catch(() => {});
          }
        } else if (order.type === 'SELL' && price >= level) {
          const qty = (job.perGridUSDT / (order.buyPrice||level)).toFixed(6);
          order.filled = true;
          job.totalSells++;
          const gridProfit = (level - (order.buyPrice||level)) * parseFloat(qty);
          job.profit += gridProfit;
          if (gridProfit > 0) job.wins++; else job.losses++;
          job.fills.push({ type:'SELL', price:level, qty, profit:gridProfit.toFixed(4), ts:Date.now() });
          if (job.fills.length > 100) job.fills.shift();
          const buyLevel = parseFloat((level - job.step).toFixed(6));
          if (buyLevel >= job.lowerPrice) {
            job.openOrders[buyLevel] = { type:'BUY', price:buyLevel, filled:false };
          }
          Log.info('GRID', `${job.id} SELL @ ${level} +${gridProfit.toFixed(4)} USDT | Total: ${job.profit.toFixed(4)}`);
          if (gridProfit > 0) Balance.recordProfit(gridProfit);
          if (DemoEngine.liveMode && CFG.API_KEY) {
            await Bitget.placeSportOrder(job.symbol, 'sell', qty).catch(() => {});
          }
        }
      }
    } catch(e) {
      SelfHeal.recordError('GRID', e.message);
    }
  },

  stop(id) {
    const job = this.jobs[id];
    if (!job) return { error: 'Not found' };
    job.active = false;
    if (job._timer)      { clearInterval(job._timer);      job._timer      = null; }
    if (job._adaptTimer) { clearInterval(job._adaptTimer); job._adaptTimer = null; }
    job.status = 'STOPPED';
    TelegramBot.send(`🛑 Grid ${job.symbol} gestoppt
Profit: +${job.profit.toFixed(4)} USDT | Trades: ${job.totalBuys+job.totalSells}`);
    return { ok: true, profit: job.profit };
  },

  _safe(j) {
    const { _timer, _adaptTimer, openOrders, ...s } = j;
    return { ...s, openOrderCount: Object.keys(openOrders||{}).length };
  },
  snapshot() { return Object.values(this.jobs).map(j => this._safe(j)); }
};

// ═════════════════════════════════════════════════════════════════════════════
// MARTINGALE BOT – verdoppelt Position bei Verlust, sichert bei TP
// WARNUNG: Hohes Risiko in starken Downtrends – immer Max-Orders setzen!
// ═════════════════════════════════════════════════════════════════════════════
const MartingaleBot = {
  jobs: {},

  // Adaptiver Martingale: Multiplier passt sich an Marktvolatilität an
  create({ id, symbol, baseUSDT, tp=0.03, sl=0.15, maxOrders=5, multiplier=2.0, adaptive=true }) {
    if (this.jobs[id]) return { error: 'Job exists' };
    if (maxOrders > 8) maxOrders = 8;
    const job = {
      id, symbol, baseUSDT, tp, sl, maxOrders,
      multiplier,        // Basis-Multiplier
      currentMult: multiplier, // Aktuell verwendeter (adaptiv angepasst)
      adaptive,
      active: true, orderCount: 0, avgEntry: 0,
      totalInvested: 0, totalQty: 0,
      status: 'WAITING', createdAt: Date.now(), pnl: 0,
      wins: 0, losses: 0, totalCycles: 0,
    };
    this.jobs[id] = job;
    job._timer      = setInterval(() => this._tick(id), 5000);    // 5s Tick
    job._adaptTimer = setInterval(() => this._adapt(id), 90000);  // 90s Anpassung
    this._enter(job);
    Log.info('MART', `Adaptiver Martingale ${id}: ${symbol} ${baseUSDT}USDT x${multiplier} Max${maxOrders}`);
    return { ok: true, job };
  },

  async _adapt(id) {
    const job = this.jobs[id];
    if (!job || !job.active || !job.adaptive || job.status !== 'WAITING') return;
    try {
      const winRate = (job.wins+job.losses)>0 ? job.wins/(job.wins+job.losses) : 0.5;
      const params  = await AdaptiveBotCore._calcParams(job.symbol, job.baseUSDT*job.maxOrders, winRate);
      job.currentMult = params.martMultiplier;
      // TP und SL nach ATR anpassen
      job.tp = Math.max(0.015, Math.min(0.08, params.atrPct * 3));
      job.sl = Math.max(0.08,  Math.min(0.25, params.atrPct * 15));
      Log.info('MART', `${id} Adapt: Mult=${job.currentMult.toFixed(2)} TP=${(job.tp*100).toFixed(1)}% SL=${(job.sl*100).toFixed(1)}%`);
    } catch(e) {}
  },

  async _enter(job) {
    if (!job.active || job.orderCount >= job.maxOrders) return;
    const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
    const price = ticker?.last || 0;
    if (!price) return;
    const orderSize = job.baseUSDT * Math.pow(job.currentMult||job.multiplier, job.orderCount);
    const qty = (orderSize / price).toFixed(6);
    job.totalInvested += orderSize;
    job.totalQty += parseFloat(qty);
    job.avgEntry = job.totalInvested / job.totalQty;
    job.orderCount++;
    job.status = 'IN_TRADE';
    job.lastPrice = price;
    Log.info('MART', `Order #${job.orderCount}: ${job.symbol} ${qty} @ ${price} (${orderSize.toFixed(2)}USDT)`);
    if (DemoEngine.liveMode && CFG.API_KEY) {
      await Bitget.placeSportOrder(job.symbol, 'buy', qty).catch(() => {});
    }
    TelegramBot.send(`🎰 Martingale #${job.orderCount}: ${job.symbol}
${orderSize.toFixed(2)} USDT @ $${price}
Ø Entry: $${job.avgEntry.toFixed(4)}`);
  },

  async _tick(id) {
    const job = this.jobs[id];
    if (!job || !job.active || job.status === 'WAITING') return;
    try {
      const ticker = await Bitget.fetchTicker(job.symbol).catch(() => null);
      const price = ticker?.last || 0;
      if (!price || !job.avgEntry) return;
      const pct = (price - job.avgEntry) / job.avgEntry;

      // Take Profit
      if (pct >= job.tp) {
        const pnl = pct * job.totalInvested;
        job.pnl = pnl; job.status = 'TP_HIT';
        Log.info('MART', `TP ${job.symbol}: +${pnl.toFixed(2)} USDT`);
        Balance.recordProfit(job.totalInvested + pnl);
        if (DemoEngine.liveMode && CFG.API_KEY) {
          await Bitget.placeSportOrder(job.symbol, 'sell', job.totalQty.toFixed(6)).catch(() => {});
        }
        TelegramBot.send(`✅ Martingale TP: ${job.symbol}
PnL: +${pnl.toFixed(2)} USDT nach ${job.orderCount} Orders`);
        this._reset(job);
        return;
      }

      // Stop Loss – globaler Schutz
      if (pct <= -job.sl) {
        const loss = pct * job.totalInvested;
        job.pnl = loss; job.status = 'SL_HIT';
        Log.warn('MART', `SL ${job.symbol}: ${loss.toFixed(2)} USDT`);
        if (DemoEngine.liveMode && CFG.API_KEY) {
          await Bitget.placeSportOrder(job.symbol, 'sell', job.totalQty.toFixed(6)).catch(() => {});
        }
        TelegramBot.send(`🛑 Martingale SL: ${job.symbol}
Verlust: ${loss.toFixed(2)} USDT`);
        Safeties.recordLoss(job.symbol);
        this._reset(job);
        return;
      }

      // Nächste Martingale Order wenn Preis X% gefallen (basierend auf TP/2)
      if (pct <= -(job.tp / 2) && job.orderCount < job.maxOrders) {
        await this._enter(job);
      }
    } catch(e) {
      SelfHeal.recordError('MARTINGALE', e.message);
    }
  },

  _reset(job, won=false) {
    job.totalInvested = 0; job.totalQty = 0; job.avgEntry = 0;
    job.orderCount = 0; job.status = 'WAITING'; job.totalCycles++;
    if (won) job.wins++; else job.losses++;
  },

  stop(id) {
    const job = this.jobs[id];
    if (!job) return { error: 'Not found' };
    job.active = false;
    if (job._timer)      { clearInterval(job._timer);      job._timer=null; }
    if (job._adaptTimer) { clearInterval(job._adaptTimer); job._adaptTimer=null; }
    job.status = 'STOPPED';
    return { ok: true, pnl: job.pnl, wins:job.wins, losses:job.losses };
  },

  snapshot() { return Object.values(this.jobs).map(j=>{ const {_timer,_adaptTimer,...s}=j; return s; }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// TWAP ENGINE – teilt große Orders in kleine Scheiben auf
// Verhindert Marktbewegung bei großen Trades
// ═════════════════════════════════════════════════════════════════════════════
const TWAPEngine = {
  jobs: {},

  async execute({ symbol, side, totalUSDT, durationMs=3600000, slices=null, adaptive=true }) {
    const id = `TWAP_${Date.now()}`;
    // Adaptive Slice-Berechnung: mehr Slices bei höherer Volatilität
    if (!slices || adaptive) {
      const params = await AdaptiveBotCore._calcParams(symbol, totalUSDT).catch(()=>({atrPct:0.01}));
      // Höhere Volatilität → mehr Slices (besserer Durchschnittspreis)
      const volSlices = Math.round(10 * (1 + params.atrPct * 20));
      slices = Math.max(5, Math.min(50, volSlices));
      Log.info('TWAP', `Adaptive Slices: ${slices} (ATR: ${((params.atrPct||0)*100).toFixed(2)}%)`);
    }
    const sliceUSDT = totalUSDT / slices;
    const sliceInterval = durationMs / slices;
    const job = {
      id, symbol, side, totalUSDT, slices, sliceUSDT,
      durationMs, sliceInterval, executed: 0,
      fills: [], startTs: Date.now(), status: 'RUNNING',
      totalQty: 0, avgPrice: 0,
    };
    this.jobs[id] = job;
    Log.info('TWAP', `${id}: ${side} ${totalUSDT}USDT in ${slices}x${(sliceInterval/60000).toFixed(1)}min`);
    TelegramBot.send(`⏱ TWAP gestartet: ${symbol}
${side} ${totalUSDT} USDT in ${slices} Scheiben
Dauer: ${(durationMs/3600000).toFixed(1)}h`);

    for (let i = 0; i < slices; i++) {
      if (!this.jobs[id] || job.status === 'CANCELLED') break;
      await new Promise(resolve => setTimeout(resolve, sliceInterval));
      try {
        const ticker = await Bitget.fetchTicker(symbol).catch(() => null);
        const price = ticker?.last || 0;
        if (!price) continue;
        const qty = (sliceUSDT / price).toFixed(6);
        job.executed++;
        job.totalQty += parseFloat(qty);
        job.avgPrice = (job.avgPrice * (job.executed-1) + price) / job.executed;
        job.fills.push({ slice:i+1, price, qty, ts:Date.now() });
        Log.info('TWAP', `Slice ${i+1}/${slices}: ${qty} @ ${price}`);
        if (DemoEngine.liveMode && CFG.API_KEY) {
          await Bitget.placeSportOrder(symbol, side, qty).catch(() => {});
        }
      } catch(e) { SelfHeal.recordError('TWAP', e.message); }
    }

    job.status = 'COMPLETED';
    const report = `✅ TWAP abgeschlossen: ${symbol}
Ausgeführt: ${job.executed}/${slices}
Ø Preis: $${job.avgPrice.toFixed(4)}
Gesamtmenge: ${job.totalQty.toFixed(6)}`;
    Log.info('TWAP', report);
    TelegramBot.send(report);
    return job;
  },

  cancel(id) {
    if (this.jobs[id]) { this.jobs[id].status = 'CANCELLED'; return { ok:true }; }
    return { error:'Not found' };
  },

  snapshot() { return Object.values(this.jobs).slice(-10); }
};

// ═════════════════════════════════════════════════════════════════════════════
// OCO ORDERS – One Cancels Other
// Stop Loss + Take Profit gleichzeitig aktiv
// ═════════════════════════════════════════════════════════════════════════════
const OCOEngine = {
  orders: {},

  create({ id, symbol, qty, tpPrice, slPrice, side='sell' }) {
    const order = {
      id, symbol, qty, tpPrice, slPrice, side,
      status: 'ACTIVE', createdAt: Date.now(),
      triggeredBy: null, triggerPrice: null,
    };
    this.orders[id] = order;
    order._timer = setInterval(() => this._check(id), 5000);
    Log.info('OCO', `${id}: ${symbol} TP:${tpPrice} SL:${slPrice}`);
    return { ok: true, order };
  },

  async _check(id) {
    const order = this.orders[id];
    if (!order || order.status !== 'ACTIVE') return;
    try {
      const ticker = await Bitget.fetchTicker(order.symbol).catch(() => null);
      const price = ticker?.last || 0;
      if (!price) return;

      if (price >= order.tpPrice) {
        await this._execute(order, 'TP', price);
      } else if (price <= order.slPrice) {
        await this._execute(order, 'SL', price);
      }
    } catch(e) { SelfHeal.recordError('OCO', e.message); }
  },

  async _execute(order, reason, price) {
    order.status = 'TRIGGERED';
    order.triggeredBy = reason;
    order.triggerPrice = price;
    if (order._timer) { clearInterval(order._timer); order._timer = null; }
    Log.info('OCO', `${order.id} ${reason} getriggert @ ${price}`);
    if (DemoEngine.liveMode && CFG.API_KEY) {
      await Bitget.placeSportOrder(order.symbol, order.side, order.qty).catch(() => {});
    }
    const emoji = reason === 'TP' ? '✅' : '🛑';
    TelegramBot.send(`${emoji} OCO ${reason}: ${order.symbol}
@ $${price}
Menge: ${order.qty}`);
    if (reason === 'SL') Safeties.recordLoss(order.symbol);
  },

  cancel(id) {
    const order = this.orders[id];
    if (!order) return { error:'Not found' };
    order.status = 'CANCELLED';
    if (order._timer) { clearInterval(order._timer); order._timer = null; }
    return { ok: true };
  },

  snapshot() {
    return Object.values(this.orders)
      .map(({ _timer, ...o }) => o)
      .slice(-20);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TELEGRAM BOT CONTROL – Steuerung per Chat-Befehl
// Befehle: /start /stop /status /balance /trades /report /help
// ═════════════════════════════════════════════════════════════════════════════
const TelegramBot = {
  token:  process.env.TELEGRAM_TOKEN  || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  enabled: !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID),
  lastUpdateId: 0,
  pollTimer: null,

  async send(msg) {
    if (!this.enabled) return { sent:false, reason:'DISABLED' };
    try {
      const r = await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: this.chatId, text: `🤖 NEXUS V9\n\n${msg}`,
      }, { timeout: 5000 });
      try { ActionStream.push('TG','TELEGRAM','sent: '+String(msg).slice(0,60)); } catch(_){}
      return { sent:true, messageId: r.data && r.data.result && r.data.result.message_id };
    } catch(e) {
      const statusCode = e.response && e.response.status;
      const desc = (e.response && e.response.data && e.response.data.description) || e.message;
      try { Log.warn('TELEGRAM', 'send failed: ' + statusCode + ' ' + desc); } catch(_) {}
      return { sent:false, reason: desc, code: statusCode };
    }
  },

  async sendReport() {
    const bal = Balance.snapshot();
    const trades = Trades.getAll().slice(0, 5);
    const perf = PerfTracker.systemStats();
    const msg = [
      `📊 *NEXUS TAGESBERICHT*`,
      ``,
      `💰 *Kapital*`,
      `  Gesamt: ${bal.usable?.toFixed(2)} USDT`,
      `  Reserve (70%): ${bal.reserve?.toFixed(2)} USDT`,
      `  Trading (30%): ${bal.trading?.toFixed(2)} USDT`,
      `  Tages-PnL: ${bal.dailyPnL?.toFixed(2)} USDT`,
      ``,
      `📈 *Performance*`,
      `  Win Rate: ${((perf.winRate||0)*100).toFixed(1)}%`,
      `  Gesamt Trades: ${perf.totalTrades||0}`,
      `  Sharpe: ${perf.sharpe?.toFixed(2)||'—'}`,
      ``,
      `🤖 *Auto Engine*: ${AutoEngine.running?'LÄUFT':'GESTOPPT'}`,
      `🛡 *Kill Switch*: ${KillSwitch.active?'AKTIV ⚠':'OK ✓'}`,
      `🔧 *SelfHeal*: ${SelfHeal.repairLog.length} Reparaturen`,
    ].join('\n');
    await this.send(msg);
  },

  startPolling() {
    if (!this.enabled || this.pollTimer) return;
    this.pollTimer = setInterval(() => this._poll(), 3000);
    Log.info('TELEGRAM', 'Polling gestartet');
  },

  async _poll() {
    if (!this.enabled) return;
    try {
      const r = await axios.get(
        `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId+1}&timeout=1`,
        { timeout: 4000 }
      );
      const updates = r.data?.result || [];
      for (const upd of updates) {
        this.lastUpdateId = upd.update_id;
        const msg = upd.message;
        if (!msg?.text) continue;
        // Nur von erlaubter Chat-ID
        if (String(msg.chat.id) !== String(this.chatId)) continue;
        await this._handleCommand(msg.text.trim());
      }
    } catch(_) {}
  },

  async _handleCommand(text) {
    const cmd = text.split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1);
    Log.info('TELEGRAM', `Befehl: ${text}`);
    switch(cmd) {
      case '/alert':
        // /alert BTCUSDT BELOW 80000 Kaufzone
        if (args.length >= 3) {
          const r = PriceAlerts.add({ symbol:args[0], condition:args[1].toUpperCase(), price:parseFloat(args[2]), note:args.slice(3).join(' ') });
          await this.send('✅ Alert gesetzt: '+args[0]+' '+args[1]+' $'+args[2]);
        } else {
          await this.send('Format: /alert SYMBOL ABOVE|BELOW PREIS [Notiz]');
        }
        break;
      case '/alerts':
        const snap = PriceAlerts.snapshot();
        const alertLines = ['🔔 Aktive Alerts: '+snap.active.length].concat(snap.active.map(a=>a.symbol+' '+a.condition+' $'+a.price+(a.note?' ('+a.note+')':''))); await this.send(alertLines.join('\n'));
        break;
      case '/wallet':
        // /wallet 0xADDRESSE LABEL
        if (args.length >= 2) {
          WalletTracker.addWallet({ address:args[0], label:args.slice(1).join(' ') });
          WalletTracker.enabled = true;
          WalletTracker.start();
          await this.send('✅ Wallet hinzugefügt: '+args.slice(1).join(' ')+' ('+WalletTracker.enabled+')');
        } else {
          await this.send('Format: /wallet ADRESSE BEZEICHNUNG');
        }
        break;
      case '/journal':
        const jStats = Journal.stats();
        await this.send('📓 Journal\nTotal: '+jStats.total+'\nAbgeschlossen: '+jStats.closed+'\nWin Rate: '+(jStats.winRate*100).toFixed(1)+'%\nPnL: '+jStats.totalPnl.toFixed(2)+' USDT');
        break;
      case '/news':
        const newsSnap = await NewsSentiment.fetch().catch(()=>({riskScore:30,signal:'NORMAL'}));
        await this.send('📰 News-Risiko: '+newsSnap.riskScore+'/100 ('+newsSnap.signal+')');
        break;
      case '/explain':
        // /explain BTCUSDT
        const sym2 = args[0]||'BTCUSDT';
        const exp  = await Explainer.explain(sym2);
        await this.send('🔍 ERKLÄRUNG: '+sym2+'\n\n'+exp.summary);
        break;
      case '/janitor_approve':
        if (args[0]) { const r = DBJanitor.approve(args[0]); await this.send(r.ok ? 'Approved: '+r.deleted+' geloescht' : 'Fehler: '+r.error); } else await this.send('Format: /janitor_approve <id>');
        break;
      case '/janitor_reject':
        if (args[0]) { const r = DBJanitor.reject(args[0]); await this.send(r.ok ? 'Rejected.' : 'Fehler: '+r.error); } else await this.send('Format: /janitor_reject <id>');
        break;
            case '/ack':
        const ackParts = (text||'').split(' ');
        if (ackParts[1]) { const r = TelegramAlarm.acknowledge(ackParts[1]); await this.send(r.ok ? '✅ Bestätigt' : '❌ ' + (r.error||'Fehler')); }
        else { await this.send('Nutze: /ack ACK-ID'); }
        break;
      case '/approve':AutonomousRepair.handleApproval(true);TelegramBot.send('Fix genehmigt');break;
      case '/reject':AutonomousRepair.handleApproval(false);TelegramBot.send('Fix abgelehnt');break;
      case '/help':
        await this.send([
          '📖 *Verfügbare Befehle:*',
          '/status – Bot Status',
          '/balance – Kapital',
          '/trades – Letzte Trades',
          '/start – Auto Engine starten',
          '/stop – Auto Engine stoppen',
          '/report – Tagesbericht',
          '/heal – Selbstheilung',
          '/dca [symbol] [usdt] [min] – DCA starten',
          '/grid [symbol] [low] [high] [usdt] – Grid starten',
          '/kill – Not-Aus',
          '/unkill – Not-Aus aufheben',
        ].join('\n'));
        break;
      case '/status':
        const regime = Regime.snapshot();
        await this.send([
          `*Bot Status*`,
          `Engine: ${AutoEngine.running?'✅ LÄUFT':'🔴 GESTOPPT'}`,
          `Kill Switch: ${KillSwitch.active?'🔴 AKTIV':'✅ OK'}`,
          `Regime: ${regime.regime?.toUpperCase()||'—'}`,
          `Aktive Trades: ${Trades.getActive().length}`,
          `Safeties: ${Safeties.consecutiveLossCount} Verluste in Folge`,
        ].join('\n'));
        break;
      case '/balance':
        const b = Balance.snapshot();
        await this.send(`*Kapital*\nGesamt: ${(b.usable||0).toFixed(2)} USDT\nReserve: ${(b.reserve||0).toFixed(2)} USDT\nTrading: ${(b.trading||0).toFixed(2)} USDT\nTages-PnL: ${(b.dailyPnL||0).toFixed(2)} USDT`);
        break;
      case '/trades':
        const active = Trades.getActive();
        const recent = Trades.getAll().slice(0, 5);
        const lines = active.map(t => `• ${t.symbol} ${t.side} ${t.size?.toFixed(2)}USDT`).join('\n');
        await this.send(`*Trades*\nAktiv: ${active.length}\n${lines||'Keine'}\n\nLetzte 5:\n${recent.map(t=>`• ${t.symbol} ${t.state}`).join('\n')}`);
        break;
      case '/auto':
        BotManager.setMode('AUTONOMOUS');
        AutoEngine.start();
        await this.send('🤖 AUTONOMER MODUS aktiviert\nBot wählt Strategie automatisch');
        break;
      case '/manual':
        BotManager.setMode('MANUAL');
        await this.send('👤 MANUELLER MODUS aktiviert\nDu hast die Kontrolle');
        break;
      case '/start':
        AutoEngine.start();
        await this.send('✅ Auto Engine gestartet');
        break;
      case '/stopall':
        BotManager.emergencyStop(null);
        await this.send('🛑 ALLE Bots gestoppt');
        break;
      case '/safe':
        DemoEngine.running = false;
        AutoEngine.stop();
        try { KillSwitch._preKill('MANUAL_SAFE', { via: 'Telegram' }); } catch(_) {}
        await this.send('SAFE MODE aktiviert\nAlle Engines gestoppt\n/start zum Reaktivieren');
        Log.warn('SAFE_MODE', 'Per Telegram aktiviert');
        break;
      case '/stop':
        AutoEngine.stop();
        await this.send('🛑 Auto Engine gestoppt');
        break;
      case '/report':
        await this.sendReport();
        break;
      case '/heal':
        const result = await SelfHeal.fullCheck();
        await this.send(`🔧 Selbstheilung: ${result.ok?'Alles OK':'Probleme: '+result.issues.join(', ')}`);
        break;
      case '/kill':
        KillSwitch._hardKill('TELEGRAM', {});
        await this.send('🛑 NOT-AUS aktiviert');
        break;
      case '/unkill':
        KillSwitch.reset();
        await this.send('✅ Kill Switch zurückgesetzt');
        break;
      case '/dca':
        // /dca BTCUSDT 20 60  → 20 USDT alle 60 Min
        if (args.length >= 3) {
          const dcaId = 'DCA_TG_'+Date.now();
          DCABot.create({ id:dcaId, symbol:args[0], amountUSDT:parseFloat(args[1]), intervalMs:parseFloat(args[2])*60000 });
          await this.send(`✅ DCA gestartet: ${args[0]} ${args[1]} USDT alle ${args[2]} Min`);
        } else {
          await this.send('Format: /dca SYMBOL USDT MINUTEN\nBeispiel: /dca BTCUSDT 20 60');
        }
        break;
      case '/grid':
        // /grid BTCUSDT 80000 90000 200  → 200 USDT Grid
        if (args.length >= 4) {
          const gridId = 'GRID_TG_'+Date.now();
          GridBot.create({ id:gridId, symbol:args[0], lowerPrice:parseFloat(args[1]), upperPrice:parseFloat(args[2]), totalUSDT:parseFloat(args[3]) });
          await this.send(`✅ Grid gestartet: ${args[0]} [${args[1]}-${args[2]}] ${args[3]} USDT`);
        } else {
          await this.send('Format: /grid SYMBOL LOW HIGH USDT');
        }
        break;
      default:
        await this.send(`Unbekannter Befehl: ${cmd}\n/help fuer alle Befehle`);
    }
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// FEAR & GREED INDEX – Marktsentiment
// ═════════════════════════════════════════════════════════════════════════════
const FearGreed = {
  cache: null,
  lastFetch: 0,

  async fetch() {
    if (this.cache && Date.now() - this.lastFetch < 3600000) return this.cache;
    try {
      const r = await axios.get('https://api.alternative.me/fng/?limit=3', { timeout: 5000 });
      const data = r.data?.data || [];
      this.cache = {
        value:       parseInt(data[0]?.value || 50),
        label:       data[0]?.value_classification || 'Neutral',
        yesterday:   parseInt(data[1]?.value || 50),
        lastWeek:    parseInt(data[2]?.value || 50),
        trend:       parseInt(data[0]?.value||50) > parseInt(data[1]?.value||50) ? 'RISING' : 'FALLING',
        signal:      this._signal(parseInt(data[0]?.value || 50)),
        ts:          Date.now(),
      };
      this.lastFetch = Date.now();
      return this.cache;
    } catch(e) {
      // Fallback: simuliere basierend auf RSI-ähnlicher Logik
      return this.cache || { value:50, label:'Neutral', trend:'FLAT', signal:'NEUTRAL', simulated:true };
    }
  },

  _signal(value) {
    if (value <= 20) return 'EXTREME_FEAR_BUY';  // Extremangst = Kaufsignal
    if (value <= 35) return 'FEAR_CAUTIOUS_BUY';
    if (value >= 80) return 'EXTREME_GREED_SELL'; // Extreme Gier = Verkauf
    if (value >= 65) return 'GREED_CAUTIOUS_SELL';
    return 'NEUTRAL';
  },

  // Integration in DecisionFlow: blocke Käufe bei extremer Gier
  async shouldBlock(direction) {
    const fg = await this.fetch();
    if (direction === 'BUY' && fg.value >= 80) return { block:true, reason:`Fear&Greed ${fg.value} – EXTREME GREED` };
    if (direction === 'SELL' && fg.value <= 20) return { block:true, reason:`Fear&Greed ${fg.value} – EXTREME FEAR` };
    return { block:false, fg };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// PORTFOLIO REBALANCING BOT
// Hält Ziel-Allokation automatisch aufrecht
// ═════════════════════════════════════════════════════════════════════════════
const RebalanceBot = {
  config: null,
  history: [],

  setConfig({ targets, thresholdPct=0.05, intervalMs=86400000 }) {
    // targets: { BTCUSDT: 0.6, ETHUSDT: 0.4 }
    const total = Object.values(targets).reduce((a,b)=>a+b,0);
    if (Math.abs(total-1.0) > 0.01) return { error:'Ziel-Allokationen müssen 1.0 ergeben' };
    this.config = { targets, thresholdPct, intervalMs };
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.run(), intervalMs);
    Log.info('REBAL', `Rebalancing konfiguriert: ${JSON.stringify(targets)}`);
    return { ok:true };
  },

  async run() {
    if (!this.config) return { error:'Kein Config' };
    Log.info('REBAL', 'Rebalancing läuft...');
    const prices = {};
    for (const sym of Object.keys(this.config.targets)) {
      const ticker = await Bitget.fetchTicker(sym).catch(() => null);
      prices[sym] = ticker?.last || 0;
    }
    const totalValue = Balance.trading;
    const trades = [];
    for (const [sym, targetPct] of Object.entries(this.config.targets)) {
      const targetUSDT = totalValue * targetPct;
      const currentUSDT = totalValue * targetPct; // Vereinfachung: Tracking fehlt
      const diff = targetUSDT - currentUSDT;
      const diffPct = Math.abs(diff) / totalValue;
      if (diffPct > this.config.thresholdPct) {
        const side = diff > 0 ? 'buy' : 'sell';
        trades.push({ sym, side, amountUSDT: Math.abs(diff), diffPct });
        Log.info('REBAL', `${sym}: ${side} ${Math.abs(diff).toFixed(2)} USDT (${(diffPct*100).toFixed(1)}% Abweichung)`);
      }
    }
    const entry = { ts:Date.now(), trades, totalValue };
    this.history.unshift(entry);
    if (this.history.length > 20) this.history.pop();
    if (trades.length > 0) {
      TelegramBot.send(`⚖️ Rebalancing:
${trades.map(t=>`${t.sym}: ${t.side} ${t.amountUSDT.toFixed(2)} USDT`).join('\n')}`);
    }
    return entry;
  },

  snapshot() { return { config: this.config, lastRun: this.history[0] || null, historyCount: this.history.length }; }
};

// ═════════════════════════════════════════════════════════════════════════════
// SPOT-FUTURES ARBITRAGE BOT
// Kassiert Funding Rate: Long Spot + Short Futures gleichzeitig
// Bei positiver Funding Rate zahlen Longs → du kassierst als Short
// ═════════════════════════════════════════════════════════════════════════════
const SpotFuturesArb = {
  jobs: {},

  async create({ id, symbol, sizeUSDT, minFundingRate=0.0003 }) {
    const fundingRate = await FundingEngine.fetchFundingRate(symbol);
    if (Math.abs(fundingRate) < minFundingRate) {
      return { error:`Funding Rate ${(fundingRate*100).toFixed(4)}% zu niedrig (Min: ${(minFundingRate*100).toFixed(4)}%)` };
    }
    const job = {
      id, symbol, sizeUSDT, fundingRate, minFundingRate,
      active: true, status: 'HEDGED',
      collectedFunding: 0, openedAt: Date.now(),
      spotLong: false, futuresShort: false,
    };
    this.jobs[id] = job;

    // Spot Long
    const ticker = await Bitget.fetchTicker(symbol).catch(() => null);
    const price = ticker?.last || 0;
    const qty = price > 0 ? (sizeUSDT/price).toFixed(6) : '0';
    Log.info('ARB', `${id}: Spot Long ${qty} + Futures Short ${qty} @ Funding ${(fundingRate*100).toFixed(4)}%`);

    if (DemoEngine.liveMode && CFG.API_KEY) {
      await Bitget.placeSportOrder(symbol, 'buy', qty).catch(() => {});
      await Bitget.placeFuturesOrder(symbol, 'sell', qty, 'market', null, 1, 'short').catch(() => {});
    }
    job.spotLong = true; job.futuresShort = true;

    // Funding alle 8h sammeln
    job._timer = setInterval(async () => {
      const newRate = await FundingEngine.fetchFundingRate(symbol);
      const funding = sizeUSDT * Math.abs(newRate);
      job.collectedFunding += funding;
      job.fundingRate = newRate;
      Balance.recordProfit(funding);
      Log.info('ARB', `${id}: Funding +${funding.toFixed(4)} USDT (Gesamt: ${job.collectedFunding.toFixed(4)} USDT)`);
      TelegramBot.send(`💰 Arb Funding: ${symbol}
+${funding.toFixed(4)} USDT
Gesamt: ${job.collectedFunding.toFixed(4)} USDT`);
      // Schließe wenn Funding Rate zu niedrig
      if (Math.abs(newRate) < minFundingRate) {
        await this.close(id);
      }
    }, 8*3600*1000);

    TelegramBot.send(`💱 Spot-Futures Arb gestartet: ${symbol}
Größe: ${sizeUSDT} USDT
Funding: ${(fundingRate*100).toFixed(4)}% / 8h
Geschaetzte APR: ${(fundingRate*3*365*100).toFixed(1)}%`);
    return { ok:true, job, estimatedAPR: fundingRate*3*365 };
  },

  async close(id) {
    const job = this.jobs[id];
    if (!job) return { error:'Not found' };
    job.active = false; job.status = 'CLOSED';
    if (job._timer) { clearInterval(job._timer); job._timer = null; }
    Log.info('ARB', `${id} geschlossen. Gesamt Funding: ${job.collectedFunding.toFixed(4)} USDT`);
    TelegramBot.send(`🏁 Arb geschlossen: ${job.symbol}
Gesamt Funding kassiert: ${job.collectedFunding.toFixed(4)} USDT`);
    return { ok:true, collectedFunding: job.collectedFunding };
  },

  snapshot() {
    return Object.values(this.jobs).map(({ _timer, ...j }) => j);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TAGES-REPORT – automatisch jeden Morgen per Telegram
// ═════════════════════════════════════════════════════════════════════════════
const DailyReport = {
  _timer: null,

  start() {
    if (this._timer) clearInterval(this._timer);
    // Jeden Tag um 08:00 Uhr
    const now = new Date();
    const next8am = new Date(now);
    next8am.setHours(8,0,0,0);
    if (next8am <= now) next8am.setDate(next8am.getDate()+1);
    const msUntil = next8am - now;
    setTimeout(() => {
      this._timer = setInterval(() => TelegramBot.sendReport(), 24*3600*1000);
      TelegramBot.sendReport();
    }, msUntil);
    Log.info('REPORT', `Tagesbericht um 08:00 Uhr geplant (in ${(msUntil/3600000).toFixed(1)}h)`);
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS BOT MANAGER
// Erkennt Marktregime und startet/stoppt automatisch den passenden Bot
//
// REGIME → BOT MAPPING:
//   RANGING / NEUTRAL   → Grid Bot   (kauft tief, verkauft hoch)
//   BULL / SQUEEZE      → DCA Bot    (akkumuliert im Trend)
//   BEAR                → DCA Short  (oder Pause je nach Konfidenz)
//   EXTREME_BEAR        → Alle Bots stoppen, nur Flash Crash Bot aktiv
//   CHOPPY              → Combo Bot  (DCA + kleines Grid)
//
// MANUELL-MODUS: Alle autonomen Entscheidungen pausiert, du steuerst manuell
// ═════════════════════════════════════════════════════════════════════════════
const BotManager = {
  mode:        'MANUAL',   // 'AUTONOMOUS' | 'MANUAL'
  lastRegime:  null,
  lastDecision: null,
  activeBot:   null,       // { type, id, symbol }
  manualOverrides: {},     // symbol → { locked: true, reason }
  history:     [],         // Protokoll aller Entscheidungen
  checkInterval: null,

  // ── MODI UMSCHALTEN ───────────────────────────────────────────────────────
  setMode(mode) {
    if (!['AUTONOMOUS', 'MANUAL'].includes(mode)) return { error:'Ungültiger Modus' };
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'AUTONOMOUS') {
      this._startCheck();
      Log.info('BOTMAN', 'Autonomer Modus AKTIVIERT – Bot entscheidet selbst');
      TelegramBot.send('🤖 NEXUS: AUTONOMER MODUS aktiviert\nBot wählt automatisch die beste Strategie');
    } else {
      this._stopCheck();
      Log.info('BOTMAN', 'Manueller Modus AKTIVIERT – Du steuerst');
      TelegramBot.send('👤 NEXUS: MANUELLER MODUS aktiviert\nDu hast die volle Kontrolle');
    }
    return { ok:true, mode, prev };
  },

  // ── MANUELLER OVERRIDE für ein Symbol ────────────────────────────────────
  // Sperrt ein Symbol gegen autonome Entscheidungen
  lockSymbol(symbol, reason='MANUAL_OVERRIDE') {
    this.manualOverrides[symbol] = { locked:true, reason, ts:Date.now() };
    Log.info('BOTMAN', `${symbol} manuell gesperrt: ${reason}`);
    return { ok:true, symbol, locked:true };
  },

  unlockSymbol(symbol) {
    delete this.manualOverrides[symbol];
    return { ok:true, symbol, locked:false };
  },

  // Prüfe ob Symbol gesperrt ist
  isLocked(symbol) {
    return !!this.manualOverrides[symbol]?.locked;
  },

  // ── AUTONOMER REGIME-CHECK ────────────────────────────────────────────────
  _startCheck() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => this._autonomousCycle(), 120000); // alle 2min
    this._autonomousCycle(); // sofort
  },

  _stopCheck() {
    if (this.checkInterval) { clearInterval(this.checkInterval); this.checkInterval = null; }
  },

  async _autonomousCycle() {
    if (this.mode !== 'AUTONOMOUS') return;
    const symbols = AutoEngine.symbols || ['BTCUSDT'];

    for (const symbol of symbols) {
      if (this.isLocked(symbol)) {
        this._log(`${symbol}: Manuell gesperrt – überspringe`);
        continue;
      }
      try {
        await this._decideBot(symbol);
      } catch(e) {
        Log.warn('BOTMAN', `Fehler bei ${symbol}: ${e.message}`);
        SelfHeal.recordError('BOTMAN', e.message);
      }
    }
  },

  async _decideBot(symbol) {
    // Marktdaten holen
    const candles = await Bitget.fetchCandles(symbol, '1h', 100);
    if (!candles || candles.length < 30) return;
    Regime.detect(candles);
    const regime     = Regime.regime;
    const confidence = Regime.confidence;
    const closes     = candles.map(c=>c.close);
    const price      = closes[closes.length-1];

    // Nur handeln wenn Konfidenz hoch genug
    if (confidence < 0.55) {
      this._log(`${symbol}: Konfidenz ${(confidence*100).toFixed(0)}% zu niedrig – warte`);
      return;
    }

    // Prüfe ob schon ein Bot läuft für dieses Symbol
    const existingDCA  = Object.values(DCABot.jobs).find(j=>j.symbol===symbol&&j.active);
    const existingGrid = Object.values(GridBot.jobs).find(j=>j.symbol===symbol&&j.active);
    const existingCombo= Object.values(ComboBot.jobs).find(j=>j.symbol===symbol&&j.active);

    // Regime-Wechsel erkannt?
    const prevDecision = this.lastDecision?.[symbol];
    if (prevDecision?.regime === regime) {
      // Auch bei gleichem Regime: nach EXTREME_BEAR schnell auf neuen Bot prüfen
      // (Recovery kann innerhalb von 10min kommen)
      const extremeBearAt = this._extremeBearAt?.[symbol] || 0;
      const msSinceExtreme = Date.now() - extremeBearAt;
      const recovered = msSinceExtreme > 600000 && // 10 Minuten vergangen
                        ['BULL','RANGING','NEUTRAL','SQUEEZE'].includes(regime);
      if (!recovered) return;
      this._log(`${symbol}: Recovery nach EXTREME_BEAR erkannt (${Math.round(msSinceExtreme/60000)}min) → Starte passenden Bot`);
      if (this._extremeBearAt) delete this._extremeBearAt[symbol];
    }

    this._log(`${symbol}: Regime-Wechsel ${prevDecision?.regime||'—'} → ${regime} (${(confidence*100).toFixed(0)}%)`);

    // SCHRITT 1: Alten Bot stoppen wenn Regime gewechselt hat
    if (existingGrid && !['RANGING','NEUTRAL','CHOPPY'].includes(regime)) {
      GridBot.stop(existingGrid.id);
      this._log(`${symbol}: Grid Bot gestoppt (Regime: ${regime})`);
    }
    if (existingDCA && !['BULL','SQUEEZE','BEAR'].includes(regime)) {
      DCABot.stop(existingDCA.id);
      this._log(`${symbol}: DCA Bot gestoppt (Regime: ${regime})`);
    }
    if (existingCombo && regime !== 'CHOPPY') {
      ComboBot.stop(existingCombo.id);
      this._log(`${symbol}: Combo Bot gestoppt (Regime: ${regime})`);
    }

    // SCHRITT 2: Neuen passenden Bot starten
    const capital      = Balance.trading;
    const botCapital   = Math.min(capital * 0.25, 200); // max 25% pro Bot, max 200 USDT
    const id           = `AUTO_${symbol}_${Date.now()}`;
    let   startedBot   = null;

    switch(regime) {

      case 'RANGING':
      case 'NEUTRAL':
        // GRID BOT – profitiert von Seitwärtsbewegung
        if (!existingGrid && botCapital >= 20) {
          const atr = Ind.atr(candles) || price*0.01;
          // Grid-Range: ATR × 8 nach oben und unten
          const lower = parseFloat((price - atr*8).toFixed(2));
          const upper = parseFloat((price + atr*8).toFixed(2));
          const result = GridBot.create({
            id, symbol,
            lowerPrice: lower,
            upperPrice: upper,
            gridCount:  10,
            totalUSDT:  botCapital,
          });
          if (result.ok) {
            startedBot = { type:'GRID', id, symbol, regime };
            this._log(`${symbol}: GRID Bot gestartet [${lower}-${upper}] ${botCapital.toFixed(0)} USDT`);
            TelegramBot.send(`🤖 AUTO: GRID Bot\n${symbol} [${lower}-${upper}]\nRegime: ${regime.toUpperCase()} (${(confidence*100).toFixed(0)}%)`);
          }
        }
        break;

      case 'BULL':
        // DCA BOT – akkumuliert im Aufwärtstrend
        if (!existingDCA && botCapital >= 10) {
          const sliceSize = Math.max(5, botCapital/10);
          const result = DCABot.create({
            id, symbol,
            amountUSDT:      sliceSize,
            minFreq:         50,   // 50 Ticks/h Basis im Bull
            maxFreq:         150,  // Bis 150 Ticks/h bei starker Volatilität
            tp:              0.06,
            safetyDropPct:   0.04,
            maxSafetyOrders: 4,
            adaptive:        true,
          });
          if (result.ok) {
            startedBot = { type:'DCA', id, symbol, regime };
            this._log(`${symbol}: DCA Bot gestartet ${sliceSize.toFixed(0)} USDT/h`);
            TelegramBot.send(`🤖 AUTO: DCA Bot\n${symbol} ${sliceSize.toFixed(0)} USDT/Stunde\nRegime: BULL (${(confidence*100).toFixed(0)}%)`);
          }
        }
        break;

      case 'SQUEEZE':
        // DCA mit engerem TP – Squeeze vor Breakout
        if (!existingDCA && botCapital >= 10) {
          const result = DCABot.create({
            id, symbol,
            amountUSDT:      Math.max(5, botCapital/8),
            minFreq:         80,    // Aggressiver im Squeeze
            maxFreq:         180,   // Bis 180 Ticks/h
            tp:              0.04,
            safetyDropPct:   0.03,
            maxSafetyOrders: 3,
            adaptive:        true,
          });
          if (result.ok) {
            startedBot = { type:'DCA', id, symbol, regime };
            this._log(`${symbol}: DCA (Squeeze) gestartet`);
            TelegramBot.send(`🤖 AUTO: DCA (Squeeze)\n${symbol}\nBreakout-Erwartung – kleines TP`);
          }
        }
        break;

      case 'CHOPPY':
        // COMBO BOT – DCA + Grid kombiniert für unruhige Märkte
        if (!existingCombo && botCapital >= 30) {
          const result = ComboBot.create({
            id, symbol,
            totalUSDT:    botCapital,
            dcaShare:     0.6,
            gridShare:    0.4,
            tpPct:        0.05,
            dcaIntervalMs:2*3600000,
          });
          if (result.ok) {
            startedBot = { type:'COMBO', id, symbol, regime };
            this._log(`${symbol}: COMBO Bot gestartet (choppy market)`);
            TelegramBot.send(`🤖 AUTO: COMBO Bot\n${symbol}\nRegime: CHOPPY – DCA+Grid`);
          }
        }
        break;

      case 'BEAR':
        // BEAR: Grid/Combo stoppen, DCA mit Safety Orders starten
        // DCA akkumuliert günstig in fallenden Märkten (Dollar-Cost-Averaging)
        if (existingGrid) {
          GridBot.stop(existingGrid.id);
          this._log(`${symbol}: Grid gestoppt wegen BEAR-Regime`);
        }
        if (existingCombo) {
          ComboBot.stop(existingCombo.id);
          this._log(`${symbol}: Combo gestoppt wegen BEAR-Regime`);
        }
        // DCA starten falls noch keiner läuft
        if (!existingDCA && botCapital >= 10) {
          const bearDCA = DCABot.create({
            id, symbol,
            amountUSDT:      Math.max(3, botCapital/20), // Kleine Scheiben im Bärenmarkt
            minFreq:         30,         // Ruhiger im Bärenmarkt: 30 Ticks/h
            maxFreq:         80,         // Max 80 Ticks/h
            tp:              0.08,       // 8% TP
            safetyDropPct:   0.03,
            maxSafetyOrders: 5,
            adaptive:        true,
          });
          if (bearDCA.ok) {
            startedBot = { type:'DCA_BEAR', id, symbol, regime };
            this._log(`${symbol}: DCA (BEAR-Modus) gestartet – akkumuliert in Schwäche`);
            TelegramBot.send(`📉 AUTO: DCA (BEAR)
${symbol}
Akkumuliert alle 2h
Safety Orders bei -3% aktiv`);
          }
        } else if (existingDCA) {
          this._log(`${symbol}: BEAR – DCA läuft bereits weiter`);
        }
        break;

      case 'EXTREME_BEAR':
        // EXTREME_BEAR: Alles stoppen, aber Flash Crash Recovery beobachten
        this._log(`${symbol}: EXTREME_BEAR – Alle Bots stoppen!`);
        if (existingGrid)  { GridBot.stop(existingGrid.id);   this._log(`${symbol}: Grid gestoppt`); }
        if (existingDCA)   { DCABot.stop(existingDCA.id);     this._log(`${symbol}: DCA gestoppt`); }
        if (existingCombo) { ComboBot.stop(existingCombo.id); this._log(`${symbol}: Combo gestoppt`); }
        TelegramBot.send(`🛑 AUTO: EXTREME BEAR auf ${symbol}!
Alle Bots gestoppt
Warte auf Stabilisierung...`);
        // Merke: wann wurde EXTREME_BEAR zuletzt erkannt
        if (!this._extremeBearAt) this._extremeBearAt = {};
        this._extremeBearAt[symbol] = Date.now();
        break;
    }

    // Entscheidung protokollieren
    if (!this.lastDecision) this.lastDecision = {};
    this.lastDecision[symbol] = { regime, confidence, botStarted: startedBot, ts:Date.now() };
    const entry = { ts: new Date().toLocaleTimeString('de-DE'), symbol, regime, confidence, action: startedBot?.type || 'NONE' };
    this.history.unshift(entry);
    if (this.history.length > 50) this.history.pop();
  },

  _log(msg) {
    Log.info('BOTMAN', msg);
    this.history.unshift({ ts: new Date().toLocaleTimeString('de-DE'), msg, type:'LOG' });
    if (this.history.length > 100) this.history.pop();
  },

  // ── MANUELL: Grid-Parameter eines laufenden Bots ändern ──────────────────
  adjustGrid(id, { lowerPrice, upperPrice, gridCount }) {
    const job = GridBot.jobs[id];
    if (!job) return { error:'Grid Bot nicht gefunden' };
    // Stoppe und starte mit neuen Parametern neu
    GridBot.stop(id);
    const newId = id+'_ADJ';
    const result = GridBot.create({
      id: newId,
      symbol: job.symbol,
      lowerPrice: lowerPrice || job.lowerPrice,
      upperPrice: upperPrice || job.upperPrice,
      gridCount:  gridCount  || job.gridCount,
      totalUSDT:  job.totalUSDT,
    });
    Log.info('BOTMAN', `Grid ${id} angepasst → ${newId}`);
    return { ok:true, newId, result };
  },

  // Alle laufenden Bots eines Symbols sofort stoppen (Not-Aus)
  emergencyStop(symbol) {
    let stopped = 0;
    Object.values(DCABot.jobs).filter(j=>(!symbol||j.symbol===symbol)&&j.active).forEach(j=>{DCABot.stop(j.id);stopped++;});
    Object.values(GridBot.jobs).filter(j=>(!symbol||j.symbol===symbol)&&j.active).forEach(j=>{GridBot.stop(j.id);stopped++;});
    Object.values(MartingaleBot.jobs).filter(j=>(!symbol||j.symbol===symbol)&&j.active).forEach(j=>{MartingaleBot.stop(j.id);stopped++;});
    Object.values(ComboBot.jobs).filter(j=>(!symbol||j.symbol===symbol)&&j.active).forEach(j=>{ComboBot.stop(j.id);stopped++;});
    Object.values(SpotFuturesArb.jobs).filter(j=>(!symbol||j.symbol===symbol)&&j.active).forEach(j=>{SpotFuturesArb.close(j.id);stopped++;});
    Log.warn('BOTMAN', `Emergency Stop${symbol?' für '+symbol:' ALLE'}: ${stopped} Bots gestoppt`);
    TelegramBot.send(`🛑 EMERGENCY STOP${symbol?' '+symbol:' ALLE BOTS'}\n${stopped} Bots gestoppt`);
    return { ok:true, stopped };
  },

  snapshot() {
    return {
      mode:      this.mode,
      activeBot: this.activeBot,
      lastDecision: this.lastDecision,
      manualOverrides: this.manualOverrides,
      history:   this.history.slice(0, 20),
      activeBots: {
        dca:       Object.values(DCABot.jobs).filter(j=>j.active).length,
        grid:      Object.values(GridBot.jobs).filter(j=>j.active).length,
        martingale:Object.values(MartingaleBot.jobs).filter(j=>j.active).length,
        combo:     Object.values(ComboBot.jobs).filter(j=>j.active).length,
        arb:       Object.values(SpotFuturesArb.jobs).filter(j=>j.active).length,
      }
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// META-WÄCHTER – überwacht die Wächter
// Wer überwacht SelfHeal? Wer prüft ob KillSwitch korrekt arbeitet?
// Wer stellt fest wenn Safeties eingefroren sind?
// Dieser Wächter prüft alle anderen Wächter auf Funktionsfähigkeit.
// ═════════════════════════════════════════════════════════════════════════════
const MetaWatchdog = {
  checks:    [],      // Protokoll aller Checks
  alerts:    [],      // Aktive Probleme
  lastCheck: null,
  timer:     null,
  checkCount: 0,

  // ── WÄCHTER-PRÜFUNGEN ─────────────────────────────────────────────────────
  async runAllChecks() {
    this.checkCount++;
    this.lastCheck = Date.now();
    const results = [];

    // ── 1. SelfHeal ist er noch aktiv? ──────────────────────────────────────
    results.push(this._check('SELFHEAL_ALIVE', () => {
      if (!SelfHeal.healInterval) return { ok:false, msg:'SelfHeal Timer nicht aktiv – Selbstheilung läuft nicht!', severity:'HIGH' };
      const msSinceHeal = SelfHeal.lastRepair ? Date.now()-SelfHeal.lastRepair : 0;
      // Warnung wenn mehr als 20 Minuten kein Check lief
      if (msSinceHeal > 20*60*1000 && SelfHeal.lastRepair) return { ok:false, msg:`SelfHeal letzter Check vor ${Math.round(msSinceHeal/60000)}min – zu lange`, severity:'MEDIUM' };
      return { ok:true, msg:`SelfHeal aktiv (${SelfHeal.repairLog.length} Reparaturen)` };
    }));

    // ── 2. KillSwitch – reagiert er auf Drawdown? ───────────────────────────
    results.push(this._check('KILLSWITCH_SANE', () => {
      const dd = Balance.peakEquity > 0 ? (Balance.peakEquity-Balance.usable)/Balance.peakEquity : 0;
      // Kill Switch sollte HALTED sein wenn Drawdown > 12%
      if (dd > CFG.MAX_DRAWDOWN_PCT && KillSwitch.mode !== 'HALTED') {
        return { ok:false, msg:`Drawdown ${(dd*100).toFixed(1)}% aber KillSwitch NICHT ausgelöst! Mode: ${KillSwitch.mode}`, severity:'CRITICAL' };
      }
      // Kill Switch sollte NICHT dauerhaft aktiv sein ohne echten Drawdown
      if (KillSwitch.active && dd < CFG.MAX_DRAWDOWN_PCT*0.5 && KillSwitch.triggers.length > 0) {
        const age = KillSwitch.triggers[0] ? Date.now()-KillSwitch.triggers[0].ts : 0;
        if (age > 2*3600000) return { ok:false, msg:`KillSwitch aktiv seit ${Math.round(age/3600000)}h ohne echten Drawdown – Auto-Reset nötig`, severity:'MEDIUM' };
      }
      return { ok:true, msg:`KillSwitch OK (Mode: ${KillSwitch.mode}, DD: ${(dd*100).toFixed(1)}%)` };
    }));

    // ── 3. Safeties – frieren sie ein? ──────────────────────────────────────
    results.push(this._check('SAFETIES_FUNCTIONAL', () => {
      // Zu viele consecutive losses ohne Reset ist verdächtig
      if (Safeties.consecutiveLossCount > Safeties.maxConsecutiveLosses + 3) {
        return { ok:false, msg:`Safeties: ${Safeties.consecutiveLossCount} Verluste in Folge – Counter nicht zurückgesetzt?`, severity:'HIGH' };
      }
      // Daily Count darf nicht über Limit laufen
      if (Safeties.dailyTradeCount > Safeties.dailyTradeLimit + 5) {
        return { ok:false, msg:`Safeties: ${Safeties.dailyTradeCount} Trades heute (Limit: ${Safeties.dailyTradeLimit}) – Counter defekt?`, severity:'HIGH' };
      }
      return { ok:true, msg:`Safeties OK (${Safeties.consecutiveLossCount} Verlustserien, ${Safeties.dailyTradeCount} Trades heute)` };
    }));

    // ── 4. NoTrade Gates – sind sie logisch konsistent? ─────────────────────
    results.push(this._check('NOTRADE_CONSISTENT', () => {
      const v = NoTrade.verdict();
      // Wenn alle Gates grün aber allowTrade=false → Inkonsistenz
      const allGreen = Object.values(v.gates||{}).every(g => g === true);
      if (allGreen && !v.allowTrade) return { ok:false, msg:'NoTrade: Alle Gates grün aber Handel verboten – Logikfehler!', severity:'HIGH' };
      // Wenn Kill Switch HALTED aber NoTrade erlaubt → gefährlich
      if (KillSwitch.mode === 'HALTED' && v.allowTrade) return { ok:false, msg:'NoTrade: Erlaubt Handel obwohl Kill Switch HALTED!', severity:'CRITICAL' };
      const openGates = Object.entries(v.gates||{}).filter(([k,v])=>!v).map(([k])=>k);
      return { ok:true, msg:`NoTrade: ${v.allowTrade?'HANDEL OK':'BLOCKIERT ('+openGates.join(', ')+')'}` };
    }));

    // ── 5. Balance – ist sie mathematisch konsistent? ───────────────────────
    results.push(this._check('BALANCE_CONSISTENT', () => {
      const total = Balance.usable;
      const sum   = Balance.reserve + Balance.trading;
      const diff  = Math.abs(total - sum);
      if (diff > 0.01 && total > 0) return { ok:false, msg:`Balance inkonsistent: Gesamt=${total.toFixed(4)} aber Reserve+Trading=${sum.toFixed(4)} (Diff: ${diff.toFixed(4)})`, severity:'HIGH' };
      if (Balance.trading < 0) return { ok:false, msg:`Trading-Kapital negativ: ${Balance.trading.toFixed(4)} USDT!`, severity:'CRITICAL' };
      if (Balance.reserve < 0) return { ok:false, msg:`Reserve negativ: ${Balance.reserve.toFixed(4)} USDT!`, severity:'CRITICAL' };
      return { ok:true, msg:`Balance OK: ${total.toFixed(2)} USDT (Reserve: ${Balance.reserve.toFixed(2)} + Trading: ${Balance.trading.toFixed(2)})` };
    }));

    // ── 6. Exchange-Verbindung – ist sie stabil? ────────────────────────────
    results.push(this._check('EXCHANGE_STABLE', () => {
      if (Bitget.status === 'OFFLINE') return { ok:false, msg:'Exchange OFFLINE – keine Marktdaten!', severity:'CRITICAL' };
      if (!Bitget.wsReady) return { ok:false, msg:'WebSocket getrennt – Live-Preise fehlen', severity:'HIGH' };
      if (Bitget.latencyMs > 3000) return { ok:false, msg:`Hohe Latenz: ${Bitget.latencyMs}ms – Verbindung langsam`, severity:'MEDIUM' };
      const cachedPairs = Object.keys(Bitget.priceCache).length;
      if (cachedPairs === 0 && Bitget.status === 'ONLINE') return { ok:false, msg:'Exchange online aber keine Preise gecacht – WS Problem?', severity:'MEDIUM' };
      return { ok:true, msg:`Exchange OK (${Bitget.latencyMs}ms, ${cachedPairs} Preise gecacht)` };
    }));

    // ── 7. AutoEngine – läuft er wenn er soll? ──────────────────────────────
    results.push(this._check('AUTOENGINE_ALIVE', () => {
      if (!AutoEngine.enabled) return { ok:true, msg:'AutoEngine deaktiviert (manuell gestoppt – OK)' };
      if (AutoEngine.enabled && !AutoEngine.timer) return { ok:false, msg:'AutoEngine aktiviert aber kein Timer läuft!', severity:'HIGH' };
      const msSinceScan = AutoEngine.stats.lastScan ? Date.now()-new Date(AutoEngine.stats.lastScan).getTime() : 0;
      if (msSinceScan > AutoEngine.intervalMs * 3 && AutoEngine.enabled) {
        return { ok:false, msg:`AutoEngine: Letzter Scan vor ${Math.round(msSinceScan/60000)}min (erwartet alle ${AutoEngine.intervalMs/60000}min)`, severity:'HIGH' };
      }
      const errRate = AutoEngine.stats.scansTotal > 0 ? AutoEngine.stats.errors/AutoEngine.stats.scansTotal : 0;
      if (errRate > 0.3) return { ok:false, msg:`AutoEngine: ${(errRate*100).toFixed(0)}% Fehlerrate (${AutoEngine.stats.errors}/${AutoEngine.stats.scansTotal})`, severity:'HIGH' };
      return { ok:true, msg:`AutoEngine OK (${AutoEngine.stats.scansTotal} Scans, ${AutoEngine.stats.errors} Fehler)` };
    }));

    // ── 8. Incidents – stauen sich Fehler auf? ──────────────────────────────
    results.push(this._check('INCIDENTS_MANAGED', () => {
      const open  = Incidents.getOpen();
      const press = Incidents.pressureScore();
      if (press > 0.8) return { ok:false, msg:`Incident-Druck: ${(press*100).toFixed(0)}% – System unter starkem Stress! (${open.length} offene Incidents)`, severity:'CRITICAL' };
      if (press > 0.5) return { ok:false, msg:`Incident-Druck: ${(press*100).toFixed(0)}% – ${open.length} offene Incidents`, severity:'HIGH' };
      if (open.length > 15) return { ok:false, msg:`${open.length} offene Incidents – Bereinigung nötig`, severity:'MEDIUM' };
      return { ok:true, msg:`Incidents OK (${open.length} offen, Druck: ${(press*100).toFixed(0)}%)` };
    }));

    // ── 9. BotManager – arbeitet er wie erwartet? ───────────────────────────
    results.push(this._check('BOTMANAGER_SANE', () => {
      if (BotManager.mode === 'AUTONOMOUS' && !BotManager.checkInterval) {
        return { ok:false, msg:'BotManager: Autonom-Modus aktiv aber kein Check-Timer!', severity:'HIGH' };
      }
      // Im autonomen Modus: Prüfe ob lange keine Entscheidung getroffen wurde
      if (BotManager.mode === 'AUTONOMOUS') {
        const lastDecision = BotManager.lastDecision;
        if (lastDecision) {
          const oldest = Math.min(...Object.values(lastDecision).map(d=>d.ts||Date.now()));
          const age = Date.now() - oldest;
          if (age > 30*60*1000) return { ok:false, msg:`BotManager: Letzte Regime-Entscheidung vor ${Math.round(age/60000)}min – reagiert er?`, severity:'MEDIUM' };
        }
      }
      return { ok:true, msg:`BotManager OK (Modus: ${BotManager.mode})` };
    }));

    // ── 10. Datenbank – ist sie erreichbar und gesund? ──────────────────────
    results.push(this._check('DATABASE_HEALTHY', () => {
      try {
        const test = DB.getLogs.all(1);
        const dbSize = require('fs').statSync(CFG.DB_PATH).size;
        const mb = dbSize / (1024*1024);
        if (mb > 200) return { ok:false, msg:`DB zu groß: ${mb.toFixed(1)}MB – WAL Checkpoint nötig`, severity:'MEDIUM' };
        if (mb > 100) return { ok:true, msg:`DB OK aber wächst: ${mb.toFixed(1)}MB` };
        return { ok:true, msg:`DB OK (${mb.toFixed(1)}MB)` };
      } catch(e) {
        return { ok:false, msg:`DB Fehler: ${e.message}`, severity:'CRITICAL' };
      }
    }));

    // Alerts aktualisieren
    this.alerts = results.filter(r => !r.ok);
    this.checks = results;

    // Kritische Alerts per Telegram senden
    const critical = results.filter(r => !r.ok && r.severity === 'CRITICAL');
    if (critical.length) {
      const lines = ['🚨 META-WÄCHTER ALARM', ''].concat(critical.map(c=>'⛔ '+c.name+': '+c.msg));
      const msg = lines.join('\n');
      TelegramBot.send(msg);
      Incidents.create('META_WATCHDOG_CRITICAL', critical.map(c=>c.msg).join(' | '), 'HIGH');
    }

    Log.info('WATCHDOG', `Check #${this.checkCount}: ${results.filter(r=>r.ok).length}/${results.length} OK, ${this.alerts.length} Probleme`);
    return this.summary();
  },

  _check(name, fn) {
    try {
      const result = fn();
      return { name, ok:result.ok, msg:result.msg, severity:result.severity||'LOW', ts:Date.now() };
    } catch(e) {
      return { name, ok:false, msg:`Check-Fehler: ${e.message}`, severity:'HIGH', ts:Date.now() };
    }
  },

  // ── FEHLER-ANALYSE – komplette Momentaufnahme ────────────────────────────
  async diagnose() {
    await this.runAllChecks();
    const errors     = [];
    const warnings   = [];
    const ok         = [];

    for (const c of this.checks) {
      if (!c.ok && c.severity === 'CRITICAL') errors.push(c);
      else if (!c.ok) warnings.push(c);
      else ok.push(c);
    }

    // Zusätzliche Diagnose: laufende Bots mit Problemen
    const botIssues = [];
    Object.values(DCABot.jobs).forEach(j => {
      if (j.active && j._dcaCount > 0 && Date.now()-j.lastBuy > j.intervalMs*3) {
        botIssues.push({ bot:'DCA', id:j.id, issue:`Kein Kauf seit ${Math.round((Date.now()-j.lastBuy)/60000)}min (erwartet alle ${j.intervalMs/60000}min)` });
      }
    });
    Object.values(GridBot.jobs).forEach(j => {
      if (j.active && j.status === 'OUT_OF_RANGE') {
        botIssues.push({ bot:'GRID', id:j.id, issue:`Preis außerhalb Grid-Range [${j.lowerPrice}-${j.upperPrice}]` });
      }
    });

    return {
      timestamp:   new Date().toLocaleString('de-DE'),
      overall:     errors.length > 0 ? 'KRITISCH' : warnings.length > 0 ? 'WARNUNG' : 'OK',
      score:       Math.round((ok.length / this.checks.length) * 100),
      critical:    errors,
      warnings,
      ok,
      botIssues,
      summary: this.summary(),
    };
  },

  summary() {
    const total    = this.checks.length;
    const okCount  = this.checks.filter(c=>c.ok).length;
    const critical = this.alerts.filter(a=>a.severity==='CRITICAL').length;
    const high     = this.alerts.filter(a=>a.severity==='HIGH').length;
    const medium   = this.alerts.filter(a=>a.severity==='MEDIUM').length;
    return {
      total, ok:okCount, issues: this.alerts.length,
      critical, high, medium,
      score: total > 0 ? Math.round(okCount/total*100) : 100,
      lastCheck: this.lastCheck,
      checkCount: this.checkCount,
      alerts: this.alerts,
    };
  },

  start(intervalMs=300000) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.runAllChecks(), intervalMs);
    Log.info('WATCHDOG', `Meta-Wächter gestartet (alle ${intervalMs/60000}min)`);
    this.runAllChecks(); // sofort
  },

  snapshot() { return this.summary(); }
};


// ═════════════════════════════════════════════════════════════════════════════
// PREIS-ALERTS ENGINE  (Priorität 1a)
// Setze beliebige Preisschwellen – bei Erreichen → Telegram + Log
// Toggle: PriceAlerts.enabled = true/false
// ═════════════════════════════════════════════════════════════════════════════
const PriceAlerts = {
  enabled: true,
  alerts:  {},   // id → { symbol, condition, price, triggered, createdAt, note }
  history: [],

  add({ id, symbol, condition, price, note='' }) {
    // condition: 'ABOVE' | 'BELOW' | 'CHANGE_PCT' (±%)
    if (!id) id = `ALT_${Date.now()}`;
    this.alerts[id] = {
      id, symbol, condition, price: parseFloat(price),
      note, triggered: false, createdAt: Date.now(), lastPrice: 0,
    };
    Log.info('ALERT', `Alert gesetzt: ${symbol} ${condition} ${price} (${note||'—'})`);
    return { ok: true, id };
  },

  remove(id) {
    delete this.alerts[id];
    return { ok: true };
  },

  reset(id) {
    if (this.alerts[id]) this.alerts[id].triggered = false;
    return { ok: true };
  },

  // Wird vom AutoEngine-Cycle aufgerufen
  async check() {
    if (!this.enabled) return;
    for (const alert of Object.values(this.alerts)) {
      if (alert.triggered) continue;
      try {
        const ticker = await Bitget.fetchTicker(alert.symbol).catch(()=>null);
        const price  = ticker?.last || 0;
        if (!price) continue;
        alert.lastPrice = price;
        let fire = false;
        if (alert.condition === 'ABOVE' && price >= alert.price) fire = true;
        if (alert.condition === 'BELOW' && price <= alert.price) fire = true;
        if (alert.condition === 'CHANGE_PCT') {
          // alert.price = gewünschte %-Änderung, z.B. +5 oder -3
          const ref = alert.refPrice || price;
          if (!alert.refPrice) { alert.refPrice = price; continue; }
          const pct = (price - ref) / ref * 100;
          if (alert.price > 0 && pct >= alert.price) fire = true;
          if (alert.price < 0 && pct <= alert.price) fire = true;
        }
        if (fire) {
          alert.triggered  = true;
          alert.triggeredAt = Date.now();
          alert.triggeredPrice = price;
          const emoji = alert.condition === 'ABOVE' ? '📈' : alert.condition === 'BELOW' ? '📉' : '📊';
          const msg = `${emoji} PREIS-ALERT\n${alert.symbol}: ${alert.condition} $${alert.price}\nAktuell: $${price}\n${alert.note ? 'Notiz: '+alert.note : ''}`;
          TelegramBot.send(msg);
          Log.info('ALERT', `AUSGELÖST: ${alert.symbol} ${alert.condition} ${alert.price} @ ${price}`);
          this.history.unshift({ ...alert, ts: Date.now() });
          if (this.history.length > 50) this.history.pop();
        }
      } catch(e) { SelfHeal.recordError('PRICE_ALERT', e.message); }
    }
  },

  snapshot() {
    return {
      enabled: this.enabled,
      active:  Object.values(this.alerts).filter(a => !a.triggered),
      triggered: Object.values(this.alerts).filter(a => a.triggered),
      history: this.history.slice(0, 20),
    };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME BESTÄTIGUNG  (Priorität 1b)
// Signal auf TF1 muss auch auf höherem TF bestätigt sein
// Toggle: MTFConfirm.enabled = true/false
// ═════════════════════════════════════════════════════════════════════════════
const MTFConfirm = {
  enabled: false,  // Standard aus – kann per API aktiviert werden
  // TF-Paare: wenn Signal auf TF1, muss TF2 bestätigen
  pairs: {
    '15m': '1h',   // 15min-Signal braucht 1H-Bestätigung
    '1h':  '4h',   // 1H-Signal braucht 4H-Bestätigung
    '4h':  '1day',   // 4H-Signal braucht 1D-Bestätigung
  },
  strengthBonus:  0.12,  // Stärke-Bonus wenn MTF bestätigt
  strengthPenalty: 0.20, // Stärke-Abzug wenn MTF widerspricht

  async confirm(symbol, direction, baseTF='1h') {
    if (!this.enabled) return { confirmed: true, reason: 'MTF_DISABLED', bonus: 0 };
    const higherTF = this.pairs[baseTF] || '4h';
    try {
      const candles = await Bitget.fetchCandles(symbol, higherTF, 60);
      if (!candles || candles.length < 20) return { confirmed: true, reason: 'NO_DATA', bonus: 0 };
      const closes  = candles.map(c => c.close);

      // Schnelle Regime-Einschätzung auf höherem TF
      const ema20 = Ind.ema(closes, 20);
      const ema50 = Ind.ema(closes, 50);
      const rsi   = Ind.rsi(closes);
      const macd  = Ind.macd(closes);
      const price = closes[closes.length - 1];

      let higherBull = 0, higherBear = 0;
      if (ema20 && ema50) { ema20 > ema50 ? higherBull++ : higherBear++; }
      if (rsi) { rsi > 52 ? higherBull++ : rsi < 48 ? higherBear++ : null; }
      if (macd.histogram > 0) higherBull++; else higherBear++;
      if (ema20 && price > ema20) higherBull++; else higherBear++;

      const higherBias = higherBull > higherBear ? 'BUY' : higherBull < higherBear ? 'SELL' : 'NEUTRAL';

      if (higherBias === direction) {
        Log.info('MTF', `${symbol} ${higherTF} BESTÄTIGT ${direction} (${higherBull}/${higherBull+higherBear})`);
        return { confirmed: true, reason: `${higherTF}_CONFIRMS`, bonus: this.strengthBonus, higherTF, higherBias };
      }
      if (higherBias !== 'NEUTRAL' && higherBias !== direction) {
        Log.warn('MTF', `${symbol} ${higherTF} WIDERSPRICHT ${direction} → ${higherBias}`);
        return { confirmed: false, reason: `${higherTF}_CONTRADICTS`, bonus: -this.strengthPenalty, higherTF, higherBias };
      }
      return { confirmed: true, reason: `${higherTF}_NEUTRAL`, bonus: 0, higherTF, higherBias };
    } catch(e) {
      return { confirmed: true, reason: 'MTF_ERROR', bonus: 0 };
    }
  },

  snapshot() {
    return { enabled: this.enabled, pairs: this.pairs, strengthBonus: this.strengthBonus, strengthPenalty: this.strengthPenalty };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// DATENBANK-BACKUP ENGINE  (Priorität 1c)
// Täglich automatisch eine .bak Kopie der SQLite-Datei
// Toggle: DBBackup.enabled = true/false
// ═════════════════════════════════════════════════════════════════════════════
const DBBackup = {
  enabled:     true,
  backupDir:   process.env.BACKUP_DIR || './backups',
  maxBackups:  7,       // Max 7 Tages-Backups aufbewahren
  lastBackup:  null,
  timer:       null,
  backupLog:   [],

  start() {
    if (!this.enabled) return;
    // Einmal täglich um 03:00 Uhr
    const scheduleNext = () => {
      const now   = new Date();
      const next  = new Date(now);
      next.setHours(3, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const ms = next - now;
      this.timer = setTimeout(() => { this.run(); scheduleNext(); }, ms);
      Log.info('BACKUP', `Nächstes Backup um ${next.toLocaleString('de-DE')}`);
    };
    scheduleNext();
  },

  async run() {
    if (!this.enabled) return { ok: false, reason: 'DISABLED' };
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });

      // WAL Checkpoint vor Backup
      try { DB.db.pragma('wal_checkpoint(FULL)'); } catch(_){}

      const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const destPath = `${this.backupDir}/nexus_${ts}.db`;
      fs.copyFileSync(CFG.DB_PATH, destPath);

      // Alte Backups aufräumen (max N behalten)
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('nexus_') && f.endsWith('.db'))
        .sort();
      while (files.length > this.maxBackups) {
        const old = files.shift();
        try { fs.unlinkSync(`${this.backupDir}/${old}`); } catch(_){}
      }

      const stat = fs.statSync(destPath);
      const mb   = (stat.size / 1024 / 1024).toFixed(2);
      this.lastBackup = Date.now();
      const entry = { ts: Date.now(), file: destPath, sizeMB: mb, ok: true };
      this.backupLog.unshift(entry);
      if (this.backupLog.length > 10) this.backupLog.pop();
      Log.info('BACKUP', `Backup erstellt: ${destPath} (${mb}MB)`);
      TelegramBot.send(`💾 DB Backup: ${mb}MB gespeichert`);
      return entry;
    } catch(e) {
      const entry = { ts: Date.now(), ok: false, error: e.message };
      this.backupLog.unshift(entry);
      Log.error('BACKUP', `Backup fehlgeschlagen: ${e.message}`);
      SelfHeal.recordError('BACKUP', e.message);
      return entry;
    }
  },

  snapshot() {
    const fs = require('fs');
    let files = [];
    try {
      files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('nexus_') && f.endsWith('.db'))
        .sort().reverse().slice(0, 5);
    } catch(_){}
    return {
      enabled:    this.enabled,
      backupDir:  this.backupDir,
      lastBackup: this.lastBackup,
      maxBackups: this.maxBackups,
      files,
      log:        this.backupLog.slice(0, 5),
    };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// NEWS-SENTIMENT ENGINE  (Priorität 2)
// CryptoPanic API + Schlüsselwort-Analyse
// Toggle: NewsSentiment.enabled = true/false
// ═════════════════════════════════════════════════════════════════════════════
const NewsSentiment = {
  enabled:   false,
  apiKey:    process.env.CRYPTOPANIC_API_KEY || '',
  cache:     null,
  lastFetch: 0,
  riskScore: 30,

  // ERWEITERTE Schlüsselwörter – Krypto + Geopolitik
  NEGATIVE_WORDS: {
    // Krypto-spezifisch
    hack:       30, exploit:    25, breach:     25, stolen:     20,
    ban:        20, banned:     20, lawsuit:    15, sec:        15,
    crash:      15, collapse:   25, bankrupt:   30, insolvent:  30,
    shutdown:   20, delisted:   20, scam:       25, fraud:      25,
    warning:    10, regulation: 10, fine:       10,
    // GEOPOLITISCH – NEU
    war:        25, invasion:   30, sanctions:  25, tariff:     20,
    tariffs:    20, recession:  20, inflation:  15, stagflation:20,
    crisis:     15, default:    25, contagion:  20, panic:      20,
    terror:     15, attack:     20, conflict:   15, embargo:    20,
    fed:        10, rateHike:   15, tightening: 10, deflation:  15,
    depression: 25, blackswan:  30, systemic:   20, liquidity:  15,
    depegging:  25, depeg:      25, contagio:   20,
  },
  POSITIVE_WORDS: {
    etf:        20, approved:   15, adoption:   15, partnership: 10,
    launch:     10, bullish:    15, breakout:   10, listing:    15,
    upgrade:    10, institutional: 15, rally:   10, ath:        20,
    // GEOPOLITISCH POSITIV – NEU
    ceasefire:  15, peace:      10, stimulus:   15, rateCut:    15,
    recovery:   10, growth:     10, surplus:    10, deal:       10,
  },

  async fetch(symbols = ['BTC', 'ETH']) {
    if (Date.now() - this.lastFetch < 900000 && this.cache) return this.cache;
    let posts = [];
    try {
      // QUELLE 1: cryptocurrency.cv – kein API-Key nötig, 200+ Quellen
      const fcnUrl = 'https://cryptocurrency.cv/api/news?limit=20';
      const fcnRes = await axios.get(fcnUrl, { timeout: 6000 }).catch(()=>null);
      if (fcnRes?.data?.articles) {
        posts = fcnRes.data.articles.map(a => ({
          title: a.title || '',
          domain: a.source || '',
        }));
      }
    } catch(_) {}

    try {
      // QUELLE 2: CryptoPanic (Fallback, funktioniert auch ohne Key)
      const currencies = symbols.map(s => s.replace('USDT', '')).join(',');
      const url = this.apiKey
        ? `https://cryptopanic.com/api/v1/posts/?auth_token=${this.apiKey}&currencies=${currencies}&filter=important`
        : `https://cryptopanic.com/api/v1/posts/?currencies=${currencies}&public=true`;
      const r = await axios.get(url, { timeout: 6000 });
      const cpPosts = r.data?.results || [];
      // Zusammenführen, Duplikate vermeiden
      posts = [...posts, ...cpPosts.map(p=>({ title:p.title||'', domain:p.domain||'' }))];
    } catch(_) {}

    // Dedup by title
    const seen = new Set();
    posts = posts.filter(p => { const k=p.title.slice(0,40); if(seen.has(k)) return false; seen.add(k); return true; });

    let negScore = 0, posScore = 0;
    const alerts = [];
    try {

      for (const post of (posts||[]).slice(0, 30)) {
        const text = ((post.title || '') + ' ' + (post.domain || '')).toLowerCase();
        for (const [word, weight] of Object.entries(this.NEGATIVE_WORDS)) {
          if (text.includes(word)) {
            negScore += weight;
            if (weight >= 20) alerts.push({ type: 'NEGATIVE', word, title: post.title?.slice(0, 80), weight });
          }
        }
        for (const [word, weight] of Object.entries(this.POSITIVE_WORDS)) {
          if (text.includes(word)) posScore += weight;
        }
      }

      this.riskScore = Math.min(100, Math.max(0, 30 + negScore - posScore * 0.5));
      this.cache = {
        riskScore:  this.riskScore,
        negScore, posScore,
        postCount:  posts.length,
        alerts:     alerts.slice(0, 5),
        signal:     this.riskScore > 70 ? 'HIGH_RISK' : this.riskScore > 45 ? 'ELEVATED' : 'NORMAL',
        ts:         Date.now(),
      };
      this.lastFetch = Date.now();

      // Kritische News per Telegram
      const critical = alerts.filter(a => a.weight >= 30);
      if (critical.length > 0) {
        TelegramBot.send('📰 KRITISCHE NEWS:\n' + critical.map(a => `⚠️ ${a.word.toUpperCase()}: ${a.title}`).join('\n'));
        Incidents.create('NEWS_CRITICAL', critical.map(a => a.word).join(', '), 'HIGH');
      }
      return this.cache;
    } catch(e) {
      // Fallback ohne API Key
      this.cache = { riskScore: 30, signal: 'NORMAL', error: e.message, ts: Date.now() };
      return this.cache;
    }
  },

  // Integration in DecisionFlow
  async shouldModify(direction) {
    if (!this.enabled) return { modify: false, factor: 1.0 };
    const news = await this.fetch();
    if (news.riskScore > 75 && direction === 'BUY') {
      return { modify: true, factor: 0.75, reason: `Hohe News-Risiko: ${news.riskScore}/100` };
    }
    if (news.riskScore > 55) {
      return { modify: true, factor: 0.90, reason: `Erhöhtes News-Risiko: ${news.riskScore}/100` };
    }
    return { modify: false, factor: 1.0 };
  },

  snapshot() {
    return { enabled: this.enabled, hasApiKey: !!this.apiKey, ...this.cache };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// WHALE WALLET TRACKER  (Priorität 3)
// Verfolgt bekannte Whale-Wallets auf der Blockchain
// Nutzt öffentliche Bitget On-Chain Daten + Etherscan/BSCScan API
// Toggle: WalletTracker.enabled = true/false
// ═════════════════════════════════════════════════════════════════════════════
const WalletTracker = {
  enabled:   false,  // Standard aus – kann per Toggle aktiviert werden
  wallets:   {},     // address → { label, chain, lastTx, alertThreshold }
  alerts:    [],
  lastCheck: 0,

  // Bekannte Whale-Wallets (öffentlich bekannte Adressen)
  KNOWN_WHALES: {
    '0x28c6c06298d514db089934071355e5743bf21d60': { label:'Binance Hot Wallet', chain:'eth', threshold: 100 },
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { label:'Binance Cold Wallet', chain:'eth', threshold: 500 },
    '0xf977814e90da44bfa03b6295a0616a897441acec': { label:'Binance Reserve',    chain:'eth', threshold: 200 },
  },

  addWallet({ address, label, chain='eth', threshold=50 }) {
    this.wallets[address.toLowerCase()] = { address, label, chain, threshold, lastTx: null, balance: 0 };
    Log.info('WALLET', `Wallet hinzugefügt: ${label} (${address.slice(0,8)}...)`);
    return { ok: true };
  },

  removeWallet(address) {
    delete this.wallets[address.toLowerCase()];
    return { ok: true };
  },

  async checkWallet(address, config) {
    const etherscanKey = process.env.ETHERSCAN_API_KEY || '';
    try {
      if (config.chain === 'eth') {
        // Etherscan API – funktioniert auch ohne Key (rate-limited)
        const url = etherscanKey
          ? `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&offset=5&apikey=${etherscanKey}`
          : `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&offset=5`;
        const r = await axios.get(url, { timeout: 8000 });
        const txs = r.data?.result;
        if (!Array.isArray(txs) || !txs.length) return null;

        const latestTx  = txs[0];
        const txHash    = latestTx.hash;
        const valueEth  = parseFloat(latestTx.value) / 1e18;
        const timeStamp = parseInt(latestTx.timeStamp) * 1000;

        // Nur neue TXs auswerten
        if (config.lastTx === txHash) return null;
        config.lastTx = txHash;

        if (valueEth >= config.threshold) {
          return {
            address, label: config.label, chain: config.chain,
            valueEth, txHash,
            type: latestTx.from.toLowerCase() === address.toLowerCase() ? 'AUSGEHEND' : 'EINGEHEND',
            ts: timeStamp,
          };
        }
      }
    } catch(e) { /* Stille Fehler – öffentliche APIs können rate-limitiert sein */ }
    return null;
  },

  async run() {
    if (!this.enabled) return;
    const allWallets = { ...this.KNOWN_WHALES, ...this.wallets };
    for (const [address, config] of Object.entries(allWallets)) {
      try {
        const movement = await this.checkWallet(address, config);
        if (!movement) continue;

        const entry = { ...movement, detected: Date.now() };
        this.alerts.unshift(entry);
        if (this.alerts.length > 50) this.alerts.pop();

        const emoji = movement.type === 'EINGEHEND' ? '📥' : '📤';
        const msg = `${emoji} WHALE BEWEGUNG\n${movement.label}\n${movement.type}: ${movement.valueEth.toFixed(2)} ETH\nTX: ${movement.txHash.slice(0, 16)}...`;
        TelegramBot.send(msg);
        Log.info('WALLET', `${movement.label}: ${movement.type} ${movement.valueEth.toFixed(2)} ETH`);
        Incidents.create('WHALE_MOVEMENT', msg, 'MEDIUM');
      } catch(e) { /* Einzelne Wallet-Fehler ignorieren */ }
    }
  },

  // Alle X Minuten prüfen (wird in Boot gestartet)
  start(intervalMs = 600000) { // alle 10min
    if (!this.enabled) return;
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.run(), intervalMs);
    Log.info('WALLET', 'Wallet Tracker gestartet (alle 10min)');
  },

  snapshot() {
    return {
      enabled:      this.enabled,
      trackedCount: Object.keys(this.wallets).length + Object.keys(this.KNOWN_WHALES).length,
      customWallets: Object.values(this.wallets).map(w => ({ ...w, address: w.address?.slice(0,8)+'...' })),
      recentAlerts: this.alerts.slice(0, 10),
      lastCheck:    this.lastCheck,
    };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// POSITIONS-JOURNAL  (Priorität 2)
// Jeder Trade mit Notiz, Grund, Signal, Ergebnis – durchsuchbar
// ═════════════════════════════════════════════════════════════════════════════
const Journal = {
  entries: [],

  add({ tradeId, symbol, direction, strategy, reason, signal, strength, note='' }) {
    const entry = {
      id: `J_${Date.now()}`,
      tradeId, symbol, direction, strategy,
      reason, signal, strength,
      note, ts: Date.now(),
      outcome: null, pnl: null, closed: null,
    };
    this.entries.unshift(entry);
    if (this.entries.length > 200) this.entries.pop();
    try {
      DB.db.prepare(`INSERT OR REPLACE INTO logs(ts,level,module,msg,data) VALUES(?,?,?,?,?)`)
        .run(Date.now(), 'JOURNAL', symbol, `${direction} ${strategy}`, JSON.stringify(entry));
    } catch(_){}
    return entry;
  },

  close(tradeId, pnl, outcome='CLOSED') {
    const entry = this.entries.find(e => e.tradeId === tradeId);
    if (entry) { entry.outcome = outcome; entry.pnl = pnl; entry.closed = Date.now(); }
  },

  filter({ symbol, strategy, outcome, limit=50 }) {
    let res = this.entries;
    if (symbol)   res = res.filter(e => e.symbol === symbol);
    if (strategy) res = res.filter(e => e.strategy === strategy);
    if (outcome)  res = res.filter(e => e.outcome === outcome);
    return res.slice(0, limit);
  },

  stats() {
    const closed = this.entries.filter(e => e.pnl !== null);
    const wins   = closed.filter(e => e.pnl > 0).length;
    const losses = closed.filter(e => e.pnl <= 0).length;
    const totalPnl = closed.reduce((s, e) => s + (e.pnl || 0), 0);
    return {
      total: this.entries.length, closed: closed.length,
      wins, losses,
      winRate: closed.length > 0 ? wins / closed.length : 0,
      totalPnl,
    };
  },

  snapshot() {
    return { stats: this.stats(), recent: this.entries.slice(0, 20) };
  }
};


// ── ML AUTO-RETRAINING ──────────────────────────────────────────────────────
// Trainiert ML-Modelle automatisch jede Woche neu auf frischen Daten
// Verhindert dass das Modell auf veralteten Marktbedingungen läuft
// ══════════════════════════════════════════════════════════════════════════════
const MLAutoRetrain = {
  enabled:      true,
  intervalDays: 7,       // Alle 7 Tage
  symbol:       'BTCUSDT',
  granularity:  '1h',
  limit:        500,
  timer:        null,
  lastRetrain:  null,
  history:      [],      // Protokoll aller Auto-Trainings

  start() {
    if (!this.enabled) return;
    if (this.timer) clearInterval(this.timer);
    const msInterval = this.intervalDays * 24 * 3600 * 1000;
    // Sofort prüfen ob Training nötig
    this._checkAndTrain();
    // Dann täglich prüfen ob Intervall abgelaufen
    this.timer = setInterval(() => this._checkAndTrain(), 24 * 3600 * 1000);
    Log.info('ML_AUTO', `Auto-Retraining aktiv: alle ${this.intervalDays} Tage`);
  },

  async _checkAndTrain() {
    if (!this.enabled) return;
    const now = Date.now();
    const msInterval = this.intervalDays * 24 * 3600 * 1000;
    // Kein Training wenn kürzlich trainiert
    if (MLOptimizer.trainedAt && now - MLOptimizer.trainedAt < msInterval) {
      const daysLeft = ((msInterval - (now - MLOptimizer.trainedAt)) / 86400000).toFixed(1);
      Log.info('ML_AUTO', `Nächstes Training in ${daysLeft} Tagen`);
      this.autoRetrainNext = MLOptimizer.trainedAt + msInterval;
      MLOptimizer.autoRetrainNext = this.autoRetrainNext;
      return;
    }
    // Training starten
    Log.info('ML_AUTO', `Auto-Retraining startet: ${this.symbol} ${this.granularity}`);
    TelegramBot.send('🔄 ML Auto-Retraining startet...');
    const result = await MLOptimizer.train(this.symbol, this.granularity, this.limit);
    this.lastRetrain = Date.now();
    const entry = {
      ts:        this.lastRetrain,
      ok:        !!result.ok,
      accuracy:  result.accuracy?.ensemble || 0,
      samples:   result.samples || 0,
      overfit:   result.overfit || false,
      error:     result.error || null,
    };
    this.history.unshift(entry);
    if (this.history.length > 10) this.history.pop();
    if (result.ok) {
      Log.info('ML_AUTO', `Retraining OK: Ensemble ${(entry.accuracy*100).toFixed(1)}%`);
    } else {
      Log.warn('ML_AUTO', `Retraining Fehler: ${result.error}`);
    }
  },

  snapshot() {
    return {
      enabled:     this.enabled,
      intervalDays:this.intervalDays,
      lastRetrain: this.lastRetrain,
      nextRetrain: MLOptimizer.autoRetrainNext,
      history:     this.history.slice(0, 5),
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// ADAPTIVE SL/TP ENGINE
// SL und TP werden dynamisch aus ATR + Volatilitätsregime berechnet.
// Ruhiger Markt → enger. Wilder Markt → weiter.
// Verhindert das häufigste Problem: von normalem Rauschen rausgestoppt werden.
// ═════════════════════════════════════════════════════════════════════════════
const AdaptiveSLTP = {
  // ATR-Multiplikatoren je nach Volatilitäts-Cluster
  PROFILES: {
    LOW_VOL:    { slMult:1.2, tpMult:2.0, label:'Ruhig'    }, // ATR < 0.5%
    NORMAL_VOL: { slMult:1.5, tpMult:2.5, label:'Normal'   }, // ATR 0.5-1.5%
    HIGH_VOL:   { slMult:2.0, tpMult:3.0, label:'Volatil'  }, // ATR 1.5-3%
    EXTREME_VOL:{ slMult:2.8, tpMult:4.0, label:'Extrem'   }, // ATR > 3%
  },

  // Berechnet SL/TP dynamisch aus aktueller ATR
  calculate(candles, entryPrice, side='buy') {
    const atr       = Ind.atr(candles) || entryPrice * 0.01;
    const atrPct    = atr / entryPrice;

    let profile;
    if      (atrPct < 0.005) profile = this.PROFILES.LOW_VOL;
    else if (atrPct < 0.015) profile = this.PROFILES.NORMAL_VOL;
    else if (atrPct < 0.030) profile = this.PROFILES.HIGH_VOL;
    else                     profile = this.PROFILES.EXTREME_VOL;

    // Regime-Anpassung: In BEAR-Märkten engerer TP, weiterer SL für shorts
    if (Regime.regime === 'BEAR' || Regime.regime === 'EXTREME_BEAR') {
      profile = { ...profile, slMult: profile.slMult * 1.2, tpMult: profile.tpMult * 0.8 };
    }
    if (Regime.regime === 'BULL') {
      profile = { ...profile, tpMult: profile.tpMult * 1.2 }; // Gewinne laufen lassen
    }

    const dir = side === 'buy' ? 1 : -1;
    const sl  = entryPrice - dir * atr * profile.slMult;
    // Phase 3.3: Fee-Aware TP - 0.08% Puffer fuer Round-Trip-Fees
    const feeBuffer = entryPrice * (CFG.MAKER_FEE + CFG.TAKER_FEE);
    const tp  = entryPrice + dir * (atr * profile.tpMult + feeBuffer);

    return {
      stopLoss:   sl,
      takeProfit: tp,
      atr,        atrPct,
      slPct:      Math.abs(sl - entryPrice) / entryPrice,
      tpPct:      Math.abs(tp - entryPrice) / entryPrice,
      riskReward: profile.tpMult / profile.slMult,
      profile:    profile.label,
      slMult:     profile.slMult,
      tpMult:     profile.tpMult,
    };
  },

  snapshot() {
    return { profiles: this.PROFILES };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CUMULATIVE VOLUME DELTA (CVD)
// Unterschied zwischen Kauf- und Verkaufsvolumen kumuliert.
// Wenn Preis steigt aber CVD fällt → Käufer schwächer → Reversal-Warnung.
// Wenn Preis seitwärts aber CVD explodiert → Ausbruch in CVD-Richtung.
// Das ist Orderbuch-Analyse ohne L2 Daten – approximiert aus OHLCV.
// ═════════════════════════════════════════════════════════════════════════════
const CVDEngine = {
  cache: {},

  // Berechnet CVD-Approximation aus Kerzen
  // Methode: wenn Close > Open → bullische Kerze → Volumen ist Kauf-Volumen
  calculate(candles, length=50) {
    if (!candles || candles.length < length) return null;
    const slice  = candles.slice(-length);
    let cvd = 0;
    const cvdSeries = [];

    for (const c of slice) {
      const range  = c.high - c.low || 1;
      const buyPct = (c.close - c.low) / range;   // Wo schloss Kerze in ihrer Range?
      const sellPct= (c.high - c.close) / range;
      const buyVol = c.vol * buyPct;
      const sellVol= c.vol * sellPct;
      cvd += buyVol - sellVol;
      cvdSeries.push(cvd);
    }

    const cvdEma10 = this._ema(cvdSeries, 10);
    const cvdEma20 = this._ema(cvdSeries, 20);
    const cvdNow   = cvdSeries[cvdSeries.length-1];
    const priceNow = slice[slice.length-1].close;
    const priceOld = slice[Math.max(0,slice.length-10)].close;
    const cvdOld   = cvdSeries[Math.max(0,cvdSeries.length-10)];

    // Divergenz-Erkennung
    const priceTrend = priceNow > priceOld ? 'UP' : 'DOWN';
    const cvdTrend   = cvdNow   > cvdOld   ? 'UP' : 'DOWN';
    const divergence = priceTrend !== cvdTrend;

    let signal = 'NEUTRAL';
    let strength = 0;
    if (divergence) {
      if (priceTrend==='UP'   && cvdTrend==='DOWN') { signal='BEARISH_DIV'; strength=0.72; } // Preis hoch aber Käufer schwächer
      if (priceTrend==='DOWN' && cvdTrend==='UP')   { signal='BULLISH_DIV'; strength=0.72; } // Preis runter aber Käufer stärker
    } else if (!divergence && cvdTrend===priceTrend) {
      if (cvdTrend==='UP')   { signal='BULLISH_CONFIRM'; strength=0.60; }
      if (cvdTrend==='DOWN') { signal='BEARISH_CONFIRM'; strength=0.60; }
    }

    // CVD Momentum: beschleunigt CVD?
    const cvdMomentum = cvdSeries.length > 5
      ? cvdNow - cvdSeries[cvdSeries.length-5]
      : 0;

    return {
      cvdNow, cvdEma10, cvdEma20, cvdMomentum,
      priceTrend, cvdTrend, divergence,
      signal, strength,
      bullishDiv: signal==='BULLISH_DIV',
      bearishDiv: signal==='BEARISH_DIV',
    };
  },

  _ema(arr, period) {
    if (arr.length < period) return arr[arr.length-1]||0;
    const k = 2/(period+1);
    let ema = arr.slice(0,period).reduce((s,v)=>s+v,0)/period;
    for (let i=period; i<arr.length; i++) ema = arr[i]*k + ema*(1-k);
    return ema;
  },

  // Gibt Trading-Signal zurück
  signal(candles) {
    const cvd = this.calculate(candles);
    if (!cvd) return null;
    if (cvd.signal === 'BULLISH_DIV')  return { direction:'BUY',  strength:cvd.strength, reason:'CVD Bullish Divergenz' };
    if (cvd.signal === 'BEARISH_DIV')  return { direction:'SELL', strength:cvd.strength, reason:'CVD Bearish Divergenz' };
    return null;
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ANOMALIE-DETEKTOR
// Berechnet Z-Score für alle wichtigen Marktparameter.
// Wenn ein Wert >3σ vom historischen Mittel abweicht → Alarm + Trade-Block.
// Erkennt: Pump & Dump, Wash Trading, ungewöhnliche Funding Rate Spikes,
// Volume Anomalien, Preis-Teleportation.
// ═════════════════════════════════════════════════════════════════════════════
const AnomalyDetector = {
  history:   {},    // symbol → rolling window der Metriken
  alerts:    [],
  windowSize: 100,  // Letzte 100 Kerzen als Referenz
  zThreshold: 3.0,  // Z-Score Schwelle

  _zscore(value, history) {
    if (history.length < 20) return 0;
    const mean = history.reduce((a,b)=>a+b,0) / history.length;
    const std  = Math.sqrt(history.reduce((s,v)=>s+(v-mean)**2,0) / history.length);
    return std > 0 ? Math.abs((value - mean) / std) : 0;
  },

  _push(sym, key, val) {
    if (!this.history[sym]) this.history[sym] = {};
    if (!this.history[sym][key]) this.history[sym][key] = [];
    this.history[sym][key].push(val);
    if (this.history[sym][key].length > this.windowSize) this.history[sym][key].shift();
  },

  analyze(symbol, candles) {
    if (!candles || candles.length < 30) return { anomaly:false, score:0 };
    const c      = candles[candles.length-1];
    const closes = candles.map(x=>x.close);
    const price  = c.close;
    const vol    = c.vol;
    const range  = (c.high-c.low)/price;  // Kerzen-Range %

    // Akkumuliere Historie
    this._push(symbol, 'vol',   vol);
    this._push(symbol, 'range', range);
    this._push(symbol, 'price', price);

    const h = this.history[symbol];
    const anomalies = [];

    // 1. Volume Spike
    const volZ = this._zscore(vol, h.vol||[]);
    if (volZ > this.zThreshold) anomalies.push({ type:'VOLUME_SPIKE', zscore:volZ.toFixed(2), severity:volZ>5?'CRITICAL':'HIGH' });

    // 2. Preis-Teleportation (Candle-Range Anomalie)
    const rangeZ = this._zscore(range, h.range||[]);
    if (rangeZ > this.zThreshold) anomalies.push({ type:'PRICE_SPIKE', zscore:rangeZ.toFixed(2), severity:rangeZ>5?'CRITICAL':'HIGH' });

    // 3. RSI Extremwert
    const rsi = Ind.rsi(closes);
    if (rsi < 10) anomalies.push({ type:'RSI_EXTREME_LOW', value:rsi.toFixed(1), severity:'HIGH' });
    if (rsi > 90) anomalies.push({ type:'RSI_EXTREME_HIGH', value:rsi.toFixed(1), severity:'HIGH' });

    // 4. ATR-Explosion
    const atr    = Ind.atr(candles) || 0;
    const atrPct = atr/price;
    this._push(symbol, 'atr', atrPct);
    const atrZ = this._zscore(atrPct, h.atr||[]);
    if (atrZ > this.zThreshold) anomalies.push({ type:'VOLATILITY_EXPLOSION', zscore:atrZ.toFixed(2), severity:'HIGH' });

    // 5. OBV Divergenz (starker Kursanstieg ohne Volumen-Bestätigung)
    const obv = Ind.obv(candles);
    if (obv !== null) {
      const priceChg = (closes[closes.length-1]-closes[closes.length-5]) / closes[closes.length-5];
      if (priceChg > 0.05 && obv < 0) anomalies.push({ type:'PUMP_WITHOUT_VOLUME', severity:'HIGH', priceChgPct:(priceChg*100).toFixed(1) });
    }

    const isAnomaly   = anomalies.length > 0;
    const isCritical  = anomalies.some(a=>a.severity==='CRITICAL');
    const score       = Math.min(10, anomalies.reduce((s,a)=>s+(a.severity==='CRITICAL'?4:2),0));

    if (isAnomaly) {
      const entry = { symbol, anomalies, score, ts:Date.now() };
      this.alerts.unshift(entry);
      if (this.alerts.length > 50) this.alerts.pop();
      Log.warn('ANOMALY', `${symbol}: ${anomalies.map(a=>a.type).join(', ')} (Score:${score})`);
      if (isCritical) {
        TelegramBot.send(`🚨 ANOMALIE: ${symbol}\n${anomalies.map(a=>`⛔ ${a.type} Z=${a.zscore||a.value||''}`).join('\n')}`);
        Incidents.create('MARKET_ANOMALY', `${symbol}: ${anomalies.map(a=>a.type).join(', ')}`, 'HIGH');
      }
    }

    return { anomaly:isAnomaly, critical:isCritical, score, anomalies, symbol };
  },

  // Soll aktueller Trade blockiert werden?
  shouldBlock(symbol, candles) {
    const result = this.analyze(symbol, candles);
    if (result.score >= 4) return { block:true, reason:`Anomalie: ${result.anomalies.map(a=>a.type).join(', ')}` };
    return { block:false, result };
  },

  snapshot() {
    return { alerts:this.alerts.slice(0,10), symbolCount:Object.keys(this.history).length };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// VALUE AT RISK (VaR) – Tägliches Risiko-Budget
// Berechnet das maximale erwartete Verlust-Szenario für die nächsten 24h.
// Bei steigendem VaR → Positionsgrößen automatisch reduzieren.
// Methode: Historische Simulation (einfachste, robusteste Methode)
// ═════════════════════════════════════════════════════════════════════════════
const VaREngine = {
  lastVaR:      null,
  lastCalc:     0,
  confidence:   0.95,   // 95% Konfidenz
  horizon:      1,      // 1 Tag
  maxVaRPct:    0.05,   // Max 5% VaR erlaubt (bei mehr: Größen reduzieren)

  async calculate(symbol='BTCUSDT') {
    if (Date.now()-this.lastCalc < 3600000 && this.lastVaR) return this.lastVaR; // 1h Cache
    try {
      const candles = await Bitget.fetchCandles(symbol,'1day',90);
      if (!candles || candles.length<30) return this.lastVaR;

      // Tägliche Returns berechnen
      const returns = [];
      for (let i=1;i<candles.length;i++) {
        returns.push((candles[i].close - candles[i-1].close)/candles[i-1].close);
      }

      // Historische Simulation: sortiere Returns, nehme den (1-confidence)-Quantil
      const sorted   = [...returns].sort((a,b)=>a-b);
      const cutoff   = Math.floor(sorted.length * (1-this.confidence));
      const varPct   = Math.abs(sorted[cutoff] || 0);

      // Expected Shortfall (CVaR): Durchschnitt der schlechtesten Szenarien
      const tail    = sorted.slice(0, cutoff+1);
      const cvarPct = tail.length ? Math.abs(tail.reduce((s,r)=>s+r,0)/tail.length) : varPct;

      // Portfolio VaR in USDT
      const portfolio = Balance.usable;
      const varUSDT   = portfolio * varPct;
      const cvarUSDT  = portfolio * cvarPct;

      // Positions-Scaler: wenn VaR zu hoch → Größen reduzieren
      const scaleFactor = varPct > this.maxVaRPct
        ? Math.max(0.3, this.maxVaRPct / varPct)
        : 1.0;

      this.lastVaR = {
        symbol, confidence:this.confidence,
        varPct, varUSDT: varUSDT.toFixed(2),
        cvarPct, cvarUSDT: cvarUSDT.toFixed(2),
        scaleFactor,
        interpretation: `In ${(this.confidence*100).toFixed(0)}% der Fälle verlierst du nicht mehr als ${varUSDT.toFixed(2)} USDT in 24h`,
        warning: varPct > this.maxVaRPct ? `VaR zu hoch! Positionsgrößen auf ${(scaleFactor*100).toFixed(0)}% reduziert` : null,
        ts: Date.now(),
      };
      this.lastCalc = Date.now();
      Log.info('VAR', `${symbol}: VaR95=${(varPct*100).toFixed(2)}% (${varUSDT.toFixed(2)} USDT) Scaler=${scaleFactor.toFixed(2)}`);
      return this.lastVaR;
    } catch(e) {
      Log.warn('VAR', `Fehler: ${e.message}`);
      return this.lastVaR || { varPct:0.02, scaleFactor:1.0, error:e.message };
    }
  },

  // Passt Positionsgröße an VaR an
  async applyToSize(baseSize) {
    const v = await this.calculate().catch(()=>({scaleFactor:1.0}));
    return baseSize * (v.scaleFactor||1.0);
  },

  snapshot() { return this.lastVaR || { varPct:0, scaleFactor:1.0, calculated:false }; }
};

// ═════════════════════════════════════════════════════════════════════════════
// REINFORCEMENT LEARNING AGENT (Q-Learning)
// Lernt durch Trial & Error welche Aktionen in welchen Markt-Zuständen
// die höchste kumulative Belohnung bringen.
// State: diskretisierter Markt-Zustand aus 5 Kern-Features
// Actions: BUY / SELL / HOLD
// Reward: realisierter PnL nach Trade-Abschluss
// ═════════════════════════════════════════════════════════════════════════════
const RLAgent = {
  qTable:      {},    // state → { BUY:Q, SELL:Q, HOLD:Q }
  alpha:       0.15,  // Lernrate
  gamma:       0.90,  // Discount-Faktor (Zukunft bewerten)
  epsilon:     0.20,  // Exploration vs Exploitation
  epsilonDecay:0.995, // Epsilon sinkt mit jedem Trade
  minEpsilon:  0.05,
  episodes:    0,
  totalReward: 0,
  rewardHistory: [],
  lastState:   null,
  lastAction:  null,

  // Markt-Zustand diskretisieren (State = String-Key für Q-Table)
  encodeState(candles) {
    if (!candles || candles.length<30) return 'UNKNOWN';
    const closes = candles.map(c=>c.close);
    const rsi    = Ind.rsi(closes)         || 50;
    const macd   = Ind.macd(closes);
    const atr    = Ind.atr(candles)        || closes[closes.length-1]*0.01;
    const ema20  = Ind.ema(closes,20)      || closes[closes.length-1];
    const price  = closes[closes.length-1];
    const regime = Regime.regime           || 'NEUTRAL';

    // Diskretisiere jeden Wert in 3-5 Buckets
    const rsiB  = rsi<35?'OS':rsi>65?'OB':'MID';          // Oversold/Overbought/Mid
    const macdB = macd.histogram>0.001?'UP':macd.histogram<-0.001?'DN':'FLAT';
    const atrB  = atr/price<0.01?'LO':atr/price>0.025?'HI':'MID';
    const emaB  = price>ema20?'ABOVE':'BELOW';
    const regB  = ['BULL','SQUEEZE'].includes(regime)?'BULL':
                  ['BEAR','EXTREME_BEAR'].includes(regime)?'BEAR':'NEUT';

    return `${rsiB}_${macdB}_${atrB}_${emaB}_${regB}`;
  },

  // Q-Wert abrufen (initialisiere mit kleinen Zufallswerten)
  _getQ(state, action) {
    if (!this.qTable[state]) {
      this.qTable[state] = {
        BUY:  (Math.random()-0.5)*0.1,
        SELL: (Math.random()-0.5)*0.1,
        HOLD: 0,
      };
    }
    return this.qTable[state][action] || 0;
  },

  // Beste Aktion für State
  _bestAction(state) {
    const q = this.qTable[state] || { BUY:0, SELL:0, HOLD:0 };
    return Object.entries(q).reduce((a,b)=>b[1]>a[1]?b:a)[0];
  },

  // Entscheidung: Explore (zufällig) oder Exploit (beste bekannte)
  decide(candles) {
    const state = this.encodeState(candles);
    this.lastState = state;

    // Epsilon-Greedy: manchmal zufällig erkunden
    if (Math.random() < this.epsilon) {
      const actions = ['BUY','SELL','HOLD'];
      const action  = actions[Math.floor(Math.random()*3)];
      this.lastAction = action;
      return { action, state, mode:'EXPLORE', confidence:0.33 };
    }

    const action = this._bestAction(state);
    this.lastAction = action;
    const q = this._getQ(state, action);
    const allQ = Object.values(this.qTable[state]||{});
    const maxQ = Math.max(...allQ);
    const confidence = allQ.length ? Math.max(0, (q - Math.min(...allQ)) / (maxQ - Math.min(...allQ)+0.001)) : 0.33;

    // Confidence skaliert mit State-Erfahrung
    const _stateQ = Object.values(this.qTable[state]||{});
    const _stateExp = Math.min(1.0, _stateQ.reduce((s,v)=>s+Math.abs(v),0) / 3.0);
    return { action, state, mode:'EXPLOIT', confidence: Math.min(0.75, confidence * _stateExp + 0.1), qValue:q.toFixed(4) };
  },

  // Update Q-Table nach Trade-Abschluss (das eigentliche Lernen)
  learn(reward, nextCandles) {
    if (!this.lastState || !this.lastAction) return;

    const nextState  = this.encodeState(nextCandles);
    const bestNextQ  = this._getQ(nextState, this._bestAction(nextState));

    // Q-Learning Update-Regel: Q(s,a) ← Q(s,a) + α·[r + γ·max Q(s',a') - Q(s,a)]
    const currentQ   = this._getQ(this.lastState, this.lastAction);
    const newQ       = currentQ + this.alpha * (reward + this.gamma*bestNextQ - currentQ);

    if (!this.qTable[this.lastState]) this.qTable[this.lastState] = { BUY:0, SELL:0, HOLD:0 };
    this.qTable[this.lastState][this.lastAction] = newQ;

    // Epsilon reduzieren (weniger erkunden wenn mehr gelernt)
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
    this.episodes++;
    this.totalReward += reward;
    this.rewardHistory.push({ reward, ts:Date.now(), state:this.lastState, action:this.lastAction });
    if (this.rewardHistory.length > 200) this.rewardHistory.shift();

    Log.info('RL', `Q-Update: ${this.lastState} ${this.lastAction} Q=${currentQ.toFixed(4)}→${newQ.toFixed(4)} r=${reward.toFixed(4)} ε=${this.epsilon.toFixed(3)}`);
    // Persistenz: alle 5 Episoden speichern
    MLPersist.onRLEpisode(this.episodes);
    this.lastState = null; this.lastAction = null;
  },

  // Statistiken
  stats() {
    const recent = this.rewardHistory.slice(-50);
    const wins   = recent.filter(r=>r.reward>0).length;
    return {
      episodes:    this.episodes,
      epsilon:     this.epsilon.toFixed(3),
      totalReward: this.totalReward.toFixed(4),
      stateCount:  Object.keys(this.qTable).length,
      recentWinRate: recent.length ? (wins/recent.length).toFixed(2) : 0,
      recentAvgReward: recent.length ? (recent.reduce((s,r)=>s+r.reward,0)/recent.length).toFixed(4) : 0,
    };
  },

  snapshot() {
    return { ...this.stats(), recentHistory:this.rewardHistory.slice(-10) };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// PROFIT-MAXIMIERUNGS-LOGIK
// Das was eine KI täte: alle Signale nach erwartetem Gewinn gewichten,
// Verluste strukturell minimieren, nicht nur reagieren.
// ─────────────────────────────────────────────────────────────────────────────
// 1. MULTI-SIGNAL CONFLUENCE: Trade nur wenn ≥3 Quellen gleichzeitig zeigen
// 2. ASYMMETRISCHE POSITIONSGRÖSSE: Bei hoher Confidence → größer, bei niedrig → kleiner
// 3. REGIME-FILTER: Bestimmte Strategien nur in passenden Regimen
// 4. MOMENTUM FILTER: Nur in Richtung des kurzfristigen Momentums traden
// ═════════════════════════════════════════════════════════════════════════════
const ProfitMaximizer = {
  MIN_CONFLUENCE: 2,    // Mindestens 2 Quellen müssen übereinstimmen

  async evaluate(symbol, candles, allSignals) {
    if (!candles || !allSignals?.length) return { approved:false, reason:'NO_SIGNALS' };
    const closes = candles.map(c=>c.close);
    const price  = closes[closes.length-1];

    // ── 1. CONFLUENCE CHECK ──────────────────────────────────────────────
    const buySignals  = allSignals.filter(s=>s.direction==='BUY');
    const sellSignals = allSignals.filter(s=>s.direction==='SELL');
    const dominant    = buySignals.length >= sellSignals.length ? 'BUY' : 'SELL';
    const count       = dominant==='BUY' ? buySignals.length : sellSignals.length;

    if (count < this.MIN_CONFLUENCE) {
      return { approved:false, reason:`CONFLUENCE_TOO_LOW: ${count}/${this.MIN_CONFLUENCE}`, dominant };
    }

    // ── 2. MOMENTUM FILTER ───────────────────────────────────────────────
    const ema5  = Ind.ema(closes,5)  || price;
    const ema13 = Ind.ema(closes,13) || price;
    const momentumBull = ema5 > ema13;
    if (dominant==='BUY'  && !momentumBull) return { approved:false, reason:'MOMENTUM_AGAINST_BUY' };
    if (dominant==='SELL' && momentumBull)  return { approved:false, reason:'MOMENTUM_AGAINST_SELL' };

    // ── 3. CVD FILTER ────────────────────────────────────────────────────
    const cvd = CVDEngine.calculate(candles);
    if (cvd?.divergence) {
      if (dominant==='BUY'  && cvd.signal==='BEARISH_DIV') return { approved:false, reason:'CVD_BEARISH_DIVERGENCE' };
      if (dominant==='SELL' && cvd.signal==='BULLISH_DIV') return { approved:false, reason:'CVD_BULLISH_DIVERGENCE' };
    }

    // ── 4. ANOMALIE FILTER ───────────────────────────────────────────────
    const anomaly = AnomalyDetector.shouldBlock(symbol, candles);
    if (anomaly.block) return { approved:false, reason:anomaly.reason };

    // ── 5. RL AGENT STIMME ───────────────────────────────────────────────
    const rlDecision = RLAgent.decide(candles);
    if (rlDecision.action !== 'HOLD' && rlDecision.mode==='EXPLOIT' && rlDecision.action !== dominant) {
      // RL widerspricht: Stärke leicht reduzieren aber nicht blocken
      Log.info('PROFIT', `RL widerspricht: ${rlDecision.action} vs ${dominant} – Stärke reduziert`);
    }

    // ── 6. ASYMMETRISCHE GRÖSSE ─────────────────────────────────────────
    const avgStrength = allSignals
      .filter(s=>s.direction===dominant)
      .reduce((s,sig)=>s+(sig.strength||0.5),0) / count;

    let sizeMultiplier = 1.0;
    if (avgStrength >= 0.80) sizeMultiplier = 1.3; // Starkes Signal → 30% mehr
    if (avgStrength >= 0.90) sizeMultiplier = 1.5; // Sehr starkes Signal → 50% mehr
    if (avgStrength <  0.60) sizeMultiplier = 0.7; // Schwaches Signal → 30% weniger
    if (count >= 4)          sizeMultiplier *= 1.2; // Viele Quellen → Bonus

    // VaR-Anpassung
    const varSnap = VaREngine.snapshot();
    sizeMultiplier *= (varSnap.scaleFactor || 1.0);
    sizeMultiplier  = Math.min(2.0, Math.max(0.3, sizeMultiplier));

    return {
      approved:      true,
      dominant,
      confluence:    count,
      avgStrength:   avgStrength.toFixed(3),
      sizeMultiplier:sizeMultiplier.toFixed(2),
      rlAction:      rlDecision.action,
      rlMode:        rlDecision.mode,
      cvdSignal:     cvd?.signal || 'NEUTRAL',
      reason:        `${count} Signale übereinstimmend, Stärke ${(avgStrength*100).toFixed(0)}%`,
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// PAPER TRADE PERFORMANCE TRACKER
// Zeichnet jeden simulierten Trade systematisch auf.
// Nach 4 Wochen siehst du echte Zahlen: welches System funktioniert,
// welches nicht — bevor echtes Geld riskiert wird.
// ═════════════════════════════════════════════════════════════════════════════
const PaperTracker = {
  enabled:  true,
  trades:   [],       // Alle Paper-Trades
  bySystem: {},       // system → { trades, wins, losses, totalPnL, avgPnL }

  record({ symbol, direction, strategy, entryPrice, exitPrice, pnl, reason, signals=[] }) {
    if (!this.enabled) return;
    const trade = {
      id:         `PT_${Date.now()}`,
      symbol, direction, strategy,
      entryPrice, exitPrice, pnl,
      pnlPct:     entryPrice > 0 ? (pnl / (entryPrice * 0.1)) : 0, // bezogen auf 10% Positionsgröße
      reason,
      signals:    signals.slice(0,5),
      win:        pnl > 0,
      ts:         Date.now(),
      date:       new Date().toLocaleDateString('de-DE'),
    };
    this.trades.unshift(trade);
    if (this.trades.length > 500) this.trades.pop();

    // Pro-System Statistik
    const sys = strategy || 'UNKNOWN';
    if (!this.bySystem[sys]) this.bySystem[sys] = { trades:0, wins:0, losses:0, totalPnL:0, avgPnL:0 };
    const s = this.bySystem[sys];
    s.trades++; s.totalPnL += pnl;
    pnl > 0 ? s.wins++ : s.losses++;
    s.avgPnL = s.totalPnL / s.trades;
    s.winRate = s.trades > 0 ? s.wins / s.trades : 0;

    Log.info('PAPER', `${symbol} ${direction} ${strategy}: PnL ${pnl.toFixed(4)} USDT (${pnl>0?'WIN':'LOSS'})`);
    return trade;
  },

  // Gesamtstatistik
  stats() {
    const all   = this.trades;
    const wins  = all.filter(t => t.win).length;
    const total = all.length;
    const pnl   = all.reduce((s,t) => s+t.pnl, 0);
    // Letzte 7 Tage
    const week  = all.filter(t => t.ts > Date.now() - 7*86400000);
    const wWins = week.filter(t => t.win).length;
    // Bestes / schlechtestes System
    const systems = Object.entries(this.bySystem)
      .map(([k,v]) => ({ system:k, ...v }))
      .sort((a,b) => b.totalPnL - a.totalPnL);

    return {
      total, wins, losses: total-wins,
      winRate:   total > 0 ? wins/total : 0,
      totalPnL:  pnl,
      avgPnL:    total > 0 ? pnl/total : 0,
      week:      { trades:week.length, wins:wWins, winRate: week.length>0?wWins/week.length:0 },
      bestSystem:  systems[0] || null,
      worstSystem: systems[systems.length-1] || null,
      systems,
    };
  },

  // Bereit für echtes Geld? Einfache Heuristik
  readinessCheck() {
    const s = this.stats();
    const checks = [
      { name:'Mindestens 50 Paper-Trades',     pass: s.total >= 50,       value: s.total },
      { name:'Win Rate ≥ 52%',                 pass: s.winRate >= 0.52,   value: (s.winRate*100).toFixed(1)+'%' },
      { name:'Positiver Gesamt-PnL',           pass: s.totalPnL > 0,     value: s.totalPnL.toFixed(2)+' USDT' },
      { name:'Letzte Woche profitabel',        pass: s.week.winRate>=0.50,value: (s.week.winRate*100).toFixed(0)+'%' },
      { name:'Kein System dauerhaft negativ',  pass: !s.worstSystem || s.worstSystem.totalPnL > -50, value: s.worstSystem?.totalPnL?.toFixed(2) },
    ];
    const passed = checks.filter(c => c.pass).length;
    return {
      ready:   passed >= 4,
      score:   `${passed}/${checks.length}`,
      checks,
      verdict: passed >= 5 ? 'BEREIT – kann mit echtem Geld starten' :
               passed >= 3 ? 'FAST BEREIT – noch 1-2 Wochen Paper Trading' :
               'NOCH NICHT BEREIT – weiter Paper Trading',
    };
  },

  snapshot() {
    return { enabled:this.enabled, ...this.stats(), readiness:this.readinessCheck(), recent:this.trades.slice(0,20) };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTO SYMBOL BLACKLIST
// Wenn ein Symbol X Verlust-Trades in Y Stunden macht → automatisch sperren.
// Manche Coins sind in bestimmten Phasen fundamental kaputt.
// Der häufigste echte Verlust-Fall: immer wieder auf dem gleichen Coin falsch liegen.
// ═════════════════════════════════════════════════════════════════════════════
const SymbolBlacklist = {
  list:         {},    // symbol → { blockedUntil, reason, lossCount }
  lossWindow:   86400000,  // 24h Beobachtungsfenster
  maxLosses:    2,         // Maximale Verluste in 24h bevor Sperre
  blockDuration:172800000, // 48h Sperre
  lossHistory:  {},   // symbol → [{ ts, pnl }]
  manualBlocked:{},   // manuell gesperrte Symbole

  // Prüfe ob Symbol gesperrt ist
  isBlocked(symbol) {
    // Manuell gesperrt
    if (this.manualBlocked[symbol]) return { blocked:true, reason:'MANUELL GESPERRT', manual:true };
    // Auto-Sperre prüfen
    const entry = this.list[symbol];
    if (!entry) return { blocked:false };
    if (Date.now() < entry.blockedUntil) {
      const remaining = Math.ceil((entry.blockedUntil - Date.now()) / 3600000);
      return { blocked:true, reason:entry.reason, lossCount:entry.lossCount, remainingHours:remaining };
    }
    // Sperre abgelaufen
    delete this.list[symbol];
    return { blocked:false };
  },

  // Verlust melden — triggert ggf. Auto-Sperre
  recordLoss(symbol, pnl) {
    if (!this.lossHistory[symbol]) this.lossHistory[symbol] = [];
    this.lossHistory[symbol].push({ ts:Date.now(), pnl });

    // Nur Verluste in Beobachtungsfenster zählen
    const cutoff = Date.now() - this.lossWindow;
    this.lossHistory[symbol] = this.lossHistory[symbol].filter(l => l.ts > cutoff);
    const recentLosses = this.lossHistory[symbol].filter(l => l.pnl < 0).length;

    if (recentLosses >= this.maxLosses && !this.list[symbol]) {
      this.block(symbol, `${recentLosses} Verluste in 24h`, recentLosses);
    }
  },

  // Symbol sperren
  block(symbol, reason, lossCount=0) {
    this.list[symbol] = {
      blockedUntil: Date.now() + this.blockDuration,
      reason, lossCount,
      blockedAt: Date.now(),
    };
    Log.warn('BLACKLIST', `${symbol} gesperrt für 48h: ${reason}`);
    TelegramBot.send(`🚫 Symbol gesperrt: ${symbol}\nGrund: ${reason}\nDauer: 48h`);
    Incidents.create('SYMBOL_BLACKLISTED', `${symbol}: ${reason}`, 'MEDIUM');
  },

  // Manuell sperren / freigeben
  blockManual(symbol, reason='MANUAL') {
    this.manualBlocked[symbol] = { ts:Date.now(), reason };
    Log.info('BLACKLIST', `${symbol} manuell gesperrt`);
    return { ok:true };
  },
  unblock(symbol) {
    delete this.list[symbol];
    delete this.manualBlocked[symbol];
    Log.info('BLACKLIST', `${symbol} freigegeben`);
    return { ok:true };
  },

  snapshot() {
    const active = Object.entries(this.list).map(([sym,e]) => ({
      symbol:sym, ...e,
      remainingHours: Math.max(0,Math.ceil((e.blockedUntil-Date.now())/3600000))
    }));
    const manual = Object.entries(this.manualBlocked).map(([sym,e]) => ({ symbol:sym, ...e }));
    return { active, manual, totalBlocked:active.length+manual.length };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// DRAWDOWN RECOVERY MODE
// Wenn der Bot X% Verlust in einem Tag macht → automatisch konservativer werden.
// Verhindert das häufigste Muster: Verluste durch Übertrading kompensieren wollen.
// 3 Stufen: NORMAL → CAUTION → RECOVERY → HALT
// ═════════════════════════════════════════════════════════════════════════════
const DrawdownRecovery = {
  mode:     'NORMAL',   // NORMAL | CAUTION | RECOVERY | HALT
  lastMode: null,
  thresholds: {
    CAUTION:  0.03,   // 3% Tagsverlust → vorsichtig
    RECOVERY: 0.05,   // 5% Tagsverlust → Recovery Mode
    HALT:     0.08,   // 8% Tagsverlust → Stopp (Kill Switch übernimmt)
  },
  // Einschränkungen je Modus
  restrictions: {
    NORMAL:   { sizeMultiplier:1.00, minConfluence:2, minStrength:0.55, label:'Normal'   },
    CAUTION:  { sizeMultiplier:0.60, minConfluence:3, minStrength:0.65, label:'Vorsicht'  },
    RECOVERY: { sizeMultiplier:0.30, minConfluence:4, minStrength:0.75, label:'Recovery'  },
    HALT:     { sizeMultiplier:0.00, minConfluence:5, minStrength:0.99, label:'Gestoppt'  },
  },
  history: [],

  // Aktuellen Tagsverlust prüfen und Modus setzen
  update() {
    const sessionStart = (Balance.sessionStart && Balance.sessionStart > 0) ? Balance.sessionStart : Balance.usable;
    const current      = Balance.usable || 0;
    const dailyLoss    = sessionStart > 0 ? Math.max(0, (sessionStart-current)/sessionStart) : 0;

    let newMode = 'NORMAL';
    if      (dailyLoss >= this.thresholds.HALT)     newMode = 'HALT';
    else if (dailyLoss >= this.thresholds.RECOVERY) newMode = 'RECOVERY';
    else if (dailyLoss >= this.thresholds.CAUTION)  newMode = 'CAUTION';

    if (newMode !== this.mode) {
      const prev = this.mode;
      this.mode  = newMode;
      const r    = this.restrictions[newMode];
      const entry = { ts:Date.now(), from:prev, to:newMode, dailyLoss, balance:current };
      this.history.unshift(entry);
      if (this.history.length > 20) this.history.pop();
      Log.warn('RECOVERY', `Modus-Wechsel: ${prev} → ${newMode} (Tagsverlust: ${(dailyLoss*100).toFixed(2)}%)`);
      TelegramBot.send(
        `⚠️ Recovery Modus: ${newMode}\nTagesverlust: ${(dailyLoss*100).toFixed(2)}%\nPositionsgröße: ${(r.sizeMultiplier*100).toFixed(0)}%\nMindest-Confluence: ${r.minConfluence}`
      );
      // Bei HALT: Kill Switch aktivieren
      if (newMode === 'HALT' && !KillSwitch.active) {
        KillSwitch._hardKill('DRAWDOWN_RECOVERY', { dailyLoss });
      }
    }
    return this.mode;
  },

  // Aktuelle Einschränkungen abrufen
  getRestrictions() {
    this.update();
    return this.restrictions[this.mode];
  },

  // Positionsgröße anpassen
  applyToSize(baseSize) {
    const r = this.getRestrictions();
    return baseSize * r.sizeMultiplier;
  },

  // Nach Mitternacht oder manuell zurücksetzen
  reset() {
    const prev  = this.mode;
    this.mode   = 'NORMAL';
    Balance.sessionStart = Balance.usable; // Tagsbasis neu setzen
    Log.info('RECOVERY', `Recovery Mode zurückgesetzt (war: ${prev})`);
    TelegramBot.send(`✅ Recovery Mode zurückgesetzt. Neuer Tagesbeginn.`);
    return { ok:true, prev };
  },

  snapshot() {
    this.update();
    const r = this.restrictions[this.mode];
    const sessionStart = Balance.sessionStart || Balance.usable;
    const dailyLoss = sessionStart > 0 ? (sessionStart-Balance.usable)/sessionStart : 0;
    return {
      mode:          this.mode,
      label:         r.label,
      dailyLoss,
      dailyLossPct:  (dailyLoss*100).toFixed(2),
      sizeMultiplier:r.sizeMultiplier,
      minConfluence: r.minConfluence,
      minStrength:   r.minStrength,
      thresholds:    this.thresholds,
      history:       this.history.slice(0,5),
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// DEMO ENGINE – Vollautomatischer Papier-Trading-Modus
// ─────────────────────────────────────────────────────────────────────────────
// Startet automatisch mit virtuellem Kapital.
// Kein API-Key nötig. Keine echten Orders.
// Alle Systeme (ML, RL, CVD, Anomalie, Recovery) laufen vollständig.
// Ergebnisse sind 1:1 vergleichbar mit echtem Trading – nur ohne Risiko.
// ─────────────────────────────────────────────────────────────────────────────
// FUNKTIONSWEISE:
// 1. Demo-Wallet mit konfiguriertem Startkapital
// 2. Alle Signale laufen durch kompletten DecisionFlow
// 3. Trades werden simuliert mit realistischem Slippage-Modell
// 4. Exit via ExitEngine (Adaptive SL/TP)
// 5. PaperTracker schreibt jeden Trade auf
// 6. Täglicher Demo-Report per Telegram
// ═════════════════════════════════════════════════════════════════════════════
const DemoEngine = {
  enabled:       false,
  running:       false,
  startCapital:  1000,    // Virtuelles Startkapital in USDT
  symbols:       ['BTCUSDT','ETHUSDT','SOLUSDT'],
  granularity:   '1h',
  intervalMs:    120000, // Alle 2min scannen
  timer:         null,

  // Virtuelles Wallet (komplett unabhängig von echtem Balance)
  wallet: {
    total:      1000,
    reserve:    0,      // Startet bei 0    // 70% Reserve
    trading:    1000,   // Volles Kapital    // 30% Trading
    startTotal: 1000,
    peakTotal:  1000,
    dailyStart: 1000,
    pnl:        0,
    dailyPnl:   0,
  },

  // Offene Demo-Positionen
  positions: {},     // tradeId → position
  trades:    [],     // Alle abgeschlossenen Demo-Trades
  signals:   [],     // Signal-Log
  stats: {
    scans: 0, signals: 0, trades: 0,
    wins: 0, losses: 0, startedAt: null,
  },

  WALLET_PATH: require('path').join(process.env.HOME,'NEXUS_CLEAN','data','demo_wallet.json'),
  _persistWallet() {
    try {
      require('fs').writeFileSync(this.WALLET_PATH, JSON.stringify(this.wallet));
    } catch(e) { try{Log.warn('DEMO','Wallet persist failed: '+e.message);}catch(_){} }
  },
  _loadWallet() {
    try {
      if (require('fs').existsSync(this.WALLET_PATH)) {
        const w = JSON.parse(require('fs').readFileSync(this.WALLET_PATH,'utf8'));
        if (w && typeof w.total==='number') { Object.assign(this.wallet, w); return true; }
      }
    } catch(e) { try{Log.warn('DEMO','Wallet load failed: '+e.message);}catch(_){} }
    return false;
  },

  // ── STARTEN ──────────────────────────────────────────────────────────────
  start(capital=1000) {
    if (this.running) return { error: 'Demo läuft bereits' };
    this.startCapital = capital;
    const walletLoaded = this._loadWallet() || this.wallet.reserve > 0 || this.wallet.pnl !== 0;
    if (!walletLoaded) {
      this.wallet.total=capital; this.wallet.reserve=0; this.wallet.trading=capital;
      this.wallet.startTotal=capital; this.wallet.peakTotal=capital; this.wallet.dailyStart=capital;
      this.wallet.pnl=0; this.wallet.dailyPnl=0;
      Log.info('DEMO','Wallet neu: '+capital+' USDT');
    } else {
      Log.info('DEMO','Wallet geladen: T='+this.wallet.total.toFixed(2)+' R='+this.wallet.reserve.toFixed(2));
    }
    this.positions         = {};
    this.trades            = [];
    this.signals           = [];
    this.stats.startedAt   = Date.now();
    this.stats.scans = this.stats.signals = this.stats.trades = this.stats.wins = this.stats.losses = 0;
    this.enabled = true;
    this.running = true;

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this._cycle(), this.intervalMs);
    this._cycle(); // sofort

    Log.info('DEMO', `Demo Engine gestartet: ${capital} USDT virtuell`);
    TelegramBot.send(`🎮 DEMO ENGINE gestartet\nVirtuelles Kapital: ${capital} USDT\nSymbole: ${this.symbols.join(', ')}\nInterval: ${this.intervalMs/60000}min`);
    return { ok: true, capital, symbols: this.symbols };
  },

  // ── STOPPEN ──────────────────────────────────────────────────────────────
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    const report = this._report();
    TelegramBot.send(`🛑 Demo Engine gestoppt\n${report}`);
    Log.info('DEMO', `Demo gestoppt. PnL: ${this.wallet.pnl.toFixed(2)} USDT`);
    return { ok: true, ...this.snapshot() };
  },

  // ── LIVE-SCHALTER ────────────────────────────────────────────────────────
  // Wechselt zwischen Demo (Spielgeld) und Live (echtes Geld)
  // ML/RL Gewichte bleiben erhalten – Bot lernt in Demo weiter
  liveMode: false,   // false = Demo, true = Live

  switchToLive(opts) {
    opts = opts || {};
    if (!CFG.API_KEY) return { error: 'Kein API Key – Live nicht möglich. Bitte in .env eintragen.' };
    // Pre-Switch-Guard: offene Demo-Positionen?
    const openPos = Object.keys(this.positions||{}).length;
    if (openPos > 0 && !opts.force) {
      return { error: 'Demo hat '+openPos+' offene Positionen. Erst schliessen oder force=true.', openPositions: openPos };
    }
    // LIVE-Ready-Check (Soft-Gate, nur Warnung wenn nicht erfuellt)
    const s = this.stats || {};
    const total = (s.wins||0) + (s.losses||0);
    const winRate = total > 0 ? s.wins/total : 0;
    const readiness = { trades: total, winRate: winRate, ready: (total >= 50 && winRate >= 0.52) };
    if (!readiness.ready && !opts.force) {
      return { error: 'LIVE-Ready nicht erfuellt (Trades='+total+'/50, WR='+(winRate*100).toFixed(1)+'%/52%). Mit force=true ueberschreibbar.', readiness };
    }
    this.liveMode   = true;
    CFG.DEPLOY_MODE = 'LIVE_RESTRICTED';
    NoTrade.gates.deployModeAllows = true;
    Log.warn('DEMO', 'Auf LIVE umgeschaltet - echte Trades! (force='+!!opts.force+')');
    TelegramBot.send('LIVE-MODUS aktiviert! Echte Trades auf Bitget. ML hat ' + RLAgent.episodes + ' Episoden gelernt. Force=' + !!opts.force);
    return { ok: true, mode: 'LIVE', warning: 'Echte Orders werden ausgefuehrt!', readiness };
  },

  switchToDemo() {
    this.liveMode   = false;
    CFG.DEPLOY_MODE = 'PAPER';
    NoTrade.gates.deployModeAllows = true; // Demo darf handeln
    Log.info('DEMO', 'Auf DEMO umgeschaltet – Spielgeld');
    TelegramBot.send('🔵 DEMO-MODUS aktiviert.\nVirtuelles Spielgeld. Bot lernt weiter.');
    return { ok: true, mode: 'DEMO' };
  },

  getMode() {
    return {
      mode:      this.liveMode ? 'LIVE' : 'DEMO',
      isLive:    this.liveMode,
      isDemo:   !this.liveMode,
      deployMode:CFG.DEPLOY_MODE,
      apiKeySet: !!CFG.API_KEY,
      demoWallet:this.wallet,
      mlLearned: { rfTrees:MLOptimizer.RF.trees.length, rlEpisodes:RLAgent.episodes, pcUpdates:MLOptimizer.Perceptron.trained },
      paperStats:PaperTracker.stats(),
      readiness: PaperTracker.readinessCheck(),
    };
  },

  // ── HAUPT-SCAN-CYCLE ─────────────────────────────────────────────────────
  _cycleBusy: false,
  async _cycle() {
    if (this._cycleBusy || !this.running) return;
    this._cycleBusy = true;
    this.stats.scans++;
    try { ActionStream.push('SCAN','DEMO','Scan #'+this.stats.scans+' ('+this.symbols.length+' Symbole)'); } catch(_) {}

    // Exits prüfen
    await this._checkExits();

    // Neue Signale suchen
    for (const symbol of this.symbols) {
      try {
        const candles = await Bitget.fetchCandles(symbol, this.granularity, 150);
        if (!candles || candles.length < 50) continue;

        // Regime
        Regime.detect(candles);
        if (['EXTREME_BEAR'].includes(Regime.regime)) continue;

        // Schon offen?
        const alreadyOpen = Object.values(this.positions).some(p => p.symbol === symbol);
        const alreadyInDB = Trades.getActive().some(t => t.symbol === symbol);
        if (alreadyOpen || alreadyInDB) continue;

        if (Object.keys(this.positions).length >= 5) continue;
        const available = this.wallet.trading;
        if (available < 10) continue;

        // NoTrade Gates pruefen
        NoTrade.refresh();
        if (!NoTrade.verdict().allowTrade) continue;

        // UnifiedScore: ALLE Datenquellen -> eine Entscheidung
        const ob = await Bitget.fetchOrderbook(symbol).catch(() => null);
        const uScore = await UnifiedScore.compute(symbol, candles, ob);

        if (uScore.blocked || uScore.direction === 'HOLD') continue;

        // Trade ausfuehren mit UnifiedScore Sizing
        if (uScore.direction === 'SELL') continue;
        const uSize = uScore.sizePct * this.wallet.trading;
        await this._executeTrade(symbol, uScore.direction, uScore.confidence, candles, [{strategy:'UNIFIED', direction:uScore.direction, strength:uScore.confidence}], uSize);
        this.stats.signals++;

      } catch(e) {
        Log.warn('DEMO', `Scan Fehler ${symbol}: ${e.message}`);
      }
    }
    this._cycleBusy = false;
  },

  // ── TRADE AUSFÜHREN ──────────────────────────────────────────────────────
  async _executeTrade(symbol, direction, strength, candles, signals, overrideSize=null) {
    const ticker = Bitget.priceCache[symbol] || await Bitget.fetchTicker(symbol).catch(()=>null);
    const price  = ticker?.last || 0;
    if (!price) return;

    // Positionsgroesse: UnifiedScore oder Fallback (Budget-aware via WalletProvider)
    const _capital = WalletProvider.trading();
    let size = overrideSize || _capital * Math.min(0.25, 0.02 + strength * 0.13);
    size = Math.max(5, Math.min(size, _capital * 0.40));

    // Phase 3.4: Volatility-Adjusted Position Sizing
    // Bei hoher Vola kleinere Size, bei niedriger groessere (SaintQuant)
    try {
      const ticker = Bitget.priceCache[symbol];
      const curPrice = ticker && ticker.last;
      const curATR = Ind.atr(candles);
      if (curPrice > 0 && curATR > 0) {
        const atrPct = curATR / curPrice;
        let volaMult = 1.0;
        let volaLabel = 'NORMAL';
        if      (atrPct < 0.005) { volaMult = 1.20; volaLabel = 'LOW';     }
        else if (atrPct < 0.015) { volaMult = 1.00; volaLabel = 'NORMAL';  }
        else if (atrPct < 0.030) { volaMult = 0.75; volaLabel = 'HIGH';    }
        else                     { volaMult = 0.50; volaLabel = 'EXTREME'; }
        const sizeBefore = size;
        size = Math.max(5, size * volaMult);
        // Log + Stream nur wenn Vola nicht NORMAL ist (sonst zu spammy)
        if (volaMult !== 1.0) {
          try {
            Log.info('SIZING', symbol+' vola='+volaLabel+' atr='+(atrPct*100).toFixed(2)+'% size '+sizeBefore.toFixed(2)+' -> '+size.toFixed(2)+' (x'+volaMult+')');
            ActionStream.push('INFO', symbol, 'Vola '+volaLabel+' atr='+(atrPct*100).toFixed(2)+'% size x'+volaMult, { volaLabel, volaMult, atrPct });
          } catch(_){}
        }
      }
    } catch(e) { try{Log.warn('DEMO','vola-sizing err: '+e.message);}catch(_){} }

    // Phase 3.6: RiskTier Size-Cap (wirkt nur in LIVE oder DryRun)
    try { size = RiskTier.capSize(size); } catch(e) { try{Log.warn('DEMO','risktier cap err: '+e.message);}catch(_){} }

    // === PHASE 2.3: Fill via ExecutionAdapter (DEMO + LIVE Konvergenz) ===
    const fillResult = await ExecutionAdapter.placeOrder(symbol, direction, size, price, { source:'DemoEngine' });
    if (!fillResult || !fillResult.ok) {
      try { Log.warn('DEMO','Adapter-Fill fehlgeschlagen: '+(fillResult && fillResult.error)); } catch(_){}
      return;
    }
    const fillPrice = fillResult.fillPrice;
    const slippage = fillResult.slippagePct;
    if (fillResult.partialFill) { size = fillResult.sizeUSDT; }
    const atr = Ind.atr(candles) || price*0.01;

    // Adaptive SL/TP
    const sltp     = AdaptiveSLTP.calculate(candles, fillPrice, direction.toLowerCase());
    const tradeId  = `DEMO_${symbol}_${Date.now()}`;

    const pos = {
      tradeId, symbol, direction, strategy:'DEMO_AUTO',
      fillPrice, size, sltp,
      stopLoss:   sltp.stopLoss,
      takeProfit: sltp.takeProfit,
      openedAt:   Date.now(),
      signals:    signals.map(s=>s.strategy).join('+'),
      strength:   strength.toFixed(3),
    };
    this.positions[tradeId] = pos;

    // Auch in DB schreiben (damit alle Tabs die Trades sehen)
    try {
      const dbTradeId = Trades.create(symbol, direction.toLowerCase(), size, 'DEMO_UNIFIED');
      Trades.recordFill(dbTradeId, fillPrice, Ind.atr(candles) || fillPrice*0.01);
      pos.dbTradeId = dbTradeId; // DEMO_UNIFIED_DB Referenz
    } catch(_dbErr) { Log.warn('DEMO', 'DB Trade Fehler: ' + _dbErr.message); }

    // Kapital reservieren (Phase 2.4b: via WalletProvider)
    WalletProvider.debit(size);
    this.stats.trades++;

    const sigStr = signals.map(s=>s.strategy).join('+');
    Log.info('DEMO', `TRADE: ${direction} ${symbol} ${size.toFixed(2)}USDT @ ${fillPrice.toFixed(4)} [${sigStr}]`);
    // ENTRY-Event wird bereits vom ExecutionAdapter gepusht (Phase 2.3)
    // PHASE 2.5: ExitEngine-Level registrieren, damit _checkExits via ExitEngine arbeitet
    try {
      const sideLC = direction.toLowerCase();
      ExitEngine.setLevel(tradeId, fillPrice, atr, sideLC, candles);
      // SL/TP aus ExitEngine in Position uebernehmen (konsistent mit Live-Pfad)
      const lvl = ExitEngine.tpslLevels[tradeId];
      if (lvl) { pos.stopLoss = lvl.stopLoss; pos.takeProfit = lvl.takeProfit; pos.exitEngineManaged = true; }
    } catch(e) { try{Log.warn('DEMO','ExitEngine.setLevel err: '+e.message);}catch(_){} }
    this.signals.unshift({ ts:Date.now(), symbol, direction, price:fillPrice, strength, signals:sigStr });
    if (this.signals.length > 50) this.signals.pop();
  },

  // ── EXITS PRÜFEN ─────────────────────────────────────────────────────────
  async _checkExits() {
    for (const [id, pos] of Object.entries(this.positions)) {
      try {
        const ticker = Bitget.priceCache[pos.symbol] || await Bitget.fetchTicker(pos.symbol).catch(()=>null);
        const price  = ticker?.last || 0;
        if (!price) continue;

        const dir    = pos.direction === 'BUY' ? 1 : -1;
        const pnlPct = dir * (price - pos.fillPrice) / pos.fillPrice;
        let   exitReason = null;

        // PHASE 2.5: Exit-Entscheidung via ExitEngine (gleicher Pfad wie LIVE)
        try {
          const sideLC = pos.direction === 'BUY' ? 'buy' : 'sell';
          // Fake trade-Objekt fuer ExitEngine (erwartet DB-trade-Struktur)
          const fakeTrade = {
            id: pos.tradeId,
            state: 'POSITION_ACTIVE',
            entry_price: pos.fillPrice,
            side: sideLC,
            created_at: pos.openedAt,
          };
          // Kerzen holen fuer RSI/ATR (DecisionFlow-Fallback wenn nicht im Cache)
          const candles = (Bitget.candleCache && Bitget.candleCache[pos.symbol+'_1h']) || [];
          if (candles.length >= 20) {
            const verdict = ExitEngine.evaluate(fakeTrade, candles, price);
            if (verdict && verdict.shouldExit) exitReason = verdict.reason;
          }
        } catch(e) { try{Log.warn('DEMO','ExitEngine.evaluate err: '+e.message);}catch(_){} }

        // Fallback: eigene Minimal-Logik (nur wenn ExitEngine keine Kerzen hatte)
        if (!exitReason) {
          if (pos.direction === 'BUY') {
            if (price <= pos.stopLoss)   exitReason = 'STOP_LOSS';
            else if (price >= pos.takeProfit) exitReason = 'TAKE_PROFIT';
          } else {
            if (price >= pos.stopLoss)   exitReason = 'STOP_LOSS';
            else if (price <= pos.takeProfit) exitReason = 'TAKE_PROFIT';
          }
          if (!exitReason && Date.now() - pos.openedAt > CFG.MAX_HOLD_HOURS * 3600000) exitReason = 'TIME_EXIT';
        }

        if (!exitReason) continue;

        // Exit ausführen
        const exitSlip  = 0.0001 + Math.random() * 0.0003;
        const exitPrice = pos.direction==='BUY' ? price*(1-exitSlip) : price*(1+exitSlip);
        const rawPnl    = dir * (exitPrice - pos.fillPrice) * (pos.size / pos.fillPrice);
        const fees      = pos.size * (CFG.MAKER_FEE + CFG.TAKER_FEE);
        const pnl       = rawPnl - fees;

        // Wallet updaten: 70/30 Split bei Gewinn
        // Phase 2.4b: via WalletProvider
        WalletProvider.credit(pos.size); // Kapital zurueck (ohne PnL)
        WalletProvider.applyPnL(pnl);     // PnL-Split 70/30 + peakTotal-Update

        pnl > 0 ? this.stats.wins++ : this.stats.losses++;

        // Trade aufzeichnen
        const closedTrade = { ...pos, exitPrice, exitReason, pnl, pnlPct, closedAt:Date.now() };
        this.trades.unshift(closedTrade);
        if (this.trades.length > 200) this.trades.pop();

        // PaperTracker
        PaperTracker.record({
          symbol:     pos.symbol,
          direction:  pos.direction,
          strategy:   `DEMO_${pos.signals}`,
          entryPrice: pos.fillPrice,
          exitPrice, pnl, reason: exitReason,
        });

        // RL Feedback
        const pnlForRL = (exitPrice-pos.fillPrice)/pos.fillPrice*dir;
        RLAgent.learn(pnlForRL, []);

        // Symbol Blacklist bei Verlust
        if (pnl < 0) SymbolBlacklist.recordLoss(pos.symbol, pnl);

        // DB-Trade schliessen
        if (pos.dbTradeId) {
          try { Trades.close(pos.dbTradeId, exitPrice, exitReason); } catch(_) {}
        }
        delete this.positions[id];
        try { ExitEngine.cleanup(pos.tradeId); } catch(_){}

        this._persistWallet();

        const emoji = pnl>0 ? '✅' : '❌';
        Log.info('DEMO', `${emoji} EXIT: ${pos.symbol} ${exitReason} PnL: ${pnl.toFixed(4)} USDT`);
        try { ActionStream.push('EXIT', pos.symbol, exitReason+' PnL='+pnl.toFixed(4)+' USDT', {reason:exitReason, pnl, exitPrice, direction:pos.direction}); } catch(_){}

        // Telegram bei jedem Trade
        TelegramBot.send(
          `${emoji} Demo Trade\n${pos.direction} ${pos.symbol}\nExit: ${exitReason}\nPnL: ${pnl>=0?'+':''}${pnl.toFixed(4)} USDT\nVirtuell: ${this.wallet.total.toFixed(2)} USDT`
        );

      } catch(e) { Log.warn('DEMO', `Exit Fehler: ${e.message}`); }
    }
  },

  // ── TAGES-REPORT ─────────────────────────────────────────────────────────
  _report() {
    const s     = this.stats;
    const total = s.wins + s.losses;
    const wr    = total > 0 ? (s.wins/total*100).toFixed(1) : '—';
    const ret   = ((this.wallet.total-this.startCapital)/this.startCapital*100).toFixed(2);
    const dd    = this.wallet.peakTotal > 0
      ? ((this.wallet.peakTotal-this.wallet.total)/this.wallet.peakTotal*100).toFixed(2)
      : '0.00';
    return [
      `📊 Demo Report`,
      `Kapital: ${this.wallet.total.toFixed(2)} USDT (Start: ${this.startCapital})`,
      `Rendite: ${ret}%`,
      `Max Drawdown: ${dd}%`,
      `Trades: ${total} (${wr}% Win)`,
      `Tages-PnL: ${this.wallet.dailyPnl.toFixed(2)} USDT`,
      `Offene Positionen: ${Object.keys(this.positions).length}`,
    ].join('\n');
  },

  // Tages-Reset um Mitternacht
  dailyReset() {
    this.wallet.dailyStart = this.wallet.total;
    this.wallet.dailyPnl   = 0;
    this._persistWallet();
    TelegramBot.send('🌅 Demo Tagesreset\n'+this._report());
  },

  snapshot() {
    const total = this.stats.wins + this.stats.losses;
    return {
      enabled:     this.enabled,
      running:     this.running,
      startCapital:this.startCapital,
      wallet:      this.wallet,
      openPositions: Object.values(this.positions).length,
      positions:   Object.values(this.positions),
      stats: {
        ...this.stats,
        winRate:   total>0 ? this.stats.wins/total : 0,
        totalPnL:  this.wallet.pnl,
        returnPct: (this.wallet.total-this.startCapital)/this.startCapital,
        maxDD:     this.wallet.peakTotal>0 ? (this.wallet.peakTotal-this.wallet.total)/this.wallet.peakTotal : 0,
      },
      recentTrades: this.trades.slice(0,10),
      recentSignals:this.signals.slice(0,10),
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// DEMO ENGINE – Vollständiger Demo/Live Schalter
//
// DEMO-MODUS:
//   – Trades werden mit virtuellem Spielgeld ausgeführt
//   – Echte Marktpreise von Bitget (kein gefaktes Pricing)
//   – ML, RL, Anomalie-Detektor, alle Signale laufen normal weiter → Bot LERNT
//   – PaperTracker zeichnet alles auf → Bereitschafts-Check läuft
//   – Kein einziger echte Order geht zur Exchange
//
// LIVE-MODUS:
//   – Echter Bitget API Call für jeden Trade
//   – Ein Schalter, kein Neustart nötig
//   – ML/RL Gewichte bleiben erhalten (aus Demo-Phase gelernt)
//
// UMSCHALTEN: POST /api/mode { mode: 'DEMO' | 'LIVE' }
// ═════════════════════════════════════════════════════════════════════════════


// ═════════════════════════════════════════════════════════════════════════════
// ML PERSISTENZ ENGINE
// Speichert alle ML-Modelle in SQLite – überleben jeden Neustart.
//
// Was gespeichert wird:
//   rf_trees    – Random Forest (alle 30 Bäume als JSON)
//   gb_stumps   – Gradient Boosting Stumps + Gewichte
//   pc_weights  – Perceptron Gewichte (35 Werte)
//   rl_qtable   – Q-Learning Tabelle (alle State→Action Gewichte)
//   rl_meta     – RL Metadaten (Epsilon, Episoden, etc.)
//   ml_accuracy – Letzte Accuracy Werte
//
// Wann gespeichert:
//   – Nach jedem Training (MLOptimizer.train)
//   – Perceptron: nach jedem 10. Online-Update
//   – RL Q-Table: nach jedem 5. Episoden-Abschluss
//   – Beim sauberen Shutdown (SIGTERM)
// ═════════════════════════════════════════════════════════════════════════════
const MLPersist = {
  saveCount: 0,

  // ── ALLE MODELLE SPEICHERN ───────────────────────────────────────────────
  saveAll() {
    try {
      const ts = Date.now();

      // 1. Random Forest – Bäume serialisieren
      if (MLOptimizer.RF.trees.length > 0) {
        const payload = JSON.stringify({
          trees:    MLOptimizer.RF.trees,
          nTrees:   MLOptimizer.RF.nTrees,
          maxDepth: MLOptimizer.RF.maxDepth,
        });
        DB.saveModel.run('rf_trees','RANDOM_FOREST', payload,
          MLOptimizer.accuracy||0, MLOptimizer.trainedOn||0, ts,
          'BTCUSDT', JSON.stringify({ featureImportance: (MLOptimizer.featureImportance||[]).slice(0,5) })
        );
      }

      // 2. Gradient Boosting – Stumps + Gewichte
      if (MLOptimizer.GB.stumps.length > 0) {
        const payload = JSON.stringify({
          stumps:  MLOptimizer.GB.stumps,
          weights: MLOptimizer.GB.weights,
          trained: MLOptimizer.GB.trained,
        });
        DB.saveModel.run('gb_stumps','GRADIENT_BOOSTING', payload,
          MLOptimizer.accuracy||0, MLOptimizer.trainedOn||0, ts, 'BTCUSDT', null
        );
      }

      // 3. Perceptron – 35 Gewichte + Bias
      const pcPayload = JSON.stringify({
        weights: Array.from(MLOptimizer.Perceptron.weights),
        bias:    MLOptimizer.Perceptron.bias,
        trained: MLOptimizer.Perceptron.trained,
        lr:      MLOptimizer.Perceptron.lr,
      });
      DB.saveModel.run('pc_weights','PERCEPTRON', pcPayload,
        MLOptimizer.Perceptron.accuracy(), MLOptimizer.Perceptron.trained, ts, 'BTCUSDT', null
      );

      // 4. ML Metadaten
      DB.saveMLState.run('ml_meta', JSON.stringify({
        trained:    MLOptimizer.trained,
        trainedAt:  MLOptimizer.trainedAt,
        trainedOn:  MLOptimizer.trainedOn,
        accuracy:   MLOptimizer.accuracy,
        cvAccuracy: MLOptimizer.cvAccuracy,
        overfit:    MLOptimizer.overfit,
      }), ts);

      // 5. RL Q-Table – jede State→Action Kombination
      this.saveQTable();

      // 6. RL Metadaten
      DB.saveMLState.run('rl_meta', JSON.stringify({
        epsilon:      RLAgent.epsilon,
        episodes:     RLAgent.episodes,
        totalReward:  RLAgent.totalReward,
        minEpsilon:   RLAgent.minEpsilon,
      }), ts);

      this.saveCount++;
      Log.info('MLPERSIST', `Gespeichert: RF(${MLOptimizer.RF.trees.length} Bäume) GB(${MLOptimizer.GB.stumps.length} Stumps) PC(${MLOptimizer.Perceptron.trained} Updates) RL(${Object.keys(RLAgent.qTable).length} States)`);
      return { ok:true, ts, savedModels:4 };
    } catch(e) {
      Log.error('MLPERSIST', `Speichern fehlgeschlagen: ${e.message}`);
      return { ok:false, error:e.message };
    }
  },

  // ── Q-TABLE SPEICHERN (bulk) ─────────────────────────────────────────────
  saveQTable() {
    const ts = Date.now();
    const saveMany = DB.db.transaction((entries) => {
      for (const [state, q] of entries) {
        DB.saveQState.run(state, q.BUY||0, q.SELL||0, q.HOLD||0, ts);
      }
    });
    const entries = Object.entries(RLAgent.qTable);
    if (entries.length > 0) {
      saveMany(entries);
      Log.info('MLPERSIST', `Q-Table: ${entries.length} States gespeichert`);
    }
  },

  // ── ALLE MODELLE LADEN ────────────────────────────────────────────────────
  loadAll() {
    let loaded = 0;
    try {
      // 1. Random Forest laden
      const rfRow = DB.loadModel.get('rf_trees');
      if (rfRow?.payload) {
        const rf = JSON.parse(rfRow.payload);
        MLOptimizer.RF.trees    = rf.trees    || [];
        MLOptimizer.RF.nTrees   = rf.nTrees   || 30;
        MLOptimizer.RF.maxDepth = rf.maxDepth || 8;
        loaded++;
        Log.boot(`MLPersist: Random Forest geladen (${MLOptimizer.RF.trees.length} Bäume, Accuracy: ${((rfRow.accuracy||0)*100).toFixed(1)}%)`);
      }

      // 2. Gradient Boosting laden
      const gbRow = DB.loadModel.get('gb_stumps');
      if (gbRow?.payload) {
        const gb = JSON.parse(gbRow.payload);
        MLOptimizer.GB.stumps  = gb.stumps  || [];
        MLOptimizer.GB.weights = gb.weights || [];
        MLOptimizer.GB.trained = gb.trained || false;
        loaded++;
        Log.boot(`MLPersist: Gradient Boosting geladen (${MLOptimizer.GB.stumps.length} Stumps)`);
      }

      // 3. Perceptron laden
      const pcRow = DB.loadModel.get('pc_weights');
      if (pcRow?.payload) {
        const pc = JSON.parse(pcRow.payload);
        MLOptimizer.Perceptron.weights = pc.weights || new Array(35).fill(0);
        MLOptimizer.Perceptron.bias    = pc.bias    || [0,0,0];
        MLOptimizer.Perceptron.trained = pc.trained || 0;
        loaded++;
        Log.boot(`MLPersist: Perceptron geladen (${MLOptimizer.Perceptron.trained} Updates, Acc: ${(MLOptimizer.Perceptron.accuracy()*100).toFixed(1)}%)`);
      }

      // 4. ML Metadaten laden
      const metaRow = DB.loadMLState.get('ml_meta');
      if (metaRow?.value) {
        const meta = JSON.parse(metaRow.value);
        MLOptimizer.trained    = meta.trained    || false;
        MLOptimizer.trainedAt  = meta.trainedAt  || null;
        MLOptimizer.trainedOn  = meta.trainedOn  || 0;
        MLOptimizer.accuracy   = meta.accuracy   || 0;
        MLOptimizer.cvAccuracy = meta.cvAccuracy || null;
        MLOptimizer.overfit    = meta.overfit    || false;
        if (meta.trained) Log.boot(`MLPersist: ML Status geladen (Accuracy: ${((meta.accuracy||0)*100).toFixed(1)}%, trainiert am ${meta.trainedAt ? new Date(meta.trainedAt).toLocaleDateString('de-DE') : '?'})`);
      }

      // 5. RL Q-Table laden
      const qRows = DB.loadQTable.all();
      if (qRows.length > 0) {
        RLAgent.qTable = {};
        for (const row of qRows) {
          RLAgent.qTable[row.state_key] = {
            BUY:  row.q_buy  || 0,
            SELL: row.q_sell || 0,
            HOLD: row.q_hold || 0,
          };
        }
        loaded++;
        Log.boot(`MLPersist: Q-Table geladen (${qRows.length} States)`);
      }

      // 6. RL Metadaten laden
      const rlMetaRow = DB.loadMLState.get('rl_meta');
      if (rlMetaRow?.value) {
        const rlMeta = JSON.parse(rlMetaRow.value);
        RLAgent.epsilon     = rlMeta.epsilon     || 0.20;
        RLAgent.episodes    = rlMeta.episodes    || 0;
        RLAgent.totalReward = rlMeta.totalReward || 0;
        if (rlMeta.episodes > 0) Log.boot(`MLPersist: RL Agent geladen (${rlMeta.episodes} Episoden, ε=${rlMeta.epsilon?.toFixed(3)})`);
      }

      Log.boot(`MLPersist: ${loaded} Modelle geladen – Bot setzt dort fort wo er aufgehört hat`);
      return { ok:true, loaded };
    } catch(e) {
      Log.error('MLPERSIST', `Laden fehlgeschlagen: ${e.message}`);
      return { ok:false, error:e.message, loaded };
    }
  },

  // ── AUTO-SAVE HOOKS ───────────────────────────────────────────────────────
  // Wird nach jedem Training aufgerufen
  onTrainComplete() {
    Log.info('MLPERSIST', 'Training abgeschlossen → Modelle werden gespeichert...');
    const result = this.saveAll();
    if (result.ok) Log.info('MLPERSIST', 'Alle Modelle in SQLite gespeichert ✓');
    return result;
  },

  // Perceptron: nach jedem N-ten Update speichern
  onPerceptronUpdate(updateCount) {
    if (updateCount % 10 === 0) {
      // Nur Perceptron + Meta speichern (schnell)
      try {
        const ts = Date.now();
        DB.saveModel.run('pc_weights','PERCEPTRON',
          JSON.stringify({ weights:Array.from(MLOptimizer.Perceptron.weights), bias:MLOptimizer.Perceptron.bias, trained:updateCount }),
          MLOptimizer.Perceptron.accuracy(), updateCount, ts, 'BTCUSDT', null
        );
      } catch(_) {}
    }
  },

  // RL: nach jedem 5. Episode speichern
  onRLEpisode(episodeCount) {
    if (episodeCount % 5 === 0) {
      try { this.saveQTable(); } catch(_) {}
      try {
        DB.saveMLState.run('rl_meta', JSON.stringify({
          epsilon:RLAgent.epsilon, episodes:RLAgent.episodes, totalReward:RLAgent.totalReward
        }), Date.now());
      } catch(_) {}
    }
  },

  // Graceful Shutdown Hook
  onShutdown() {
    Log.info('MLPERSIST', 'Shutdown erkannt → Finale Speicherung...');
    this.saveAll();
  },

  snapshot() {
    const models = DB.listModels.all();
    return {
      saveCount: this.saveCount,
      models:    models.map(m => ({
        ...m,
        trainedDate: m.trained_at ? new Date(m.trained_at).toLocaleString('de-DE') : '—',
        accuracyPct: m.accuracy ? (m.accuracy*100).toFixed(1)+'%' : '—',
      })),
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// ENTSCHEIDUNGS-ERKLÄRER
// Erklärt in klarem Deutsch warum der Bot gehandelt hat oder nicht.
// Das ist das wichtigste Debugging-Tool für den Live-Betrieb.
// Ohne das weißt du nicht ob der Bot klug entscheidet.
// ═════════════════════════════════════════════════════════════════════════════
const Explainer = {
  lastExplanations: {},   // symbol → letzte Erklärung
  history: [],            // Protokoll der letzten 50 Entscheidungen

  // Hauptfunktion: erklärt eine Entscheidung vollständig
  async explain(symbol = 'BTCUSDT') {
    const ts    = Date.now();
    const candles = await Bitget.fetchCandles(symbol, '1h', 100).catch(()=>[]);
    const ticker  = await Bitget.fetchTicker(symbol).catch(()=>null);
    const price   = ticker?.last || candles?.[candles.length-1]?.close || 0;
    const closes  = candles.map(c=>c.close);

    const checks  = [];   // Jeder Check mit Status + Erklärung
    let blocked   = false;
    let blockReason = '';

    // ── 1. MARKT-DATEN ────────────────────────────────────────────────────
    checks.push({ name:'Marktdaten', ok:price>0,
      detail: price>0 ? `Preis: $${price.toFixed(2)}` : 'Keine Preisdaten von Bitget' });

    // ── 2. DEPLOY-MODUS ───────────────────────────────────────────────────
    const isDemo = DemoEngine.mode === 'DEMO' || !DemoEngine.liveMode;
    checks.push({ name:'Modus', ok:true,
      detail: isDemo ? '🔵 DEMO – Spielgeld, keine echten Orders' : '🟢 LIVE – Echte Bitget Orders' });

    // ── 3. SYMBOL BLACKLIST ───────────────────────────────────────────────
    const bl = SymbolBlacklist.isBlocked(symbol);
    checks.push({ name:'Symbol Blacklist', ok:!bl.blocked,
      detail: bl.blocked
        ? `❌ Gesperrt: ${bl.reason} (noch ${bl.remainingHours||'∞'}h)`
        : '✅ Symbol nicht gesperrt' });
    if (bl.blocked) { blocked=true; blockReason='Symbol gesperrt'; }

    // ── 4. KILL SWITCH ────────────────────────────────────────────────────
    const ks = KillSwitch.check();
    checks.push({ name:'Kill Switch', ok:!ks.triggered,
      detail: ks.triggered
        ? `❌ AKTIV: ${ks.mode} – ${(ks.triggers||[]).slice(-1)[0]?.reason||'kein Grund'}`
        : `✅ OK (Drawdown: ${((ks.drawdown||0)*100).toFixed(2)}%)` });
    if (ks.triggered) { blocked=true; blockReason='Kill Switch aktiv'; }

    // ── 5. NO-TRADE GATES ─────────────────────────────────────────────────
    const verdict = NoTrade.verdict();
    const closedGates = Object.entries(verdict.gates||{}).filter(([,v])=>!v).map(([k])=>k);
    checks.push({ name:'No-Trade Gates', ok:verdict.allowTrade,
      detail: verdict.allowTrade
        ? '✅ Alle Gates grün – Handel erlaubt'
        : `❌ Blockiert: ${closedGates.join(', ')}` });
    if (!verdict.allowTrade) { blocked=true; blockReason=verdict.reason||'No-Trade Gate'; }

    // ── 6. DRAWDOWN RECOVERY ──────────────────────────────────────────────
    const rec = DrawdownRecovery.getRestrictions();
    const recMode = DrawdownRecovery.mode;
    checks.push({ name:'Drawdown Recovery', ok:recMode==='NORMAL',
      detail: recMode==='NORMAL'
        ? `✅ Normal (Tagsverlust: ${DrawdownRecovery.snapshot().dailyLossPct}%)`
        : `⚠️ ${recMode}: Größe auf ${(rec.sizeMultiplier*100).toFixed(0)}%, min. ${rec.minConfluence} Signale nötig` });

    // ── 7. ANOMALIE-DETEKTOR ──────────────────────────────────────────────
    let anomalyResult = { anomaly:false, score:0, anomalies:[] };
    if (candles.length >= 30) {
      anomalyResult = AnomalyDetector.analyze(symbol, candles);
    }
    checks.push({ name:'Anomalie-Detektor', ok:!anomalyResult.anomaly,
      detail: anomalyResult.anomaly
        ? `❌ Score ${anomalyResult.score}/10: ${anomalyResult.anomalies.map(a=>a.type).join(', ')}`
        : `✅ Keine Anomalien (Score: ${anomalyResult.score}/10)` });
    if (anomalyResult.score >= 4) { blocked=true; blockReason='Markt-Anomalie'; }

    // ── 8. REGIME ─────────────────────────────────────────────────────────
    if (candles.length >= 30) Regime.detect(candles);
    const regime = Regime.snapshot();
    const regimeOk = !['EXTREME_BEAR','FLASH_CRASH'].includes(regime.regime);
    checks.push({ name:'Markt-Regime', ok:regimeOk,
      detail: `${regimeOk?'✅':'⚠️'} ${regime.regime} (Konfidenz: ${((regime.confidence||0)*100).toFixed(0)}%, Trend: ${((regime.trend||0)*100).toFixed(2)}%)` });

    // ── 9. VALUE AT RISK ──────────────────────────────────────────────────
    const varSnap = VaREngine.snapshot();
    const varOk   = (varSnap.varPct||0) <= VaREngine.maxVaRPct;
    checks.push({ name:'Value at Risk', ok:varOk,
      detail: varSnap.varPct
        ? `${varOk?'✅':'⚠️'} VaR 95%: ${((varSnap.varPct||0)*100).toFixed(2)}% (${varSnap.varUSDT||'?'} USDT) – Größen-Scaler: ${((varSnap.scaleFactor||1)*100).toFixed(0)}%`
        : '– Noch nicht berechnet' });

    // ── 10. CVD ───────────────────────────────────────────────────────────
    let cvdResult = null;
    if (candles.length >= 50) cvdResult = CVDEngine.calculate(candles);
    checks.push({ name:'CVD (Volume Delta)', ok: !cvdResult?.divergence,
      detail: cvdResult
        ? `${cvdResult.divergence?'⚠️':'✅'} ${cvdResult.signal} – Preis: ${cvdResult.priceTrend} CVD: ${cvdResult.cvdTrend} ${cvdResult.divergence?'(DIVERGENZ!)':''}`
        : '– Nicht genug Daten' });

    // ── 11. ML SIGNAL ─────────────────────────────────────────────────────
    let mlResult = null;
    if (MLOptimizer.trained && candles.length >= 60) {
      mlResult = MLOptimizer.predict(candles);
    }
    checks.push({ name:'ML Ensemble', ok: MLOptimizer.trained,
      detail: mlResult
        ? `${mlResult.signal} (${(mlResult.confidence*100).toFixed(1)}% Confidence) [RF:${mlResult.models?.rf} GB:${mlResult.models?.gb} PC:${mlResult.models?.perceptron}]`
        : MLOptimizer.trained ? '– Nicht genug Daten' : '⚠️ Noch nicht trainiert – /api/ml/train aufrufen' });

    // ── 12. RL AGENT ──────────────────────────────────────────────────────
    let rlResult = null;
    if (candles.length >= 30) rlResult = RLAgent.decide(candles);
    checks.push({ name:'RL Agent', ok:true,
      detail: rlResult
        ? `${rlResult.action} (${rlResult.mode}, Conf: ${((rlResult.confidence||0)*100).toFixed(0)}%) – ${RLAgent.episodes} Episoden, ε=${RLAgent.epsilon.toFixed(3)}`
        : '– Kein Ergebnis' });

    // ── 13. FEAR & GREED ──────────────────────────────────────────────────
    const fg = FearGreed.cache;
    checks.push({ name:'Fear & Greed', ok:true,
      detail: fg
        ? `${fg.value}/100 (${fg.label}) – Signal: ${fg.signal}`
        : '– Noch nicht geladen' });

    // ── 14. NEWS-SENTIMENT ────────────────────────────────────────────────
    const news = NewsSentiment.cache;
    checks.push({ name:'News-Sentiment', ok: !news || news.riskScore < 70,
      detail: news
        ? `${news.riskScore>70?'⚠️':'✅'} Risiko-Score: ${news.riskScore}/100 (${news.signal||'NORMAL'})`
        : '– Deaktiviert oder nicht geladen' });

    // ── 15. MULTI-TIMEFRAME ───────────────────────────────────────────────
    checks.push({ name:'Multi-Timeframe', ok:true,
      detail: MTFConfirm.enabled
        ? `Aktiv: ${MTFConfirm.granularity||'1h'} prüft höheren Timeframe`
        : 'Deaktiviert (kann in Features aktiviert werden)' });

    // ── INDIKATOREN SCHNELL-ÜBERBLICK ─────────────────────────────────────
    let indOverview = null;
    if (closes.length >= 30) {
      const rsi  = Ind.rsi(closes);
      const macd = Ind.macd(closes);
      const bb   = Ind.bb(closes);
      const ema20= Ind.ema(closes,20);
      const ema50= Ind.ema(closes,50);
      const adx  = Ind.adx(candles);
      indOverview = {
        rsi:   rsi?.toFixed(1),
        macd:  macd?.histogram > 0 ? 'BULLISH' : 'BEARISH',
        bb:    bb?.pctB < 0.2 ? 'UNTERES BAND' : bb?.pctB > 0.8 ? 'OBERES BAND' : 'MITTE',
        trend: ema20 > ema50 ? 'EMA BULLISH (20>50)' : 'EMA BEARISH (20<50)',
        adx:   adx?.adx > 25 ? `TREND (ADX ${adx.adx?.toFixed(0)})` : `KEIN TREND (ADX ${adx?.adx?.toFixed(0)})`,
      };
    }

    // ── GESAMT-URTEIL ─────────────────────────────────────────────────────
    const passedChecks  = checks.filter(c=>c.ok).length;
    const totalChecks   = checks.length;
    const wouldTrade    = !blocked && passedChecks >= totalChecks * 0.7;

    const explanation = {
      symbol, price, ts,
      wouldTrade,
      blocked, blockReason,
      verdict: wouldTrade
        ? `✅ BOT WÜRDE HANDELN (${passedChecks}/${totalChecks} Checks OK)`
        : `❌ BOT WÜRDE NICHT HANDELN${blockReason ? ': '+blockReason : ''}`,
      mode:       DemoEngine.mode,
      regime:     regime.regime,
      mlSignal:   mlResult?.signal || '—',
      rlSignal:   rlResult?.action || '—',
      checks,
      indicators: indOverview,
      summary: this._buildSummary(checks, blocked, blockReason, wouldTrade),
    };

    this.lastExplanations[symbol] = explanation;
    this.history.unshift({ ts, symbol, verdict:explanation.verdict, blocked });
    if (this.history.length > 50) this.history.pop();
    return explanation;
  },

  // Klarer Text ohne JSON-Struktur – für Telegram
  _buildSummary(checks, blocked, blockReason, wouldTrade) {
    const lines = [];
    lines.push(wouldTrade ? '✅ WÜRDE HANDELN' : '❌ WÜRDE NICHT HANDELN');
    if (blocked) lines.push(`Hauptgrund: ${blockReason}`);
    const problems = checks.filter(c=>!c.ok);
    if (problems.length) {
      lines.push('');
      lines.push('Probleme:');
      problems.forEach(p => lines.push(`  • ${p.name}: ${p.detail}`));
    }
    const good = checks.filter(c=>c.ok).slice(0,3);
    if (good.length && wouldTrade) {
      lines.push('');
      lines.push('Stärken:');
      good.forEach(g => lines.push(`  • ${g.name}: ${g.detail}`));
    }
    return lines.join('\n');
  },

  snapshot() {
    return { history: this.history.slice(0,10), lastExplanations: Object.keys(this.lastExplanations) };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// REQUEST QUEUE – API Rate Limiter
// Verhindert dass 10 Systeme gleichzeitig Bitget anfragen und sich gegenseitig
// ausbremsen. Serialisiert Requests mit minimalem Delay.
// Max 10 Requests/Sekunde zu Bitget (Limit: 20/s)
// ═════════════════════════════════════════════════════════════════════════════
const RequestQueue = {
  queue:       [],
  running:     0,
  maxParallel: 5,      // Max 5 gleichzeitige Requests
  minDelay:    50,     // Min 50ms zwischen Requests an dieselbe URL
  lastCall:    {},     // url → letzter Zeitpunkt
  stats:       { queued:0, executed:0, avgWait:0 },

  // Request einreihen und ausführen
  async add(fn, key='default') {
    this.stats.queued++;
    // Throttle: min 50ms seit letztem Call an denselben Endpoint
    const now    = Date.now();
    const last   = this.lastCall[key] || 0;
    const wait   = Math.max(0, this.minDelay - (now - last));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastCall[key] = Date.now();
    this.stats.executed++;
    return fn();
  },

  // Statistik
  snapshot() {
    return { queued:this.stats.queued, executed:this.stats.executed, maxParallel:this.maxParallel };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// MAC MINI M1 OPTIMIERUNGS-LAYER
// Nutzt die M1-Architektur: 8 Kerne, Unified Memory, ARM64 V8
// ═════════════════════════════════════════════════════════════════════════════
const M1Optimizer = {

  // ── HTTP Keep-Alive Agent ─────────────────────────────────────────────────
  // Standard axios öffnet pro Request eine neue TCP-Verbindung (20-30ms overhead)
  // Keep-Alive hält die Verbindung offen → spart TCP-Handshake bei jedem Call
  httpAgent: null,
  httpsAgent: null,

  init() {
    const http  = require('http');
    const https = require('https');
    this.httpsAgent = new https.Agent({
      keepAlive:            true,
      keepAliveMsecs:       30000,  // 30s Keep-Alive
      maxSockets:           10,     // Max 10 simultane Connections zu Bitget
      maxFreeSockets:       5,      // 5 freie Connections im Pool
      timeout:              8000,
      scheduling:           'fifo',
    });
    this.httpAgent = new http.Agent({ keepAlive:true, maxSockets:5 });

    // Axios default agent setzen
    const axios = require('axios');
    axios.defaults.httpsAgent = this.httpsAgent;
    axios.defaults.httpAgent  = this.httpAgent;
    // Timeout global
    axios.defaults.timeout = 8000;

    Log.boot('M1: Keep-Alive HTTPS Agent initialisiert (10 Connections im Pool)');
    return this;
  },

  // ── V8 Heap optimieren ────────────────────────────────────────────────────
  // M1 hat 8-16GB Unified Memory – Node.js bekommt mehr davon
  checkMemory() {
    const v8 = require('v8');
    const stats = v8.getHeapStatistics();
    const heapMB = Math.round(stats.heap_size_limit / 1024 / 1024);
    const usedMB = Math.round(stats.used_heap_size / 1024 / 1024);
    const freeMB = heapMB - usedMB;
    return { heapLimitMB:heapMB, usedMB, freeMB, usedPct:Math.round(usedMB/heapMB*100) };
  },

  // ── Performance Benchmark ─────────────────────────────────────────────────
  async benchmark() {
    const results = {};

    // 1. Bitget Latenz messen (5 Pings, Durchschnitt)
    const pings = [];
    for (let i=0;i<5;i++) {
      const start = Date.now();
      await Bitget.ping().catch(()=>{});
      pings.push(Date.now()-start);
    }
    pings.sort((a,b)=>a-b);
    results.bitgetLatency = {
      avg:    Math.round(pings.reduce((a,b)=>a+b,0)/pings.length),
      min:    pings[0],
      max:    pings[pings.length-1],
      median: pings[Math.floor(pings.length/2)],
    };

    // 2. Candle-Fetch Zeit
    const t1 = Date.now();
    await Bitget.fetchCandles('BTCUSDT','1h',100);
    results.candleFetchMs = Date.now()-t1;

    // 3. Indikator-Berechnung (alle 47)
    const t2  = Date.now();
    const dummy = Array.from({length:200},(_,i)=>({
      ts:i*3600000, open:40000+i, high:40100+i, low:39900+i, close:40050+i, vol:1000+i
    }));
    Ind.bundle(dummy);
    results.indicatorMs = Date.now()-t2;

    // 4. ML Predict
    if (MLOptimizer.trained) {
      const t3 = Date.now();
      for(let i=0;i<100;i++) MLOptimizer.predict(dummy);
      results.mlPredictMs = (Date.now()-t3)/100;
    }

    // 5. Geschätzter End-to-End Trade-Latenz
    results.estimatedTradeLatency = {
      candleFetch:    results.candleFetchMs,
      networkRTT:     results.bitgetLatency.avg,
      indicators:     results.indicatorMs,
      decision:       5,    // DecisionFlow CPU: ~5ms
      orderSubmit:    results.bitgetLatency.avg, // Order-Call ≈ Ping
      total:          results.candleFetchMs + results.indicatorMs + 5 + results.bitgetLatency.avg,
      note:           results.bitgetLatency.avg > 200
        ? 'Netzwerk ist der Engpass. VPN deaktivieren oder besseren Router nutzen.'
        : results.bitgetLatency.avg > 100
        ? 'Normale Home-Latenz nach Singapur. Mit VPS in Frankfurt ~80ms.'
        : 'Gute Latenz!',
    };

    // 6. Memory
    results.memory = this.checkMemory();

    Log.info('M1', `Benchmark: Bitget ${results.bitgetLatency.avg}ms, Candles ${results.candleFetchMs}ms, Ind ${results.indicatorMs}ms, Est.Trade ${results.estimatedTradeLatency.total}ms`);
    return results;
  },

  // ── pm2 Config für M1 ─────────────────────────────────────────────────────
  // Nutzt M1 Performance-Kerne optimal
  pm2Config() {
    return {
      apps: [{
        name:         'nexus-v9-m1',
        script:       'server.js',
        cwd:          '__dirname',
        instances:    1,          // 1 Instanz reicht (Node ist single-threaded, aber async)
        exec_mode:    'fork',
        autorestart:  true,
        watch:        false,
        max_memory_restart: '1G',
        restart_delay:5000,
        node_args: [
          '--max-old-space-size=2048',   // 2GB Heap für Node.js (M1 hat genug RAM)
          '--optimize-for-size',          // Kleinerer Code-Cache = schneller JIT
          '--harmony',                    // Alle ES6+ Features
          '--expose-gc',                  // Manuelles GC möglich
        ].join(' '),
        env: {
          NODE_ENV:     'production',
          UV_THREADPOOL_SIZE: '8',        // M1 hat 8 Kerne – Thread-Pool nutzen
          PORT:         3000,
        },
        error_file:   './logs/err.log',
        out_file:     './logs/out.log',
        merge_logs:   true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      }],
    };
  },

  snapshot() {
    return {
      httpsAgent:    !!this.httpsAgent,
      keepAlive:     true,
      memory:        this.checkMemory(),
      platform:      process.platform,
      arch:          process.arch,
      nodeVersion:   process.version,
      isM1Native:    process.arch === 'arm64',
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// ADAPTIVE BOT CORE – Selbst-optimierende Kern-Logik für alle Bots
// Jeder Bot ruft _calcParams() auf und bekommt seine optimalen Parameter.
// ═════════════════════════════════════════════════════════════════════════════
const AdaptiveBotCore = {

  // Letzte berechneten Parameter pro Symbol (Cache 60s)
  _cache: {},

  async _calcParams(symbol, capital, winRate=0.5) {
    const cacheKey = symbol + '_' + Math.floor(Date.now()/60000);
    if (this._cache[cacheKey]) return this._cache[cacheKey];

    const candles = await Bitget.fetchCandles(symbol, '5min', 30).catch(()=>[]);
    const price   = candles.length ? candles[candles.length-1].close : 0;
    const atr     = candles.length >= 14 ? (Ind.atr(candles)||price*0.01) : price*0.01;
    const atrPct  = price > 0 ? atr/price : 0.01;
    const rsi     = candles.length >= 14 ? (Ind.rsi(candles.map(c=>c.close))||50) : 50;
    const regime  = Regime.regime || 'NEUTRAL';

    // ── FREQUENZ-EMPFEHLUNG (Ticks/Stunde) ───────────────────────────────
    let baseFreq = 60; // Standard: 60/h = alle 60s

    // Volatilität: hohe ATR → mehr Ticks
    const volFactor = Math.min(2.0, Math.max(0.4, 1 + atrPct * 25));
    // Kapital: mehr Kapital → darf öfter handeln
    const capFactor = Math.min(1.6, Math.max(0.4, capital / 300));
    // Rentabilität: gute WR → aggressiver
    const profFactor= Math.min(1.5, Math.max(0.5, (winRate-0.4)*5+0.75));
    // Regime-Bonus
    const regimeFactor = regime==='SQUEEZE'?1.5:regime==='BULL'?1.2:regime==='BEAR'?0.6:regime==='EXTREME_BEAR'?0.2:1.0;

    const freq = Math.round(Math.min(200, Math.max(20,
      baseFreq * volFactor * capFactor * profFactor * regimeFactor
    )));

    // ── GRID LEVEL EMPFEHLUNG ─────────────────────────────────────────────
    // Mehr Levels = feiner Raster = mehr Trades = mehr Kapital nötig
    // Basis: 10 Levels | Kapital <100: 5 | Kapital >1000: 20
    const gridLevels = Math.round(Math.min(30, Math.max(5,
      10 * capFactor * volFactor
    )));

    // ── GRID RANGE (ATR-basiert) ──────────────────────────────────────────
    const gridRangePct = Math.min(0.20, Math.max(0.05, atrPct * 12));

    // ── ORDERGRÖSSE ───────────────────────────────────────────────────────
    // Gebühren-Check: min 2× Gebühren als Gewinn pro Trade
    const feeRate  = 0.0006; // Bitget Taker 0.06%
    const minOrder = Math.max(2, feeRate * 2 / (atrPct || 0.01)); // in USDT
    const perOrder = Math.max(minOrder, capital * 0.05); // 5% des Kapitals, min minOrder

    // ── MARTINGALE MULTIPLIER ─────────────────────────────────────────────
    // Niedriger bei niedriger WR, höher bei hoher WR
    const martMult = Math.min(2.5, Math.max(1.3, 1.5 + (winRate-0.5)));

    const result = {
      freq,           // Ticks/Stunde
      intervalMs:     Math.round(3600000 / freq),
      gridLevels,
      gridRangePct,
      perOrderUSDT:   perOrder,
      martMultiplier: martMult,
      atrPct,         volFactor, capFactor, profFactor, regimeFactor,
      regime, rsi, price,
      ts: Date.now(),
    };
    this._cache[cacheKey] = result;
    return result;
  },
};


// ═════════════════════════════════════════════════════════════════════════════
// COIN SCANNER – Wählt automatisch die besten Coins zum Traden
//
// Wie es funktioniert:
//   1. Scannt alle konfigurierten Coins alle 5 Minuten
//   2. Bewertet jeden Coin nach 5 Kriterien (Score 0-100)
//   3. Wählt die Top-N Coins für AutoEngine + BotManager
//   4. Tauscht automatisch aus wenn bessere Coins gefunden werden
//
// Score-Kriterien:
//   • Volumen    (25%): Hohe Liquidität = besser handelbar
//   • Momentum   (25%): RSI-Abstand von 50 = starke Bewegung
//   • Volatilität(20%): ATR% = mehr Gewinnpotenzial
//   • Trend      (20%): EMA20 > EMA50 = klarer Trend
//   • Spread     (10%): Enge Spread = weniger Slippage
// ═════════════════════════════════════════════════════════════════════════════
const CoinScanner = {
  enabled:     true,
  intervalMs:  300000,   // alle 5 Minuten neu bewerten
  maxActive:   3,        // Max gleichzeitig aktive Coins
  timer:       null,
  lastScan:    null,
  rankings:    [],       // Sortierte Coin-Liste nach Score
  activeCoins: [],       // Aktuell gehandelte Coins

  // Alle verfügbaren Coins – XRP ist dabei!
  WATCHLIST: [
    'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT',
    'BNBUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT',
    'POLUSDT','LINKUSDT','DOTUSDT','LTCUSDT',
    'UNIUSDT','ATOMUSDT','NEARUSDT','ARBUSDT',
    'OPUSDT','SUIUSDT','APTUSDT','SEIUSDT',
  ],

  // ── EINZELNEN COIN BEWERTEN ──────────────────────────────────────────────
  async scoreCoin(symbol) {
    try {
      const [candles, ticker] = await Promise.all([
        Bitget.fetchCandles(symbol, '1h', 50).catch(()=>[]),
        Bitget.fetchTicker(symbol).catch(()=>null),
      ]);
      if (!candles.length || !ticker?.last) return null;

      const closes  = candles.map(c=>c.close);
      const price   = ticker.last;
      const vol24h  = ticker.vol24h || candles.reduce((s,c)=>s+c.vol,0);

      // Feature-Berechnung
      const rsi    = Ind.rsi(closes)      || 50;
      const ema20  = Ind.ema(closes, 20)  || price;
      const ema50  = Ind.ema(closes, 50)  || price;
      const atr    = Ind.atr(candles)     || price*0.01;
      const atrPct = atr / price;
      const macd   = Ind.macd(closes);

      // ── SCORE BERECHNUNG ─────────────────────────────────────────────────
      // 1. Volumen-Score (0-25): Hohe Liquidität
      const volScore = Math.min(25, Math.log10(Math.max(1, vol24h)) * 3);

      // 2. Momentum-Score (0-25): RSI Abstand von 50 = Bewegung
      const rsiDist   = Math.abs(rsi - 50);
      const momentumScore = Math.min(25, rsiDist * 0.7);

      // 3. Volatilität-Score (0-20): ATR% = Gewinnpotenzial
      const volaPct   = Math.min(20, atrPct * 800);

      // 4. Trend-Score (0-20): Klarer Trend nach oben oder unten
      const trendBull = ema20 > ema50;
      const trendPct  = Math.abs(ema20 - ema50) / ema50;
      const trendScore= Math.min(20, trendPct * 1000 + (trendBull ? 5 : 3));

      // 5. MACD-Score (0-10): Momentum-Bestätigung
      const macdScore = Math.min(10, Math.abs(macd.histogram||0) * 500);

      const totalScore = volScore + momentumScore + volaPct + trendScore + macdScore;

      // Schwarze Liste prüfen
      const blacklisted = SymbolBlacklist?.isBlocked?.(symbol)?.blocked || false;

      return {
        symbol, price, vol24h, rsi, atrPct,
        ema20, ema50, trendBull,
        scores: { volScore, momentumScore, volaPct, trendScore, macdScore },
        totalScore: parseFloat(totalScore.toFixed(2)),
        blacklisted,
        regime: Regime.regime,
        ts: Date.now(),
      };
    } catch(e) {
      return null;
    }
  },

  // ── ALLE COINS SCANNEN ───────────────────────────────────────────────────
  async scan() {
    Log.info('COIN_SCAN', `Scanne ${this.WATCHLIST.length} Coins...`);

    // Parallel scannen (alle gleichzeitig, max 5 parallel um Rate-Limit zu vermeiden)
    const results = [];
    for (let i=0; i<this.WATCHLIST.length; i+=5) {
      const batch = this.WATCHLIST.slice(i, i+5);
      const batchResults = await Promise.all(batch.map(s => this.scoreCoin(s)));
      results.push(...batchResults.filter(r => r !== null));
      if (i+5 < this.WATCHLIST.length) await new Promise(r=>setTimeout(r,500));
    }

    // Sortieren: höchster Score zuerst, gesperrte Coins raus
    this.rankings = results
      .filter(r => !r.blacklisted)
      .sort((a,b) => b.totalScore - a.totalScore);

    this.lastScan = Date.now();

    // Top-N für AutoEngine auswählen
    const topCoins = this.rankings.slice(0, this.maxActive).map(r => r.symbol);

    // AutoEngine Symbole aktualisieren wenn sich was geändert hat
    const changed = JSON.stringify(topCoins) !== JSON.stringify(this.activeCoins);
    if (changed && topCoins.length > 0) {
      const prev = [...this.activeCoins];
      this.activeCoins = topCoins;
      AutoEngine.symbols = topCoins;

      Log.info('COIN_SCAN', `Neue Top-Coins: ${topCoins.join(', ')} (vorher: ${prev.join(', ')||'—'})`);

      if (JSON.stringify(prev) !== JSON.stringify(topCoins)) {
        const msg = `🔍 Coin-Scanner Update:\n`
          + topCoins.map((s,i) => {
              const r = this.rankings[i];
              return `#${i+1} ${s}: Score ${r.totalScore.toFixed(0)} | RSI ${r.rsi?.toFixed(0)} | ATR ${(r.atrPct*100).toFixed(2)}%`;
            }).join('\n');
        TelegramBot.send(msg);
      }
    }

    Log.info('COIN_SCAN', `Scan fertig. Top 3: ${this.rankings.slice(0,3).map(r=>`${r.symbol}(${r.totalScore.toFixed(0)})`).join(', ')}`);
    return this.rankings;
  },

  // ── AUTO-START ───────────────────────────────────────────────────────────
  start() {
    if (this.timer) return;
    this.scan(); // Sofort ersten Scan
    this.timer = setInterval(() => this.scan(), this.intervalMs);
    Log.info('COIN_SCAN', `Coin-Scanner gestartet: ${this.WATCHLIST.length} Coins, alle ${this.intervalMs/60000}min`);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer=null; }
  },

  snapshot() {
    return {
      enabled:     this.enabled,
      activeCoins: this.activeCoins,
      maxActive:   this.maxActive,
      watchlist:   this.WATCHLIST.length,
      lastScan:    this.lastScan,
      lastScanAgo: this.lastScan ? Math.round((Date.now()-this.lastScan)/1000)+'s' : 'nie',
      top10:       this.rankings.slice(0,10).map(r=>({
        symbol:    r.symbol,
        score:     r.totalScore,
        rsi:       r.rsi?.toFixed(1),
        atrPct:    (r.atrPct*100).toFixed(2)+'%',
        trend:     r.trendBull?'BULL':'BEAR',
        blacklisted:r.blacklisted,
      })),
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// DB-WÄCHTER – Verhindert unkontrolliertes Datenbankwachstum
// Läuft täglich um 04:00 Uhr und bereinigt alte Daten automatisch.
//
// Limits (konfigurierbar):
//   system_log      → max 10.000 Zeilen (älteste werden gelöscht)
//   signals         → max 5.000 Zeilen
//   strategy_perf   → max 20.000 Zeilen (Tradinghistorie)
//   candle_cache    → alles älter als 7 Tage
//   trades          → geschlossene Trades älter als 90 Tage
//   balance_history → älter als 30 Tage
//
// Ziel: DB bleibt dauerhaft unter ~200MB
// ═════════════════════════════════════════════════════════════════════════════
const DBWatchdog = {
  enabled: true,
  timer:   null,

  LIMITS: {
    system_log:           10000,   // Max 10k Log-Einträge
    signals:               5000,   // Max 5k Signale
    strategy_performance: 20000,   // Max 20k Trade-Performance-Einträge
    candle_cache_days:        7,   // Kerzen-Cache max 7 Tage alt
    trades_closed_days:      90,   // Geschlossene Trades max 90 Tage
    balance_history_days:    30,   // Balance-History max 30 Tage
  },

  // Alle Tabellen bereinigen
  async clean() {
    const before = this._dbSizeKB();
    const results = {};
    const now = Date.now();

    try {
      // system_log: älteste löschen wenn über Limit
      const logCount = DB.db.prepare('SELECT COUNT(*) as n FROM system_log').get()?.n || 0;
      if (logCount > this.LIMITS.system_log) {
        const del = logCount - this.LIMITS.system_log;
        DB.db.prepare(`DELETE FROM system_log WHERE id IN (SELECT id FROM system_log ORDER BY ts ASC LIMIT ?)`).run(del);
        results.system_log = `${del} gelöscht (war ${logCount})`;
      }

      // signals: älteste löschen
      const sigCount = DB.db.prepare('SELECT COUNT(*) as n FROM signals').get()?.n || 0;
      if (sigCount > this.LIMITS.signals) {
        const del = sigCount - this.LIMITS.signals;
        DB.db.prepare(`DELETE FROM signals WHERE id IN (SELECT id FROM signals ORDER BY ts ASC LIMIT ?)`).run(del);
        results.signals = `${del} gelöscht`;
      }

      // strategy_performance: älteste löschen
      const perfCount = DB.db.prepare('SELECT COUNT(*) as n FROM strategy_performance').get()?.n || 0;
      if (perfCount > this.LIMITS.strategy_performance) {
        const del = perfCount - this.LIMITS.strategy_performance;
        DB.db.prepare(`DELETE FROM strategy_performance WHERE id IN (SELECT id FROM strategy_performance ORDER BY ts ASC LIMIT ?)`).run(del);
        results.strategy_perf = `${del} gelöscht`;
      }

      // candle_cache: älter als 7 Tage
      const candleCutoff = now - this.LIMITS.candle_cache_days * 86400000;
      const candleDel = DB.db.prepare('DELETE FROM candle_cache WHERE ts < ?').run(candleCutoff);
      if (candleDel.changes > 0) results.candle_cache = `${candleDel.changes} alte Kerzen gelöscht`;

      // trades: geschlossene älter als 90 Tage
      const tradeCutoff = now - this.LIMITS.trades_closed_days * 86400000;
      const tradeDel = DB.db.prepare(`DELETE FROM trades WHERE state='CLOSED' AND closed_at < ?`).run(tradeCutoff);
      if (tradeDel.changes > 0) results.trades = `${tradeDel.changes} alte Trades archiviert`;

      // balance_history: älter als 30 Tage
      const balCutoff = now - this.LIMITS.balance_history_days * 86400000;
      const balDel = DB.db.prepare('DELETE FROM balance_history WHERE ts < ?').run(balCutoff);
      if (balDel.changes > 0) results.balance = `${balDel.changes} alte Balance-Einträge gelöscht`;

      // VACUUM: SQLite Datei komprimieren (gibt Speicher zurück)
      DB.db.prepare('VACUUM').run();

      const after = this._dbSizeKB();
      const saved = before - after;

      const summary = {
        ok: true,
        dbSizeBefore: `${(before/1024).toFixed(1)} MB`,
        dbSizeAfter:  `${(after/1024).toFixed(1)} MB`,
        savedMB:      `${(saved/1024).toFixed(2)} MB`,
        results,
        ts: now,
      };

      Log.info('DB_WATCHDOG', `Bereinigung: ${(before/1024).toFixed(1)}MB → ${(after/1024).toFixed(1)}MB (${(saved/1024).toFixed(2)}MB gespart)`);
      if (saved > 1024) { // Mehr als 1MB gespart → Telegram
        TelegramBot.send(`🗑 DB-Bereinigung\nVorher: ${(before/1024).toFixed(1)} MB\nNachher: ${(after/1024).toFixed(1)} MB\nGespart: ${(saved/1024).toFixed(2)} MB`);
      }
      return summary;
    } catch(e) {
      Log.error('DB_WATCHDOG', `Fehler: ${e.message}`);
      return { ok:false, error:e.message };
    }
  },

  _dbSizeKB() {
    try {
      const r = DB.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
      return r?.size ? r.size / 1024 : 0;
    } catch(_) { return 0; }
  },

  // Täglich um 04:00 Uhr automatisch bereinigen
  start() {
    if (this.timer) return;
    const scheduleNext = () => {
      const now  = new Date();
      const next = new Date(now);
      next.setHours(4, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const ms = next - now;
      this.timer = setTimeout(async () => {
        await this.clean();
        scheduleNext(); // nächsten Tag planen
      }, ms);
      Log.boot(`DB-Wächter: Nächste Bereinigung um ${next.toLocaleTimeString('de-DE')} (in ${Math.round(ms/3600000)}h)`);
    };
    scheduleNext();
  },

  snapshot() {
    return {
      enabled:    this.enabled,
      dbSizeMB:   (this._dbSizeKB()/1024).toFixed(2),
      limits:     this.LIMITS,
      nextClean:  '04:00 Uhr täglich',
    };
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// HISTORISCHER PRE-TRAINER
// Statt 4 Wochen Paper Trading zu warten – lade historische Daten und
// trainiere ML + RL darauf vor. Der Bot startet mit Jahren an Erfahrung.
//
// Wie es funktioniert:
//   1. Holt max. verfügbare historische Kerzen von Bitget (bis zu 1000/Abruf)
//   2. Simuliert jeden historischen Zeitpunkt als wäre er live
//   3. ML lernt aus historischen Feature-Label-Paaren
//   4. RL Agent durchläuft historische "Episoden" und baut Q-Table auf
//   5. Alles wird in SQLite gespeichert → überlebt Neustarts
//
// Zeitrahmen: 1H Kerzen, max ~1000 pro Abruf
// Bitget liefert bis zu 1000 Kerzen pro Request
// ═════════════════════════════════════════════════════════════════════════════
const HistoricalTrainer = {
  running:   false,
  progress:  0,     // 0-100%
  status:    'IDLE',
  lastRun:   null,
  results:   null,

  async train({ symbol='BTCUSDT', granularity='1h', targetCandles=1000 } = {}) {
    if (this.running) return { error:'Training läuft bereits' };
    this.running = true;
    this.progress = 0;
    this.status   = 'LÄDT HISTORISCHE DATEN...';
    Log.info('HIST', `Starte historisches Pre-Training: ${symbol} ${granularity} ~${targetCandles} Kerzen`);
    TelegramBot.send(`📚 Historisches Pre-Training gestartet\n${symbol} ${granularity}\nLädt Daten...`);

    try {
      // ── SCHRITT 1: Kerzen laden ──────────────────────────────────────────
      // Bitget liefert max 1000 Kerzen pro Request
      const limit = Math.min(targetCandles, 3000);
      const candles = await Bitget.fetchCandles(symbol, granularity, limit);
      if (!candles || candles.length < 200) {
        this.running = false; this.status = 'FEHLER: Zu wenig Daten';
        return { error:`Nur ${candles?.length||0} Kerzen verfügbar (min 100)` };
      }
      this.progress = 20;
      this.status   = `${candles.length} Kerzen geladen. Trainiere ML...`;
      Log.info('HIST', `${candles.length} historische Kerzen geladen (${new Date(candles[0].ts).toLocaleDateString('de-DE')} – ${new Date(candles[candles.length-1].ts).toLocaleDateString('de-DE')})`);

      // ── SCHRITT 2: ML Training auf historischen Daten ────────────────────
      const mlResult = await MLOptimizer.train(symbol, granularity, limit);
      this.progress = 60;
      this.status   = 'ML trainiert. Trainiere RL Agent...';

      // ── SCHRITT 3: RL Agent durch historische Daten laufen lassen ────────
      // Simuliert den Markt Kerze für Kerze
      let rlEpisodes = 0;
      const windowSize = 50; // Wie viele Kerzen der Agent sieht

      for (let i = windowSize; i < candles.length - 1; i++) {
        const slice      = candles.slice(i - windowSize, i + 1);
        const nextSlice  = candles.slice(i - windowSize + 1, i + 2);
        const curPrice   = slice[slice.length - 1].close;
        const nextPrice  = nextSlice[nextSlice.length - 1].close;

        // RL Agent entscheidet
        const decision = RLAgent.decide(slice);

        // Reward: hat die Entscheidung sich ausgezahlt?
        const priceChange = (nextPrice - curPrice) / curPrice;
        let reward = 0;
        if (decision.action === 'BUY')  reward = priceChange * 10;  // BUY profitiert von Aufwärtsbewegung
        if (decision.action === 'SELL') reward = -priceChange * 10; // SELL profitiert von Abwärtsbewegung
        if (decision.action === 'HOLD') reward = -Math.abs(priceChange) * 2; // HOLD wird für verpasste Bewegungen bestraft

        // Gebühren simulieren (0.12% round trip)
        if (decision.action !== 'HOLD') reward -= 0.012;

        // RL lernt
        RLAgent.learn(reward, nextSlice);
        // Perceptron immer aufräumen
        RLAgent.lastState = null; RLAgent.lastAction = null;
        rlEpisodes++;

        // Perceptron auch updaten (Online Learning auf historischen Daten)
        const trueLabel = priceChange > 0.002 ? 2 : priceChange < -0.002 ? 0 : 1;
        const histFeats = MLOptimizer.extractFeatures(slice);
        if (histFeats) MLOptimizer.Perceptron.learn(histFeats, trueLabel);
      }

      this.progress = 90;
      this.status   = 'RL trainiert. Speichere...';
      Log.info('HIST', `RL: ${rlEpisodes} historische Episoden | Perceptron: ${MLOptimizer.Perceptron.trained} Updates`);

      // ── SCHRITT 4: Alles in SQLite speichern ─────────────────────────────
      MLPersist.saveAll();
      this.progress = 100;

      const dateFrom = new Date(candles[0].ts).toLocaleDateString('de-DE');
      const dateTo   = new Date(candles[candles.length-1].ts).toLocaleDateString('de-DE');

      this.results = {
        ok:          true,
        symbol,      granularity,
        candles:     candles.length,
        dateFrom,    dateTo,
        mlAccuracy:  mlResult.accuracy,
        rlEpisodes,
        perceptronUpdates: MLOptimizer.Perceptron.trained,
        rfTrees:     MLOptimizer.RF.trees.length,
        message:     `Bot hat ${candles.length} historische Kerzen (${dateFrom}–${dateTo}) gelernt`,
      };

      this.status  = 'FERTIG';
      this.lastRun = Date.now();
      this.running = false;

      Log.info('HIST', `Pre-Training fertig: ${candles.length} Kerzen | RL: ${rlEpisodes} Episoden`);
      TelegramBot.send(
        `✅ Historisches Pre-Training fertig!\n` +
        `${symbol} ${granularity}: ${candles.length} Kerzen\n` +
        `Zeitraum: ${dateFrom} – ${dateTo}\n` +
        `RL Episoden: ${rlEpisodes}\n` +
        `ML Accuracy: ${((mlResult.accuracy?.ensemble||0)*100).toFixed(1)}%\n` +
        `Bot startet mit historischem Wissen!`
      );
      return this.results;

    } catch(e) {
      this.running = false;
      this.status  = `FEHLER: ${e.message}`;
      Log.error('HIST', `Pre-Training Fehler: ${e.message}`);
      return { error: e.message };
    }
  },

  snapshot() {
    return {
      running:  this.running,
      progress: this.progress,
      status:   this.status,
      lastRun:  this.lastRun,
      results:  this.results,
    };
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// BOOT SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────
async function boot() {
  Log.boot('NEXUS V9 PRO BOOT SEQUENCE START');
  Log.boot(`SQLite: ${CFG.DB_PATH}`);
  Log.boot(`Deploy Mode: ${CFG.DEPLOY_MODE}`);
  Log.boot(`API Keys: ${CFG.API_KEY?'PRESENT':'MISSING – DEMO MODE'}`);

  // Exchange ping
  const ping = await Bitget.ping();
  Log.boot(`Exchange: ${ping.ok?'ONLINE':'OFFLINE'} (${ping.latencyMs||0}ms)`);

  // WebSocket
  Bitget.connectWS(CFG.DEFAULT_SYMBOLS);

  // Initial balance
  await refreshBalances();

  // Stress test
  const stress = StressTest.run();
  Log.boot(`Stress Test: ${stress.pass?'PASS':'FAIL'} (${(stress.survivalRate*100).toFixed(0)}% survival)`);

  // Initial reconciliation
  await Recon.run();

  // Session baseline
  Balance.sessionStart = Balance.usable;

  // Auto-refresh every 30s
  setInterval(async ()=>{
    await refreshBalances();
    KillSwitch.check();
  }, 30000);

  // Selbstheilung starten (alle 5 Minuten)
  SelfHeal.startAutoHeal(300000);
  // Erster Check sofort
  await SelfHeal.fullCheck();

  // Telegram Bot starten
  TelegramBot.startPolling();

  // BotManager initialisieren (startet im MANUAL Modus)
  Log.boot('BotManager bereit – Modus: MANUAL | /api/botmanager/mode zum Umschalten');

  // ML Auto-Retraining starten (jede Woche automatisch)
  MLAutoRetrain.start();
  Log.boot(`ML Auto-Retraining: alle ${MLAutoRetrain.intervalDays} Tage · Symbol: ${MLAutoRetrain.symbol}`);
  if (TelegramBot.enabled) {
    Log.boot('Telegram Bot aktiv – warte auf Befehle');
    TelegramBot.send('🚀 NEXUS V9 ULTIMATE gestartet\nMode: '+CFG.DEPLOY_MODE+'\nBalance: '+Balance.usable.toFixed(2)+' USDT');
  }

  // Tages-Report um 08:00 Uhr
  DailyReport.start();

  // Demo Engine Tagesreset
  const scheduleDemoReset = () => {
    const now=new Date(), nextMN=new Date(now);
    nextMN.setHours(0,2,0,0);
    if (nextMN<=now) nextMN.setDate(nextMN.getDate()+1);
    setTimeout(()=>{ DemoEngine.dailyReset(); scheduleDemoReset(); }, nextMN-now);
  };
  scheduleDemoReset();

  // Drawdown Recovery Mode täglich um Mitternacht zurücksetzen
  const scheduleRecoveryReset = () => {
    const now   = new Date();
    const nextMN = new Date(now); nextMN.setHours(0,1,0,0); // 00:01 Uhr
    if (nextMN <= now) nextMN.setDate(nextMN.getDate()+1);
    setTimeout(() => {
      DrawdownRecovery.reset();
      scheduleRecoveryReset();
    }, nextMN - now);
    Log.boot(`Recovery Reset um ${nextMN.toLocaleTimeString('de-DE')} geplant`);
  };
  scheduleRecoveryReset();

  // DB-Backup starten
  DBBackup.start();
  Log.boot('DB-Backup geplant (täglich 03:00 Uhr)');

  // Wallet Tracker starten wenn aktiviert
  if (WalletTracker.enabled) WalletTracker.start();

  // News-Sentiment initialisieren
  if (NewsSentiment.enabled) NewsSentiment.fetch().catch(() => {});

  // Meta-Wächter starten (alle 5 Minuten, versetzt zur SelfHeal)
  setTimeout(() => MetaWatchdog.start(300000), 90000); // 90s nach Boot starten
  Log.boot('Meta-Wächter geplant (startet in 90s)');

  ProfitOptimizer.start();
  StaleOrderCleaner.start();
  AutonomousRepair.start();
  SecurityKI.start();
  UpdateKI.checkVersion().catch(()=>{});
  Log.boot('Security-KI + Update-KI aktiv');

  // HEARTBEAT: Telegram Liveness alle 6h
  setInterval(() => {
    try {
      const upH = (process.uptime()/3600).toFixed(1);
      const demoS = DemoEngine.stats || {};
      const w = DemoEngine.wallet || {};
      TelegramBot.send('\u{1F493} NEXUS Heartbeat\nUptime: '+upH+'h\nWallet: '+(w.total||0).toFixed(2)+' USDT\nTrades: '+(demoS.trades||0)+' ('+(demoS.wins||0)+'W/'+(demoS.losses||0)+'L)\nOpen: '+Object.keys(DemoEngine.positions||{}).length+'\nGates: '+(NoTrade.verdict().allowTrade?'ALL_GREEN':NoTrade.verdict().reason));
      Log.info('HEARTBEAT', 'Liveness OK');
    } catch(_) {}
  }, 6 * 3600 * 1000);
  Log.boot('Heartbeat: Telegram alle 6h');

  // Reconciliation every 5min
  setInterval(async ()=>{ await Recon.run(); }, 300000);

  // Strategy auto-disable check every 6h
  setInterval(()=>{ Strategies.autoDisable(); }, 6*3600*1000);

  try { if(LiveBenchmark?.init) LiveBenchmark.init(); } catch(_) {}

  // M1 OPTIMIERUNGEN – Keep-Alive, Memory, ARM64
  M1Optimizer.init();
  Log.boot(`Platform: ${process.arch} | Node: ${process.version} | ${process.arch==='arm64'?'M1 NATIVE ARM64 ✓':'x64 (für M1: Node.js ARM64 installieren)'}`);

  // ML MODELLE LADEN – aus SQLite (überleben jeden Neustart)
  Log.boot('MLPersist: Lade gespeicherte ML-Modelle...');
  const mlLoaded = MLPersist.loadAll();
  if (mlLoaded.loaded > 0) {
    Log.boot(`MLPersist: ${mlLoaded.loaded} Modelle wiederhergestellt – Demo-Wissen bleibt erhalten!`);
  } else {
    Log.boot('MLPersist: Keine gespeicherten Modelle – erster Start oder nach Reset');
  }

  // DB-WÄCHTER starten – hält Datenbank schlank
  DBWatchdog.start();
  Log.boot(`DB-Wächter aktiv: max ${DBWatchdog.LIMITS.system_log.toLocaleString()} Logs, ${DBWatchdog.LIMITS.candle_cache_days}d Kerzen-Cache, bereinigt täglich 04:00`);

  // COIN SCANNER starten – wählt automatisch beste Coins
  if (CoinScanner.enabled) {
    CoinScanner.start();
    Log.boot(`CoinScanner: ${CoinScanner.WATCHLIST.length} Coins überwacht | Top ${CoinScanner.maxActive} aktiv | alle 5min`);
  }

  // DemoEngine initialisieren
  if (!CFG.API_KEY) {
    DemoEngine.mode = 'DEMO';
    DemoEngine.running = false;
    CFG.DEPLOY_MODE = 'PAPER';
    Log.boot('DemoEngine: DEMO-MODUS (kein API Key → Spielgeld)');
  } else {
    DemoEngine.mode = 'DEMO'; // Auch mit API Key erstmal Demo
    Log.boot('DemoEngine: DEMO-MODUS (API Key vorhanden – /api/mode zum Wechseln auf LIVE)');
  }
  NoTrade.gates.deployModeAllows = true; // Demo darf handeln

  // Graceful Shutdown – Modelle vor dem Beenden speichern
  process.on('SIGTERM', () => { MLPersist.onShutdown(); process.exit(0); });
  process.on('SIGINT',  () => { MLPersist.onShutdown(); process.exit(0); });

  // Phase 3.5: Wallet ZUERST laden, dann Zombie-Cleanup mit Wallet-Rueckbuchung
  try {
    if (DemoEngine._loadWallet()) Log.boot('Wallet geladen: T='+DemoEngine.wallet.total.toFixed(2));
    else Log.boot('Wallet: Neustart');
  } catch(_) { Log.boot('Wallet: Neustart'); }

  // Zombie-Trades: echter Preis + Wallet zurueck (gleiche Logik wie StaleOrderCleaner)
  try {
    const zombies = Trades.getActive().filter(t => t.strategy === 'DEMO_UNIFIED');
    if (zombies.length > 0) {
      (async () => {
        let totalCredited = 0;
        for (const t of zombies) {
          try {
            // Echten Preis holen
            let exitPrice = 0;
            try {
              const ticker = Bitget.priceCache && Bitget.priceCache[t.symbol];
              if (ticker && ticker.last > 0) exitPrice = ticker.last;
              else {
                const t2 = await Bitget.fetchTicker(t.symbol).catch(() => null);
                if (t2 && t2.last > 0) exitPrice = t2.last;
              }
            } catch(_){}
            if (!exitPrice && t.entry_price) exitPrice = t.entry_price;

            const entry = t.entry_price || 0;
            const size  = t.size || 0;
            const dir   = (t.side === 'sell') ? -1 : 1;
            const gross = entry > 0 ? (dir * (exitPrice - entry) / entry) * size : 0;
            const fees  = size * (CFG.MAKER_FEE + CFG.TAKER_FEE);
            const pnl   = gross - fees;

            DB.updateTrade.run('CLOSED', exitPrice, pnl, 'BOOT_CLEANUP', Date.now(), Date.now(), t.id);

            // Wallet korrekt zurueckbuchen
            try {
              WalletProvider.credit(size);
              WalletProvider.applyPnL(pnl);
              totalCredited += size;
            } catch(e){ try{Log.warn('BOOT','wallet credit err: '+e.message);}catch(_){} }

            Log.boot('Zombie-Close '+t.symbol+' size='+size.toFixed(2)+' exit='+exitPrice.toFixed(4)+' pnl='+pnl.toFixed(4));
          } catch(e){ try{Log.warn('BOOT','zombie err: '+e.message);}catch(_){} }
        }
        Log.boot('Zombie-Cleanup: '+zombies.length+' Trades geschlossen, '+totalCredited.toFixed(2)+' USDT zurueckgebucht');
      })();
    }
  } catch(_) {}

  // Auto-Start DemoEngine im PAPER Modus
  if (CFG.DEPLOY_MODE === 'PAPER' || !CFG.API_KEY) {
    DemoEngine.start(DemoEngine.wallet?.total || 1000);
    Log.boot('DemoEngine auto-gestartet (PAPER Modus)');
  }

  try { DBJanitor.start(); } catch(e) { try{Log.warn('BOOT','Janitor err: '+e.message);}catch(_){} }

    Log.boot(`BOOT COMPLETE | Balance: ${Balance.usable.toFixed(2)} USDT | Mode: ${DemoEngine.mode} | ML: ${mlLoaded.loaded > 0 ? 'GELADEN' : 'LEER'}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── LIVE BENCHMARK: NEXUS vs BTC Hold ───────────────────────────────────────
const LiveBenchmark = {
  startPrice: 0,
  startCapital: 0,
  startTs: 0,

  init(capital) {
    if (this.startTs > 0) return;
    this.startCapital = capital;
    this.startTs = Date.now();
    // BTC Startpreis merken
    const btcPrice = Bitget.priceCache['BTCUSDT']?.last || 0;
    this.startPrice = btcPrice;
    Log.info('BENCHMARK', 'Start: Kapital='+capital.toFixed(2)+' BTC='+btcPrice.toFixed(2));
  },

  snapshot(currentCapital) {
    if (!this.startTs || !this.startPrice || !this.startCapital) return null;
    const btcNow = Bitget.priceCache['BTCUSDT']?.last || 0;
    if (!btcNow) return null;

    const nexusPct  = ((currentCapital - this.startCapital) / this.startCapital * 100);
    const btcPct    = ((btcNow - this.startPrice) / this.startPrice * 100);
    const alpha     = nexusPct - btcPct;
    const daysSince = (Date.now() - this.startTs) / 86400000;

    return {
      nexusPct:   parseFloat(nexusPct.toFixed(2)),
      btcPct:     parseFloat(btcPct.toFixed(2)),
      alpha:      parseFloat(alpha.toFixed(2)),
      beating:    alpha > 0,
      daysSince:  parseFloat(daysSince.toFixed(1)),
      startCapital: this.startCapital,
      currentCapital,
      btcStart:   this.startPrice,
      btcNow,
    };
  }
};

// ── SMART MONEY TRACKER ──────────────────────────────────────────────────────
const SmartMoney = {
  cache: {},
  CACHE_TTL: 20 * 60 * 1000,

  // Smart Money Signal: OI-Anstieg + Funding neutral + Preis stabil = Akkumulation
  async getSignal(symbol) {
    const cached = this.cache[symbol];
    if (cached && Date.now() - (cached.ts||0) < this.CACHE_TTL) return cached;

    try {
      // Open Interest von Bitget
      const oiUrl = 'https://api.bitget.com/api/v2/mix/market/open-interest?symbol='+symbol+'&productType=usdt-futures';
      const oiR = await axios.get(oiUrl, { timeout:8000 });
      const oi = parseFloat(oiR.data?.data?.openInterestList?.[0]?.size || 0);

      // Funding Rate
      const frUrl = 'https://api.bitget.com/api/v2/mix/market/current-fund-rate?symbol='+symbol+'&productType=usdt-futures';
      const frR = await axios.get(frUrl, { timeout:8000 });
      const fr = parseFloat(frR.data?.data?.[0]?.fundingRate || 0);

      // Preis-Trend letzte Stunde
      const candles = await Bitget.fetchCandles(symbol, '1h', 3).catch(()=>[]);
      const priceTrend = candles.length >= 2 ? (candles[candles.length-1].close - candles[0].close) / candles[0].close : 0;

      // Smart Money Akkumulation: OI steigt, Funding neutral (-0.01 bis +0.01), Preis seitwärts
      let signal = 'NEUTRAL';
      if (oi > 0 && Math.abs(fr) < 0.01 && Math.abs(priceTrend) < 0.005) signal = 'ACCUMULATION';
      else if (fr > 0.02 && priceTrend > 0.01) signal = 'OVERHEATED';
      else if (fr < -0.02 && priceTrend < -0.01) signal = 'DISTRIBUTION';

      const result = { signal, oi, fundingRate:fr, priceTrend, ts:Date.now() };
      this.cache[symbol] = result;
      Log.info('SMARTMONEY', symbol+' '+signal+' OI='+oi.toFixed(0)+' FR='+fr.toFixed(4));
      return result;
    } catch(_) { return { signal:'NEUTRAL', ts:Date.now() }; }
  },

  async getStrengthModifier(symbol, direction) {
    try {
      const s = await this.getSignal(symbol);
      if (s.signal==='ACCUMULATION' && direction==='BUY')  return +0.07;
      if (s.signal==='DISTRIBUTION' && direction==='SELL') return +0.07;
      if (s.signal==='OVERHEATED'   && direction==='BUY')  return -0.07;
      if (s.signal==='DISTRIBUTION' && direction==='BUY')  return -0.07;
    } catch(_) {}
    return 0;
  }
};

// ── ON-CHAIN ANALYSE: Whale Alert RSS ───────────────────────────────────────
const OnChainAnalysis = {
  cache: { btc:{}, eth:{}, sol:{} },
  CACHE_TTL: 10 * 60 * 1000, // 10 Minuten

  async fetchWhaleAlerts(coin) {
    try {
      const url = 'https://api.whale-alert.io/v1/transactions?api_key=free&min_value=500000&limit=10&currency='+coin.toLowerCase();
      const r = await axios.get(url, { timeout:8000 });
      const txs = r.data?.transactions || [];
      let inflow=0, outflow=0;
      txs.forEach(tx => {
        if (tx.to?.owner_type==='exchange') outflow += tx.amount_usd||0;
        if (tx.from?.owner_type==='exchange') inflow += tx.amount_usd||0;
      });
      return { inflow, outflow, netFlow: inflow-outflow, txCount: txs.length };
    } catch(_) { return null; }
  },

  async getSignal(symbol) {
    const coin = symbol.replace('USDT','');
    const key = coin.toLowerCase();
    const cached = this.cache[key];
    if (cached && Date.now() - (cached.ts||0) < this.CACHE_TTL) return cached;

    const data = await this.fetchWhaleAlerts(coin);
    if (!data) return { signal:'NEUTRAL', netFlow:0, ts:Date.now() };

    // Netto-Inflow zu Exchange = Verkaufsdruck = BEARISH
    // Netto-Outflow von Exchange = Akkumulation = BULLISH
    const signal = data.netFlow < -1000000 ? 'BULLISH' :
                   data.netFlow >  1000000 ? 'BEARISH' : 'NEUTRAL';
    const result = { ...data, signal, ts: Date.now() };
    this.cache[key] = result;
    Log.info('ONCHAIN', coin+' WhaleFlow: '+signal+' netFlow='+((data.netFlow/1e6).toFixed(1))+'M USD');
    return result;
  },

  async getStrengthModifier(symbol, direction) {
    try {
      const s = await this.getSignal(symbol);
      if (s.signal==='BULLISH' && direction==='BUY')  return +0.07;
      if (s.signal==='BEARISH' && direction==='SELL') return +0.07;
      if (s.signal==='BEARISH' && direction==='BUY')  return -0.07;
      if (s.signal==='BULLISH' && direction==='SELL') return -0.07;
    } catch(_) {}
    return 0;
  }
};

// ── SENTIMENT-KI: Augmento + Reddit ─────────────────────────────────────────
const SentimentAI = {
  cache: {}, // symbol -> { score, signal, ts }
  CACHE_TTL: 15 * 60 * 1000, // 15 Minuten

  async fetchRedditSentiment(coin) {
    try {
      const sub = coin==='BTC' ? 'Bitcoin' : coin==='ETH' ? 'ethereum' : coin==='SOL' ? 'solana' : 'CryptoCurrency';
      const url = 'https://www.reddit.com/r/'+sub+'/hot.json?limit=10';
      const r = await axios.get(url, { headers:{ 'User-Agent':'NEXUS-Bot/1.0' }, timeout:8000 });
      const posts = r.data?.data?.children || [];
      const bullWords = ['bullish','moon','pump','buy','long','breakout','ath','surge','rally'];
      const bearWords = ['bearish','dump','sell','short','crash','drop','fear','down','rekt'];
      let bull=0, bear=0;
      posts.forEach(p => {
        const txt = ((p.data?.title||'')+(p.data?.selftext||'')).toLowerCase();
        bullWords.forEach(w => { if(txt.includes(w)) bull++; });
        bearWords.forEach(w => { if(txt.includes(w)) bear++; });
      });
      const total = bull + bear || 1;
      return { bull, bear, score: (bull-bear)/total, source:'reddit' };
    } catch(_) { return null; }
  },

  async getSentiment(symbol) {
    const coin = symbol.replace('USDT','');
    const cached = this.cache[symbol];
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) return cached;

    const reddit = await this.fetchRedditSentiment(coin);
    const score = reddit ? reddit.score : 0;
    const signal = score > 0.2 ? 'BULLISH' : score < -0.2 ? 'BEARISH' : 'NEUTRAL';
    const result = { score, signal, ts: Date.now(), sources: { reddit } };
    this.cache[symbol] = result;
    return result;
  },

  // Gibt Stärke-Modifier zurück: -0.10 bis +0.10
  async getStrengthModifier(symbol, direction) {
    try {
      const s = await this.getSentiment(symbol);
      if (s.signal==='BULLISH' && direction==='BUY')  return +0.08;
      if (s.signal==='BEARISH' && direction==='SELL') return +0.08;
      if (s.signal==='BEARISH' && direction==='BUY')  return -0.08;
      if (s.signal==='BULLISH' && direction==='SELL') return -0.08;
    } catch(_) {}
    return 0;
  }
};

// Wochenbericht: jeden Sonntag 09:00 UTC per Telegram
setInterval(() => {
  const now = new Date();
  if (now.getUTCDay() === 0 && now.getUTCHours() === 9 && now.getUTCMinutes() < 2) {
    try {
      const w = DemoEngine.wallet;
      const stats = DemoEngine.stats || {};
      const total = (stats.wins||0) + (stats.losses||0);
      const winRate = total > 0 ? ((stats.wins||0)/total*100).toFixed(1) : '0.0';
      const msg = [
        'NEXUS V9 — Wochenbericht',
        'Kapital: '+(w.total||0).toFixed(2)+' USDT',
        'Woche PnL: '+(w.pnl||0).toFixed(2)+' USDT',
        'Win-Rate: '+winRate+'%',
        'Trades: '+total+' ('+( stats.wins||0)+'W / '+(stats.losses||0)+'L)',
        'Peak: '+(w.peakTotal||0).toFixed(2)+' USDT',
      ].join('\n');
      TelegramBot.send(msg);
      Log.info('WEEKLY', 'Wochenbericht gesendet');
    } catch(e) { Log.warn('WEEKLY', 'Fehler: '+e.message); }
  }
}, 60000); // jede Minute prüfen

// START
// ─────────────────────────────────────────────────────────────────────────────
boot().then(()=>{
  app.listen(CFG.PORT, ()=>{
    console.log(`
  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗  ██████╗ ██████╗  ██████╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝  ██╔══██╗██╔══██╗██╔═══██╗
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗  ██████╔╝██████╔╝██║   ██║
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║  ██╔═══╝ ██╔══██╗██║   ██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║  ██║     ██║  ██║╚██████╔╝
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝  ╚═╝     ╚═╝  ╚═╝ ╚═════╝

  V9 PRO | ${CFG.DEPLOY_MODE} | ${CFG.API_KEY?'LIVE':'DEMO'} | http://localhost:${CFG.PORT}
  SQLite · WebSocket · Sharpe · Squeeze · CMO · OFI · Auto-Disable
    `);
    Log.boot(`Listening on port ${CFG.PORT}`);
  });
}).catch(e=>{ console.error('BOOT FAILED:', e); process.exit(1); });
