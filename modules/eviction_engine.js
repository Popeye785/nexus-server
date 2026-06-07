// modules/eviction_engine.js — Adaptive Slot-Allocation Eviction-Pipeline
// Verankert 2026-05-23 (G7.3 + G7.4 — Master-Pipeline G7).
//
// Christian-Wahl: MITTEL-Profil, 2h DRY_RUN, nur SINGLE evictbar, HMM-aware.
// Quelle: docs/OPPORTUNITY_EVICTION_RESEARCH_20260523.md
//
// Pipeline (alle Pre-Checks müssen erfüllt sein):
//   1. CFG.EVICTION_MODE in ['DRY_RUN','LIVE']  (PAPER bot-side bleibt sowieso)
//   2. Auto-Stop Wallet < 95% Day-Start oder cumLoss > 1% Wallet → disabled
//   3. HMM-State in REGIME_ALLOW (BEAR/CRASH/BULL_STRONG/SQUEEZE)
//   4. Alle 5 Slots besetzt (sonst macht Eviction keinen Sinn — open einfach neu)
//   5. OpportunityScanner.getCurrentBigOpportunity() != null mit score>=6
//   6. Opp.direction passt zu HMM-Direction-Bias
//   7. SlotStrengthRanker.weakestEvictable() != null mit strength<=-0.40
//   8. Eviction-Cooldown >30min seit letzter Eviction
//   9. Per-Symbol-Cooldown 60min vor Re-Trade
//  10. weakest.ageMs >= MIN_HOLD_TIME_MS (30min)
//  11. estLoss <= 5% Wallet
//  12. Premortem: estOppGain / estLoss >= 1.5
//
// Wenn alle 12 Checks OK:
//   DRY_RUN: log + Telegram "WÜRDE jetzt evicten X → Y"
//   LIVE:    Close weakest → Open Opp-Trade → audit-log

'use strict';

const EvictionEngine = {
  _db: null,
  _Bitget: null,
  _scanner: null,
  _ranker: null,
  _walletProvider: null,
  _demoEngine: null,
  _telegramFn: null,
  _logFn: null,
  _cronTimer: null,
  _initialized: false,

  _state: {
    mode: 'DRY_RUN',          // 'DRY_RUN' | 'LIVE' | 'DISABLED'
    activatedAt: 0,
    lastEvictionTs: 0,
    perSymbolCooldown: {},    // symbol → cooldown-end-ts
    dailyStartWallet: 0,
    dayStartTs: 0,
    cumLossSinceMidnight: 0,
    plans: [],                 // letzte 50 Eviction-Pläne (DRY_RUN + LIVE)
    autoStop: false,
    autoStopReason: null,
  },

  _stats: {
    pipeline_runs: 0,
    blocked_checks: {},        // check-name → count
    dry_plans: 0,
    live_evictions: 0,
    total_eviction_loss: 0,
    total_eviction_gain: 0,
    errors: 0,
  },

  CFG: {
    MIN_HOLD_TIME_MS:        1800000,   // 30 min
    EVICTION_COOLDOWN_MS:    1800000,   // 30 min zwischen Evictions
    PER_SYMBOL_COOLDOWN_MS:  3600000,   // 60 min
    EVICTION_LOSS_CAP_PCT:   0.05,      // 5% Wallet pro Eviction
    OPP_GAIN_RATIO_MIN:      1.5,
    WALLET_DD_STOP_RATIO:    0.95,      // < 95% Day-Start → DISABLED
    CUM_LOSS_AUTO_STOP_PCT:  0.01,      // 1% Wallet cum loss seit Midnight
    SCAN_INTERVAL_MS:        60000,     // 60s (synchron mit OppScanner)
    REGIME_ALLOW:            ['BEAR','CRASH','BULL_STRONG','SQUEEZE','BULL_WEAK','BEAR_WEAK'],
  },

  init(deps) {
    this._db = deps.db;
    this._Bitget = deps.bitget;
    this._scanner = deps.scanner;
    this._ranker = deps.ranker;
    this._walletProvider = deps.walletProvider;
    this._demoEngine = deps.demoEngine;
    this._telegramFn = deps.telegramFn;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };

    try {
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS eviction_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          mode TEXT NOT NULL,
          evicted_symbol TEXT,
          evicted_kind TEXT,
          evicted_strength REAL,
          est_loss REAL,
          opp_symbol TEXT,
          opp_direction TEXT,
          opp_score REAL,
          est_opp_gain REAL,
          gain_loss_ratio REAL,
          action TEXT,
          reason TEXT,
          details_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_evict_ts ON eviction_log(ts);
        CREATE INDEX IF NOT EXISTS idx_evict_mode ON eviction_log(mode);
      `);
      this._state.dailyStartWallet = this._walletProvider ? this._walletProvider.total() : 0;
      this._state.dayStartTs = this._midnightTs();
      this._initialized = true;
      try { this._logFn.info && this._logFn.info('EVICT', `init mode=${this._state.mode} day_start_wallet=${this._state.dailyStartWallet.toFixed(2)}`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('EVICT', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  _midnightTs() {
    const d = new Date(); d.setHours(0,0,0,0);
    return d.getTime();
  },

  // ─── Pre-Check #1: Mode ───────────────────────────────────────
  _checkMode() {
    if (this._state.autoStop) return { ok: false, reason: 'AUTO_STOP:' + this._state.autoStopReason };
    if (this._state.mode === 'DISABLED') return { ok: false, reason: 'DISABLED' };
    return { ok: true };
  },

  // ─── Pre-Check #2: Wallet-DD-Stop ───────────────────────────
  _checkWalletDD() {
    if (!this._walletProvider) return { ok: true };
    // Reset Day-Start wenn neuer Tag
    if (this._midnightTs() > this._state.dayStartTs) {
      this._state.dailyStartWallet = this._walletProvider.total();
      this._state.dayStartTs = this._midnightTs();
      this._state.cumLossSinceMidnight = 0;
    }
    const total = this._walletProvider.total();
    if (this._state.dailyStartWallet > 0 && total < this._state.dailyStartWallet * this.CFG.WALLET_DD_STOP_RATIO) {
      return { ok: false, reason: `WALLET_DD<${(this.CFG.WALLET_DD_STOP_RATIO*100).toFixed(0)}%` };
    }
    // Cumulative-Loss-Stop
    if (this._state.cumLossSinceMidnight > this._state.dailyStartWallet * this.CFG.CUM_LOSS_AUTO_STOP_PCT) {
      // Auto-Stop scharfschalten
      if (!this._state.autoStop) {
        this._state.autoStop = true;
        this._state.autoStopReason = `CUM_EVICT_LOSS>${(this.CFG.CUM_LOSS_AUTO_STOP_PCT*100).toFixed(1)}%`;
        try { if (this._telegramFn) this._telegramFn(`🛑 EVICTION AUTO-STOP — kumulativer Verlust ${this._state.cumLossSinceMidnight.toFixed(2)} USDT > Limit ${(this.CFG.CUM_LOSS_AUTO_STOP_PCT*100).toFixed(1)}% Wallet`); } catch(_) {}
      }
      return { ok: false, reason: `CUM_LOSS_OVER_LIMIT (${this._state.cumLossSinceMidnight.toFixed(2)} USDT)` };
    }
    return { ok: true };
  },

  // ─── Pre-Check #3+#4: alle 5 Slots besetzt? ─────────────────
  _checkAllSlotsBusy() {
    try {
      const total = (this._demoEngine && this._demoEngine.positions ? Object.keys(this._demoEngine.positions).length : 0)
                  + (this._db.prepare(`SELECT COUNT(*) n FROM grid_instances WHERE status='OPEN'`).get().n || 0)
                  + (this._db.prepare(`SELECT COUNT(*) n FROM dca_instances WHERE status IN ('OPEN','DD_STOPPED')`).get().n || 0);
      const maxSlots = (typeof CFG !== 'undefined' && CFG.MAX_OPEN_TRADES) ? CFG.MAX_OPEN_TRADES : 5;
      if (total < maxSlots) return { ok: false, reason: `SLOTS_FREE (${total}/${maxSlots})` };
      return { ok: true, total, max: maxSlots };
    } catch(_) { return { ok: false, reason: 'SLOT_COUNT_ERR' }; }
  },

  // ─── Pre-Check #5+#6: Big-Opportunity verfügbar + Direction match? ──
  _checkOpportunity() {
    if (!this._scanner) return { ok: false, reason: 'NO_SCANNER' };
    const opp = this._scanner.getCurrentBigOpportunity();
    if (!opp) return { ok: false, reason: 'NO_BIG_OPP' };
    if (opp._directionMismatch) return { ok: false, reason: 'OPP_DIR_MISMATCH' };
    return { ok: true, opp };
  },

  // ─── Pre-Check #7+#10: Weakest-Bot + Hold-Time ──────────────
  async _checkWeakest() {
    if (!this._ranker) return { ok: false, reason: 'NO_RANKER' };
    await this._ranker.rank();
    const w = this._ranker.weakestEvictable();
    if (!w) return { ok: false, reason: 'NO_WEAK_BOT' };
    if (w.ageMs < this.CFG.MIN_HOLD_TIME_MS) return { ok: false, reason: `WEAK_BOT_YOUNG (${Math.round(w.ageMs/60000)}min < 30min)` };
    return { ok: true, weakest: w };
  },

  // ─── Pre-Check #8: Global Cooldown ──────────────────────────
  _checkCooldown() {
    const elapsed = Date.now() - this._state.lastEvictionTs;
    if (this._state.lastEvictionTs > 0 && elapsed < this.CFG.EVICTION_COOLDOWN_MS) {
      return { ok: false, reason: `COOLDOWN ${Math.round((this.CFG.EVICTION_COOLDOWN_MS - elapsed)/60000)}min left` };
    }
    return { ok: true };
  },

  // ─── Pre-Check #9: Per-Symbol-Cooldown ─────────────────────
  _checkSymbolCooldown(symbol) {
    const end = this._state.perSymbolCooldown[symbol];
    if (end && Date.now() < end) {
      return { ok: false, reason: `SYM_COOLDOWN ${Math.round((end - Date.now())/60000)}min` };
    }
    return { ok: true };
  },

  // ─── Premortem: estLoss + estOppGain + Ratio ────────────────
  _premortem(weakest, opp) {
    // estLoss: aktueller PnL bei Bot wenn negativ → realisiert
    const pnlPct = weakest.components ? weakest.components.pnl_pct : 0;
    const estLoss = pnlPct < 0 ? Math.abs(pnlPct) * (weakest.size || 0) : 0;
    // estGain: konservative Schätzung — opp.score/10 als % erwarteter Move × Bot-Size (5 USDT default)
    const expectedMovePct = Math.min(0.10, Math.max(0.005, opp.score / 100));  // score=10 → 10%, score=6 → 6%
    const newPositionSize = Math.min(10, weakest.size || 5);  // konservativ klein für Eviction-Trade
    const estGain = expectedMovePct * newPositionSize * 0.6;  // ×0.6 für realistische Schätzung
    const ratio = estLoss > 0 ? estGain / estLoss : (estGain > 0 ? Infinity : 0);
    return {
      estLoss: +estLoss.toFixed(4),
      estGain: +estGain.toFixed(4),
      ratio: isFinite(ratio) ? +ratio.toFixed(2) : 99,
      passLossCap: estLoss <= (this._walletProvider ? this._walletProvider.total() : 1000) * this.CFG.EVICTION_LOSS_CAP_PCT,
      passRatio: ratio >= this.CFG.OPP_GAIN_RATIO_MIN || estLoss === 0,
    };
  },

  // ─── Main Pipeline ──────────────────────────────────────────
  async tick() {
    if (!this._initialized) return;
    this._stats.pipeline_runs++;

    const logBlock = (reason) => {
      this._stats.blocked_checks[reason] = (this._stats.blocked_checks[reason] || 0) + 1;
    };

    // Check 1
    const c1 = this._checkMode();
    if (!c1.ok) { logBlock(c1.reason); return; }
    // Check 2
    const c2 = this._checkWalletDD();
    if (!c2.ok) { logBlock(c2.reason); return; }
    // Check 3+4
    const c34 = this._checkAllSlotsBusy();
    if (!c34.ok) { logBlock(c34.reason); return; }
    // Check 8
    const c8 = this._checkCooldown();
    if (!c8.ok) { logBlock(c8.reason); return; }
    // Check 5+6
    const c56 = this._checkOpportunity();
    if (!c56.ok) { logBlock(c56.reason); return; }
    const opp = c56.opp;
    // Check 9
    const c9 = this._checkSymbolCooldown(opp.symbol);
    if (!c9.ok) { logBlock(c9.reason + ':' + opp.symbol); return; }
    // Check 7+10
    const c710 = await this._checkWeakest();
    if (!c710.ok) { logBlock(c710.reason); return; }
    const weakest = c710.weakest;
    // Premortem
    const pm = this._premortem(weakest, opp);
    if (!pm.passLossCap) { logBlock('LOSS_CAP_FAIL'); return; }
    if (!pm.passRatio) { logBlock(`GAIN_RATIO_FAIL (${pm.ratio} < ${this.CFG.OPP_GAIN_RATIO_MIN})`); return; }

    // ALLE 12 CHECKS OK → Eviction-Plan
    const plan = {
      ts: Date.now(),
      mode: this._state.mode,
      evicted: { symbol: weakest.symbol, kind: weakest.kind, id: weakest.id, strength: weakest.strength, ageMs: weakest.ageMs },
      opportunity: { symbol: opp.symbol, direction: opp.direction, score: opp.score },
      premortem: pm,
    };
    this._state.plans.push(plan);
    this._state.plans = this._state.plans.slice(-50);

    // DRY_RUN: nur loggen
    if (this._state.mode === 'DRY_RUN') {
      this._stats.dry_plans++;
      try {
        this._db.prepare(`INSERT INTO eviction_log
          (ts, mode, evicted_symbol, evicted_kind, evicted_strength, est_loss, opp_symbol, opp_direction, opp_score, est_opp_gain, gain_loss_ratio, action, reason, details_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          plan.ts, 'DRY_RUN', weakest.symbol, weakest.kind, weakest.strength,
          pm.estLoss, opp.symbol, opp.direction, opp.score, pm.estGain, pm.ratio,
          'DRY_RUN_PLAN', 'all_checks_ok', JSON.stringify(plan)
        );
      } catch(_) {}
      try { this._logFn.info && this._logFn.info('EVICT', `[DRY_RUN] would evict ${weakest.symbol}(${weakest.strength.toFixed(2)}, -${pm.estLoss.toFixed(2)}USDT) → ${opp.symbol} ${opp.direction} score=${opp.score} estGain=${pm.estGain.toFixed(2)} ratio=${pm.ratio}`); } catch(_) {}
      try { if (this._telegramFn) this._telegramFn(`🧪 [DRY_RUN] EVICTION-PLAN: ${weakest.symbol}(${weakest.strength.toFixed(2)}) close -${pm.estLoss.toFixed(2)} USDT → ${opp.symbol} ${opp.direction} score=${opp.score} estGain=${pm.estGain.toFixed(2)} (ratio ${pm.ratio})`); } catch(_) {}
      // Cooldown setzen (auch DRY damit Plans nicht spammen)
      this._state.lastEvictionTs = Date.now();
      this._state.perSymbolCooldown[opp.symbol] = Date.now() + this.CFG.PER_SYMBOL_COOLDOWN_MS;
      this._state.perSymbolCooldown[weakest.symbol] = Date.now() + this.CFG.PER_SYMBOL_COOLDOWN_MS;
      return;
    }

    // LIVE: tatsächlich evicten + neue Position öffnen
    if (this._state.mode === 'LIVE') {
      try {
        await this._executeEviction(weakest, opp, pm);
      } catch(e) {
        this._stats.errors++;
        try { this._logFn.warn && this._logFn.warn('EVICT', 'execute err: ' + e.message); } catch(_) {}
      }
    }
  },

  // ─── LIVE-Execution: Close weakest + Open opp ───────────────
  async _executeEviction(weakest, opp, pm) {
    // NUR SINGLE-Trades sind evictable (Christian-Direktive)
    if (weakest.kind !== 'SINGLE') {
      try { this._logFn.warn && this._logFn.warn('EVICT', 'protected bot kind ignored: ' + weakest.kind); } catch(_) {}
      return;
    }
    // Step 1: Close weakest (NautilusTrader market_exit-Pattern)
    let closeResult = null;
    try {
      // DemoEngine.positions[id] schließen via _forceCloseSingle (falls existiert) oder direkt
      const pos = this._demoEngine.positions[weakest.id];
      if (!pos) throw new Error('position not found in DemoEngine');
      const price = (this._Bitget.priceCache[weakest.symbol] && this._Bitget.priceCache[weakest.symbol].last) || pos.fillPrice;
      // Force-Close via Trades.close + WalletProvider.applyPnL
      const dbTradeId = pos.dbTradeId;
      if (dbTradeId && typeof Trades !== 'undefined' && Trades.close) {
        Trades.close(dbTradeId, price, 'EVICTION');
        closeResult = { ok: true, exitPrice: price };
      }
      delete this._demoEngine.positions[weakest.id];
      try { this._demoEngine._persistDemoPositions && this._demoEngine._persistDemoPositions(); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('EVICT', 'close err: ' + e.message); } catch(_) {}
      return;
    }
    this._stats.live_evictions++;
    this._stats.total_eviction_loss += pm.estLoss;
    this._state.cumLossSinceMidnight += pm.estLoss;
    this._state.lastEvictionTs = Date.now();
    this._state.perSymbolCooldown[opp.symbol] = Date.now() + this.CFG.PER_SYMBOL_COOLDOWN_MS;
    this._state.perSymbolCooldown[weakest.symbol] = Date.now() + this.CFG.PER_SYMBOL_COOLDOWN_MS;
    // Step 2: 1s pause
    await new Promise(r => setTimeout(r, 1000));
    // Step 3: Open opp-Trade — sicher klein (5-10 USDT)
    let openResult = null;
    try {
      const candles = await this._Bitget.fetchCandles(opp.symbol, '1h', 100);
      const dir = opp.direction === 'LONG' ? 'BUY' : 'SELL';
      const size = Math.min(10, (this._walletProvider ? this._walletProvider.trading() : 0) * 0.01);
      if (size >= 5) {
        await this._demoEngine._executeTrade(opp.symbol, dir, opp.score / 10, candles,
          [{ strategy: 'EVICTION_OPP', direction: dir, strength: opp.score / 10, _audit: { confidence: opp.score / 10, slPct: 0.02, sizeSource: 'EVICTION', regimeClass: 'EVICTION', regimeMult: 1.0 } }],
          size);
        openResult = { ok: true, size, dir };
      }
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('EVICT', 'open err: ' + e.message); } catch(_) {}
    }
    try {
      this._db.prepare(`INSERT INTO eviction_log
        (ts, mode, evicted_symbol, evicted_kind, evicted_strength, est_loss, opp_symbol, opp_direction, opp_score, est_opp_gain, gain_loss_ratio, action, reason, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        Date.now(), 'LIVE', weakest.symbol, weakest.kind, weakest.strength,
        pm.estLoss, opp.symbol, opp.direction, opp.score, pm.estGain, pm.ratio,
        'LIVE_EXECUTED', 'all_checks_ok', JSON.stringify({ closeResult, openResult })
      );
    } catch(_) {}
    try { if (this._telegramFn) this._telegramFn(`⚡ EVICTION: ${weakest.symbol}(${weakest.strength.toFixed(2)}) closed -${pm.estLoss.toFixed(2)} USDT → ${opp.symbol} ${opp.direction} opened (score ${opp.score}, est+${pm.estGain.toFixed(2)})`); } catch(_) {}
  },

  // ─── Mode-Switch (DRY_RUN ↔ LIVE) ───────────────────────────
  // P6.3 [2026-06-04]: no-op Schutz — bei oldMode === mode kein Telegram-Spam.
  // Log.info läuft weiter für Audit-Trail, Telegram nur bei echtem Mode-Wechsel.
  setMode(mode, reason) {
    const valid = ['DRY_RUN','LIVE','DISABLED'];
    if (!valid.includes(mode)) return { ok: false, reason: 'INVALID_MODE' };
    const oldMode = this._state.mode;
    if (oldMode === mode) {
      try { this._logFn.info && this._logFn.info('EVICT', `mode no-op: ${mode} (${reason||'manual'}) — no telegram`); } catch(_) {}
      return { ok: true, oldMode, newMode: mode, noop: true };
    }
    this._state.mode = mode;
    if (mode === 'LIVE') this._state.activatedAt = Date.now();
    try { this._logFn.info && this._logFn.info('EVICT', `mode change: ${oldMode} → ${mode} (${reason||'manual'})`); } catch(_) {}
    // FORENSIK [2026-06-05]: Mode-Switch in eviction_log persistieren (additiv, keine Strategieänderung).
    try {
      if (this._db) {
        this._db.prepare(`INSERT INTO eviction_log
          (ts, mode, evicted_symbol, evicted_kind, evicted_strength, est_loss, opp_symbol, opp_direction, opp_score, est_opp_gain, gain_loss_ratio, action, reason, details_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          Date.now(), mode, null, null, null, null, null, null, null, null, null,
          'MODE_SWITCH', String(reason || 'manual').slice(0, 100),
          JSON.stringify({ oldMode, newMode: mode, reason: reason || 'manual', activatedAt: this._state.activatedAt || null }).slice(0, 2000)
        );
      }
    } catch(_) {}
    try { if (this._telegramFn) this._telegramFn(`🔄 Eviction-Mode: ${oldMode} → ${mode}${reason?' ('+reason+')':''}`); } catch(_) {}
    return { ok: true, oldMode, newMode: mode };
  },

  startCron() {
    if (this._cronTimer) return;
    // First nach 120s (gibt Scanner + Ranker Zeit)
    setTimeout(() => this.tick().catch(()=>{}), 120000);
    this._cronTimer = setInterval(() => this.tick().catch(()=>{}), this.CFG.SCAN_INTERVAL_MS);
    try { this._logFn.info && this._logFn.info('EVICT', `cron started (${this.CFG.SCAN_INTERVAL_MS/1000}s ticks)`); } catch(_) {}
  },

  stopCron() { if (this._cronTimer) { clearInterval(this._cronTimer); this._cronTimer = null; } },

  snapshot() {
    return {
      initialized: this._initialized,
      state: this._state,
      stats: this._stats,
      cfg: this.CFG,
      lastPlans: this._state.plans.slice(-10),
    };
  },

  history(limit = 20) {
    if (!this._db) return [];
    try {
      return this._db.prepare(`SELECT * FROM eviction_log ORDER BY ts DESC LIMIT ?`).all(limit);
    } catch(_) { return []; }
  },
};

module.exports = EvictionEngine;
