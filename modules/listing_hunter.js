// modules/listing_hunter.js
// P4 [2026-06-03]: ListingHunter / New-Coin-Sniper — Shadow/PAPER.
//
// Erkennt neue Bitget-Listings via Symbol-Liste-Diff. Aladdin entscheidet final:
// ENTER_LISTING_SPIKE / WAIT / ABORT / EXIT_NOW.
//
// Christian-Direktive:
//   - Reine Shadow/Paper-Phase. Keine echte Order. Keine Wallet-Mutation.
//   - Reserve-Floor 4.2661642227906995 unantastbar.
//   - Hard-Safeties hart: Spread, Depth, BTC-Regime, Reserve, News-Risk, stale-Price.
//   - Demo=Live identisch in Decision/Risk; nur Order-Send würde später unterscheiden.
//   - CSV-only Storage. KEIN DB-Write.
//
// Architektur:
//   poll() alle 60s → /api/v2/spot/public/symbols → diff gegen known_symbols.json
//   tickSimPositions() alle 10s → existing Sim-Positions TP/SL/Timeout-Check
//   on new symbol: build ctx → hard-safety gates → aladdin shadow decision → sim entry/log
//
// Sizing: 25 USDT pro Sim-Trade (paper, kein realer Eingriff).
// TP: gestaffelt 1/3 @ +5%, 1/3 @ +10%, 1/3 @ +20%.
// SL: -5% hard.
// Time-Stop: 10 min.
// Fees: 2× TAKER_FEE (0.001) = 20 bps round-trip.

'use strict';

const fs = require('fs');
const path = require('path');

let _IntentShadow = null;
try { _IntentShadow = require('./aladdin_intent_shadow'); } catch(_){}

const DATA_DIR = path.join(__dirname, '..', 'data', 'listing_hunter');
const KNOWN_SYMBOLS_FILE = path.join(DATA_DIR, 'known_symbols.json');
const RETENTION_DAYS = 30;

// Hard-Safety-Konstanten (Christian-Pflicht)
const RESERVE_FLOOR_USDT = 4.2661642227906995;
const MAX_SPREAD_PCT = 0.01;        // 1.0%
const MIN_DEPTH_TOP5_USDT = 1000;   // Mindest-Liquidität top-5 Bids+Asks
const MIN_VOL_5MIN_USDT = 5000;     // (nicht erzwingbar ohne Trade-WS — best-effort via ticker.usdtVolume)
const FORBIDDEN_BTC_REGIMES = ['BEAR','EXTREME_BEAR','FLASH_CRASH'];
const MAX_NEWS_RISK_SCORE = 70;     // 0–100; >70 = abort

// Sim-Konstanten
const SIM_SIZE_USDT = 25;
const TP_STEPS = [
  { pct: 0.05, fraction: 1/3 },
  { pct: 0.10, fraction: 1/3 },
  { pct: 0.20, fraction: 1/3 },
];
const SL_PCT = -0.05;
const TIME_STOP_MS = 10 * 60 * 1000;  // 10 min
const TAKER_FEE = 0.001;              // 0.1% pro Seite → 0.2% round-trip

const POLL_MS = 60_000;
const SIM_TICK_MS = 10_000;
const RING_SIZE = 200;

// CSV-Header (stabil, neue Felder hinten anhängen)
const HEADER = [
  'ts','event_type','symbol','listing_detect_ts',
  'first_price','current_price','buy_candidate_price',
  'spread_pct','depth_top5_usdt','vol_24h_usdt','price_momentum_pct',
  'btc_regime','news_risk_score','reserve_ok','slots_available',
  'aladdin_decision','decision_reason','router_verdict_shadow',
  'sim_id','sim_size_usdt','sim_entry_price','sim_exit_price','sim_pnl_bps','exit_reason'
].join(',');

const ListingHunter = {
  enabled: true,
  _initDone: false,
  _knownSymbols: new Set(),
  _activeSims: new Map(),  // sim_id → sim object
  _ringBuffer: [],
  _todayFile: null,
  _todayHeaderWritten: false,
  _stats: {
    pollCount: 0,
    newListingsDetected: 0,
    simsCreated: 0,
    simsClosed: 0,
    simsAborted: 0,
    csvWriteOK: 0,
    csvWriteErrors: 0,
    pollErrors: 0,
  },
  _bitget: null,
  _regimeRef: null,
  _newsRiskRef: null,
  _walletRef: null,
  _slotLimitFn: null,
  _slotUsedFn: null,
  _pollTimer: null,
  _simTimer: null,

  /**
   * Initialisierung. Refs zu globalen Singletons werden injiziert um zirkuläre requires zu vermeiden.
   */
  init(refs = {}) {
    if (this._initDone) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      this._loadKnownSymbols();
      this._cleanupOldFiles();
      this._bitget = refs.bitget || null;
      this._regimeRef = refs.regime || null;
      this._newsRiskRef = refs.newsRisk || null;
      this._walletRef = refs.wallet || null;
      this._slotLimitFn = refs.slotLimitFn || null;
      this._slotUsedFn = refs.slotUsedFn || null;
      this._initDone = true;
      try { console.log('[LISTING_HUNTER] init OK · known_symbols=' + this._knownSymbols.size); } catch(_){}
    } catch(e) {
      try { console.warn('[LISTING_HUNTER] init err: ' + e.message); } catch(_){}
    }
  },

  _loadKnownSymbols() {
    try {
      if (fs.existsSync(KNOWN_SYMBOLS_FILE)) {
        const arr = JSON.parse(fs.readFileSync(KNOWN_SYMBOLS_FILE, 'utf8'));
        if (Array.isArray(arr)) this._knownSymbols = new Set(arr);
      }
    } catch(e) {
      try { console.warn('[LISTING_HUNTER] load known err: ' + e.message); } catch(_){}
    }
  },

  _saveKnownSymbols() {
    try {
      const arr = Array.from(this._knownSymbols).sort();
      fs.writeFileSync(KNOWN_SYMBOLS_FILE, JSON.stringify(arr, null, 0));
    } catch(e) {
      try { console.warn('[LISTING_HUNTER] save known err: ' + e.message); } catch(_){}
    }
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

  _dailyFilePath() {
    const d = new Date();
    const ymd = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(d.getUTCDate()).padStart(2,'0');
    return path.join(DATA_DIR, ymd + '.csv');
  },

  _appendCsv(row) {
    try {
      const fpath = this._dailyFilePath();
      if (fpath !== this._todayFile) {
        this._todayFile = fpath;
        this._todayHeaderWritten = fs.existsSync(fpath);
      }
      if (!this._todayHeaderWritten) {
        fs.writeFileSync(fpath, HEADER + '\n', { flag: 'a' });
        this._todayHeaderWritten = true;
      }
      fs.appendFileSync(fpath, row + '\n');
      this._stats.csvWriteOK++;
    } catch(e) {
      this._stats.csvWriteErrors++;
      if (this._stats.csvWriteErrors < 5) {
        try { console.warn('[LISTING_HUNTER] csv err: ' + e.message); } catch(_){}
      }
    }
  },

  _logEvent(ev) {
    if (!this._initDone) return;
    this._ringBuffer.unshift(ev);
    if (this._ringBuffer.length > RING_SIZE) this._ringBuffer.length = RING_SIZE;
    const row = [
      ev.ts || Date.now(),
      ev.event_type || '',
      ev.symbol || '',
      ev.listing_detect_ts || '',
      ev.first_price || '',
      ev.current_price || '',
      ev.buy_candidate_price || '',
      ev.spread_pct || '',
      ev.depth_top5_usdt || '',
      ev.vol_24h_usdt || '',
      ev.price_momentum_pct || '',
      ev.btc_regime || '',
      ev.news_risk_score || '',
      ev.reserve_ok === undefined ? '' : (ev.reserve_ok ? 1 : 0),
      ev.slots_available === undefined ? '' : ev.slots_available,
      ev.aladdin_decision || '',
      (ev.decision_reason || '').toString().replace(/[,\n]/g, ' '),
      ev.router_verdict_shadow || '',
      ev.sim_id || '',
      ev.sim_size_usdt || '',
      ev.sim_entry_price || '',
      ev.sim_exit_price || '',
      ev.sim_pnl_bps === undefined ? '' : Number(ev.sim_pnl_bps).toFixed(2),
      ev.exit_reason || '',
    ].join(',');
    this._appendCsv(row);
  },

  /**
   * Poll Bitget symbol list. Diff against known set. For new symbols, trigger evaluation.
   */
  async pollSymbols() {
    if (!this.enabled || !this._bitget) return;
    this._stats.pollCount++;
    try {
      const r = await this._bitget.publicGet('/api/v2/spot/public/symbols').catch(() => null);
      const data = r && r.data;
      if (!Array.isArray(data)) {
        this._stats.pollErrors++;
        return;
      }
      const firstRun = this._knownSymbols.size === 0;
      const newSymbols = [];
      for (const sym of data) {
        const s = sym.symbol;
        const status = sym.status;
        if (!s || status !== 'online') continue;
        if (!this._knownSymbols.has(s)) {
          this._knownSymbols.add(s);
          if (!firstRun) newSymbols.push({ symbol: s, info: sym });
        }
      }
      this._saveKnownSymbols();
      if (firstRun) {
        try { console.log('[LISTING_HUNTER] first poll baseline ' + this._knownSymbols.size + ' symbols (no detection)'); } catch(_){}
        return;
      }
      for (const ns of newSymbols) {
        this._stats.newListingsDetected++;
        // Log detection event
        this._logEvent({
          ts: Date.now(),
          event_type: 'DETECTED',
          symbol: ns.symbol,
          listing_detect_ts: Date.now(),
        });
        // Defer evaluation by 5s to let WS subscriber catch up
        setTimeout(() => { this.evaluateListing(ns.symbol).catch(()=>{}); }, 5000);
      }
    } catch(e) {
      this._stats.pollErrors++;
      try { console.warn('[LISTING_HUNTER] poll err: ' + e.message); } catch(_){}
    }
  },

  /**
   * Evaluate a single (new) listing. Hard-safety gates → aladdin shadow → optional sim entry.
   */
  async evaluateListing(symbol) {
    if (!this.enabled || !this._bitget) return null;
    const detectTs = Date.now();
    let aladdinDecision = 'WAIT';
    let decisionReason = 'INIT';
    let routerVerdictShadow = 'N/A';

    let ticker = null, ob = null;
    try { ticker = await this._bitget.fetchTicker(symbol).catch(() => null); } catch(_){}
    try { ob = await this._bitget.fetchOrderbook(symbol).catch(() => null); } catch(_){}

    const firstPrice = (ticker && Number(ticker.first || ticker.open || ticker.last)) || 0;
    const currentPrice = (ticker && Number(ticker.last || ticker.price)) || 0;
    const vol24h = (ticker && Number(ticker.usdtVolume || ticker.quoteVolume || 0)) || 0;
    const momentumPct = (firstPrice > 0) ? ((currentPrice - firstPrice) / firstPrice) : 0;

    let spreadPct = 1, depthTop5 = 0;
    try {
      if (ob && ob.bids && ob.asks && ob.bids.length && ob.asks.length) {
        const bestBid = parseFloat(ob.bids[0][0]);
        const bestAsk = parseFloat(ob.asks[0][0]);
        spreadPct = (bestBid > 0) ? ((bestAsk - bestBid) / bestBid) : 1;
        const askSum = ob.asks.slice(0,5).reduce((s, l) => s + parseFloat(l[0]) * parseFloat(l[1]), 0);
        const bidSum = ob.bids.slice(0,5).reduce((s, l) => s + parseFloat(l[0]) * parseFloat(l[1]), 0);
        depthTop5 = Math.min(askSum, bidSum);
      }
    } catch(_){}

    const btcRegime = (this._regimeRef && this._regimeRef.regime) || 'UNKNOWN';
    let newsRiskScore = 0;
    try {
      if (this._newsRiskRef && this._newsRiskRef.cache) {
        newsRiskScore = Number(this._newsRiskRef.cache.riskScore || 0);
      }
    } catch(_){}
    const reserve = (this._walletRef && Number(this._walletRef.reserve)) || 0;
    const reserveOk = reserve > RESERVE_FLOOR_USDT;
    const slotsAvailable = (this._slotLimitFn && this._slotUsedFn)
      ? Math.max(0, this._slotLimitFn() - this._slotUsedFn())
      : null;

    // ── HARD-SAFETIES (jede einzelne führt zu ABORT) ──
    if (!currentPrice || currentPrice <= 0) {
      aladdinDecision = 'ABORT';
      decisionReason = 'NO_PRICE';
    } else if (spreadPct > MAX_SPREAD_PCT) {
      aladdinDecision = 'ABORT';
      decisionReason = 'SPREAD_TOO_WIDE_' + (spreadPct*100).toFixed(2) + '%';
    } else if (depthTop5 < MIN_DEPTH_TOP5_USDT) {
      aladdinDecision = 'ABORT';
      decisionReason = 'DEPTH_TOO_THIN_' + depthTop5.toFixed(0) + 'USDT';
    } else if (FORBIDDEN_BTC_REGIMES.includes(btcRegime)) {
      aladdinDecision = 'ABORT';
      decisionReason = 'BTC_REGIME_' + btcRegime;
    } else if (newsRiskScore > MAX_NEWS_RISK_SCORE) {
      aladdinDecision = 'ABORT';
      decisionReason = 'NEWS_RISK_' + newsRiskScore;
    } else if (!reserveOk) {
      aladdinDecision = 'ABORT';
      decisionReason = 'RESERVE_FLOOR_' + reserve.toFixed(2);
    } else if (slotsAvailable !== null && slotsAvailable <= 0) {
      aladdinDecision = 'WAIT';
      decisionReason = 'NO_SLOTS';
    } else if (vol24h > 0 && vol24h < MIN_VOL_5MIN_USDT) {
      aladdinDecision = 'WAIT';
      decisionReason = 'VOL_TOO_LOW_' + vol24h.toFixed(0);
    } else if (momentumPct < 0) {
      aladdinDecision = 'WAIT';
      decisionReason = 'NEG_MOMENTUM_' + (momentumPct*100).toFixed(2) + '%';
    } else {
      // Alle Hard-Safeties OK → Aladdin-Shadow-Intent abfragen
      let intent = null;
      if (_IntentShadow && typeof _IntentShadow.deriveIntent === 'function') {
        try {
          intent = _IntentShadow.deriveIntent({
            symbol,
            brainResult: { decision: 'BUY', confidence: Math.min(0.15, Math.max(0.05, momentumPct * 2)) },
            uScore: { direction: 'BUY', confidence: Math.min(0.15, momentumPct * 2) },
            regime: btcRegime,
            regimeConfidence: 0.5,
            hasOpenPositionThis: false,
            slotsAvailable: slotsAvailable || 5,
            priceNow: currentPrice,
            actualAction: 'listing_hunter_shadow',
          });
          routerVerdictShadow = intent.routerVerdictShadow || 'N/A';
        } catch(e) {
          routerVerdictShadow = 'ERR';
        }
      }
      // Bei NEUEN Listings: symbolClass ist UNKNOWN (nicht in symbol_universe).
      // Dann ist intent=NONE/NEUTRAL_UNKNOWN erwartet und KEIN Block-Grund.
      // Hard-Safeties oben sind die echten Gates. Router-Verdict bleibt nur Info.
      const symbolClass = (intent && intent.symbolClass) || 'UNKNOWN';
      if (symbolClass !== 'UNKNOWN' && symbolClass === 'ANALYSIS') {
        aladdinDecision = 'WAIT';
        decisionReason = 'INTENT_ANALYSIS_FORBIDDEN';
      } else if (symbolClass !== 'UNKNOWN' && intent && intent.botTypeIntent === 'NONE') {
        // Symbol IST im Universe → intent=NONE = echte Brain-Entscheidung
        aladdinDecision = 'WAIT';
        decisionReason = 'INTENT_NONE_' + (intent.intentReason || '?');
      } else if (symbolClass !== 'UNKNOWN' && routerVerdictShadow === 'BLOCK') {
        // Symbol IST im Universe → Router-Block ist echter Block
        aladdinDecision = 'WAIT';
        decisionReason = 'ROUTER_BLOCK_' + (intent?.routerReasonShadow || '?');
      } else {
        // UNKNOWN-Class (echtes neues Listing) ODER alle Universe-Gates OK
        aladdinDecision = 'ENTER_LISTING_SPIKE';
        decisionReason = 'OK_MOMENTUM_' + (momentumPct*100).toFixed(2) + '%_class_' + symbolClass;
      }
    }

    // Log EVAL
    const buyCandidatePrice = currentPrice;
    this._logEvent({
      ts: Date.now(),
      event_type: 'EVAL',
      symbol,
      listing_detect_ts: detectTs,
      first_price: firstPrice,
      current_price: currentPrice,
      buy_candidate_price: buyCandidatePrice,
      spread_pct: (spreadPct*100).toFixed(4),
      depth_top5_usdt: depthTop5.toFixed(2),
      vol_24h_usdt: vol24h.toFixed(2),
      price_momentum_pct: (momentumPct*100).toFixed(2),
      btc_regime: btcRegime,
      news_risk_score: newsRiskScore.toFixed(0),
      reserve_ok: reserveOk,
      slots_available: slotsAvailable !== null ? slotsAvailable : '',
      aladdin_decision: aladdinDecision,
      decision_reason: decisionReason,
      router_verdict_shadow: routerVerdictShadow,
    });

    if (aladdinDecision === 'ENTER_LISTING_SPIKE') {
      this._createSimEntry(symbol, buyCandidatePrice);
    } else if (aladdinDecision === 'ABORT') {
      this._stats.simsAborted++;
    }
    return { aladdinDecision, decisionReason, routerVerdictShadow };
  },

  _createSimEntry(symbol, entryPrice) {
    const simId = 'LSIM_' + symbol + '_' + Date.now();
    const sim = {
      id: simId,
      symbol,
      entryTs: Date.now(),
      entryPrice,
      sizeUsdt: SIM_SIZE_USDT,
      tpSteps: TP_STEPS.map(t => ({ ...t, hit: false })),
      slPct: SL_PCT,
      timeoutMs: TIME_STOP_MS,
      status: 'OPEN',
      realizedPnlUsdt: 0,
      remainingFraction: 1.0,
      exitReason: '',
      exitTs: 0,
      exitPrice: 0,
    };
    this._activeSims.set(simId, sim);
    this._stats.simsCreated++;
    this._logEvent({
      ts: Date.now(),
      event_type: 'ENTER_SIM',
      symbol,
      sim_id: simId,
      sim_size_usdt: SIM_SIZE_USDT,
      sim_entry_price: entryPrice,
      aladdin_decision: 'ENTER_LISTING_SPIKE',
    });
  },

  /**
   * Tick all active sim positions: check TP/SL/Timeout.
   */
  async tickSimPositions() {
    if (!this.enabled || this._activeSims.size === 0) return;
    for (const [simId, sim] of this._activeSims) {
      try {
        if (sim.status !== 'OPEN') continue;
        let ticker = null;
        try { ticker = await this._bitget.fetchTicker(sim.symbol).catch(() => null); } catch(_){}
        const price = (ticker && Number(ticker.last || ticker.price)) || 0;
        if (!price) continue;
        const retPct = (price - sim.entryPrice) / sim.entryPrice;
        let triggered = false;

        // Time-stop
        if (Date.now() - sim.entryTs >= sim.timeoutMs) {
          this._closeSim(sim, price, 'TIME_STOP');
          triggered = true;
        }
        // SL
        else if (retPct <= sim.slPct) {
          this._closeSim(sim, price, 'SL');
          triggered = true;
        }
        // TP-Staircase
        else {
          for (const step of sim.tpSteps) {
            if (!step.hit && retPct >= step.pct) {
              step.hit = true;
              // partielle Realisierung
              const pnlBpsStep = ((retPct - 0) - (2 * TAKER_FEE)) * 10000;
              const pnlUsdtStep = sim.sizeUsdt * step.fraction * (retPct - 2 * TAKER_FEE);
              sim.realizedPnlUsdt += pnlUsdtStep;
              sim.remainingFraction -= step.fraction;
              this._logEvent({
                ts: Date.now(),
                event_type: 'TP_HIT_' + (step.pct*100).toFixed(0),
                symbol: sim.symbol,
                sim_id: sim.id,
                sim_entry_price: sim.entryPrice,
                sim_exit_price: price,
                sim_pnl_bps: pnlBpsStep,
                exit_reason: 'TP_' + (step.pct*100).toFixed(0),
              });
            }
          }
          // letzter Step erreicht?
          if (sim.remainingFraction <= 0.001) {
            sim.status = 'CLOSED';
            sim.exitReason = 'TP_COMPLETE';
            sim.exitTs = Date.now();
            sim.exitPrice = price;
            this._stats.simsClosed++;
            this._logEvent({
              ts: Date.now(),
              event_type: 'EXIT_SIM',
              symbol: sim.symbol,
              sim_id: sim.id,
              sim_entry_price: sim.entryPrice,
              sim_exit_price: price,
              sim_pnl_bps: (sim.realizedPnlUsdt / sim.sizeUsdt * 10000).toFixed(2),
              exit_reason: 'TP_COMPLETE',
            });
            triggered = true;
          }
        }
      } catch(e) {
        try { console.warn('[LISTING_HUNTER] sim tick err ' + simId + ': ' + e.message); } catch(_){}
      }
    }
    // Cleanup closed sims (behalte 1 Cycle für Snapshot, dann remove)
    for (const [simId, sim] of this._activeSims) {
      if (sim.status === 'CLOSED' && (Date.now() - sim.exitTs) > 30000) {
        this._activeSims.delete(simId);
      }
    }
  },

  _closeSim(sim, exitPrice, reason) {
    sim.status = 'CLOSED';
    sim.exitTs = Date.now();
    sim.exitPrice = exitPrice;
    sim.exitReason = reason;
    const retPct = (exitPrice - sim.entryPrice) / sim.entryPrice;
    // verbleibende Fraktion zum aktuellen Preis schließen
    const closedPnl = sim.sizeUsdt * sim.remainingFraction * (retPct - 2 * TAKER_FEE);
    sim.realizedPnlUsdt += closedPnl;
    sim.remainingFraction = 0;
    this._stats.simsClosed++;
    this._logEvent({
      ts: Date.now(),
      event_type: 'EXIT_SIM',
      symbol: sim.symbol,
      sim_id: sim.id,
      sim_entry_price: sim.entryPrice,
      sim_exit_price: exitPrice,
      sim_pnl_bps: (sim.realizedPnlUsdt / sim.sizeUsdt * 10000).toFixed(2),
      exit_reason: reason,
    });
  },

  /**
   * Start polling timers. Called once after init.
   */
  start() {
    if (!this._initDone) return;
    if (this._pollTimer || this._simTimer) return;
    // Kein direkter Start des Poll-Timers — erster Aufruf ist sofort, dann interval
    this.pollSymbols().catch(()=>{});
    this._pollTimer = setInterval(() => { this.pollSymbols().catch(()=>{}); }, POLL_MS);
    this._simTimer = setInterval(() => { this.tickSimPositions().catch(()=>{}); }, SIM_TICK_MS);
    try { console.log('[LISTING_HUNTER] timers started · poll=' + POLL_MS/1000 + 's · sim_tick=' + SIM_TICK_MS/1000 + 's'); } catch(_){}
  },

  stop() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._simTimer) { clearInterval(this._simTimer); this._simTimer = null; }
  },

  snapshot() {
    return {
      enabled: this.enabled,
      initDone: this._initDone,
      knownSymbolsCount: this._knownSymbols.size,
      activeSimsCount: this._activeSims.size,
      stats: { ...this._stats },
      activeSims: Array.from(this._activeSims.values()).map(s => ({
        id: s.id, symbol: s.symbol, entryTs: s.entryTs, entryPrice: s.entryPrice,
        sizeUsdt: s.sizeUsdt, realizedPnlUsdt: s.realizedPnlUsdt,
        remainingFraction: s.remainingFraction, status: s.status,
      })),
      recentEvents: this._ringBuffer.slice(0, 20),
    };
  },

  recent(limit = 50) {
    return this._ringBuffer.slice(0, Math.min(limit, RING_SIZE));
  },
};

module.exports = ListingHunter;
