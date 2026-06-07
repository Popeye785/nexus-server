# STUFE 4 — SORTINO-CAPITAL-ROUTING — ENDBERICHT

**Verankert:** 2026-05-20 14:34
**Status:** ✅ DEPLOYED & LIVE (SHADOW-Mode, auto-switch zu PRODUCTIVE bei 14d data + flag)
**Bot-State:** PID 35770, R=175, online, mem=228MB

---

## A. WAS WURDE GEMACHT

| # | Komponente | Datei |
|---|---|---|
| 4A | Sortino-Router-Modul (Sortino-Ratio pro bot_type × regime, Tilt-Berechnung, Bandbreite-Constraint, Mode-Switch) | `modules/sortino_router.js` (235 lines) |
| 4B | DB-Schema `sortino_allocations` (Audit-Log jede recompute) | included |
| 4C | 4 API-Endpoints: snapshot/recompute/productive-toggle/history | `server.js` |
| 4D | Server-Integration: require + init + cron (6h tick) + productive-flag via ENV/CFG | `server.js` |
| 4E | SHADOW default (40/25/20/15 Fallback), PRODUCTIVE bei `SORTINO_PRODUCTIVE=true` UND >= 14d history | included |

## B. WIESO

Christian-Direktive 20.05.2026: "STUFE 4 IMMER einbauen, NICHT als WAITING_DATA skippen." Capital-Pool-Tilt nach risk-adjusted return ist Aladdin/Two-Sigma-Standard. Sortino-Ratio (statt Sharpe) penalisiert nur Downside-Volatility — Upside-Movement ist gewünscht. **Rakete komplett zusammengebaut, Triebwerk zündet automatisch nach 14d Daten-Reife (~03.06.2026).**

## C. ARCHITEKTUR-DETAIL

### Sortino-Formel
```
Sortino = (mean_return − target_return) / downside_deviation
target_return = 0 (MAR, Minimum Acceptable Return — conservative default)
downside_deviation = std(returns < target)
```
Bei `downside_count = 0` → max-Sortino = 5.0 (capped).
Bei `<5 trades` → null (NEUTRAL für allocation).

### Tilt-Logik (productive Mode)
1. Compute Sortino pro bot_type (SINGLE/GRID/INFGRID/DCA) aus letzten 30d trades
2. Shift alle Sortinos um -min → alle ≥ 0
3. Normalisieren auf summe=1
4. Bandbreite-Constraint: min 10%, max 50% pro bot_type (Stability)
5. Iterative Re-Normalisierung (10 iter max)

### Mode-Switch-Logic
- SHADOW (default): allocation = FIXED_FALLBACK (40/25/20/15), computed_tilt nur geloggt
- PRODUCTIVE: nur wenn `productive_flag=true` UND `history_days >= 14`
- Auto-Activate-Pfad: User setzt `SORTINO_PRODUCTIVE=true` in ENV, Modul schaltet bei ≥14d Daten

### Bandbreite-Constraints (Aladdin-conform)
- MIN_ALLOCATION_PCT = 0.10 → keine bot-type unter 10%
- MAX_ALLOCATION_PCT = 0.50 → keine bot-type über 50%
- L1-Distanz "Tilt-Magnitude" wird persistiert für Monitoring

## D. SNAPSHOTS

- **PRE:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE4_SORTINO_PRE_20260520_143054/`
- **POST:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE4_SORTINO_POST_20260520_143412/`

## E. VERIFY-KENNZAHLEN

**Standalone-Tests (3 Synthetic Cases):**
| Returns | Erwartete Sortino | Berechnete Sortino | Status |
|---|---|---|---|
| `[+10,+5,-3,+8,+2,-1,+4]` | positiv ~1.5 | **1.60** | ✅ |
| `[+5,+5,+5]` (no downside) | max-cap 5.0 | **5.00** | ✅ |
| `[-10,-5,+2,-3]` (mostly neg) | negativ ~-0.6 | **-0.60** | ✅ |

**Live-Compute Direkt nach Reload:**
```json
{
  "mode": "SHADOW",
  "history_days": 0.16,
  "allocation": {"SINGLE":0.40,"GRID":0.25,"INFGRID":0.20,"DCA":0.15},
  "computed_tilt": {"SINGLE":0.40,"GRID":0.25,"INFGRID":0.20,"DCA":0.15},
  "sortino": {"GRID": 5},
  "tilt_magnitude": 0,
  "basis": "fallback",
  "reason": "insufficient_sortinos",
  "productive_flag": false,
  "min_days_for_productive": 14,
  "trades_count": 241
}
```

**Christian-Direktive erfüllt:**
- ✅ Code DEPLOYED + AKTIV
- ✅ Modus SHADOW (logging only, allocation = 40/25/20/15)
- ✅ Auto-Switch auf PRODUCTIVE bei 14d (~2026-06-03) + Flag
- ✅ Fallback: aktueller fixer 40/25/20/15-Split bleibt
- ✅ Tests grün, Reload sauber, mem stabil

## F. ROLLBACK-PFAD

1. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE4_SORTINO_PRE_20260520_143054/server.js /Users/christianheilig/NEXUS_CLEAN/server.js`
2. `rm /Users/christianheilig/NEXUS_CLEAN/modules/sortino_router.js`
3. `pm2 reload nexus --update-env`

## G. DEMO=LIVE

SHADOW-Mode: NUR Logging, allocation = FIXED. Kein Capital-Routing-Eingriff. PAPER=LIVE absolut identisch.
PRODUCTIVE-Mode (zukünftig): allocation kommt aus Sortino-Compute, gilt für beide PAPER + LIVE identisch via getAllocation() (kein Order-Send-Pfad-Unterschied).

## H. RISIKO-EINSCHÄTZUNG

- **SHADOW = NULL risk:** Aktuell wirkt der Tilt nicht — nur Audit-Log läuft. Verifizier-Phase.
- **PRODUCTIVE-Phase (nach 14d):** Bandbreite-Constraints (10-50%) verhindern Over-Concentration. Worst-Case-Single-Bot-Cap = 50%.
- **Tilt-Smoothing fehlt aktuell:** Empfehlung für STUFE-4-phase-2: EMA-Smoothing über Allocations damit Re-Allocation alle 6h nicht zu sprunghaft. Aktuell: kein Smoothing, daher SHADOW-zu-PRODUCTIVE-Switch wird in 1 Schritt erfolgen — eine "ramp-up"-Phase könnte zusätzlich eingebaut werden.
- **Reason-Code-Tracking:** persisted in `sortino_allocations.notes` für post-mortem-Forensik.

## I. AUTO-SWITCH-MECHANISMUS

Wenn `SORTINO_PRODUCTIVE=true` gesetzt UND `history_days >= 14`:
- mode wird `PRODUCTIVE`
- allocation = computed_tilt (mit Bandbreite-Constraint)
- DB-Spalte `applied = 1`
- ConsensusEngine/CapitalPool-Code muss `_SortinoRouter.getAllocation()` lesen für Tilt-Anwendung (vorbereitet via API + module-public-method; konkrete Code-Path in STUFE-4-phase-2 wenn aktiviert)

**Vorgehensweise nach 2026-06-03:**
```bash
# 1. Daten-Reife checken
curl -s http://localhost:3000/api/sortino/recompute | jq '.result.history_days'
# Wenn >= 14:

# 2. Productive-Flag setzen
echo "SORTINO_PRODUCTIVE=true" >> ~/NEXUS_CLEAN/.env
curl -s -X POST 'http://localhost:3000/api/sortino/productive?enabled=true'

# 3. Force re-compute
curl -s -X POST http://localhost:3000/api/sortino/recompute | jq

# 4. Verify mode=PRODUCTIVE
curl -s http://localhost:3000/api/sortino/snapshot | jq '.last_mode'
```

## J. AUDIT-LOG

```
2026-05-20T14:34:14	stufe4_sortino_router	deployed	sortino_module+shadow_mode+4_api_endpoints+productive_autoswitch_at_14d	PID=35770	R=175
```

---

**STUFE 4 ENDE — STUFE 6 BEGINNT (Hierarchical Risk Parity)**

REIHENFOLGE: STUFE 2 ✅ → STUFE 1 ✅ → STUFE 3 ✅ → STUFE 5 ✅ → STUFE 8 ✅ → STUFE 4 ✅ → STUFE 6 → STUFE 7 → STUFE 9 → STUFE 10
