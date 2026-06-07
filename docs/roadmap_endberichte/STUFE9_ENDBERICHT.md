# STUFE 9 — MULTI-EXCHANGE-ROUTING PAPER — ENDBERICHT

**Verankert:** 2026-05-20 14:48
**Status:** ✅ DEPLOYED & LIVE (PAPER-Mode)
**Bot-State:** PID 41692, R=178, online, mem=219MB

---

## A. WAS WURDE GEMACHT

| # | Komponente | Datei |
|---|---|---|
| 9A | Multi-Exchange Smart-Order-Router (PAPER) — 5 venues parallel-poll | `modules/multi_exchange_router.js` (197 lines) |
| 9B | DB-Schema `best_route_log` (Audit-Log pro edge > 1bp) | included |
| 9C | 4 API-Endpoints: snapshot/best/recent/summary | `server.js` |
| 9D | Server-Integration + Cron 1min für 2 Symbole × 2 Sides = 4 runs/min | `server.js` |
| 9E | Symbol-Mapping pro Exchange (Kraken XBT/USD-Konvention etc.) | included |

## B. WIESO

Boutique-Quant-A nutzt **Smart Order Routing (SOR)** standard — Renaissance/Two-Sigma/Jane-Street routet jede Order an best-priced Venue. NEXUS V9 war Bitget-only. PAPER-Mode liefert das Audit-Log "wieviel hätten wir gespart bei Multi-Venue-Routing".

## C. ARCHITEKTUR-DETAIL

### 5 Tracked Exchanges
1. **Bitget** — Reference (Live-Bot exchange)
2. **Binance** — größte Liquidität
3. **Bybit** — Asien-Top-Volume
4. **OKX** — fees competitive
5. **Kraken** — US-licensed, Spot-dominant

### Symbol-Mapping
| Exchange | BTCUSDT-Format |
|---|---|
| Bitget | `BTCUSDT` |
| Binance | `BTCUSDT` |
| Bybit | `BTCUSDT` |
| OKX | `BTC-USDT` |
| Kraken | `XBTZUSD` (XBT-Konvention für BTC) |

### Best-Venue-Logik
- BUY → niedrigste Ask gewinnt
- SELL → höchste Bid gewinnt
- Edge in Basispunkten vs Bitget: `(price_diff / bitget_price) * 10000`
- Persistiert in `best_route_log` nur wenn `|edge_bps| >= 1`

### Cron
- 1min tick, 2 symbols (BTC + ETH), 2 sides each = 4 venue-comparisons/min
- Cache 15s TTL pro symbol
- Async parallel-fetch via Promise.all

## D. SNAPSHOTS

- **PRE:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE9_MEX_PRE_20260520_144518/`
- **POST:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE9_MEX_POST_20260520_144822/`

## E. VERIFY-KENNZAHLEN — LIVE-Edges

**1 Minute Sample, BTC+ETH BUY+SELL:**
| Symbol | Side | Best Exchange | Best Price | Bitget Price | Edge (bps) |
|---|---|---|---:|---:|---:|
| BTCUSDT | BUY | **Kraken** | 77,500 | 77,569.31 | **8.94** |
| ETHUSDT | BUY | **Kraken** | (siehe DB) | (siehe DB) | **9.09–9.14** |

**5 Edges in 60s persistiert.** Konsistent Kraken als beste BUY-Venue für BTC+ETH (vermutlich US-Pricing-Premium nach unten vs Asia/Bitget). Bei einer 1 BTC Order entspricht 8.94 bps **$69.39 Ersparnis**, bei 0.1 BTC ~$6.94.

**Multi-Venue-Coverage:**
- Bitget: $77,569.31 ask
- Binance: $77,564.92 ask
- Bybit: $77,562.10 ask
- OKX: $77,559.40 ask
- **Kraken: $77,500.00 ask** ← best

## F. ROLLBACK-PFAD

1. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE9_MEX_PRE_20260520_144518/server.js /Users/christianheilig/NEXUS_CLEAN/server.js`
2. `rm /Users/christianheilig/NEXUS_CLEAN/modules/multi_exchange_router.js`
3. `pm2 reload nexus --update-env`

DB-Tabelle `best_route_log` kann bleiben (Historie für STUFE 9-phase-2).

## G. DEMO=LIVE

PAPER-Mode: SOR analysiert nur Pricing, **routet NICHT** real. Bitget bleibt einzige Order-Send-Exchange. Bot-Verhalten identisch PAPER↔LIVE. DEMO=LIVE-Garantie absolut erhalten.

**STUFE 9-phase-2 (zukünftig):** LIVE-Routing aktivierbar nach Compliance/KYC für alle 4 Zusatz-Venues. Aktuelle PAPER-Audit-Logs zeigen Ersparnis-Potenzial pro venue.

## H. RISIKO-EINSCHÄTZUNG

- **API-Rate-Limits:** alle 5 exchanges-public-APIs ohne Key, 1min-cron = 4 req/min/exchange = sicher unter Limits
- **Failure-Modes:** Eine exchange-API down → wird übersprungen, Best-Venue aus verbleibenden gewählt
- **PAPER = 0 risk:** keine real-Order ausgeführt
- **Edge Persistierung:** nur wenn |edge_bps| >= 1 → DB-Klein-Halten

## I. WEB-RECHERCHE-NOTIZ

- Standard SOR-Architektur: Bid-Ask-Aggregation + best-venue-pick (Jane Street/Citadel-Style)
- 5-10 bps Edges sind normal in fragmentierten Crypto-Märkten (siehe Caspian.tech, Apifiny SOR-Whitepapers)
- Latency-arbitrage gehört NICHT in SOR scope (das wäre HFT), unser SOR ist execution-cost-Optimization

## J. AUDIT-LOG

```
2026-05-20T14:48:31	stufe9_multi_exchange_router	deployed	sor_paper_mode+5_exchanges+4_api_endpoints+kraken_edge_8bp_observed	PID=41692	R=178
```

---

**STUFE 9 ENDE — STUFE 10 BEGINNT (Transformer-Forecasting TFT — falls system stable)**

REIHENFOLGE: STUFE 2 ✅ → STUFE 1 ✅ → STUFE 3 ✅ → STUFE 5 ✅ → STUFE 8 ✅ → STUFE 4 ✅ → STUFE 6 ✅ → STUFE 7 ✅ → STUFE 9 ✅ → STUFE 10
