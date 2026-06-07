# NEXUS V9 — TOTAL-AUDIT + LIFT-TO-QUANT-GRADE

**Erstellt:** 25.05.2026 16:43-17:30
**Auditor:** Senior Software Auditor / Systemanalyst / QA-Ingenieur
**Modus:** READ-ONLY (Bot tradet parallel weiter, KEINE Patches während Audit)
**Code-Basis:** server.js (28.653 Zeilen), public/index.html (9.782 Zeilen), modules/ (54 Dateien), nexus.db (108 Tabellen)
**Bot live während Audit:** PID 83537 R=240 mem 177 MB uptime 54m, Wallet $1147.29, Reserve $0, NEAR-GRID OPEN

---

## A. EXECUTIVE SUMMARY

**Status NEXUS V9:** Funktional stabil, **post Punkt-1/2-Fixes mathematisch ehrlich im Wallet**, aber **NICHT auf Boutique-Quant-Niveau** — mehrere strukturelle Lücken zu Aladdin/Renaissance/Two-Sigma-Standards.

### Top-10 KRITISCHE BEFUNDE (sortiert nach Severity)

| # | Sev | Bereich | Befund | Code-Stelle |
|--:|---|---|---|---|
| **1** | 🔴 **HIGH** | **9 Safety** | **`profitabilityGreen`-Gate DOPPELT definiert** — Z.13251 `refreshBalances()` überschreibt Hebel-1-Fix Z.5272 ohne PAPER-Check | server.js:5272 ✅ + server.js:13251 🚨 ungefixt |
| **2** | 🔴 **HIGH** | **3 Cross-Konsistenz** | **Dashboard `realizedAllSinceReset = $2145` mischt FALSE_MATH + CLEAN strp** — UI weiter unzuverlässig nach Option A1 | server.js:`/api/bots/dashboard` |
| **3** | 🔴 **HIGH** | **6 ML** | **Perceptron-Architektur defekt** — shared weights für 3 Klassen, gibt konstant SELL | server.js:3814-3866 |
| **4** | 🔴 **HIGH** | **5 Brain** | UNIFIED-Confidence Median 0.03-0.07 → wenige Trades durchfunken (selbst nach Phase-5-Threshold-Kalibrierung) | server.js:12117 |
| **5** | 🟠 MEDIUM | 5 MetaBrain | `STRATEGY_SYMBOL_LIMIT['MEAN_REVERT']=['BTCUSDT']` → 19/20 Coins fallen in CONSERVATIVE-Skip bei RANGING | server.js:8453 |
| **6** | 🟠 MEDIUM | 7 GRID | High-price Assets (BTC) sind Fee-Falle (Fees > Step-Profit) | server.js:9090-9092 |
| **7** | 🟠 MEDIUM | 6 ML-Buffer | Label-Imbalance (0 SELL bei 113 Samples), kein SMOTE/Class-Weighting | server.js:4022 |
| **8** | 🟡 MEDIUM | 10 Position-Sizer | Kein Kelly/HRP/Sortino — fester Multiplier-Chain | server.js:5934 |
| **9** | 🟡 MEDIUM | 11 News | Mark-Cuban-Dedup-Bug (3x von 3 RSS) — Source-Aggregation broken | (UI-Befund, ungeprüft) |
| **10** | 🟢 LOW-FIXED | 6 PC | pc_weight=0 datenbasiert korrekt — Architektur-Schuld bleibt | server.js:4157 |

### Quant-Grade-Bereitschaft

**13 von 20 Bereichen "Präsentierbar=NEIN"** ohne weitere Fixes. Lift-Aufwand: **~40-80h Engineering** über 4-6 Wochen.

### Akut-Empfehlung
- Bot läuft sicher (Wallet+Reserve geschützt, Math ehrlich seit Option A1)
- 🔴 LIVE-Mode bleibt aus bis Befunde #1 #2 #3 #4 gefixt
- Roadmap-Reihenfolge: **#1 → #2 → #4 → #5 → #6 → #3 → #7 → #8 → #9**

---

## B. VOLLSTÄNDIGE COMPONENT-LISTE

| Modul | Code-Stelle | Status | Notiz |
|---|---|---|---|
| **Wallet/Equity** | server.js:4790 + 24232 | 🟡 OK-fixed | Punkt 1+2 fixed, Backend-Endpoint `dashboard` aber inkonsistent (#2) |
| AladdinBrain Voter | server.js:27000+ | 🟢 OK | T9.1 Voter-Gewichte aktiv (TREND 35/MOM 5/RISK 30/SENT 5/MICRO 25) |
| FamilyWeightsAdaptive | modules/family_weights_adaptive.js | 🟢 OK | HMM-Regime-Adaption funktional |
| HMM Regime | modules/hmm_regime.js | 🟢 OK | 5-State, posterior live |
| MLOptimizer | server.js:3814+ | 🟡 OK-partial | RF/GB 57.76%, PC defekt (#3) |
| MLAutoRetrain | server.js:22970+ | 🟢 OK | Trade-Count-Trigger 50+ |
| GridBotMBT | server.js:8983 | 🟢 OK-fixed | size-Math gefixt heute (Punkt 2) |
| InfinityGridBotMBT | server.js:9353 | 🟢 OK-fixed | size-Math gefixt heute |
| DCABotMBT | server.js:9153 | 🟡 OK-tuned | TP 6%→3%, max_iter 8→12 (Phase 5) |
| DemoEngine | server.js:24206+ | 🟢 OK | Single-source für Demo-Wallet |
| RiskSizing | server.js:5934+ | 🟡 OK-tuned | THRESHOLDS p90/p75/p50/p25 (Phase 5) |
| RegimeStrength | server.js:4803+ | 🟢 OK | Hysterese 2-aus-3 aktiv |
| StatsCore | server.js:5811+ | 🟢 OK | Single source, 5s cache |
| NoTrade Gates | server.js:5242+ + 13251 | 🔴 **BUG #1** | Doppelte profitabilityGreen-Definition |
| KillSwitch | server.js:4840+ | 🟢 OK | Punkt-1-Patch _persistWallet aktiv |
| Incidents/AnomalyDetector | server.js:4970+ | 🟢 OK | pressureScore mit MARKET_ANOMALY-Cap |
| BrainVeto | server.js:6534+ | 🟢 OK | Welle 2a, NO_CONSENSUS-Veto aktiv |
| MetaBrain | server.js:8411+ | 🟡 OK | CONSERVATIVE-Skip greift bei 19/20 Coins (#5) |
| StrategySequence | server.js:8665+ | 🟢 OK | Superalgos-Pattern aktiv |
| RSSAggregator | server.js:12623+ | 🟢 OK | 12 Quellen aktiv |
| NewsSentiment | server.js:12497+ | 🟡 UNSICHER | Mark-Cuban-Dedup ungeprüft (#9) |
| FearGreed | server.js:11282+ | 🟢 OK | alternative.me-Cache 60min |
| OnChainState | server.js + nexus.db.on_chain_state | 🟡 UNGEPRÜFT | Tabelle existiert |
| Multi-Exchange | server.js + nexus.db.exchange_config | 🟢 OK | T8 deployed, 1 enabled (Bitget) |
| TrainingBridge | server.js:4300+ | 🟢 OK | T10-P5-Hänger gefixt (tickLevel=false) |
| HistoricalData | server.js:3178+ | 🟢 OK | 408 MB CSV verifiziert |
| WalletProvider | server.js | 🟢 OK | Mode-aware (DEMO/LIVE) |
| WalletReconciler | server.js | 🟡 UNGEPRÜFT | Drift-Recon $276 dokumentiert |
| Wächter/AutonomousRepair | server.js | 🟡 UNGEPRÜFT | Status unklar |
| ConsistencyGuardian | server.js | 🟢 OK | 30s Watchdog aktiv |
| Janitor | server.js | 🟢 OK | Phantom-Cleanup aktiv |

---

## C. GEFUNDENE FEHLER UND RISIKEN

### 🔴 CRITICAL — keine reinen Critical-Befunde gefunden (Bot stabil, Reserve geschützt)

### 🔴 HIGH

**HIGH-1: profitabilityGreen DOPPELT definiert**
- **Code:** `server.js:5272` (Hebel-1-fixed, mit PAPER-Check) UND `server.js:13251` (alter Bug-Code, OHNE PAPER-Check)
- **Reproduktion:** `refreshBalances()` läuft → überschreibt `NoTrade.gates.profitabilityGreen = Balance.trading > 0`. Da Balance.trading=0 im PAPER → Gate wird rot. Hebel 1 wird stillschweigend rückgängig gemacht.
- **Auswirkung:** Bot stoppt trades zufällig wann balance-refresh läuft. Erklärt warum Gate sporadisch rot wird.
- **Fix-Empfehlung:** Z.13251 löschen ODER mit gleichem PAPER-Check wie Z.5272 versehen.
- **Quelle:** Konsistenz-Prinzip — Single Source of Truth (LEAN SecurityPortfolioManager hat 1 Property, nicht 2).

**HIGH-2: Dashboard `realizedAllSinceReset` mischt FALSE_MATH + CLEAN**
- **Code:** `/api/bots/dashboard` Endpoint (Suche im server.js)
- **Reproduktion:** Nach Option A1 Wallet ehrlich $1147.29, aber Dashboard zeigt realized $2145.03 (= 7822 FALSE_MATH-strp + 108 CLEAN)
- **Auswirkung:** UI weiter unzuverlässig, alle Telegram-Reports / WebSocket-Updates falsch
- **Fix-Empfehlung:** SUM(...) Queries filtern `WHERE notes IS NULL OR notes NOT LIKE 'FALSE_MATH%'`
- **Quelle:** Audit-Trail-Pattern (immutable Event-Log, Filter beim Aggregieren)

**HIGH-3: Perceptron-Architektur defekt**
- **Code:** `server.js:3814-3866`
- **Reproduktion:** `Perceptron._score(x, classIdx) = sum(x*weights) + bias[classIdx]`. Alle 3 Klassen teilen sich SELBES `weights`-Array. Bias=[0,0,0] → alle scores identisch → label=0 (SELL) immer.
- **Auswirkung:** PC liefert konstant SELL → Ensemble würde SELL-bias geben → wurde durch pc_weight=0 neutralisiert (T9.4)
- **Fix-Empfehlung:** `weights: {0: [...35], 1: [...35], 2: [...35]}` pro Klasse separat. 2-4h Engineering. Erst dann pc_weight > 0 sinnvoll.
- **Quelle:** Multi-Class Perceptron Standard (Lopez de Prado AFML Ch.3, Goodfellow Deep Learning Ch.6.1)

**HIGH-4: UNIFIED-Confidence sehr niedrig**
- **Code:** `server.js:12117` UnifiedScore.compute aggregiert 21 Quellen
- **Reproduktion:** Live-Logs zeigen conf 0.01-0.04 für Median, max 0.26
- **Auswirkung:** Selbst nach Phase-5-Threshold (0.02 minConf) sind viele Trades nur 0.25x-position
- **Fix-Empfehlung:** Quellen-Audit: welche Sub-Sources liefern NEUTRAL/Null? Diese ggf. abschalten oder Gewichtung anpassen.
- **Quelle:** UnifiedScore = signal aggregation pattern (Renaissance Feature-Engineering)

### 🟠 MEDIUM

**MED-5: STRATEGY_SYMBOL_LIMIT MEAN_REVERT BTC-only** (s.js:8453) — blockt 19/20 Coins in RANGING → CONSERVATIVE-Skip. Fix: Erweiterung auf ETH/SOL nach Backtest-Validierung.

**MED-6: BTC-GRID Fee-Falle** (s.js:9090-9092) — bei high-price Assets sind Fees > Step-Profit. Fix: per-Symbol Mindest-Range relativ zum Fee-Anteil prüfen vor GRID-Creation.

**MED-7: ML-Buffer Label-Imbalance** (s.js:4022) — T10-P5 hatte 0 SELL-Labels. Fix: SMOTE/Class-Weighting (Lopez de Prado Ch.4) ODER Triple-Barrier-Labeling.

### 🟡 MEDIUM

**MED-8: Position-Sizer fester Multiplier-Chain** — kein Kelly/HRP/Sortino. Fix: Implementierung Kelly-Criterion (Thorp 1962) + HRP (Lopez de Prado 2016).

**MED-9: News-Source-Dedup Mark-Cuban-Bug** — laut Spec 3x von 3 RSS. Ungeprüft im aktuellen Audit.

### 🟢 LOW

**LOW-10: pc_weight=0 dokumentiert** — datenbasiert korrekt (T9.4), Architektur-Schuld bleibt für Future-Aktivierung.

**LOW-11: 7822 FALSE_MATH-Markierungen in strp** — Audit-Trail behält Historie, aber Aggregat-Queries filtern (noch) nicht — siehe HIGH-2.

---

## D. RECHEN- UND LOGIKPRÜFUNGEN (Bereich 1, 5, 6, 7, 10)

### Bereich 1: Kapital/Equity

**Quellen-Konsens (Quant-Niveau):**
- [QuantConnect LEAN SecurityPortfolioManager](https://github.com/QuantConnect/Lean/blob/master/Common/Securities/SecurityPortfolioManager.cs): Memory = SSOT, Lazy-Invalidation
- [NautilusTrader Architecture](https://nautilustrader.io/docs/latest/concepts/architecture/): Cache = SSOT, Crash-Only-Design
- [Hummingbot Paper Trade](https://hummingbot.org/client/global-configs/paper-trade/): UNBEKANNT für Detail-Snapshots

**Nexus IST:**
- `DemoEngine.wallet` (Memory) = SSOT für Demo-Mode ✓
- `_persistWallet()` (9 Aufrufer + Punkt-1-Fix Z.4889) ✓
- 6 Wallet-Sichten: alle korrekt definiert (PUNKT1_WALLET_AUDIT_20260525.md)

**Gap:** Kein Event-Sourcing wie Nautilus. Wallet wird komplett überschrieben (Snapshot-Pattern). OK für Demo, problematisch für Multi-Exchange-LIVE später.

**Upgrade:** Nautilus-style Event-Sourcing für AccountState (Aufwand 8-16h). Alternative: SQLite-Append-Log statt JSON-Overwrite.

**Präsentier-Kriterium:** "Wallet-State rekonstruierbar aus DB-Event-Log + Schwarz-Box-Test: Bot-Crash → Restart → State identisch."

### Bereich 5: Brain (AladdinBrain)

**Quant-Vergleich:**
- BlackRock Aladdin: Multi-Factor-Risk-Model mit 30+ Factor-Familien
- Renaissance: HMM mit 5-7 Regimes, ML-Aggregation
- NEXUS: **5 Familien** (TREND/MOM/RISK/SENT/MICRO) + HMM 5-State ✓
  - **Gap:** 5 Familien vs 30+ bei Aladdin — keine Ansatz für Sub-Factor-Decomposition
  - **Gap:** Confidence-Aggregation simpel (weighted score), kein Bayesian-Update wie LEAN/Nautilus

**Voter-Gewichte:** T9.1 aktiv (TREND 35 / MOMENTUM 5 / RISK 30 / SENTIMENT 5 / MICROSTRUCTURE 25)
**HMM-Posterior:** RANGING 97.5% live
**Adaptive Weights:** funktioniert (FamilyWeightsAdaptive)

**Sub-Sources (Auszug aus 81 scores.X-Zuweisungen):** smartMoney, microstructure, ml, lstm, tft, brain, regime, vol, fundamental, sentiment, news, fearGreed, technical, momentum, ...

**Audit-Empfehlung:** Per-Sub-Source Hit-Rate-Tracking implementieren (heute nur Family-Level via aladdin_perf). Aufwand 4-8h.

### Bereich 6: ML

**Quant-Vergleich:**
- Renaissance: 100+ Strategien parallel, ML-Aggregation, eigenes Feature-Store
- Two Sigma: TensorFlow + eigene ML-Pipeline, 1000+ Features
- FreqAI: 3 Models default (LightGBM, CatBoost, XGBoost) mit Walk-Forward
- NEXUS: **RF + GB + PC** ← deutlich primitiver

**Befunde:**
- RF/GB 57.76% acc (435 Samples) — verlässlich, aber niedrig (LEAN-Standard Ziel ~62-70%)
- PC defekt (HIGH-3)
- ML-Ensemble in MLOptimizer.predict() RF 50 + GB 50 + PC 0 (T9.4)
- 35 Features (FEAT_NAMES Z.3964): RSI, MACD_Hist, BB_PctB, BB_Width, ATR_Pct, Stoch_K, EMA-distances, ADX, DI, CCI, MFI, Williams_R, CMF, SAR, Supertrend, Squeeze, Ichimoku, TK_Cross, Elder_Bull/Bear, Vortex, TRIX, ROC, Choppiness, Aroon, PPO, HA_Bull, MACD>Signal, OBV
- Plus: **TFT/LSTM Shadow** (modules/lstm_shadow*, modules/tft_*) — Status UNGEPRÜFT (Code da, ob aktiv unklar)

**CSV-Vorwissen (T10-P5):** 408 MB / 40 Dateien — vorhanden, von TrainingBridge gelesen, aber Backtest-Strategien (ema_cross/patterns/ichimoku/funding_arb) zu primitiv → meist Filter-Fail (PF<1.2) → Buffer-Füll-Problem (HIGH/MED-7).

**Upgrade-Pfad zum Quant-Niveau:**
1. XGBoost integrieren (FreqAI-Pattern) — Aufwand 8-16h
2. Triple-Barrier-Labeling (Lopez de Prado AFML Ch.3) — Aufwand 4-8h
3. Per-Symbol-ML statt globaler Pool — Aufwand 16-32h
4. Feature-Store mit Versionierung — Aufwand 16-24h

### Bereich 7: Bot-Strategien

**SINGLE/DCA/GRID/INFGRID** alle aktiv, GRID-Math heute gefixt (Punkt 2).

**Fee-Falle (MED-6):** Pro Symbol: profitable wenn `Step > 2×TAKER_FEE×Price`. Bei BTC mit $76k Preis + Range 1.5% → Step $1140/(num_levels+1)=$104 — aber 2×Fee×$76k = $152 → unprofitable. Lösung: per-Symbol min-range relativ zum Fee-Anteil prüfen vor GRID-Creation.

**DCA-Drift-Exit:** 5/6 historisch ohne TP closed wegen MAX_ITERATIONS_REACHED. Phase-5-Fix: TP 6%→3%, max_iter 8→12. Untested ob das hilft (NEAR-GRID gerade läuft, kein DCA aktiv).

**Capital-Allocation:** Statisch 40/25/20/15 (SINGLE/GRID/DCA/INFGRID). **Kein Profit-Weighted Allocation** wie Christian gewünscht. Upgrade siehe Bereich 10.

### Bereich 10: Position-Sizer

**6-Multiplier-Chain (Z.5934+):**
```
finalSize = RISK_PER_TRADE × balance × confMult × regimeMult × volMult × sentMult × profitLockMult × newsRiskMult / max(slPct, SL_FLOOR)
```
- Cap: MAX_POSITION_PCT 10%
- Min: SKIP_BELOW_SIZE 2.5 USDT

**Gap zu Quant-Niveau:**
- **Kelly-Criterion** (Thorp 1962): Optimal-Fraction = (p×b - q) / b, wo p=WR, b=AvgWin/AvgLoss
- **HRP** (Lopez de Prado 2016): Hierarchical Risk Parity für Multi-Asset
- **Sortino** (Sortino 1994): downside-deviation-adjusted

**Aktuell:** Multiplier-Chain ist datenbasiert (confidence) + Regime-Adaptive — aber kein klassischer Kelly. Solide für Demo, für LIVE würde Quant-Reviewer Kelly + Sortino fordern.

**Upgrade:** Kelly-Integration in confMult-Berechnung (Aufwand 4-8h) + Sortino-Monitor als KPI (Aufwand 2-4h).

---

## E. UI-, KACHEL- UND ENDPOINT-PRÜFUNGEN (Bereiche 2, 3, 4)

### Bereich 2: 21 Tabs (advanced/aidash/analyse/ars/bots/chart/coins/dashboard/exchanges/kapital/ml/news/orderbook/safety/settings/signal/stratbuild/system/trade/watchdog/whale)

**Stichprobe:** Tabs laden bei aktivem Bot (manuell mit Browser nötig — auditiert über Code-Inspection).
- **247 onclick-Handler** im UI
- **547 API-Endpoints** im Backend
- Auto-Refresh-Intervalle 2s-300s (verschieden je Tab)

**KRITISCHER FUND (HIGH-2):** Dashboard zeigt FALSE-MATH-aggregierte realized $2145, obwohl Wallet ehrlich auf $1147 reset wurde. **Kapital-Tab zeigt also Lügen.**

### Bereich 3: Cross-Konsistenz

**Test-Methode:** Gleicher Wert an verschiedenen Stellen?
- `wallet.total`: Disk $1147.29 == Memory $1147.29 ✅ (Punkt-1-Fix)
- `peakTotal`: Disk = Memory $1150.76 ✅
- `realizedAllSinceReset`: Dashboard $2145 ≠ wallet.pnl $147.29 → **🔴 INKONSISTENT**
- `unrealized`: Dashboard $3.46 vs ehrliche profit_acc-Summe $3.14 (NEAR allein) → leichte Drift OK

**Befund:** Wallet ist konsistent. Dashboard ist nicht. → HIGH-2.

### Bereich 4: API-Endpoints

**547 Endpoints insgesamt.** Stichprobe der wichtigsten:

| Endpoint | Status | Notiz |
|---|---|---|
| `/api/demo/wallet` | ✅ ehrlich | liest DemoEngine.wallet |
| `/api/wallet/snapshot` | ✅ ehrlich | gleiche Quelle |
| `/api/stats/strategy` | ✅ | StatsCore SSOT |
| `/api/bots/dashboard` | 🔴 mischt FALSE_MATH | HIGH-2 |
| `/api/notrade` | 🟡 funktional, aber Z.13251 BUG | HIGH-1 |
| `/api/incidents` | ✅ | live |
| `/api/training/run` | ✅ | tickLevel=false default |
| `/api/historical/status` | ✅ | CSV-Status |
| `/api/exchange-config/*` | ✅ | T8 deployed |

**Orphan-Endpoints (Stichprobe):** UNGEPRÜFT — zu viele 547 für komplette Liste in einer Session.

---

## F. SAFETY- UND THRESHOLD-AUDIT (Bereich 9)

**11 NoTrade-Gates** (Z.5243+):
| Gate | Bedingung | Status |
|---|---|---|
| balanceValid | `wallet.trading > 10` (PAPER) | ✅ |
| marketDataFresh | priceCache nonempty | ✅ |
| noActiveIncident | !Incidents.hasCritical() | ✅ |
| **runtimeClean** | Incidents.pressureScore() < 0.5 | 🟡 oft rot bei MARKET_ANOMALY-Wellen |
| regimeAcceptable | !['EXTREME_BEAR','FLASH_CRASH'] | ✅ |
| **profitabilityGreen** | Mode-aware (Hebel 1) | 🔴 **DOPPELT BUG (HIGH-1)** |
| killSwitchOff | !KillSwitch.active | ✅ |
| stressTestPassed | rate >= MIN | ✅ |
| concurrencyOk | _effOpen < MAX | ✅ |
| tierDailyDD | RiskTier.checkDailyDD() | ✅ |
| deployModeAllows | mode in ['DRY_LIVE','LIVE_*'] OR !liveMode | ✅ |

**KillSwitch (Z.4840+):**
- DD-Trigger Schwelle 12% (CFG.KILL_SWITCH_DD)
- Punkt-1-Patch: `_persistWallet` nach peakTotal-Update ✅
- Glitch-Schutz aktiv (eq < peak×0.5 → ignored)

**AnomalyDetector:** Pressure-Cap MARKET_ANOMALY=0.5, andere Severity-weights 1-4.

**Greift wirklich?** Ja — heute mehrfach gesehen (13:00 + 16:00 Anomaly-Wellen → NoTrade rot → Bot pausiert).

---

## G. SUBSYSTEME-DETAILPRÜFUNG (Bereiche 11-18)

### Bereich 11: News-Risk-Aggregator
- 12 RSS-Quellen aktiv (Welle 2c)
- ~300 Articles/24h
- `NewsRiskAggregator` (modules/news_risk_aggregator.js — UNGEPRÜFT)
- Mark-Cuban-Dedup-Bug (MED-9): **UNGEPRÜFT in diesem Audit**
- factor-Berechnung: UNGEPRÜFT
- newsRiskMult-Output: in RiskSizing integriert ✓

### Bereich 12: AnomalyDetector
- pressureScore() (Z.4976+) — MARKET_ANOMALY cap 0.5
- Symbol-spezifisch + systemweit
- Auto-Resolve nach Cooldown (UNBEKANNT genau wann)

### Bereich 13: Risk-Tier
- RiskTier.maxPositions() / checkDailyDD() / setTier() / promote-check
- Endpoints unter `/api/risktier/*`
- DryRun-Mode: simuliert Sub-Positions
- Tier-Übergänge: UNGEPRÜFT (komplex, separate Session nötig)

### Bereich 14: Walk-Forward / Backtest
- TrainingBridge.config: walkForwardSplit=0.8, minValidationPF=1, minTradesForValidation=3
- 173+ Backtest-Runs in DB
- tickLevel=false default (nach T10-P5 Fix)
- Scheduled: nightly UNGEPRÜFT (kein cron im Code direkt sichtbar)

### Bereich 15: Order-Book / Microstructure
- `orderbook_snapshots`-Tabelle UNGEPRÜFT
- 1-Min-Snapshots + 30d Retention UNGEPRÜFT
- MICROSTRUCTURE-Familie Inputs: Bid-Ask + Imbalance + ML-Microstructure-Module

### Bereich 16: Whale / On-Chain
- `on_chain_state`-Tabelle existiert (verifiziert)
- Etherscan-Integration: live (eth_gas-rate-limit-Logs sichtbar — Test-Endpoint funktioniert)
- Whale-Tracking + Liquidations: UNGEPRÜFT im Detail

### Bereich 17: Multi-Exchange (T8)
- DB-Schema `exchange_config` aktiv (12 CEX)
- AES-256-GCM via lib/encryption.js ✅
- Bitget: enabled=1, last_test_result='saved' ✓
- Andere 11: alle disabled (vorbereitet, nicht aktiv)
- 7 API-Endpoints `/api/exchange-config/*` (T8.1.5)

### Bereich 18: Wächter / Audit-Trail
- ConsistencyGuardian (30s) ✅
- Janitor (Phantom-Cleaner) ✅
- Wächter productive: UNGEPRÜFT genau welche Module
- audit_log-Tabelle: UNGEPRÜFT-existiert

---

## H. VERSTECKTE PROBLEME (Bereich 19)

### Scheinlogik
- **Perceptron** (#3): Code läuft, lernt online, gibt aber konstant SELL → 0% Beitrag (pc_weight=0)
- **LSTM-Shadow** (modules/lstm_shadow*): laut README aktiv — UNGEPRÜFT ob wirklich Predictions zu Decisions beitragen
- **TFT-Forecaster**: UNGEPRÜFT
- **RL Q-Table** (84 Einträge): UNGEPRÜFT ob Decisions beeinflusst

### Dekorations-Features
- UNGEPRÜFT systematisch (zu viele Module)

### Circular Dependencies / Race Conditions
- Wallet-Mutation während _persistWallet: synchron → kein Race ✅
- KillSwitch.check vs _cycle: parallel möglich, beide lesen wallet.peakTotal — kein Schreib-Konflikt direkt
- Aber: HIGH-1 ist effektiv eine Race-Condition zwischen `NoTrade.refresh()` (Z.5263) und `refreshBalances()` (Z.13251)

### Silent Failures
- Viele `try { } catch(_) {}` ohne Log — Standard-Pattern aber problematisch für Debugging
- Beispiel: `try { DemoEngine._persistWallet(); } catch(_) {}` — wenn Disk full, kein Hinweis
- **Fix:** Mindestens `catch(e) { Log.warn(...) }` statt `catch(_) {}`

### Security
- `.env` chmod 600 (verifiziert Tier-Z3)
- `nexus.db` chmod 600 (verifiziert LIVE-Readiness)
- API-Keys in Bitget-Modul aus .env: nicht im Log gedruckt (Audit-Stichprobe)
- Multi-Exchange Encryption: AES-256-GCM mit Keychain ✓ (T8.1.3 verifiziert)

---

## I. POST-MORTEM HEUTIGER PATCHES (Bereich 20)

| Patch | Code-Stelle | Wirkung | Seiteneffekte |
|---|---|---|---|
| Hebel 1 profitabilityGreen | s.js:5272 | ✅ Gate green in PAPER | 🔴 **wird von Z.13251 überschrieben (HIGH-1)** |
| Phase 5 RiskSizing-Threshold | s.js:5942-5946 | ✅ Trades bei conf≥0.02 | trades mit kleinen Sizes |
| Phase 5 DCA TP/maxIter | s.js:9166-9167 | ✅ aktiv für künftige DCAs | ungetestet (kein DCA aktiv) |
| Punkt 1 _persistWallet | s.js:4889 | ✅ Disk-Sync peakTotal | minimal Disk-I/O Last |
| Punkt 2 GridBotMBT size | s.js:9017 | ✅ Math ehrlich | Profit-Erwartung 100-2000x niedriger als vorher |
| Punkt 2 InfinityGridBotMBT size | s.js:9391 | ✅ Math ehrlich | gleicher Effekt |
| Option A1 Wallet-Reset | demo_wallet.json | ✅ ehrlicher Stand | 🔴 **Dashboard liest weiter Fantasie (HIGH-2)** |

---

## J. OFFENE UNSICHERHEITEN

Diese Bereiche wurden NICHT in der Tiefe geprüft (Zeit-Constraint):

1. **News-Aggregator Source-Dedup** (Mark-Cuban-Bug)
2. **OnChain-State Whale-Pipeline** Detail
3. **Wächter-Actions-Log Details**
4. **Order-Book Microstructure Pipeline**
5. **LSTM/TFT Shadow-Modules** ob aktiv in Decisions
6. **RL Q-Table-Integration in Decisions**
7. **Backtest-nightly-Scheduling**
8. **RiskTier Übergangs-Logik Tier-Sprünge**
9. **WalletReconciler Approval-Workflow**
10. **CryptoPanic / SentiCrypt etc. Subsource-Status**

→ Diese 10 Punkte benötigen 2-4h zusätzliche Audit-Tiefe.

---

## K. KONKRETE FIX-EMPFEHLUNGEN (sortiert nach Prio)

### Fix-Plan (Sequenziell, einzeln-deployable)

| Prio | Fix | Aufwand | Risiko | Erwarteter Effekt |
|--:|---|---:|---|---|
| **1** | HIGH-1 profitabilityGreen Z.13251 mit PAPER-Check ergänzen | 5min | 🟢 trivial | Bot stabil auch nach Balance-Refresh |
| **2** | HIGH-2 Dashboard-Aggregat filtert FALSE_MATH-strp | 15min | 🟢 trivial | UI zeigt ehrliche Zahlen |
| **3** | HIGH-4 UNIFIED-Confidence-Diagnose | 1-2h | 🟡 mittel | Bestimme welche Sub-Sources Null liefern |
| **4** | MED-5 STRATEGY_SYMBOL_LIMIT erweitern für ETH/SOL/etc. | 30min + 2h Backtest-Verify | 🟡 mittel | mehr Trades in RANGING |
| **5** | MED-6 BTC-GRID Fee-Check vor Creation | 1h | 🟢 niedrig | verhindert Fee-Fallen |
| **6** | HIGH-3 Perceptron Per-Klassen-Weights | 2-4h | 🟡 mittel | PC könnte ins Ensemble |
| **7** | MED-7 ML-Buffer SMOTE/Class-Weighting | 4-8h | 🟡 mittel | balanced Labels |
| **8** | MED-8 Kelly-Criterion Integration | 4-8h | 🟡 mittel | Optimal-Fraction-Sizing |
| **9** | MED-9 News-Source-Dedup Audit | 2-4h | 🟢 niedrig | bessere News-Quality |
| **10** | LOW Bereiche 11-18 systematischer Audit | 4-8h | 🟢 niedrig | komplette Doku |

**Total Fix-Aufwand: ~20-40h** für Quant-Grade-Mindeststandard.

---

## L. PRÄSENTIER-MATRIX (20 Bereiche × Status)

| # | Bereich | Aktuell | Quant-Niveau-Ref | Gap | Fix-Aufwand | Präsentierbar? |
|--:|---|---|---|---|---:|:-:|
| 1 | Kapital | ehrlich post Option A1 | LEAN/Nautilus Memory-SSOT | klein | 0 (done) | 🟢 JA |
| 2 | UI/Tabs | 21 Tabs funktional | — | UI-Audit nötig | 4-8h | 🟡 TEILWEISE |
| 3 | Cross-Konsistenz | inkonsistent (HIGH-2) | LEAN single-truth | mittel | 15min | 🔴 NEIN |
| 4 | Endpoints | 547 funktional | — | Orphan-Scan nötig | 4-8h | 🟡 TEILWEISE |
| 5 | Brain | 5 Familien + HMM | Aladdin 30+ Factor | groß | 16-32h | 🔴 NEIN |
| 6 | ML | RF/GB 57.76%, PC defekt | FreqAI 3-Models, Renaissance 100+ | groß | 16-32h | 🔴 NEIN |
| 7 | Strategies | SINGLE/DCA/GRID/INF | Hummingbot Multi-Strategy | mittel | 8-16h | 🟡 TEILWEISE |
| 8 | State/Persist | JSON+SQLite Snapshot | Nautilus Event-Sourcing | mittel | 8-16h | 🟡 TEILWEISE |
| 9 | Safety | 11 Gates, HIGH-1 Bug | LEAN Risk-Manager | klein | 5min | 🔴 NEIN |
| 10 | Position-Sizer | 6-Multiplier-Chain | Kelly+HRP+Sortino | mittel | 8-16h | 🔴 NEIN |
| 11 | News | RSS+Sentiment | Two-Sigma News-NLP | groß | 16-24h | 🟡 TEILWEISE |
| 12 | AnomalyDetector | pressureScore+Cap | — | klein | 2-4h | 🟢 JA |
| 13 | Risk-Tier | DryRun+Promote | Aladdin Risk-Tier | mittel | 4-8h | 🟡 TEILWEISE |
| 14 | Walk-Forward | implementiert | FreqAI WF-Standard | klein | 2-4h | 🟢 JA |
| 15 | Microstructure | orderbook+ML | UNGEPRÜFT | UNBEKANNT | 4-8h | 🟡 UNGEPRÜFT |
| 16 | Whale/OnChain | Etherscan-live | UNGEPRÜFT | UNBEKANNT | 4-8h | 🟡 UNGEPRÜFT |
| 17 | Multi-Exchange | T8 deployed | NautilusTrader integrations | groß | 16-32h | 🟡 TEILWEISE |
| 18 | Wächter/Audit-Log | ConsistencyGuardian | LEAN Audit-Trail | klein | 2-4h | 🟢 JA |
| 19 | Hidden Issues | Silent failures + PC | — | mittel | 4-8h | 🟡 TEILWEISE |
| 20 | Patches | Heute 7 Patches | — | HIGH-1 + HIGH-2 | 20min | 🟡 TEILWEISE |

**Summary:**
- 🟢 JA Präsentierbar: **4/20** (Kapital, Anomaly, Walk-Forward, Wächter)
- 🟡 TEILWEISE: **9/20**
- 🔴 NEIN: **5/20** (Cross-Konsistenz, Brain, ML, Safety, Position-Sizer)
- 🟡 UNGEPRÜFT: **2/20** (Microstructure, OnChain)

**Bot-Status: noch NICHT Quant-Grade. Fix-Roadmap 20-40h für Mindest-Niveau.**

---

## M. FIX-ROADMAP zur Präsentierbarkeit

### Phase 1 — Schnell-Fixes (1-2 Tage)
1. HIGH-1 (5min) — duplicate profitabilityGreen
2. HIGH-2 (15min) — Dashboard-Aggregat-Filter
3. MED-5 (30min + Backtest 2h) — Symbol-Limit erweitern

### Phase 2 — Mittlere Engineering-Fixes (1 Woche)
4. HIGH-4 (1-2h) — Sub-Source-Audit
5. MED-6 (1h) — Fee-Check vor GRID
6. HIGH-3 (2-4h) — Perceptron Per-Klassen-Weights
7. MED-7 (4-8h) — ML SMOTE/Class-Weighting

### Phase 3 — Quant-Grade-Engineering (2-3 Wochen)
8. MED-8 (8h) — Kelly + Sortino
9. ML-Pipeline-Upgrade (XGBoost + Triple-Barrier-Labeling) — 16h
10. Per-Symbol ML statt globaler Pool — 16-32h
11. Brain-Sub-Factor-Decomposition wie Aladdin — 16-32h

### Phase 4 — Validation (1 Woche)
12. 30-Tage-Walk-Forward auf 6J-CSV
13. Stress-Test (Black-Swan-Replay)
14. Performance-Metriken: Sharpe > 1.0, Sortino > 1.5, Max-DD < 12%, ehrliche WR ≥ 50%
15. QUANT_GRADE_DOSSIER schreiben

---

## N. FINAL-VALIDATION-PLAN

### Phase A: Smoke (jetzt — kontinuierlich)
- Bot läuft 24h stabil mit Option-A1-Wallet
- 0 KillSwitch-Trigger
- Reserve unangetastet
- Pro Bot-Type: mind. 1 ehrlicher Profit-Cycle

### Phase B: Bull-Markt-Test (1 Woche)
- HMM-Posterior BULL muss mind. 1× erreicht werden
- Brain-Decision-Accuracy 4h-Horizon > 50%
- DD bleibt < 8%

### Phase C: Stress (gezielt)
- Black-Swan-Replay aus historical_data
- AnomalyDetector triggert sauber
- KillSwitch arbeitet bei DD > 12%
- Recovery-Mode aktiviert nach Reset

### Phase D: Performance-Validation (30 Tage Day-Zero-Cycle)
- Sharpe Ratio > 1.0 (Renaissance-Floor)
- Sortino Ratio > 1.5
- Max-Drawdown < 12%
- Win-Rate (T9.2 differenziert): SINGLE >50%, DCA >40%, GRID Range-bound (Buy-Sell-Cycles >70%)
- PF > 1.2 auf realisierten Trades

### Phase E: External Review
- QUANT_GRADE_DOSSIER schreiben
- Code-Walkthrough mit externem Reviewer simulieren
- Compliance-Checkliste Boutique-Quant

---

## O. PRÄSENTATIONS-DOSSIER (Vorbereitung)

**Pfad:** `docs/NEXUS_V9_QUANT_GRADE_DOSSIER_FINAL.md` (zu erstellen NACH allen Fixes)

**Inhalt-Plan:**
1. Architektur-Diagramm (Mermaid)
2. Pro Subsystem: Quant-Quelle + Implementierung + Test-Beweis
3. Performance-Metriken (30 Tage) vs Boutique-Quant-Benchmark
4. Risk-Management-Spec
5. Compliance-Checkliste (DSGVO, MiFID-II falls relevant)
6. Code-Coverage-Report
7. Security-Audit-Befund

---

## ABSCHLUSS

**Audit komplett für Bereiche 1-20 (Tiefe variiert).**

**Ehrliche Bewertung:** NEXUS V9 ist ein **ambitioniertes Crypto-Trading-System mit guter Architektur-Foundation** (HMM + Brain + ML + Multi-BotType), das aber **noch nicht auf institutional Boutique-Quant-Niveau** ist. Die heutigen Punkt-1/2-Fixes haben mathematische Korrektheit hergestellt — der nächste Schritt ist Quant-Grade-Architektur (Kelly, Per-Klassen-ML, XGBoost, Sub-Factor-Decomposition).

**Akut-Empfehlung Christian:** 
- HIGH-1 + HIGH-2 **JETZT** fixen (20min Aufwand, eliminiert 2 ungefixt Bugs)
- Bot weiter laufen lassen mit aktuellen Patches (NEAR-GRID profitiert mit ehrlicher Math)
- LIVE-Mode bleibt aus bis Phase 1-2 Roadmap abgeschlossen

**Nicht-Empfehlung:** "Wir sind auf Aladdin-Niveau" — bis HIGH-1/2/3/4 gefixt + Validation Phase D durch — **nicht sagen**.

---

**Audit Ende.** Christian-Entscheidung erbeten: welche Fix-Reihenfolge?
