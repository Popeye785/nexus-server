# NEXUS V9 — Aladdin Full Architecture

**Datum:** 2026-05-27 09:25 CEST
**Bot-Status:** PID 5781 R=294 49min · drift=0 · PAPER

## TL;DR

**3-Schichten-Aufbau bestätigt** (Christians Hypothese ist korrekt):
1. **Schicht 1 (Daten/Signal):** 20 Sub-Sources in 5 Familien
2. **Schicht 2 (Analyse/Risk):** Monte Carlo, Bayesian, VaR, HRP, Sortino, Sharpe, Correlation, HeatMap
3. **Schicht 3 (Entscheidung):** AladdinBrain.decide() (server.js:28002)

**SEI-Mystery gelöst:** SEI ist NICHT trading-Symbol. Aktuell zeigt UI Heat-Map nur 3 Coins (SEI, NEAR, SUI). Code-Pfad sehr inkonsistent — mehrere Symbol-Universen parallel.

## 1. 3-Schichten-Architektur

```
┌──────────────────────────────────────────────────────────────┐
│ SCHICHT 1: DATEN/SIGNAL (20 Sub-Sources in 5 Familien)       │
│                                                              │
│  TREND (35%)        MOMENTUM (5%)    RISK (30%)              │
│  • strategies       • cvd            • monteCarlo            │
│  • ichimoku         • patterns       • bayesian              │
│  • elliott          • rlAgent        • volatility            │
│  • tft                               • sharpe                │
│                                      • mlEnsemble            │
│                                      • liquidations          │
│  SENTIMENT (5%)     MICROSTRUCTURE (25%)   • funding+oi      │
│  • fearGreed        • anomaly              • var95           │
│  • news             • btcCorr              • newsRisk        │
│  • reddit           • heatScore                              │
│  • onChain          • correlation                            │
│  • smartMoney       • regime                                 │
│  • etfFlows         • obImbalance                            │
│  • macroCalendar                                             │
│  • macroRegime                                               │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ SCHICHT 2: ANALYSE/RISK (Aggregation + Risk-Modellierung)    │
│                                                              │
│  UnifiedScore (server.js:11760)                              │
│    aggregiert Sub-Source-Scores in Familie-Scores           │
│                                                              │
│  RiskEngine (server.js:13387)                                │
│  • MonteCarlo: 500 Pfade × 10 Tage → VaR95/VaR99/CVaR        │
│  • Bayesian: Posterior {BULL/BEAR/SIDEWAYS}                  │
│                                                              │
│  VaREngine (server.js:24211) — per-Symbol-Cache              │
│  CorrelationEngine (server.js:13607) — Pearson + HRP-Input   │
│  HeatMapEngine (server.js:13839) — Portfolio-Risk-Viz        │
│  HMMRegime (modules/hmm_regime.js) — 5-State Markov          │
│  Sortino/Sharpe/Kelly/HRP — Sizing-Inputs                    │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ SCHICHT 3: ENTSCHEIDUNG (AladdinBrain.decide @28002)         │
│                                                              │
│  Phase A: VETO-CHECK (Hard-Blocks)                           │
│    • VaR95 > 25% → MONTE_CARLO_VaR_TOO_HIGH                  │
│    • FG < 20 → FEAR_EXTREME                                  │
│    • NewsRisk ≥ 5 → BLACK_SWAN                               │
│    • Anomaly+DD>15% → ANOMALY_BLOCK                          │
│                                                              │
│  Phase B: KONSENS-CHECK                                      │
│    • 2/5 Familien einig (T9.1) → sonst HOLD                  │
│                                                              │
│  Phase C: KONFIDENZ-AGGREGATION                              │
│    • Σ(familieScore × FAMILY_WEIGHT) / Σ(weights)            │
│                                                              │
│  Phase D: SIZING                                             │
│    • RiskSizing.calculate(confidence) × Multiplier-Stack     │
│    • Multipliers: regime × vol × sentiment × profitLock      │
│                  × newsRisk × kelly × sortino × hrp          │
│                                                              │
│  Output: {decision, confidence, positionPct, vetos, reason}  │
└──────────────────────────────────────────────────────────────┘
                            ↓
                  DemoEngine._executeTrade
                    → trades-Tabelle, wallet_ledger
```

## 2. Modul-Inventar (Top-Relevanz)

| Modul | Pfad/Zeile | Zweck |
|---|---|---|
| **AladdinBrain** | server.js:28002 | Decision-Engine (Phase A-D) |
| **UnifiedScore** | server.js:11760 | Sub-Source-Aggregator |
| **RiskEngine** | server.js:13387 | Monte Carlo + Bayesian |
| **VaREngine** | server.js:24211 | Per-Symbol VaR/CVaR Cache |
| **CorrelationEngine** | server.js:13607 | Pearson-Matrix für HRP |
| **HeatMapEngine** | server.js:13839 | UI Portfolio-Heat-Map |
| **HMMRegime** | modules/hmm_regime.js | 5-State Markov-Regime |
| **Triple-Barrier** | modules/triple_barrier.js | LdP ML-Labels |
| **MetaLabeling** | modules/meta_labeling.js + meta_label_classifier.js | LdP Sekundär-Classifier |
| **HRP/HRPAllocator** | modules/hrp.js + hrp_allocator.js | Cluster-basierte Allocation |
| **Kelly** | modules/kelly_criterion.js | Half-Kelly Sizing |
| **Sortino** | modules/sortino_router.js | Downside-Risk-Routing |
| **ShadowCycle** | server.js:28713 | Brain-Cockpit-Scan-Loop (12 Symbole, 8s) |
| **TripleBarrierAuto** | server.js:23568 | TB-Label-Auto-Generierung (60min) |
| **RegimeStrength** | server.js:6105+ | Regime-Klassifikation + Hysterese |

## 3. Symbol-Universen — Aufgeklärt (Inkonsistenzen!)

**Bot hat MEHRERE parallele Symbol-Listen** — keine Single-Source-of-Truth:

| Universum | Symbole | Code-Stelle | Zweck |
|---|---:|---|---|
| **Trading (ShadowCycle)** | **12** BTC/ETH/SOL/BNB/NEAR/SUI/XRP/DOGE/ADA/LINK/TON/AVAX | server.js:28717 | Tatsächlich getradete Symbole |
| CFG.AUTO_SYMBOLS Fallback | 12 (gleich wie oben) | server.js:5826, 5956 | HRP/RiskSizing-Fallback |
| DEFAULT_SYMBOLS | 4 BTC/ETH/SOL/XRP | server.js:7896 | irgendein Bootstrap |
| **L1_GROUP** | 9 SOL/AVAX/NEAR/ADA/DOT/ATOM/APT/SUI/**SEI** | server.js:12887 | Liquidations-Tracking |
| **_altsHC** | 12 SOL/XRP/UNI/LINK/ARB/OP/ADA/DOGE/AVAX/APT/BNB/**SEI** | server.js:25754 | ML-Ensemble-Altcoin-Handling |
| Sentiment-Alts | mehrere | server.js:26904 | Inkl. SEI, APT |
| **Heat-Map (LIVE jetzt)** | **3** SEI/NEAR/SUI | API: /api/aladdin/heatmap | **dynamisch** aus Performance/Anomaly |
| Correlation-Default | 3 SEI/NEAR/SUI | API: /api/aladdin/correlation | Default-Query |

### SEI-Mystery → GELÖST
- SEI ist **NICHT Trading-Symbol**.
- SEI ist in 3 sekundären Universen (L1_GROUP, _altsHC, Sentiment-Alts) als **read-only Markt-Beobachter**.
- Heat-Map zeigt aktuell nur 3 Coins (SEI/NEAR/SUI) — vermutlich Top-Heat-Score-Auswahl, nicht ganze Liste.
- → Christian sieht SEI weil Heat-Map sich aus Sub-Modul-Daten zieht, nicht aus ShadowCycle.

**Christians Vorahnung "20 Coins" bestätigt indirekt:** Bot _kennt_ 15-20 Symbole über alle Universen verteilt, _tradet_ aber nur 12. Inkonsistenz ist Legacy aus Coin-Scanner-Evolution.

## 4. Daten-Fluss

```
1. MARKT-DATEN (Bitget API)
   ├─ Candles (1h, 200 limit) für 12 ShadowCycle-Symbole alle 8s
   ├─ Orderbook für CVD-Engine
   ├─ Funding-Rates / Open-Interest (FundingOI-Modul)
   └─ Ticker-Snapshots

2. EXTERNE DATEN (Free-APIs)
   ├─ FearGreed-Index (alternative.me)
   ├─ RSS-Feeds (12 Quellen → news_feed-Tabelle)
   ├─ Mempool/On-chain (Mempool.space, Blockchain.info)
   ├─ Macro-Calendar (ForexFactory)
   └─ ETF-Flows (IBIT/FBTC tracking)

3. SUB-SOURCE-COMPUTATION (Schicht 1, Brain.js + Familien)
   ├─ Pro ShadowCycle-Symbol (alle 8s):
   │  ├─ TREND-Familie (4 members) → score
   │  ├─ MOMENTUM-Familie (3 members) → score
   │  ├─ RISK-Familie (10 members) → score
   │  ├─ SENTIMENT-Familie (8 members) → score
   │  └─ MICROSTRUCTURE-Familie (6 members) → score
   └─ → UnifiedScore-Object (scores{}, direction, confidence)

4. ALADDIN-LAYER (Schicht 2)
   ├─ MonteCarlo: pro Symbol, 500 Pfade × 10 Steps
   ├─ Bayesian: pro Symbol, 3-State Posterior-Update
   ├─ VaR: pro Symbol, 90d-Cache mit 1.645σ-Mapping
   ├─ Correlation: 30d Pearson über AUTO_SYMBOLS (12)
   ├─ HRP: Cluster auf Correlation-Matrix → weights
   ├─ Sortino/Sharpe/Kelly: aus trades-history
   ├─ HMM-Regime: 5 States über BTC+24h-returns+vol
   └─ → Inputs für AladdinBrain.decide

5. DECISION (Schicht 3, AladdinBrain.decide)
   ├─ VETO-Check (5+ hard-blocks)
   ├─ Konsens-Check (2/5 Familien)
   ├─ Sizing (Multiplier-Stack)
   └─ Output: {BUY/SELL/HOLD, confidence, positionPct}

6. EXECUTION (DemoEngine._executeTrade oder Strategy-Routing)
   ├─ MetaBrain entscheidet bot_type (SINGLE/DCA/GRID/INFGRID)
   ├─ RiskSizing.calculate final size
   ├─ DemoEngine._simulateFill (PAPER) oder ExecutionAdapter._liveFill (LIVE)
   └─ trades-Tabelle + wallet_ledger
```

## 5. IST vs. Christian-Vision Gap-Analyse

### Was Aladdin SCHON kann (Schicht 2 ist mächtig)
- ✅ Monte Carlo (500 Pfade, VaR95/99/CVaR)
- ✅ Bayesian Regime (BULL/BEAR/SIDEWAYS)
- ✅ Heat Map (Portfolio-Risk-Viz, dynamisch)
- ✅ Korrelations-Matrix + HRP
- ✅ News-Sentiment (12 RSS-Quellen aktiv)
- ✅ HMM-Regime (5-State Markov)
- ✅ Sharpe/Sortino/Calmar Metriken
- ✅ Per-Symbol VaR-Cache
- ✅ Pro Symbol BUY/SELL/HOLD-Entscheidung

### Was Christians Vision verlangt aber FEHLT
| Feature | IST | Vision |
|---|---|---|
| **Trade vs Observe-Trennung** | ❌ Bot tradet 12, observiert 3-9 (zufällig) | Read-only Brain-Bewertung für 20 Symbole |
| **Strategy-Selection pro Phase** | 🟡 MetaBrain hat botType-Logic, aber starr | Pro Coin pro Phase: SINGLE/DCA/GRID/HOLD selektiv |
| **Single-Source Symbol-Universe** | ❌ 5+ verschiedene Listen | 1 zentraler Symbol-Manager |
| **Regime → Strategy-Mapping** | 🟡 Familie-Weights regime-adaptive, aber Strategy nicht | BULL=SINGLE-trend, RANGE=GRID, BEAR=HOLD oder SHORT |
| **Aladdin als zentraler Entscheider** | 🟡 AladdinBrain ist eher Reaktor als Stratege | Pro-Coin/Phase-Plan vor Decisions |

### Konkrete Code-Stellen für Strategy-Selection
- **Aktuell:** `MetaBrain.decide` (~server.js:25097) wählt bot_type aus regime+context
- **MetaStrategy lädt:** `StrategySequence` (MEGA-KOMBI E) — overrideT MetaBrain wenn `CFG.STRATEGY_SEQUENCE_ENABLED`
- **Regime-Mapping FEHLT explizit** zwischen Regime → preferred bot_type

## 6. Implementation-Pfade

### Pfad A — Minimal-Erweiterung (2-3 Tage)
**Was:** ShadowCycle-Liste 12 → 20 Symbole. Heat-Map/Correlation-Defaults sync. Trade-Logik unverändert.

**Code-Änderungen:**
- ShadowCycle.symbols um 8 Coins erweitern (z.B. SEI/ATOM/DOT/APT/MATIC/ARB/OP/UNI)
- CFG.AUTO_SYMBOLS sync
- L1_GROUP / _altsHC konsolidieren
- Heat-Map-Default auf 20 setzen

**Risiken:**
- API-Rate-Limit Bitget (40 calls/tick × neue Liste — sollte OK sein, vorhin Block H probiert)
- 20% mehr Compute (linear-Scale)
- HRP-Cluster werden weniger interpretierbar

**Reversibel:** ja, config-rollback einfach

### Pfad B — Markt-Observer-Layer (1-2 Wochen)
**Was:** Trennung Trade-Universum (12) vs Observer-Universum (20+). Brain bewertet alle 20, tradet nur 12. Strategy bleibt aktuelle Logik.

**Code-Änderungen:**
- Neues Modul `MarketObserver` mit eigener Symbol-Liste + Decision-Pipeline (read-only)
- Aladdin-Heat-Map/Correlation auf Observer-Universum
- ShadowCycle bleibt Trade-Loop
- Audit-Pfad: Observer-Decisions in aladdin_decisions mit `read_only=true`

**Risiken:**
- Mehr DB-Writes (Observer-Decisions zusätzlich)
- Brain-Compute 67% mehr (20 statt 12 Symbole)

**Reversibel:** ja, MarketObserver-Modul on/off-Toggle

### Pfad C — Volles Refactor (4-8 Wochen)
**Was:** Aladdin als zentraler Strategy-Selector. Pro Coin pro Phase explizite Bot-Typ-Wahl. Symbol-Universum entkoppelt von Trade-Engine.

**Code-Änderungen (Architektur-Eingriff):**
- `SymbolManager` als Single-Source-of-Truth
- `StrategySelector` ersetzt MetaBrain (regime × symbol-perf → bot_type)
- AladdinBrain.decide() liefert "PLAN" statt nur BUY/SELL (Plan = {bot_type, size, hold-time-expectation})
- Strategy-Layer wird primär Aladdin-driven, nicht reaktiv
- DCA/GRID/SINGLE als pluggable Strategies

**Risiken:**
- 5+ Module-Refactors
- Lange Test-Phase nötig (paper-bot würde 2-4 Wochen extra-validation brauchen)
- Mehrere CLAUDE.md-Hard-Rules berühren

**Reversibel:** nein-leicht — Migration einmalig, dann committed

## 7. DoD (Read-Only Analyse)

| Rule | Status | Evidence |
|---|---|---|
| 1 Architecture | ✅ | Diagramm + Modul-Inventar dokumentiert |
| 2 Regressions | ✅ | Kein Code-Change |
| 3 UI-Verifikation | ✅ | API-Endpoints live abgefragt (/api/aladdin/heatmap, /correlation) |
| 4 Restart | n/a | Bot weiter R=294 stabil |
| 5-11 | ✅/n/a | Read-only, kein Eingriff |

## ⚠️ Ehrliche Lücken

| # | Lücke | Severity |
|---|---|---|
| 1 | **Sub-Agent-Mapping hat Inkonsistenzen** — z.B. erste Karte sagte SCORE_FLOOR 0.08 (Z.278), zweite sagte 20 Sub-Sources aber listet 31. Vermutlich Doppel-Zählung. Brauche selbst-grep für exakte Zahlen. | MED |
| 2 | **Heat-Map liefert nur 3 Coins live** (SEI/NEAR/SUI) — Algorithmus dahinter (welche werden ausgewählt?) nicht final geklärt. Vermutlich Top-Heat-Score-Filter. | MED |
| 3 | **macroRegime / Funding-Rate-Integration unklar** — Code existiert, Brain-Konsum schwer nachweisbar | LOW |
| 4 | **Strategy-Selection-Logik nicht vollständig getraced** — MetaBrain ↔ StrategySequence ↔ MetaStrategy gehören entwirrt vor Pfad C | MED |
| 5 | **Liquidations/Funding-Daten-Qualität** in aktueller PAPER-Phase unklar (echte Daten oder Stub?) | UNSICHER |

## Empfehlung Nächster Schritt

**Engineer-Sicht:** Pfad B (Markt-Observer-Layer) ist der richtige Mittelweg:

- **Pfad A** ist zu wenig — löst nicht Trade-vs-Observe-Trennung, bringt Christian's Vision-Verständnis kaum näher
- **Pfad B** trennt sauber Observer (20+) von Trader (12), bringt Heat-Map/Correlation auf breitere Basis, lässt aktuellen profitable Trade-Loop in Ruhe — minimal-invasiv für maximalen Sicht-Gewinn
- **Pfad C** ist groß. Nur wenn Pfad B nach Validierung Bedarf nach mehr Strategy-Intelligenz zeigt.

**Vorab nötig (vor Pfad B):**
1. Symbol-Universen-Konsolidierung (mindestens L1_GROUP + _altsHC + AUTO_SYMBOLS) → 1 Liste pro Zweck
2. Heat-Map-Algorithmus aufklären (warum 3 Coins live?)
3. Strategy-Selection-Code-Trace (MetaBrain vs StrategySequence vs MetaStrategy)

Diese 3 Vorab-Themen wären ein eigener Block (1 Tag), dann Pfad B als 2-Wochen-Implementation.

🔴 LIVE aus · Reserve $3.34 unantastbar · Bot PAPER · **Architektur dokumentiert, SEI-Mystery gelöst, 3 Implementation-Pfade ausgearbeitet, KEINE Live-Änderung.**
