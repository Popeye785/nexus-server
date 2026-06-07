# NEXUS V9 — Decision-Outcome-Tracker + Anomaly-UI — ENDBERICHT

**Verankert:** 2026-05-21 11:44
**Bot-State:** PID 44981 / R=185 / online / mem 230 MB / Wallet $1000 unverändert

---

## A) GEMACHT

| Komponente | Status |
|---|:-:|
| `modules/decision_outcome_tracker.js` (165 lines) | ✅ NEU |
| DB-Schema `decision_outcomes` (3 horizons, unique decision_id+h) | ✅ |
| 3 API-Endpoints: snapshot / accuracy / score-now | ✅ |
| Server-Integration require+init+cron 5min | ✅ |
| Frontend-Karte (KAPITAL-Tab) — Brain-Accuracy + Anomaly-Settings | ✅ |

## B) GEÄNDERT — Diffs

**server.js (3 Stellen):**
- Z.11394 require `decision_outcome_tracker.js`
- Z.18062+ 3 neue API-Endpoints
- Z.27033+ init+startCron in Boot-Block

**public/index.html (1 Stelle):**
- Neue Karte `card-outcome-anomaly` oberhalb `card-bot-budget`
- Live-Refresh alle 30s

## C) KERN-BEFUND — Brain-Accuracy ist UNTER RANDOM 🔴

**Erstmaliger Lauf (200 Decisions je Horizon):**

| Horizon | Accuracy | Random-Benchmark | Verdict |
|---|---:|---:|---|
| 1h | **39%** | 50% | 🔴 -11pp |
| 4h | **31%** | 50% | 🔴 -19pp |

**Decision-Type-Breakdown (24h Lookback):**

| Decision | n | Accuracy | Avg Return |
|---|---:|---:|---:|
| BUY | 122 | **0%** (!) | -0.35% |
| SELL | 78 | **100%** (!) | -0.44% (Markt fiel) |

## D) Diagnose

**Brutale Wahrheit:**
- Brain trifft **122 BUY-Decisions in 24h, ALLE waren falsch** (Markt fiel)
- Brain trifft **78 SELL-Decisions, ALLE waren richtig** (Markt fiel tatsächlich)
- **Aber Brain bevorzugt BUY 1.6:1** → kontradiktorisch zur Markt-Realität

**Root Cause:**
1. **HMM klebt RANGING 0.982** → adaptive Weights = static
2. **fearGreed konstant +0.3 BUY** (Markt im Fear-Zone seit Tagen)
3. **smartMoney teilweise +0.7 BUY** (ruhige Märkte = ACCUMULATION-Signal)
4. **monteCarlo Fix wirkt, aber positive expectedReturn → +0.x BUY**
5. **Adaptive-Weights-RANGING-Profile** gewichtet SENTIMENT 0.25 → BUY-Sources dominieren

**FLOOR=0.08 + log_only schützt aktuell vor Trades** (Bot tradet kaum), aber wenn produktiv → systematischer BUY-Bias würde echtes Geld verlieren.

## E) Was das bedeutet

- **NEXUS V9 ist im aktuellen Markt NICHT predictive**
- Audit Tag 4 zeigte: Brain hat keine Convictions (0 Decisions mit conf ≥0.4)
- Jetzt: **Decisions sind nicht nur low-conf, sondern auch directional falsch**
- Live-Readiness-Score nach 30d-Validation wäre RED

## F) Was JETZT erkennbar ist (mit dem neuen Tracker)

✅ **Quantifizierbare Brain-Performance** — vorher: völlig unsichtbar
✅ **Per-Decision-Type-Bias-Detection** — BUY/SELL-Imbalance messbar
✅ **Per-Horizon-Accuracy** — kurze vs lange Horizons getrennt
✅ **Edge-Pct-Berechnung** — Σ(correct × return) − Σ(wrong × return)

## G) Empfohlene nächste Schritte

### Sofort (1-2h)
1. **BUY-Bias-Fix:** scores.fearGreed bei FG <30 NEUTRAL statt +0.3 BUY (Fear muss nicht immer contrarian BUY sein)
2. **smartMoney ACCUMULATION-Bedingung verschärfen** (nur bei trend > +0.003 BUY)
3. **HMM-Klebe weiter lockern** — RANGING-Diagonale 0.55 → 0.45

### Mittel (1 Woche)
4. **30d-Beobachtung der Outcome-Stats** — schauen ob Accuracy sich verbessert
5. **Per-Sub-Source-Accuracy** ableiten (welche Sub-Sources sind tatsächlich predictive?)
6. **Sub-Source-FAMILY_WEIGHTS dynamisch anpassen** basierend auf Accuracy

### Lang (Monate)
7. **LSTM v5 Cloud-Training** — trained Modell könnte BUY-Bias überrumpeln
8. **Wenn Outcome-Accuracy < 45% nach 30d** → Brain-Architektur fundamental überdenken

## H) Tests

- node-c server.js ✅
- node-c decision_outcome_tracker.js ✅
- pm2 reload R=185 ✅
- API GET snapshot: ok ✅
- API POST score-now: 200 decisions je horizon scored ✅
- API GET accuracy?horizon=1: BUY 0%, SELL 100% ✅
- UI live-refresh: alle 30s update via fetch ✅
- Wallet stable $1000 ✅

## I) Snapshots

- **PRE:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/OUTCOME_TRACKER_PRE_20260521_114113/`
- **POST:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/OUTCOME_TRACKER_POST_20260521_114438/`

## J) Reflexion

**Der Outcome-Tracker ist die WICHTIGSTE neue Komponente seit dem Audit-Fix.**

Vorher: Brain-Verbesserungen waren "deployment-validated" aber nicht "performance-validated". Wir wussten nicht ob die ganzen Stufen 1-10 + Audit-Fix die Brain-Qualität wirklich verbessern.

**Jetzt wissen wir es:** Brain ist im aktuellen Markt **directional schlecht** (39% 1h, 31% 4h Accuracy). Das ist eine schmerzhafte aber wertvolle Erkenntnis.

**Positive Seite:** Bot tradet kaum (FLOOR-Schutz), Wallet unverändert. Schaden NULL.

**Action-Item:** Brain-Bias-Fix (BUY-Imbalance) ist die nächste sinnvolle Mini-Pipeline. Outcome-Tracker liefert jetzt die Messgrundlage dafür.

---

*Outcome-Tracker + Anomaly-UI abgeschlossen: 2026-05-21 11:44*
*1 neues Modul / 3 neue APIs / 1 UI-Karte / 0 Brain-Schwellen geändert / Wallet unverändert*
