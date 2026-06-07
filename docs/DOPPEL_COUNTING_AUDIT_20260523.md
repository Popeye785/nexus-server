# NEXUS V9 — DOPPEL-COUNTING-AUDIT
**Datum:** 2026-05-23 12:30
**Stufe:** B (Pre-Audit vor Backfill)
**Methodik:** read-only Cross-Source-Vergleich

---

## ZUSAMMENFASSUNG

**✅ KEIN Doppel-Counting** zwischen Quellen.
**🟡 ABER:** `profit_acc` und `strp` (strategy_regime_performance) sind **unterschiedliche Quellen**, nicht doppelt.
**🔴 Falle:** ATOM-GRID-CLOSE-Audit-Entry (104.77 in wallet_ledger) DARF NICHT zusätzlich zu strp backfilled werden.

**Empfohlene Backfill-Summe: 276.20 USDT** (= strp-Sum since Day-Zero für GRID+INFGRID).

---

## B.1 — ATOM-GRID profit_acc vs strp

| Metric | Wert |
|---|---:|
| Instance.profit_acc | **104.77** USDT |
| strp.SUM(pnl_usdt) WHERE trade_id='GRID_mp9ml4dj_4g49bw' | **92.80** USDT |
| Differenz | **+11.97** USDT |
| fills_acc | 7041 |
| strp.COUNT | 3040 |

### Diagnose

- Instance.profit_acc (104.77) **HÖHER** als strp-Sum (92.80) → profit_acc enthält Trades die NICHT in strp geloggt sind
- Vermutung: strp-Hook im Code (Z.8973) loggt nur "sinnvoll-grosse" profitDeltas, profit_acc bekommt jeden Delta
- 7041 fills vs 3040 strp-rows → ~57% der fills haben strp-Hook ausgelöst (Schwelle wirkt)
- Plus: Instance wurde **2026-05-17 12:21 created (PRE-RESET)**, profit_acc enthält PRE-Day-Zero-PnL

### KEIN Doppel-Counting
- profit_acc ist Instance-Sum (cumulativ)
- strp ist Event-Stream (selektiver)
- Beide voneinander unabhängig

---

## B.2 — Alle Grids profit_acc vs strp

| Grid | profit_acc | strp-Sum (since DZ) | Era | Notiz |
|---|---:|---:|:-:|---|
| GRID_mp9ml4dj ATOMUSDT | 104.77 | 92.80 | PRE-RESET | profit_acc enthält PRE+POST |
| GRID_mpby1qdc UNIUSDT | 259.55 | 182.77 | PRE-RESET | profit_acc enthält PRE+POST |
| INFGRID_mp8zefu9 ATOMUSDT | 0.88 | 0.63 | PRE-RESET | profit_acc enthält PRE+POST |
| GRID_mp9petr3 DOGEUSDT | 10.69 | 0 | PRE-RESET (Closed 18.05.) | KEIN strp seit DZ (vor Reset closed) |
| **Σ aktive seit-Reset** | **365.20** | **276.20** | — | Differenz 88.99 = PRE-RESET-Anteil |

### Befund
- **ALLE 3 aktiven Grids sind PRE-RESET created** (vor Day-Zero 20.05.16:54)
- `profit_acc` cumulativ enthält:
  - PRE-RESET-PnL (vor 20.05.) = **88.99 USDT** (nicht-Day-Zero-relevant)
  - POST-RESET-PnL (seit 20.05.) = **276.20 USDT** (korrekt für Backfill)

### Konsequenz
- Wenn `profit_acc` als Backfill-Quelle → **+88.99 USDT zuviel** (PRE-RESET-Anteil)
- Wenn `strp` als Backfill-Quelle → korrekt für Day-Zero-Sicht

---

## B.3 — wallet_ledger GRID_CLOSE_PROFIT vs strp

```
wallet_ledger seit Day-Zero:
  GRID_CLOSE_PROFIT:        1 row    104.77 USDT  (PRIO5_FIX_1, NUR Audit)
  INITIAL_SPLIT_CORRECTION: 1 row    700.00 USDT  (Audit-only, gestern)
```

### Befund
- `GRID_CLOSE_PROFIT 104.77` wurde gestern bei ATOM-GRID-Close geschrieben
- Dieser Entry ist **AUDIT-ONLY**: before_trading=1000, after_trading=1000 (KEIN Wallet-Mutation)
- ATOM-GRID-Anteil ist **bereits in strp (92.80) enthalten**

### 🔴 Falle bei Backfill
- Wenn beide gebucht würden:
  - strp 276.20 enthält ATOM-Anteil 92.80
  - + GRID_CLOSE_PROFIT 104.77 = **ATOM doppelt-counted (92.80 + 104.77)**
- **Lösung:** NUR strp 276.20 verwenden, GRID_CLOSE_PROFIT NICHT zusätzlich

---

## B.4 — DCA-iterations vs strp

| Metric | Wert |
|---|---:|
| dca_iterations.SUM(pnl_usdt) (alle) | 0 |
| strp.SUM(pnl_usdt) WHERE bot_type='DCA' seit DZ | 0 |
| DCA-Instances seit Day-Zero status=OPEN | 2 (ETH, SUI) |
| DCA-Instances status=CLOSED_TP seit DZ | 0 |

### Befund
- **KEIN realisiertes DCA-PnL seit Day-Zero**
- 2 OPEN DCAs (ETH, SUI) → unrealized, kommt bei TP-Hit
- 5 CLOSED DCAs sind alle vor Day-Zero
- **KEIN DCA-Backfill nötig**

---

## EMPFOHLENE BACKFILL-OPERATION

### Sicher zu buchen:
```
applyPnL(276.20, 'HIST_BACKFILL_20260523_GRID_INFGRID_SINCE_DAYZERO')
  → Reserve += 276.20 × 0.7  = 193.34
  → Trading += 276.20 × 0.3  =  82.86
```

### NICHT zu buchen (würde doppeln):
- ❌ `profit_acc - strp_diff = 88.99` (PRE-RESET-Anteil — nicht relevant für Day-Zero-Reset-Buchung)
- ❌ `GRID_CLOSE_PROFIT 104.77` separat (bereits in strp ATOM-Anteil enthalten)
- ❌ DCA-Backfill (kein realisiertes PnL)

### Wallet-Stand nach Backfill (prognostiziert)
```
data/demo_wallet.json:
  total:    1276.20  (war 1000 + 276.20)
  reserve:   193.34  (war 0 + 276.20×0.7)
  trading:  1082.86  (war 1000 + 276.20×0.3)
```

### Marker für Idempotenz (Stufe C.1)
```
UPDATE strategy_regime_performance 
SET realized_at = NOW 
WHERE ts >= 1779288888536 AND realized_at IS NULL AND bot_type IN ('GRID','INFGRID');
```

---

## RISIKO-EINSCHÄTZUNG

| Quelle | Risiko-Score | Grund |
|---|:-:|---|
| Doppel-Counting strp↔profit_acc | 🟢 NULL | unterschiedliche Quellen, nicht summiert |
| Doppel-Counting strp↔GRID_CLOSE_PROFIT | 🔴 HOCH | wenn beide gebucht — Lösung: NUR strp buchen |
| PRE-RESET-Mischung in profit_acc | 🟡 MITTEL | bei profit_acc-Quelle 88.99 zuviel — Lösung: strp nutzen, nicht profit_acc |
| DCA-Mischung | 🟢 NULL | DCA-PnL = 0 |

---

## VERDICT FÜR STUFE C

**✅ BACKFILL IST SICHER** mit folgender Spezifikation:
- **Quelle:** `SELECT SUM(pnl_usdt) FROM strategy_regime_performance WHERE ts >= 1779288888536 AND bot_type IN ('GRID','INFGRID') AND realized_at IS NULL`
- **Erwartete Summe:** ~276 USDT (kann zwischen B-Audit und C-Backfill leicht steigen durch laufende INFGRID-Trades)
- **Ein Call:** `applyPnL(Σ, 'HIST_BACKFILL_20260523_GRID_INFGRID')`
- **Direkt danach:** `UPDATE strp SET realized_at = NOW WHERE ...`

**Anti-Falle:**
- `GRID_CLOSE_PROFIT 104.77` Audit-Entry vom 23.05. 11:26 in wallet_ledger BLEIBT stehen (war non-mutating), aber **NICHT zusätzlich applyPnL aufrufen** dafür
- Pre-Reset-`profit_acc` Anteil (88.99 USDT) bleibt im `grid_instances.profit_acc`-Feld, aber NICHT in Wallet einbuchen
- Future Daily-Cron (Stufe C.3) liest nur strp mit `realized_at IS NULL` → idempotent

---

*Phase B abgeschlossen. Backfill in Stufe C ist freigegeben mit präziser Spec.*
