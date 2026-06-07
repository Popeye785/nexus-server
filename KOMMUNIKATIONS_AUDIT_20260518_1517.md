# KOMMUNIKATIONS-AUDIT NEXUS V9 BOT 1.4 — READ-ONLY
**Datum**: 2026-05-18 15:16
**Modus**: READ-ONLY (kein Patch, kein Reload)
**Brain-Schutzzone**: eingehalten

---

## D1 — Modul-Inventar

**19 Module in `modules/`**:

| Modul | Zweck | Status |
|---|---|---|
| backtest_engine.js | Sandbox-Backtest | ✅ läuft offline |
| ccxt_exchanges.js | Multi-Exchange-Adapter | ⚠️ dormant (Multi-EX deferred) |
| **datasource_etf_flows.js** | ETF-Flows → SENTIMENT | ✅ Phase C live, 5 Bootstrap-Werte |
| **datasource_funding_oi.js** | Bitget Funding+OI → RISK | ✅ Phase 2 live |
| **datasource_liquidations.js** | Binance Liq WS → RISK | ✅ Phase B live (WS verbunden) |
| **datasource_macro_calendar.js** | ForexFactory → SENTIMENT | ✅ Phase 4 live (FOMC-Events erkannt) |
| feature_engineering.js | 56-Feature-Extractor | ✅ Shadow-Backbone |
| freqai_features.js | TIER2-Feature-Suite | ⚠️ TIER2-Modul (dormant) |
| gru_engine.js | GRU-Modell (tfjs) | ✅ Engine OK, kein save/load |
| hyperopt.js | SMA_Optimizer (umbenannt) | ⚠️ TIER2 |
| lstm_engine.js | echter LSTM | ⚠️ trainiert aber kein Live-Use |
| lstm_v5.js | LogReg-Surrogate | ⚠️ Etikett |
| **news_intelligence.js** | News-Klassifikator | ✅ Phase A live (Asset-Tagging, Spam, Cluster) |
| perfattrib.js | Performance-Attribution | ⚠️ TIER2 |
| randomforest_engine.js | RF (ml-random-forest) | ✅ Shadow-Modell aktiv |
| **shadow_inference.js** | Shadow-Mode | ✅ XGBoost+RF live |
| stresstest.js | Stress-Sim | ⚠️ TIER2 |
| walkforward.js | Walk-Forward TIER2 | ⚠️ TIER2 |
| xgboost_engine.js | XGBoost (ml-xgboost) | ✅ Shadow-Modell aktiv |

**Endpoints insgesamt**: 476 (incl. GET+POST+PUT+DELETE)

---

## D2 — Daten-Fluss-Karte (Hauptpfade)

### AladdinBrain (server.js Z.25088+)
- **Liest von**: `UnifiedScore.compute()` Output (21+5 Sub-Sources)
- **Schreibt an**: `aladdin_decisions` DB, `ConsensusEngine.decide()`
- **Status**: ✅ erweitert um 5 neue Sub-Sources (RISK +3, SENTIMENT +2)

### UnifiedScore (server.js Z.11225+)
- **Liest von**: FearGreed, NewsSentiment, SentimentAI, OnChainAnalysis, SmartMoney, RiskEngine, VolatilityRegime, AnomalyDetector, SharpeEngine, Strategies, MLOptimizer, RLAgent, CVDEngine, Ind.patternSignal, Ind.ichimoku, Ind.elliottWave, Regime, CorrelationEngine, HeatMapEngine, Bitget.priceCache
- **NEU (Phase 1-4 + A-C)**: + `DataSourceLiquidations.getSignal`, `DataSourceFundingOI.getSignal`, `DataSourceETFFlows.getSignal`, `DataSourceMacroCalendar.getSignal`
- **Schreibt an**: scores-Objekt (26 Sub-Source-Keys)

### NewsSentiment (server.js Z.20554+)
- **Liest von**: `news_feed` DB (RSSAggregator-Output)
- **NEU**: `news_intelligence.aggregate()` für besseren Score
- **Schreibt an**: cache (riskScore, intelScore, perAsset, velocity, clusters)
- **Wird gelesen von**: UnifiedScore.compute → scores.news

### ConsensusEngine (Z.11591+)
- **Liest von**: brainResult, unifiedResult, hardstop
- **Schreibt an**: consensus_decisions DB
- **3 Voter**: brain + unified + regime

### KillSwitch (Z.4776+)
- **Liest von**: DemoEngine.wallet.peakTotal, getEffectiveDemoEquity()
- **Schreibt an**: this.triggers, Log
- **Trigger**: MAX_DRAWDOWN_PCT (12%), MAX_DAILY_LOSS_PCT

### Shadow-Inference (Phase 5)
- **Liest von**: candles (DemoEngine._cycle), liveBrainDecision (read-only)
- **Schreibt an**: shadow_predictions DB
- **Wird gelesen von**: nur `/api/shadow/stats` Endpoint (read-only, kein Trade-Einfluss)

### FundingEngine (server.js Z.2855)
- **Vorher (vor heute)**: nur in ARB-Modul + DemoEngine pre-trade-check (Z.12117)
- **NEU (Phase 2)**: zusätzlich `DataSourceFundingOI.getSignal` → UnifiedScore.scores.funding + .oi → RISK-Familie
- ✅ **Insel geschlossen**

### WhaleAlert (server.js Z.25108)
- **Liest von**: api.whale-alert.io (free API key)
- **Schreibt an**: ??? — wird nirgendwo systematisch verarbeitet
- ❌ **INSEL**: produziert Daten, niemand liest sie regelmäßig

---

## D3 — Inseln + Stubs (Probleme)

### a) Whale-Alert ❌ INSEL
- `fetchWhaleAlerts(coin)` → Daten von whale-alert.io
- **Wird NICHT in SENTIMENT.smartMoney gelesen**
- SmartMoney.getSignal arbeitet mit eigener Heuristik (RSI+Volume+Pattern), NICHT mit Whale-Daten
- **Empfehlung**: smartMoney-Source aufrüsten mit Whale-Daten (1 Tag Aufwand)

### b) Elliott-Wave ⚠️ semi-aktiv
- `Ind.elliottWave(candles)` liefert Score wenn Wave erkannt
- In Praxis: selten getroffen (Familie zeigt TR active 2/3 → elliott meist NEUTRAL)
- **Empfehlung**: alternative TREND-Source (Multi-TF Trend-Strength)

### c) OnChainAnalysis ❌ STUB
- eth-chain-only, sehr beschränkter Code
- Liefert meist NEUTRAL → SENTIMENT zeigt 3-4/7 active
- **Empfehlung**: Glassnode-Endpoint-Test oder Etherscan-Public-API für ETH-Specifics

### d) heatScore ⚠️ degenerate
- `HeatMapEngine.compute(symbols)` aktiv, aber für Single-Symbol oft 0
- **Empfehlung**: Funktionalität klar machen oder entfernen

### e) correlation ⚠️ degenerate
- `CorrelationEngine.compute(...)` läuft nur wenn `Trades.getActive().length > 0`
- Bei 0 offenen Positionen → immer NEUTRAL
- **Empfehlung**: BTC-Korrelation auch ohne offene Positions als allgemeines Signal nutzen

### f) Shadow-Predictions ✅ read-only
- shadow_predictions wird nur von Stats-Endpoint gelesen
- Kein Live-Trade-Eingriff — wie spec'd

### g) Reconciliation ✅ OK
- ConsistencyGuardian + Recon.run aktiv (30s Watchdog)
- Vergleicht: DemoEngine.wallet, Balance, OrderRegistry, DB-Ledger

---

## D4 — Familien-Sub-Source-Stand (live letzte 30min)

| Familie | total | active | tote-Sub-Sources |
|---|:-:|:-:|---|
| TREND | 3 | 2 | elliott (selten Treffer) |
| MOMENTUM | 3 | 2 | rlAgent (oft NEUTRAL) |
| **RISK** | **8** | **7** | mlEnsemble manchmal NEUTRAL bei conf<0.58 |
| **SENTIMENT** | **7** | **3-5** | onChain/reddit/smartMoney oft Stub |
| MICROSTRUCTURE | 5 | 3-4 | heatScore/correlation degenerate |

**Live-Beobachtung**: SENTIMENT schwankt 3-5/7 active je nach Daten-Verfügbarkeit. RISK ist mit 7/8 die stärkste Familie.

---

## D5 — Kommunikations-Probleme + Empfehlungen

### KOMMUNIKATIONS-PROBLEME GEFUNDEN

1. **WhaleAlert → SENTIMENT.smartMoney**: Daten existieren in WhaleAlert.fetchWhaleAlerts, aber SmartMoney nutzt eigene Heuristik statt der echten Whale-Daten

2. **ETF-Flow-CSV → SENTIMENT.etfFlows**: ✅ Phase C löste das. Bootstrap-Daten von News heute (-630M USD am 18.5.) sind in DB.

3. **Liquidations real → RISK.liquidations**: ✅ Phase B löste das. Binance WebSocket verbunden, Fallback OI-Proxy bei Ausfall

4. **News-Klassifikation → SENTIMENT.news**: ✅ Phase A löste das. Intel-Layer mit Spam-Filter, Asset-Tag, Cluster.

### INSELN OHNE ANSCHLUSS

1. **WhaleAlert-Modul** (server.js Z.25108): produziert, niemand konsumiert
2. **ccxt_exchanges**: Multi-EX-Adapter, nicht aktiv im Decision-Pfad
3. **freqai_features, hyperopt, walkforward, perfattrib, stresstest**: TIER2-Module, alle dormant

### TOTE PFADE

1. **OnChainAnalysis** liefert fast immer NEUTRAL (eth-only Stub)
2. **correlation** ist nur active bei offenen Positions
3. **heatScore** liefert oft 0 bei Single-Symbol-Calls
4. **elliott** trifft selten (Wave-Erkennung restriktiv)

### STUBS (konstant 0 / NEUTRAL meistens)

1. **elliott** (TREND)
2. **onChain** (SENTIMENT)
3. **heatScore** (MICROSTRUCTURE)
4. **correlation** (MICROSTRUCTURE)
5. **smartMoney** (SENTIMENT) — semi-Stub

---

## D6 — Empfehlungen nach Priorität

### P1 (kritisch, sofort fixbar)
1. **WhaleAlert → smartMoney verbinden** (~1 Tag) — Insel schließen
2. **correlation immer aktiv** machen statt nur bei offenen Positionen (~2h)
3. **OnChainAnalysis-Stub** ersetzen durch Etherscan/Mempool.space Public-APIs (~1 Tag)

### P2 (großer Hebel, mehrtägig)
1. **Elliott-Wave-Trend** durch Multi-TF-Trend-Strength ersetzen (~2 Tage)
2. **smartMoney auf echte Whale-Daten** (siehe P1)
3. **heatScore** semantisch klären oder entfernen (~1 Tag)
4. **TIER2-Module aktivieren** (walkforward, hyperopt, stresstest) im Live-Monitor-Modus

### P3 (kleinere Verbesserungen)
1. **lstm_v5 deprecaten** (heißt schon "LogReg_v5 surrogate") — entweder echten LSTM bauen oder entfernen
2. **freqai_features** evaluieren — heutige feature_engineering.js Phase 1 kann eine Erweiterung sein
3. **ccxt_exchanges** spec'en — wenn Multi-EX-Live kommt
4. **gru_engine save/load** ergänzen für persistente Modelle

---

## D-Tabelle: Endpoint-Schutz-Stand (Stichprobe)

**476 Endpoints** insgesamt. 195/195 Mutation-Endpoints geschützt (AUDFIX_E001_PHASE2 letzten Mittag). Read-Only-GETs offen für Dashboard.

---

## STATUS

- Bot: PM2 R=130 online, PAPER, drift=0
- 4 Phasen heute Nachmittag erfolgreich (A News-Intel, B Liquidations real, C ETF-CSV, D Audit)
- Brain-Familie-Status: 21→26 Sub-Sources (Daten-Struktur erweitert, Aggregations-Logik unangetastet)

---

## VERDIKT

Brain-Architektur ist **kommunikativ solide** — die 4 Ebenen sind klar getrennt, Datenfluss sequenziell. Die größten Lücken liegen in:
1. **Inseln** (WhaleAlert, ccxt_exchanges, TIER2-Module)
2. **Stubs** (elliott, onChain, heatScore, correlation)
3. **Smart-Money als Heuristik statt echter Whale-Daten**

Die heute deployten **Phase A+B+C+D** haben 4 von ~7 Hauptlücken geschlossen (News-Klassifikation, Liquidations-real, ETF-Manual-Import, dokumentiertes Audit). Verbleibende 3 (Whale, smartMoney, onChain) sind separates F2-Material.

**Brain-Logik-Touch: 0** — Aggregations-Code unangetastet wie spec'd.
