// modules/symbol_universe.js
// Block R A1 [27.05.2026]: zentrale Symbol-Wahrheit für Strategy-Router.
//
// Konsolidiert die Block-N-Befunde (7 parallele Listen) auf EINE Quelle:
// - TRADING_SYMBOLS: was tatsächlich getradet wird (ShadowCycle-Liste)
// - CLASSES: MEGA/MID/SMALL Zuordnung (Block N+Q)
// - COIN_CONFIG: per-Coin Strategy-Router-Daten (Block-O/Q-validiert)
//
// Migration: rückwärts-kompatibel. Bestehende Listen (CFG.AUTO_SYMBOLS,
// ShadowCycle.symbols, _altsHC) bleiben funktional. Neue Code-Pfade lesen
// von hier. Schrittweise Migration in Folge-Blöcken.
//
// Datenquellen-Verdichtung:
// - Block N Asset-Class-Weights (CLASSES)
// - Block Q MEGA-Per-Class-Disable (allowed_strategies)
// - Block Q SUI-Pair-Guard (requires_pair)
// - Block O Per-Symbol-Floor (floor)
// - Block N CUSUM-Threshold (cusum_threshold_mult, default 1.0)

'use strict';

// CANONICAL-20 [2026-06-05]: Trading-Universum gleich der historischen UI-/Scanner-20.
// Quelle: modules/news_classifier.js KNOWN_SYMBOLS (MATIC→POL dedupliziert).
// Match 1:1 zu Christians Hypothese (Spec 2026-06-05).
// Promotionen aus ANALYSIS_SYMBOLS: POL, DOT, LTC, UNI, ARB, OP, APT, SEI, ATOM (9).
// TONUSDT wird zu ANALYSIS_SYMBOLS umgeschoben (war nicht in alter KNOWN_SYMBOLS-20).
const TRADING_SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT',
  'NEARUSDT','SUIUSDT','XRPUSDT','ADAUSDT','LINKUSDT',
  'DOGEUSDT','AVAXUSDT',
  // Block-S A5 Re-Promotion 2026-06-05 (Canonical-20):
  'POLUSDT','DOTUSDT','LTCUSDT','UNIUSDT','ARBUSDT',
  'OPUSDT','APTUSDT','SEIUSDT','ATOMUSDT',
];

// Block S Abschnitt 5 [27.05.2026]: Analysis-Only-Universum.
// Canonical-20-Update [2026-06-05]: alle 9 vorherigen ANALYSIS-Coins zu TRADING promoted,
// TONUSDT verbleibt hier (war nicht in alter Canonical-20-Liste, kein HOLDOUT-Beweis).
const ANALYSIS_SYMBOLS = [
  'TONUSDT',
];

const CLASSES = {
  MEGA:  ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'],
  MID:   ['NEARUSDT','SUIUSDT','XRPUSDT','ADAUSDT','LINKUSDT',
          'POLUSDT','DOTUSDT','LTCUSDT','UNIUSDT','ARBUSDT','OPUSDT','ATOMUSDT'],
  SMALL: ['DOGEUSDT','AVAXUSDT','APTUSDT','SEIUSDT'],
};

// Per-Coin Strategy-Router-Konfig.
// Stand 27.05.2026 nach Block O+Q (HOLDOUT-validiert).
const COIN_CONFIG = {
  // ── MEGA (Anti-Trend-Edge bestätigt durch HOLDOUT, MR-Modul integriert für diese Klasse)
  'BTCUSDT': {
    class: 'MEGA',
    allowed_strategies: ['MR'],         // Block-P HOLDOUT: TREND verboten
    forbidden_strategies: ['TREND'],
    floor: 0.20,                        // global default
    risk_mode: 'STRICT',                // KillSwitch sensitive
    cusum_threshold_mult: 1.0,
    notes: 'Mega-Cap, MR-only via Block O Avellaneda-Sub-Source',
  },
  'ETHUSDT': {
    class: 'MEGA', allowed_strategies: ['MR'], forbidden_strategies: ['TREND'],
    floor: 0.20, risk_mode: 'STRICT', cusum_threshold_mult: 1.0,
    notes: 'Mega-Cap, MR-only',
  },
  'SOLUSDT': {
    class: 'MEGA', allowed_strategies: ['MR'], forbidden_strategies: ['TREND'],
    floor: 0.20, risk_mode: 'STRICT', cusum_threshold_mult: 1.0,
    notes: 'Mega-Cap, MR-only',
  },
  'BNBUSDT': {
    class: 'MEGA', allowed_strategies: ['MR','GRID'], forbidden_strategies: ['TREND'],
    floor: 0.20, risk_mode: 'STRICT', cusum_threshold_mult: 1.0,
    notes: 'Mega-Cap, MR-only + GRID (MED-1 Fix 2026-06-07: BUY_FILL fuer aktives Grid freigegeben, TREND bleibt forbidden)',
  },
  // ── MID Star-Performer (Block-P HOLDOUT robust)
  'NEARUSDT': {
    class: 'MID', allowed_strategies: ['TREND','GRID'], forbidden_strategies: [],
    floor: 0.10, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'Block-P Star: HOLDOUT-Sharpe robust trotz n_eff=79; GRID (MED-1 Fix 2026-06-07) fuer aktives Grid-BUY_FILL',
  },
  'SUIUSDT': {
    class: 'MID', allowed_strategies: ['TREND','GRID'], forbidden_strategies: [],
    floor: 0.10, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    requires_pair: 'NEARUSDT',          // Block Q A3 Pair-Guard
    notes: 'Whitelist-Floor 0.10 nur wenn NEAR aktiv (Block Q Pair-Guard); GRID (MED-1 Fix 2026-06-07), Pair-Guard bleibt vorgeschaltet',
  },
  // ── MID Übrige (validiert via MID-Class-0.10)
  'XRPUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'MID-Class default',
  },
  'ADAUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'MID-Class default',
  },
  'LINKUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'MID-Class default',
  },
  // ── SMALL (retail-driven, niedrige Liquidität)
  'DOGEUSDT': {
    class: 'SMALL', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.2,  // höhere Vol-Threshold
    notes: 'SMALL retail',
  },
  // CANONICAL-20 [2026-06-05]: TON aus TRADING zu ANALYSIS umgeschoben (war nicht in KNOWN_SYMBOLS-20).
  'TONUSDT': {
    class: 'ANALYSIS', allowed_strategies: [], forbidden_strategies: ['TREND','MR','GRID'],
    floor: 0.999, risk_mode: 'ANALYSIS_ONLY', cusum_threshold_mult: 1.0,
    analysis_only: true,
    notes: 'CANONICAL-20 [2026-06-05]: demoted to ANALYSIS — war nicht in alter KNOWN_SYMBOLS-20',
  },
  'AVAXUSDT': {
    class: 'SMALL', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.2,
    notes: 'SMALL retail',
  },
  // ── Canonical-20 Re-Promotionen [2026-06-05] (waren bis 2026-06-05 ANALYSIS_ONLY).
  //    Defensive Standards: TREND-only, floor 0.20, NORMAL. CUSUM-Multi pro Liquidität.
  //    KEINE HOLDOUT-Validierung — 30d-Beobachtungspflicht.
  'POLUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation (ex-MATIC migration)',
  },
  'DOTUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation',
  },
  'LTCUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation',
  },
  'UNIUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation',
  },
  'ARBUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation (L2)',
  },
  'OPUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation (L2)',
  },
  'APTUSDT': {
    class: 'SMALL', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.2,
    notes: 'promoted to Canonical-20 [2026-06-05], SMALL L1, requires 30d validation',
  },
  'SEIUSDT': {
    class: 'SMALL', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.2,
    notes: 'promoted to Canonical-20 [2026-06-05], SMALL L1, requires 30d validation',
  },
  'ATOMUSDT': {
    class: 'MID', allowed_strategies: ['TREND'], forbidden_strategies: [],
    floor: 0.20, risk_mode: 'NORMAL', cusum_threshold_mult: 1.0,
    notes: 'promoted to Canonical-20 [2026-06-05], requires 30d validation',
  },
};

// Default-Config für unbekannte Symbole (graceful)
const DEFAULT_CONFIG = {
  class: 'UNKNOWN',
  allowed_strategies: ['TREND'],
  forbidden_strategies: [],
  floor: 0.20,
  risk_mode: 'STRICT',  // unbekannt → konservativ
  cusum_threshold_mult: 1.0,
  notes: 'fallback default — Symbol nicht in Universe-Map',
};

// Analysis-Only-Coin-Config (genug Metadaten für Brain + UI, aber tradeable=false)
const ANALYSIS_CONFIG_DEFAULT = {
  class: 'ANALYSIS',
  allowed_strategies: [],
  forbidden_strategies: ['TREND','MR','GRID'],
  floor: 0.999,           // sperrt Trade-Routing hart
  risk_mode: 'ANALYSIS_ONLY',
  cusum_threshold_mult: 1.0,
  analysis_only: true,
};
for (const sym of ANALYSIS_SYMBOLS) {
  if (!COIN_CONFIG[sym]) {
    COIN_CONFIG[sym] = { ...ANALYSIS_CONFIG_DEFAULT, notes: 'Block S A5 [27.05.2026] analysis-only — Christian A+C combined' };
  }
}

const SymbolUniverse = {
  TRADING_SYMBOLS,
  ANALYSIS_SYMBOLS,
  CLASSES,
  COIN_CONFIG,
  DEFAULT_CONFIG,

  /**
   * Class-Lookup ('MEGA' | 'MID' | 'SMALL' | 'UNKNOWN').
   */
  getClass(symbol) {
    const cfg = COIN_CONFIG[symbol];
    return cfg ? cfg.class : 'UNKNOWN';
  },

  /**
   * Vollständige Coin-Config (deep-copy gegen Mutation).
   */
  getCoinConfig(symbol) {
    const cfg = COIN_CONFIG[symbol] || DEFAULT_CONFIG;
    return { ...cfg };
  },

  /**
   * Welche Strategien sind für Symbol erlaubt?
   */
  getAllowedStrategies(symbol) {
    return (COIN_CONFIG[symbol] || DEFAULT_CONFIG).allowed_strategies.slice();
  },

  /**
   * Welche Strategien sind verboten?
   */
  getForbiddenStrategies(symbol) {
    return (COIN_CONFIG[symbol] || DEFAULT_CONFIG).forbidden_strategies.slice();
  },

  /**
   * Per-Symbol Floor (Block O).
   */
  getFloor(symbol) {
    return (COIN_CONFIG[symbol] || DEFAULT_CONFIG).floor;
  },

  /**
   * Risk-Mode ('STRICT' | 'NORMAL').
   */
  getRiskMode(symbol) {
    return (COIN_CONFIG[symbol] || DEFAULT_CONFIG).risk_mode;
  },

  /**
   * Pair-Requirement (z.B. SUI → NEAR via Block Q).
   * Returns required-primary-symbol oder null.
   */
  requiresPair(symbol) {
    const cfg = COIN_CONFIG[symbol] || DEFAULT_CONFIG;
    return cfg.requires_pair || null;
  },

  /**
   * CUSUM-Threshold-Multiplier (1.0 default).
   * Höhere SMALL-Vol → 1.2× sensibler Threshold.
   */
  getCusumThresholdMult(symbol) {
    return (COIN_CONFIG[symbol] || DEFAULT_CONFIG).cusum_threshold_mult;
  },

  /**
   * Symbol bekannt im Universum?
   */
  isKnown(symbol) {
    return COIN_CONFIG[symbol] !== undefined;
  },

  /**
   * Block S A5: ist Symbol für echte Trades zugelassen?
   * TRADING_SYMBOLS = true · ANALYSIS_SYMBOLS = false · unknown = false.
   */
  isTradable(symbol) {
    if (ANALYSIS_SYMBOLS.includes(symbol)) return false;
    return TRADING_SYMBOLS.includes(symbol);
  },

  /**
   * Block S A5: ist Symbol analysis-only?
   */
  isAnalysisOnly(symbol) {
    return ANALYSIS_SYMBOLS.includes(symbol);
  },

  /**
   * Snapshot für API/Debug.
   */
  snapshot() {
    return {
      trading_symbols: TRADING_SYMBOLS,
      analysis_symbols: ANALYSIS_SYMBOLS,
      classes: CLASSES,
      coin_configs: COIN_CONFIG,
      total_symbols: TRADING_SYMBOLS.length,
      total_analysis_only: ANALYSIS_SYMBOLS.length,
      generated_at: '2026-05-27',
    };
  },
};

module.exports = SymbolUniverse;
