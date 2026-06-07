# ENDPOINT AUDIT — TAG 26

**Date:** 2026-05-25
**Bot status:** PID active, PAPER mode, http://localhost:3000 reachable
**Method:** Static-extraction (`grep -nE "app\.(get|post|delete|patch|put)\\(['\\\"]/api/"` against `server.js` line-by-line) → unique `(method, path)` pairs → live HTTP call via Python `urllib` with 5s primary timeout + 15s retest for any 5xx/timeout.
**Path params** (`:symbol`, `:id`, `:name`, `:runId`, `:tradeId`) substituted with `BTCUSDT` / `1` / `test`. **No deploy-token** sent — `requireDeployToken`-gated endpoints are expected to return 403.

---

## Summary

| Metric | Count |
|---|---:|
| Raw `app.<method>('/api/...)` matches in server.js | 557 |
| Unique `(method, path)` endpoints tested | **551** |
| With path-parameters | 95 |
| GET / POST / DELETE / PUT / PATCH | 322 / 216 / 11 / 1 / 1 |

## Status-code breakdown (after retest of transient failures)

| Bucket | Count | % | Notes |
|---|---:|---:|---|
| **2xx (success)** | **470** | 85.3% | Endpoint live, returns JSON |
| **4xx (validation / auth)** | **72** | 13.1% | Healthy: missing param, `requireDeployToken` → 403, unknown `:id` → 404 |
| ↳ 400 (validation) | 44 | – | `symbol required`, `tradeId required`, `confirm_required` … |
| ↳ 403 (forbidden / deploy-token) | 13 | – | All gated admin endpoints (martingale/oco/wallets/db/paper/futures…) |
| ↳ 404 (not-found by `:id`) | 15 | – | gridmbt/dcambt with `id=1` (placeholder doesn't exist) |
| **410 (deprecated by FIX 45/47)** | **7** | 1.3% | Listed below |
| **5xx (broken, non-deprecated)** | **2** | 0.4% | Listed below |
| Timeout / Other | 0 | – | All initial timeouts resolved on 15s retest (cold-start indicator chain) |

Total: **551 / 551 = 100% reachable**.

---

## 🔴 Broken endpoints (5xx not 410)

Two endpoints return HTTP 500 instead of a 4xx for an unknown resource — anti-pattern but isolated to the multi-exchange façade.

| Line | Method | Path | Status | Body |
|---:|---|---|---:|---|
| 29031 | GET | `/api/exchanges/:name/price/:symbol` | 500 | `{"ok":false,"error":"Exchange not supported: test"}` |
| 29036 | GET | `/api/exchanges/:name/orderbook/:symbol` | 500 | `{"ok":false,"error":"Exchange not supported: test"}` |

**Severity:** LOW. Returns a structured JSON body, no stack-trace leak, no crash. **Fix-Recommendation:** map "Exchange not supported" to HTTP 400 (bad-input) or 404 (unknown resource). Two-line change in the route handler.

**Context:** The Multi-Exchange-Routing layer (Phase 2/3, code-ready dormant per CLAUDE.md) currently only has Bitget online; any other `:name` value triggers this path.

---

## ⚪ Deprecated endpoints (410 Gone)

These were intentionally retired by FIX 45/47 and return HTTP 410 with `{"deprecated":true, ...}`. No action needed.

| Line | Method | Path |
|---:|---|---|
| 16755 | POST | `/api/scripts` |
| 16757 | POST | `/api/scripts/:id/start` |
| 16758 | POST | `/api/scripts/:id/stop` |
| 16759 | POST | `/api/scripts/:id/test` |
| 16760 | GET | `/api/scripts/:id/result` |
| 19922 | POST | `/api/multiki/vote` |
| 19923 | GET | `/api/multiki/snapshot` |

---

## Transient-failure observations (first-pass → retest)

The first 5s-timeout pass produced 8 timeouts and 8 "500" entries. **All recovered on retest** with longer timeout / fresh call:

- 8 timeouts were cold-start indicator chains (e.g. `/api/pretrain`, `/api/indicators/bundle/:symbol`, `/api/futures/leverage`) — completed in ≤15s on retry.
- 6 "500" entries were actually `403 forbidden` from `requireDeployToken` — Express returned the cached HTML error page once during a flush, but the route is healthy. Production behavior verified via direct `curl`.

These should not appear in the steady-state but are documented for completeness. **Tag-26 final state: 0 timeouts, 0 transient 5xx.**

---

## 🟢 Verdict: GREEN

- 551/551 endpoints reachable, no crashes, no stack-leaks.
- 2 cosmetic 5xx (Multi-Exchange not-supported response code) — non-critical.
- 7 endpoints intentionally retired as 410 — documented.
- Auth-gates (`requireDeployToken`) verified at 13 endpoints.

**No blockers for LIVE-switch from an API-surface perspective.**

---

*Generated 2026-05-25 by automated audit (Python urllib live-test, n=551, 2-pass with retest).*
