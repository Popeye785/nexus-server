# NEXUS V9 — Audit Ungeprüft-Lücken NACHHOLEN

**Datum:** 25.05.2026 18:39-18:47 (Bash-Timestamps)
**Audit-Logs:**
- B15: `/tmp/audit_log_b15_20260525_183936.txt`
- B16: `/tmp/audit_log_b16_20260525_184204.txt`
- L1: `/tmp/audit_log_L1_20260525_184248.txt`
- L2: `/tmp/audit_log_L2_20260525_184350.txt`
- L3: `/tmp/audit_log_L3_20260525_184452.txt`
- L4: `/tmp/audit_log_L4_20260525_184536.txt`
- L5: `/tmp/audit_log_L5_20260525_184621.txt`
- L6: `/tmp/audit_log_L6_20260525_184652.txt`
**Modus:** READ-ONLY, Bot tradet parallel (PID 83537 R=240, Wallet $1107.28 unverändert, LIVE aus)

---

## A. B15 — ORDER-BOOK / MICROSTRUCTURE

### Befunde
- **Tabelle:** `orderbook_history` (NICHT `orderbook_snapshots` wie Spec — Module-Name matched, Table-Name nicht) — **Doku-Mismatch LOW**
- **Schema verifiziert:** 5 Bid + 5 Ask Levels (L5-Depth), bid_depth_top5, ask_depth_top5, imbalance, spread, mid_price
- **Aktivität letzte 1h:** 359 entries, 3 Symbole (BTC/ETH/SOL) — **119/h pro Symbol = 1 alle 30s** (Spec sagt 1/min — 2x höhere DB-Last) → **LOW Befund**
- **Retention:** 5d Range (20.05.-25.05.), 30d-Spec ungetestet (Bot läuft erst 5d)
- **Symbol-Coverage:** Nur 3 Symbole → **MEDIUM Befund** (sollte für alle ~20 Trade-Symbols snapshot)
- **Write-Pfad:** `modules/orderbook_snapshots.js:64` (`INSERT INTO orderbook_history`) — Modul existiert, Tabellen-Name dort
- **MICROSTRUCTURE-Familie Hit-Rate:** 47.1% (n=17 aus aladdin_perf) — **beste Familie**
- **MICROSTRUCTURE Sub-Sources:** 6 (anomaly, btcCorr, heatScore, correlation, regime, obImbalance) — `scores.obImbalance` Z.12054 verifiziert

### Quellen (curl-Beweis)
- ✅ Hummingbot `order_book.pyx` 19768 bytes — `c_apply_diffs`, `c_apply_snapshot` Funktionen
- ✅ LEAN `Tick.cs` 35485 bytes — `BidSize`/`AskSize` Properties
- ✅ Nautilus `book.rs` 44168 bytes — `fn spread()` Z.859 verifiziert
- ❌ Nautilus OrderBook Doc URL 404 (curl EXIT 56) — alternative Source genutzt
- ❌ arXiv "Market Microstructure" — falsche IDs in WebSearch (1703.06849 = Cosmic Rays, 1503.05208 = Robertson-Walker) → keine direkt verifizierte arXiv-Quelle

### Lücken
- 30d-Retention nicht beweisbar (Bot läuft erst 5d)
- Symbol-Coverage-Spec für 20 Symbole UNGEPRÜFT (Code-Stelle der Symbol-Liste nicht gefunden)
- arXiv Microstructure-Paper: keine valide ID gefunden, **UNGEPRÜFT**

---

## B. B16 — WHALE / ON-CHAIN

### Befunde
- **`on_chain_state` Schema:** id, ts, source, metric, value, meta
- **Stand:** 837 entries, 20.05.-25.05., 158 entries letzte 24h
- **Aktivste Source:** `mempool.space` mit `btc_fees_fastest` metric
- **`ETHERSCAN_API_KEY` in `.env`** verifiziert vorhanden
- **`modules/datasource_onchain.js`** implementiert 3 Etherscan-Endpoints: gastracker, blockNumber, whales
- **Liquidations:** `liquidations_24h`-Tabelle existiert, `modules/datasource_liquidations.js` lädt, `scores.liquidations` Z.12071 verbunden
- **Whale-Modul:** `datasource_onchain.js` (eigenes Modul). `_persist('etherscan', 'eth_whales_count', whales.length, ...)` Z.232 — Whale-Count wird gespeichert
- **`scores.onChain` Code-Stelle Z.11906 verifiziert** (in SENTIMENT-Familie)

### KRITISCHE Befunde
- 🟠 **MEDIUM B16-1: Etherscan-API V1 deprecated** — `curl https://api.etherscan.io/api?module=stats&action=ethsupply2` returns:
  ```
  {"status":"0","message":"NOTOK","result":"You are using a deprecated V1 endpoint, switch to Etherscan API V2"}
  ```
  Bot-Code nutzt V1-URLs (`module=gastracker&action=gasoracle`, `module=proxy&action=eth_blockNumber`) — funktioniert noch, aber deprecated. Migration auf V2 fällig.

### Quellen
- ✅ Etherscan API live-Test (curl) — V1 deprecated bestätigt
- ✅ Etherscan Rate-Limit Doc HTML 258 KB (verifiziert, nicht gelesen)
- ❌ Renaissance/Two-Sigma Alternative-Data: keine öffentlichen Source-Quellen
- ❌ arXiv Whale-Tracking-Papers: keine konkrete ID gesucht/verifiziert

### Lücken
- `smartMoney`-Pipeline UNGEPRÜFT in voller Tiefe
- `scores_json` column in consensus_decisions existiert nicht — Hit-Rate-Cross-Check UNGEPRÜFT
- Liquidations-Sub-Source: Code da, Live-Aktivität (Votes letzte 24h) UNGEPRÜFT

---

## C. L1 — Endpoints (alle 547)

### Befunde
- **547 saubere Endpoints extrahiert** (Python regex):
  - GET: 318
  - POST: 216
  - DELETE: 12
  - PUT: 1
- **Sample 50 GETs (random seed=42):** 49/50 = 200 OK (98%), 1× 400 (`/api/ml/versions` braucht Query-Param)
- **Top-20 Path-Prefixes:** `/api/exchanges` (16), `/api/ml` (15), `/api/scripts` (14), `/api/farm` (13), `/api/training` (12), `/api/telegram` (9), `/api/demo` (9), `/api/lstm` (8)

### Orphan-Detection (HEURISTIK)
- **211/547 Endpoints in HTML zitiert** (39%)
- **336/547 "Orphans" (HTML-grep negative)** (61%)
- ⚠ Heuristik ist ungenau: JS-dynamic-Calls (z.B. via Variable) sind false-positives
- Top-20 Potentielle Orphans Sample: `/api/snapshot`, `/api/regime/history`, `/api/strategy/performance`, `/api/blocked/recent`, `/api/vetos/combined`, `/api/backtest/coverage`, `/api/news/recent`, ...

### Lücken
- **Input/Output-Schema systematisch pro Endpoint: UNGEPRÜFT** (547 × Schema-Doku wäre 8-16h, separat geplant)
- **497 von 547 Endpoints live-UNGEPRÜFT** (nur 50-Stichprobe)
- Orphan-Detection ist Heuristik, kein definitiver Beweis

---

## D. L2 — Sub-Sources (31 einzeln)

### Befunde
**5 Familien × Sub-Sources** (aus Code Z.27248-27252):
| Familie | Sub-Sources | Count |
|---|---|---:|
| TREND | strategies, ichimoku, elliott, tft | 4 |
| MOMENTUM | cvd, patterns, rlAgent | 3 |
| RISK | monteCarlo, bayesian, volatility, sharpe, mlEnsemble, liquidations, funding, oi, var95, newsRisk | 10 |
| SENTIMENT | fearGreed, news, reddit, onChain, smartMoney, etfFlows, macroCalendar, macroRegime | 8 |
| MICROSTRUCTURE | anomaly, btcCorr, heatScore, correlation, regime, obImbalance | 6 |
| **TOTAL** | | **31** |

### Live-Sample (ATOMUSDT consensus_decision)
- TREND active: 3/4 (ichimoku, elliott, tft) — `strategies` fehlt
- MOMENTUM active: 2/3 (cvd, rlAgent) — `patterns` fehlt
- RISK active: 9/10 (monteCarlo, bayesian, volatility, sharpe, mlEnsemble, funding, oi, var95, newsRisk) — `liquidations` fehlt
- SENTIMENT active: 6/8 — `onChain`, `etfFlows` fehlen
- MICROSTRUCTURE active: 5/6 — `obImbalance` fehlt
- **25/31 aktiv = 81%**

### brain_input_log 24h
- **10 distinct Sources loggen Votes**, ALLE direction=NEUTRAL → erklärt warum UNIFIED-Confidence so niedrig (0.03-0.07)
- Aktivste: cvd (4130), funding_api (4125), var (4130), feargreed (1377), aladdin_sent (1376)

### Befund L2-1 (HIGH-RELATED zu B5-Brain-Acc 3.8%)
Viele Sub-Sources voten konstant NEUTRAL → Brain bekommt fast keine direction-Information → Acc 3.8%. **Sub-Source-by-Sub-Source-Audit nötig** für Phase 2 der Roadmap.

### Lücken
- Per-Sub-Source Hit-Rate gegen decision_outcomes: UNGEPRÜFT (würde JOIN über alle 31 brauchen)
- Welche der 6 "fehlenden" Sub-Sources Scheinlogik sind: UNGEPRÜFT

---

## E. L3 — LSTM / TFT / RL Live-Verbindung

### Befunde
- ✅ **LSTM:** `modules/lstm_engine.js` + `lstm_v5.js` + `LSTMShadow` (Z.7158). `LSTMShadow.start()` Z.28649. Tabelle `lstm_shadow` existiert.
- ✅ **TFT:** `modules/tft_forecaster.js`, `_TFTForecaster.getDirectionSignal` Z.11701, scores.tft Z.11714. Tabelle `tft_forecasts` existiert.
- ✅ **RL:** Q-Table 86 entries, scores.rlAgent Z.11750. **Live: 7196 RL-Votes letzte 24h** in brain_input_log ✓
- ⚠ **LSTM in brain_input_log: 0 Votes letzte 24h** — Code instanziiert, aber UNKLAR ob Predictions in Live-Decisions
- ⚠ **TFT in brain_input_log: 0 Votes letzte 24h** — gleich

### Lücken
- LSTM/TFT Predictions in `lstm_shadow` / `tft_forecasts` Tabellen UNGEPRÜFT auf Aktivität
- Ob LSTM/TFT-Output wirklich UnifiedScore beeinflusst UNGEPRÜFT

---

## F. L4 — Stress-Tests / Race-Conditions

### Befunde
- ✅ 10 parallele Calls: 28ms (avg 5.6ms/call)
- ✅ 50 parallele Calls: 453ms (avg 9ms/call) — **linear-skaliert**
- ✅ Memory nach Last: 181.9 MB (+4 MB) — **kein Leak**
- ✅ **240 PM2-Restarts gesamt, 0 unstable_restarts** ← sehr saubere Uptime-History
- ✅ WAL-Mode ✓, busy_timeout=0 (kein Lock-Timeout konfiguriert — bei high-write könnte problematisch, aktuell OK)
- ✅ Wallet-Persist letzter Write 18:42:59 (~4 min vor Test) — _persistWallet triggert regelmäßig

### Lücken
- Write-Stress UNGEPRÜFT (READ-ONLY-Spec)
- 1h+ Memory-Profile UNGEPRÜFT
- Bitget-API-Timeout-Simulation NICHT durchgeführt

---

## G. L5 — Browser-Tests

### Befunde
- ✅ HTML 605 KB lädt via curl mit Desktop-UA
- ✅ **21/21 Tab-IDs (nb-*) im DOM** vorhanden
- ✅ Mobile-Viewport-Meta vorhanden: `width=device-width,initial-scale=1,maximum-scale=1`
- ✅ 5 `@media`-Queries (responsive Design implementiert)
- ✅ 12 console.error/warn-Stellen im Frontend
- ✅ PM2-Log letzte 30 min: 0 JS-Errors

### Lücken
- Echte Browser-Rendering: UNGEPRÜFT (kein Chrome/Firefox-Test-Tool installiert)
- Click-Tests einzelner 247 Buttons: UNGEPRÜFT
- Mobile-Layout-Tests: UNGEPRÜFT
- JS-Console-Errors aus Live-Session: UNGEPRÜFT

---

## H. L6 — arXiv-PDFs (Workaround)

### Befunde
- ❌ `pdftotext` / `pdfinfo` NICHT installiert (poppler nicht via brew)
- ❌ Python-Libraries fehlen: `PyPDF2`, `pdfplumber`, `pypdfium2`, `fitz (PyMuPDF)`, `pypdf`
- ❌ brew vorhanden, aber poppler nicht installiert
- Installation würde **Setup-Change** = nicht READ-ONLY → Christian-Freigabe nötig

### Verdict
- arXiv DD-Papers (1404.7493 "Drawdown: From Practice to Theory" Goldberg/Mahmoud; 1506.00166 "Optimal Investment to Minimize Drawdown" Angoshtari) bleiben **UNGEPRÜFT bzgl. Inhalt**
- Existenz + Title + Author + Abstract verifiziert (via HTML-curl)
- **NICHT als Quelle für spezifische DD-Formel zitieren ohne Inhalt-Beweis**

---

## I. UPDATE PRÄSENTIER-MATRIX

| # | Bereich | Aktuell | Quant-Niveau | Gap | Fix | Präsentier? |
|--:|---|---|---|---|---:|:-:|
| 1 | Kapital | ehrlich post-A1 | LEAN | klein | 2-3h | 🟡 |
| 2 | UI/Tabs | 21/21 ✓ | Hummingbot | mittel | 4-8h | 🟡 |
| 3 | Cross-Konsistenz | FALSE_MATH-Mix | LEAN | klein | 30min | 🔴 |
| 4 | Endpoints (547) | 50/547 stichprobe 98%, 336 Orphans-Heuristik | FreqUI 5 EP | mittel | 8-16h | 🟡 |
| 5 | Brain (3.8% Acc) | NEUTRAL-dominiert | Aladdin 30+ Factor | groß | 16-32h | 🔴 |
| 6 | ML | RF/GB 57.76%, PC defekt | FreqAI | groß | 16-32h | 🔴 |
| 7 | Strategies | size-Fix ✓, Fee-Falle | Hummingbot | mittel | 8-16h | 🟡 |
| 8 | State/Persist | WAL ✓, Disk=Mem ✓ | Nautilus | mittel | 8-16h | 🟢 |
| 9 | Safety (HIGH-1) | 11 Gates ✓, doppelt-Bug | LEAN | klein | 1h | 🔴 |
| 10 | Position-Sizer | 6-Mult | Kelly+HRP+Sortino | mittel | 8-16h | 🔴 |
| 11 | News-Risk | 180/24h, Dedup-Code | Two-Sigma NLP | groß | 16-24h | 🟡 |
| 12 | AnomalyDetector | pressureScore + Cap | — | klein | 2h | 🟢 |
| 13 | Risk-Tier | TIER_SAFE | Aladdin | mittel | 4-8h | 🟡 |
| 14 | Walk-Forward | 110 Runs, WF ✓ | FreqAI | klein | 2-4h | 🟢 |
| **15** | **Order-Book** | **L5-Depth, 3 Symbole, 1/30s, 47% Hit** | **Hummingbot OB / Nautilus book.rs ✓** | **mittel** | **4-8h** | **🟡** |
| **16** | **Whale/OnChain** | **833 entries, mempool aktiv, V1-API deprecated** | **Etherscan V2 + Renaissance Alt-Data** | **mittel** | **4-8h** | **🟡** |
| 17 | Multi-Exchange | T8 deployed, 1/12 enabled | Nautilus | mittel | 16-32h | 🟡 |
| 18 | Wächter | 262 runs healthy | LEAN Audit | klein | 2-4h | 🟢 |
| 19 | Hidden Issues | 550 Silent-Catches | — | mittel | 4-8h | 🔴 |
| 20 | Patches today | 7 ✓ + 2 Backlog | — | klein | 1h | 🟡 |

**Summary updated:**
- 🟢 OK PRÄSENTIERBAR: **4/20** (State, Anomaly, Walk-Forward, Wächter — unverändert)
- 🟡 TEILWEISE: **11/20** (jetzt inkl. neu B15, B16)
- 🔴 NICHT PRÄSENTIERBAR: **5/20** (Cross-Konsistenz, Brain, ML, Safety, Position-Sizer, Hidden)

**Vorher 2 UNGEPRÜFT (B15, B16) sind jetzt geklärt — beide 🟡 TEILWEISE.**

---

## J. UPDATE FIX-ROADMAP

**Neue Befunde aus diesem Nachhol-Audit:**

| # | Fix | Aufwand | Sev | Beweis |
|--:|---|---:|---|---|
| 21 | B16-1 Etherscan API V2-Migration | 2-4h | 🟠 MEDIUM | curl live: V1 deprecated |
| 22 | B15-1 Spec-Korrektur orderbook_snapshots → orderbook_history | 5min | 🟢 LOW | Doku-Mismatch |
| 23 | B15-2 OB-Snapshot für mehr Symbole (3 → 20) | 2-4h | 🟠 MEDIUM | Erklärt warum MICROSTRUCTURE limited |
| 24 | L2-1 Sub-Source-by-Sub-Source Hit-Rate Audit | 4-8h | 🟠 MEDIUM | Brain-Acc 3.8% Ursache |
| 25 | L3-1 LSTM/TFT Live-Connection verifizieren | 2-4h | 🟡 LOW | Code da, Live UNGEPRÜFT |

**Roadmap unchanged sonst, Top-10 kritische Befunde unverändert.**

---

## K. EHRLICHE GESAMT-LÜCKEN (nach Nachhol-Audit immer noch UNGEPRÜFT)

1. **Echte Browser-Tests** (Cypress/Playwright) — Tool fehlt
2. **arXiv-PDF-Inhalt** — poppler/PDF-Tools fehlen
3. **497 von 547 Endpoints** live-untested
4. **Pro-Endpoint Input/Output-Schema** systematisch
5. **Per-Sub-Source Hit-Rate** (31 × decision_outcomes Join)
6. **LSTM/TFT Live-Connection in Decisions** (Code da, Use UNGEPRÜFT)
7. **Write-Stress-Tests** (READ-ONLY-Spec)
8. **1h+ Memory-Profile**
9. **Bitget-API-Timeout-Simulation**
10. **30d Order-Book-Retention** (Bot läuft erst 5d)
11. **Click-Tests 247 Buttons einzeln**
12. **i18n DE/EN/ES Translation-Files**
13. **scores_json column** in consensus_decisions — existiert nicht → Hit-Rate-Cross-Check UNGEPRÜFT

---

## L. AUDIT-LOG-VERWEISE

Alle 8 Sub-Bereiche mit Bash-Timestamps + Raw-Outputs:

```
/tmp/audit_log_b15_20260525_183936.txt   (B15 Order-Book)
/tmp/audit_log_b16_20260525_184204.txt   (B16 Whale/OnChain)
/tmp/audit_log_L1_20260525_184248.txt    (L1 Endpoints)
/tmp/audit_log_L2_20260525_184350.txt    (L2 Sub-Sources)
/tmp/audit_log_L3_20260525_184452.txt    (L3 LSTM/TFT/RL)
/tmp/audit_log_L4_20260525_184536.txt    (L4 Stress)
/tmp/audit_log_L5_20260525_184621.txt    (L5 Browser)
/tmp/audit_log_L6_20260525_184652.txt    (L6 PDF-Tools)
```

---

## M. ABSCHLUSS

**Status:** Alle 2 UNGEPRÜFTEN Bereiche (B15, B16) jetzt geklärt → beide 🟡 TEILWEISE PRÄSENTIERBAR.
**Alle 6 Lücken-Punkte** (L1-L6) abgearbeitet, davon 3 mit echten Tool-Mängeln ehrlich als UNGEPRÜFT markiert (L5 Browser, L6 PDF, L4 Write-Stress).

**Neue Top-3-Befunde:**
1. **B16-1 (MEDIUM)** — Etherscan API V1 deprecated, Migration nötig
2. **L2-1 (HIGH-related)** — Sub-Sources voten meist NEUTRAL → erklärt Brain-Acc 3.8% aus B5
3. **B15-2 (MEDIUM)** — Order-Book nur 3 Symbole (Spec 20)

**Keine CRITICAL-Befunde, Bot stabil:** PID 83537, Wallet $1107.28, Reserve $0, LIVE aus, 2 OPEN Grids.

**Christian-Entscheidung erbeten:**
- Roadmap inkl. neue Fixes deployen?
- poppler installieren für PDF-Audit?
- Cypress installieren für Browser-Tests?
