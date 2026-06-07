// modules/datasource_macro.js — Macro-Regime Sub-Source (Risk-On / Risk-Off / Neutral)
// Verankert 2026-05-20 als MACRO_REGIME-Pipeline.
//
// Quellen:
//   1. CoinGecko /global — BTC-Dominance (kein Key, free, 5-15 req/min)
//   2. FRED API — DGS10/DTWEXBGS/CPIAUCSL (optional, braucht FRED_API_KEY in .env)
//   3. Graceful Degradation: CoinGecko-only wenn FRED fehlt
//
// Brain-Schutzzone:
//   - Score-Berechnung als eigene Sub-Source `macroRegime`
//   - In SENTIMENT-Familie (Risk-On/Off ist Sentiment-Konzept, nicht Trend-pair)
//   - Konservatives Initial-Gewicht 0.05

'use strict';

const axios = require('axios');

const DataSourceMacro = {
  _cache: {
    btcd: null,         // { value, lastFetch, history: [...] }
    dxy: null,
    us10y: null,
    cpi: null,
  },
  _ttl: {
    btcd: 15 * 60 * 1000,    // 15 min
    dxy:   6 * 60 * 60 * 1000, // 6h (FRED daily-update)
    us10y: 6 * 60 * 60 * 1000,
    cpi:  24 * 60 * 60 * 1000,
  },
  _db: null,
  _logFn: null,
  _fredKey: null,

  init(db) {
    this._db = db;
    this._fredKey = (process.env.FRED_API_KEY || '').trim() || null;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info:console.log, warn:console.warn };
    // Schema (idempotent)
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS macro_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
        value REAL,
        classification TEXT,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_macro_state_ts ON macro_state(ts);
      CREATE INDEX IF NOT EXISTS idx_macro_state_src ON macro_state(source);`);
    } catch(_) {}
    try { this._logFn.info && this._logFn.info('MACRO', `init: FRED_KEY=${this._fredKey ? 'SET' : 'MISSING (CoinGecko-only)'}`); } catch(_) {}
  },

  // ─── Fetcher ──────────────────────────────────────────────────────
  async _fetchBtcD() {
    const now = Date.now();
    if (this._cache.btcd && (now - this._cache.btcd.lastFetch) < this._ttl.btcd) return this._cache.btcd.value;
    try {
      const r = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8000 });
      const btcd = r.data?.data?.market_cap_percentage?.btc;
      if (typeof btcd === 'number' && isFinite(btcd) && btcd > 30 && btcd < 80) {
        const prev = this._cache.btcd ? this._cache.btcd.value : btcd;
        this._cache.btcd = { value: btcd, prev, lastFetch: now };
        this._persist('btcd', btcd, this._classifyBtcD(btcd), { prev });
        return btcd;
      }
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('MACRO', 'btcd fetch fail: ' + e.message); } catch(_){}
    }
    return this._cache.btcd ? this._cache.btcd.value : null;
  },

  async _fetchFred(seriesId, cacheKey) {
    if (!this._fredKey) return null;
    const now = Date.now();
    const cached = this._cache[cacheKey];
    if (cached && (now - cached.lastFetch) < this._ttl[cacheKey]) return cached.value;
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${this._fredKey}&file_type=json&sort_order=desc&limit=2`;
      const r = await axios.get(url, { timeout: 8000 });
      const obs = r.data?.observations || [];
      if (obs.length > 0) {
        const val = parseFloat(obs[0].value);
        const prev = obs.length > 1 ? parseFloat(obs[1].value) : val;
        if (isFinite(val)) {
          this._cache[cacheKey] = { value: val, prev, lastFetch: now };
          this._persist(cacheKey, val, null, { prev, series: seriesId });
          return val;
        }
      }
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('MACRO', `${seriesId} fetch fail: ${e.message}`); } catch(_){}
    }
    return cached ? cached.value : null;
  },

  _persist(source, value, classification, meta) {
    if (!this._db) return;
    try {
      this._db.prepare(`INSERT INTO macro_state (ts, source, value, classification, meta) VALUES (?,?,?,?,?)`).run(
        Date.now(), source, value,
        classification || null,
        meta ? JSON.stringify(meta).slice(0, 500) : null
      );
    } catch(_) {}
  },

  // ─── Klassifikation ───────────────────────────────────────────────
  _classifyBtcD(btcd) {
    if (!isFinite(btcd)) return 'UNKNOWN';
    if (btcd < 54) return 'RISK_ON_ALT';
    if (btcd < 56) return 'LEAN_RISK_ON';
    if (btcd < 60) return 'NEUTRAL';
    if (btcd < 62) return 'LEAN_RISK_OFF';
    return 'STRONG_RISK_OFF';
  },

  // ─── Haupt-Signal für Brain ──────────────────────────────────────
  async getSignal(/* symbol */) {
    const [btcd, dxy, us10y] = await Promise.all([
      this._fetchBtcD(),
      this._fetchFred('DTWEXBGS', 'dxy'),
      this._fetchFred('DGS10', 'us10y'),
    ]);

    // Score-Aggregation: BTC.D Hauptkomponente, FRED-Inputs optional
    let score = 0;
    let confidence = 0;
    const factors = [];

    if (btcd !== null && isFinite(btcd)) {
      if (btcd < 54)      { score += 0.4;  factors.push('BTCD<54%_RISK_ON'); }
      else if (btcd < 56) { score += 0.2;  factors.push('BTCD<56%_LEAN_RISK_ON'); }
      else if (btcd < 60) { score += 0;    factors.push('BTCD_NEUTRAL'); }
      else if (btcd < 62) { score -= 0.2;  factors.push('BTCD>60%_LEAN_RISK_OFF'); }
      else                { score -= 0.4;  factors.push('BTCD>62%_RISK_OFF'); }
      confidence = 0.5;
    }

    // BTC.D-Trend (wenn Vorgängerwert da)
    const prev = this._cache.btcd?.prev;
    if (btcd !== null && prev !== undefined && Math.abs(btcd - prev) > 0.3) {
      const trend = btcd > prev ? 'RISING' : 'FALLING';
      factors.push('BTCD_' + trend);
      // Rising = Bitcoin gewinnt → Alts schwach → SELL für Alts (aber Brain entscheidet pro Symbol)
      if (trend === 'RISING') score -= 0.1; else score += 0.1;
    }

    // FRED-Inputs (falls vorhanden)
    if (dxy !== null && isFinite(dxy)) {
      // DTWEXBGS Trade-Weighted USD. ~100 baseline. >105 strong USD = risk-off
      if (dxy > 108)      { score -= 0.3; factors.push('DXY>108_STRONG_USD_RISK_OFF'); }
      else if (dxy > 103) { score -= 0.1; factors.push('DXY>103_USD_FIRM'); }
      else if (dxy < 97)  { score += 0.2; factors.push('DXY<97_USD_WEAK_RISK_ON'); }
      confidence = Math.max(confidence, 0.7);
    }
    if (us10y !== null && isFinite(us10y)) {
      if (us10y > 4.8)      { score -= 0.3; factors.push('US10Y>4.8%_INFLATIONARY'); }
      else if (us10y > 4.2) { score -= 0.1; factors.push('US10Y>4.2%_ELEVATED'); }
      else if (us10y < 3.2) { score += 0.2; factors.push('US10Y<3.2%_DEFLATIONARY_LIQUIDITY'); }
      confidence = Math.max(confidence, 0.75);
    }

    // Confidence-Penalty wenn nur BTC.D verfügbar (kein FRED)
    if (dxy === null && us10y === null) confidence = Math.min(confidence, 0.5);

    // Clamp score
    score = Math.max(-1, Math.min(1, score));
    const direction = score > 0.1 ? 'BUY' : score < -0.1 ? 'SELL' : 'NEUTRAL';

    let regime = 'NEUTRAL';
    if (score > 0.3) regime = 'RISK_ON';
    else if (score > 0.1) regime = 'LEAN_RISK_ON';
    else if (score < -0.3) regime = 'RISK_OFF';
    else if (score < -0.1) regime = 'LEAN_RISK_OFF';

    return {
      direction,
      score: parseFloat(score.toFixed(3)),
      confidence: parseFloat(confidence.toFixed(2)),
      regime,
      btcd: btcd !== null ? parseFloat(btcd.toFixed(2)) : null,
      dxy: dxy !== null ? parseFloat(dxy.toFixed(2)) : null,
      us10y: us10y !== null ? parseFloat(us10y.toFixed(3)) : null,
      factors,
      source: this._fredKey ? 'coingecko+fred' : 'coingecko_only',
    };
  },

  // ─── Cron (Background-Refresh) ───────────────────────────────────
  startCron() {
    if (this._cronTimer) return;
    // First fetch nach 30s damit Boot nicht blockt
    setTimeout(() => this._fetchBtcD().catch(() => {}), 30000);
    setTimeout(() => this._fetchFred('DTWEXBGS', 'dxy').catch(() => {}), 35000);
    setTimeout(() => this._fetchFred('DGS10', 'us10y').catch(() => {}), 40000);
    // Wiederholt alle 15min
    this._cronTimer = setInterval(() => {
      this._fetchBtcD().catch(() => {});
      this._fetchFred('DTWEXBGS', 'dxy').catch(() => {});
      this._fetchFred('DGS10', 'us10y').catch(() => {});
    }, 15 * 60 * 1000);
    try { this._logFn.info && this._logFn.info('MACRO', 'cron started (15min interval)'); } catch(_) {}
  },

  stopCron() { if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; } },

  snapshot() {
    return {
      cache: {
        btcd: this._cache.btcd,
        dxy: this._cache.dxy,
        us10y: this._cache.us10y,
      },
      fredAvailable: !!this._fredKey,
      ttl: this._ttl,
    };
  },
};

module.exports = DataSourceMacro;
