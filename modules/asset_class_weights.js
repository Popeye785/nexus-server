// modules/asset_class_weights.js
// Asset-Class-spezifische Family-Weights für AladdinBrain
// Quelle: Liu/Tsyvinski/Wu (2022) Common Risk Factors in Cryptocurrency, JF 77(2)
//         Citadel/Two-Sigma Industry-Standard Multi-Strategy-Approach
//
// Konzept: Mega-Caps (tiefes Order-Book, lineare Market-Impact) brauchen andere
// Brain-Konfiguration als Mid-Caps oder Small-Caps (non-linear Impact, retail-driven).
//
// Block-L-Befund: ALLE 5 Familien sind bei BTC/ETH/SOL/BNB negativ. Per-Class-Weights
// können nicht alleinig lösen — aber Family-Pivot mit RISK/MICRO-Dominanz reduziert
// Trend-Following-Anti-Edge auf Mega-Caps.

'use strict';

const AssetClassWeights = {
  // Klassen-Map (initial, später per Auto-Klassifikation möglich)
  CLASS_MAP: {
    // MEGA: höchste Liquidität, lineare Market-Impact, Mean-Reversion-tauglich
    'BTCUSDT': 'MEGA',
    'ETHUSDT': 'MEGA',
    'SOLUSDT': 'MEGA',
    'BNBUSDT': 'MEGA',
    // MID: mittlere Liquidität, Trend-Following + Pattern-driven
    'NEARUSDT': 'MID',
    'SUIUSDT': 'MID',
    'XRPUSDT': 'MID',
    'ADAUSDT': 'MID',
    'LINKUSDT': 'MID',
    // SMALL: low-liquidity, retail-sentiment-driven, volatile
    'DOGEUSDT': 'SMALL',
    'TONUSDT': 'SMALL',
    'AVAXUSDT': 'SMALL',
  },

  // Block Q A2 [27.05.2026]: MEGA-Per-Class deaktiviert via NULL-Marker.
  // Block-P-HOLDOUT-Befund: MEGA-Class konsequent OVERFIT (BTC-only Sharpe -93 in VAL, ETH -40).
  // KEINE Weight-Kombination macht Mega-Caps profitabel. Lösung muss MR-Integration sein, nicht Weights.
  // weightsFor() returnt jetzt FALLBACK (statische FAMILY_WEIGHTS aus AladdinBrain) für MEGA.
  // MID + SMALL bleiben aktiv (in Block-P validiert: MID-Class DSR=123 STRONG).
  WEIGHTS_BY_CLASS: {
    // MEGA: deaktiviert — Brain nutzt globale Weights als Fallback
    MEGA: null,
    // MID: TREND-dominant (aktuelle globale Defaults, NEAR/SUI funktioniert mit Trend-Following)
    MID: {
      TREND:          0.35,
      MOMENTUM:       0.05,
      RISK:           0.30,
      SENTIMENT:      0.05,
      MICROSTRUCTURE: 0.25,
    },
    // SMALL: TREND + SENTIMENT (retail-driven Trends, weniger Microstructure-Edge)
    SMALL: {
      TREND:          0.40,
      MOMENTUM:       0.10,
      RISK:           0.25,
      SENTIMENT:      0.15,
      MICROSTRUCTURE: 0.10,
    },
    // FALLBACK für unbekannte Coins = MID-Defaults
    UNKNOWN: {
      TREND:          0.35,
      MOMENTUM:       0.05,
      RISK:           0.30,
      SENTIMENT:      0.05,
      MICROSTRUCTURE: 0.25,
    },
  },

  /**
   * Klassen-Lookup für Symbol.
   */
  classOf(symbol) {
    return this.CLASS_MAP[symbol] || 'UNKNOWN';
  },

  /**
   * Family-Weights für Symbol (returns deep-copy zur Sicherheit gegen Mutation).
   * Block Q A2: returnt null wenn Klasse deaktiviert (z.B. MEGA seit HOLDOUT-Befund).
   * Caller (Brain._aggregate) muss bei null auf globale FAMILY_WEIGHTS zurückfallen.
   */
  weightsFor(symbol) {
    const cls = this.classOf(symbol);
    const w = this.WEIGHTS_BY_CLASS[cls];
    if (w === null || w === undefined) return null;
    return { ...w };
  },

  /**
   * Snapshot für API/Debug.
   */
  snapshot() {
    const dist = {};
    for (const [sym, cls] of Object.entries(this.CLASS_MAP)) {
      if (!dist[cls]) dist[cls] = [];
      dist[cls].push(sym);
    }
    return {
      classes: dist,
      weights_by_class: this.WEIGHTS_BY_CLASS,
      total_symbols: Object.keys(this.CLASS_MAP).length,
    };
  },

  /**
   * Validate Weight-Sum = 1.0 ± 0.001 für alle Klassen.
   */
  validate() {
    const issues = [];
    for (const [cls, weights] of Object.entries(this.WEIGHTS_BY_CLASS)) {
      // Block Q A2: null = bewusst deaktiviert (z.B. MEGA), kein Validation-Fehler
      if (weights === null || weights === undefined) continue;
      const sum = Object.values(weights).reduce((a,b) => a+b, 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        issues.push({ class: cls, sum, error: 'weights do not sum to 1.0' });
      }
    }
    return { ok: issues.length === 0, issues };
  },
};

module.exports = AssetClassWeights;
