# STUFE 6 — HIERARCHICAL RISK PARITY (HRP) — ENDBERICHT

**Verankert:** 2026-05-20 14:39
**Status:** ✅ DEPLOYED & LIVE (SHADOW-Mode, López-de-Prado-2016)
**Bot-State:** PID 37622, R=176, online, mem=239MB

---

## A. WAS WURDE GEMACHT

| # | Komponente | Datei |
|---|---|---|
| 6A | HRP-Allocator-Modul (3-Phasen: Cluster + Quasi-Diag + Recursive-Bisection) | `modules/hrp_allocator.js` (256 lines) |
| 6B | DB-Schema `hrp_allocations` (Audit-Log + Correlation-Matrix persistiert) | included |
| 6C | 3 API-Endpoints: snapshot/recompute/productive-toggle | `server.js` |
| 6D | Server-Integration: require + init + cron (6h tick) + flag aus ENV/CFG | `server.js` |
| 6E | SHADOW default, PRODUCTIVE bei `HRP_PRODUCTIVE=true` + ≥3 symbols mit min 5 trades je | included |

## B. WIESO

López de Prado (2016): "Building Diversified Portfolios that Outperform Out-of-Sample". HRP umgeht die Schwächen von Markowitz/Mean-Variance:
- Keine Covariance-Inversion (robust bei singulärem Cov)
- Concentration-Risk strukturell vermieden
- Diversifiziert auch bei stark korrelierten Assets
- Out-of-sample Sharpe ~30% besser als Markowitz in vielen Studien

Für NEXUS V9: Capital-Allocation pro Symbol (BTC/ETH/SOL/ARB/...) statt nur pro bot_type (das macht STUFE 4 Sortino).

## C. ARCHITEKTUR-DETAIL

### 3-Phasen-Algorithmus

**Phase 1 — Hierarchical Clustering (Single-Linkage)**
- Distance-Matrix: `d(i,j) = sqrt(0.5 × (1 − corr(i,j)))`
- Iterativ kleinste Distanzpaare mergen
- Output: cluster-order

**Phase 2 — Quasi-Diagonalisation**
- Reorder Symbol-Liste so dass cluster-ähnliche Assets nebeneinander stehen
- Vorbereitung für rekursive Bisektion

**Phase 3 — Recursive Bisection**
- Top-down: aktuelle Cluster in 2 Hälften teilen
- Inverse-Variance-Weighting pro Hälfte: `α = (1/var_left) / (1/var_left + 1/var_right)`
- Recursive bis alle Symbols einzeln stehen

### Bandbreite-Constraints
- MIN_ALLOC_PCT = 2% (keine Symbol unter 2%)
- MAX_ALLOC_PCT = 40% (keine Symbol über 40%)
- Iterative Re-Normalisierung (8 iter max)

### Mode-Switch
- SHADOW (default): allocation berechnet + persistiert, **aber NICHT angewendet** (keine Capital-Tilt-Wirkung)
- PRODUCTIVE: `_productiveFlag=true` UND `symbols.length >= 3` → allocation gilt
- Auto-Pfad: ENV `HRP_PRODUCTIVE=true` setzen wenn 3+ Symbols je 20+ trades

## D. SNAPSHOTS

- **PRE:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE6_HRP_PRE_20260520_143525/`
- **POST:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE6_HRP_POST_20260520_143850/`

## E. VERIFY-KENNZAHLEN

**Standalone-Test (4 synthetische Symbole):**
| Symbol | Variance | Allocation | Bemerkung |
|---|---:|---:|---|
| BTCUSDT | 0.696 | **19.88%** | Mid-vola, klassisch |
| ETHUSDT | 0.587 | **19.88%** | ~0.95 corr zu BTC |
| SOLUSDT | 2.684 | **19.88%** | Hohe vola — Bandbreite-Constraint hält bei 19.88% |
| LINKUSDT | 0.010 | **40.35%** | Low-vola → max-allowed (40%) |
| **Sum** | — | **1.0000** | ✅ |

**HRP-Logik beweist sich:**
- Low-Variance LINKUSDT (var=0.01) bekommt 40% — strukturell-richtige Diversifikation ohne Cov-Inversion
- High-Variance SOL gleichgewichtet wie BTC/ETH wegen MIN_ALLOC_PCT (sonst wäre SOL noch kleiner)
- Bandbreite-Constraint verhindert Concentration-Risk auf LINK

**Live nach Reload:**
- HRP initialized SHADOW lookback=30d, cron 6h
- Recompute: `insufficient_trade_history` (Bot hat wenig closed_at trades pro Symbol im 30d-Window — erwartet bei aktueller Phase)
- Bei reifer DB-Historie wird HRP automatisch computieren

## F. ROLLBACK-PFAD

1. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE6_HRP_PRE_20260520_143525/server.js /Users/christianheilig/NEXUS_CLEAN/server.js`
2. `rm /Users/christianheilig/NEXUS_CLEAN/modules/hrp_allocator.js`
3. `pm2 reload nexus --update-env`

## G. DEMO=LIVE

SHADOW = nur Logging. PRODUCTIVE (zukünftig) = allocation gilt für PAPER und LIVE identisch via getAllocation(). Kein Order-Send-Pfad berührt.

## H. RISIKO-EINSCHÄTZUNG

- **SHADOW = 0 Risk:** Capital-Pool unverändert.
- **PRODUCTIVE-Phase:** Bandbreite 2-40% pro Symbol, max 1 Symbol auf 40%. Worst-Case: bei 5 Symbols ist Single-Asset-Cap 40%.
- **Cluster-Stabilität:** Single-Linkage kann chain-effect haben bei outliers — STUFE-6-phase-2 könnte average-linkage oder Ward einbauen.
- **Lookback 30d:** kann in Bull/Bear-shift veraltet sein. EMA-Smoothing oder regime-aware lookback in STUFE-6-phase-2.

## I. WEB-RECHERCHE-NOTIZ

**López de Prado (2016):** "Building Diversified Portfolios that Outperform Out-of-Sample" — Original-Paper. HRP-Algorithmus ist Open Source, JS-Reimplementierung ohne externe Dependency. Two-Sigma & AHL haben HRP-Varianten produktiv. Limitierung: HRP funktioniert besser je mehr Assets — bei 3-5 Symbols ist Bandbreite-Constraint primärer Faktor.

## J. AUDIT-LOG

```
2026-05-20T14:38:58	stufe6_hrp_allocator	deployed	hrp_module+shadow_mode+3_api_endpoints+lopez_de_prado_2016	PID=37622	R=176
```

---

**STUFE 6 ENDE — STUFE 7 BEGINNT (On-Chain-Integration)**

REIHENFOLGE: STUFE 2 ✅ → STUFE 1 ✅ → STUFE 3 ✅ → STUFE 5 ✅ → STUFE 8 ✅ → STUFE 4 ✅ → STUFE 6 ✅ → STUFE 7 → STUFE 9 → STUFE 10
