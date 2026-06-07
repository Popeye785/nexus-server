# NEXUS V9 — TIEFEN-AUDIT TAG 4 (READ-ONLY)
## Vollständiges Röntgen-Bild nach Roadmap-Complete

**Verankert:** 2026-05-20 15:15
**Methodik:** Live-Queries auf nexus.db (1.0 GB), API-Endpoint-Probes, grep über server.js (28k Zeilen), pm2-Diagnose
**Bot-State:** PID 43592 / R=179 / online / mem 173 MB / uptime 22min
**Modus:** READ-ONLY. Keine Code-Eingriffe.

> **Wahrheits-Standard:** Schönrederei verboten. Wenn etwas deklariert aber nicht produktiv ist → DEKLARIERT. Wenn etwas läuft aber konstant 0% Beitrag liefert → SCHEINLOGIK. Bei Widersprüchen Code vs Realität → benannt.

---

# KAPITEL 1 — BRAIN-AUDIT

## 1.1 Sub-Source-Detail-Audit (29 Sub-Sources, 24h Sample)

**38,979 decisions in 24h, 646,568 member-appearances.**

| Sub-Source | Total | Active% | BUY | SELL | avg_score | min | max | avg_conf | VERDICT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| monteCarlo | 29,438 | **100%** | 29438 | 0 | **0.300** | 0.300 | 0.300 | 0.700 | 🔴 **SCHEINLOGIK** (konstant +0.3 BUY) |
| fearGreed | 29,438 | **100%** | 29438 | 0 | **0.300** | 0.300 | 0.300 | 0.400 | 🔴 **SCHEINLOGIK** (FG-API liefert 27=Fear, aber Score hardcoded +0.3 BUY) |
| smartMoney | 20,554 | 100% | 20554 | 0 | **0.700** | 0.700 | 0.700 | 0.650 | 🔴 **SCHEINLOGIK** (konstant +0.7 BUY) |
| patterns | 9,992 | 100% | 5553 | 4439 | 0.096 | -0.85 | 0.85 | 0.81 | ✅ PRODUKTIV |
| liquidations | 53 | 100% | 44 | 9 | 0.247 | -0.50 | 0.40 | 0.56 | 🟡 PARTIAL (niedrige Sample) |
| etfFlows | 9,822 | 100% | 0 | 9822 | **-0.300** | -0.30 | -0.30 | 0.39 | 🔴 **SCHEINLOGIK** (konstant -0.3 SELL) |
| newsRisk | 4,910 | 100% | 0 | 4910 | **-0.700** | -0.70 | -0.70 | 0.95 | 🔴 **SCHEINLOGIK** (konstant -0.7 SELL — sollte aus factor/polarity variieren) |
| strategies | 4,520 | 99.7% | 402 | 4105 | -0.634 | -0.92 | 0.92 | 0.34 | ✅ PRODUKTIV |
| heatScore | 29,438 | 87.0% | 25603 | 0 | 0.248 | -0.10 | 0.30 | 0.50 | 🟡 PARTIAL (nur BUY-Side aktiv) |
| macroRegime | 7,482 | 77.3% | 0 | 5784 | -0.309 | -0.40 | 0.00 | 0.69 | 🟡 PARTIAL (nur SELL-Side, keine BUY-Cases) |
| sharpe | 29,438 | 76.6% | 1217 | 21322 | -0.155 | -0.30 | 0.50 | 0.50 | ✅ PRODUKTIV |
| **obImbalance** | 440 | 72.5% | 233 | 86 | 0.035 | -0.52 | 0.40 | 0.39 | ✅ NEU (STUFE 8 live) |
| reddit | 29,438 | 67.2% | 16323 | 3458 | 0.132 | -0.60 | 0.45 | 0.40 | ✅ PRODUKTIV |
| bayesian | 29,438 | 63.1% | 7781 | 10780 | -0.091 | -0.70 | 0.75 | 0.58 | ✅ PRODUKTIV |
| ichimoku | 29,438 | 58.3% | 5754 | 11410 | -0.135 | -0.70 | 0.70 | 0.50 | ✅ PRODUKTIV |
| rlAgent | 29,438 | 51.7% | 14079 | 1148 | 0.087 | -0.33 | 0.33 | 0.25 | ✅ PRODUKTIV |
| elliott | 29,438 | 44.9% | 2177 | 9858 | -0.078 | -0.30 | 0.30 | 0.30 | ✅ PRODUKTIV |
| var95 | 8,696 | 35.6% | 2221 | 871 | 0.031 | -0.20 | 0.20 | 0.60 | 🟡 PARTIAL |
| cvd | 29,438 | 25.1% | 5507 | 1875 | 0.089 | -0.72 | 0.72 | 0.35 | 🟡 PARTIAL |
| volatility | 29,438 | 23.7% | 6973 | 0 | 0.095 | 0.00 | 0.40 | 0.60 | 🟡 PARTIAL (nur BUY) |
| news | 29,438 | 16.8% | 3757 | 1177 | -0.026 | -0.45 | 0.12 | 0.80 | 🟡 PARTIAL |
| correlation | 25,008 | 13.7% | 0 | 3420 | -0.097 | -0.60 | 0.00 | 0.60 | 🟡 PARTIAL (nur SELL) |
| funding | 29,438 | 5.7% | 1669 | 0 | 0.015 | 0.00 | 0.40 | 0.37 | 🟡 PARTIAL |
| **regime** | 29,438 | 3.9% | 651 | 484 | 0.024 | -0.15 | 0.15 | 0.66 | 🟡 STUFE2-FIX wirkt schwach (nur 3.9% statt erwartete ~30%) |
| **mlEnsemble** | 29,438 | 1.7% | 25 | 480 | -0.009 | -0.64 | 0.18 | 0.83 | 🟡 STUFE2-FIX wirkt schwach (1.7% statt 19.3%) |
| **oi** | 29,438 | 0.6% | 58 | 112 | -0.001 | -0.35 | 0.30 | 0.31 | 🔴 **EFFEKTIV TOT** (RANGING-Markt) |
| **anomaly** | 29,438 | 0.2% | 0 | 65 | 0.094 | -0.40 | 0.10 | 0.49 | 🔴 **EFFEKTIV TOT** |
| **btcCorr** | 25,334 | 0.02% | 6 | 0 | 0.000 | 0.00 | 0.10 | 0.30 | 🔴 **EFFEKTIV TOT** (BTC unbewegt) |
| **macroCalendar** | 29,311 | **0.0%** | 0 | 0 | 0.000 | 0.00 | 0.00 | 0.37 | 🔴 **VOLLSTÄNDIG TOT** (FOMC-Window-Logik greift nicht) |

### Verdict Sub-Sources

**5 SCHEINLOGIK (konstante Scores, ignorieren echte Daten):**
- `monteCarlo`, `fearGreed`, `smartMoney`, `etfFlows`, `newsRisk`

→ **Beweis:** FG-API liefert `{value:27, signal:'FEAR_CAUTIOUS_BUY'}` aber `scores.fearGreed` ist hardcoded +0.3 in 100% der Cases. Dieselbe Lage bei `newsRisk` (sollte aus factor 3.09 / polarity -0.10 variieren — ist hardcoded -0.7).

**3 EFFEKTIV TOT** (markt-bedingt, aber dadurch ohne Beitrag):
- `oi` (0.6%), `anomaly` (0.2%), `btcCorr` (0.02%)

**1 VOLLSTÄNDIG TOT:**
- `macroCalendar` (0% in 24h trotz FOMC Minutes 6.7h-Window heute Mittag)

**2 STUFE-2-Fixes wirken schwach** (heute deployed mit 19-33% Hit-Rate, jetzt nur 1.7-3.9%):
- `regime` (Trend-Vorzeichen-Patch greift selten)
- `mlEnsemble` (Soft-Bias greift kaum)

→ Vermutung: nach Deploy schloss sich Markt-Pattern und der "Fenster"-Effekt der initialen Aktivierung verflüchtigte. Brauche längere Beobachtung.

## 1.2 Familie-Audit (24h)

| Familie | Members | Total Evals | Active% | Status |
|---|---:|---:|---:|---|
| TREND | 3 (elliott/ichimoku/strategies) | 38,979 | 56.4% | ✅ aktiv |
| MOMENTUM | 3 (cvd/patterns/rlAgent) | 38,979 | 54.2% | ✅ aktiv |
| RISK | 10 (10 sub-sources) | 38,979 | 45.8% | 🟡 aber 4 Members konstant (monteCarlo/newsRisk/etfFlows/var95) |
| SENTIMENT | 7 (fearGreed/news/reddit/onChain/smartMoney/etfFlows/macroCalendar/macroRegime) | 38,979 | 68.8% | 🟡 aber konstante Members verzerren Score |
| MICROSTRUCTURE | 6 (anomaly/btcCorr/correlation/heatScore/obImbalance/regime) | 38,979 | 66.8% | 🟡 aber 3 Members effektiv tot |

→ **Brutto-Coverage 45-69%, Netto-informative Coverage deutlich niedriger** weil ~30% der active-Sub-Sources konstant sind.

## 1.3 HMM-Regime-Audit

**State-Verteilung 24h (110 ticks):**
| State | n | avg_conf | min_conf | max_conf |
|---|---:|---:|---:|---:|
| RANGING | 106 | 0.971 | 0.461 | 0.990 |
| BULL | 4 | 0.588 | 0.355 | 0.878 |

**Transition-Matrix 24h:**
- `RANGING → RANGING`: 105
- `BULL → BULL`: 3
- `BULL → RANGING`: 1
- Andere Übergänge: 0

**Posterior aktuell:** `{BULL: 0.016, BEAR: 0.001, RANGING: 0.982, CRASH: 4e-6, RECOVERY: 0.0007}`

→ **HMM klebt in RANGING** (98.2%). State-Wechsel BULL/BEAR/CRASH/RECOVERY de facto nicht in der 24h-Beobachtung. **Adaptive FAMILY_WEIGHTS sind effektiv = RANGING-Profile** (was dem alten statischen FAMILY_WEIGHTS entspricht). 
→ HMM funktioniert technisch (cron 60s tick läuft), aber **adaptive Wirkung = 0** im aktuellen Markt.

## 1.4 Brain-Decision-Pipeline-Audit

| Decision-Stufe | Count 24h |
|---|---:|
| Decisions total | 38,979 |
| BUY | 26,681 (68%) |
| SELL | 2,603 (7%) |
| HOLD | 9,695 (25%) |
| **Confidence ≥ 0.4** | **0** (!) |
| Confidence 0.2-0.4 | 24 |
| Confidence 0.05-0.2 | 21,570 |
| NEAR_ZERO (<0.05) | 17,385 |

**Veto-Triggers (blocked_trades 24h):**
- `NEWS_EXTREME_BLOCK`: 134
- `FLOOR_THRESHOLD`: 118

**Live-Sample (jetzt):**
- ETH: BUY conf=**0.098** "3B/0S/2N"
- BTC: BUY conf=**0.080** "4B/0S/1N"
- SUI: BUY conf=**0.026** "2B/1S/2N"

→ **Brain hat KEINE Convictions.** 0 Decisions mit conf ≥ 0.4 in 24h. Floor 0.08 schneidet fast alles ab.
→ **26,681 BUY-Decisions in 24h → 1 (eine!) Trade-Open in der trades-Tabelle 24h** = Brain spricht ins Leere

---

# KAPITEL 2 — DATEN-FUNDAMENT-AUDIT

## 2.1 DB-Tabellen-Inventar (Top-by-Rows)

**DB-Größe: 1.0 GB**

| Tabelle | Rows |
|---|---:|
| candle_cache | 4,062,040 |
| consensus_decisions | 270,105 |
| aladdin_decisions | 269,180 |
| binance_metrics_history | 103,680 |
| balance_history | 20,626 |
| funding_oi_history | 17,050 |
| wallet_ledger | 8,092 |
| brain_input_log | 6,259 |
| strategy_performance | 3,033 |
| news_feed | 2,747 |
| blocked_trades | 2,105 |
| strategy_regime_performance | 300 |
| **orderbook_history** | **255** (STUFE 8) |
| walk_forward_runs | 173 |
| **hmm_state** | **110** (STUFE 1) |
| waechter_actions | 102 |
| **best_route_log** | **53** (STUFE 9) |
| **macro_state** | **57** (STUFE 7) |
| **sortino_allocations** | **6** (STUFE 4 SHADOW) |
| **hrp_allocations** | **5** (STUFE 6 SHADOW) |
| **tft_forecasts** | **3** (STUFE 10) |
| **on_chain_state** | **1** (STUFE 7 — fast tot) |

## 2.2 Daten-Freshness-Audit

| Quelle | Letztes Update | Alter | Status |
|---|---|---|---|
| BTC 1h candles | jetzt-9 min | OK | ✅ |
| BTC 4h candles | jetzt-69 min | OK | ✅ |
| **BTC 15min candles** | **2026-05-13 14:45** | **7.0 Tage** | 🔴 **STALE** |
| **ETH 15min candles** | **2026-05-01 01:45** | **19.6 Tage** | 🔴 **STALE** |
| news_feed | 24 min ago | OK | ✅ |
| macro_state btcd | 2.8 min ago | OK | ✅ |
| macro_state dxy/us10y | 17.7 min ago | OK | ✅ |
| orderbook_history | 17 sec ago | OK | ✅ |
| hmm_state | 47 sec ago | OK | ✅ |
| funding_oi BTC/ETH/SOL/etc | 2-4 min | OK | ✅ |
| **funding_oi LTC/OP/SEI** | **41-46h** | 🔴 **EFFEKTIV TOT** |
| **funding_oi DOGE/AVAX/LINK** | **4-6h** | 🟡 Verzögert |
| **on_chain_state** | **2026-05-20 15:01** (1 row) | OK aber **fast leer** | 🔴 |
| tft_forecasts | 24 min ago | nur on-demand | 🟡 KEIN CRON |
| lstm_shadow | **2026-05-15 17:57** | **5 Tage tot** | 🔴 |

## 2.3 Verwaiste Tabellen-Suche

**Read-only-Tabellen (nur DDL, kein Schreiben?):** keine identifiziert in 24h
**Write-only-Tabellen (nur Schreiben, kein Lesen?):**
- `tft_forecasts`: schreibt bei API-Forecast, aber **NICHT vom Brain gelesen** 🔴
- `sortino_allocations`: schreibt bei Cron, aber **NICHT vom Capital-Pool gelesen** 🔴
- `hrp_allocations`: schreibt bei Cron, aber **NICHT vom Allocator gelesen** 🔴

---

# KAPITEL 3 — RISK-LAYER-AUDIT (9 Schichten)

| Layer | Activity 24h | Status |
|---|---|---|
| 1. AladdinBrain.Vetos | NEWS_EXTREME 134x, FLOOR 118x | ✅ aktiv |
| 2. KillSwitch | 0 trigger | ✅ ruhig |
| 3. **AUTO_NOTBREMSE** | **4× heute 11:34 / 11:02 / 10:47 / 10:40** | 🔴 **FALSE-ALARM** (GRID-fee-misread; siehe NOTBREMSE_FIX) |
| 4. Position-Sizer (6 Mult) | aktiv pro decision | ✅ |
| 5. Wächter "Putzmann" | **102 Actions, 26 dry, 76 productive — alle ANOMALY_DEDUP_CLEAN** | 🟡 **nur 1 Action-Type** |
| 6. WalletReconciler | drift=0 (kein recon-Log heute) | ✅ |
| 7. ConsistencyGuardian | 202 persistence_refresh, 1 position_state_drift (gestern) | ✅ |
| 8. ExecutionAdapter | 1 trade opened in 24h | 🟡 fast-stillstand |
| 9. **Black-Swan-Replay (STUFE 5)** | **0 Aufrufe seit Deploy** | 🟡 **on-demand-only, kein Cron** |

## 3.1 Position-Sizer-Live-Sample (entry_*-Spalten)

| confidence | sl_pct | risk_mult | regime_class | regime_mult |
|---:|---:|---:|---|---:|
| 0.136 | 3.7% | 0.825 | NEUTRAL | 1.0 |
| 0.106 | 2.2% | 0.413 | NEUTRAL | 1.0 |
| 0.051 | 1.1% | 0.578 | NEUTRAL | 1.0 |
| 0.065 | 0.8% | 0.578 | NEUTRAL | 1.0 |
| 0.058 | 1.1% | 0.825 | NEUTRAL | 1.0 |

→ Position-Sizer schreibt entry_*-Spalten korrekt. `entry_regime_class` ist immer **NEUTRAL**, weil Brain selten BULL/BEAR detect — passt zu HMM-RANGING-Bias.

## 3.2 AUTO_NOTBREMSE False-Alarms

4 Triggers heute Morgen mit -181 / -144 / -181 / -18 USDT realized-dailyPnl, alle GRID-Kategorie. Das ist der **gemeldete-Fee-Pnl-Misread-Bug** der heute behoben werden sollte ("NOTBREMSE_FIX") — diese 4 Triggers waren VOR Fix-Deploy.

---

# KAPITEL 4 — BOT-TYPEN-AUDIT

## 4.1 Trades-Schema-Inkonsistenz 🔴

```
SELECT bot_type, COUNT(*) FROM trades GROUP BY bot_type
→  ('', 29)        ← alle trades haben bot_type = LEER
```

**CRITICAL FINDING:** Die `bot_type`-Spalte existiert in der trades-Tabelle, ist aber für **alle 29 trades NULL/empty**. `strategy`-Spalte hat die richtigen Labels (`DEMO_SINGLE_TREND_FOLLOW`, `DEMO_UNIFIED`, ...). 

**Konsequenz:** Sortino-Router-Auto-Switch nach 14d kann **NICHT funktionieren**, weil seine SQL `WHERE bot_type=X` keine rows findet. Die `strategy_regime_performance`-Tabelle hat bot_type korrekt (das ist die Quelle für Sortino), aber **trades-Tabelle ist disconnected**.

## 4.2 Bot-Type-Activity 7d

**strategy_regime_performance 24h (Sortino-Datenquelle):**
| bot_type | regime | events | pnl | avg_pnl |
|---|---|---:|---:|---:|
| GRID | NEUTRAL | 141 | $6.44 | $0.046 |
| GRID | RANGING | 160 | $7.31 | $0.046 |

→ **NUR GRID-Daten.** SINGLE/INFGRID/DCA haben **0 Events**. Sortino-Router kann allenfalls GRID vs nichts vergleichen — **kein Tilt möglich.**

## 4.3 Trade-Performance 7d

**trades-Tabelle 7d (alle bot_type leer):**
| state | count | realized_pnl | wr |
|---|---:|---:|---:|
| CLOSED | 23 | $4.70 | 43.5% |
| POSITION_ACTIVE | 1 | — | — |
| ARCHIVED_PHANTOM | 1 | — | — |

Best: SUIUSDT +3.74, +3.13 / OPUSDT +2.42
Worst: SUIUSDT -1.76 / XRPUSDT -1.72 / APTUSDT -1.59

## 4.4 Capital-Pool — Status

**Demo-Wallet (data/demo_wallet.json):**
- Total: **$925.23** USDT
- Reserve: $15.04 (1.6%)
- Trading: $910.18 (98.4%)
- Start: $1000
- **Lifetime PnL: -$74.77** (-7.5%)
- Phantom-Refund 19.05.: +$98.40 (sonst wäre -$173)
- peakTotal-Migration: 1217 → 1002 (AUDFIX_035)

**70/30 Reserve-Ratio nicht eingehalten** (1.6% Reserve statt 70%). Vermutlich AUDFIX-Folge oder fehlende Re-Balance.

→ **Sortino+HRP würden nichts ändern** weil derzeit nur GRID daten hat.

---

# KAPITEL 5 — ML/AI-MODULE-AUDIT (34 Module)

| Modul | LOC | Last DB-Activity | Brain-Integration | VERDICT |
|---|---:|---|---|---|
| shadow_inference.js | — | 3348 preds 24h ✅ | im Cycle | ✅ LIVE |
| backtest_engine.js | 13816 | on-demand | API | 🟡 ON-DEMAND |
| **blackswan_replay.js** | 12294 | on-demand | API | 🟡 **0 Aufrufe seit Deploy** |
| brain_input_shadow.js | 6793 | 6275 logs 24h | ja | ✅ LIVE |
| ccxt_exchanges.js | 4017 | — | Failover | ✅ LIVE |
| datasource_etf_flows.js | 3044 | im scores.etfFlows | ja | 🔴 SCHEINLOGIK (konstant -0.3) |
| datasource_funding_oi.js | 6337 | 17050 rows | ja | 🟡 partial (3 von 16 symbols stale) |
| datasource_liquidations.js | 9598 | 104 rows | ja | 🟡 partial (53 brain-events) |
| datasource_macro_calendar.js | 7390 | events present | ja | 🔴 **0% active 24h trotz STUFE-2-Fix** |
| datasource_macro.js | 9051 | 57 rows | ja (macroRegime) | 🟡 nur SELL-Side |
| **datasource_onchain.js** | 8714 | **1 row** | ja | 🔴 **fast tot** |
| **family_weights_adaptive.js** | 4355 | implizit via Brain | ja Z.26319 | ✅ LIVE aber im RANGING-RANGING-Modus |
| feature_engineering.js | 12042 | — | ja | ✅ LIVE |
| **finbert_lexicon.js** | 8322 | im news_classifier | ja | ✅ LIVE (175 vocab terms) |
| freqai_features.js | 13039 | — | ML | 🟡 |
| gru_engine.js | 4299 | — | surrogate | 🟡 SURROGATE |
| **hmm_regime.js** | 8727 | 110 ticks (60s cron) | ja Z.26319 | ✅ LIVE aber 98.2% RANGING |
| **hrp_allocator.js** | 11433 | 5 SHADOW logs | **NEIN** | 🔴 **DEKLARIERT** (`getAllocation()` 0 Aufrufe außerhalb API) |
| hyperopt.js | 7287 | on-demand | — | 🟡 |
| incident_waechter.js | 13349 | 102 actions/7d | ja | 🟡 nur 1 Action-Type aktiv |
| lstm_engine.js | 14844 | 0 shadow 24h | ja in MLOptimizer | 🟡 LSTM-Shadow 5d tot |
| lstm_v5.js | 8934 | surrogate JSON | — | 🟡 SURROGATE |
| **multi_exchange_router.js** | 9179 | 53 best_route_log | **NUR API** | 🟡 PAPER, kein Order-Pfad |
| news_classifier.js | 5650 | inkl. FinBERT | ja | ✅ LIVE |
| news_intelligence.js | 12383 | — | partial | 🟡 |
| news_risk_aggregator.js | 5549 | factor 3.09 live | ja | ✅ LIVE aber **scores.newsRisk hardcoded -0.7** 🔴 |
| **orderbook_snapshots.js** | 8913 | 255 rows, 60/30min/sym | ja (obImbalance) | ✅ LIVE |
| perfattrib.js | 6804 | — | API | 🟡 |
| randomforest_engine.js | 1818 | shadow_inference | ja | ✅ LIVE |
| shadow_inference.js (dup) | 11558 | 3348/24h | ja | ✅ LIVE |
| **sortino_router.js** | 10420 | 6 SHADOW logs | **NEIN** | 🔴 **DEKLARIERT** (`getAllocation()` 0 Aufrufe außerhalb API) |
| stresstest.js | 7130 | on-demand | API | 🟡 |
| **tft_forecaster.js** | 8823 | 3 forecasts (API-only) | **NEIN** | 🔴 **DEKLARIERT** (`getDirectionSignal()` 0 Aufrufe, kein Cron) |
| walkforward.js | 7534 | 173 runs | API | 🟡 ON-DEMAND |
| xgboost_engine.js | 2285 | shadow_inference | ja | ✅ LIVE |

### Status-Verteilung
- ✅ LIVE produktiv: 12 Module
- 🟡 PARTIAL / ON-DEMAND / SURROGATE: 14 Module
- 🔴 **DEKLARIERT (nicht in Brain integriert)**: 4 Module — TFT, Sortino, HRP, On-Chain
- 🔴 **SCHEINLOGIK** (konstante Scores trotz Live-Daten): 5 Sub-Sources — fearGreed, monteCarlo, smartMoney, etfFlows, newsRisk

---

# KAPITEL 6 — AUTONOMIE + STABILITÄT-AUDIT

| Metric | Wert |
|---|---|
| PID | 43592 |
| Restart Count | R=179 |
| Uptime (current process) | 22 min |
| Status | online |
| Memory (RSS) | 173 MB |
| CPU | 9.5% |
| Decisions/min | ~27 (38979/24h /1440) |
| **KillSwitch-Triggers 24h** | **0** ✅ |
| **AUTO_NOTBREMSE 24h** | **4** 🔴 (alle GRID-fee-Misread) |
| Wächter-Actions 24h | 102 (alle ANOMALY_DEDUP, 26 dry) |
| Reconciliation-Drift 7d | 1 CRITICAL (gestern 21:42 position_state_drift COUNT_DRIFT 1) |
| pm2-Reloads heute | 10 (Stufe 1-10 deploys) |
| Trades opened 24h | **1** |

**Tradings-Aktivität:** Bot ist effektiv **stillstand** in autonomous-Trades. GRID-Bots laufen weiter (51k USDT GRID_BUY + 51k GRID_SELL flows in 24h via wallet_ledger), aber das ist **schon-vorhandene GRID-Maschine**, nicht Brain-driven.

---

# KAPITEL 7 — ENDPOINTS+UI-AUDIT

| Metric | Wert |
|---|---|
| Total Endpoints | **510** (300 GET, 197 POST, 12 DELETE, 1 PUT) |
| Unique routes in server.js | 491 |
| Routes von UI referenziert | 166 |
| Routes NUR im Backend | 333 (Endpunkt-überschuss) |
| Neue Endpoints heute | 30 (alle 200 OK live ✅) |

**Neue Endpoint-Familien — UI-Verbindung:**

| Family | server.js | UI | Status |
|---|:-:|:-:|:-:|
| /api/blackswan/* | 3 | **0** | ❌ kein UI |
| /api/sortino/* | 5 | **0** | ❌ kein UI |
| /api/hrp/* | 3 | **0** | ❌ kein UI |
| /api/onchain/* | 2 | **0** | ❌ kein UI |
| /api/orderbook/* | 3 | **0** | ❌ kein UI |
| /api/sor/* | 9 | **0** | ❌ kein UI |
| /api/tft/* | 3 | **0** | ❌ kein UI |
| /api/macro/* | 2 | **0** | ❌ kein UI |

→ **30 neue Endpoints, 0 davon in der UI gerendert.** Live-API-Probes alle 200 OK (Endpoints leben), aber **UI ist seit der Roadmap nicht erweitert worden**.

---

# KAPITEL 8 — INTEGRATIONS-KONSISTENZ-AUDIT

## 8.1 Brain-Decision → Trade-Execution (KRITISCH)

| Stufe | Count 24h |
|---|---:|
| Decisions BUY | 26,681 |
| Decisions SELL | 2,603 |
| Decisions HOLD | 9,695 |
| **Tatsächlich opened trades** | **1** |
| **Gap-Ratio** | **29,283 → 1 = 99.997% Block-Rate** 🔴 |

→ **MASSIVE GAP.** Brain entscheidet, Trades passieren nicht. Vermutete Ursachen:
- VLOW confidence (Brain conf=0.026-0.098 für aktuelle Symbole)
- FLOOR_THRESHOLD=0.08 schneidet 99% ab
- NEWS_EXTREME_BLOCK 134x
- Position-Sizer-Skip bei sub-min-size
- Slot-voll (1 POSITION_ACTIVE — Slot-Limit 1)

## 8.2 Trade-Close → strategy_regime_performance

| Source | 24h count |
|---|---:|
| trades (state=CLOSED, closed_at 24h) | **0** |
| strategy_regime_performance 24h | **305** |

→ **Diskrepanz:** trades-Tabelle zeigt 0 Closed in 24h, aber strategy_regime_performance loggt 305 Events. **GRID-Fills werden in srp geloggt, aber nicht als single-row in trades-Tabelle abgebildet.** Architektur-by-design: GRID-fills sind sub-trades, nicht atomare trades.

## 8.3 Wallet-Konsistenz

**wallet_ledger Net-Sums:**
- GRID_BUY $51,167 vs GRID_SELL $51,184 → **net +$17.4** (Grid-PnL nach Fees realisiert)
- DEBIT $2,168 vs CREDIT $1,996 → **net -$172** 
- DCA_BUY $440 + backfill $120 → net -$560 (positions noch offen?)
- PHANTOM ARCHIVE/REFUND $98.4 ↔ $98.4 → net 0 ✅

**Wallet aktuell $925.23 USDT** vs Start $1000 → **-$74.77**

→ Wallet-Buchhaltung **scheint konsistent**, aber 70/30-Reserve-Ratio NICHT eingehalten (Reserve $15 = 1.6%, soll 70%).

## 8.4 HMM-Regime → FAMILY_WEIGHTS → Decision

- HMM-Posterior: RANGING 0.982
- `_FamilyWeightsAdaptive.resolve(posterior)` → resolved-weights ≈ FIXED_FALLBACK
- ConsensusEngine.aggregate Z.26326 nutzt `_activeW[name]`
- → **HMM wirkt nicht aktiv** weil 98.2% RANGING = Default-Profile

## 8.5 News-Risk-Aggregator → Position-Sizer

- News-Risk factor=3.09 polarity=-0.10
- Position-Sizer-Mult `newsRiskMult = max(0.2, 1 - 0.4 × factor) = max(0.2, -0.236) = 0.2`
- → **Position-Größe würde auf 20% reduziert** (Hard-Floor erreicht)
- ABER: scores.newsRisk im Brain-Score ist hardcoded -0.7 (konstant in 24h)
- → **Inkonsistenz**: Position-Sizer-Mult-Pfad nutzt factor (richtig), Brain-Score-Pfad nutzt hardcode (Scheinlogik)

---

# KAPITEL 9 — PERFORMANCE-AUDIT

## 9.1 Trade-Performance 7d
- 23 closed trades, $4.70 net, **WR 43.5%**
- Avg: $0.20 per trade
- Variance: -1.76 bis +3.74

## 9.2 GRID-Performance 24h (über strategy_regime_performance)
- 301 events
- $13.76 net PnL
- Avg $0.046/event
- WR ~50% (nicht direkt aus Tabelle)

## 9.3 Brain-Performance
- **Decision-Accuracy konnte nicht gemessen werden** (keine OUTCOME-eval Tabelle in 24h aktiv)
- **0 Decisions mit HIGH/MID conf** → Brain ist "low-conviction-Modus"
- Sub-Source-Hit-Rate-Tracking: aladdin_perf-Tabelle existiert mit 157 historischen Rows, aber 0 neue heute

## 9.4 Black-Swan-Replay Wahrheits-Check
- COVID/LUNA/3AC/FTX/Banana → 96.3% avg Capital-Preservation
- ABER: **das ist Simulation mit vereinfachtem Brain-Sim**, nicht realer Live-Behavior
- Realer Brain ist heute confidence-floor-bound → würde in Live-Krise vermutlich anders reagieren

→ Black-Swan-Numbers sind **plausibel, aber kein Garantie**

---

# KAPITEL 10 — VERSTECKTE PROBLEME (KRITISCH)

## 10.1 SCHEINLOGIK — Sub-Sources mit konstanten Scores

🔴 **5 Sub-Sources liefern in 24h IDENTISCHE Scores** (min == max):

```
monteCarlo:   100% +0.300 BUY (29438 events)
fearGreed:    100% +0.300 BUY (Echte FG=27=Fear, aber hardcoded)
smartMoney:   100% +0.700 BUY
etfFlows:     100% -0.300 SELL
newsRisk:     100% -0.700 SELL (Echte factor=3.09 polarity=-0.10 ignoriert)
```

**Diagnose:** Code-Pfad in server.js mapped diese Modul-Outputs auf Brain-Scores mit **Hardcoded-Values**. Echte Modul-Daten (FG-API, News-Aggregator etc.) sind verfügbar, werden aber nicht in scores eingespeist.

**Impact:** Brain bekommt 5 von 29 Sub-Sources als Rauschen mit Bias (+1.6 BUY, -1.0 SELL = +0.6 BUY-Drift). Erklärt teilweise den BUY-Bias 10:1.

## 10.2 DEKLARIERTE Module ohne Brain-Wirkung

🔴 **4 Module sind deployed aber NICHT im Trading-Pfad gerufen:**

| Modul | API verfügbar | Brain-Aufruf? |
|---|:-:|:-:|
| TFT-Forecaster | ✅ /api/tft/* | ❌ `getDirectionSignal()` 0 calls |
| Sortino-Router | ✅ /api/sortino/* | ❌ `getAllocation()` 0 calls |
| HRP-Allocator | ✅ /api/hrp/* | ❌ `getAllocation()` 0 calls |
| Multi-Exchange-Router | ✅ /api/sor/* | ❌ kein Order-Pfad (PAPER by-design) |
| Black-Swan-Replay | ✅ /api/blackswan/* | ❌ on-demand-only, kein Schedule |

→ **5/10 Roadmap-Stufen sind "API-only, kein Trading-Pfad-Integration"**. SHADOW-Klassifizierung (Sortino/HRP) ist okay, aber TFT war als "produktive Forecast-Quelle" gedacht und ist es nicht.

## 10.3 TOTE Datenquellen

🔴 **3 Live-Datenpfade liefern fast nichts:**

| Quelle | DB-rows 24h | Erwartet |
|---|---:|---|
| on_chain_state | **1** | ~96 (15min cron) |
| lstm_shadow | **0** | ~1440 (1/min) |
| tft_forecasts | **3** (alle on-demand) | kein cron — by-design |

**on_chain_state nur 1 row** bedeutet: Etherscan + blockchain.info + 2 von 3 mempool.space-Endpoints sind silent gescheitert. **Brain scores.onChain ist effektiv tot.**

## 10.4 SCHEMA-INKONSISTENZ — bot_type leer

🔴 **trades.bot_type ist für alle 29 trades NULL/empty**. Sortino/HRP-Auto-Switch nach 14d-Daten kann NICHT funktionieren weil die Quelle `trades.bot_type` leer ist.

**Workaround:** Sortino zieht aus `strategy_regime_performance` (das hat bot_type) — aber dort sind nur GRID-rows, kein SINGLE/DCA/INFGRID. Tilt zwischen Bot-Types unmöglich.

## 10.5 SILENT FAILURES — 343 `catch(_) {}` ohne Log

🟡 **35% aller try/catch in server.js sind silent** (343 von 974). Bei API-Fehlern werden Errors stillschweigend geschluckt. Das erklärt warum:
- On-Chain-Etherscan-Failure unsichtbar geblieben ist
- LSTM-Shadow seit 5 Tagen tot ohne Alarm

## 10.6 HMM-State-Lock-in

🟡 **HMM klebt in RANGING 98.2%**. Das ist die Konsequenz der sticky-Transition-Matrix (RANGING→RANGING=0.70) plus EMA-α=0.30. State-Wechsel würde 5-8 Cycles mit anderer-State-Likelihood brauchen. Bei 24h Beobachtung: passierte 1× (BULL kurz).

**Impact:** Adaptive FAMILY_WEIGHTS sind effektiv = RANGING-Profile = ≈ alte statische WEIGHTS. **Stufe 1 wirkt theoretisch, praktisch im aktuellen Markt = 0.**

## 10.7 Brain hat KEINE Convictions

🔴 **0 Decisions mit conf ≥ 0.4 in 24h** (39,000 evals). FLOOR=0.08 + Sub-Source-Mittelung gibt nur conf 0.02-0.15. Brain trifft im Mittel **fast-zufällige** Entscheidungen, die alle vom Floor abgeblockt werden.

## 10.8 1.6% Reserve statt 70%

🟡 **Wallet-Reserve $15 statt $647** (70% von $925). AUDFIX_035-Migration hat peakTotal manipuliert, aber Reserve-Pool wurde nicht re-balanced.

## 10.9 33 BUY:1 SELL-Imbalance

🔴 **Brain-Bias massiv BULL**: 26,681 BUY vs 2,603 SELL in 24h (10:1). Ursache: 3 konstante BUY-Scheinlogik-Sources (smartMoney +0.7, monteCarlo +0.3, fearGreed +0.3) gegen 2 konstante SELL (etfFlows -0.3, newsRisk -0.7) → Net **+0.3 BUY-Bias** in jeder Decision.

## 10.10 Memory-Leak-Risiko

🟡 **70+ Map/setInterval-Konstrukte** in modules/server.js. Keine offensichtlichen Leaks beobachtet (mem 130-250 MB Range), aber Wachstumstrend wäre erst über Tage erkennbar.

---

# KAPITEL 11 — DELTA-ANALYSE: vorher (TAG-START) → JETZT

| Metric | TAG 4 START (12:36) | TAG 4 ENDE (15:15) | Δ |
|---|---:|---:|---|
| Module | 24 | **34** | +10 |
| API-Endpoints | 489 | **510** | +21 |
| Brain-Sub-Sources unique | 29 | 29 | 0 |
| Active% avg | 50% | 47% | -3 pp (markt-bedingt) |
| Sortino-Module | 🔴 fehlte | 🟡 deployed/dormant | +1 |
| HRP-Module | 🔴 fehlte | 🟡 deployed/dormant | +1 |
| TFT-Module | 🔴 fehlte | 🟡 deployed/API-only | +1 |
| Black-Swan-Module | 🔴 fehlte | 🟡 on-demand | +1 |
| OB-History-Module | 🔴 fehlte | ✅ live | +1 |
| On-Chain-Module | 🔴 disabled | 🟡 partial-active | +1 |
| Multi-Exchange-SOR | 🔴 disabled | 🟡 PAPER live | +1 |
| HMM-Module | 🔴 fehlte | ✅ live (sticky RANGING) | +1 |
| **Wirklich Brain-integriert (heute)** | — | **3 von 10** (HMM, obImbalance, FinBert) | |
| **Nur deklariert** | — | **5 von 10** (TFT, Sortino, HRP, On-Chain, BlackSwan) | |
| **PAPER-Read-only** | — | **2 von 10** (Multi-Exchange-SOR, Black-Swan-Replay) | |

### Wahrheits-Check Roadmap-Claims vs Realität

| Roadmap-Claim | Realität |
|---|---|
| "78% Boutique-Quant-Liga-Parity" | **Konzept-Parity ja**, **Wirkungs-Parity ~30-40%** weil 5/10 nur deklariert |
| "Adaptive FAMILY_WEIGHTS HMM-driven" | technisch ja, **praktisch = RANGING-default** weil HMM-Lock |
| "TFT Multi-Horizon-Forecasting deployed" | API-only, **kein Brain-Effekt** |
| "Sortino-Capital-Routing SHADOW + auto-switch" | SHADOW läuft, **aber bot_type-Schema-Bug verhindert je-Switch** |
| "Black-Swan-Replay 5/5 Cap-Preservation 96.3%" | korrekt für Simulation, **kein Realbetrieb-Test** |
| "On-Chain mempool + blockchain + etherscan" | **2 von 3 stille gescheitert**, nur mempool.space hat 1 row |

---

# KAPITEL 12 — GESAMT-VERDICT

## 12.1 Bereichs-Scores

| Bereich | Note | Begründung |
|---|:-:|---|
| Brain-Konzept | **A−** | 29 Sub-Sources, 5 Familien, HMM, adaptive Weights — institutionell |
| Brain-Wirksamkeit | **C** | 5 SCHEINLOGIK + 4 tot + 99.997% Decision-Block-Rate |
| Daten-Fundament | **B** | viele Quellen, mehrere stale (15min-candles, on_chain, lstm_shadow) |
| Risk-Management | **A−** | 9 Layer, KillSwitch stabil, Reconciliation ok |
| Bot-Type-Coverage | **D** | bot_type leer in trades, nur GRID aktive Performance |
| Capital-Allocation | **C** | Sortino/HRP deployed aber 0 Production-Integration, Reserve-Ratio nicht eingehalten |
| Forecasting | **C+** | TFT lebt aber nicht im Brain |
| Execution | **C+** | Multi-Exchange PAPER ok, Live-Routing = Bitget-only |
| ML/Shadow | **C+** | XGB+RF läuft, LSTM-Shadow 5d tot, TFT API-only |
| Audit-Trail | **A** | 268k decisions, 11 Endberichte, 20 Snapshots |
| Code-Hygiene | **C+** | 343 silent catches, 5 SCHEINLOGIK-Sub-Sources, bot_type-Schema-Bug |
| **GESAMT** | **C+ / B−** | Konzept A−, Wirksamkeit C |

## 12.2 Top 5 STÄRKEN

1. **Riesiger Audit-Trail** (268k decisions, 11 Endberichte, 20 Snapshots, 99.7% reconciliation-clean)
2. **9-Layer-Risk-Stack** alle aktiv, KillSwitch nie getriggert in 24h
3. **HMM-Cron läuft sauber** alle 60s, 110 ticks in 24h
4. **Order-Book-Snapshots STUFE 8** ist **echt produktiv** — 60 snapshots/30min/symbol, obImbalance 72.5% active
5. **FinBERT-Lexicon STUFE 3** ist im news_classifier echte produktive Komponente

## 12.3 Top 5 SCHWÄCHEN

1. **5 SCHEINLOGIK-Sub-Sources** geben konstante Scores trotz verfügbarer Live-Daten → erklärt BUY-Bias 10:1
2. **4 Module DEKLARIERT-aber-nicht-Brain-integriert** (TFT, Sortino, HRP, BlackSwan-Cron)
3. **trades.bot_type leer** → Sortino-Auto-Switch nach 14d unmöglich
4. **Brain confidence-floor-bound**: 0 Decisions mit conf ≥ 0.4 in 24h, FLOOR=0.08 schneidet 99% ab
5. **Decision-Block-Rate 99.997%**: 26681 BUY-Decisions → 1 Trade-Open in 24h

## 12.4 Top 5 VERSTECKTE PROBLEME

1. **NEWS_EXTREME_BLOCK 134x/24h** — könnte permanent active sein (factor 3.09 ist hoch)
2. **AUTO_NOTBREMSE 4x heute** (false-alarm GRID-fee-misread, sollte gefixt sein)
3. **on_chain_state 1 row in 24h** (etherscan + blockchain stille gescheitert, silent catch)
4. **lstm_shadow 5 Tage tot** (kein Alarm)
5. **15min/ETH-candles 19 Tage stale** (15min-Granularität wird nicht mehr gepflegt)

## 12.5 Top 10 Hebel (Effekt × Aufwand)

| # | Hebel | Aufwand | Effekt | Priorität |
|---|---|---|---|---|
| 1 | **5 SCHEINLOGIK-Sub-Sources fixen** (echte Daten in scores einspeisen) | 1-2h | **MASSIV** — Brain bekommt erstmals variable Signale | 🔴 SOFORT |
| 2 | **FLOOR_THRESHOLD evaluieren** (0.08 → 0.04 oder log_only?) | 30min | hoch — gibt Brain Action | 🔴 SOFORT |
| 3 | **trades.bot_type-Spalte populieren** (Strategy→bot_type Mapping) | 1h | mid — ermöglicht Sortino-Auto-Switch | 🔴 7d |
| 4 | **TFT in Brain integrieren** (scores.tft = getDirectionSignal) | 30min | mid — neue Sub-Source mit echtem Variance | 🟡 7d |
| 5 | **343 silent catches → mindestens Log.warn** | 2-4h | hoch — Sichtbarkeit | 🟡 7d |
| 6 | **on_chain Etherscan-Failure debugen** | 1h | mid — Sub-Source revive | 🟡 7d |
| 7 | **lstm_shadow-Tot-Detection** (Watchdog 30min ohne Schreibung → Alarm) | 1h | mid | 🟡 7d |
| 8 | **HMM-Profile-Test forcen** (Mock-CRASH-Observations einspielen) | 2h | hoch — Stufe-1-Wirkung verifizieren | 🟡 7d |
| 9 | **Wächter-Action-Types erweitern** (102 Aktionen alle gleich) | 2h | mid | 🟢 Monitoring |
| 10 | **Reserve-Ratio re-balance** (70/30 Wiederherstellung) | 30min | mid — Risk-Hygiene | 🟢 Monitoring |

---

# KAPITEL 13 — EMPFEHLUNGEN

## 13.1 SOFORT (heute, 2-4h)
1. **5 Scheinlogik-Sub-Sources reparieren** — die monteCarlo/fearGreed/smartMoney/etfFlows/newsRisk-Score-Adapter müssen echte Modul-Outputs nutzen, nicht hardcoded values. **Höchste Wirkungs-Hebel.**
2. **FLOOR_THRESHOLD-Audit** — 0.08 ist zu hoch bei aktuell conf 0.02-0.15. Entweder runter auf 0.04 oder back to `log_only` Mode bis Brain-Convictions reifer.
3. **TFT-Brain-Integration** — `scores.tft = _TFTForecaster.getDirectionSignal()` Z.11440+ einbauen.

## 13.2 BINNEN 7d
4. **bot_type-Spalte populieren** — trade-create-Pfade müssen bot_type setzen (SINGLE/GRID/INFGRID/DCA).
5. **Silent-Catches loggen** — mindestens die kritischen 50 Catches in Risk-/Brain-/Order-Pfaden zu Log.warn umbauen.
6. **on_chain debug** — Etherscan + blockchain.info Endpoint-Test mit echtem Log-Output.
7. **lstm_shadow-Watchdog** — alle 30min stale-check, Telegram-Alarm.
8. **HMM-State-Test** — synthetic-observations einspielen um BULL/BEAR/CRASH-Transitionen zu beweisen.

## 13.3 MONITORING (genug)
9. **Reserve-Ratio-Drift** beobachten (1.6% jetzt → Trend?)
10. **Brain-Decision-Block-Rate** beobachten (99.997% heute — sinkt nach Floor-Anpassung?)

## 13.4 IGNORIERBAR
- 15min-candles-stale: 1h+4h ist primary, 15min wird im Bot offenbar nicht mehr genutzt
- Wächter "nur 1 Action-Type": ANOMALY_DEDUP funktioniert, mehr Action-Types sind nice-to-have

---

## FAZIT

**NEXUS V9 ist KONZEPTIONELL auf B+/A− Niveau (Boutique-Quant), AKTIVITÄTS-effektiv aber auf C/C+** weil:

- 5 von 29 Sub-Sources Scheinlogik (konstante Werte)
- 4 von 10 Roadmap-Stufen NUR DEKLARIERT (nicht in Trading-Pfad)
- Brain 99.997% Block-Rate (1 Trade-Open für 29,283 Decisions)
- Schema-Bug `trades.bot_type leer` blockt Sortino-Auto-Switch

**Die Roadmap hat die Konzept-Lücken geschlossen, aber die Wirkungs-Lücken existieren.**

**Mit ~4-6h gezielter Reparatur (Top 3 Hebel) ist B+/A− WIRKUNG erreichbar.**

---

*Tiefen-Audit verfasst: 2026-05-20 15:15*
*Read-Only. Bot trades weiter normal. 974 try/catch reviewed, 510 endpoints probed, 1.0GB DB analyzed.*
*Logs in /Users/christianheilig/NEXUS_CLEAN/docs/audit_tag4_logs/*
