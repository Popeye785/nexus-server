# BESTANDSAUFNAHME — Bot-Reife NEXUS V9 (READ-ONLY, hardcore-ehrlich)
**Datum**: 2026-05-19 12:00
**Modus**: keine Wertung, keine Beschönigung. Nur Daten.

---

## INVENTAR-FAKTEN

### Code-Größe
- `server.js`: **26.533 Zeilen** (groß)
- `modules/`: **20 Module**
- **480 Endpoints**

### Brain-Aktivität (7 Tage)
- **224.689 aladdin_decisions** über 19 Symbole
- Verteilung: HOLD 104.908, BUY 78.251, SELL 41.551
- 5 Familien aktiv, Voting funktioniert

### Trade-Performance (alle 27 closed SINGLE-Trades)
- WR 37%, Total -0.98 USDT
- Alle in NEUTRAL-Regime (keine BULL/BEAR-Samples)
- DEMO_UNIFIED nur 1 Strategie aktiv

### Bot-Typen Performance
| Typ | aktiv | PnL |
|---|---:|---:|
| SINGLE | 0 jetzt, 27 closed | -0.98 USDT |
| GRID | 3 aktiv, 4 total | **+43.77 USDT** |
| DCA | 2 aktiv, 5 total | 0 (Iterations laufen) |
| INFGRID | 0 | – |

→ **GRID ist faktisch alleiniger Profit-Generator**.

### Daten-Stand
| Quelle | Rows | Coverage |
|---|---:|---|
| news_enriched | 2376 | 7 Tage dicht |
| fear_greed_history | 365 | 1 Jahr |
| funding_oi_history | 14247 | 33 Tage Multi-Symbol |
| binance_metrics_history | 103.680 | 90 Tage |
| etf_flows | 14 | 18 Tage |
| **macro_events** | **7** | ⚠️ nur Zukunft (Bug!) |
| liquidations_24h | 104 | nur Live-Sammlung |
| regime_history | 275 | seit heute Mittag |
| strategy_regime_performance | **0** | wartet auf Trade-Close |

### Sicherheits-Layer
- ✅ KillSwitch NORMAL
- ✅ Drift 0, Wallet 999.024
- ✅ Telegram-Throttle aktiv
- ✅ Incident-Auto-Resolve (heute 11:35)
- ✅ Anomaly-Whitelist bei Buy-the-Dip

### LIVE-Readiness: **0/4 Gates erfüllt**
- ❌ ≥50 Trades (haben 27)
- ❌ Win-Rate ≥52% (haben 37%)
- ❌ Positiver Gesamt-PnL (haben -0.98 USDT)
- ❌ 7d profitabel (haben -0.98)

→ LIVE-Switch **nicht möglich**.

---

## ECHTE LÜCKEN (NICHT BESCHÖNIGT)

### KRITISCH (blockieren Bot oder Live)
1. **Macro-Cron-Bug**: `datasource_macro_calendar.js:58` löscht ALLE macro_events bei jedem Refresh → 77 hardcoded FOMC/CPI/NFP-Events von gestern sind weg, ersetzt durch 7 ForexFactory-this-week-Events. **Daten-Verlust**.
2. **SINGLE-Strategy verliert** seit 5 Tagen (-0.98 USDT in 27 Trades, WR 37%). Brain ist konservativ kalibriert, aber Strategie-Selection (DEMO_UNIFIED-Default) tradet sinnlos in NEUTRAL.
3. **MetaBrain-Auto-Invoke aktiv**, aber NEUTRAL → CONSERVATIVE (skip) → MetaBrain greift faktisch nicht. Das fix-quotierte Capital-Pool steht still für 3/5 BotTypes.
4. **strategy_regime_performance-Tabelle leer** — Hook von heute Vormittag, aber keine neuen Trade-Closes seit Reload um 11:30 → noch keine Daten.

### HOCH (Hebel × Aufwand)
5. **5 Stubs** (elliott/onChain/heatScore/correlation/smartMoney) — alle liefern oft NEUTRAL, ziehen Familien-Score runter
6. **WhaleAlert → SmartMoney unverbunden** — Code holt whale-alert.io aber SmartMoney nutzt eigene Heuristik
7. **DCA-PnL-Hook fehlt** — Spalten erstellt, aber `dca_iterations.pnl_usdt` wird nie geschrieben
8. **ETF nur 14 Tage** (SoSoValue-Key fehlt — Skript bereit)
9. **Capital-Pool starr 40/25/20/15** — kein Performance-/Regime-Tilt

### MITTEL (Profi-Niveau)
10. **Strategy-Rotation** existiert (Z.6825), aber nur 1 Strategie aktiv → läuft nicht
11. **HMM für Regime** — aktuell heuristisch (Volatility/Trend/RSI-Buckets). Renaissance-Style Hidden Markov Model nicht da.
12. **Shadow-ML aktiv** (1903 XGBoost + 1903 RF Predictions), aber **nicht in Live-Brain integriert**
13. **LSTM v6 gebaut** aber "always-buy" (gestern Diagnose) → nicht produktiv

### NIEDRIG (Cosmetics)
14. UI-Dashboard für regime_history fehlt
15. Brain-Schwellen aus UI änderbar — nur Slot-Slider da
16. Bot-Performance-Vergleich pro Regime nicht visualisiert

---

## ANTWORTEN

### A) Bot-Reifegrad: **6/10**

| Aspekt | Note |
|---|:-:|
| Architektur | 8/10 (4 Ebenen sauber, modular) |
| Sicherheits-Layer | 9/10 (KillSwitch, Drift, Recon, Throttle) |
| Daten-Quellen | 7/10 (umfangreich, 2 echte Lücken) |
| Brain-Logik | 7/10 (5 Familien funktional, aber 5 Stubs ziehen runter) |
| Trade-Performance | **3/10** (WR 37%, -0.98 USDT, GRID rettet) |
| ML-Integration | 4/10 (Shadow nur, nicht produktiv) |
| Live-Readiness | 2/10 (0/4 Gates) |
| Daten-Persistence | 6/10 (heute Fundament, leer) |

### B) Top 5 Lücken (Hebel × Aufwand)

| Rank | Lücke | Hebel | Aufwand | Score |
|---|---|:-:|:-:|:-:|
| 1 | **Macro-Cron-Bug** (löscht DELETE FROM macro_events) | ★★ | 5 min | sofort |
| 2 | **DCA-PnL-Hook einbauen** (für Mess-System) | ★★★ | 30 min | sofort |
| 3 | **WhaleAlert → SmartMoney verbinden** (P1 aus Audit 18.05.) | ★★ | 1 Tag | hoch |
| 4 | **Performance-Tilt Capital-Pool** (sobald Daten-Fundament voll) | ★★★ | 2-3 Tage | wartet auf Daten |
| 5 | **Stubs eliminieren** (elliott/onChain/heatScore/correlation) | ★★ | 3-5 Tage | mittel |

### C) Was ist Feinjustierung?

- Anomaly-Schwellen (zThreshold 4.0, score 6) — heute angepasst
- NEWS_EXTREME-Schwelle 99 — heute angepasst
- Sharpe-Block -5 + Stufen (Buy-the-Dip) — gestern angepasst
- Telegram-Dedup 1h pro symbol+type — heute angepasst
- → Aktueller Stand ist **kalibriert**, weitere Feinjustierung ohne 30d Daten = Bauchgefühl

### D) Was ist strukturelle Erweiterung?

- **Daten-Fundament** (heute Mittag) — strukturell, aktiv
- **Performance-basiertes Capital-Routing** — Phase 2 nach 14 Tagen Daten
- **HMM für Regime** — Renaissance-Style, ~5-10 Tage Aufwand
- **ML in Live-Brain** — Shadow-Predictions als 22. Sub-Source — ~2-3 Tage
- **Multi-Strategy** — andere Strategien neben DEMO_UNIFIED bauen (~5-7 Tage)

### E) Empfohlene Reihenfolge nächste 4 Wochen

| Woche | Fokus |
|---|---|
| **W1** (Daten + Bugs) | Macro-Cron-Fix (5 min), DCA-PnL-Hook (30 min), 7-14d Daten sammeln, WhaleAlert→SmartMoney |
| **W2** (Phase 2 Capital) | Performance-Tilt Capital-Pool (sobald regime/strategy Daten da), Stubs prio elimineren |
| **W3** (ML-Integration) | XGBoost-Shadow ins Live-Brain als 22. Sub-Source (Shadow→Production-Test) |
| **W4** (Validation) | Reset Day Zero oder weiter, Walk-Forward mit echten 30-Tage-Daten, LIVE-Readiness-Gates ehrlich prüfen |

### F) Realistische Einschätzung

**Profi-Niveau erreicht?**
**Teilweise**. Architektur ja, Performance NEIN.
- Architektur (5-Familie-Konsens, 4-Ebenen-Sicherheit, 20 Module) ist auf **Aladdin/Nautilus-Niveau**
- Trade-Performance (WR 37%, -1 USDT in 27 Trades) ist **unter Hobby-Niveau**

**Hedge-Fund-Niveau möglich?**
**Mit aktuellen Algorithmen NEIN**. Lücken:
- Renaissance Tech nutzt HMM + 200+ Features + Multi-Strategy-Portfolio
- Two Sigma: ML auf 100+ TB Daten
- Wir haben: heuristische Regime + 56 Features + 1 Strategie + 6 Jahre Single-Symbol-Daten

**Wo ist die Lücke?**

1. **Datentiefe**: Renaissance nutzt seit 1988 Tick-Level-Daten über 30+ Jahre. Wir haben 6 Jahre Candles, 14 Tage ETF, 0 Liquidations-Historie.
2. **Multi-Strategie-Portfolio**: Profis haben 50+ unkorrelierte Strategien. Wir: 1 (DEMO_UNIFIED).
3. **Feature-Engineering-Tiefe**: FreqAI 10.000+ Features. Wir: 56.
4. **Quant-Talent**: Renaissance hat 80+ PhD-Mathematiker. Wir: 1 Bot-Entwickler + KI.

**Realistische Einordnung**: NEXUS V9 ist **gut gebaute Single-Person-Quant-Plattform** mit Aladdin-inspirierter Architektur, aber **nicht profitabel in der aktuellen Konfiguration** (PAPER-Verlust 5 Tage). 

Bevor LIVE-Schaltung möglich:
- 50+ profitable Trades (aktuell 10 Wins von 27)
- 30+ Tage konsistente WR>52% (aktuell 37%)
- Walk-Forward-Validation mit echten Daten

**Geschätzter Aufwand**: **6-12 Wochen** bis ehrliches Live-Ready, vorausgesetzt strukturelle Erweiterungen werden gebaut.

---

## EHRLICHES URTEIL

NEXUS V9 ist **STRUKTURELL FORTGESCHRITTEN, OPERATIV NICHT REIF**.
- 6 Wochen Bau-Geschwindigkeit ist beachtlich
- Aber 0 profitable PAPER-Phase = nicht live-fähig
- GRID-Profit (+43 USDT) zeigt: das System KANN funktionieren, aber SINGLE-Strategie und Brain-Decisions sind aktuell nicht aligned mit Markt-Realität

**Empfehlung**:
1. **Heute Quick-Fix**: Macro-Cron-Bug (5 min)
2. **Diese Woche**: Daten sammeln + DCA-Hook + Bug-Fixes
3. **Nächste Wochen**: Performance-Tilt sobald Daten reichen
4. **Realistisch Live-Switch**: frühestens nach 50 profitablen Trades + stabilem positivem 30d-PnL
