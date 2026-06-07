// modules/slot_strength_ranker.js — Strength-Score pro offenem SINGLE-Bot
// Verankert 2026-05-23 (G7.2 — Master-Pipeline G7).
//
// Christian-Direktive: NUR SINGLE-Trades sind evictbar.
// DCA/GRID/INFGRID werden gerankt (für Dashboard), aber strength wird auf 9.99 fixiert
// damit sie NIE als Eviction-Kandidat erscheinen.
//
// Score-Formel:
//   strength = currentPnl_pct       × 0.4
//            + recentMomentum       × 0.3
//            + estTimeToTakeProfit  × 0.2
//            + alignmentWithRegime  × 0.1
//   + TP-Distanz-Boost × 1.5 wenn Trade nah am TP (<2% bis TP)
//   + Hold-Time-Boost × 1.1 wenn Position > 2h läuft (Time-Decay-Reward)
//
// Range: -1.0 (sehr schwach) ... +1.0 (sehr stark), mit Boost bis ~1.5
// Eviction-Schwelle MITTEL: strength ≤ -0.40

'use strict';

const SlotStrengthRanker = {
  _db: null,
  _Bitget: null,
  _HMM: null,
  _logFn: null,
  _lastRanking: [],
  _lastTs: 0,
  _initialized: false,

  CFG: {
    EVICT_THRESHOLD:      -0.40,
    TP_BOOST_DIST_PCT:    0.02,
    TP_BOOST_FACTOR:      1.5,
    HOLD_TIME_BOOST_MS:   7200000,  // 2h
    HOLD_TIME_BOOST_F:    1.1,
    WEIGHTS: { pnl: 0.4, momentum: 0.3, tte_tp: 0.2, alignment: 0.1 },
  },

  init(db, bitgetClient, hmmModule) {
    this._db = db;
    this._Bitget = bitgetClient;
    this._HMM = hmmModule;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    this._initialized = true;
    try { this._logFn.info && this._logFn.info('SLOT_STRENGTH', `init evict_thresh=${this.CFG.EVICT_THRESHOLD}, weights={pnl:${this.CFG.WEIGHTS.pnl}, mom:${this.CFG.WEIGHTS.momentum}, tte:${this.CFG.WEIGHTS.tte_tp}, align:${this.CFG.WEIGHTS.alignment}}`); } catch(_) {}
  },

  // Gemeinsamer HMM-Direction-Check
  _hmmDirection() {
    try {
      if (this._HMM && this._HMM.getCurrentRegime) {
        const r = this._HMM.getCurrentRegime();
        if (r) {
          const s = r.state || 'RANGING';
          if (s === 'BEAR' || s === 'CRASH' || s === 'BEAR_WEAK') return 'SHORT';
          if (s === 'BULL_STRONG' || s === 'BULL_WEAK' || s === 'SQUEEZE') return 'LONG';
        }
      }
    } catch(_) {}
    return null;
  },

  // Bot-Liste sammeln: SINGLE + MBT
  _collectBots() {
    if (!this._db) return [];
    const bots = [];
    // SINGLE: aus DemoEngine.positions (in-memory) + trades-Tabelle
    try {
      if (typeof DemoEngine !== 'undefined' && DemoEngine.positions) {
        for (const [tradeId, pos] of Object.entries(DemoEngine.positions)) {
          bots.push({
            kind: 'SINGLE',
            id: tradeId,
            symbol: pos.symbol,
            direction: (pos.direction || 'BUY').toUpperCase() === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: pos.fillPrice,
            size: pos.size,
            openedAt: pos.openedAt,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            evictable: true,
          });
        }
      }
    } catch(_) {}
    // GRID/INFGRID
    try {
      const grids = this._db.prepare(`SELECT grid_id, bot_type, symbol, capital_pool, profit_acc FROM grid_instances WHERE status='OPEN'`).all();
      for (const g of grids) {
        bots.push({
          kind: g.bot_type,
          id: g.grid_id,
          symbol: g.symbol,
          direction: 'NEUTRAL',  // Grid = market-neutral
          entryPrice: null,
          size: g.capital_pool,
          pnl_acc: g.profit_acc,
          evictable: false,
        });
      }
    } catch(_) {}
    // DCA
    try {
      const dcas = this._db.prepare(`SELECT dca_id, symbol, total_size, total_spent, avg_buy_price, iteration, created_at, updated_at FROM dca_instances WHERE status IN ('OPEN','DD_STOPPED')`).all();
      for (const d of dcas) {
        bots.push({
          kind: 'DCA',
          id: d.dca_id,
          symbol: d.symbol,
          direction: 'LONG',  // DCA = always long
          entryPrice: d.avg_buy_price,
          size: d.total_spent,
          totalCoins: d.total_size,
          iteration: d.iteration,
          openedAt: d.created_at,
          updatedAt: d.updated_at,
          evictable: false,
        });
      }
    } catch(_) {}
    return bots;
  },

  // Aktueller Preis aus Bitget-PriceCache oder candle
  _currentPrice(symbol) {
    try {
      if (this._Bitget && this._Bitget.priceCache && this._Bitget.priceCache[symbol]) {
        return this._Bitget.priceCache[symbol].last;
      }
    } catch(_) {}
    return null;
  },

  // PnL-% für Bot berechnen
  _calcPnlPct(bot, price) {
    if (!isFinite(price)) return 0;
    if (bot.kind === 'SINGLE') {
      if (!bot.entryPrice || bot.entryPrice <= 0) return 0;
      const dir = bot.direction === 'LONG' ? 1 : -1;
      return dir * (price - bot.entryPrice) / bot.entryPrice;
    } else if (bot.kind === 'DCA') {
      if (!bot.entryPrice || bot.entryPrice <= 0) return 0;
      return (price - bot.entryPrice) / bot.entryPrice;  // long-only
    } else if (bot.kind === 'GRID' || bot.kind === 'INFGRID') {
      // Grid PnL relativ zu eingesetztem Kapital
      return bot.size > 0 ? ((bot.pnl_acc || 0) / bot.size) : 0;
    }
    return 0;
  },

  // Momentum: aus letzten 4 Stunden Bewegung Bot-relativ
  async _recentMomentum(bot) {
    if (bot.kind !== 'SINGLE' && bot.kind !== 'DCA') return 0;
    try {
      const candles = await this._Bitget.fetchCandles(bot.symbol, '1h', 6);
      if (!candles || candles.length < 4) return 0;
      const closes = candles.map(c => parseFloat(c.close ?? c[4]));
      const last = closes[closes.length - 1];
      const prev4h = closes[Math.max(0, closes.length - 5)];
      if (!isFinite(last) || !isFinite(prev4h) || prev4h <= 0) return 0;
      const moveAbs = (last - prev4h) / prev4h;
      const dir = bot.direction === 'LONG' ? 1 : -1;
      // Aligned momentum positiv, gegen Bot negativ
      return dir * moveAbs * 10;  // ×10 für sinnvolle Skala
    } catch(_) { return 0; }
  },

  // estTimeToTakeProfit: 0=schon dran, 1=ewig weg
  // einfach: (distToTP / dailyVolatility)
  _estTimeToTP(bot, price) {
    if (bot.kind !== 'SINGLE') return 0.3;  // MBTs neutral
    if (!bot.takeProfit || !bot.entryPrice) return 0.3;
    const dir = bot.direction === 'LONG' ? 1 : -1;
    const distPct = (bot.takeProfit - price) * dir / price;
    // schon im Profit-Range → +1 (sehr gut), 5% weg → 0, 10% weg → -0.5
    if (distPct <= 0) return 1.0;
    if (distPct < 0.02) return 0.7;
    if (distPct < 0.05) return 0.3;
    if (distPct < 0.10) return 0.0;
    return -0.3;
  },

  // alignmentWithRegime: +1 wenn Bot-Direction passt zu HMM, -1 wenn gegen
  _alignment(bot) {
    const dir = this._hmmDirection();
    if (!dir) return 0;
    if (bot.direction === dir) return 1;
    if (bot.direction === 'NEUTRAL') return 0;
    return -1;
  },

  // Per-Bot Strength berechnen
  async _calcStrength(bot) {
    // Geschützte Bots (DCA/GRID/INFGRID) bekommen synthetic high strength
    if (!bot.evictable) {
      return { strength: 9.99, evictable: false, protected: true };
    }
    const price = this._currentPrice(bot.symbol);
    if (!isFinite(price)) return { strength: 0, error: 'NO_PRICE' };
    const pnlPct = this._calcPnlPct(bot, price);
    const momentum = await this._recentMomentum(bot);
    const tteTp = this._estTimeToTP(bot, price);
    const alignment = this._alignment(bot);
    const w = this.CFG.WEIGHTS;
    let strength = (pnlPct * 10) * w.pnl       // ×10: 1% PnL = 0.1 base
                 + momentum * w.momentum
                 + tteTp * w.tte_tp
                 + alignment * w.alignment;
    // TP-Distanz-Boost
    let tpBoosted = false;
    if (bot.kind === 'SINGLE' && bot.takeProfit && isFinite(price)) {
      const dir = bot.direction === 'LONG' ? 1 : -1;
      const distToTpPct = (bot.takeProfit - price) * dir / price;
      if (distToTpPct >= 0 && distToTpPct < this.CFG.TP_BOOST_DIST_PCT) {
        strength *= this.CFG.TP_BOOST_FACTOR;
        tpBoosted = true;
      }
    }
    // Hold-Time-Boost
    let holdBoosted = false;
    const ageMs = bot.openedAt ? (Date.now() - bot.openedAt) : 0;
    if (ageMs > this.CFG.HOLD_TIME_BOOST_MS) {
      strength *= this.CFG.HOLD_TIME_BOOST_F;
      holdBoosted = true;
    }
    return {
      strength: +strength.toFixed(3),
      evictable: true, protected: false,
      components: {
        pnl_pct: +pnlPct.toFixed(4),
        momentum: +momentum.toFixed(3),
        tte_tp: +tteTp.toFixed(2),
        alignment,
      },
      tpBoosted, holdBoosted,
      ageMs,
    };
  },

  // Public: ranke alle Bots
  async rank() {
    const bots = this._collectBots();
    const ranked = [];
    for (const b of bots) {
      const s = await this._calcStrength(b);
      ranked.push({ ...b, ...s });
    }
    ranked.sort((a, b) => a.strength - b.strength);
    this._lastRanking = ranked;
    this._lastTs = Date.now();
    return ranked;
  },

  // Public: schwächster evictbarer Bot (oder null)
  weakestEvictable() {
    if (!this._lastRanking.length) return null;
    const w = this._lastRanking.find(b => b.evictable && b.strength <= this.CFG.EVICT_THRESHOLD);
    return w || null;
  },

  snapshot() {
    return {
      initialized: this._initialized,
      lastTs: this._lastTs,
      cfg: this.CFG,
      ranking: this._lastRanking,
      weakest: this.weakestEvictable(),
    };
  },
};

module.exports = SlotStrengthRanker;
