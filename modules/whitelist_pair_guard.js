// modules/whitelist_pair_guard.js
// Block Q A3 [27.05.2026]: Pair-Guard für Whitelist-Symbole.
// Block S-Prep A1 [27.05.2026, 14:13]: Pair-Mapping konsolidiert auf SymbolUniverse
//   als Single-Source-of-Truth. FALLBACK_PAIRS bleibt für isolierten Modul-Test.
//
// Hintergrund: Block-P-CPCV zeigte SUI-only kollabiert in VAL (TRAIN +34 → VAL -28, PBO=1).
// Aber NEAR+SUI als Pair ist ROBUST (HOLDOUT Sharpe 25.24).
// → SUI darf NUR gehandelt werden wenn auch NEAR-Bedingungen erfüllt sind.
//
// Regel: SUI bekommt Lower-Floor (0.10) nur wenn aktuelle NEAR-Aktivität signalisiert
// dass der Pair-Edge greift. Sonst: SUI fällt auf globalen Floor zurück (0.20).

'use strict';

let _SymbolUniverse = null;
try { _SymbolUniverse = require('./symbol_universe'); } catch (e) { _SymbolUniverse = null; }

// FALLBACK: nur wenn SymbolUniverse nicht ladbar (z.B. in isoliertem Unit-Test).
// Produktiv-Pfad: SymbolUniverse.requiresPair(symbol) ist die Wahrheit.
const FALLBACK_PAIRS = {
  SUIUSDT: 'NEARUSDT',
};

const WhitelistPairGuard = {
  FALLBACK_PAIRS,

  // Required: primary muss in last N seconds aktiv geblockt/aktiviert sein
  REQUIRE_PRIMARY_ACTIVE_WINDOW_MS: 3600 * 1000, // 1h

  /**
   * Hole required-primary für secondary-symbol.
   * Single-Source: SymbolUniverse.COIN_CONFIG. Fallback nur wenn Modul nicht ladbar.
   */
  getRequiredPair(symbol) {
    if (_SymbolUniverse && typeof _SymbolUniverse.requiresPair === 'function') {
      return _SymbolUniverse.requiresPair(symbol);
    }
    return FALLBACK_PAIRS[symbol] || null;
  },

  /**
   * Liefere alle bekannten Pair-Beziehungen aus SymbolUniverse.
   * Returns: { secondary: primary, ... }
   */
  listPairs() {
    if (_SymbolUniverse && _SymbolUniverse.COIN_CONFIG) {
      const out = {};
      for (const [sym, cfg] of Object.entries(_SymbolUniverse.COIN_CONFIG)) {
        if (cfg.requires_pair) out[sym] = cfg.requires_pair;
      }
      return out;
    }
    return { ...FALLBACK_PAIRS };
  },

  /**
   * Check ob secondary-Symbol seinen Whitelist-Floor bekommen darf.
   * @param {string} symbol
   * @param {Object} db - SQLite-Handle
   * @returns {Object} {allowed, primary, reason}
   */
  isAllowed(symbol, db) {
    const primary = this.getRequiredPair(symbol);
    if (!primary) return { allowed: true, primary: null, reason: 'NOT_PAIR_SECONDARY' };
    if (!db) return { allowed: true, primary, reason: 'NO_DB_CONNECTION_FALLBACK_ALLOW' };
    try {
      // Primary aktiv = mindestens 1 Decision mit conf >= 0.05 in last window
      const since = Date.now() - this.REQUIRE_PRIMARY_ACTIVE_WINDOW_MS;
      const row = db.prepare(`
        SELECT COUNT(*) n FROM aladdin_decisions
        WHERE symbol = ? AND ts > ? AND confidence >= 0.05
      `).get(primary, since);
      const n = row.n || 0;
      if (n >= 3) return { allowed: true, primary, primary_activity_n: n, reason: 'PRIMARY_ACTIVE' };
      return { allowed: false, primary, primary_activity_n: n, reason: 'PRIMARY_INACTIVE' };
    } catch (e) {
      return { allowed: true, primary, reason: 'DB_ERR_FALLBACK_ALLOW', error: e.message };
    }
  },

  /**
   * Effective Floor für Symbol: falls Pair-Guard sperrt, returnt fallback-Floor.
   * @param {string} symbol
   * @param {number} whitelistFloor - z.B. 0.10
   * @param {number} fallbackFloor - z.B. 0.20 (global)
   * @param {Object} db
   * @returns {Object} {floor, guard}
   */
  effectiveFloor(symbol, whitelistFloor, fallbackFloor, db) {
    const guard = this.isAllowed(symbol, db);
    if (guard.allowed) return { floor: whitelistFloor, guard };
    return { floor: fallbackFloor, guard };
  },

  snapshot(db) {
    const out = {};
    const pairs = this.listPairs();
    for (const [sec, prim] of Object.entries(pairs)) {
      out[sec] = this.isAllowed(sec, db);
      out[sec].requires_primary = prim;
    }
    return {
      source: _SymbolUniverse ? 'SymbolUniverse' : 'FALLBACK_PAIRS',
      pairs: out,
    };
  },

  /**
   * Block S A4 [27.05.2026]: Final-Decision-Layer-Check.
   * Konsumiert von final_decision_router. Liefert "tradable now" vs nur "floor-eligible".
   *
   * @param {string} symbol
   * @param {Object} db
   * @returns {{allowed, reason, primary, primary_activity_n}}
   */
  checkFinalDecision(symbol, db) {
    const primary = this.getRequiredPair(symbol);
    if (!primary) return { allowed: true, reason: 'NO_PAIR_REQUIREMENT', primary: null };
    return this.isAllowed(symbol, db);
  },
};

module.exports = WhitelistPairGuard;
