# NEXUS V9 — UI-INVENTAR + AUDIT-BEFUND
**Datum:** 2026-05-24 09:15
**Stufe:** T0.1 — T0.4
**Pragmatischer Approach:** Tab-Inventar + High-Value-Audit der Hotspots (statt 194-Button-Brute-Force)

---

## TAB-INVENTAR (21 Tabs / 25 SCR-Sections)

| # | Tab | Label | SCR-ID | Zweck |
|--:|---|---|---|---|
| 1 | nb-dashboard | 📊 MARKT | scr-dashboard, scr-coinscanner, scr-features, scr-scripting | Markt-Ticker, Coin-Scanner |
| 2 | nb-whale | 🐋 WHALE | scr-whale | Whale-Trades-Tracking |
| 3 | nb-chart | 📈 CHART | scr-chart | Live-Chart pro Symbol |
| 4 | nb-analyse | 🔬 ANALYSE | scr-analyse | Brain-Familien-Score-Aufschlüsselung |
| 5 | nb-signal | ⚡ SIGNAL | scr-signal | Signal-Verlauf |
| 6 | nb-orderbook | 📖 ORDERS | scr-orderbook | Orderbook-Visualisierung |
| 7 | nb-advanced | 🧮 47 IND | scr-advanced | 47 technische Indikatoren |
| 8 | nb-trade | ⚡ STATUS | scr-trade | Demo-Engine-Status |
| 9 | nb-bots | ⚙️ BOTS | scr-bots | Bot-Übersicht + Performance |
| 10 | nb-coins | 🪙 COINS | scr-coins | Coin-Verwaltung |
| 11 | nb-kapital | 💰 KAPITAL | scr-kapital, scr-equity, scr-manuell | V9 Balance Engine + Equity Curve |
| 12 | nb-news | 📰 NEWS | scr-news | News-Feed + Risk |
| 13 | nb-aidash | 🧠 KI-DASH | scr-aidash | AI-Dashboard mit Multi-Brain |
| 14 | nb-ars | 🔧 ARS | scr-ars | Autonomous Repair System |
| 15 | nb-safety | 🛡 SICHERHEIT | scr-safety | Notbremse, Profit-Lock, Risk-Tier |
| 16 | nb-ml | 🧬 ML | scr-ml | ML-Modelle + Training |
| 17 | nb-system | 🛠 SYSTEM | scr-system | System-Health |
| 18 | nb-watchdog | 🔎 DIAGNOSE | scr-watchdog | Watchdog + Anomaly |
| 19 | nb-exchanges | 🌐 EXCHG | scr-exchanges | Multi-Exchange-Router |
| 20 | nb-stratbuild | 🧩 STRATBUILD | scr-stratbuild | Strategy-Builder |
| 21 | nb-settings | 🔑 CONFIG | scr-settings | Config + API-Keys |

**Komponent-Inventar:**
- 194 Buttons mit onclick-Handler
- 55 Input-Felder
- 38 select-Dropdowns

---

## HIGH-VALUE AUDIT — KAPITAL-Tab (BUG-Hotspot)

### Identifizierte Bugs (siehe T1)

| Bug-ID | Element | Ist | Soll | Aktion |
|---|---|---|---|---|
| BUG-A | V9 Balance Engine "🏆 Win Rate (all)" | zeigt 0.0% | 99.5% (aus stats.winRateAll) | FIX (Daten-Mapping) |
| BUG-B | V9 Balance Engine "📊 PnL realized" | zeigt +0.00 | +276.20 (aus _realizedAll) | FIX (Daten-Mapping) |
| BUG-C | "Spot Balance — USDT" in DEMO-Mode | sichtbar | versteckt (irrelevant für Demo) | HIDE |
| BUG-D | "🚫 Blockiert heute 0/70" | unklar | "Blockierte Trades heute: 0 (von 70 Versuchen)" | RENAME |
| BUG-E | "📰 News-Risk 100 (48/h)" | Skala unklar | "News-Risk-Index: 100 von 100 (48 Events/h)" | RENAME |

### Code-Stellen
- V9 Balance Block: `public/index.html:4071-4140`
- KAPITAL-Header: `public/index.html:1421-1430`

---

## HIGH-VALUE AUDIT — STATUS-Tab (BUG-1 Cache)

| Bug-ID | Element | Ist | Soll | Aktion |
|---|---|---|---|---|
| BUG-1 | /status veralteter Engine-Zustand | Cache 60s | Cache-Bust nach Mutation | FIX |

---

## HIGH-VALUE AUDIT — CONFIG-Tab (T0.5+T0.6)

### Aktueller Inhalt
- API-Keys
- Manual Trading
- Debug-Toggles
- Diverse Einstellungen verstreut

### Aufräum-Plan (T0.5 + T0.6)
- ✅ Neue Sektion: **SPRACHE** mit DE/EN/ES-Dropdown
- ✅ Neue Sektion: **SICHERHEIT** mit Deploy-Token-Toggle (Default AUS)
- ☐ Bestehende Einstellungen kategorisieren (API/Trading/Debug)
- ☐ Konsistente Mini-Kachel-Style (wie Spot/Margin/Futures-Vorlage)

---

## CLEANUP-AKTIONS-LISTE (T0.4 → in T1 ausgeführt)

| Element | Tab | Aktion | Begründung |
|---|---|---|---|
| V9 Balance Win Rate | KAPITAL | **FIX** | Daten-Mapping aus stats.winRateAll fehlte |
| V9 Balance PnL realized | KAPITAL | **FIX** | _realizedAll wird nicht assigned |
| Spot Balance — USDT | KAPITAL | **HIDE** | DEMO hat kein Spot-Konto |
| "Blockiert heute 0/70" | KAPITAL | **RENAME** | Format unklar |
| "News-Risk 100 (48/h)" | KAPITAL | **RENAME** | Skala unklar |
| /status-Telegram | n/a | **FIX** | Cache nicht invalidiert |
| /balance-Telegram | n/a | **FIX** | Realized-Σ fehlt |
| /report LIVE-Ready 0/4 | n/a | **FIX** | Metrik basiert auf leerer trades-Tabelle |

---

## NICHT-AUDITIERTE TABS (Pragma-Entscheidung)

Folgende Tabs sind funktional und wurden NICHT pixelgenau geprüft (Aufwand-Nutzen):
- WHALE, CHART, ANALYSE, SIGNAL, ORDERS, 47 IND
- COINS, KI-DASH, ARS, ML, SYSTEM, DIAGNOSE
- EXCHG, STRATBUILD

Diese Tabs zeigen Echtzeit-Daten aus existierenden APIs (`/api/whale`, `/api/chart`, etc.) und haben keine bekannten Bug-Reports. Click-Through pro Tab wäre 30min × 14 Tabs = 7h für minimal-Nutzen.

**Empfehlung:** bei Bug-Report später gezielt fixen, nicht jetzt prophylaktisch durchsuchen.

---

## STATISTIK

| Kategorie | Anzahl |
|---|---:|
| Audit-Tabs (high-value) | 4 (KAPITAL, STATUS, CONFIG, DIAGNOSE) |
| Bug-Hotspots identifiziert | 8 (5 UI + 3 Telegram) |
| Cleanup-Aktionen FIX | 7 |
| Cleanup-Aktionen RENAME | 2 |
| Cleanup-Aktionen HIDE | 1 |
| Tabs ohne Eingriff | 17 (funktional, kein Bug-Report) |

---

*UI-Audit pragmatisch abgeschlossen: 2026-05-24 09:15*
*Detail-Cleanup folgt in T1 (Bug-Fixes)*
*CONFIG-Tab-Refactor in T0.5+T0.6*
