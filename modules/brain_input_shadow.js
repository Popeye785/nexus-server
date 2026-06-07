// modules/brain_input_shadow.js — Brain-Input-Shadow-Layer (KEIN Brain-Voting-Eingriff)
// Verankert 2026-05-20 als Teil von VARIANTE_A.
//
// PRINZIP:
// - Sammelt periodisch (60s) Daten aus existierenden API-Endpoints
// - Schreibt sie in Tabelle brain_input_log mit Family-Tag (TR/MO/RI/SE/MI)
// - NICHT ins AladdinBrain-Voting eingespeist — reiner Mess-Layer
// - Christian sieht in 24-48h welche Inputs konsistent fließen
// - Spätere Pipeline kann gezielt einzelne Inputs ins Brain promovieren

'use strict';

const http = require('http');

const ShadowLayer = {
  enabled: true,
  intervalMs: 60 * 1000,        // alle 60s
  bootDelay: 90 * 1000,         // 90s nach Boot starten
  timer: null,
  _db: null,
  _logFn: null,
  port: 3000,

  // Welche Endpoints werden gesammelt — pro Endpoint: family + key + Transform
  // Family: TR=Trend, MO=Momentum, RI=Risk, SE=Sentiment, MI=Microstructure, META
  sources: [
    // Pro Symbol-Iteration:
    { path: '/api/cvd/{SYM}', source: 'cvd', family: 'MO', perSymbol: true,
      extract: (j) => ({ direction: j.signal || 'NEUTRAL', score: j.strength || 0, confidence: j.strength ? Math.min(1, Math.abs(j.strength)) : 0 }) },
    { path: '/api/var?symbol={SYM}', source: 'var', family: 'RI', perSymbol: true,
      // FIX 11 [26.05.2026]: direction-Mapping basierend auf varPct-Schwellen (Lopez de Prado consistent).
      // Vorher: hardcoded 'NEUTRAL' → 100% NEUTRAL votes in 12h-Window. VaR ist asymmetric (Tail-Risk),
      // hoher VaR → SELL bias (Risk-off), niedriger VaR → BUY bias (Continuation in low-vol regime).
      // Schwellen consistent mit UnifiedScore.compute Z.11989-90 (existierender Code).
      extract: (j) => {
        const vp = j.varPct || 0;
        let direction = 'NEUTRAL';
        let strength = 0;
        if (vp >= 0.15) { direction = 'SELL'; strength = 0.85; }       // Extreme Tail-Risk
        else if (vp >= 0.08) { direction = 'SELL'; strength = 0.55; }   // Moderate Risk
        else if (vp >= 0.04) { direction = 'SELL'; strength = 0.35; }   // Weak Risk-off
        else if (vp <= 0.015) { direction = 'BUY'; strength = 0.30; }   // Very low vol = continuation bias
        return { direction, score: strength, confidence: j.confidence || 0 };
      } },
    { path: '/api/funding/{SYM}', source: 'funding_api', family: 'RI', perSymbol: true,
      extract: (j) => ({ direction: j.signal && j.signal.direction || 'NEUTRAL', score: j.signal && j.signal.strength || 0, confidence: 0.7 }) },
    // Global (einmalig pro tick):
    { path: '/api/anomaly', source: 'anomaly_global', family: 'MI', perSymbol: false,
      // FIX 12 [26.05.2026]: Anomalies (pump/dump, wash-trade, flash-crash) sind Risk-Events.
      // Vorher hardcoded NEUTRAL → 100% NEUTRAL. Event-driven Source: aktiv wenn alerts vorhanden.
      // Quelle-Konsistenz: Anomaly-Detection-Pattern (Statistical Process Control + Z-Score-Spikes) → Risk-off.
      extract: (j) => {
        const alerts = j.alerts || [];
        const n = alerts.length;
        let direction = 'NEUTRAL';
        let score = 0;
        if (n >= 3)      { direction = 'SELL'; score = 0.85; }
        else if (n >= 1) { direction = 'SELL'; score = 0.45; }
        return { direction, score, confidence: 0.6 };
      } },
    { path: '/api/rl', source: 'rl_agent', family: 'MO', perSymbol: false,
      // FIX 16 [26.05.2026]: RL-WinRate → direction. recentWinRate > 0.55 = profitable → BUY bias.
      // < 0.45 = nicht profitable → SELL bias (RL findet Verluste). Episodes-Count → confidence.
      // Solange episodes=0 (kein Training noch): NEUTRAL, conf=0 (Source latent).
      extract: (j) => {
        const wr  = parseFloat(j.recentWinRate || 0);
        const eps = parseFloat(j.episodes || 0);
        if (eps < 10) return { direction:'NEUTRAL', score:0, confidence:0 };
        const conf = Math.min(0.7, eps / 100);
        if (wr >= 0.60) return { direction:'BUY',  score:Math.min(0.8, wr), confidence:conf };
        if (wr >= 0.55) return { direction:'BUY',  score:0.4,  confidence:conf };
        if (wr <= 0.40) return { direction:'SELL', score:Math.min(0.8, 1-wr), confidence:conf };
        if (wr <= 0.45) return { direction:'SELL', score:0.4,  confidence:conf };
        return { direction:'NEUTRAL', score:wr, confidence:conf };
      } },
    { path: '/api/feargreed', source: 'feargreed', family: 'SE', perSymbol: false,
      // FIX 17 [26.05.2026]: Bug-13 Fix — Contrarian-Logik (FG ist mean-reversion-Indikator).
      // Vorher: Pro-Cycle (FG>55=BUY, FG<45=SELL) — falsch. Fear=Buy-Zone (Contrarian), Greed=Sell-Zone.
      // Quelle: alternative.me Doku "Extreme Fear = good buying opportunity" + Lopez de Prado MetaLabeling.
      // Schwellen: FG<25 STRONG BUY, FG<45 WEAK BUY, FG>75 STRONG SELL, FG>55 WEAK SELL.
      extract: (j) => {
        const v = j.value || 50;
        if (v <= 25) return { direction:'BUY',  score:0.80, confidence:0.7 };
        if (v <= 45) return { direction:'BUY',  score:0.45, confidence:0.6 };
        if (v >= 75) return { direction:'SELL', score:0.80, confidence:0.7 };
        if (v >= 55) return { direction:'SELL', score:0.45, confidence:0.6 };
        return { direction:'NEUTRAL', score:0, confidence:0.5 };
      } },
    { path: '/api/aladdin/heatmap', source: 'heatmap', family: 'MI', perSymbol: false,
      // FIX 13 [26.05.2026]: heatmap-Score aggregat → SELL bei systemic overheating.
      // Live-Verify: 3 warm coins NEAR/UNI/SEI heat 45-60 avg 51.7 (mild warm).
      // Quelle-Konsistenz: market overheating = mean-reversion-Setup (Lopez de Prado MetaLabeling).
      extract: (j) => {
        const coins = j.coins || [];
        if (coins.length === 0) return { direction:'NEUTRAL', score:0, confidence:0.4 };
        const scores = coins.map(c => c.heatScore || 0).filter(s => s > 0);
        if (scores.length === 0) return { direction:'NEUTRAL', score:0, confidence:0.4 };
        const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
        const max = Math.max(...scores);
        if (max >= 80 || avg >= 65) return { direction:'SELL', score:0.65, confidence:0.55 };
        if (max >= 65 || avg >= 55) return { direction:'SELL', score:0.40, confidence:0.45 };
        if (avg < 30)               return { direction:'BUY',  score:0.30, confidence:0.40 };
        return { direction:'NEUTRAL', score:Math.min(1, avg/100), confidence:0.4 };
      } },
    { path: '/api/aladdin/sentiment', source: 'aladdin_sent', family: 'SE', perSymbol: false,
      extract: (j) => ({ direction: j.signal || 'NEUTRAL', score: j.score || 0, confidence: 0.6 }) },
    { path: '/api/correlation/matrix', source: 'correlation', family: 'MI', perSymbol: false,
      // FIX 14 [26.05.2026]: market cohesion via avg off-diagonal correlation.
      // Hohe Korrelation = systemic risk (alles bewegt sich gleich) = Risk-off → SELL.
      // Niedrige Korrelation = Diversifikations-Health → mild BUY bias.
      // Live: BTC-XRP 0.86, BTC-SOL 0.85, BTC-ETH 0.88 → avg high (stressed correlation).
      extract: (j) => {
        const matrix = j.matrix || {};
        const symbols = Object.keys(matrix);
        if (symbols.length < 2) return { direction:'NEUTRAL', score:0, confidence:0.3 };
        const offDiag = [];
        for (const a of symbols) {
          for (const b of symbols) {
            if (a !== b && matrix[a] && typeof matrix[a][b] === 'number') {
              offDiag.push(Math.abs(matrix[a][b]));
            }
          }
        }
        if (offDiag.length === 0) return { direction:'NEUTRAL', score:0, confidence:0.3 };
        const avg = offDiag.reduce((a,b)=>a+b,0) / offDiag.length;
        if (avg >= 0.80) return { direction:'SELL', score:0.55, confidence:0.55 };
        if (avg >= 0.65) return { direction:'SELL', score:0.30, confidence:0.45 };
        if (avg <= 0.30) return { direction:'BUY',  score:0.25, confidence:0.40 };
        return { direction:'NEUTRAL', score:avg, confidence:0.3 };
      } },
    { path: '/api/regime/snapshot', source: 'regime_snap', family: 'TR', perSymbol: false,
      // FIX 15 [26.05.2026]: regime → direction direct mapping (existierende Logik in UnifiedScore Z.11793).
      // BULL/STRONG_BULL → BUY, BEAR/STRONG_BEAR → SELL, NEUTRAL/RANGING/SQUEEZE → NEUTRAL.
      // Strength via confidence + Regime-Multiplier (existierender Hysterese-Mult-Wert).
      extract: (j) => {
        const cur = j.current || {};
        const reg = cur.regime || 'NEUTRAL';
        const conf = cur.confidence || 0.5;
        const mult = ((j.hysterese && j.hysterese.multipliers) || {})[reg] || 1;
        if (reg === 'STRONG_BULL')  return { direction:'BUY',  score:Math.min(0.85, conf*1.0), confidence:conf };
        if (reg === 'BULL')         return { direction:'BUY',  score:Math.min(0.70, conf*0.85), confidence:conf };
        if (reg === 'WEAK_BULL')    return { direction:'BUY',  score:Math.min(0.50, conf*0.65), confidence:conf };
        if (reg === 'STRONG_BEAR')  return { direction:'SELL', score:Math.min(0.85, conf*1.0), confidence:conf };
        if (reg === 'BEAR')         return { direction:'SELL', score:Math.min(0.70, conf*0.85), confidence:conf };
        if (reg === 'WEAK_BEAR')    return { direction:'SELL', score:Math.min(0.50, conf*0.65), confidence:conf };
        return { direction:'NEUTRAL', score:0, confidence:conf };
      } },
  ],

  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],  // konservativ Top-3 nur

  init({ db, log, port }) {
    this._db = db;
    this._logFn = log || ((lvl, mod, msg) => { try { console.log(`[${lvl}][${mod}]`, msg); } catch(_) {} });
    if (port) this.port = port;
  },

  start() {
    if (this.timer) return;
    setTimeout(() => {
      this.tick().catch(() => {});
      this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
    }, this.bootDelay);
    this._logFn('boot', 'BRAIN_SHADOW', `started (interval=${this.intervalMs/1000}s, bootDelay=${this.bootDelay/1000}s, ${this.sources.length} sources, ${this.symbols.length} symbols)`);
  },

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  _httpGet(path) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: 'localhost', port: this.port, path, timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  },

  async _collectOne(src, symbol) {
    const t0 = Date.now();
    const path = src.perSymbol ? src.path.replace('{SYM}', symbol) : src.path;
    try {
      const json = await this._httpGet(path);
      const xtr = src.extract(json) || {};
      const elapsed = Date.now() - t0;
      this._db.prepare(`INSERT INTO brain_input_log (ts, source, symbol, family, direction, score, confidence, raw_value, collected_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        Date.now(), src.source,
        src.perSymbol ? symbol : 'GLOBAL',
        src.family,
        xtr.direction || 'NEUTRAL',
        Number.isFinite(xtr.score) ? xtr.score : 0,
        Number.isFinite(xtr.confidence) ? xtr.confidence : 0,
        JSON.stringify(xtr.raw || json).slice(0, 500),
        elapsed
      );
      return true;
    } catch(e) {
      return false;
    }
  },

  async tick() {
    if (!this.enabled) return;
    let collected = 0, failed = 0;
    for (const src of this.sources) {
      if (src.perSymbol) {
        for (const sym of this.symbols) {
          const ok = await this._collectOne(src, sym);
          if (ok) collected++; else failed++;
        }
      } else {
        const ok = await this._collectOne(src);
        if (ok) collected++; else failed++;
      }
    }
    // Cleanup alte Einträge (>7 Tage) — rate-limited
    try {
      if (!this._lastCleanup || Date.now() - this._lastCleanup > 3600 * 1000) {
        this._lastCleanup = Date.now();
        this._db.prepare(`DELETE FROM brain_input_log WHERE ts < ?`).run(Date.now() - 7 * 24 * 3600 * 1000);
      }
    } catch(_) {}
  },

  snapshot() {
    let totals = { rows: 0, last24h: 0, perSource: [] };
    try {
      totals.rows = this._db.prepare(`SELECT COUNT(*) AS n FROM brain_input_log`).get().n || 0;
      totals.last24h = this._db.prepare(`SELECT COUNT(*) AS n FROM brain_input_log WHERE ts > ?`).get(Date.now() - 24*3600*1000).n || 0;
      totals.perSource = this._db.prepare(`SELECT source, family, COUNT(*) AS n, AVG(score) AS avg_score, AVG(confidence) AS avg_conf, MAX(ts) AS last_ts
        FROM brain_input_log WHERE ts > ? GROUP BY source, family ORDER BY n DESC`).all(Date.now() - 24*3600*1000);
    } catch(_) {}
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      sources: this.sources.length,
      symbols: this.symbols.length,
      totals,
    };
  },
};

module.exports = ShadowLayer;
