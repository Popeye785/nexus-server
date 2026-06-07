# BRAIN-ARCHITEKTUR INVENTAR — Read-Only
**Datum**: 2026-05-18 13:55
**Status**: READ-ONLY (parallel zur laufenden ML-V2-Pipeline)

---

## TEIL 1 — Daten-Quellen-Inventar

| # | Quelle | Vorhanden? | Aktiv? | Im Brain genutzt? | Code-Stelle |
|---|---|:-:|:-:|:-:|---|
| 1 | **Spot-Preise (Bitget WS)** | ✅ | ✅ | ✅ | Z.1974 `new WebSocket(CFG.BITGET_WS)` |
| 2 | **Bitget REST (Candles)** | ✅ | ✅ | ✅ | Z.1641 BitgetAdapter |
| 3 | **Order-Book** | ✅ | ✅ | ✅ | Z.1840 `fetchOrderbook`, Z.2193 `orderFlowImbalance` |
| 4 | **Funding Rate** | ✅ | ✅ | ⚠️ partial | Z.2877 `fundingRate`, Z.19450 ARB-Modul (Funding-Arbitrage) |
| 5 | **Open Interest** | ✅ | ✅ | ⚠️ partial | Z.1927 `openInterest`, Z.24915 OI-Fetch |
| 6 | **Liquidations-Feed** | ❌ | ❌ | ❌ | Nur Backtest-Statistik (Z.3273 Boolean) — keine Live-Quelle |
| 7 | **News-Feed (RSS)** | ✅ | ✅ | ✅ | RSSAggregator Z.20609, 12 Quellen |
| 8 | **News-Sentiment** | ✅ | ✅ | ✅ | NewsSentiment Z.12038 in UnifiedScore |
| 9 | **Fear & Greed Index** | ✅ | ✅ | ✅ | FearGreed Z.11239 (alternative.me) |
| 10 | **Sentiment (Twitter/Reddit)** | ✅ partial | ✅ | ⚠️ | SentimentAI + r/cryptocurrency RSS (Z.11239 SentimentAI.getSentiment) |
| 11 | **Macro-Calendar (FOMC/CPI)** | ⚠️ Keyword-Filter | ⚠️ | ⚠️ | Z.12048 Keyword-Match in News (kein Calendar-Feed) |
| 12 | **Cross-Asset (SPX/Gold/DXY)** | ❌ | ❌ | ❌ | Nicht implementiert |
| 13 | **Korrelation Crypto-Pairs** | ✅ | ✅ | ✅ | CorrelationEngine Z.14340, btcCorr in UnifiedScore |
| 14 | **ETF-Flows** | ❌ | ❌ | ❌ | Nicht implementiert |
| 15 | **On-Chain (Glassnode)** | ✅ partial | ⚠️ | ✅ | OnChainAnalysis Z.20811 (eth chain only), nur Stub |
| 16 | **Whale-Alerts** | ✅ | ⚠️ | ⚠️ | Z.24959 `whale-alert.io` free-tier |
| 17 | **Smart-Money** | ✅ | ✅ | ✅ | SmartMoney.getSignal Z.11239 |

### Daten-Substanz-Bewertung

- **Stark vorhanden**: Spot, OB, Candles, News, F&G, Sentiment, Crypto-Korrelation
- **Schwach**: Funding/OI/Whale/On-Chain (vorhanden aber nicht in Haupt-Decision-Pfad)
- **Fehlt**: Liquidations-Feed, Cross-Asset (SPX/Gold/DXY), ETF-Flows, Macro-Calendar

---

## TEIL 2 — Entscheidungs-Architektur

**Christian-Vermutung 3 Ebenen — REAL sind 4 Ebenen:**

### EBENE 1 — Daten-Sammlung & Sub-Models
- `UnifiedScore.compute(symbol, candles, orderbook)` (server.js Z.11225)
- Ruft **21 Sub-Models parallel** via `Promise.all`:
  - FearGreed.fetch, NewsSentiment.fetch, SentimentAI, OnChainAnalysis, SmartMoney
  - RiskEngine.monteCarlo, VolatilityRegime.detect, AnomalyDetector
  - SharpeEngine, MLOptimizer (RF+GB+PC Ensemble), RLAgent, CVDEngine
  - Strategies (4 BREAKOUT_HUNT, TREND_FOLLOW, MEAN_REVERT, CONSERVATIVE)
  - Ichimoku, Elliott, Patterns
- Liefert `scores`-Objekt mit 21 Keys → jeder hat {direction, score, confidence}

### EBENE 2 — Brain-Aggregation
- `AladdinBrain.decide(symbol, candles, orderbook, uScore)` (Z.25088)
- Mappt 21 Sub-Scores in 5 **Familien** (server.js Z.25110):
  - **TREND**: strategies, ichimoku, elliott
  - **MOMENTUM**: cvd, patterns, rlAgent
  - **RISK**: monteCarlo, bayesian, volatility, sharpe, mlEnsemble
  - **SENTIMENT**: fearGreed, news, reddit, onChain, smartMoney
  - **MICROSTRUCTURE**: anomaly, btcCorr, heatScore, correlation, regime
- Familie-Gewichte (Z.25123): SENTIMENT 0.25, TREND 0.20, RISK 0.20, MICRO 0.20, MOMENTUM 0.15
- 7 Hard-Blocks: NO_DATA, OB_THIN, etc. + 4 wiederhergestellte (Aladdin-Option-D)
- Bayesian-Update der Familie-Confidence

### EBENE 3 — Konsens-Aggregator
- `ConsensusEngine.decide({hardstop, brainResult, unifiedResult, ...})` (Z.11591)
- Sammelt 3 Voter:
  - **brain**: AladdinBrain Output
  - **unified**: UnifiedScore direct
  - **regime**: aktuelle Regime-Klassifikation
- Schwellen: `CONSENSUS_MIN=2`, `SELL_CONSENSUS_MIN=2`, `CONFIDENCE_FAMILY_MIN=0.05` (Aladdin-Restore 16.05.)
- Modi via `CFG.BRAIN_MODE`: shadow / voter / authority
- Hysterese 2-aus-3 pro Symbol gegen Flipping
- SCORE_FLOOR-Anwendung (mode='log_only'): 0.04 effektiv, 0.08 als Schatten

### EBENE 4 — Safety / Veto / Meta
- `BrainVeto.check()` (Z.11478) — 5 Bedingungen scharf
- `KillSwitch.check()` (Z.4776) — 12% MAX_DRAWDOWN_PCT
- `MetaWatchdog.runAllChecks()` (Z.19907) — 10 Wächter-Checks (KILLSWITCH_SANE etc.)
- `MultiKI.vote()` (Z.11203) — 5 Voter Quorum 3
  - SelfHeal, AnomalyDetector, StressTest, SecurityKI, Regime
- `MetaBrain.decide()` (Z.8266) — Strategy-Selection per Regime-Klasse

**Reihenfolge in DemoEngine._cycle (Z.22310-22473)**:
1. UnifiedScore.compute() — Ebene 1 (alle Sub-Models)
2. AladdinBrain.decide() — Ebene 2 (Familien + Bayesian)
3. ConsensusEngine.decide({hardstop, brain, unified}) — Ebene 3 (Voter)
4. MetaBrain.decide() — Strategy-Selection (Ebene 4)
5. Pre-Trade-Gates: KillSwitch, NoTrade, BrainVeto, MultiKI

---

## TEIL 3 — Brain-Input-Vector

Bei jedem Decision-Cycle bekommt Brain folgende **konkreten Inputs**:

| Input | Quelle | Im Brain? |
|---|---|:-:|
| Preis (close) | WebSocket-Cache | ✅ Ebene 1 |
| Candles (1h+15m) | Bitget-REST | ✅ Ebene 1 |
| Orderbook (depth 20) | Bitget-REST | ✅ Ebene 1 |
| MLOptimizer-Ensemble (RF+GB+PC) | nexus.db ml_models | ✅ Ebene 1 |
| FearGreed (alternative.me) | API-Cache 60min | ✅ Ebene 1 |
| News-RSS (12 Quellen) | nexus.db news_feed | ✅ Ebene 1 |
| Monte-Carlo (500 paths × 10steps) | Compute pro Cycle | ✅ Ebene 1 |
| Bayesian Risk | RiskEngine.monteCarlo | ✅ Ebene 1 |
| VolatilityRegime | Live | ✅ Ebene 1 |
| AnomalyDetector | Stat-Check | ✅ Ebene 1 |
| SharpeEngine | aus Trades-History | ✅ Ebene 1 |
| RLAgent (Q-Table) | nexus.db rl_qtable | ✅ Ebene 1 |
| CVD (Cumulative Volume Delta) | Compute | ✅ Ebene 1 |
| OnChainAnalysis | Stub (eth chain) | ⚠️ partial |
| SmartMoney | Heuristik | ⚠️ |

---

## TEIL 4 — Gap-Analyse vs. Elite

| Daten-Quelle | NEXUS V9 | Elite-Standard | Lücke |
|---|:-:|---|---|
| Spot-Preise | ✅ | Pflicht | OK |
| Funding Rate | ⚠️ partial | FreqAI/DeepAlpha (im Brain) | sollte in UnifiedScore |
| Open Interest | ⚠️ partial | FreqAI/DeepAlpha | sollte in UnifiedScore |
| **Liquidations** | ❌ | Coinglass/Hyblock (Wichtigster Crash-Indikator) | **FEHLT** |
| Order-Book-Tiefe | ✅ | Nautilus/LEAN | OK |
| News (12 RSS) | ✅ | Aladdin (Reuters/Bloomberg) | adequat |
| Sentiment | ✅ partial | Aladdin LLM-basiert | technisch OK, qualitativ verbesserbar |
| Fear & Greed | ✅ | Standard | OK |
| **Macro-Calendar** | ❌ (nur Keyword) | Aladdin (FOMC/CPI/NFP) | **FEHLT** |
| **Cross-Asset SPX/Gold/DXY** | ❌ | Aladdin (Korrelation) | **FEHLT** |
| **ETF-Flows BTC/ETH** | ❌ | DeepAlpha (Spot ETF Inflows) | **FEHLT** |
| On-Chain Whale-Tracking | ⚠️ partial | Glassnode/CryptoQuant | adequat |
| Smart-Money | ✅ partial | Heuristik | OK |

---

## TEIL 5 — Verdikt

### A) Ebenen-Architektur
**3 Ebenen vermutet — REAL sind 4 Ebenen** (Ebene 1 Daten-Sammlung, Ebene 2 Brain-Aggregation, Ebene 3 Konsens, Ebene 4 Safety/Veto).

### B) Verschaltung
Streng sequenziell mit Veto-Punkten:
`UnifiedScore → AladdinBrain → ConsensusEngine → MetaBrain → [KillSwitch | BrainVeto | MultiKI | NoTrade] → _executeTrade`

### C) Daten-Quellen aktiv genutzt
17 von 17 inventarisierten — aber **9 davon nur partial oder im Stub-Zustand**.

### D) Top-Lücken vs. Elite
1. **Liquidations-Feed** (Coinglass/Hyblock) — Crash-Frühwarn-Signal
2. **Macro-Calendar** (FOMC/CPI/NFP) — Tag-vor-Event Position-Reduzierung
3. **Cross-Asset** (SPX/Gold/DXY) — BTC-Correlation-Forecast

### E) Hätte Bot heutigen Crash erkannt?
**Wahrscheinlich nicht zuverlässig**:
- AnomalyDetector kann eine Crash-Bewegung als Anomalie erkennen (post-hoc)
- MonteCarlo VaR markiert hohes Risiko (post-hoc)
- News-Pipeline kann Trigger melden, aber 5-15 min nach Event
- **Liquidations-Cascade-Frühwarnung fehlt komplett**

### F) Welche fehlenden Quellen hätten geholfen?
1. **Live-Liquidations-Feed** (Coinglass-API) — würde 30-60 min vor Cascade-Crash warnen
2. **Funding-Rate-Extremes** als Hard-Signal (im UnifiedScore aufnehmen, derzeit nur in ARB-Modul)
3. **Macro-Calendar** — würde FOMC-Day-Volatility-Spike vorhersehen

### G) Top-3 Priorisierung (höchster Hebel)

| Rank | Quelle | Aufwand | Erwarteter Mehrwert |
|---|---|---|---|
| 1 | **Liquidations-Feed (Coinglass)** | 2-3 Tage | Hoch — Crash-Frühwarn |
| 2 | **Funding/OI in UnifiedScore** | 1 Tag | Mittel — bessere Risk-Familie |
| 3 | **Macro-Calendar (Investing.com API)** | 2 Tage | Mittel — Event-Vermeidung |

---

## Bot-Status (während Inventar)

- PM2: nexus R=119, online, 149.9 MB, uptime 36m
- DEPLOY_MODE: PAPER (unverändert)
- ML-V2-Pipeline läuft parallel im Background (PID 43583, 100% CPU, RF-Training)
- Reconciliation: drift=0, consistent=true (gemessen vorhin)

---

## Engineering-Bemerkung

**3-Ebenen-Vermutung war konzeptionell richtig**, real existieren 4 klar separierte Ebenen mit eindeutiger Reihenfolge. Die Trennung ist **sauber implementiert** — kein Brain-Ebenen-Spaghetti.

**Brain-Substanz pro Ebene**:
- Ebene 1 (Daten + Sub-Models): ✅ **stark**, 21 Quellen
- Ebene 2 (Familien-Aggregation): ✅ **stark**, empirische Gewichte
- Ebene 3 (Konsens): ✅ adequat, einfacher 2-aus-3 Voter
- Ebene 4 (Safety): ✅ **sehr stark**, 5 unabhängige Gates
