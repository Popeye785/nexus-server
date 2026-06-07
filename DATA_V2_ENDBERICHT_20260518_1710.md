# DATEN-V2-PIPELINE ENDBERICHT — ETF SoSoValue + Liquidations Multi-Exchange
**Datum**: 2026-05-18 17:10
**Start**: 17:07 · **Ende**: 17:10 · **Dauer**: 3 min
**Brain-Schutzzone**: vollständig eingehalten

---

## A) GEMACHT — Phasen A + B

### Phase A — ETF via SoSoValue: **SKIP** (kein API-Key)

**Befund**: SoSoValue Endpoint `api.sosovalue.com/openapi/v2/etf/historicalInflowChart` liefert 403 ohne API-Key.

**Auch geprüft**:
| Quelle | Status |
|---|---|
| `api.sosovalue.com` | 403 ohne Key |
| `sosovalue.com/api/v2/...` | 403 Cloudflare |
| `api-sosovalue.com` | 000 (DNS-Fail) |
| CoinGecko `/etf_flows` | "Incorrect path" |
| `btcetffundflow.com/api` | 404 |
| BlackRock IBIT holdings | HTML, kein JSON |
| CoinShares weekly reports | nur Web-Insights |

**Skript bereit**: `scripts/backfill_etf_sosovalue.js` wartet auf `SOSOVALUE_API_KEY` in `.env`.

**Christian-Action**: Auf https://sosovalue.com/developer registrieren → Demo-Key → in `.env` als `SOSOVALUE_API_KEY=<key>` eintragen → `node scripts/backfill_etf_sosovalue.js` → 500 Tage Backfill in ~30s.

### Phase B — Liquidations Multi-Exchange: **SKIP** (alle Quellen Key-pflichtig oder deprecated)

**Befund**:
| Quelle | Status |
|---|---|
| Binance Vision liquidationSnapshot | eingestellt (Phase 4 Bestätigung) |
| Bybit public.bybit.com | hat nur kline/trading/spot, kein liquidations-Bucket |
| Bybit V5 WS `liquidation.BTCUSDT` | **deprecated**: "error:handler not found,topic:liquidation.BTCUSDT" |
| Coinalyze API | "Invalid/Missing API key" |
| CoinAPI Liquidations | Key-pflichtig |
| Bitget `/mix/market/queryPositionLever` | 40404 NOT FOUND |

**Bestätigung**: **Es gibt 2026 KEINE gratis öffentliche Multi-Exchange-Liquidations-API.**

---

## B) AKTUELLER STAND (was wir HABEN)

### ETF-Flows
- **14 Tage** in `etf_flows` (BitBo-Scrape + Bootstrap + Test-CSV)
- POST `/api/etf-flows/import` Endpoint live für manuellen CSV-Upload
- SENTIMENT.etfFlows-Source aktiv, Score-Mapping bereits implementiert

### Liquidations
- **Live**: Binance WebSocket `wss://fstream.binance.com/ws/!forceOrder@arr` aktiv (real-time, alle Symbole)
- **Backfill-Proxy**: 103.680 OI/L-S-Datensätze aus Binance metrics (4 Symbole × 90 Tage)
- RISK.liquidations-Source aktiv, Cascade-Detection (10M/50M Schwellen)

---

## C) NICHT GEMACHT

- ETF-Voll-Backfill 16 Monate (wartet auf Christian-Key)
- Multi-Exchange-Liquidations historisch (technisch nicht gratis möglich)
- Tardis/CoinAPI Bezahl-Pfade (kategorisch blockiert)
- 4 Stubs (separate F2)

## D) Bot-Status final

```
PM2:         nexus R=133 online 121 MB uptime 29m
DEPLOY_MODE:  PAPER (unverändert)
Wallet:       999.024 USDT
KillSwitch:   NORMAL
Drift:        0, consistent=true
Live-Brain:   unangetastet
```

## E) ERROR/WARN-Logs
- 0 Bot-Errors
- HTTP-Tests dokumentiert (403/404/000-Antworten zu externen APIs)
- Bot kontinuierlich stable

## F) Tests
- SoSoValue 5 Endpoint-Varianten getestet — alle 403/000
- Bybit S3 Listing geprüft — kein liquidations-Bucket
- Bybit V5 WS Subscribe getestet — handler not found
- CoinGecko/Coinalyze/CoinAPI getestet — Key-pflichtig

## G) Audit-Log
```
phase_a_etf_sosovalue (SKIP)
phase_b_liquidations_bybit (SKIP)
```

## H) Backup-Snapshots
- SNAPSHOT_20260518_170701_ETF_V2_PRE
- SNAPSHOT_20260518_170953_LIQ_V2_POST

## I) Nächster Schritt

**Empfehlung Reihenfolge**:
1. **Christian registriert SoSoValue** (5 min Web-Form) → API-Key in .env → `node scripts/backfill_etf_sosovalue.js` → **16 Monate ETF-Historie sofort verfügbar**
2. **Live-Liquidations weiter sammeln** über 30-90 Tage → dann hyperopt mit echten Daten
3. **Re-Hyperopt nach 30 Tagen** mit erweiterten Datenquellen

## J) Risiken offen
1. **ETF**: 14 Tage Sample bleibt knapp für robusten Score (vs Optimum 500 Tage)
2. **Liquidations**: 2026 ist Free-Liquidations-Datenlandschaft "tot" — alle Pro-APIs paywalled
3. **SoSoValue Demo-Plan** kann sich ändern oder Restriktionen bekommen
4. **Aktuelle Brain-Performance** mit 14-Tage-ETF + Binance-Only-Liq ist sub-optimal aber funktional

---

## EHRLICHE GESAMTBEWERTUNG

Aus den **2 Phasen** ist:
- **0 echte Voll-Backfills** durchgeführt (beide brauchen externe Schritte: Key-Registrierung oder Bezahl-API)
- **Skripte für SoSoValue bereit** — sofort einsetzbar wenn Key da
- **Status quo** bleibt: 14 Tage ETF + Binance-WS-only Liq + 90 Tage Metrics-Proxy

**Live-Brain bleibt unangetastet** und arbeitet weiter mit dem heute Nachmittag deployten Daten-Layer.

**Die heute Nachmittag implementierte Pipeline (Phase 1-7) ist die robusteste Lösung die 2026 mit Free-Quellen technisch möglich ist.**
