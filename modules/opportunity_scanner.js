// modules/opportunity_scanner.js — Opportunity-Detection für Eviction-Engine
// Verankert 2026-05-23 (G7.1 — Master-Pipeline G7).
//
// Profil: MITTEL (Christian's Wahl 2026-05-23)
// Quellen: docs/OPPORTUNITY_EVICTION_RESEARCH_20260523.md (12 Quellen, Liga-Vergleich)
//
// Score-Formel:
//   score = (priceMove1h × 100) × 0.4
//         + (priceMove24h × 100) × 0.2
//         + (volumeSpike) × 0.2     // 1.0=normal, 2.0=2× MA, 3.0=3× MA
//         + (momentumStrength) × 0.1 // 0..10
//         + (brainConfidence × 10) × 0.1
//   × regimeBonus (CRASH=2.0, BULL_STRONG=2.0, SQUEEZE=1.5, sonst 1.0)
//
// Trigger-Schwellen MITTEL:
//   priceMove1h ≥ 4% (BULL/BEAR) oder ≥ 2% (CRASH/SQUEEZE)
//   volumeSpike ≥ 2× 20-Period-MA
//   Brain-Conf ≥ 0.12, MTF-Alignment empfohlen
//   Score ≥ 6.0 → BIG Opportunity
//
// HMM-Direction-Filter (G7-Antwort 5):
//   BEAR/CRASH → nur SHORT-Opportunities zählen
//   BULL_STRONG/SQUEEZE → nur LONG-Opportunities zählen
//   RANGING/NEUTRAL → Scanner skipt (kein Bias)

'use strict';

const OpportunityScanner = {
  _db: null,
  _Bitget: null,
  _HMM: null,
  _logFn: null,
  _cronTimer: null,
  _stats: { scans: 0, opps_logged: 0, big_opps: 0, errors: 0, last_scan_ts: 0 },
  _topOpps: [],       // letzte big-opportunities (für Dashboard)
  _initialized: false,

  // MITTEL-Profil aus Recherche-Doc
  CFG: {
    PRICE_MOVE_1H_PCT_NORMAL:    0.04,   // 4%
    PRICE_MOVE_1H_PCT_HIGHVOL:   0.02,   // 2% in CRASH/SQUEEZE
    PRICE_MOVE_24H_PCT_MIN:      0.04,
    VOLUME_SPIKE_FACTOR_MIN:     2.0,
    MIN_BRAIN_CONF:              0.12,
    SCORE_THRESHOLD_BIG:         6.0,
    SCAN_INTERVAL_MS:            60000,  // 60s ticks
    VOL_MA_PERIOD:               20,     // 20-period volume MA
    REGIME_BONUS: {
      CRASH: 2.0, BULL_STRONG: 2.0, SQUEEZE: 1.5,
      BULL_WEAK: 1.2, BEAR_WEAK: 1.2, BEAR: 1.2,
    },
    REGIME_ALLOW: ['BEAR','CRASH','BULL_STRONG','SQUEEZE','BULL_WEAK','BEAR_WEAK'],
    REGIME_BLOCK: ['RANGING','NEUTRAL'],
  },

  init(db, bitgetClient, hmmModule) {
    this._db = db;
    this._Bitget = bitgetClient;
    this._HMM = hmmModule;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS opportunity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          direction TEXT NOT NULL,
          score REAL NOT NULL,
          regime TEXT,
          components_json TEXT,
          big_opp INTEGER DEFAULT 0,
          action TEXT,
          eviction_id INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_opp_ts ON opportunity_log(ts);
        CREATE INDEX IF NOT EXISTS idx_opp_symbol_ts ON opportunity_log(symbol, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_opp_big ON opportunity_log(big_opp, ts DESC);
      `);
      this._initialized = true;
      try { this._logFn.info && this._logFn.info('OPP_SCAN', `init MITTEL-profile (score≥${this.CFG.SCORE_THRESHOLD_BIG}, scan=${this.CFG.SCAN_INTERVAL_MS/1000}s)`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('OPP_SCAN', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  // ─── Score-Komponenten pro Symbol ─────────────────────────────
  async _scoreSymbol(symbol, regime, brainConf) {
    if (!this._Bitget) return null;
    try {
      const candles = await this._Bitget.fetchCandles(symbol, '1h', 30);
      if (!candles || candles.length < 25) return null;
      const closes = candles.map(c => parseFloat(c.close ?? c[4]));
      const vols   = candles.map(c => parseFloat(c.volume ?? c[5] ?? 0));
      const last = closes[closes.length - 1];
      const prev1h = closes[closes.length - 2];
      const prev24h = closes[Math.max(0, closes.length - 25)];
      if (!isFinite(last) || !isFinite(prev1h) || !isFinite(prev24h)) return null;
      const priceMove1h = (last - prev1h) / prev1h;
      const priceMove24h = (last - prev24h) / prev24h;
      // Direction aus Move (>0 LONG, <0 SHORT)
      const direction = priceMove24h > 0 ? 'LONG' : 'SHORT';
      // Volume Spike: aktuelles vol vs. 20-period MA
      const volMA = vols.slice(-1 - this.CFG.VOL_MA_PERIOD, -1).reduce((s, v) => s + v, 0) / this.CFG.VOL_MA_PERIOD;
      const volCurrent = vols[vols.length - 1];
      const volumeSpike = volMA > 0 ? volCurrent / volMA : 1.0;
      // Momentum (einfach: |1h-move| × ATR-norm)
      let trSum = 0;
      const highs = candles.map(c => parseFloat(c.high ?? c[2]));
      const lows = candles.map(c => parseFloat(c.low ?? c[3]));
      for (let i = 1; i < candles.length; i++) {
        trSum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
      }
      const atr = trSum / (candles.length - 1);
      const momentumStrength = atr > 0 ? Math.min(10, Math.abs(priceMove1h) / (atr / last) * 5) : 0;
      // Regime-Bonus
      const regimeBonus = this.CFG.REGIME_BONUS[regime] || 1.0;
      // Score-Formel
      let scoreRaw =   (Math.abs(priceMove1h) * 100) * 0.4
                     + (Math.abs(priceMove24h) * 100) * 0.2
                     + (volumeSpike) * 0.2
                     + (momentumStrength) * 0.1
                     + ((brainConf || 0) * 10) * 0.1;
      const score = scoreRaw * regimeBonus;
      // Threshold-Check
      const moveThresh = ['CRASH','SQUEEZE'].includes(regime) ? this.CFG.PRICE_MOVE_1H_PCT_HIGHVOL : this.CFG.PRICE_MOVE_1H_PCT_NORMAL;
      const passMove   = Math.abs(priceMove1h) >= moveThresh;
      const passVol    = volumeSpike >= this.CFG.VOLUME_SPIKE_FACTOR_MIN;
      const passConf   = (brainConf || 0) >= this.CFG.MIN_BRAIN_CONF;
      const passScore  = score >= this.CFG.SCORE_THRESHOLD_BIG;
      const isBig = passMove && passVol && passConf && passScore;
      return {
        symbol, direction, score: +score.toFixed(3), regime,
        components: {
          priceMove1h: +priceMove1h.toFixed(4),
          priceMove24h: +priceMove24h.toFixed(4),
          volumeSpike: +volumeSpike.toFixed(2),
          momentumStrength: +momentumStrength.toFixed(2),
          brainConfidence: +(brainConf || 0).toFixed(3),
          regimeBonus,
        },
        passMove, passVol, passConf, passScore, isBig,
      };
    } catch(_) { return null; }
  },

  // ─── Brain-Conf-Lookup (aus aladdin_decisions, neueste pro Symbol) ───
  _brainConfForSymbol(symbol) {
    if (!this._db) return 0;
    try {
      const r = this._db.prepare(`SELECT confidence FROM aladdin_decisions WHERE symbol = ? ORDER BY ts DESC LIMIT 1`).get(symbol);
      return r ? Number(r.confidence) || 0 : 0;
    } catch(_) { return 0; }
  },

  // ─── Scan all coins ──────────────────────────────────────────
  async scan() {
    if (!this._initialized || !this._Bitget) return;
    this._stats.scans++;
    this._stats.last_scan_ts = Date.now();
    // HMM-State holen
    let hmmState = 'RANGING';
    try {
      if (this._HMM && this._HMM.getCurrentRegime) {
        const r = this._HMM.getCurrentRegime();
        if (r) hmmState = r.state || 'RANGING';
      }
    } catch(_) {}
    // Regime-Allow-Check: in NEUTRAL/RANGING gar nicht scannen
    if (this.CFG.REGIME_BLOCK.includes(hmmState)) {
      this._topOpps = [];
      return;
    }
    // HMM-Direction-Filter
    const allowedDirection = (hmmState === 'BEAR' || hmmState === 'CRASH' || hmmState === 'BEAR_WEAK') ? 'SHORT'
                           : (hmmState === 'BULL_STRONG' || hmmState === 'BULL_WEAK' || hmmState === 'SQUEEZE') ? 'LONG'
                           : null;
    // Symbols: Top-10 wie HMM_BROAD
    const fallback = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','ATOMUSDT'];
    const active = (typeof CoinScanner !== 'undefined' && Array.isArray(CoinScanner.activeCoins)) ? CoinScanner.activeCoins : [];
    const merged = []; const seen = new Set();
    for (const s of [...active, ...fallback]) { if (s && !seen.has(s)) { merged.push(s); seen.add(s); } if (merged.length >= 10) break; }
    // Score pro Symbol
    const results = [];
    for (const sym of merged) {
      try {
        const brainConf = this._brainConfForSymbol(sym);
        const r = await this._scoreSymbol(sym, hmmState, brainConf);
        if (r) {
          // HMM-Direction-Filter anwenden
          if (allowedDirection && r.direction !== allowedDirection) {
            r.isBig = false;  // wrong direction → kein big-opp
            r._directionMismatch = true;
          }
          results.push(r);
          // DB-Log
          try {
            this._db.prepare(`INSERT INTO opportunity_log
              (ts, symbol, direction, score, regime, components_json, big_opp)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
              Date.now(), sym, r.direction, r.score, hmmState,
              JSON.stringify(r.components), r.isBig ? 1 : 0
            );
            this._stats.opps_logged++;
            if (r.isBig) this._stats.big_opps++;
          } catch(_) {}
        }
      } catch(e) { this._stats.errors++; }
    }
    // Top-Opps cachen (für Dashboard)
    this._topOpps = results.sort((a, b) => b.score - a.score).slice(0, 5);
  },

  // ─── Public: aktuelle BIG-Opportunity finden (für Eviction-Engine) ───
  getCurrentBigOpportunity() {
    if (!this._topOpps || !this._topOpps.length) return null;
    const big = this._topOpps.find(o => o.isBig);
    return big || null;
  },

  startCron() {
    if (this._cronTimer) return;
    // First nach 90s (gibt HMM + Brain Zeit)
    setTimeout(() => this.scan().catch(()=>{}), 90000);
    this._cronTimer = setInterval(() => this.scan().catch(()=>{}), this.CFG.SCAN_INTERVAL_MS);
    try { this._logFn.info && this._logFn.info('OPP_SCAN', `cron started (${this.CFG.SCAN_INTERVAL_MS/1000}s interval)`); } catch(_) {}
  },

  stopCron() { if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; } },

  snapshot() {
    return {
      initialized: this._initialized,
      ...this._stats,
      cfg: this.CFG,
      topOpps: this._topOpps,
      bigOpp: this.getCurrentBigOpportunity(),
    };
  },
};

module.exports = OpportunityScanner;
