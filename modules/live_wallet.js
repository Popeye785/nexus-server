// modules/live_wallet.js — LIVE virtuelle Reserve+Trading-Buchhaltung
// Verankert 2026-05-23 (STUFE E.1-E.2 — Live-Parity).
//
// PROBLEM: Bitget kennt nur Gesamt-Balance (available/locked).
// NEXUS-Reserve/Trading-Split (70/30) ist eine interne Konstruktion.
// In LIVE muss diese Split-Buchhaltung weiterlaufen — als virtueller Layer
// über der echten Bitget-Balance.
//
// LÖSUNG: in_memory + bot_settings-persistierte Buckets:
//   live_wallet_reserve
//   live_wallet_trading
//   live_wallet_last_sync_balance     (für Drift-Detection)
//
// Sync-Modell:
//   - Bei applyPnL(): mutiert reserve+trading intern (70/30 oder Voll-Abzug)
//   - Bei debit/credit(): mutiert nur trading
//   - Bei Boot: liest aus bot_settings + checkt Drift gegen Bitget-Balance.usable
//   - Bei Drift > Schwelle: WARN + bestehende Buckets bleiben (manuelle Reconciliation)
//
// SAFETY:
//   - applyPnL bei Verlust → Reserve UNANGETASTET (Capital Preservation)
//   - Initiale Buckets bei Boot wenn nicht in DB: alles in Trading (Reserve=0)
//     bis erster Profit kommt — bewusst defensiv

'use strict';

const LiveWallet = {
  _db: null,
  _logFn: null,
  _state: {
    reserve: 0,
    trading: 0,
    pnl: 0,
    dailyPnl: 0,
    lastSyncBalance: 0,
    lastSyncTs: 0,
  },
  _initialized: false,
  _cfg: {
    DRIFT_WARN_PCT: 0.05,  // > 5% Drift gegen Bitget-Balance → WARN
    PERSIST_KEYS: ['live_wallet_reserve', 'live_wallet_trading', 'live_wallet_pnl', 'live_wallet_daily_pnl', 'live_wallet_last_sync_balance', 'live_wallet_last_sync_ts'],
  },

  init(db) {
    this._db = db;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      // bot_settings-Tabelle vorhanden (schon vom Demo-System genutzt)
      // Restore aus DB
      const get = (key) => {
        try { const r = db.prepare("SELECT value FROM bot_settings WHERE key = ?").get(key); if (!r) return null; const v = parseFloat(r.value); return Number.isFinite(v) ? v : null; }
        catch(_) { return null; }
      };
      const reserve = get('live_wallet_reserve');
      const trading = get('live_wallet_trading');
      const pnl = get('live_wallet_pnl');
      const dpl = get('live_wallet_daily_pnl');
      const lsb = get('live_wallet_last_sync_balance');
      const lst = get('live_wallet_last_sync_ts');
      this._state.reserve = reserve == null ? 0 : reserve;
      this._state.trading = trading == null ? 0 : trading;
      this._state.pnl     = pnl == null ? 0 : pnl;
      this._state.dailyPnl= dpl == null ? 0 : dpl;
      this._state.lastSyncBalance = lsb == null ? 0 : lsb;
      this._state.lastSyncTs = lst == null ? 0 : lst;
      this._initialized = true;
      try { this._logFn.info && this._logFn.info('LIVE_WALLET', `init reserve=${this._state.reserve.toFixed(2)} trading=${this._state.trading.toFixed(2)} pnl=${this._state.pnl.toFixed(2)}`); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('LIVE_WALLET', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  _persist() {
    if (!this._db) return;
    try {
      const set = this._db.prepare("INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)");
      const now = Date.now();
      set.run('live_wallet_reserve', String(this._state.reserve), now);
      set.run('live_wallet_trading', String(this._state.trading), now);
      set.run('live_wallet_pnl', String(this._state.pnl), now);
      set.run('live_wallet_daily_pnl', String(this._state.dailyPnl), now);
      set.run('live_wallet_last_sync_balance', String(this._state.lastSyncBalance), now);
      set.run('live_wallet_last_sync_ts', String(this._state.lastSyncTs), now);
    } catch(_) {}
  },

  // ─── BOOTSTRAP aus Bitget-Balance (einmaliger Setup, manuell triggern) ───
  // Initialisiert reserve+trading aus aktueller Bitget-Balance via splitRatio.
  // Nur aufrufen wenn Buckets leer sind UND Christian explizit setup macht.
  bootstrap(bitgetBalance, splitRatio = 0.70) {
    if (!isFinite(bitgetBalance) || bitgetBalance <= 0) {
      return { ok: false, reason: 'INVALID_BALANCE' };
    }
    if (this._state.reserve > 0 || this._state.trading > 0) {
      return { ok: false, reason: 'ALREADY_INITIALIZED', current: this.snapshot() };
    }
    this._state.reserve = bitgetBalance * splitRatio;
    this._state.trading = bitgetBalance * (1 - splitRatio);
    this._state.lastSyncBalance = bitgetBalance;
    this._state.lastSyncTs = Date.now();
    this._persist();
    try { this._logFn.info && this._logFn.info('LIVE_WALLET', `BOOTSTRAP balance=${bitgetBalance.toFixed(2)} reserve=${this._state.reserve.toFixed(2)} trading=${this._state.trading.toFixed(2)} ratio=${splitRatio}`); } catch(_) {}
    return { ok: true, reserve: this._state.reserve, trading: this._state.trading };
  },

  // ─── SCHREIB-Pfade (identisch zur Demo-Logik in WalletProvider) ───
  debit(amount, reason, tradeId) {
    if (!isFinite(amount) || amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
    const beforeT = this._state.trading;
    this._state.trading = Math.max(0, this._state.trading - amount);
    this._persist();
    return { ok: true, mode: 'LIVE', beforeT, newTrading: this._state.trading, reserve: this._state.reserve };
  },

  credit(amount, reason, tradeId) {
    if (!isFinite(amount) || amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
    const beforeT = this._state.trading;
    this._state.trading = (this._state.trading || 0) + amount;
    this._persist();
    return { ok: true, mode: 'LIVE', beforeT, newTrading: this._state.trading, reserve: this._state.reserve };
  },

  // ─── applyPnL: 70/30-Split bei Profit, Voll-Abzug Trading bei Verlust ───
  applyPnL(pnl, tradeId, splitRatio) {
    const ratio = isFinite(splitRatio) && splitRatio >= 0 && splitRatio <= 1 ? splitRatio : 0.70;
    const beforeT = this._state.trading;
    const beforeR = this._state.reserve;
    if (pnl > 0) {
      this._state.reserve = (this._state.reserve || 0) + pnl * ratio;
      this._state.trading = (this._state.trading || 0) + pnl * (1 - ratio);
    } else {
      // Reserve unangetastet bei Verlust (Capital Preservation)
      this._state.trading = Math.max(0, (this._state.trading || 0) + pnl);
    }
    this._state.pnl = (this._state.pnl || 0) + pnl;
    this._state.dailyPnl = (this._state.dailyPnl || 0) + pnl;
    this._persist();
    return {
      ok: true, mode: 'LIVE', pnl,
      newReserve: this._state.reserve, newTrading: this._state.trading,
      newTotal: this._state.reserve + this._state.trading,
      beforeReserve: beforeR, beforeTrading: beforeT,
    };
  },

  // ─── Sync-Check gegen Bitget-Balance ────────────────────────────
  syncCheck(bitgetUsable) {
    if (!isFinite(bitgetUsable) || bitgetUsable <= 0) return { ok: false, reason: 'NO_BITGET_BALANCE' };
    const virtualTotal = this._state.reserve + this._state.trading;
    const drift = Math.abs(bitgetUsable - virtualTotal);
    const driftPct = virtualTotal > 0 ? drift / virtualTotal : 0;
    const result = {
      ok: driftPct < this._cfg.DRIFT_WARN_PCT,
      bitgetUsable, virtualTotal, drift: +drift.toFixed(4), driftPct: +driftPct.toFixed(4),
      threshold: this._cfg.DRIFT_WARN_PCT,
    };
    this._state.lastSyncBalance = bitgetUsable;
    this._state.lastSyncTs = Date.now();
    this._persist();
    if (!result.ok) {
      try { this._logFn.warn && this._logFn.warn('LIVE_WALLET', `DRIFT virtual=${virtualTotal.toFixed(2)} bitget=${bitgetUsable.toFixed(2)} (${(driftPct*100).toFixed(2)}%) > threshold ${(this._cfg.DRIFT_WARN_PCT*100).toFixed(0)}%`); } catch(_) {}
    }
    return result;
  },

  // ─── Lese-Pfade ─────────────────────────────────────────────────
  total() { return (this._state.reserve || 0) + (this._state.trading || 0); },
  reserve() { return this._state.reserve || 0; },
  trading() { return this._state.trading || 0; },

  snapshot() {
    return {
      initialized: this._initialized,
      ...this._state,
      total: this.total(),
    };
  },

  // ─── Reset (für manuelle Bootstrap-Neuinitialisierung) ────────────
  reset() {
    this._state = { reserve: 0, trading: 0, pnl: 0, dailyPnl: 0, lastSyncBalance: 0, lastSyncTs: 0 };
    this._persist();
    return { ok: true, snapshot: this.snapshot() };
  },
};

module.exports = LiveWallet;
