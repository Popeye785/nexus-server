// modules/trade_intent.js
// Block Live/Paper-Parity [27.05.2026, Option C unterbrechungsfrei]:
// Formales TradeIntent-Schema-Modul.
//
// Christian-Direktive: "PAPER und LIVE verwenden denselben FinalDecisionRouter.
// PAPER/LIVE unterscheiden sich erst bei Fill-Ausführung."
//
// Modul-Status:
//   ANLEGEN ONLY — Integration in gateExecution()/Bots erfolgt im NACH-STAB-Block.
//   Bestehender Router-Code bleibt unverändert während Stab-Window.
//
// Verwendung (nach Stab-Ende):
//   const intent = TradeIntent.create({sourceBot, symbol, direction, selectedStrategy, mode});
//   FinalDecisionRouter.finalize(...) füllt finalDecision/vetoReason/etc.
//   ExecutionAdapter routet nach intent.mode (PAPER → _simulateFill, LIVE → _liveFill).

'use strict';

const VALID_SOURCE_BOTS = ['GRID','INFGRID','DCA','COMBO','EXECFLOW','DEMO','MANUAL','MULTIEX','MBT'];
const VALID_DIRECTIONS = ['BUY','SELL','HOLD'];
const VALID_STRATEGIES = ['GRID','DCA','TREND','MR','COMBO','SINGLE','UNIFIED'];
const VALID_MODES = ['PAPER','LIVE','DRY_LIVE'];
const VALID_FINAL_STATUS = ['ALLOWED','BLOCKED','ANALYSIS_ONLY','HOLD','PASSTHROUGH'];

const TradeIntent = {
  VALID_SOURCE_BOTS,
  VALID_DIRECTIONS,
  VALID_STRATEGIES,
  VALID_MODES,
  VALID_FINAL_STATUS,

  /**
   * Erzeugt einen leeren TradeIntent mit Pflicht-Identifikation.
   * Router-Output-Felder werden später durch FinalDecisionRouter befüllt.
   *
   * @param {Object} params
   *   sourceBot:        'GRID'|'INFGRID'|'DCA'|'COMBO'|'EXECFLOW'|'DEMO'|'MANUAL'|'MULTIEX'|'MBT'
   *   symbol:           e.g. 'BTCUSDT'
   *   direction:        'BUY'|'SELL'|'HOLD'
   *   selectedStrategy: 'GRID'|'DCA'|'TREND'|'MR'|'COMBO'|'SINGLE'|'UNIFIED'
   *   mode:             'PAPER'|'LIVE'|'DRY_LIVE'
   *   confidence:       0..1 optional
   *   size:             optional pre-execution
   *   price:            optional pre-execution
   * @returns {Object} TradeIntent (router-output Felder = null)
   */
  create(params = {}) {
    return {
      // ── Pflicht (Identifikation) ──
      sourceBot:        params.sourceBot        || null,
      symbol:           params.symbol           || null,
      direction:        params.direction        || 'HOLD',
      selectedStrategy: params.selectedStrategy || null,
      mode:             params.mode             || 'PAPER',
      // ── Pre-Execution Kontext ──
      rawSignal:        params.rawSignal || { direction: params.direction || 'HOLD', confidence: params.confidence || 0 },
      confidence:       (typeof params.confidence === 'number') ? params.confidence : 0,
      size:             (typeof params.size === 'number') ? params.size : null,
      price:            (typeof params.price === 'number') ? params.price : null,
      ts:               params.ts || Date.now(),
      // ── Router-Output (wird von FinalDecisionRouter.finalize() befüllt) ──
      finalDecision:    null,
      tradeAllowed:     null,
      vetoReason:       null,
      symbolConfig:     null,
      pairContext:      null,
      // ── Audit ──
      vetoTag:          null,
      logLine:          null,
    };
  },

  /**
   * Validiert TradeIntent-Struktur. Returnt {ok, errors}.
   * Pflicht-Felder: sourceBot, symbol, direction, selectedStrategy, mode
   * Enum-Felder: alle gegen Whitelists
   */
  validate(intent) {
    const errors = [];
    if (!intent || typeof intent !== 'object') return { ok:false, errors:['not_an_object'] };
    // Pflicht
    if (!intent.sourceBot) errors.push('missing_sourceBot');
    else if (!VALID_SOURCE_BOTS.includes(intent.sourceBot)) errors.push(`invalid_sourceBot:${intent.sourceBot}`);
    if (!intent.symbol) errors.push('missing_symbol');
    else if (typeof intent.symbol !== 'string') errors.push('symbol_not_string');
    if (!intent.direction) errors.push('missing_direction');
    else if (!VALID_DIRECTIONS.includes(intent.direction)) errors.push(`invalid_direction:${intent.direction}`);
    if (intent.selectedStrategy && !VALID_STRATEGIES.includes(intent.selectedStrategy)) {
      errors.push(`invalid_strategy:${intent.selectedStrategy}`);
    }
    if (!intent.mode) errors.push('missing_mode');
    else if (!VALID_MODES.includes(intent.mode)) errors.push(`invalid_mode:${intent.mode}`);
    // Router-Output (wenn gesetzt, dann valide)
    if (intent.finalDecision != null) {
      if (intent.finalDecision.status && !VALID_FINAL_STATUS.includes(intent.finalDecision.status)) {
        errors.push(`invalid_finalDecision_status:${intent.finalDecision.status}`);
      }
    }
    // Numerische Bereiche
    if (intent.confidence != null && (typeof intent.confidence !== 'number' || intent.confidence < 0 || intent.confidence > 1)) {
      errors.push(`invalid_confidence:${intent.confidence}`);
    }
    return { ok: errors.length === 0, errors };
  },

  /**
   * Vergleicht zwei Intents auf Parity (ignoriert mode-Feld + ts).
   * Christian-Hinweis E: "PAPER_INTENT == LIVE_INTENT (bis auf mode-Feld)"
   * @returns {{equal:boolean, diff:Object[]}} diff-Felder mit Mismatch
   */
  diffForParity(a, b, ignoreFields = ['mode','ts','logLine']) {
    const diff = [];
    const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of allKeys) {
      if (ignoreFields.includes(k)) continue;
      const aVal = a ? a[k] : undefined;
      const bVal = b ? b[k] : undefined;
      // Tiefe Gleichheit via JSON-stringify
      if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
        diff.push({ field: k, a: aVal, b: bVal });
      }
    }
    return { equal: diff.length === 0, diff };
  },

  /**
   * Snapshot für API/Audit.
   */
  snapshot() {
    return {
      schema_version: 1,
      valid_source_bots: VALID_SOURCE_BOTS,
      valid_directions: VALID_DIRECTIONS,
      valid_strategies: VALID_STRATEGIES,
      valid_modes: VALID_MODES,
      valid_final_status: VALID_FINAL_STATUS,
      generated_at: '2026-05-27',
    };
  },
};

module.exports = TradeIntent;
