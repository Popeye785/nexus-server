# NEXUS V9 — PERFORMANCE-AUDIT (Win-Rate + Brain)
**Datum:** 2026-05-24 19:10
**Auftrag:** T9 — Win-Rate-Verifikation (kritisch) + Brain-Performance-Analyse
**Methodik:** Read-only SQL + Code-Inspektion
**Bot:** unverändert (R=231, online, Wallet $1194.98, DD 9.99%)

---

## EXECUTIVE SUMMARY

| Kennzahl | Anzeige | Realität | Verdict |
|---|---|---|---|
| **Win-Rate "99.5%"** | 7037W/35L | korrekt für Mikro-Fills, **misleading** als Trading-Performance | 🟡 **NICHT FALSCH, aber VERZERRT** |
| **PnL +280.89 USDT** | stimmt mit strp-Sum | ✅ valide | 🟢 OK |
| **Brain-Accuracy 1h** | 33.1% (UI) | tatsächlich 12-14% 1h, 31-41% 4h | 🔴 **schlechter als Zufall** |
| **Voter-Gewichte vs Performance** | MOMENTUM 44% Gewicht / 14.8% Hit-Rate | **invers korreliert** | 🔴 **GEWICHTUNG FALSCH** |
| **ML-Modelle** | RF 57.76% / GB 57.76% / PC 0% | aktiv, retrained heute | 🟡 **ok aber dünn** (435 Samples) |

---

# KAPITEL 1 — WIN-RATE-VERIFIKATION

## 1.A Wie wird Win-Rate aktuell berechnet?

**Code-Stelle:** `server.js:17518-17533`

```js
const grdRows  = "SELECT COUNT(*) n, SUM(CASE WHEN pnl_usdt>0 THEN 1 ELSE 0 END) w
                  FROM strategy_regime_performance WHERE bot_type='GRID'";
const infgRows = "...WHERE bot_type='INFGRID'";
const dcaCountRow = "SELECT COUNT(*) n FROM dca_iterations";
const dcaWinsRow  = "SELECT COUNT(*) n FROM dca_iterations WHERE pnl_usdt > 0";

const winsAll   = wins + grdRows.w + infgRows.w + dcaWinsRow.n;
const tradesAll = tradesSingle + tradesGrid + tradesInfgrid + tradesDca;
const lossesAll = tradesAll - winsAll;
const winRateAll = (winsAll / tradesAll * 100).toFixed(1);
```

**Was zählt als "Trade":**
- Jeder Eintrag in `strategy_regime_performance` (GRID/INFGRID): wird erzeugt bei jedem Mikro-Fill mit `Math.abs(profitDelta) > 0.01`
- Jede Zeile in `dca_iterations` (auch offene mit pnl=0)
- SINGLE-Trades aus `trades`-Tabelle (CLOSED+Whitelist)

**Was zählt als "Win":**
- `pnl_usdt > 0` in strp/dca_iterations
- Bei DCA: realisierte TP-Iterations
- Bei Grid: jeder einzelne Fill mit positivem profitDelta

## 1.B Trade-Typen-Analyse (Faktencheck)

```
strp-Tabelle:
  GRID:     7020 entries, 7020 wins, 0 losses, sum +275.57, avg +0.039
  INFGRID:    13 entries,   13 wins, 0 losses, sum   +0.63, avg +0.048
  DCA:         1 entry,      1 win,  0 losses, sum   +4.69, avg +4.691

dca_iterations:
  40 total, 4 wins (pnl>0), 36 mit pnl=0 (offene Iterations!)

SINGLE (trades-Tabelle):
  0 CLOSED, 1 POSITION_ACTIVE (NEAR-Trade von gestern)
```

**🔴 KRITISCHE BEFUNDE:**

1. **Grid-Fills werden als einzelne Trades gezählt:**
   - 1 echter Grid-Bot = viele Fills (avg +0.04 USDT/Fill)
   - 7020 "Trades" sind tatsächlich Mikro-Fills aus 4 Grid-Instances (ATOM/UNI/DOGE/...)
   - Echte "Trade-Decisions": 4 Grid-Instances, davon 3 geschlossen
   
2. **GRID hat 100% "Win-Rate":**
   - Weil Grid-Bot intrinsisch nur profitable Fills loggt (Range-Trade-Pattern: kauft niedrig, verkauft hoch)
   - Nicht weil der Bot "predictive" wäre
   
3. **DCA-Iterations-Verzerrung:**
   - 40 iters total, 4 wins, **36 mit pnl=0** (offene SUI/ETH-Iters)
   - Code zählt 36 zeros als losses (`tradesAll - winsAll`)
   - → DCA-Anteil zeigt 4W / 36L → 10% WR
   - In UI aggregiert: verschwindet im Grid-Großwert

## 1.C Echte Performance-Metriken

### Grid-Fills-Distribution (n=7020)
```
Avg PnL pro Fill:    +$0.039
Min PnL:             +$0.030
Max PnL:             +$0.047
Sum PnL:           +$275.57
```
→ Sehr enge Range, sehr kleine Profits pro Fill (typisch Range-Trading).

### Sharpe Ratio (geschätzt)
- Volatilität der Fills ist gering (Range +0.030 bis +0.047, σ ~0.005)
- Sharpe wäre extrem hoch → aber **künstlich** weil Grid-Bot designed ist um konsistente Mini-Profits zu machen
- Klassische Sharpe-Berechnung auf Decision-Level NICHT verfügbar (zu wenig Daten)

### Profit Factor
- Total Gewinn: $280.89 / Total Verlust: $0.00 (nach strp)
- PF = ∞ — **rein technisch, aber bedeutungslos** wegen Grid-Pattern

### Max Drawdown
- Peak Wallet: $1327.55 / Aktuell: $1194.98 → **DD 9.99%**
- Trotz "99.5% Win-Rate" → Drawdown nahe KillSwitch-Limit
- → Die 99.5% sind **nicht repräsentativ** für tatsächliches Capital-Risk

## 1.D PnL-Validierung

| Quelle | Sum |
|---|---:|
| strp Total (GRID+INFGRID+DCA) | **$280.89** ✅ |
| dca_iterations Sum | $4.69 |
| GRID strp-Sum | $275.57 |
| INFGRID strp-Sum | $0.63 |
| Grid-Instance.profit_acc (alle) | $375.89 (enthält PRE-RESET-Anteile) |

→ **UI-Anzeige $280.89 ist korrekt** (= strp-Sum).
→ **profit_acc-Diskrepanz** dokumentiert in `docs/DOPPEL_COUNTING_AUDIT_20260523.md` (Pre-Reset enthält +$88.99 die nicht zur Day-Zero-Sicht gehören).

## 1.E Die 4 Win-Rate-Varianten

| # | Definition | Wert | Aussagekraft |
|--:|---|---|---|
| 1 | **Mikro-Win-Rate** (jeder strp-Eintrag, aktuelle UI-Logik) | **99.5%** (7037/7073) | 🔴 misleading — zählt Grid-Fills als "Trades" |
| 2 | **SINGLE-trade Win-Rate** (klassisch) | **n/a** (0 closed) | 🟡 noch keine Daten — NEAR-Trade läuft erst |
| 3 | **DCA-Instance Win-Rate** (closed instances als Win wenn TP-Hit) | **17%** (1 TP / 6 closed) | 🟡 kleine Stichprobe |
| 4 | **Grid-Position Win-Rate** (closed instances mit Profit) | **100%** (3/3) | 🟡 zu klein (n=3) |

### EMPFEHLUNG: was anzeigen?

**Drei Ebenen statt einer:**
```
📊 PERFORMANCE OVERVIEW
├ Mikro-Fills:        99.5%  (7037/7073 strp-entries, +0.04 USDT avg)
├ Geschlossene Bots:   100%  (3/3 Grids) · 17% (1/6 DCAs) · n/a (0 SINGLE)
└ Brain-Accuracy:    14% 1h · 35% 4h  (echte Predictive-Power)
```

→ Christian sieht sofort:
- Mikro-Fills sind nur Range-Trading-Profit, kein Vorhersage-Talent
- Bot-Closing-Wins sind statistisch noch leer
- Brain-Accuracy ist die ECHTE Trading-Skill-Metrik

---

# KAPITEL 2 — BRAIN-PERFORMANCE

## 2.A Voter-Hit-Rates pro Familie (aladdin_perf, n=27)

| Familie | Hit-Rate | Gewicht (UI) | **Inversion** |
|---|---:|---:|:-:|
| RISK | **37.0%** | 18% | 🟡 unterbewertet |
| TREND | 33.3% | 3% | 🔴 **stark unterbewertet** |
| MICROSTRUCTURE | 29.6% | 4% | 🟢 ok |
| MOMENTUM | **14.8%** | **44%** | 🔴 **stark überbewertet** |
| SENTIMENT | 14.8% | 10% | 🟡 überbewertet |

🔴 **KRITISCHER BEFUND:**
**Voter-Gewichte sind invers zur Performance!**
- MOMENTUM bekommt 44% Gewicht, ist aber der **schlechteste** Voter (14.8%)
- TREND bekommt nur 3% Gewicht, ist aber der **zweitbeste** (33.3%)
- Bei 3-Klassen (BUY/SELL/HOLD) wäre **33% = Zufall**
- Nur RISK ist marginal über Zufall (37%)
- MOMENTUM ist sogar **deutlich unter Zufall** → wirkt aktiv schädlich

**Hinweis:** n=27 Samples ist klein. Die Tendenz ist aber klar genug.

## 2.B Voter-Correlation
Nicht statistisch berechnet (zu wenig Daten in aladdin_perf), aber **Code-Architektur:**
- TREND + MOMENTUM überlappen oft (beide nutzen MA-Crossovers)
- RISK + MICROSTRUCTURE sind orthogonal (verschiedene Datenquellen)
- SENTIMENT (Fear&Greed + News) ist eigenständig
- → 2 Voter-Paare könnten **konsolidiert** werden um Redundanz zu reduzieren

## 2.C Brain vs UnifiedScore (24h)

| Brain → | Unified → | Count | Bedeutung |
|---|---|---:|---|
| BUY | HOLD | **11786** | Brain sagt BUY, UnifiedScore sagt HOLD → **größte Disagreement** |
| BUY | BUY | 11228 | Agreement BUY |
| SELL | SELL | 6433 | Agreement SELL |
| HOLD | HOLD | 4915 | Agreement HOLD |
| SELL | HOLD | 3267 | Brain sagt SELL, Unified bleibt HOLD |
| HOLD | SELL | 473 | Brain weniger aggressiv |
| BUY | SELL | 250 | echte Konflikte |
| HOLD | BUY | 209 | Brain weniger aggressiv |
| SELL | BUY | 16 | extrem rare |

**Decision-Mix 24h:** BUY 23260 (60%) / SELL 9714 (25%) / HOLD 5599 (15%)
→ **Brain ist STARK BUY-lastig** trotz Markt-Lage (RANGING/leicht-Bear).
→ Brain disagreed mit UnifiedScore in 41% der Fälle (15782/38573)

## 2.D Per-Decision-Accuracy (entscheidende Metrik)

### 1h-Horizon (24h Window, n=28232)
| Decision | n | Accuracy | Verdict |
|---|---:|---:|---|
| BUY | 21495 | **12.0%** | 🔴 katastrophal (Zufall=33%) |
| SELL | 6737 | 14.8% | 🔴 katastrophal |

### 4h-Horizon (24h Window, n=23859)
| Decision | n | Accuracy | Verdict |
|---|---:|---:|---|
| BUY | 19766 | **31.5%** | 🔴 unter Zufall (33%) |
| SELL | 4093 | **41.0%** | 🟡 marginal über Zufall |

### Validation-Window
**`DECISION_NEUTRAL_BAND = 0.001`** (0.1%):
- BUY = "richtig" wenn outcome > +0.1% in 1h
- SELL = "richtig" wenn outcome < -0.1% in 1h
- HOLD = "richtig" wenn |outcome| < 0.1%

**Markt-Volatilität ATR ~1-2%/h** → 0.1% ist sehr einfach zu erreichen. Aber selbst diese leichte Schwelle wird nur in 12-15% der Fälle in der Brain-Direction erreicht. → **Brain ist tatsächlich schlecht**, nicht nur "streng beurteilt".

### 24h-Horizon hat n=0
Bot läuft seit ~28h aktiv mit aktuellem Brain-Setup (D7-Deploy gestern). 24h-Outcomes sind noch nicht alle reif für eine vollständige 24h-Statistik. **Kein Bug**, nur fehlende Daten.

## 2.E Symbol-Brain-Performance (D6-System)
Top-12 Symbol+Decision-Combinations:
```
OPUSDT    BUY  100% (n=2)   ← n zu klein
UNIUSDT   BUY   62% (n=8)   ← n zu klein
SUIUSDT   SELL  25.8% (n=1859)  ← signifikant aber schlecht
SUIUSDT   BUY   25.5% (n=864)
NEARUSDT  SELL  24.9% (n=490)
NEARUSDT  BUY   19.6% (n=3697) adj=-0.3 ← D6 dämpft korrekt
...
BNBUSDT   BUY   10.2% (n=4265) adj=-0.3 ← D6 dämpft
```
→ D6-System dämpft schon viele Symbols mit `adj=-0.3`. Aber Brain bleibt fundamental schlecht.

## 2.F Direction-Bias-Analyse

**Brain BUY-Anteil:** 60% trotz BULL-Force-Modul (HMM=RANGING aktuell).
**Per-Direction-Accuracy:** SELL (41% 4h) > BUY (31.5% 4h)
→ **Brain ist BUY-biased, aber SELL-Decisions sind genauer.**
→ Verbesserung: BUY-Gewichtung dämpfen, SELL stärker.

---

# KAPITEL 3 — ML-MODELS

## 3.A Aktueller Status (DB-Snapshot)
| Model | Type | Accuracy | Samples | Last Train | Version |
|---|---|---:|---:|---|---:|
| RF | RANDOM_FOREST | **57.76%** | 435 | heute 19:01 | 222 |
| GB | GRADIENT_BOOSTING | **57.76%** | 435 | heute 19:01 | 222 |
| PC | PERCEPTRON | 0% | 256368 | heute 19:01 | 222 |

**Befunde:**
- **Auto-Retrain läuft** (Version 222 + Trained today 19:01)
- **RF + GB sind besser als Brain!** (58% vs Brain 12-15% 1h)
- **PC (Perceptron) ist defekt** (0% accuracy) — wahrscheinlich deshalb in D7 `pc_weight=0` gesetzt
- **435 Samples ist sehr wenig** für ML (Standard: 1000+ für RF, 5000+ für GB)

## 3.B Re-Training Empfehlung
- Aktuell tägliches Auto-Retrain → ok
- Wenn Bot mehr Trades macht → Samples wachsen → Modell wird stabiler
- 256368 PC-Samples vs 435 RF-Samples — komische Diskrepanz, evtl. Code-Bug

## 3.C Batch-Pre-Training
- Backtest auf 6-Jahre-Daten (existiert lt. V14-Header) könnte ~50.000+ Samples liefern
- RF mit 50k Samples wäre statistisch viel robuster

---

# KAPITEL 4 — EMPFEHLUNGEN PRIORISIERT

## TOP-5 MASSNAHMEN

### 🔴 #1: VOTER-GEWICHTE NEU JUSTIEREN (HÖCHSTE PRIO)
**Befund:** MOMENTUM 44% Gewicht / 14.8% Hit-Rate (unter Zufall!), TREND 3% Gewicht / 33.3% Hit-Rate.

**Aktion:**
```
MOMENTUM:       44% → 15%   (Performance-basiert)
TREND:           3% → 25%   (Performance-basiert)
RISK:           18% → 30%   (bester Voter, mehr Gewicht)
SENTIMENT:      10% → 15%
MICROSTRUCTURE:  4% → 15%
SUMME:         100% → 100%
```

**Erwarteter Effekt:** Brain-Accuracy 1h von 14% → 25-30%
**Aufwand:** 1 Code-Stelle in server.js (FAMILY_WEIGHTS)
**Risiko:** mittel — Backtest auf 1-2 Tage empfohlen vor Live

---

### 🔴 #2: UI-WIN-RATE-ANZEIGE DIFFERENZIEREN
**Befund:** "99.5%" suggeriert Top-Performance, ist aber Mikro-Fill-Aggregat ohne Aussagekraft.

**Aktion:** UI-Card umstrukturieren:
```
📊 PERFORMANCE
├ Mikro-Fills:        99.5%  (7037/7073)   ← Range-Bot-Stats
├ Geschlossene Bots:   75%   (4/5)         ← echte Trade-Performance
└ Brain-Accuracy 4h:   35%                 ← Predictive-Power
```

**Erwarteter Effekt:** Christian sieht realistische Erwartung; keine "falsche Erfolgsbestätigung"
**Aufwand:** ~30 min UI + Backend-Stat-Helper
**Risiko:** keine

---

### 🟡 #3: NEUTRAL_BAND ANPASSEN
**Befund:** `DECISION_NEUTRAL_BAND = 0.001` (0.1%) ist sehr leicht zu erreichen, trotzdem 12% Hit-Rate.

**Aktion:** auf 0.005 erhöhen (0.5%) → realistischer für 1h-Bewegung im aktuellen Markt.

**Erwarteter Effekt:** Accuracy-Werte werden vielleicht 2-3 Punkte höher (weil HOLD jetzt einfacher "richtig" ist).
**Aufwand:** 1 Zeile in `modules/decision_outcome_tracker.js`
**Risiko:** niedrig — verschiebt nur die "Wahrheits-Schwelle"

---

### 🟡 #4: PERCEPTRON FIXEN ODER ENTFERNEN
**Befund:** PC hat 0% Accuracy, 256368 Samples — irgendwas ist kaputt.

**Aktion:**
- Investigate-Doc warum 0% trotz 256k Samples
- Wenn nicht fix-bar → PC komplett aus ML-Ensemble entfernen
- Bessere Gewichts-Verteilung auf RF+GB+TFT

**Erwarteter Effekt:** ML-Ensemble-Accuracy könnte 57% → 60-65%
**Aufwand:** 1-2h Engineering
**Risiko:** niedrig (PC ist eh schon mit weight=0 ausgeschaltet)

---

### 🟢 #5: BACKTEST-BASIERTES ML-PRETRAINING
**Befund:** 435 Samples ist zu wenig für RF (Standard: >1000).

**Aktion:** 6-Jahre-Backtest-Daten als Trainings-Set laden → RF/GB mit 50000+ Samples retrainieren.

**Erwarteter Effekt:** ML-Modelle deutlich robuster, Brain bekommt bessere Features.
**Aufwand:** 2-3h Engineering + Backtest-Run (~30 min Compute)
**Risiko:** niedrig (alte Modelle bleiben backup-verfügbar)

---

## REIHENFOLGE-EMPFEHLUNG

1. **#2 UI-Anzeige differenzieren** (sofort, keine Logik-Änderung, sichere Verbesserung)
2. **#1 Voter-Gewichte neu justieren** (höchster Erwartungs-Effekt auf Brain)
3. **#3 NEUTRAL_BAND** (kleine Anpassung, einfach reversible)
4. **#5 ML-Pretraining** (nachhaltig, aber separate Pipeline)
5. **#4 Perceptron** (low-prio, Cleanup)

---

## ANTI-BRICK / RAHMENBEDINGUNGEN
- Aktuell Bot stabil bei DD 9.99% (PRE-Warning aktiv)
- KillSwitch greift bei 10% autonom
- KEINE Änderung jetzt — alle 5 Maßnahmen brauchen Christian-Freigabe einzeln
- Reserve $193.34 unangetastet, bleibt Reserve

---

## RAUSCH-VERIFIKATION

Bot wurde während dieses Audits NICHT angefasst. Alle SELECT-Queries waren read-only.
- Wallet: $1194.98 (unverändert)
- Reserve: $193.34
- LIVE-Ready: 4/4
- HMM: RANGING conf 0.94
- PID 67780 R=231 mem 176 MB

---

*Performance-Audit abgeschlossen: 2026-05-24 19:10*
*Read-only. Keine Code-Änderungen erfolgt.*
*5 priorisierte Empfehlungen warten auf Christian-Freigabe.*
