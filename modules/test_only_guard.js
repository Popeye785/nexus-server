// modules/test_only_guard.js
// Block T+ [27.05.2026]: HARD TEST-ONLY GUARD.
//
// Christian-Direktive:
//   - Paper-Trading läuft weiter
//   - Brain/Router/Veto bleibt aktiv
//   - Echte Exchange-Orders (Bitget Spot+Futures) MÜSSEN technisch unmöglich sein,
//     auch wenn aus Versehen ein Mode/Flag falsch steht
//   - LIVE_FULL / LIVE_RESTRICTED Mode-Switches müssen blockiert werden
//   - Jeder Block-Versuch wird mit Tag [TEST_ONLY_BLOCK] geloggt
//
// Quelle der Wahrheit:
//   1. CFG.TEST_ONLY_MODE (in-memory, default = true)
//   2. bot_settings.test_only_mode (DB-Override falls vorhanden)
//   3. Wenn BEIDE explizit auf false → unguarded (verlangt explizite Christian-Aktion)
//   4. Default: true (anti-brick)
//
// Anti-Bloat: 1 Modul, 1 Validate-Function, 1 Block-Tag.

'use strict';

const TestOnlyGuard = {
  /**
   * @param {Object} CFG - global config
   * @param {Object} db - sqlite handle (optional)
   * @returns {boolean} true wenn TEST-ONLY-Mode aktiv (Live-Orders verboten)
   */
  isActive(CFG, db) {
    // CFG-Toggle hat Vorrang (in-memory, schnell)
    if (CFG && CFG.TEST_ONLY_MODE === false) {
      // Nur explizites false deaktiviert — alles andere = true
      // Aber DB-Override gewinnt wenn vorhanden
      if (db) {
        try {
          const row = db.prepare("SELECT value FROM bot_settings WHERE key='test_only_mode'").get();
          if (row && row.value === 'false') return false;
          if (row && row.value === 'true') return true;
        } catch (_) {}
      }
      return false;
    }
    return true; // Default + alle nicht-false-Fälle
  },

  /**
   * Validate-Funktion vor Live-Order. Returnt {ok:false,...} = block.
   * @param {Object} ctx { source, symbol, side, size, mode }
   * @returns {{ok:boolean, reason:string, ctx:Object}}
   */
  validateLiveOrder(CFG, db, ctx = {}) {
    if (!this.isActive(CFG, db)) return { ok: true, reason: 'TEST_ONLY_INACTIVE', ctx };
    return {
      ok: false,
      reason: 'TEST_ONLY_MODE_ACTIVE',
      ctx: {
        source: ctx.source || 'unknown',
        symbol: ctx.symbol || null,
        side: ctx.side || null,
        size: ctx.size || null,
        mode: ctx.mode || null,
        blockedAt: Date.now(),
      },
    };
  },

  /**
   * Validate-Funktion vor Live-Mode-Switch.
   * @param {string} targetMode - z.B. 'LIVE_FULL', 'LIVE_RESTRICTED'
   * @returns {{ok:boolean, reason:string}}
   */
  validateModeSwitch(CFG, db, targetMode) {
    const isLive = ['LIVE_FULL', 'LIVE_RESTRICTED'].includes(String(targetMode || '').toUpperCase());
    if (!isLive) return { ok: true, reason: 'NOT_LIVE_TARGET' };
    if (!this.isActive(CFG, db)) return { ok: true, reason: 'TEST_ONLY_INACTIVE' };
    return { ok: false, reason: 'TEST_ONLY_BLOCKS_LIVE_MODE' };
  },

  /**
   * Konstante Log-Tag für Konsumenten.
   */
  LOG_TAG: '[TEST_ONLY_BLOCK]',

  /**
   * Convenience: bereitet Block-Log-Line.
   */
  formatBlockLog(ctx) {
    const parts = [
      ctx.source ? `src=${ctx.source}` : null,
      ctx.symbol ? `sym=${ctx.symbol}` : null,
      ctx.side ? `side=${ctx.side}` : null,
      ctx.size != null ? `size=${ctx.size}` : null,
      ctx.mode ? `mode=${ctx.mode}` : null,
    ].filter(Boolean).join(' ');
    return `${this.LOG_TAG} live order blocked: ${parts}`;
  },

  /**
   * Snapshot für API.
   */
  snapshot(CFG, db) {
    let dbVal = null;
    if (db) {
      try {
        const row = db.prepare("SELECT value,updated_at FROM bot_settings WHERE key='test_only_mode'").get();
        if (row) { dbVal = row.value; }
      } catch (_) {}
    }
    return {
      active: this.isActive(CFG, db),
      cfg_value: CFG ? CFG.TEST_ONLY_MODE : null,
      db_value: dbVal,
      blocks: ['BITGET_SPOT_PLACE_ORDER', 'BITGET_FUTURES_PLACE_ORDER', 'BITGET_FUTURES_CLOSE_POSITION', 'EXEC_ADAPTER_LIVE_FILL', 'MODE_SWITCH_LIVE'],
    };
  },
};

module.exports = TestOnlyGuard;
