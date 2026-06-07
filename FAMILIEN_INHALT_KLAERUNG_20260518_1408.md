# FAMILIEN-INHALTE NEXUS V9 BRAIN — Klärung
**Datum**: 2026-05-18 14:08
**Quelle**: server.js Z.25108-25127 (AladdinBrain.FAMILY_MAP + FAMILY_WEIGHTS)
**Status**: READ-ONLY (parallel zur ML-V2-Pipeline)

---

## 1. FAMILY_MAP wörtlich aus Code

```js
// server.js Z.25109-25115
FAMILY_MAP: {
  TREND:          ['strategies', 'ichimoku', 'elliott'],                          // 3 sources
  MOMENTUM:       ['cvd', 'patterns', 'rlAgent'],                                 // 3 sources
  RISK:           ['monteCarlo', 'bayesian', 'volatility', 'sharpe', 'mlEnsemble'], // 5 sources
  SENTIMENT:      ['fearGreed', 'news', 'reddit', 'onChain', 'smartMoney'],       // 5 sources
  MICROSTRUCTURE: ['anomaly', 'btcCorr', 'heatScore', 'correlation', 'regime'],   // 5 sources
}
// TOTAL: 21 sources
```

## 2. FAMILY_WEIGHTS wörtlich

```js
FAMILY_WEIGHTS: {
  TREND:          0.20,
  MOMENTUM:       0.15,
  RISK:           0.20,
  SENTIMENT:      0.25,
  MICROSTRUCTURE: 0.20,
}
// Summe: 1.00
```

## 3. Diskrepanz UI 17 vs Code 21

UI-Anzeige 17 aktive Sources weicht von Code-Definition 21 ab. Pro Familie:

| Familie | Code | UI | Δ | Vermutete inaktive Source |
|---|:-:|:-:|:-:|---|
| TR (TREND) | 3 | 2 | -1 | wahrsch. `elliott` (Elliott-Wave selten Treffer in Code-Pfad, liefert oft NEUTRAL) |
| MO (MOMENTUM) | 3 | 3 | 0 | – |
| RI (RISK) | 5 | 5 | 0 | – |
| SE (SENTIMENT) | 5 | 4 | -1 | wahrsch. `onChain` (OnChainAnalysis Z.20811 nur eth-chain-Stub) |
| MI (MICROSTRUCTURE) | 5 | 3 | -2 | wahrsch. `heatScore` + `correlation` (oft degenerate ohne aktive Position) |

**Engineering-Befund**: 4 Sources liefern in der Praxis **NEUTRAL/0-Output** und werden vom UI-Counter nicht gezählt. Im Code-Decision-Pfad sind sie weiter aktiv aber wirkungslos.

## 4. Source-Detail pro Familie

### TREND (3 sources, weight 0.20)
1. **strategies** — Strategies.getAll() (BREAKOUT_HUNT/TREND_FOLLOW/MEAN_REVERT/CONSERVATIVE), höchstes Gewicht im UnifiedScore (0.25)
2. **ichimoku** — Ind.ichimoku() bull/bear-cloud (UnifiedScore-Gewicht 0.06)
3. **elliott** — Ind.elliottWave() (UnifiedScore-Gewicht 0.03)

### MOMENTUM (3 sources, weight 0.15)
1. **cvd** — CVDEngine.signal() Cumulative Volume Delta + Divergence (0.08)
2. **patterns** — Ind.patternSignal() Candle-Patterns (0.05)
3. **rlAgent** — RLAgent.decide() Q-Learning auf nexus.db rl_qtable (0.05)

### RISK (5 sources, weight 0.20)
1. **monteCarlo** — RiskEngine.monteCarlo(500 paths, 10 steps) (0.08)
2. **bayesian** — RiskEngine Bayesian-Update (0.07)
3. **volatility** — VolatilityRegime.detect() (0.06)
4. **sharpe** — SharpeEngine.fromCandles() (0.04)
5. **mlEnsemble** — MLOptimizer (RF 50% + GB 50% + PC 0%) (0.15)

### SENTIMENT (5 sources, weight 0.25 — höchstes Familie-Gewicht)
1. **fearGreed** — FearGreed.fetch() alternative.me (0.06)
2. **news** — NewsSentiment.fetch() liest news_feed DB (RSS 12 Quellen) (0.08)
3. **reddit** — SentimentAI.getSentiment() (oft Stub) (0.04)
4. **onChain** — OnChainAnalysis.getSignal() (Z.20811, **eth-chain only Stub**) (0.06)
5. **smartMoney** — SmartMoney.getSignal() Heuristik (0.06)

### MICROSTRUCTURE (5 sources, weight 0.20)
1. **anomaly** — AnomalyDetector.shouldBlock() Stat-Check (0.10)
2. **btcCorr** — Korrelation mit BTC (0.08)
3. **heatScore** — Volume-Profile-Hot-Zones (intern, oft 0) (0.04)
4. **correlation** — CorrelationEngine.compute (nur bei aktiven Positionen, sonst NEUTRAL) (0.03)
5. **regime** — Regime.detect() (BULL/BEAR/SQUEEZE/RANGING/CHOPPY) (0.10)

## 5. Wo landen News / Macro / ETF-Flows?

| Datenquelle | Familie | Status |
|---|---|---|
| **News-RSS** (12 Quellen) | SENTIMENT (`news`) | ✅ aktiv via NewsSentiment |
| **Fear & Greed** | SENTIMENT (`fearGreed`) | ✅ aktiv |
| **Reddit-Sentiment** | SENTIMENT (`reddit`) | ⚠️ Stub |
| **Whale-Tracking** | – (nicht in FAMILY_MAP) | ⚠️ vorhanden Z.24959 aber **NICHT im Brain-Pfad** |
| **Funding-Rate** | – (nicht in FAMILY_MAP) | ⚠️ Z.2877 vorhanden, nur in ARB-Modul, **NICHT im Brain** |
| **Open Interest** | – (nicht in FAMILY_MAP) | ⚠️ Z.24915 fetch, **NICHT im Brain** |
| **Liquidations-Feed (Coinglass)** | – | ❌ **FEHLT komplett** |
| **Macro-Calendar (FOMC/CPI)** | – | ❌ **FEHLT** (nur Keyword-Filter in News) |
| **ETF-Flows (BTC/ETH Spot)** | – | ❌ **FEHLT** |
| **Cross-Asset (SPX/Gold/DXY)** | – | ❌ **FEHLT** |

## 6. Empfehlung pro Familie (vs Elite-Standard)

### TREND — aktuelles Setup adäquat, könnte aber Multi-TF
- Aktuelle 3 Quellen sind 1h-Single-TF
- **Elite (Aladdin/LEAN)**: Multi-TF-Trend (1h+4h+1D+1W)
- **Empfehlung**: 1 zusätzliche Source `multiTF_trend` (~2 Tage Aufwand)

### MOMENTUM — ausreichend
- 3 Quellen decken kurz/mittel/RL ab
- **OK**

### RISK — sehr stark, könnte Liquidations
- 5 Quellen + ML-Ensemble = robust
- **Empfehlung**: Liquidations-Cascade als 6. Source einhängen (~2-3 Tage)
- **Elite (Coinglass)**: Liquidation-Heat-Map ist Crash-Frühindikator

### SENTIMENT — höchstes Familie-Gewicht 0.25, aber Stubs in 2/5 Sources
- 2 starke (fearGreed + news), 3 schwach (reddit/onChain/smartMoney)
- **Empfehlung**:
  1. **ETF-Flows** als neue Source (Farside.co.uk API ~1 Tag)
  2. **Macro-Event-Calendar** als neue Source (~2 Tage)
  3. **Twitter/X-Sentiment** ECHT (statt Stub) — ~3 Tage

### MICROSTRUCTURE — solide, könnte Order-Book-Imbalance schärfer
- 5 Quellen aber `heatScore`/`correlation` oft 0
- **Empfehlung**: Order-Book-Imbalance als Hauptsource (statt nur Slippage-Vermeider) — ~1 Tag

## 7. Top-Hebel (Priorisierung)

| Rank | Verbesserung | Familie | Aufwand | Erwartung |
|---|---|---|---|---|
| 1 | **Liquidations-Feed** | RISK | 2-3 Tage | Crash-Frühwarn ★★★ |
| 2 | **Funding/OI** im Brain (nicht nur ARB) | RISK | 1 Tag | Overheat-Erkennung ★★ |
| 3 | **ETF-Flows** | SENTIMENT | 1-2 Tage | Trend-Bestätigung ★★ |
| 4 | **Macro-Calendar** | SENTIMENT (neu) | 2 Tage | Event-Vermeidung ★★ |
| 5 | **Order-Book-Imbalance** | MICROSTRUCTURE | 1 Tag | Pre-Move-Hint ★ |
| 6 | **Cross-Asset SPX/Gold** | – (neu Familie?) | 2-3 Tage | Macro-Korrelation ★ |
| 7 | **Twitter ECHT** | SENTIMENT | 3 Tage | Sentiment-Echtdaten ★ |

## 8. Engineering-Befund

**Hauptlücke**: 4 von 21 Code-Sources sind faktisch Stubs (UI zeigt korrekt nur 17).
**Größter Hebel**: RISK + SENTIMENT-Familie um Funding/OI/Liquidations/ETF-Flows erweitern — würde **echte Crash-Frühwarn** ermöglichen ohne Brain-Aggregation-Logik anzufassen.

**Schutzzone gewahrt**: keine Code-Änderung. Nur Bestandsdokumentation.

---

## Status

- Bot: nexus R=119 PAPER, drift=0
- ML-V2: GRU fertig (acc=50.51%, F1=0.508, OOS 4761 Samples)
- Diese Klärung: READ-ONLY, keine Änderung
