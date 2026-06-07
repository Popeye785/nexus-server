// modules/final_decision_router.js
// Block S Abschnitt 2 [27.05.2026]: Zentraler Decision-Router.
// P1 [2026-06-03]: Operation-aware — Strategy-Veto blockt nur EXPOSURE-INCREASING-Operationen.
//                  Maintenance/Exit/Risk-Reduction laufen IMMER durch (Hard-Safeties bleiben aktiv).
//
// Christian-Direktive: "AladdinBrain darf nicht nur raw BUY/SELL/HOLD liefern.
// AladdinBrain muss pro Coin FINAL ROUTEN."
//
// Voter (AladdinBrain.decide) bleibt unverändert — liefert rawSignal.
// Dieser Router setzt SymbolUniverse-Regeln drüber:
//   - isTradable check (TRADING_SYMBOLS vs ANALYSIS_SYMBOLS)
//   - allowed_strategies / forbidden_strategies (via strategy_veto)
//   - requires_pair (via whitelist_pair_guard)
//   - per-Symbol Floor / Risk-Mode (via SymbolUniverse)
//
// P1-OPERATIONEN:
//   EXPOSURE-INCREASING (Strategy-Veto greift):
//     CREATE_NEW, ADD_POSITION, BUY_FILL, EXTENSION,
//     DCA_BUY, COMBO_DCA_BUY, EXECFLOW_CREATE, SINGLE_CREATE
//   MAINTENANCE/EXIT (Strategy-Veto bypass; Hard-Safeties bleiben):
//     TICK_MAINTENANCE, SELL_FILL, RANGE_CLOSE, DOWN_BREAK_CLOSE,
//     TP_EXIT, SL_EXIT, MANUAL_CLOSE, REDUCE_RISK, FLATTEN
//
// Returns:
//   {
//     symbol,
//     operation,
//     rawSignal: { direction, confidence },           // unverändert vom Brain
//     finalDecision: { direction, status },           // nach Veto-Logik
//     selectedStrategy: 'MR'|'TREND'|null,
//     vetoReason: 'STRATEGY_NOT_ALLOWED'|'PAIR_REQUIRED'|'ANALYSIS_ONLY'|'NOT_IN_TRADING_UNIVERSE'|null,
//     symbolConfig: { class, floor, risk_mode, allowed, forbidden, requires_pair },
//     pairContext: { required, satisfied } | null,
//     tradeAllowed: boolean,
//   }

'use strict';

let _SU = null;
let _PG = null;
let _SV = null;
try { _SU = require('./symbol_universe'); } catch {}
try { _PG = require('./whitelist_pair_guard'); } catch {}
try { _SV = require('./strategy_veto'); } catch {}

// P1: Operationen
const OPERATIONS_EXPOSURE_INCREASING = new Set([
  'CREATE_NEW', 'ADD_POSITION', 'BUY_FILL', 'EXTENSION',
  'DCA_BUY', 'COMBO_DCA_BUY', 'EXECFLOW_CREATE', 'SINGLE_CREATE',
]);
const OPERATIONS_MAINTENANCE = new Set([
  'TICK_MAINTENANCE', 'SELL_FILL', 'RANGE_CLOSE', 'DOWN_BREAK_CLOSE',
  'TP_EXIT', 'SL_EXIT', 'MANUAL_CLOSE', 'REDUCE_RISK', 'FLATTEN',
]);

function isExposureIncreasing(operation) {
  if (!operation) return true;  // Default: konservativ als CREATE behandeln
  return OPERATIONS_EXPOSURE_INCREASING.has(String(operation).toUpperCase());
}

function isMaintenance(operation) {
  if (!operation) return false;
  return OPERATIONS_MAINTENANCE.has(String(operation).toUpperCase());
}

const FinalDecisionRouter = {
  OPERATIONS_EXPOSURE_INCREASING,
  OPERATIONS_MAINTENANCE,
  isExposureIncreasing,
  isMaintenance,

  /**
   * @param {Object} brainResult - { decision, confidence, ... } vom AladdinBrain.decide
   * @param {string} symbol
   * @param {Object} opts { db, selectedStrategy, operation }
   *   selectedStrategy: optional - wenn bereits gewählt (MR/TREND/HOLD), wird gegen allowed-list geprüft
   *   operation: P1 — 'CREATE_NEW' (default), 'TICK_MAINTENANCE', 'SELL_FILL', 'RANGE_CLOSE' etc.
   *              Bei Maintenance/Exit wird Strategy-/Pair-/Analysis-Veto übersprungen.
   * @returns finalDecision-object
   */
  finalize(brainResult, symbol, opts = {}) {
    const db = opts.db || null;
    const proposedStrategy = opts.selectedStrategy || null;
    const operation = (opts.operation || 'CREATE_NEW').toUpperCase();
    const exposureInc = isExposureIncreasing(operation);

    const rawDir = (brainResult && brainResult.decision) || 'HOLD';
    const rawConf = (brainResult && typeof brainResult.confidence === 'number')
      ? brainResult.confidence : 0;
    const raw = { direction: rawDir, confidence: rawConf };

    // Defaults wenn SymbolUniverse nicht geladen (graceful)
    if (!_SU) {
      return this._passthrough(symbol, raw, proposedStrategy, operation, 'SYMBOL_UNIVERSE_UNAVAILABLE');
    }

    const cfg = _SU.getCoinConfig(symbol);
    const symbolConfig = {
      class: cfg.class,
      floor: cfg.floor,
      risk_mode: cfg.risk_mode,
      allowed: cfg.allowed_strategies || [],
      forbidden: cfg.forbidden_strategies || [],
      requires_pair: cfg.requires_pair || null,
      notes: cfg.notes || null,
    };

    // ── HARD-SAFETY-LADDER (gilt IMMER, auch bei Maintenance) ──
    // 1) NOT_IN_TRADING_UNIVERSE → unbekanntes Symbol, hart blockieren
    //    (Maintenance auf unbekanntem Symbol macht keinen Sinn — Symbol existiert nicht im Universum)
    if (typeof _SU.isTradable === 'function' && !_SU.isTradable(symbol)
        && (typeof _SU.isAnalysisOnly !== 'function' || !_SU.isAnalysisOnly(symbol))) {
      return this._veto(symbol, raw, proposedStrategy, operation, symbolConfig, null,
        'NOT_IN_TRADING_UNIVERSE', 'BLOCKED');
    }

    // ── P1: ANALYSIS-ONLY → nur bei EXPOSURE-INCREASING blocken ──
    //   Maintenance/Exit auf einem nachträglich analysis-only-gestellten Symbol muss laufen,
    //   damit alte offene Positionen schließen können.
    if (exposureInc && typeof _SU.isAnalysisOnly === 'function' && _SU.isAnalysisOnly(symbol)) {
      return this._veto(symbol, raw, proposedStrategy, operation, symbolConfig, null,
        'ANALYSIS_ONLY', 'ANALYSIS_ONLY');
    }

    // 2) HOLD vom Brain → pass-through (kein Veto-Bedarf)
    if (rawDir === 'HOLD') {
      return {
        symbol,
        operation,
        rawSignal: raw,
        finalDecision: { direction: 'HOLD', status: 'HOLD' },
        selectedStrategy: null,
        vetoReason: null,
        symbolConfig,
        pairContext: null,
        tradeAllowed: false,
      };
    }

    // ── P1: Pair-Guard nur bei EXPOSURE-INCREASING ──
    //   Maintenance/Exit eines bestehenden Bots auf Pair-required-Symbol darf laufen,
    //   auch wenn der Primary inzwischen inaktiv ist.
    let pairContext = null;
    if (exposureInc && symbolConfig.requires_pair) {
      pairContext = { required: symbolConfig.requires_pair, satisfied: null };
      if (_PG && typeof _PG.isAllowed === 'function') {
        const guard = _PG.isAllowed(symbol, db);
        pairContext.satisfied = !!guard.allowed;
        pairContext.guard_reason = guard.reason;
        pairContext.primary_activity_n = guard.primary_activity_n || 0;
        if (!guard.allowed) {
          return this._veto(symbol, raw, proposedStrategy, operation, symbolConfig, pairContext,
            'PAIR_REQUIRED', 'BLOCKED');
        }
      }
    }

    // ── P1: Strategy-Veto nur bei EXPOSURE-INCREASING ──
    //   Maintenance/Exit darf NIE durch Strategy-Veto blockiert werden.
    if (exposureInc && proposedStrategy && _SV && typeof _SV.validateStrategy === 'function') {
      const v = _SV.validateStrategy(symbol, proposedStrategy);
      if (!v.ok) {
        return this._veto(symbol, raw, proposedStrategy, operation, symbolConfig, pairContext,
          v.reason, 'BLOCKED');
      }
    }

    // 5) Alles grün → finalDecision = rawSignal
    return {
      symbol,
      operation,
      rawSignal: raw,
      finalDecision: { direction: rawDir, status: 'ALLOWED' },
      selectedStrategy: proposedStrategy,
      vetoReason: null,
      symbolConfig,
      pairContext,
      tradeAllowed: true,
    };
  },

  _passthrough(symbol, raw, strategy, operation, reason) {
    return {
      symbol,
      operation: operation || 'CREATE_NEW',
      rawSignal: raw,
      finalDecision: { direction: raw.direction, status: 'PASSTHROUGH' },
      selectedStrategy: strategy,
      vetoReason: reason,
      symbolConfig: null,
      pairContext: null,
      tradeAllowed: false,
    };
  },

  _veto(symbol, raw, strategy, operation, symbolConfig, pairContext, reason, status) {
    return {
      symbol,
      operation: operation || 'CREATE_NEW',
      rawSignal: raw,
      finalDecision: { direction: 'HOLD', status },
      selectedStrategy: strategy,
      vetoReason: reason,
      symbolConfig,
      pairContext,
      tradeAllowed: false,
    };
  },

  /**
   * Convenience: format Log-Tag für Konsumenten.
   */
  vetoTag(result) {
    if (!result || !result.vetoReason) return null;
    if (result.vetoReason === 'PAIR_REQUIRED') return '[PAIR_VETO]';
    if (result.vetoReason === 'ANALYSIS_ONLY') return '[ANALYSIS_ONLY]';
    if (result.vetoReason === 'NOT_IN_TRADING_UNIVERSE') return '[UNIVERSE_VETO]';
    if (String(result.vetoReason).startsWith('STRATEGY_')) return '[STRATEGY_VETO]';
    return '[FINAL_VETO]';
  },

  /**
   * Block Router-Coverage [27.05.2026]: Zentraler Execution-Gate für ALLE Bot-Pfade.
   * Ersetzt verstreute Router-Hooks durch einheitlichen Aufruf.
   * P1 [2026-06-03]: operation-Parameter — Maintenance/Exit bypass Strategy-Veto.
   *
   * Christian-Direktive: "Vor jeder Order muss laufen: FinalDecisionRouter.finalize(...)"
   * Log-Format einheitlich: [FINAL_VETO] sourceBot=X symbol=Y strategy=Z op=O reason=R
   *
   * @param {Object} ctx
   *   sourceBot:        'GRID'|'INFGRID'|'DCA'|'COMBO'|'EXECFLOW'|'DEMO'|'MANUAL'|...
   *   symbol:           e.g. 'BTCUSDT'
   *   direction:        'BUY'|'SELL'|'HOLD' (rawSignal)
   *   confidence:       0..1 optional
   *   selectedStrategy: 'GRID'|'DCA'|'TREND'|'MR'|... (kanonisch)
   *   operation:        P1 — siehe OPERATIONS_*-Sets oben. Default 'CREATE_NEW'.
   *   db:               sqlite-handle
   * @returns {{ok, vetoReason, logLine, router}}
   */
  gateExecution(ctx = {}) {
    const sourceBot = ctx.sourceBot || 'UNKNOWN';
    const symbol = ctx.symbol || '';
    const direction = ctx.direction || 'HOLD';
    const confidence = (typeof ctx.confidence === 'number') ? ctx.confidence : 0;
    const strategy = ctx.selectedStrategy || ctx.strategy || null;
    const operation = (ctx.operation || 'CREATE_NEW').toUpperCase();
    const db = ctx.db || null;

    const result = this.finalize(
      { decision: direction, confidence },
      symbol,
      { db, selectedStrategy: strategy, operation }
    );

    const logLine = result.tradeAllowed
      ? null
      : `[FINAL_VETO] sourceBot=${sourceBot} symbol=${symbol} strategy=${strategy||'-'} op=${operation} reason=${result.vetoReason||'?'}`;

    return {
      ok: !!result.tradeAllowed,
      vetoReason: result.vetoReason,
      logLine,
      router: result,
    };
  },
};

module.exports = FinalDecisionRouter;
