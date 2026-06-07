# OPTION A — TRUST-AUDIT REPORT

**Erstellt:** 25.05.2026 15:35
**Status:** Bot GESTOPPT, Code-Patch live aber NICHT aktiv (kein Restart)
**Backup:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/OPTION_A_PRE_20260525_153101/` (1.4 GB)

---

## 1. WAS GEPATCHT WURDE (Code, noch nicht aktiv)

### `server.js:9017` (GridBotMBT.create)
```diff
-      const size = perLevel;
+      const size = perLevel / price;  // FIX: USDT/Level → Coin-Quantity
```

### `server.js:9391` (InfinityGridBotMBT.create)
```diff
-      levels.push({ level: i, side, price, size: perLevel });
+      const sizeCoins = perLevel / price;  // FIX
+      levels.push({ level: i, side, price, size: sizeCoins });
```

**Quellen-Konsens** (Quant-Niveau):
- Bybit Spot Grid Docs: Geometric Grid → Order-Size in QUOTE-Currency
- Hummingbot Grid Strike: `total_amount_quote` + `min_order_amount_quote`
- NautilusTrader: `quote_quantity=True` → Konversion via `last_price`

---

## 2. RECOMPUTE — Was die Bot-Zahlen WIRKLICH sind

### Pro Grid (vorher vs ehrlich):

| Grid | Symbol | Fills | Vorher | Ehrlich | Faktor überschätzt |
|---|---|---:|---:|---:|---:|
| OPEN | ETHUSDT | 790 | **$1742.91** | **$0.82** | **2120x** |
| OPEN | SOLUSDT | 788 | $117.84 | $1.37 | 86x |
| OPEN | ATOMUSDT (INF) | 28 | $0.88 | $0.65 | 2.1x |
| CLOSED | UNIUSDT | (alt) | $259.55 | $87.53 | 3.0x |
| CLOSED | ATOMUSDT | (alt) | $104.77 | $50.74 | 2.1x |
| CLOSED | DOGEUSDT | (alt) | $10.69 | $1.57 | 6.8x |

**DB wurde live updated:**
- `grid_instances.profit_acc` korrigiert für ALLE Grids (open + closed)
- `strategy_regime_performance.notes` = `'FALSE_MATH_PRE_PUNKT2_*'` für 7822 von 7824 Einträgen seit Day-Zero

---

## 3. EHRLICHE GESAMTBILANZ seit Day-Zero (21.05.)

| Kategorie | Vorher angegeben | Ehrlich | Δ Fantasie |
|---|---:|---:|---:|
| **Realized PnL (alle bot_types)** | $1783.34 | **$144.46** | -$1638.88 |
| ↳ Closed Grids | (in $1783 enthalten) | $139.84 | |
| ↳ Closed SINGLE | -$0.07 | -$0.07 | |
| ↳ DCA TP-Hits | (in $1783 enthalten) | $4.69 | |
| **Unrealized PnL (open Grids)** | $1503.40 | **$2.84** | -$1500.56 |
| **Total PnL since Day-Zero** | $3286.74 | **$147.30** | -$3139.44 |
| ROI auf $1000 Start | +328.7% (Fantasie) | **+14.7%** (real in 11 Tagen) | |

→ **14.7% in 11 Tagen** ist immer noch sehr gut (~480% APY annualisiert) — ABER datenbasiert ehrlich, nicht hochgejazzt.

---

## 4. WALLET + RESERVE — was korrigiert werden muss

### Aktueller Stand (auf Disk, FALSCH):
```
total:     $1200.30  ($1000 start + $276.20 Backfill - $75.82 NEAR-Debit - $0.07 alt)
reserve:   $193.34   (= 70% × $276.20 Stufe-C-Backfill vom 22.05.)
trading:   $1006.96  ($1200.30 - $193.34)
peakTotal: $3061.22  (höchster effectiveTotal mit FALSE_MATH)
```

### Ehrlich rekonstruiert:
```
total:     $1068.57  ($1000 + $144.46 - $75.82 - $0.07)
reserve:   $1.93     (oder $0 wenn man Stufe-C-Backfill als "war falsch" verwirft)
                     (oder $101 wenn man 70% × $144.46 backfillen würde)
trading:   $1066.64  (rest)
peakTotal: rebuild   (höchster echter effectiveTotal — vermutlich ~$1147)
```

**Differenz aktuell vs ehrlich: $1200.30 - $1068.57 = $131.73 Fantasie im Wallet**

---

## 5. ENTSCHEIDUNGS-OPTIONEN für Christian

### Option A1 — Wallet ehrlich neu setzen (radikal)
- Set `total = $1068.57`
- Set `reserve = $1.93` (proportional zum echten Realized)
- Set `peakTotal = max(eq) recompute` (~$1147)
- Audit-Log + neue Backfill-Markierung in `_hist_backfill_stufe_d_truth`
- **Vorteil:** ehrliche Zahlen ab jetzt
- **Nachteil:** $131 Fantasie-Differenz wird "real" verloren (war nie da)

### Option A2 — Wallet belassen, nur Profit-Tracking ab heute korrigieren
- `total` bleibt $1200.30 (= "akkumulierte Vergangenheits-Schuld")
- Reserve bleibt $193.34
- Aber Bot tradet AB JETZT mit korrekter Mathe → keine neue Fantasie
- Markierung im Wallet: `"_pre_punkt2_fantasy_inflation": 131.73`
- **Vorteil:** kein "echter" Verlust auf Disk
- **Nachteil:** Wallet bleibt Lügen-Wert; alle Future-Berechnungen relativ falsch

### Option A3 — Day-Zero Reset (komplett neu)
- `total = $1000`
- `reserve = $0`
- `peakTotal = $1000`
- Alle Bots stoppen, alle GRIDs schließen
- Kompletter Neustart mit korrekter Mathe
- **Vorteil:** sauberster Stand
- **Nachteil:** $0.65 + $0.82 + $1.37 echter Unrealized in offenen GRIDs verloren

### Meine Empfehlung — **Option A1** (Wallet ehrlich + 3 GRIDs schließen vor Restart)
1. GRIDs schließen ($0.65 + $0.82 + $1.37 = $2.84 echter Profit realisieren)
2. NEAR-SINGLE schließen (-$X aktueller Markt-Preis)
3. Wallet auf $1068.57 + $2.84 = **$1071.41** setzen
4. Reserve auf $0 setzen (Backfill-Logik war auf fiktivem Profit)
5. peakTotal auf $1071 setzen
6. Audit-Log "_punkt2_truth_reset"
7. Code-Patch ist live (size = perLevel/price)
8. Restart → Bot tradet ab jetzt MIT korrekter Mathe

---

## 6. WAS NICHT GEPATCHT WURDE (bewusst)

- **MULTI_BOTTYPE_AUTO_INVOKE:** bleibt true (Bot eröffnet weiter MBT-Bots)
- **CapitalPool.ALLOC:** bleibt unverändert (SINGLE 40, GRID 25, DCA 20, INFGRID 15)
- **Voter-Gewichte (T9.1):** bleiben unverändert
- **ML-Modelle:** bleiben Baseline 57.76%
- **NEAR-SINGLE-Trade:** läuft noch, sollte aber vor Wallet-Reset geschlossen werden

---

## 7. RISKEN BEI RESTART OHNE WALLET-FIX

Wenn Christian Option A2 wählt (Wallet belassen):
- Bot rechnet mit `wallet.total=$1200` und sized basierend darauf
- `MAX_TOTAL_EXPOSURE_PCT=0.60` greift falsch (60% von $1200 = $720, aber echtes Capital $1068)
- Reserve $193 ist fiktiv → bei echtem Wallet-Bedarf nicht verfügbar
- Kein Crash-Risk, aber Berechnungs-Schiefe bleibt

---

## 8. CHRISTIAN-FREIGABE NÖTIG

| Entscheidung | Bestätigung |
|---|:-:|
| Code-Patch behalten? | ☐ |
| DB-Recompute (grid_instances.profit_acc updated) behalten? | ☐ |
| FALSE_MATH-Markierung in strp behalten? | ☐ |
| Wallet-Fix: A1 / A2 / A3? | ☐ |
| Restart mit korrigierter Mathe? | ☐ |
| Trust-Audit-Doku als CLAUDE.md-Update verewigen? | ☐ |

**Bot ist gestoppt. Wartet auf Christian-Entscheid. LIVE bleibt zu 100% AUS.**
