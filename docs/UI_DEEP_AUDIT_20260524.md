# [VERWORFEN — Audit-Fehler] NEXUS V9 — UI DEEP-AUDIT (Phase 1+2)

> ⚠️ **DIESES DOKUMENT IST VERWORFEN** (24.05.2026 15:30)
> Grund: Methodik fehlerhaft — Regex-grep auf `class="ct">` hat alle Tabs übersehen
> die andere Card-Pattern nutzen (z.B. BOTS-Tab nutzt `class="pionex-*"`).
> BOTS-Tab fälschlich als "0 Cards / leer" markiert obwohl voller Portfolio-Dashboard.
>
> **Master-Doc gültig:** `docs/UI_AUDIT_V2_VISUAL_20260524.md`
> Christian-Entscheidung: Option D Mikro-Cleanup (kein Reform-Plan nötig).

---

# NEXUS V9 — UI DEEP-AUDIT (Phase 1+2) [VERWORFEN]
**Datum:** 2026-05-24 14:35
**Stufe:** Phase 1 (Inventar) + Phase 2 (Doppelungen)
**Methodik:** Regex-Inventar aller 21 Tab-Buttons + 26 SCR-Sections + Cross-tab-Doppelungs-Analyse

---

## TAB-INVENTAR (alle Tabs auf einen Blick)

| Tab | scr-ID | Cards | Buttons | Inputs | Selects | Toggles | Auffälligkeit |
|---|---|--:|--:|--:|--:|--:|---|
| 📊 MARKT | dashboard | (komplex, viele Sub-Sections) | — | — | — | — | Haupt-Tab mit eingebetteten Sub-Tabs |
| 🐋 WHALE | whale | 4 | 1 | 0 | 0 | 0 | sauber |
| 📈 CHART | chart | 4 | 5 | 0 | 1 | 0 | sauber |
| 🔬 ANALYSE | analyse | 4 | 0 | 0 | 0 | 0 | nur Anzeigen |
| ⚡ SIGNAL | signal | 4 | 1 | 1 | 2 | 0 | sauber |
| 📖 ORDERS | orderbook | 2 | 1 | 0 | 0 | 0 | sauber |
| 🧮 47 IND | advanced | 6 | 3 | 0 | 3 | 0 | RENAME: "INDIKATOREN" |
| ⚡ STATUS | trade | **1 (nur LOG!)** | 0 | 0 | 0 | 0 | **dünn — Inhalt eigentlich in scr-manuell** |
| ⚙️ BOTS | bots | **0** | 5 | 0 | 0 | 0 | **leer/defekt** |
| 🪙 COINS | coins | 2 | 3 | 0 | 0 | 0 | sauber (+ scr-coinscanner embed) |
| 💰 KAPITAL | kapital | 7 | 15 | 7 | 0 | 0 | Haupt-Tab + scr-equity + scr-manuell embed |
| 📰 NEWS | news | 1 | 1 | 0 | 2 | 0 | sauber |
| 🧠 KI-DASH | aidash | 13 | 15 | 0 | 4 | 0 | groß, OK |
| 🔧 ARS | ars | 6 | 3 | 0 | 0 | 0 | funktional |
| 🛡 SICHERHEIT | safety | 9 | 7 | 0 | 1 | 0 | KEEP (KI-Monitoring + DD-Recovery) |
| 🧬 ML | ml | 10 | 17 | 1 | 7 | 1 | groß, OK |
| 🛠 SYSTEM | system | 11 | 15 | 7 | 2 | 1 | sehr voll — Audit-Kandidat |
| 🔎 DIAGNOSE | watchdog | 7 | 7 | 0 | 0 | 0 | sauber |
| 🌐 EXCHG | exchanges | 3 | 3 | 3 | 2 | 0 | klein |
| 🧩 STRATBUILD | stratbuild | 1 | **32** | **18** | 7 | 1 | überladen — vermutlich tot |
| 🔑 CONFIG | settings | 5 | 3 | 8 | 1 | 6 | sauber nach T6 |

**Orphaned Sub-Sections (keine direkten Tab-Buttons):**
- `scr-coinscanner` — embedded in COINS
- `scr-equity` — embedded in KAPITAL (Equity Curve + Eviction)
- `scr-features` — Feature-Toggles (wo aufrufbar?)
- `scr-manuell` — Manueller Modus + Notfall + Coin-Sperren (wo aufrufbar?)
- `scr-scripting` — Custom Scripting (wo aufrufbar?)

---

## TOP-DOPPELUNGEN (Phase 2)

### 1. API-Keys
- **CONFIG** → "API KONFIGURATION · BITGET" (Inputs: KEY/SECRET/PASSPHRASE)
- **EXCHG** → "API KEYS" (Multi-Exchange Keys)
- **Verdict:** KEIN echtes Duplikat — Bitget-spezifisch in CONFIG, andere Exchanges in EXCHG. OK.

### 2. Kill-Switch / Notfall
- **SYSTEM** → "FAIL-SAFE · V9 KILL SWITCH"
- **MANUELL (orphan)** → "🚨 NOTFALL"
- **Verdict:** Identische Funktion 2× → MANUELL-NOTFALL kann weg (Kill-Switch ist in SYSTEM präsenter)

### 3. Risk-Settings (verteilt)
- **CONFIG** → "RISK GUARD SCHWELLEN" (User-Sliders)
- **SYSTEM** → "RISK TIER" (Live-Mode-Eskalation)
- **MANUELL (orphan)** → "V9 NO-TRADE GATES"
- **Verdict:** 3 unterschiedliche Konzepte — Beibehalten, aber klarere Beschriftung. **Kein REMOVE**.

### 4. News (3 Stellen)
- **NEWS** → "📰 NEWS-FEED · 12 RSS-Quellen" (Primary)
- **SYSTEM** → "NEWS-RISIKO"
- **FEATURES (orphan)** → "📰 NEWS-SENTIMENT"
- **Verdict:** NEWS-Tab ist Primary. NEWS-RISIKO in SYSTEM und NEWS-SENTIMENT in FEATURES sind context-related — können bleiben. **Aber:** Tooltips auf "siehe NEWS-Tab für Details" verlinken.

### 5. Brain-Anzeigen
- **KI-DASH** → 13 Cards (Adaptive SL/TP, CVD, Anomaly, VaR, ML-Shadow, RL, Monte Carlo, Bayesian, Sentiment, Heatmap, etc.)
- **ML** → 10 Cards (ML Engine, Training, Vorhersage, Auto-Retraining)
- **ANALYSE** → 4 Cards (15 Indikatoren MTF, Risk-Metriken, Fibonacci, Breakout)
- **47 IND (advanced)** → 6 Cards (Trend, Momentum, Volume, Safeties, ML-Optimizer)
- **Verdict:** Unterschiedliche Zwecke:
  - KI-DASH = Live-Status der ML-Algorithmen
  - ML = Training + Modell-Management
  - ANALYSE = klassische TA pro Symbol
  - INDIKATOREN (advanced) = TI-Bundle
  - **KEEP getrennt**, aber Reihenfolge optimieren

### 6. Equity-Curve
- Nur in **scr-equity** (embedded in KAPITAL)
- **Verdict:** OK.

---

## AUFFÄLLIGKEITEN

### 🔴 scr-bots LEER
0 Cards aber 5 Buttons. Tab existiert, ist aber visuell leer. Inhalt muss früher mal hier gewesen sein.
**Vorschlag:** entweder mit echtem Bot-Übersicht füllen (Liste der aktiven Grids/DCAs/SINGLE) oder HIDE.

### 🔴 scr-trade dünn
Nur 1 Card ("LOG"). Tab heißt "STATUS" — sollte mehr zeigen.
**Vorschlag:** mit scr-manuell zusammenführen → einer "STATUS + MANUELL"-Tab oder STATUS = manueller Übersteuern-Tab.

### 🟡 scr-stratbuild überladen
32 Buttons + 18 Inputs + 7 Selects. Strategy-Builder mit Drag&Drop.
**Vorschlag:** HIDE (vermutlich tot, keine Backtest-Evidenz dass Christian Custom-Strategies gebaut hat).

### 🟡 47 IND Name unklar
**Vorschlag:** RENAME → "INDIKATOREN" / "INDICATORS" / "INDICADORES" (Christian-T6.9-Direktive).

---

## NÄCHSTE STUFE: Phase 3 Plan-Vorschlag

Siehe `docs/UI_REFORM_PLAN_20260524.md` (separat).

---

*Phase 1+2 abgeschlossen. Phase 3 Plan-Doc folgt → STOPP für Christian.*
