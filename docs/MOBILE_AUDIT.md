# MOBILE-VIEW AUDIT — iPhone 12 Headless (Playwright)

**Datum:** 2026-05-25
**Setup:** Playwright `chromium` (1224) · `devices['iPhone 12']` (390×664 viewport, DPR 3, isMobile, hasTouch)
**Proxy-Hint:** `localStorage.nx_proxy = 'http://localhost:3000'` via `addInitScript` gesetzt (zur Reduktion CORS-Noise von Tailscale-IP).
**Touch-Target-Schwelle:** WCAG 2.5.5 / Apple HIG → **44×44 px** (w≥44 UND h≥44).
**URL:** `http://localhost:3000` (HTTP 200, Bot online).

---

## 1. Zusammenfassung

| Metrik | Wert |
|---|---:|
| Tabs gefunden (`[id^="nb-"]`) | **21** |
| Tabs erfolgreich angeklickt | 21 / 21 |
| Tabs mit horizontalem Overflow | **0** (scrollWidth ≤ innerWidth bei allen Tabs) |
| Buttons aggregat (alle Renderings) | 630 |
| Buttons unter 44×44 px (aggregat) | **619** (98.3 %) |
| Unique-Button-IDs/-Klassen failing | **129** |
| Console-Errors total | 11 |
| Page-Errors (JS-Exceptions) | 1 |

---

## 2. Per-Tab-Übersicht

| Tab | Overflow-H | #Buttons | #Touch-too-small | Console-Errs | Screenshot |
|---|---|---:|---:|---:|---|
| dashboard | No | 33 | 33 | 0 | `/tmp/mobile_audit_dashboard.png` |
| whale | No | 24 | 24 | 0 | `/tmp/mobile_audit_whale.png` |
| chart | No | 28 | 28 | 0 | `/tmp/mobile_audit_chart.png` |
| analyse | No | 23 | 23 | 0 | `/tmp/mobile_audit_analyse.png` |
| signal | No | 24 | 24 | 0 | `/tmp/mobile_audit_signal.png` |
| orderbook | No | 24 | 24 | 0 | `/tmp/mobile_audit_orderbook.png` |
| advanced | No | 26 | 26 | 0 | `/tmp/mobile_audit_advanced.png` |
| trade | No | 24 | 24 | 0 | `/tmp/mobile_audit_trade.png` |
| bots | No | 34 | 34 | 0 | `/tmp/mobile_audit_bots.png` |
| coins | No | 26 | 26 | 0 | `/tmp/mobile_audit_coins.png` |
| kapital | No | 38 | 38 | 0 | `/tmp/mobile_audit_kapital.png` |
| news | No | 24 | 24 | 0 | `/tmp/mobile_audit_news.png` |
| aidash | No | 38 | 36 | **4** | `/tmp/mobile_audit_aidash.png` |
| ars | No | 24 | 24 | **1** | `/tmp/mobile_audit_ars.png` |
| safety | No | 30 | 30 | 0 | `/tmp/mobile_audit_safety.png` |
| ml | No | 40 | 31 | 0 | `/tmp/mobile_audit_ml.png` |
| system | No | 38 | 38 | 0 | `/tmp/mobile_audit_system.png` |
| watchdog | No | 30 | 30 | 0 | `/tmp/mobile_audit_watchdog.png` |
| exchanges | No | 50 | 50 | **1** | `/tmp/mobile_audit_exchanges.png` |
| stratbuild | No | 28 | 28 | 0 | `/tmp/mobile_audit_stratbuild.png` |
| settings | No | 24 | 24 | 0 | `/tmp/mobile_audit_settings.png` |

**Befund:** Kein horizontales Overflow bei keinem Tab — Layout ist responsiv genug, dass es nicht horizontal scrollt. Die 9 von 11 Console-Errors stammen aus CORS-blockierten Calls Richtung `http://100.67.6.22:3000` (Tailscale-IP) trotz `nx_proxy`-Hint (offenbar gibt es eine zweite Hardcoded-Origin-Pfadlogik im Client). Die 2 verbleibenden 403er sind separate Fetch-Failures.

---

## 3. Top-Cluster der Touch-Target-Failures

Häufigkeit der Dimensionen (aggregat über alle Tabs):

| Dimension | Count | Typ | Bewertung |
|---|---:|---|---|
| **54 × 41 px** | 357 | Nav-Tabs `nb-*` (auf jeder Seite wiederholt) | **Höhe 41 px — 3 px unter Schwelle** |
| 67 × 41 px | 42 | Nav-Tabs `nb-ml`, `nb-system` etc. | Höhe 41 px |
| 87 × 29 px | 21 | `#masterSwitch` (MANUELL/AUTONOM) | Höhe 29 px — kritisch klein |
| 83 × 31 px | 21 | `#modeSwitchBtn` (DEMO/LIVE) | Höhe 31 px — kritisch klein |
| 72 × 41 px | 21 | Nav-Tabs (breitere Labels) | Höhe 41 px |
| 56 × 41 px | 21 | Nav-Tabs | Höhe 41 px |
| 169 × 26 px / 169 × 31 px | 18 | Sekundär-Aktion-Buttons (`▶ START`, `■ STOP`, `🛑 NOT-AUS`, `▶ DryRun EIN`) | Höhe 26/31 px |
| 130 × 26 px | div. | `SAVE`, `TEST RUN`, `CLEAR`, `VALIDATE` | Höhe 26 px |

---

## 4. Konkrete Failures (Auszug — unique-IDs)

### 4.1 Nav-Tabs (Höhe 41 px statt 44, weltweit auf jeder Seite sichtbar)
- `#nb-dashboard` / `#nb-whale` / `#nb-chart` / `#nb-analyse` / `#nb-signal` / `#nb-orderbook` / `#nb-advanced` / `#nb-trade` / `#nb-bots` / `#nb-coins` / `#nb-kapital` / `#nb-news` / `#nb-aidash` / `#nb-ars` / `#nb-safety` / `#nb-ml` / `#nb-system` / `#nb-watchdog` / `#nb-exchanges` / `#nb-stratbuild` / `#nb-settings` — alle 54/56/67/72 × **41 px**.

### 4.2 Header-Toggles (kritisch klein)
- `#masterSwitch` (`👤 MANUELL`) — **87 × 29 px**
- `#modeSwitchBtn` (`🔵 DEMO`) — **83 × 31 px**

### 4.3 Mini-Action-Chips (`btn-sm`, viele Bereiche)
- `25% / 50% / 75% / 100% / AUTO / 3 / 5 / 8 / 12 / AUS` — **66 × 26 px** (10 Stück)
- `LOG LEEREN` / `JETZT SCANNEN` / `↻ NEUBERECHNEN` — ca. 96-126 × **26 px**
- `▶ START`, `■ STOP`, `↻ STATUS`, `↺ ZURÜCKSETZEN`, `↻ HEAL`, `↻ WS Reconnect`, `↻ Balance Reload`, `↻ DB Checkpoint`, `↻ Error Reset`, `↻ KillSw Reset`, `↻ Strat Reset` — alle 169-170 × **26 px**
- `▶ ENTSCHEIDUNG`, `↺ RESET` — 170 × 26 px
- `⚡ SAFE`, `🛑 NOT-AUS`, `▶ DryRun EIN`, `🔄 TIER WECHSELN`, `📊 PROMOTION?`, `💾 SPEICHERN`, `📨 TEST` — 169 × **31 px**
- `📐 BUY LEVEL`, `📐 SELL LEVEL` — 170 × 31 px

### 4.4 Tab-Chips / Filter-Chips (sehr klein)
- Filter-Chips `bt-filter-btn`: `Alle 4` / `DCA 0` / `GRID 2` / `INFGRID 1` / `SINGLE 1` — 52-76 × **22 px**
- Log-Filter-Chips: `ALL` / `GATES` / `TRADES` / `SIGNAL` / `ERRORS` / `TG` — 31-52 × **21 px**
- `tq-toggle-adx` / `tq-toggle-mtf` / `tq-toggle-atr` — 111 × **24 px**
- `ctf-15m` / `ctf-1h` / `ctf-4h` / `ctf-1d` — 31-36 × **26 px**

### 4.5 Schließen / Mini-Buttons
- Close-Button (txt `×`) — **18 × 15 px** (extrem klein, kaum treffbar)
- Refresh `↻` ohne ID — **195 × 13 px** (zu flach)
- `feed-pause-btn` (⏸) — **26 × 21 px**
- `✕ Close`, `⏸ Pause` — 50-52 × **19 px**
- `✓ Anwenden` — 81 × **20 px**

---

## 5. Console-/Page-Errors

### Page-Error (1, fatal)
```
TypeError: Cannot set properties of null (setting 'textContent')
```
Tritt einmalig nach initialem Boot auf — DOM-Element nicht im Mobile-Viewport gerendert (z.B. `getElementById` liefert null vor erstmaligem Tab-Switch).

### Console-Errors (11)
- 7× **CORS-Block** für `http://100.67.6.22:3000/api/status` und `/api/botmanager` (Tailscale-IP wird trotz `nx_proxy=http://localhost:3000` weiter aufgerufen — Hardcode-Pfad existiert)
- 4× **403 Forbidden** für ungenannte Resource (Header-Check oder Auth-Endpoint)

**Verteilung nach Tab:** aidash 4× · ars 1× · exchanges 1× · Rest 0. Die übrigen 5 fallen vor dem ersten Tab-Click.

---

## 6. Screenshots

22 PNG-Dateien (390×664) unter `/tmp/`:
- `mobile_audit_INITIAL.png` (Boot)
- `mobile_audit_<tabName>.png` für jeden der 21 Tabs (dashboard, whale, chart, analyse, signal, orderbook, advanced, trade, bots, coins, kapital, news, aidash, ars, safety, ml, system, watchdog, exchanges, stratbuild, settings)

---

## 7. Verdikt

# 🔴 ROT — Mobile-View nicht produktionsreif für Touch-Bedienung

**Begründung:**
1. **Nav-Tabs alle 41 px hoch** (Schwelle 44) → 21 von 21 globalen Navigations-Buttons unter WCAG 2.5.5. Da diese auf jeder Seite präsent sind, wird die Touch-Failure-Rate gegen 100 % treiben.
2. **Header-Toggles (MANUELL/AUTONOM, DEMO/LIVE)** liegen bei 29/31 px — kritische Mode-Switcher, die kleine Touchziele haben.
3. **Sekundär-Buttons fast durchgehend bei 26/31 px** — typische Trader-Aktionen wie `▶ START`, `■ STOP`, `🛑 NOT-AUS`, `💾 SPEICHERN`, `↺ RESET` sind nur ~26 px hoch.
4. **Mini-Chips/Filter** liegen teilweise bei 21-22 px Höhe und 31-36 px Breite — kaum noch zuverlässig per Daumen treffbar.
5. **1 JS-PageError + CORS/403-Cluster** zeigen unsaubere Fallback-Logik wenn die App nicht über die ursprünglich gespeicherte Origin geladen wird.

**Positiver Aspekt:**
- Kein horizontales Overflow auf irgendeinem Tab (responsiver Layout-Container hält die Breite zuverlässig).
- Alle 21 Tabs sind anklickbar/erreichbar.

**Empfehlungen (nicht im Auftrag, nur referenz):**
1. Globaler CSS-Fix: `.nb-tab { min-height: 44px; min-width: 44px; }` plus `padding: 0.5rem` — löst 21 Nav-Tab-Fails.
2. `.btn-sm { min-height: 36px; }` + Aktion-Buttons im Trader-Workflow auf `min-height: 44px` heben (oder explizit als Desktop-only deklarieren).
3. `#masterSwitch`, `#modeSwitchBtn` auf 44×88 px erweitern (kritisch wegen DEMO↔LIVE-Switch).
4. Close-Button `×` muss 44×44 px Hit-Box bekommen (CSS `::before`-Pad oder `padding: 14px`).
5. JS-Init-Reihenfolge prüfen: Page-Error deutet auf DOM-Zugriff vor Render hin.

---

*Erstellt: 2026-05-25 via Playwright headless (iPhone 12) — read-only audit, keine Code-Änderungen.*
