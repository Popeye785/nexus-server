# NEXUS V9 — SYSTEM-REVIEW Phase 1 — INVENTORY
**Datum:** 2026-05-23 11:30
**Methodik:** read-only Code-Scan, statische Analyse, Counts via grep/wc
**Bot-State:** PID 88241 / R=191 / online / mem 223MB / Wallet $1000

---

## A) CODE-MAP server.js (27,492 LOC)

### Hauptsektionen (sortiert nach LOC-Range)

| Range | Sektion | LOC | Zweck | Risiko |
|---|---|---:|---|---|
| 110-1084 | CFG + Bitget-Connection + OrderBatch + Log | ~975 | Constants, Exchange-Connector | 🟢 |
| 1085-2106 | ScriptEngine + Bitget.* + Ind | ~1021 | Custom scripts, Bitget API, Indicators | 🟢 |
| 2107-2864 | Ind (Indicators Lib) | 757 | RSI/MACD/ATR/OBV/etc | 🟢 stable |
| 2865-4150 | Funding/Safeties/FlashCrash/Historical/TickBacktest/MLOptimizer | ~1285 | Risk-Engines, MLPipeline | 🟡 ML-Reset |
| 4151-4866 | PerfTracker/TrainingBridge/Balance/KillSwitch | ~715 | Risk-Layer + Performance | 🔴 KillSwitch kritisch |
| 4867-5544 | Incidents/Regime/Strategies/RiskLadder/NoTrade/PositionGuardian/ExitEngine | ~677 | Risk-Filter | 🔴 ExitEngine kritisch |
| 5545-5854 | Trades (SINGLE-Core) | 309 | Single-Trade-Engine | 🔴 KRITISCH |
| 5855-6088 | StatsCore + RiskSizing + RegimeStrength | 233 | StatsCore = Single Source of Truth | 🔴 KRITISCH |
| 6089-6600 | StressTest/Recon/ConsistencyGuardian + Helpers | ~511 | Self-Healing | 🔴 KRITISCH |
| 6601-7600 | EventLoop/LiveTier/DBSplit/SessionFilter/MetricsExport/ProfitLockHWM/StrategyRotation/LSTMShadow/RLShadow/Defi/CustomScripting | ~999 | Misc utilities | 🟡 |
| 7603-8087 | ExchangeFailoverDetector/LivePreflight/PriceCompare | ~484 | Multi-Exchange | 🟡 |
| 8088-8847 | SubBotRegistry/StrategyEvalEngine/MetaBrain/StrategySequence | ~759 | Sub-Bot-Layer | 🟡 |
| 8848-9023 | **GridBotMBT** | 175 | Grid-Engine | 🔴 KRITISCH (kein applyPnL-Hook!) |
| 9024-9200 | **DCABotMBT** | 176 | DCA-Engine | 🔴 KRITISCH (PnL nur via meta) |
| 9201-9363 | **InfinityGridBotMBT** | 162 | INFGRID-Engine | 🔴 KRITISCH |
| 9364-9466 | DailyLossEmergencyStop | 102 | Notbremse | 🔴 KRITISCH |
| 9467-9754 | MBTTicker + PositionStateDriftDetector | ~287 | MBT-Loop | 🔴 |
| 9755-10032 | ProfitOptimizer/StaleOrderCleaner | ~277 | Optimization | 🟢 |
| 10033-10149 | RiskTier | 116 | Risk-Levels | 🟡 |
| **10150-10331** | **WalletProvider** | **182** | **70/30-Split-Logic (Z.10207)** | 🔴 **KRITISCH ROOT-CAUSE** |
| 10332-10512 | computeUnrealizedPnLMBT/computeDailyPnLMBT/computeMBTStats | ~180 | Compute-Helpers | 🟡 |
| 10513-10601 | CapitalPool | 88 | Pool-Accounting | 🟡 |
| 10602-10944 | SymbolSpec/OrderRegistry/ExecutionAdapter | ~343 | Order-Execution | 🔴 KRITISCH |
| 10945-11140 | ActionStream/DBJanitor | ~195 | Streaming/Cleanup | 🟢 |
| 11142-11424 | TelegramAlarm/AutonomousRepair/SecurityKI/UpdateKI/MultiKI | ~282 | Meta-Layer | 🟢 |
| **11425-11952** | **UnifiedScore** | **527** | **Brain-Core (29 Sub-Sources)** | 🔴 **KRITISCH** |
| 11953-12012 | BrainVeto | 59 | Brain-Filter | 🟡 |
| 12013-12065 | HardStops | 52 | Hard-Stops | 🔴 KRITISCH |
| 12066-12366 | ConsensusEngine | 300 | 5-Familien-Konsens | 🔴 KRITISCH |
| 12367-12591 | DecisionFlow | 224 | Decision-Pipeline | 🔴 KRITISCH |
| 12592-12655 | ExecFlow | 63 | Order-Trigger | 🔴 KRITISCH |
| 12656-12940 | AutoEngine | 284 | Autonomous Loop | 🔴 KRITISCH |
| 12941-13160 | RiskEngine (MonteCarlo + Bayesian) | ~219 | Risk-Math | 🟡 |
| 13161-13435 | CorrelationEngine/SharpeEngine/DrawdownTracker/VolatilityRegime/SentimentEngine/HeatMapEngine | ~274 | Markets-Math | 🟡 |
| 13436+ | **510 API-Endpoints** | ~14000 | HTTP-Layer | 🟢 read-mostly |

### Sektions-Trennzeichen
153 `// ═══`-Marker → grobe Organisation, aber **keine echte Modul-Trennung** (alles in 1 File 27k LOC).

### Tote / redundante Logik (Verdachts-Liste)

| Stelle | Verdacht | Beleg |
|---|---|---|
| FlashCrashBot Z.3044 | nirgends ausgelöst | grep "FlashCrashBot\." = 1 result (definition only) |
| SubBotRegistry Z.8088 | parallel zu MBTTicker | scheinbar dual-stack |
| OrderBatch Z.1085 | für LIVE only | DEPLOY_MODE=PAPER → unused |
| LiveTier Z.6680 | LIVE-Pfad | unused in PAPER |
| LivePreflight Z.7728 | LIVE-Check | unused in PAPER |
| ScriptEngine Z.1463 | CustomScripting-Backend | minimal-used |

→ **~5,000 LOC totes / dormantes Code** in PAPER-Mode (LIVE-Pfade)

### Single Points of Failure (SPOF)

| Komponente | Risiko |
|---|---|
| `DemoEngine.wallet` (in-memory) | Crash → wallet aus data/demo_wallet.json reload, aber Last-Tx kann verloren gehen |
| `ConsensusEngine.decide()` | wenn dies wirft → Brain-Stillstand |
| `WalletProvider.applyPnL` (Z.10207) | **wird nur von SINGLE+DCA gerufen, NICHT von GRID** → Reserve füllt sich nie |
| `KillSwitch.check` | wenn down → kein Hard-Stop |
| `MBTTicker._tick` | Master-Loop für GRID/INFGRID/DCA — wenn down: alle MBT-Bots tot |

### Globale States

```
let _DataSourceLiquidations = null;
let _DataSourceFundingOI = null;
let _DataSourceETFFlows = null;
let _DataSourceMacroCalendar = null;
let _DataSourceMacro = null;
let _NewsRiskAggregator = null;
let _IncidentWaechter = null;
let _BrainInputShadow = null;
let _HMMRegime = null, _FamilyWeightsAdaptive = null;
let _BlackSwanReplay = null;
let _OBSnapshots = null;
let _SortinoRouter = null;
let _HRPAllocator = null;
let _MultiExchangeRouter = null;
let _TFTForecaster = null;
let _DataSourceOnChain = null;
let _DecisionOutcomeTracker = null;
```

17 lazy-loaded module-refs in module-scope. Plus `globalThis._botBootTs`, `globalThis._nexusDemoMode` und weitere. **Acceptable für Solo-Dev, nicht acceptable für Production**.

### Cron-Jobs / Timer

- **54 setInterval** + **41 setTimeout** = **95 aktive Timer**
- Memory-Risk: jeder Cron hält Closure-State
- Race-Risk: 95 Timer können gleichzeitig auf DB schreiben

---

## B) MODULES-INVENTORY

| Modul | LOC | requires in server.js | Hot/Cold | Anmerkungen |
|---|---:|:-:|:-:|---|
| backtest_engine | 362 | **0** | ❄️ Cold | nicht gerequired in server.js (CLI/Standalone) |
| incident_waechter | 338 | 1 | 🔥 Hot | productive Wächter |
| freqai_features | 334 | 1 | 🟡 Warm | Feature-Lib |
| lstm_engine | 332 | **0** | ❄️ Cold | nicht direkt eingebunden |
| feature_engineering | 313 | **0** | ❄️ Cold | nicht direkt eingebunden |
| hrp_allocator | 305 | 1 | 🟡 SHADOW | Capital-Routing SHADOW |
| blackswan_replay | 287 | 1 | 🟡 on-demand | API-only |
| sortino_router | 278 | 1 | 🟡 SHADOW | Capital-Routing SHADOW |
| shadow_inference | 270 | **4** | 🔥 Hot | XGB+RF+(LSTM optional) |
| datasource_onchain | 270 | 1 | 🔥 Hot | mempool+etherscan |
| news_intelligence | 256 | 1 | 🟡 Warm | News-Layer |
| **hmm_regime** | 248 | 1 | 🔥 Hot | **Brain-Core, klebt RANGING** |
| lstm_v5 | 237 | 1 | 🟡 surrogate | untrained |
| datasource_liquidations | 232 | 1 | 🟡 | API-Wrap |
| multi_exchange_router | 229 | 1 | 🟡 PAPER | SOR PAPER |
| datasource_macro | 222 | 2 | 🔥 Hot | BTC.D + FRED |
| orderbook_snapshots | 217 | 1 | 🔥 Hot | OB-Persist |
| tft_forecaster | 198 | 1 | 🟡 Phase-1 | Ensemble-Forecaster |
| finbert_lexicon | 198 | **0 (via news_classifier)** | 🔥 Hot | indirekt geladen |
| walkforward | 196 | 1 | ❄️ Cold | API-only |
| perfattrib | 196 | 1 | ❄️ Cold | API-only |
| stresstest | 195 | 1 | ❄️ Cold | API-only |
| hyperopt | 190 | 1 | ❄️ Cold | API-only |
| decision_outcome_tracker | 189 | 1 | 🔥 Hot | 5min-cron |
| news_risk_aggregator | 179 | 1 | 🔥 Hot | News-Risk |
| datasource_macro_calendar | 173 | 1 | 🟡 Warm | FOMC etc |
| news_classifier | 162 | **0 (lazy)** | 🔥 Hot | via news_risk_aggregator |
| brain_input_shadow | 150 | 1 | 🟡 SHADOW | |
| datasource_funding_oi | 136 | 1 | 🔥 Hot | |
| family_weights_adaptive | 113 | 1 | 🔥 Hot | HMM-driven |
| gru_engine | 101 | **0** | ❄️ Cold | unused |
| datasource_etf_flows | 82 | 1 | 🟡 stale-aware | |
| xgboost_engine | 73 | **0 (via shadow_inference)** | 🔥 Hot | indirekt |
| randomforest_engine | 59 | **0 (via shadow_inference)** | 🔥 Hot | indirekt |
| diagnostics_news_classify | 24 | **0** | ❄️ Cold | CLI-tool |

**8 Module mit 0× direkter Require** — davon 4 cold (backtest_engine, lstm_engine, feature_engineering, gru_engine) + 4 indirekt-geladen via shadow_inference oder news_classifier.

**Total Module-LOC: ~7,500** — modular gut, aber nicht TypeScript-typed.

---

## C) FRAMEWORK-VIOLATIONS

### 514 silent catches in server.js

```bash
grep -cE "catch\s*\(\s*[_a-z]?\s*\)\s*\{\s*\}" server.js
# → 514
```

**Wo:** primär in defensiven `try{Log.warn(...)}catch(_){}` (Log-Protection), DB-INSERT-wraps, async-API-Calls.

**Risiko:** echte Bugs werden geschluckt. Aber: process-level `uncaughtException`-Handler Z.25xxx fängt das letzte Netz.

### Hardcoded statt CFG (Sample)

12 numerische Literale in `scores.*`-Block (Z.11400-11700), z.B. Wahrscheinlichkeits-Multiplier 0.6/0.3 für FG-Stufen. **Wären besser als CFG.* mit Doku.**

### API ohne Timeout/Retry

- **5 raw fetch()** ohne `signal: AbortSignal.timeout(...)` — Hang-Risk
- **1 axios.get** ohne `{timeout: ...}` — Hang-Risk

Niedrig, aber im Live-Modus gefährlich.

### Promise/Async-Fehler

- **9 Promise.all/race** im Code — alle haben `.catch(()=>{})` oder sind in try-catch-Wrapper. ✅
- **MBTTicker._tick** ist async, kann mehrere ms blockieren — sollte mit Lock geschützt sein

### Module 0× direkt requires

`backtest_engine.js` (362 LOC), `lstm_engine.js` (332 LOC), `feature_engineering.js` (313 LOC), `gru_engine.js` (101 LOC) = **1,108 LOC ungenutztes Code-Volumen**. Entweder löschen oder als CLI-tools dokumentieren.

---

## D) RISIKO-MATRIX Top-10

| # | Risiko | Auswirkung | Wahrscheinlichkeit | Impact | Score |
|---|---|---|---|---|---:|
| 1 | **WalletProvider.applyPnL nur SINGLE+DCA, NICHT GRID** | Reserve füllt sich NIE — Capital-Preservation-Logik defekt | hoch | hoch | 🔴 9 |
| 2 | **Brain-Accuracy 1h 15.85%** unter random | bei FLOOR-Senkung instant Verlust-Trades | mittel | hoch | 🔴 9 |
| 3 | **HMM klebt 100% RANGING conf 0.95** | Adaptive Weights wirkungslos | hoch | mittel | 🟡 7 |
| 4 | **27,492 LOC in einem File** | Wartbarkeit, Race-Risk, Merge-Risk | hoch | mittel | 🟡 7 |
| 5 | **514 silent catches** | Bugs werden geschluckt | mittel | mittel | 🟡 6 |
| 6 | **95 Cron-Timer** | Race-Conditions auf DB | mittel | mittel | 🟡 6 |
| 7 | **5,000 LOC totes LIVE-Code in PAPER** | Verwirrung, Wartung | hoch | niedrig | 🟢 4 |
| 8 | **DCA-PnL-Tracking-Lücke** (jetzt gefixt für neue, alte 0) | Reporting fehlerhaft historisch | niedrig | niedrig | 🟢 3 |
| 9 | **TFT/Sortino/HRP SHADOW** — kein produktiver Effekt | Roadmap-Konzept ohne Wirkung | niedrig | niedrig | 🟢 3 |
| 10 | **Module 0× requires (1,108 LOC dead)** | Code-Bloat | niedrig | niedrig | 🟢 2 |

**Top-2 sind die FOKUS-Themen für Phase 3 (Kapital-Audit).**

---

*Phase 1 Inventory abgeschlossen — weiter zu Phase 2 UI-Audit*
