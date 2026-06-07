// modules/strategy_veto.js
// Block S Abschnitt 3 [27.05.2026]: allowed_strategies / forbidden_strategies enforcement.
// P1 [2026-06-03]: UNIFIED ist KEINE Strategy — UNIFIED ist signalSource des Brains.
//                  Echte Strategy-Begriffe: TREND, MR, GRID. Mapping siehe STYLE_TO_STRATEGY.
//                  UNIFIED beim Router → STRATEGY_INVALID (Etikettenschwindel-Schutz).
//
// Christian-Direktive: "Vor jedem Strategy-Routing:
//   - selectedStrategy muss in allowed_strategies(symbol) sein
//   - selectedStrategy darf nicht in forbidden_strategies(symbol) sein
//   Wenn nicht erlaubt: finalDecision = HOLD/BLOCKED, reason = STRATEGY_NOT_ALLOWED
//   Log: [STRATEGY_VETO] symbol strategy reason"
//
// Kanonische Strategy-Vokabular (SymbolUniverse):
//   TREND  → trendfolgend (EMA-Cross/MACD/uScore-Direction-Trade auf MID/SMALL)
//   MR     → Mean-Reversion (Avellaneda auf MEGA)
//   GRID   → GridBot (ranging Spot-Grid)
//
// Erlaubte echte Strategy-Begriffe vom Caller:
//   TREND, TREND_FOLLOW, BREAKOUT_HUNT      → 'TREND'
//   MR, MEAN_REVERT, MEAN_REVERSION         → 'MR'
//   GRID, GRID_SPOT, INFGRID                → 'GRID'
//   DCA                                     → 'TREND' (DCA ist TREND-Variante)
//   COMBO                                   → 'TREND'
//
// BotType (SINGLE, GRID, INFGRID, DCA, COMBO, MR) ≠ Strategy.
// Wenn BotType statt Strategy als selectedStrategy ankommt: defensiv mappen wenn möglich,
// sonst durchreichen + Veto-Logik prüft gegen allowed/forbidden.

'use strict';

let _SU = null;
try { _SU = require('./symbol_universe'); } catch {}

// P1: UNIFIED ist KEINE Strategy. Diese Werte werden bei normalize() abgelehnt.
const INVALID_STRATEGY_NAMES = new Set([
  'UNIFIED',          // signalSource ALADDIN/Brain — nicht Strategy
  'ALADDIN',          // signalSource — nicht Strategy
  'METABRAIN',        // signalSource — nicht Strategy
  'BRAIN',
  'CONSENSUS',
  'VOTER',
]);

const StrategyVeto = {
  INVALID_STRATEGY_NAMES,

  /**
   * Mapping: Bot-Type / Trade-Style → kanonische Strategy-Kategorie.
   * Wenn der Aufrufer einen DCABot startet, mappen wir DCA → TREND (DCA ist TREND-Variante).
   */
  STYLE_TO_STRATEGY: {
    // Echte Strategy-Klassen (kanonisch)
    TREND:          'TREND',
    TREND_FOLLOW:   'TREND',
    BREAKOUT_HUNT:  'TREND',
    MR:             'MR',
    MEAN_REVERT:    'MR',
    MEAN_REVERSION: 'MR',
    GRID:           'GRID',
    GRID_SPOT:      'GRID',
    INFGRID:        'GRID',
    // BotTypes mit semantischer Strategy-Variante
    DCA:            'TREND',   // DCA ist TREND-Variante (Pyramid-Buy)
    COMBO:          'TREND',
    // Direct-Order-Defaults (nicht im DemoEngine-Pfad)
    AUTONOMOUS:     'TREND',
  },

  /**
   * Normalize: alle Spielarten von Strategy-Strings auf SymbolUniverse-Vokabular.
   * P1: gibt explizit null+reason zurück wenn signalSource (UNIFIED/ALADDIN/etc.) als Strategy
   * ankommt — caller muss echte Strategy ableiten.
   */
  normalize(strategy) {
    if (!strategy) return null;
    const s = String(strategy).toUpperCase();
    // P1: signalSource ist KEINE Strategy
    if (INVALID_STRATEGY_NAMES.has(s)) return null;
    if (this.STYLE_TO_STRATEGY[s]) return this.STYLE_TO_STRATEGY[s];
    // Bot-Type-Präfixe wie 'DEMO_DCA_BTCUSDT' → DCA → TREND
    // Sortiere Schlüssel nach Länge (längste zuerst), damit z.B. TREND_FOLLOW vor TREND matched
    const keys = Object.keys(this.STYLE_TO_STRATEGY).sort((a,b) => b.length - a.length);
    for (const key of keys) {
      if (s.includes(key)) return this.STYLE_TO_STRATEGY[key];
    }
    return s;  // unbekannte Strategy durchreichen — Veto-Logik prüft sie
  },

  /**
   * @param {string} symbol
   * @param {string} strategy - bot-type oder strategy-string
   * @returns {{ok, reason, allowed, forbidden, normalized}}
   */
  validateStrategy(symbol, strategy) {
    if (!_SU) {
      return { ok: true, reason: 'SYMBOL_UNIVERSE_UNAVAILABLE', allowed: [], forbidden: [], normalized: strategy };
    }
    const cfg = _SU.getCoinConfig(symbol);
    const allowed = (cfg.allowed_strategies || []).slice();
    const forbidden = (cfg.forbidden_strategies || []).slice();
    const normalized = this.normalize(strategy);
    // P1: UNIFIED/ALADDIN als Strategy → STRATEGY_INVALID (Caller muss echte Strategy liefern)
    if (strategy && !normalized) {
      const sUp = String(strategy).toUpperCase();
      if (INVALID_STRATEGY_NAMES.has(sUp)) {
        return { ok: false, reason: 'STRATEGY_INVALID_SIGNAL_SOURCE', allowed, forbidden, normalized: null,
                 hint: `${sUp} is a signalSource, not a strategy. Caller must derive real strategy (TREND/MR/GRID).` };
      }
    }
    if (!normalized) {
      return { ok: true, reason: 'NO_STRATEGY_PROVIDED', allowed, forbidden, normalized };
    }
    if (forbidden.includes(normalized)) {
      return { ok: false, reason: 'STRATEGY_FORBIDDEN', allowed, forbidden, normalized };
    }
    if (allowed.length > 0 && !allowed.includes(normalized)) {
      return { ok: false, reason: 'STRATEGY_NOT_ALLOWED', allowed, forbidden, normalized };
    }
    return { ok: true, reason: 'OK', allowed, forbidden, normalized };
  },

  /**
   * Bequeme Boolean-Variante.
   */
  isAllowed(symbol, strategy) {
    return this.validateStrategy(symbol, strategy).ok;
  },

  /**
   * P1: Helper für DemoEngine/MetaBrain — ableiten welche echte Strategy für ein Symbol passt.
   * @returns {string|null}  'TREND' | 'MR' | 'GRID' | null (kein Trade)
   */
  deriveRealStrategyForSymbol(symbol) {
    if (!_SU) return null;
    const cfg = _SU.getCoinConfig(symbol);
    const allowed = cfg.allowed_strategies || [];
    if (allowed.length === 0) return null;
    // Nur eine erlaubte Strategy → die (z.B. MEGA → MR)
    if (allowed.length === 1) return allowed[0];
    // Mehrere erlaubt → TREND bevorzugen (UNIFIED-Direction passt am ehesten zu TREND)
    if (allowed.includes('TREND')) return 'TREND';
    return allowed[0];
  },
};

module.exports = StrategyVeto;
