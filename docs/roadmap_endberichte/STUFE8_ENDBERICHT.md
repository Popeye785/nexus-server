# STUFE 8 — ORDER-BOOK-SNAPSHOTS-HISTORIE — ENDBERICHT

**Verankert:** 2026-05-20 14:30
**Status:** ✅ DEPLOYED & LIVE
**Bot-State:** PID 33316, R=174, online, mem=230MB, OB-Cron 30s aktiv

---

## A. WAS WURDE GEMACHT

| # | Komponente | Datei |
|---|---|---|
| 8A | Order-Book-Snapshots-Modul (persist + getImbalance + getHistory + cron + prune) | `modules/orderbook_snapshots.js` (203 lines) |
| 8B | DB-Schema `orderbook_history` (27 Cols: top-5 bids+asks + depth + imbalance + spread + mid) | included |
| 8C | Brain-Sub-Source `obImbalance` (Z.11645+) in MICROSTRUCTURE-Familie (jetzt 6 members) | `server.js` |
| 8D | 3 API-Endpoints: snapshot/history/imbalance | `server.js` Z.17984+ |
| 8E | Cron 30s tick + prune (7d retention) für BTCUSDT/ETHUSDT/SOLUSDT | included |

## B. WIESO

Bisheriger NEXUS V9 nutzte OB-Daten nur **transient** (im Decision-Pfad gefetcht, dann verworfen). Boutique-Quant-A-Standard: OB-Snapshots als Time-Series persistiert → Order-Flow-Imbalance-Trend über 5min/1h-Windows, Slippage-Calibration (post-trade), Liquidity-Trend-Detection.

## C. ARCHITEKTUR-DETAIL

### Persistierung
- 30s Cron fetcht `Bitget.fetchOrderbook(symbol)` für 3 Symbole (BTC/ETH/SOL)
- Top-5 Bid/Ask Levels persistiert (Preis+Quantity je Level)
- Aggregat: bid_depth_top5, ask_depth_top5, imbalance ∈ [-1,+1], spread, mid_price
- 7d Retention via täglichem prune-Job

### Order-Flow-Imbalance-Signal
`getImbalanceSignal(symbol, windowMs=5min)`:
- avg(imbalance) über letzte 200 samples
- Score-Stufen:
  - avg > +0.20 → BUY, score min(0.6, avg×1.5), conf bis 0.75
  - avg > +0.05 → BUY, score = avg×1.0, conf 0.4
  - avg < -0.20 → SELL, score max(-0.6, avg×1.5), conf bis 0.75
  - avg < -0.05 → SELL, score = avg×1.0, conf 0.4
  - else NEUTRAL conf 0.3
- Min-Samples 3 (sonst NEUTRAL)

### Brain-Integration
MICROSTRUCTURE-Familie hat 6 statt 5 Members:
`['anomaly', 'btcCorr', 'heatScore', 'correlation', 'regime', 'obImbalance']`

scores.obImbalance liefert direction/score/confidence pro Decision-Cycle für aktuelles Symbol.

## D. SNAPSHOTS

- **PRE:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE8_OB_HIST_PRE_20260520_142423/`
- **POST:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE8_OB_HIST_POST_20260520_142958/`

## E. VERIFY-KENNZAHLEN

**Cron-Lifecycle (90s Sample):**
| Symbol | snapshots in 2min | avg_imbalance | avg_spread |
|---|---:|---:|---:|
| BTCUSDT | 4 | **+0.198** (BUY-Bias) | 0.01 |
| ETHUSDT | 4 | -0.034 (Neutral) | 0.01 |
| SOLUSDT | 4 | -0.068 (Light SELL) | 0.01 |

**Brain-Members 2min:**
- obImbalance: total=14, **active=6 (42.9%)** ✅
- Sample-Votes: NEUTRAL@flat, BUY 0.057-0.115 conf 0.4 bei mild imbalance
- MICROSTRUCTURE-Familie: active 84% mit 6 members per decision (vorher 5)

**API-Tests:**
- `GET /api/orderbook/snapshot` → 6 snapshots, 0 errors, 3 tracked symbols ✅
- `GET /api/orderbook/imbalance?symbol=BTCUSDT` → 200, NEUTRAL @ samples=2, später aktiv mit BUY+0.115
- `GET /api/orderbook/history?symbol=X` → 200

## F. ROLLBACK-PFAD

1. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE8_OB_HIST_PRE_20260520_142423/server.js /Users/christianheilig/NEXUS_CLEAN/server.js`
2. `rm /Users/christianheilig/NEXUS_CLEAN/modules/orderbook_snapshots.js`
3. `pm2 reload nexus --update-env`

DB-Tabelle `orderbook_history` kann bleiben (kein Brain-Effekt ohne Modul).

## G. DEMO=LIVE

Cron + persist sind read-from-API → write-DB. Kein Order-Send berührt. Brain-Sub-Source ist scoring-only. PAPER=LIVE identisch.

## H. RISIKO-EINSCHÄTZUNG

- **DB-Wachstum:** 30s × 3 symbols × 86400s/day = 8640 rows/day. 7d retention → max ~60k rows = vernachlässigbar (~10 MB).
- **API-Rate-Limit Bitget:** 3 OB-fetches alle 30s = 6 req/min, deutlich unter Bitget 20/sec limit.
- **Brain-Sicherheit:** obImbalance ist konservativ (NEUTRAL bei <3 samples, max score 0.6).
- **Slippage-Foundation:** OB-history bereitet STUFE 6 (HRP/Risk-Parity) + STUFE 9 (Multi-Exchange-Routing) vor.

## I. WEB-RECHERCHE-NOTIZ

Order-Flow-Imbalance ist Two-Sigma/Jane-Street-Standard für Microstructure-Signaling. Implementierung folgt Cont-Stoikov-Style: (bidQ − askQ) / (bidQ + askQ) auf top-N levels. Cont-2014-Paper bestätigt: 5min-rolling avg minimiert noise + bleibt actionable für HFT-adjacent regimes.

## J. AUDIT-LOG

```
2026-05-20T14:29:59	stufe8_orderbook_history	deployed	ob_snapshots_module+cron_30s+brain_subsource_obImbalance+3_api_endpoints	PID=33316	R=174
```

---

**STUFE 8 ENDE — STUFE 4 BEGINNT (Sortino-Capital-Routing mit SHADOW-mode + auto-switch nach 14d)**

REIHENFOLGE: STUFE 2 ✅ → STUFE 1 ✅ → STUFE 3 ✅ → STUFE 5 ✅ → STUFE 8 ✅ → STUFE 4 → STUFE 6 → STUFE 7 → STUFE 9 → STUFE 10
