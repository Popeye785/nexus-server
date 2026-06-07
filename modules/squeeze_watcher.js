// modules/squeeze_watcher.js — G5 Bollinger-Squeeze + Breakout-Trigger
// Verankert 2026-05-23 (G5 — Master-Pipeline G).
//
// SQUEEZE-Detection:
//   - BB-Width unter 20-Period-MA × 0.5
//   - Volatilität-Kompression (ATR sinkt)
//   - Setup pending (kein Trade)
//
// BREAKOUT-Trigger:
//   - Preis verlässt BB mit Volume-Spike ×2 MA
//   - Direction durch Bewegung (Close > upper → LONG, < lower → SHORT)
//   - SINGLE-Trade mit engerem SL (×0.8)
//
// Symbol-Scan alle 60s, In-Memory Cache der pending Setups + Triggered.

'use strict';

const SqueezeWatcher = {
  _db: null,
  _Bitget: null,
  _logFn: null,
  _cronTimer: null,
  _initialized: false,
  _pendingSetups: new Map(),    // symbol → { ts, bbUpper, bbLower, atr, bbWidthMA }
  _triggers: [],                 // letzte 20 Breakout-Triggers
  _stats: { scans: 0, setups_detected: 0, breakouts_triggered: 0, errors: 0 },

  CFG: {
    BB_PERIOD:               20,
    BB_STDDEV:               2,
    BB_WIDTH_MA_PERIOD:      20,
    SQUEEZE_BBWIDTH_RATIO:   0.5,
    BREAKOUT_VOL_SPIKE_MIN:  2.0,
    SCAN_INTERVAL_MS:        60000,
    SETUP_TTL_MS:            14400000,  // 4h pending TTL
  },

  init(db, bitgetClient) {
    this._db = db;
    this._Bitget = bitgetClient;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS squeeze_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          event TEXT NOT NULL,
          bb_upper REAL, bb_lower REAL, bb_width REAL, bb_width_ma REAL,
          breakout_direction TEXT, vol_spike REAL,
          details_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sqz_ts ON squeeze_events(ts);
        CREATE INDEX IF NOT EXISTS idx_sqz_symbol_ts ON squeeze_events(symbol, ts DESC);
      `);
      this._initialized = true;
      try { this._logFn.info && this._logFn.info('SQUEEZE', `init BB(${this.CFG.BB_PERIOD},${this.CFG.BB_STDDEV}), width-MA ${this.CFG.BB_WIDTH_MA_PERIOD}, scan=${this.CFG.SCAN_INTERVAL_MS/1000}s`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('SQUEEZE', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  // Bollinger Bands berechnen
  _bb(closes) {
    const p = this.CFG.BB_PERIOD;
    if (closes.length < p) return null;
    const slice = closes.slice(-p);
    const mean = slice.reduce((s, v) => s + v, 0) / p;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / p;
    const sd = Math.sqrt(variance);
    return { upper: mean + this.CFG.BB_STDDEV * sd, lower: mean - this.CFG.BB_STDDEV * sd, mean, width: 2 * this.CFG.BB_STDDEV * sd };
  },

  // BB-Width MA über N Perioden
  _bbWidthMA(closes) {
    const p = this.CFG.BB_PERIOD;
    const ma = this.CFG.BB_WIDTH_MA_PERIOD;
    if (closes.length < p + ma) return null;
    const widths = [];
    for (let i = closes.length - ma; i < closes.length; i++) {
      const slice = closes.slice(i - p + 1, i + 1);
      if (slice.length < p) continue;
      const mean = slice.reduce((s, v) => s + v, 0) / p;
      const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / p;
      const sd = Math.sqrt(variance);
      widths.push(2 * this.CFG.BB_STDDEV * sd);
    }
    if (!widths.length) return null;
    return widths.reduce((s, v) => s + v, 0) / widths.length;
  },

  async _scanSymbol(symbol) {
    try {
      const candles = await this._Bitget.fetchCandles(symbol, '1h', 50);
      if (!candles || candles.length < 40) return null;
      const closes = candles.map(c => parseFloat(c.close ?? c[4]));
      const vols = candles.map(c => parseFloat(c.volume ?? c[5] ?? 0));
      const bb = this._bb(closes);
      const bbWidthMA = this._bbWidthMA(closes);
      if (!bb || !bbWidthMA) return null;
      const lastPrice = closes[closes.length - 1];
      const isSqueeze = bb.width <= bbWidthMA * this.CFG.SQUEEZE_BBWIDTH_RATIO;
      const setup = this._pendingSetups.get(symbol);
      // SETUP detected
      if (isSqueeze && !setup) {
        const newSetup = { ts: Date.now(), bbUpper: bb.upper, bbLower: bb.lower, bbWidth: bb.width, bbWidthMA, lastPrice };
        this._pendingSetups.set(symbol, newSetup);
        this._stats.setups_detected++;
        try {
          this._db.prepare(`INSERT INTO squeeze_events (ts, symbol, event, bb_upper, bb_lower, bb_width, bb_width_ma, details_json) VALUES (?,?,?,?,?,?,?,?)`).run(
            Date.now(), symbol, 'SETUP_PENDING', bb.upper, bb.lower, bb.width, bbWidthMA, JSON.stringify(newSetup)
          );
        } catch(_) {}
        return { event: 'setup', symbol, bb, bbWidthMA };
      }
      // BREAKOUT-Trigger
      if (setup) {
        // TTL-Check
        if (Date.now() - setup.ts > this.CFG.SETUP_TTL_MS) {
          this._pendingSetups.delete(symbol);
          return null;
        }
        let breakoutDir = null;
        if (lastPrice > setup.bbUpper * 1.001) breakoutDir = 'LONG';
        else if (lastPrice < setup.bbLower * 0.999) breakoutDir = 'SHORT';
        if (breakoutDir) {
          // Volume-Spike-Check
          const volMA = vols.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
          const lastVol = vols[vols.length - 1];
          const volSpike = volMA > 0 ? lastVol / volMA : 1.0;
          if (volSpike >= this.CFG.BREAKOUT_VOL_SPIKE_MIN) {
            const trigger = { ts: Date.now(), symbol, direction: breakoutDir, volSpike, lastPrice, bbUpper: setup.bbUpper, bbLower: setup.bbLower };
            this._triggers.push(trigger);
            this._triggers = this._triggers.slice(-20);
            this._stats.breakouts_triggered++;
            this._pendingSetups.delete(symbol);
            try {
              this._db.prepare(`INSERT INTO squeeze_events (ts, symbol, event, bb_upper, bb_lower, bb_width, breakout_direction, vol_spike, details_json) VALUES (?,?,?,?,?,?,?,?,?)`).run(
                Date.now(), symbol, 'BREAKOUT_TRIGGERED', setup.bbUpper, setup.bbLower, setup.bbWidth, breakoutDir, volSpike, JSON.stringify(trigger)
              );
            } catch(_) {}
            try { this._logFn.info && this._logFn.info('SQUEEZE', `BREAKOUT ${symbol} ${breakoutDir} price=${lastPrice.toFixed(4)} volSpike=${volSpike.toFixed(2)}x`); } catch(_) {}
            return { event: 'breakout', ...trigger };
          }
        }
      }
      return null;
    } catch(_) { this._stats.errors++; return null; }
  },

  async scan() {
    if (!this._initialized) return;
    this._stats.scans++;
    const fallback = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','ATOMUSDT'];
    const active = (typeof CoinScanner !== 'undefined' && Array.isArray(CoinScanner.activeCoins)) ? CoinScanner.activeCoins : [];
    const merged = []; const seen = new Set();
    for (const s of [...active, ...fallback]) { if (s && !seen.has(s)) { merged.push(s); seen.add(s); } if (merged.length >= 10) break; }
    for (const sym of merged) {
      try { await this._scanSymbol(sym); } catch(_) {}
    }
  },

  // Public: aktive Breakout-Trigger der letzten 5min (für DemoEngine-Pickup)
  getActiveBreakouts(maxAgeMs = 300000) {
    const now = Date.now();
    return this._triggers.filter(t => (now - t.ts) <= maxAgeMs);
  },

  startCron() {
    if (this._cronTimer) return;
    setTimeout(() => this.scan().catch(()=>{}), 60000);
    this._cronTimer = setInterval(() => this.scan().catch(()=>{}), this.CFG.SCAN_INTERVAL_MS);
    try { this._logFn.info && this._logFn.info('SQUEEZE', `cron started (${this.CFG.SCAN_INTERVAL_MS/1000}s interval)`); } catch(_) {}
  },

  stopCron() { if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; } },

  snapshot() {
    return {
      initialized: this._initialized,
      ...this._stats,
      cfg: this.CFG,
      pendingSetups: Array.from(this._pendingSetups.entries()).map(([s, x]) => ({ symbol: s, ...x, ageMs: Date.now() - x.ts })),
      recentTriggers: this._triggers.slice(-10),
    };
  },
};

module.exports = SqueezeWatcher;
