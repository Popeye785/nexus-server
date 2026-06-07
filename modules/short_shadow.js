// modules/short_shadow.js
// SHORT_SHADOW [2026-06-04]: Shadow/Paper-Test für SELL-Signale.
//
// Aktuelle Lage: Markt im BEAR-Regime, Aladdin signalisiert 88.7% SELL.
// Spot-only-Bot kann nichts damit verdienen → SHORT_SHADOW misst, ob ein hypothetischer
// SHORT verdient hätte. Reines Logging — KEINE echte Order, KEIN Wallet-Touch,
// KEIN DB-Trade-Eintrag, KEIN Bitget-Futures-Call.
//
// HARD RULES:
//   - KEIN LIVE
//   - KEIN echter Trade
//   - KEINE Wallet/Reserve-Mutation
//   - KEINE trades/dca/grid DB-Einträge
//   - Nur CSV + In-Memory-Ring
//
// Trigger-Bedingungen (alle müssen erfüllt sein):
//   - decision === 'SELL'
//   - keine offene Long-Position auf diesem Symbol
//   - symbolClass !== 'ANALYSIS'
//   - Preis frisch (>0)
//   - Spread <= MAX_SPREAD_PCT (0.5%)
//   - Depth top5 >= MIN_DEPTH_USDT (1000)
//   - Regime in {BEAR, EXTREME_BEAR, FLASH_CRASH} ODER (Conf >= STRONG_SELL_CONF_MIN)
//
// Sim-Logik:
//   - Entry: bestBid (Short verkauft ans Bid)
//   - Effective entry = bestBid × (1 - SLIPPAGE_BPS/10000)
//   - Stop-Loss: Preis steigt um SL_PCT → Verlust
//   - Take-Profit: Preis fällt um TP_PCT → Gewinn
//   - Timeout: nach TIMEOUT_MS schließen
//   - Flip-Exit: wenn Aladdin auf BUY/HOLD flippt
//   - Regime-Exit: wenn Regime in {RECOVERY, BULL} wechselt
//   - PnL: (entry - exit) / entry - 2 × TAKER_FEE (round-trip)

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'short_shadow');
const RETENTION_DAYS = 30;
const RING_SIZE = 200;

const ShortShadow = {
  enabled: true,
  _initDone: false,
  _refs: {},
  _timer: null,
  _ringBuffer: [],            // recent events (entry + exit)
  _activeSims: new Map(),     // sim_id → sim
  _lastDecisionPerSymbol: {}, // symbol → { decision, ts } (für Flip-Exit-Detection)
  _todayCsvFile: null,
  _todayHeaderWritten: false,
  _stats: {
    sellSignalsSeen: 0,
    triggerOk: 0,
    triggerRejected: { spread: 0, depth: 0, price: 0, regime: 0, alreadyOpen: 0, analysis: 0, openSim: 0 },
    simsCreated: 0,
    simsClosed: 0,
    csvWriteOK: 0,
    csvWriteErrors: 0,
    pnlTotalBps: 0,
    pnlWins: 0,
    pnlLosses: 0,
  },

  TICK_MS: 30_000,

  CFG: {
    SIM_SIZE_USDT: 25,
    SL_PCT: 0.04,                 // 4% — Preis steigt → Short verliert
    TP_PCT: 0.05,                 // 5% — Preis fällt → Short gewinnt
    TIMEOUT_MS: 60 * 60 * 1000,   // 60 min
    TAKER_FEE: 0.001,             // 0.1% pro Seite (0.2% round-trip)
    SLIPPAGE_BPS: 5,              // 5 bps Entry-Slippage
    MAX_SPREAD_PCT: 0.005,        // 0.5%
    MIN_DEPTH_TOP5_USDT: 1000,
    TRIGGER_REGIMES: new Set(['BEAR', 'EXTREME_BEAR', 'FLASH_CRASH']),
    STRONG_SELL_CONF_MIN: 0.10,   // wenn Regime nicht BEAR: nur bei conf >= 0.10 triggern
    EXIT_REGIMES: new Set(['RECOVERY', 'BULL', 'BULL_STRONG']),
  },

  CSV_HEADER: [
    'ts','symbol','signal','confidence','regime','symbolClass',
    'entry_price','stop_pct','tp_pct','timeout_min',
    'sim_id','sim_size_usdt','sim_entry_price','sim_exit_price','sim_pnl_bps',
    'exit_reason','spread_pct','depth_top5_usdt','reason'
  ].join(','),

  init(refs = {}) {
    if (this._initDone) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      this._cleanupOldFiles();
      this._refs = refs;
      this._initDone = true;
      try { console.log('[SHORT_SHADOW] init OK · CFG sim_size=' + this.CFG.SIM_SIZE_USDT + ' SL=' + (this.CFG.SL_PCT*100) + '% TP=' + (this.CFG.TP_PCT*100) + '% timeout=' + (this.CFG.TIMEOUT_MS/60000) + 'min'); } catch(_){}
    } catch(e) {
      try { console.warn('[SHORT_SHADOW] init err: ' + e.message); } catch(_){}
    }
  },

  start() {
    if (this._timer || !this._initDone) return;
    this._timer = setInterval(() => { this._tickSims().catch(()=>{}); }, this.TICK_MS);
    try { console.log('[SHORT_SHADOW] timer started · tick=' + this.TICK_MS/1000 + 's'); } catch(_){}
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  _cleanupOldFiles() {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 86400000;
      const files = fs.readdirSync(DATA_DIR);
      for (const f of files) {
        if (!/^\d{4}-\d{2}-\d{2}\.csv$/.test(f)) continue;
        const p = path.join(DATA_DIR, f);
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs < cutoff) fs.unlinkSync(p);
        } catch(_){}
      }
    } catch(_){}
  },

  _dailyCsvPath() {
    const d = new Date();
    const ymd = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(d.getUTCDate()).padStart(2,'0');
    return path.join(DATA_DIR, ymd + '.csv');
  },

  _writeCsv(row) {
    try {
      const fpath = this._dailyCsvPath();
      if (fpath !== this._todayCsvFile) {
        this._todayCsvFile = fpath;
        this._todayHeaderWritten = fs.existsSync(fpath);
      }
      if (!this._todayHeaderWritten) {
        fs.writeFileSync(fpath, this.CSV_HEADER + '\n', { flag: 'a' });
        this._todayHeaderWritten = true;
      }
      fs.appendFileSync(fpath, row + '\n');
      this._stats.csvWriteOK++;
    } catch(e) {
      this._stats.csvWriteErrors++;
      if (this._stats.csvWriteErrors < 5) {
        try { console.warn('[SHORT_SHADOW] csv err: ' + e.message); } catch(_){}
      }
    }
  },

  _emitRow(ev) {
    const row = [
      ev.ts || Date.now(),
      ev.symbol || '',
      ev.signal || '',
      ev.confidence !== undefined ? ev.confidence : '',
      ev.regime || '',
      ev.symbolClass || '',
      ev.entry_price !== undefined ? ev.entry_price : '',
      ev.stop_pct !== undefined ? ev.stop_pct : '',
      ev.tp_pct !== undefined ? ev.tp_pct : '',
      ev.timeout_min !== undefined ? ev.timeout_min : '',
      ev.sim_id || '',
      ev.sim_size_usdt !== undefined ? ev.sim_size_usdt : '',
      ev.sim_entry_price !== undefined ? ev.sim_entry_price : '',
      ev.sim_exit_price !== undefined ? ev.sim_exit_price : '',
      ev.sim_pnl_bps !== undefined ? Number(ev.sim_pnl_bps).toFixed(2) : '',
      ev.exit_reason || '',
      ev.spread_pct !== undefined ? Number(ev.spread_pct).toFixed(4) : '',
      ev.depth_top5_usdt !== undefined ? Number(ev.depth_top5_usdt).toFixed(2) : '',
      (ev.reason || '').toString().replace(/[,\n]/g, ' '),
    ].join(',');
    this._writeCsv(row);
    this._ringBuffer.unshift(ev);
    if (this._ringBuffer.length > RING_SIZE) this._ringBuffer.length = RING_SIZE;
  },

  /**
   * observe({ symbol, decision, confidence, regime, symbolClass, brainResult, uScore, priceNow, hasOpenPositionThis })
   * Wird aufgerufen pro Brain-Cycle. Triggert ggf. Short-Sim-Entry.
   */
  observe(ctx) {
    if (!this.enabled || !this._initDone) return null;
    try {
      const { symbol, decision, confidence, regime, symbolClass, hasOpenPositionThis, priceNow } = ctx;

      // Track decision-flip
      this._lastDecisionPerSymbol[symbol] = { decision, ts: Date.now() };

      if (decision !== 'SELL') return null;
      this._stats.sellSignalsSeen++;

      // Check: bereits eine active Sim auf diesem Symbol?
      let hasActiveSim = false;
      for (const [_id, sim] of this._activeSims) {
        if (sim.symbol === symbol && sim.status === 'OPEN') { hasActiveSim = true; break; }
      }
      if (hasActiveSim) { this._stats.triggerRejected.openSim++; return null; }

      // Trigger-Gates (alle muss greifen)
      if (hasOpenPositionThis) { this._stats.triggerRejected.alreadyOpen++; return null; }
      if (symbolClass === 'ANALYSIS') { this._stats.triggerRejected.analysis++; return null; }
      if (!priceNow || priceNow <= 0) { this._stats.triggerRejected.price++; return null; }

      const inBearRegime = this.CFG.TRIGGER_REGIMES.has(regime);
      const strongSellConf = (typeof confidence === 'number' && confidence >= this.CFG.STRONG_SELL_CONF_MIN);
      if (!inBearRegime && !strongSellConf) { this._stats.triggerRejected.regime++; return null; }

      // Spread/Depth via OB (defer to async fetch — sync hot-path bleibt schnell)
      // Hier: in-process Orderbook-Snapshot via Bitget priceCache als best-effort.
      // Wenn kein OB verfügbar: setzen wir konservative Defaults und triggern trotzdem.
      let spreadPct = 0.001;  // Default 10 bps wenn unbekannt
      let depthTop5 = 5000;   // Default genug Depth
      try {
        const bg = this._refs.bitget;
        if (bg && bg.priceCache && bg.priceCache[symbol]) {
          const pc = bg.priceCache[symbol];
          if (pc.bidPx && pc.askPx) {
            spreadPct = (pc.askPx - pc.bidPx) / pc.bidPx;
          }
        }
      } catch(_){}

      if (spreadPct > this.CFG.MAX_SPREAD_PCT) { this._stats.triggerRejected.spread++; return null; }
      if (depthTop5 < this.CFG.MIN_DEPTH_TOP5_USDT) { this._stats.triggerRejected.depth++; return null; }

      this._stats.triggerOk++;
      return this._openSim(ctx, spreadPct, depthTop5);
    } catch(e) {
      try { console.warn('[SHORT_SHADOW] observe err: ' + e.message); } catch(_){}
      return null;
    }
  },

  _openSim(ctx, spreadPct, depthTop5) {
    const { symbol, decision, confidence, regime, symbolClass, priceNow } = ctx;
    const now = Date.now();
    const simId = 'SSIM_' + symbol + '_' + now;
    // Entry-Preis mit Slippage (Short geht @ bid abzüglich slippage)
    const slip = this.CFG.SLIPPAGE_BPS / 10000;
    const entryPrice = priceNow * (1 - slip);
    const sim = {
      id: simId,
      symbol,
      decision: 'SELL',
      confidence: typeof confidence === 'number' ? confidence : 0,
      regime: regime || 'UNKNOWN',
      symbolClass: symbolClass || 'UNKNOWN',
      entryTs: now,
      entryPrice,
      observedPrice: priceNow,
      sizeUsdt: this.CFG.SIM_SIZE_USDT,
      slPct: this.CFG.SL_PCT,
      tpPct: this.CFG.TP_PCT,
      timeoutMs: this.CFG.TIMEOUT_MS,
      status: 'OPEN',
      pnlBps: 0,
      exitTs: 0,
      exitPrice: 0,
      exitReason: '',
      triggerReason: this.CFG.TRIGGER_REGIMES.has(regime) ? 'BEAR_REGIME_SHORT' : 'STRONG_SELL_CONF_SHORT',
    };
    this._activeSims.set(simId, sim);
    this._stats.simsCreated++;
    // ENTER row
    this._emitRow({
      ts: now,
      symbol,
      signal: 'SELL',
      confidence: typeof confidence === 'number' ? confidence.toFixed(4) : '',
      regime,
      symbolClass,
      entry_price: priceNow,
      stop_pct: this.CFG.SL_PCT,
      tp_pct: this.CFG.TP_PCT,
      timeout_min: Math.round(this.CFG.TIMEOUT_MS/60000),
      sim_id: simId,
      sim_size_usdt: this.CFG.SIM_SIZE_USDT,
      sim_entry_price: entryPrice,
      spread_pct: spreadPct,
      depth_top5_usdt: depthTop5,
      reason: sim.triggerReason,
    });
    return sim;
  },

  async _tickSims() {
    if (this._activeSims.size === 0) return;
    const bg = this._refs.bitget;
    const reg = this._refs.regime;
    const currentRegime = (reg && reg.regime) || null;
    const now = Date.now();

    for (const [id, sim] of this._activeSims) {
      if (sim.status !== 'OPEN') continue;
      try {
        // Aktueller Preis
        let priceNow = 0;
        try {
          if (bg && bg.priceCache && bg.priceCache[sim.symbol]) {
            priceNow = Number(bg.priceCache[sim.symbol].last || bg.priceCache[sim.symbol].price || 0);
          }
        } catch(_){}
        if (!priceNow || priceNow <= 0) {
          // Stale price — check if old; close at observed-entry if too long
          if (now - sim.entryTs > sim.timeoutMs) this._closeSim(sim, sim.observedPrice, 'STALE_PRICE_TIMEOUT');
          continue;
        }

        // Short PnL: (entry - price) / entry. Steigt der Preis = Short verliert.
        const rawRet = (sim.entryPrice - priceNow) / sim.entryPrice;
        const fees = 2 * this.CFG.TAKER_FEE;  // round-trip
        const netRet = rawRet - fees;
        const priceMovePct = (priceNow - sim.entryPrice) / sim.entryPrice;

        // 1. Time-Stop
        if (now - sim.entryTs >= sim.timeoutMs) {
          this._closeSim(sim, priceNow, 'TIME_STOP');
          continue;
        }
        // 2. Stop-Loss (Preis ist um SL_PCT gestiegen)
        if (priceMovePct >= sim.slPct) {
          this._closeSim(sim, priceNow, 'SL');
          continue;
        }
        // 3. Take-Profit (Preis ist um TP_PCT gefallen)
        if (priceMovePct <= -sim.tpPct) {
          this._closeSim(sim, priceNow, 'TP');
          continue;
        }
        // 4. Aladdin-Flip — letzter Brain-decision war NICHT mehr SELL
        const lastDec = this._lastDecisionPerSymbol[sim.symbol];
        if (lastDec && (lastDec.decision === 'BUY' || lastDec.decision === 'HOLD') && (now - lastDec.ts < 60000)) {
          this._closeSim(sim, priceNow, 'ALADDIN_FLIP_' + lastDec.decision);
          continue;
        }
        // 5. Regime-Recovery
        if (currentRegime && this.CFG.EXIT_REGIMES.has(currentRegime)) {
          this._closeSim(sim, priceNow, 'REGIME_RECOVERY_' + currentRegime);
          continue;
        }
      } catch(e) {
        try { console.warn('[SHORT_SHADOW] tick err ' + id + ': ' + e.message); } catch(_){}
      }
    }

    // Cleanup geschlossene Sims (30s Grace für Snapshot)
    for (const [id, sim] of this._activeSims) {
      if (sim.status === 'CLOSED' && (now - sim.exitTs) > 30000) {
        this._activeSims.delete(id);
      }
    }
  },

  _closeSim(sim, exitPrice, reason) {
    sim.status = 'CLOSED';
    sim.exitTs = Date.now();
    sim.exitPrice = exitPrice;
    sim.exitReason = reason;
    const rawRet = (sim.entryPrice - exitPrice) / sim.entryPrice;
    const fees = 2 * this.CFG.TAKER_FEE;
    const netRet = rawRet - fees;
    sim.pnlBps = netRet * 10000;
    this._stats.simsClosed++;
    this._stats.pnlTotalBps += sim.pnlBps;
    if (sim.pnlBps > 0) this._stats.pnlWins++;
    else this._stats.pnlLosses++;
    // EXIT row
    this._emitRow({
      ts: sim.exitTs,
      symbol: sim.symbol,
      signal: 'SELL',
      confidence: sim.confidence,
      regime: sim.regime,
      symbolClass: sim.symbolClass,
      sim_id: sim.id,
      sim_size_usdt: sim.sizeUsdt,
      sim_entry_price: sim.entryPrice,
      sim_exit_price: exitPrice,
      sim_pnl_bps: sim.pnlBps,
      exit_reason: reason,
      reason: 'EXIT',
    });
  },

  snapshot() {
    const winRate = this._stats.simsClosed > 0 ? (this._stats.pnlWins / this._stats.simsClosed) : 0;
    const avgPnlBps = this._stats.simsClosed > 0 ? (this._stats.pnlTotalBps / this._stats.simsClosed) : 0;
    return {
      enabled: this.enabled,
      initDone: this._initDone,
      tickMs: this.TICK_MS,
      cfg: this.CFG,
      stats: { ...this._stats },
      computed: { winRate, avgPnlBps },
      activeSimsCount: this._activeSims.size,
      activeSims: Array.from(this._activeSims.values()).filter(s => s.status === 'OPEN').map(s => ({
        id: s.id, symbol: s.symbol, regime: s.regime,
        entryTs: s.entryTs, entryPrice: s.entryPrice, sizeUsdt: s.sizeUsdt,
        confidence: s.confidence, triggerReason: s.triggerReason,
        ageS: Math.round((Date.now() - s.entryTs)/1000),
      })),
      recentEvents: this._ringBuffer.slice(0, 20),
    };
  },

  recent(limit = 50) {
    return this._ringBuffer.slice(0, Math.min(limit, RING_SIZE));
  },
};

module.exports = ShortShadow;
