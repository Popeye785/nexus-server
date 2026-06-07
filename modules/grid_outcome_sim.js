// modules/grid_outcome_sim.js
// GRID_OUTCOME_SIM [2026-06-04]: Echte Grid-Mechanik-Simulation für P3-CONDITIONAL_ALLOW-Cases.
//
// Zweck: P3 erlaubt häufig GRID/INFGRID via CONDITIONAL_ALLOW (z.B. NEAR-CHOPPY).
// Aber wir wissen ohne Sim NICHT, ob diese Vorschläge wirklich Gewinn gebracht hätten.
//
// Christian-Pflicht: Grid darf NICHT mit einfacher Preisdrift bewertet werden.
// Grid verdient aus Range-Oszillation → Level-Fills tracken.
//
// HARD RULES:
//   - KEIN echter Trade, KEIN Wallet-Touch, KEINE DB-Trade-Einträge
//   - Nur CSV + In-Memory-Ring
//   - Rest-Inventar am Fenster-Ende mark-to-market (= offene Bags zählen)
//   - Echte aktuelle Bot-Parameter wenn vorhanden, sonst Defaults markiert
//
// Mechanik (Grid):
//   - Range = mid_price ± atrMult × ATR(14)
//   - Levels n (default 10), gleichmäßig verteilt
//   - per_level_usdt = capital_pool / n
//   - Bei Cross-Down eines Levels: BUY-Fill (Inventory += per_level_usdt/level_price)
//   - Bei Cross-Up eines Levels MIT Inventar auf höherem Level: SELL-Fill (Realized += spread × qty − Fees)
//   - Fees: TAKER_FEE × size pro Fill
//   - Bei Range-Break: Status=BROKEN, kein neuer Fill, Sim closed, Rest-Inventar mark-to-market

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'grid_outcome_sim');
const RETENTION_DAYS = 30;
const RING_SIZE = 200;

const GridOutcomeSim = {
  enabled: true,
  _initDone: false,
  _refs: {},
  _timer: null,
  _ringBuffer: [],
  _activeSims: new Map(),  // sim_id → sim
  _todayCsvFile: null,
  _todayHeaderWritten: false,
  _stats: {
    triggerSeen: 0,
    triggerRejected: { intent: 0, verdict: 0, riskFlag: 0, price: 0, alreadyOpen: 0 },
    simsCreated: 0,
    simsClosed: 0,
    totalFills: 0,
    totalRealizedPnl: 0,
    totalRealizedFees: 0,
    csvWriteOK: 0,
    csvWriteErrors: 0,
  },

  TICK_MS: 30_000,

  CFG: {
    SIM_CAPITAL_POOL_USDT: 50,    // total budget pro Grid-Sim
    NUM_LEVELS_DEFAULT: 10,
    ATR_MULT_DEFAULT: 2,           // Range = mid ± 2 × ATR(14)
    TIMEOUT_MS: 4 * 60 * 60 * 1000, // 4h Grid-Window
    TAKER_FEE: 0.001,              // 0.1% pro Fill
    EXIT_REGIMES: new Set(['EXTREME_BEAR', 'FLASH_CRASH']),  // BEAR allein kein Exit
    MAX_INVENTORY_VALUE_RATIO: 1.2, // Wenn unrealized < -PNL-Target → stop
    PNL_TARGET_PCT: 0.10,          // +10% des Capital-Pools = winning
  },

  CSV_HEADER: [
    'ts','sim_id','symbol','bot_type','regime','symbolClass','param_source',
    'entry_price','range_low','range_high','levels','spacing_pct','per_level_usdt',
    'fill_count','buy_fills','sell_fills','realized_pnl_usdt','unrealized_pnl_usdt','total_pnl_usdt',
    'inventory_qty','inventory_value_usdt','fees_usdt','status','exit_reason'
  ].join(','),

  init(refs = {}) {
    if (this._initDone) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      this._cleanupOldFiles();
      this._refs = refs;
      this._initDone = true;
      try { console.log('[GRID_SIM] init OK · CFG capital=' + this.CFG.SIM_CAPITAL_POOL_USDT + ' levels=' + this.CFG.NUM_LEVELS_DEFAULT + ' atrMult=' + this.CFG.ATR_MULT_DEFAULT + ' timeout=' + (this.CFG.TIMEOUT_MS/3600000) + 'h'); } catch(_){}
    } catch(e) {
      try { console.warn('[GRID_SIM] init err: ' + e.message); } catch(_){}
    }
  },

  start() {
    if (this._timer || !this._initDone) return;
    this._timer = setInterval(() => { this._tickSims().catch(()=>{}); }, this.TICK_MS);
    try { console.log('[GRID_SIM] timer started · tick=' + this.TICK_MS/1000 + 's'); } catch(_){}
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
        try { console.warn('[GRID_SIM] csv err: ' + e.message); } catch(_){}
      }
    }
  },

  _emitRow(sim, status, exitReason) {
    const row = [
      Date.now(),
      sim.id,
      sim.symbol,
      sim.botType,
      sim.regime,
      sim.symbolClass,
      sim.paramSource,
      sim.entryPrice,
      sim.rangeLow.toFixed(8),
      sim.rangeHigh.toFixed(8),
      sim.numLevels,
      (sim.spacingPct*100).toFixed(4),
      sim.perLevelUsdt.toFixed(4),
      sim.fillCount,
      sim.buyFills,
      sim.sellFills,
      sim.realizedPnl.toFixed(4),
      sim.unrealizedPnl.toFixed(4),
      (sim.realizedPnl + sim.unrealizedPnl).toFixed(4),
      sim.inventoryQty.toFixed(8),
      sim.inventoryValueUsdt.toFixed(4),
      sim.feesUsdt.toFixed(4),
      status,
      exitReason || '',
    ].join(',');
    this._writeCsv(row);
    this._ringBuffer.unshift({
      ts: Date.now(),
      sim_id: sim.id, symbol: sim.symbol, bot_type: sim.botType,
      status, exit_reason: exitReason,
      fillCount: sim.fillCount, realizedPnl: sim.realizedPnl, totalPnl: sim.realizedPnl + sim.unrealizedPnl,
      inventoryQty: sim.inventoryQty,
    });
    if (this._ringBuffer.length > RING_SIZE) this._ringBuffer.length = RING_SIZE;
  },

  /**
   * observe(intent) — wird nach IntentShadow.observe aufgerufen.
   * Triggert ggf. neue Grid-Sim wenn p3 (CONDITIONAL_)ALLOW für GRID/INFGRID + price fresh.
   *
   * intent: das vollständige IntentShadow.observe()-Ergebnis
   * candles: optional, für ATR-Berechnung (sonst Default 2% spacing)
   */
  observe(intent, candles) {
    if (!this.enabled || !this._initDone || !intent) return null;
    try {
      const bt = intent.botTypeIntent;
      const p3v = intent.p3RouterVerdictShadow;
      if (bt !== 'GRID' && bt !== 'INFGRID') {
        this._stats.triggerRejected.intent++;
        return null;
      }
      if (p3v !== 'ALLOW' && p3v !== 'CONDITIONAL_ALLOW') {
        this._stats.triggerRejected.verdict++;
        return null;
      }
      if (intent.p3RiskFlag) {
        this._stats.triggerRejected.riskFlag++;
        return null;
      }
      this._stats.triggerSeen++;

      const price = Number(intent.priceNow);
      if (!price || price <= 0) {
        this._stats.triggerRejected.price++;
        return null;
      }

      // Skip wenn schon active Sim auf diesem Symbol
      for (const [_id, s] of this._activeSims) {
        if (s.symbol === intent.symbol && s.status === 'OPEN') {
          this._stats.triggerRejected.alreadyOpen++;
          return null;
        }
      }

      return this._createSim(intent, candles, price);
    } catch(e) {
      try { console.warn('[GRID_SIM] observe err: ' + e.message); } catch(_){}
      return null;
    }
  },

  _createSim(intent, candles, price) {
    const now = Date.now();
    const simId = 'GSIM_' + intent.symbol + '_' + now;
    const symbol = intent.symbol;
    const botType = intent.botTypeIntent;

    // ATR-basierte Range, sonst Default 4% (±2% um mid)
    let atr = 0;
    let paramSource = 'DEFAULT';
    try {
      if (candles && candles.length >= 14 && this._refs.indFn) {
        atr = this._refs.indFn(candles, 14) || 0;
        if (atr > 0) paramSource = 'CANDLES_ATR14';
      }
    } catch(_){}
    if (!atr) {
      atr = price * 0.02;  // 2% fallback
      paramSource = 'DEFAULT_2PCT';
    }

    const numLevels = this.CFG.NUM_LEVELS_DEFAULT;
    const rangeLow = price - this.CFG.ATR_MULT_DEFAULT * atr;
    const rangeHigh = price + this.CFG.ATR_MULT_DEFAULT * atr;
    const spacing = (rangeHigh - rangeLow) / numLevels;
    const spacingPct = spacing / price;
    const perLevelUsdt = this.CFG.SIM_CAPITAL_POOL_USDT / numLevels;

    // Levels initialisieren (von low nach high)
    const levels = [];
    for (let i = 0; i < numLevels; i++) {
      const lvlPrice = rangeLow + (i + 0.5) * spacing;
      levels.push({
        index: i,
        price: lvlPrice,
        bought: false,         // ob auf diesem Level Inventar gekauft wurde
        boughtQty: 0,
        boughtPrice: 0,
      });
    }

    const sim = {
      id: simId,
      symbol,
      botType,
      regime: intent.regime,
      symbolClass: intent.symbolClass,
      paramSource,
      entryTs: now,
      entryPrice: price,
      lastPrice: price,
      rangeLow, rangeHigh, numLevels,
      spacingPct, perLevelUsdt,
      levels,
      fillCount: 0,
      buyFills: 0,
      sellFills: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      inventoryQty: 0,
      inventoryValueUsdt: 0,
      feesUsdt: 0,
      status: 'OPEN',
    };
    this._activeSims.set(simId, sim);
    this._stats.simsCreated++;
    this._emitRow(sim, 'CREATED', '');
    return sim;
  },

  /**
   * Tick: für jede aktive Sim aktuellen Preis prüfen → Fills berechnen → Exits checken.
   */
  async _tickSims() {
    if (this._activeSims.size === 0) return;
    const bg = this._refs.bitget;
    const regimeRef = this._refs.regime;
    const currentRegime = (regimeRef && regimeRef.regime) || null;
    const now = Date.now();

    for (const [id, sim] of this._activeSims) {
      if (sim.status !== 'OPEN') continue;
      try {
        let priceNow = 0;
        try {
          if (bg && bg.priceCache && bg.priceCache[sim.symbol]) {
            priceNow = Number(bg.priceCache[sim.symbol].last || bg.priceCache[sim.symbol].price || 0);
          }
        } catch(_){}
        if (!priceNow || priceNow <= 0) continue;

        const prevPrice = sim.lastPrice;
        sim.lastPrice = priceNow;

        // Range-Break-Check
        if (priceNow < sim.rangeLow || priceNow > sim.rangeHigh) {
          this._markToMarket(sim, priceNow);
          this._closeSim(sim, 'RANGE_BROKEN');
          continue;
        }
        // Timeout-Check
        if (now - sim.entryTs >= this.CFG.TIMEOUT_MS) {
          this._markToMarket(sim, priceNow);
          this._closeSim(sim, 'TIMEOUT');
          continue;
        }
        // Regime-Exit
        if (currentRegime && this.CFG.EXIT_REGIMES.has(currentRegime)) {
          this._markToMarket(sim, priceNow);
          this._closeSim(sim, 'REGIME_EXIT_' + currentRegime);
          continue;
        }

        // Fill-Logik (echte Grid-Bot-Mechanik):
        // Down-Cross Level_N → BUY@N, Sell-Target = N + spacing (eine Stufe höher)
        // Up-Cross zum Sell-Target → SELL → realized profit = spacing × qty − fees
        const movingDown = priceNow < prevPrice;
        const movingUp = priceNow > prevPrice;
        const spacing = (sim.rangeHigh - sim.rangeLow) / sim.numLevels;
        for (const lvl of sim.levels) {
          // BUY: Down-Cross dieses Levels + noch nicht gekauft
          if (movingDown && prevPrice >= lvl.price && priceNow < lvl.price && !lvl.bought) {
            const qty = sim.perLevelUsdt / lvl.price;
            const fee = sim.perLevelUsdt * this.CFG.TAKER_FEE;
            lvl.bought = true;
            lvl.boughtQty = qty;
            lvl.boughtPrice = lvl.price;
            lvl.sellTarget = lvl.price + spacing;   // = nächstes Level höher
            sim.inventoryQty += qty;
            sim.feesUsdt += fee;
            sim.buyFills++;
            sim.fillCount++;
          }
          // SELL: Up-Cross über lvl.sellTarget + hatte Inventar
          if (movingUp && lvl.bought && prevPrice <= lvl.sellTarget && priceNow > lvl.sellTarget) {
            const qty = lvl.boughtQty;
            const sellValue = qty * lvl.sellTarget;
            const fee = sellValue * this.CFG.TAKER_FEE;
            // Brutto-Spread-Profit = (sellTarget - boughtPrice) × qty = spacing × qty
            sim.realizedPnl += (lvl.sellTarget - lvl.boughtPrice) * qty;
            sim.feesUsdt += fee;
            sim.inventoryQty -= qty;
            lvl.bought = false;
            lvl.boughtQty = 0;
            lvl.boughtPrice = 0;
            lvl.sellTarget = 0;
            sim.sellFills++;
            sim.fillCount++;
          }
        }

        // Realized PnL netto = realized minus fees
        // (We track gross realized + fees separately, net = realized - feesUsdt at exit)

        // Update unrealized = inventory_value - cost_basis_remaining
        let inventoryValue = 0;
        let costBasis = 0;
        for (const lvl of sim.levels) {
          if (lvl.bought) {
            inventoryValue += lvl.boughtQty * priceNow;
            costBasis += lvl.boughtQty * lvl.boughtPrice;
          }
        }
        sim.inventoryValueUsdt = inventoryValue;
        sim.unrealizedPnl = inventoryValue - costBasis;

        // PnL-Target-Check (winning) — early-Exit nicht aktiviert in v1 (lass laufen bis Timeout/Range-Break)
        // Stat-Update: nur am Ende geloggt
      } catch(e) {
        try { console.warn('[GRID_SIM] tick err ' + id + ': ' + e.message); } catch(_){}
      }
    }

    // Cleanup geschlossene Sims (30s Grace)
    for (const [id, sim] of this._activeSims) {
      if (sim.status === 'CLOSED' && (now - sim.exitTs) > 30000) {
        this._activeSims.delete(id);
      }
    }
  },

  _markToMarket(sim, currentPrice) {
    // Inventar zum aktuellen Preis bewerten
    let inventoryValue = 0;
    let costBasis = 0;
    for (const lvl of sim.levels) {
      if (lvl.bought) {
        inventoryValue += lvl.boughtQty * currentPrice;
        costBasis += lvl.boughtQty * lvl.boughtPrice;
      }
    }
    sim.inventoryValueUsdt = inventoryValue;
    sim.unrealizedPnl = inventoryValue - costBasis;
  },

  _closeSim(sim, exitReason) {
    sim.status = 'CLOSED';
    sim.exitTs = Date.now();
    sim.exitReason = exitReason;
    // realized + unrealized − fees = total
    this._stats.simsClosed++;
    this._stats.totalFills += sim.fillCount;
    this._stats.totalRealizedPnl += (sim.realizedPnl - sim.feesUsdt);
    this._stats.totalRealizedFees += sim.feesUsdt;
    this._emitRow(sim, 'CLOSED', exitReason);
  },

  snapshot() {
    const avgPnlPerSim = this._stats.simsClosed > 0 ? (this._stats.totalRealizedPnl / this._stats.simsClosed) : 0;
    return {
      enabled: this.enabled,
      initDone: this._initDone,
      tickMs: this.TICK_MS,
      cfg: this.CFG,
      stats: { ...this._stats },
      computed: { avgPnlPerSim },
      activeSimsCount: this._activeSims.size,
      activeSims: Array.from(this._activeSims.values()).filter(s => s.status === 'OPEN').map(s => ({
        id: s.id, symbol: s.symbol, botType: s.botType, paramSource: s.paramSource,
        entryTs: s.entryTs, entryPrice: s.entryPrice, lastPrice: s.lastPrice,
        rangeLow: s.rangeLow, rangeHigh: s.rangeHigh, numLevels: s.numLevels,
        fillCount: s.fillCount, buyFills: s.buyFills, sellFills: s.sellFills,
        realizedPnl: s.realizedPnl, unrealizedPnl: s.unrealizedPnl,
        inventoryQty: s.inventoryQty, feesUsdt: s.feesUsdt,
        ageMin: Math.round((Date.now() - s.entryTs)/60000),
      })),
      recentEvents: this._ringBuffer.slice(0, 20),
    };
  },

  recent(limit = 50) {
    return this._ringBuffer.slice(0, Math.min(limit, RING_SIZE));
  },
};

module.exports = GridOutcomeSim;
