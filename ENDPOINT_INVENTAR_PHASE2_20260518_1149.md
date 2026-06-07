# ENDPOINT_INVENTAR_PHASE2 — AUDFIX_E001_PHASE2 Report
**Datum**: 2026-05-18 11:46
**Patch**: AUDFIX_E001_PHASE2

## Endpoint-Statistik

- Total Endpoints (GET+POST+PUT+DELETE+PATCH): 471
- Read-Only (GET): 266 — bewusst offen für Dashboards/Monitoring
- Write-Endpoints (POST+PUT+DELETE+PATCH): 205

## Schutz-Quote Write-Endpoints

| Phase | Geschützt | Ungeschützt | Quote |
|---|---:|---:|---:|
| VOR AUDFIX_E001_PHASE2 | 47 | 158 | 23% |
| NACH AUDFIX_E001_PHASE2 | 205 | 0 | 100% |

## Schutz-Mechanismus

- **Middleware**: `requireDeployToken` (server.js Z.14772)
- **Token**: `crypto.timingSafeEqual` (timing-safe) — 32-byte hex aus `.env`
- **Header**: `x-deploy-token`
- **Fail-Response**: HTTP 403 `{"error":"forbidden"}`

## Brain-Schutzzone

6 Brain-relevante Endpoints (`/decision`, `/ml/*`, `/rl/*`, `/optimizer/*`) bekommen NUR Auth-Wrapper, **keinen Body-Touch**.

## Stichproben-Tests

| Endpoint | Ohne Token | Mit Token |
|---|---|---|
| POST /api/decision | 403 ✅ | (passes auth) |
| POST /api/auto/start | 403 ✅ | (passes auth) |
| POST /api/dca/create | 403 ✅ | (passes auth) |
| POST /api/ml/train | 403 ✅ | (passes auth) |
| POST /api/selfheal/run | 403 ✅ | (passes auth) |
| POST /api/profit (token) | – | 400 ✅ (kein 403) |
| GET /api/heartbeat | 200 ✅ | – |

## Bot-Status nach Patch
- PM2: R=111, online
- DEPLOY_MODE: PAPER (unverändert)
- Wallet: 999.024 USDT
- Drift: 0, consistent=true
