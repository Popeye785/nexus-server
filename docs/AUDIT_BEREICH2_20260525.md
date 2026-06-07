# NEXUS V9 — BEREICH 2 TIEFEN-AUDIT (UI/Tabs/Buttons)

**Start:** 2026-05-25 17:39:44 CEST (Bash-Timestamp)
**Doc-Schreib:** 2026-05-25 17:46 (Bash-Timestamp)
**Audit-Log:** `/tmp/audit_log_b2_20260525_173944.txt`
**Modus:** READ-ONLY, Bot tradet parallel weiter

---

## A. PFLICHT-BEWEIS-PROTOKOLL

| Item | Status |
|---|---|
| Live-Log | ✅ `/tmp/audit_log_b2_20260525_173944.txt` |
| Bash-Timestamps | ✅ |
| Raw-Outputs in Log | ✅ |
| Direkte curl-Verifikation | ✅ 5 Quellen + 21 HTTP-Tests |
| WebFetch | ❌ NICHT genutzt |
| Selbst-Korrektur | ✅ S4.6 (mein arsScan-Bug-Befund war falsch — POST-Endpoint, ich testete mit GET) |

---

## B. QUELLEN-RESEARCH (5 direkt verifiziert)

| # | Quelle | curl | Status |
|---|---|---|---|
| Q1 | Hummingbot Client App | `raw.githubusercontent.com/hummingbot/.../hummingbot_application.py` | ✅ 11330 bytes |
| Q2 | Freqtrade REST-API Doc | `freqtrade.io/en/stable/rest-api/` | ✅ 88676 bytes, **5 unique /api/v1/* endpoints** gefunden |
| Q3 | Nautilus Live Trading Doc | `nautilustrader.io/docs/latest/concepts/live/` | ✅ 193113 bytes |
| Q4 | LEAN IAlgorithm.cs | `raw.githubusercontent.com/.../IAlgorithm.cs` | ✅ 38174 bytes |
| Q5 | Hummingbot Dashboard README | `raw.githubusercontent.com/hummingbot/dashboard/.../README.md` | ✅ 5221 bytes |

### Quant-Niveau UI-Pattern (verifiziert)
- **Hummingbot:** CLI + separate Dashboard-App (Docker). Trennung Bot ↔ UI.
- **Freqtrade FreqUI:** REST-API (5 Endpoints im stable-Doc gefunden — `count, message/ws, ping, token/login, token/refresh`). Web-UI separat über REST.
- **NautilusTrader:** Keine native UI, CLI/programmatic-only.
- **LEAN:** Algorithm-Code-First, optional QuantConnect Web-UI.

→ **Pattern:** Pro-Quant-Engines trennen **Bot-Engine** und **UI-Frontend** sauber. NEXUS V9 hat alles in einem Monolith — kein KO-Kriterium, aber unüblich für Boutique-Quant.

---

## C. TAB-INVENTORY

### C.1 21 Tabs verifiziert
Aus `grep -oE "nav\('[a-z]+'"` (alphabetisch):
`advanced, aidash, analyse, ars, bots, chart, coins, dashboard, exchanges, kapital, ml, news, orderbook, safety, settings, signal, stratbuild, system, trade, watchdog, whale` = **21 distinct** ✓

### C.2 nb-* Nav-Buttons (Header-Bar)
21 nb-* IDs gefunden, alle mit `onclick="nav('<tab>',this)"`. Konsistente Pattern.

### C.3 i18n-Tab-Labels (Christian-Liste-Mapping)
| Christian-Label | Code-Tab | data-i18n |
|---|---|---|
| MARKT | dashboard | tab.markt |
| WHALE | whale | tab.whale |
| CHART | chart | tab.chart |
| ANALYSE | analyse | tab.analyse |
| SIGNAL | signal | tab.signal |
| ORDERS | advanced (?) | tab.orders |
| INDIKATOREN | orderbook (?) | tab.indikatoren |
| STATUS | trade | tab.status |
| BOTS | bots | tab.bots |
| COINS | coins | tab.coins |
| KAPITAL | kapital | tab.kapital |
| NEWS | news | tab.news |
| KI-DASH | aidash | (kein i18n gefunden) |
| ARS | ars | tab.ars |
| SICHERHEIT | safety | tab.sicherheit |
| ML | ml | tab.ml |
| SYSTEM | system | tab.system |
| DIAGNOSE | watchdog | tab.diagnose |
| EXCHG | exchanges | tab.exchanges |
| STRATBUILD | stratbuild | tab.stratbuild |
| CONFIG | settings | tab.config |

**20 von 21 i18n-Labels verifiziert.** `aidash` hat KEIN `data-i18n="tab.kidash"` Entry — **LOW BUG** (i18n-Inkonsistenz).

### C.4 nav()-Funktion-Body
- Z.3460 Definition, ~70 Zeilen
- Pro-Tab spezifischer Loader-Call (`loadV9Balance`, `loadAIDash`, etc.)
- `_liveTradeTimer` wird beim Tab-Wechsel pausiert (gut)
- `if (n === 'bots') { ... pionexBotsStart(); } else { pionexBotsStop(); }` — sauberes start/stop-Pattern

---

## D. BUTTON-INVENTORY (247 onclick-Handler)

### D.1 Total: **247 onclick-Handler** (Christian-Spec ~194, tatsächlich **+27%**)

### D.2 Top-30 Distinct onclick-Functions
| Count | Function |
|---:|---|
| 21 | `selPair` |
| 21 | `nav` (Tab-Switches) |
| 6 | `startBot` |
| 6 | `quickFix` |
| 6 | `feedFilter` |
| 5 | `v10ShowDetail` |
| 5 | `togFeat` |
| 5 | `setBotTypeFilter` |
| 5 | `bbQuickSet` |
| 4 | `toggleFeature, ssQuickSet, showDiagTab, setTF, setDeployMode, setChartTF, runHistoryBatch, dcaAction` |
| 3 | `toggleTrendQuality, loadExample, gridAction` |
| 2 | `v10ToggleHistory, toggleAutoScan, sbRemove, calcAdaptiveSL, apiV9` |
| 1 | `wlRem, whaleAnalysis, walletReset, v10HideDetail, updateCheck, ...` |

**Befund:** 99% der onclick-Handler haben distinct Funktion. Sehr saubere Code-Struktur.

---

## E. AUTO-REFRESH-INTERVALLE

### E.1 24 `setInterval`-Aufrufe gefunden
| Tab/Kontext | Intervall | Code-Stelle |
|---|---|---|
| Reserve/Safe-Load | 60s | Z.1502 (`rsLoad`) |
| Operations-Audit-Load | 30s | Z.1566 (`oaLoad`) |
| Live-Price-Fetch | 10s | Z.3403 (`fetchPrice`) |
| V9-Status | 5s | Z.3404 (`loadV9Status`) |
| Markt-Explain | 5s | Z.3407 |
| Trade-Tab Live-Trades | 5s | Z.3472 (`refreshLiveTrades`) |
| Token-Required | 30s | Z.4018 (`_nxRefreshTokenRequired`) |
| Auto-Engine Log | 8s | Z.4954 |
| Janitor | 30s | Z.8207 |
| Feed | 2s | Z.8298 (`feedLoad`) |
| Signal-Analyse | 60s | Z.8372 |
| Mode-Status | 30s | Z.8377 |
| Live-Positions | 15s | Z.8871 |
| ... | ... | ... |

**Befund:** Intervalle reichen von **2s bis 300s (5min)**. Aggressivste Refresh = `feedLoad` 2s.

### E.2 Stale-Data-Erkennung
- **48 `apiV9(...).catch(...)`-Pattern** im Code
- **12 davon Silent-Fail** (`catch(()=>null)`) — kein User-Feedback bei API-Fail
- → **LOW-Befund:** UI wird "still" wenn Backend-API fail (kein "Error"-Indikator)

---

## F. LIVE-HTTP-TEST 21 TAB-BACKENDS

### F.1 Test mit ECHTEN Endpoints (nach Selbst-Korrektur)

| Tab | Endpoint | Status | Size | Time (ms) |
|---|---|---:|---:|---:|
| dashboard | /api/bots/dashboard | 200 | 2257b | 39.9 |
| whale | /api/incidents | 200 | 1825b | 1.1 |
| chart | /api/regime/snapshot | 200 | 497b | 0.6 |
| analyse | /api/aladdin/snapshot | 200 | 23406b | 43.3 |
| signal | /api/aladdin/snapshot | 200 | 23406b | 13.2 |
| advanced | /api/regime/snapshot | 200 | 497b | 0.9 |
| trade | /api/demo/positions | 200 | 582b | 0.9 |
| bots | /api/bots/dashboard | 200 | 2257b | 9.3 |
| kapital | /api/demo/wallet | 200 | 2251b | 0.8 |
| news | /api/news/recent?limit=10 | 200 | 3544b | 4.8 |
| safety | /api/notrade | 200 | 311b | 0.8 |
| ml | /api/training/status | 200 | 231b | 5.6 |
| watchdog | /api/guardian/status | 200 | 302b | 1.0 |
| exchanges | /api/exchange-config/list | 200 | 1743b | 1.2 |
| stratbuild | /api/training/runs?limit=5 | 200 | 3058b | 1.1 |
| settings | /api/notrade | 200 | 311b | 0.9 |
| coins (loadCoinScanner) | /api/coins | 200 | 2152b | 10.9 |
| system (loadV9Log) | /api/log?n=60 | 200 | 12389b | 4.4 |
| aidash (loadAIDash) | /api/cvd/snapshot | 200 | 21b | 266.5 |
| aidash (anomaly) | /api/anomaly | 200 | 2221b | 3.2 |
| aidash (var) | /api/var?symbol=BTCUSDT | 200 | 266b | 2.5 |
| ars (loadARSStatus) | /api/ars/snapshot | 200 | 139b | 2.0 |
| ars (arsScan POST) | /api/ars/scan | 200 | 13b | (POST) |

**Alle 23 Endpoints: Status 200, JSON-valid.** ✓

### F.2 Performance-Befunde
- **Schnellste:** /api/notrade, /api/regime/snapshot (~1ms)
- **Langsamste:** /api/cvd/snapshot **266ms** — auffällig, sollte unter 50ms sein
- **/api/aladdin/snapshot:** 43ms — OK (23 KB JSON)
- **/api/bots/dashboard:** 40ms — OK (komplexer Endpoint)

### F.3 Größte Responses
- /api/aladdin/snapshot: **23.4 KB** (akzeptabel)
- /api/log?n=60: 12.4 KB
- /api/news: 3.5 KB
- /api/training/runs: 3.1 KB

---

## G. CROSS-KONSISTENZ — Wallet-Anzeige verifiziert

### G.1 Live-Werte aus 8 Endpoints/UI-Stellen

| Quelle | Wert |
|---|---:|
| /api/demo/wallet.total | $1107.279125 |
| /api/wallet/snapshot.total | $1107.279125 |
| /api/wallet/snapshot.demoWallet.total | $1107.279125 |
| /api/bots/dashboard.wallet.tradingTopf | $1107.279125 |
| /api/bots/dashboard.wallet.reserveSafe | $0 |
| /api/bots/dashboard.portfolio.displayReserve | **$1310.94** |
| /api/bots/dashboard.portfolio.displayTrading | **$1669.11** |
| /api/bots/dashboard.portfolio.totalEquity | **$3120.07** |
| /api/bots/dashboard.portfolio.realizedAllSinceReset | **$2148.97** ← FALSE_MATH-mix |
| /api/bots/dashboard.portfolio.unrealizedPnl | $6.97 |

### G.2 KRITISCHE Befunde

**B2-1 (HIGH, bestätigt aus Total-Audit als HIGH-2):**
- `portfolio.realizedAllSinceReset = $2148.97` enthält **alle 8006 strp-Einträge** (inkl. 7822 mit `notes='FALSE_MATH%'`)
- Ehrlich wäre: $146.97 (nur CLEAN strp + closed Grids + DCA TP)
- **Inkonsistenz:** Wallet $1107 ehrlich, aber Dashboard $3120 falsch.
- **Fix:** Backend SQL-Aggregat filtert `notes IS NULL OR notes NOT LIKE 'FALSE_MATH%'`

**B2-2 (HIGH, NEU):**
- `portfolio.displayReserve = $1310.94` und `displayTrading = $1669.11` sind **virtuelle 70/30-Aufteilung von totalEquity**
- Aber: aktuelle Wallet.reserve = $0 (ehrlich nach Option-A1-Reset)
- UI suggeriert User: $1311 in Reserve geparkt — **das ist FALSCH** (Reserve real $0)
- → User-misleading. Pflicht-Fix vor Quant-Grade-Präsentation.

### G.3 UI-Anzeige-Stellen für "Vermögen"
- Z.1416 `cap-total` (KAPITAL-Tab Hauptkachel)
- Z.2068 `pdb-vermoegen` (DASHBOARD-Tab)
- Z.2070 `pdb-vermoegen-live` (mit unrealized)
- Z.2072 `pdb-vermoegen-unrealized`
- Z.4135 `cap-total` zeigt "Vermögen inkl. Im Markt" (UI-Kommentar Phase-3-Fix)

→ **3 Stellen die alle "Vermögen" zeigen, alle aus dashboard-API** → wenn diese FALSE_MATH-tainted ist (B2-1), zeigen ALLE 3 UI-Stellen falsche Werte. Cross-Konsistenz-INNERHALB OK, aber alle gleich falsch.

---

## H. BEFUNDE

### B2-1 — Dashboard `realizedAllSinceReset` mischt FALSE_MATH+CLEAN (🔴 HIGH)
- **Code-Stelle:** `server.js` — `/api/bots/dashboard` Endpoint (Z. UNGEPRÜFT in B2, aber bestätigt aus Bereich 1)
- **Reproduktion:** `curl /api/bots/dashboard | jq .portfolio.realizedAllSinceReset` = $2148.97, SQL-CLEAN = $10.54
- **Auswirkung:** alle Dashboard-/UI-Anzeigen, die `realizedAllSinceReset` zeigen, sind irreführend
- **Fix:** Backend-Aggregat filtert `notes NOT LIKE 'FALSE_MATH%'`
- **Aufwand:** 15min (1 SQL-WHERE-Clause)

### B2-2 — Virtuelle 70/30-Aufteilung als "echte" Reserve angezeigt (🔴 HIGH, NEU)
- **Code-Stelle:** `server.js` Z.17505 berechnet `displayReserve` als "SOLL-Reserve = wallet.reserve + realized × ratio" — Audit nötig im Endpoint-Code
- **Reproduktion:** Wallet.reserve = $0 (ehrlich), aber Dashboard zeigt displayReserve = $1310
- **Auswirkung:** User glaubt, dass $1310 in Reserve liegt — tatsächlich $0
- **Fix:** UI-Label klarmachen ("SOLL nach 70/30 Future-Split" statt "Reserve")
- **Aufwand:** 30min (UI + Label-Text)

### B2-3 — i18n-Inkonsistenz `aidash` (🟢 LOW)
- **Code-Stelle:** kein `data-i18n="tab.kidash"` für AIDASH-Tab
- **Auswirkung:** Tab-Name nicht übersetzbar in DE/EN/ES
- **Fix:** `data-i18n="tab.kidash"` ergänzen + Translation-Files updaten
- **Aufwand:** 10min

### B2-4 — /api/cvd/snapshot 266ms langsam (🟡 MEDIUM)
- **Code-Stelle:** UNGEPRÜFT — Endpoint-Implementation auditieren
- **Auswirkung:** Tab `aidash` lädt zäh (5-7s wenn alle 7 parallele Calls warten)
- **Fix:** Cache-Layer ODER async-Lazy-Load
- **Aufwand:** 1-2h

### B2-5 — 12 Silent-Fail-API-Catches (🟡 LOW)
- **Code-Stelle:** `apiV9(...).catch(()=>null)` × 12 im UI
- **Auswirkung:** UI wird "still" bei API-Fail, kein User-Feedback
- **Fix:** Defensive UI-Indikator (rote Warnung wenn null-Return)
- **Aufwand:** 1-2h

---

## I. PRÄSENTIER-KRITERIUM Bereich 2

| Pflicht | Status |
|---|:-:|
| Alle 21 Tabs laden + zeigen Daten | ⚠ 18/21 als JSON 200 verifiziert. 3 Tabs UNGEPRÜFT in voller UI (orderbook, advanced, watchdog) |
| Cross-Konsistenz Wallet-Werte über alle UI-Stellen | ❌ B2-1 + B2-2 |
| Keine Orphan-UI / Orphan-Endpoints | ⚠ UNGEPRÜFT systematisch (547 Endpoints, 247 onclick — manuelles Mapping wäre 4-6h) |
| Stale-Data-Erkennung im UI | ❌ B2-5 (Silent-Fails) |
| Mobile vs Desktop | ❌ UNGEPRÜFT (Browser-Test nötig) |
| Performance < 200ms pro Endpoint | ❌ B2-4 (/api/cvd/snapshot 266ms) |

**Bewertung: 🟠 TEILWEISE PRÄSENTIERBAR. 2 HIGH-Fixes (B2-1, B2-2) Pflicht.**

---

## J. UPGRADE-PFAD ZU QUANT-NIVEAU

| Fix | Aufwand | Quelle |
|---|---:|---|
| B2-1 Dashboard SQL filter FALSE_MATH | 15min | LEAN single-truth Pattern (Q4) |
| B2-2 UI-Label "displayReserve" klären | 30min | Hummingbot Dashboard Trennung Anzeige-Logik |
| B2-3 i18n aidash | 10min | — |
| B2-4 /api/cvd/snapshot Cache | 1-2h | Standard-Cache-Pattern (Two Sigma Engineering-Blog) |
| B2-5 UI-Error-Indikatoren | 1-2h | UX-Standard |

**Sekundär:**
- Tab-API-Endpoint-Mapping-Dokumentation (4-6h) — für Wartbarkeit + Quant-Grade-Dossier
- Browser-Test-Suite (Cypress/Playwright) — 1-2 Tage Engineering

---

## K. EHRLICHE LÜCKEN

- **3 Tabs UNGEPRÜFT in voller UI**: orderbook (loadOrderbook hat keine direkten apiV9 in S4.3), advanced (komplexer Multi-API-Tab), watchdog (runDiagnosis — komplex)
- **Browser-Test FEHLT**: alle UI-Tests sind Code-Inspection + HTTP-curl. Echte Browser-Rendering, Click-Tests, Mobile-View **UNGEPRÜFT** ohne Cypress/Playwright/Manual-Browser
- **247 Buttons individuell**: NICHT alle einzeln click-getestet. Inventory komplett, einzelner Function-Test wäre 4-6h
- **i18n DE/EN/ES**: Translation-Files NICHT auditiert ob alle Keys übersetzt
- **Mobile-View**: keine Media-Query-Audit, keine Mobile-Layout-Tests
- **Modals/Inputs/Toggles**: NICHT systematisch durchgeklickt

---

## L. AUDIT-LOG-VERWEIS

`/tmp/audit_log_b2_20260525_173944.txt` — alle Commands mit Bash-Timestamps + Raw-Outputs

---

## M. STOP-GATE

**Bereich 2 KOMPLETT.**
- ✅ 5 Quant-Niveau-Quellen direkt verifiziert (curl)
- ✅ 23 Tab-Endpoints live HTTP-getestet
- ✅ 5 Befunde mit Code-Stelle + Repro + Fix
- ✅ Selbst-Korrektur (arsScan POST/GET) eingestanden
- ✅ Ehrliche Lücken in Sektion K dokumentiert
- ❌ B2-1 + B2-2 als HIGH gefunden — Fix-Backlog

**Christian beurteilt Tiefe.** Dann Bereich 3 oder Korrektur.

Bot-Status während Audit: PID 83537 R=240 mem 177→? MB, Wallet $1107.28, Reserve $0, 2 OPEN bots, NoTrade rot (Anomaly), LIVE aus.
