# NEXUS V9 — KAPITAL-AUDIT Phase 3
**Datum:** 2026-05-23 11:40
**Methodik:** read-only Code+DB-Analyse + Lösungs-Optionen

---

## A) IST-ZUSTAND

### Live (gemessen 11:40)

```
data/demo_wallet.json:
  total:   1000.00
  reserve:    0.00
  trading: 1000.00
  pnl:        0.00
  resetAt: 1779288796142 (2026-05-20 16:54)

strategy_regime_performance seit Day-Zero (1779288888536):
  GRID:    7020 trades  275.57 USDT
  INFGRID:   13 trades    0.63 USDT
  ──────────────────────────────────
  Σ MBT-PnL:           276.20 USDT (in DB getrackt)

grid_instances seit Day-Zero:
  ATOMUSDT GRID  CLOSED  profit_acc 104.77  (geschlossen 11:26)
  UNIUSDT  GRID  CLOSED  profit_acc 259.55  (geschlossen 10:07)
  ATOMUSDT INFGRID OPEN  profit_acc   0.88
  DOGEUSDT GRID  CLOSED  profit_acc  10.69
  ──────────────────────────────────────────
  Σ profit_acc OPEN+CLOSED: 375.89

wallet_ledger seit Day-Zero:
  GRID_BUY:           7014  103,460.10  (Order-Volumen, kein PnL)
  GRID_SELL:          7033  103,696.61  (Order-Volumen, kein PnL)
  GRID_CLOSE_PROFIT:     1      104.77  (PRIO5_FIX #1 heute, Audit-only)
  DCA_BUY:               4       80.00  (Order-Volumen)
  INITIAL_SPLIT_CORRECTION: 1   700.00  (Audit-only, von gestern)
```

### Diskrepanz

| | SOLL (per Christian-Logic) | IST | Δ |
|---|---:|---:|---|
| Reserve | 276.20 × 0.7 = **193.34** | **0.00** | **-193.34** 🔴 |
| Trading | 1000 + 276.20 × 0.3 = **1082.86** | **1000.00** | **-82.86** 🔴 |
| Σ | 1276.20 | 1000 | **-276.20** |

**+ noch nicht-registrierte 104.77 USDT ATOM-GRID-Close** (heute via PRIO5_FIX_1 in ledger nur als Audit-Entry, keine wallet-Mutation).

→ **Effektiv ~381 USDT realisiertes Profit ist nicht im Wallet sichtbar.**

---

## B) CODE-ANALYSE applyPnL-Pfad

### `WalletProvider.applyPnL(pnl, tradeId)` — Z.10207

**Logik:** korrekt 70/30-Split-Code mit `bot_settings.reserve_split_ratio` (dyn) + Fallback CFG.RESERVE_RATIO=0.70.

```js
if (pnl > 0) {
  const toReserve = pnl * _rRatio;
  const toTrading = pnl * (1 - _rRatio);
  w.reserve += toReserve;
  w.trading += toTrading;
} else {
  w.trading = Math.max(0, w.trading + pnl);
  // Reserve unangetastet
}
```
✅ Logik strategie-konform.

### **Wer ruft applyPnL?**

3 Call-Sites total:

| Z. | Caller | Bot-Type | Wirkt? |
|---:|---|---|:-:|
| 5704 | `Trades.close()` | **SINGLE** | ✅ |
| 24228 | (in test/legacy) | ? | unklar |
| 24236 | (in test/legacy) | ? | unklar |

### **GRID-Engine (Z.8848-9023): KEIN applyPnL!**

`GridBotMBT` schreibt:
- Z.8973 `strategy_regime_performance` INSERT (Audit) ✅
- Z.8921 `profit_acc += delta` (instance-internal Tracker) ✅
- Z.~xxx `wallet_ledger` GRID_BUY/SELL (Order-Volumen, kein PnL) ✅
- **❌ KEIN `WalletProvider.applyPnL(profitDelta)` Call**

→ Grid-Profit landet in `strategy_regime_performance.pnl_usdt` und `grid_instances.profit_acc`, aber **wandert nie ins Wallet**.

### **DCA-Engine (Z.9024-9200): applyPnL nicht direkt**

`DCABotMBT.checkExit` Z.9102+:
- Bei TP-Hit: setzt status=CLOSED_TP, schreibt `meta.realized_pnl`
- Z.9122 `strategy_regime_performance` INSERT ✅
- PRIO5_FIX #2 heute: `dca_iterations.pnl_usdt` befüllt ✅
- **❌ KEIN `WalletProvider.applyPnL(realizedPnl)` Call**

Wallet sieht DCA-PnL nur über `computeDailyPnLMBT()` (display-only).

### **INFGRID (Z.9201-9363): KEIN applyPnL**

Analog zu GRID — schreibt in `strategy_regime_performance`, kein Wallet-Mutation.

### Konsequenz

```
Order-Volumen (GRID_BUY/SELL):  103k each  → wallet_ledger (Audit-only)
Profit pro Fill:                summiert in profit_acc + strategy_regime_performance
Reserve-Pool:                                                            BLEIBT LEER
Trading-Pool:                                                            BLEIBT BEI START
```

**Root-Cause: applyPnL ist Single-Source-of-Truth für Wallet-Mutation, aber MBT-Engines umgehen sie.**

---

## C) UI-Anzeige-Status

Siehe `docs/UI_REVIEW_20260523.md`:

- KAPITAL-Tab zeigt `VERMÖGEN = 1000` (= reserve 0 + trading 1000 + imMarkt 130 - wait nein: vermoegenStat = safe + reinv + imMarkt = 0+1000+130 = **1130**)
- **4 neue Backend-Felder (realizedGrid, realizedAllSinceReset, totalEquity, dayZeroAt) sind NICHT in UI eingebunden**
- Christian sieht $1130 statt echtem totalEquity $1406+
- **Differenz $276+ "schwebt" als profit_acc/strategy_regime_performance, nicht in Wallet-Pools**

---

## D) LÖSUNGSWEG-OPTIONEN

### OPTION 1 — DAILY-PROFIT-REALIZE-CRON (empfohlen)

**Konzept:** Cron 23:55 Uhr berechnet realisiertes MBT-PnL des Tages, ruft `applyPnL(daily_realized_mbt_sum)` auf → 70/30-Split greift.

**Implementation:**
1. Neuer Cron `MBTProfitRealizer.tick()`
   - Liest `SUM(pnl_usdt) FROM strategy_regime_performance WHERE ts BETWEEN today_start AND today_end AND realized_at IS NULL`
   - Falls Σ > 0: `WalletProvider.applyPnL(Σ, 'DAILY_MBT_REALIZE_'+date)`
   - Markiert die rows mit `realized_at = NOW` (neue Spalte!) → idempotent
2. Schema-Erweiterung: `ALTER TABLE strategy_regime_performance ADD COLUMN realized_at INTEGER`
3. Backup: nexus.db pre-realize
4. Ledger-Eintrag: `MBT_DAILY_REALIZE` mit reason="Day X profit-take 70/30"

**Risiko:** 🟡 MITTEL
- Doppel-Apply: idempotent via `realized_at`-Flag
- Realtime-Inkonsistenz: tagsüber zeigt UI noch "schwebend", 23:55 wandert es in Wallet
- Rollback: einfach `UPDATE strategy_regime_performance SET realized_at=NULL` + Wallet-Restore

**Aufwand:** 4-6h mit Tests, idempotency, sub-pipeline

### OPTION 2 — PER-FILL applyPnL Grid (riskant)

**Konzept:** Bei jedem Grid-Fill direkt `applyPnL(fill_delta)` aufrufen.

**Risiko:** 🚨 KRITISCH
- 7,000+ fills × 3 days → 14,000 Wallet-Mutations
- Race-Conditions: 2 fills gleichzeitig → Wallet-Drift
- Rollback: Wallet-State pro Tag wiederherstellen
- Doppelbuchung: `profit_acc` + Wallet-Mutation parallel → falls beide accounted → 2× counted

**NICHT EMPFOHLEN** ohne Wochen-Engineering + Race-Locks + DB-Transaktionen.

### OPTION 3 — UI-ONLY Sofort-Fix

**Konzept:** UI rechnet selbst Reserve+Trading aus realizedGrid (read-only).

**Implementation:**
```js
// In KAPITAL-Tab + BOTS-Tab:
const _splitRatio = await fetch('/api/kapital/reserve-split');  // = 0.7
const _realized = dash.portfolio.realizedAllSinceReset;          // = 381
const _displayReserve = wallet.reserve + _realized * _splitRatio;  // 0 + 266.70 = 266.70
const _displayTrading = wallet.trading + _realized * (1 - _splitRatio);  // 1000 + 114.30 = 1114.30
const _totalEquity = _displayReserve + _displayTrading;  // 1381

setT('cap-safe', _displayReserve.toFixed(2));
setT('cap-re', _displayTrading.toFixed(2));
setT('cap-total', _totalEquity.toFixed(2));
```

**Risiko:** 🟢 NIEDRIG
- Engine unverändert
- Risk-Sizer arbeitet weiter auf wallet.trading=1000 (ignoriert virtuelle 1114.30) → **konservativ, ungefährlich**
- Kein DB-Eingriff
- Rollback: UI-Revert

**Aufwand:** 30min

**Nachteil:** virtuelle Anzeige, nicht echte Wallet-State

### OPTION 4 — HISTORICAL BACKFILL + OPTION 1

**Konzept:** Einmaliger Backfill aller bisherigen 276+105=381 USDT via single `applyPnL(381, 'HISTORICAL_BACKFILL')` Call. Danach Option-1-Cron für künftig.

**Implementation:**
1. Backup zwingend
2. SQL: `SELECT SUM(pnl_usdt) FROM strategy_regime_performance WHERE ts >= dayZero AND realized_at IS NULL` → 276.20
3. + `SELECT SUM(profit_acc) FROM grid_instances WHERE status='CLOSED' AND closed_at >= dayZero AND profit_realized_at IS NULL` → 105 (ATOM-Close + UNI-Close)
4. `WalletProvider.applyPnL(381, 'HIST_BACKFILL_20260523')`
5. Mark all rows realized
6. Audit-Log: `MEGA_BACKFILL` mit before/after
7. Aktivierung Option-1-Cron

**Risiko:** 🟡 MITTEL
- Einmal-Aktion mit Audit-Trail
- Rollback: Wallet-Restore + UPDATE rows SET realized_at=NULL

**Aufwand:** 1-2h Backfill + 4-6h Cron = ~6-8h total

---

## E) SENIOR-EMPFEHLUNG

### **EMPFOHLEN: OPTION 4 = Historical Backfill + Daily-Cron**

**Begründung:**
1. Option 3 (UI-only) kaschiert nur — Engine sieht weiter wallet.trading=1000, das ist Risk-Sizing-falsch
2. Option 2 (Per-Fill) ist instabil + race-prone, würde Tage testing brauchen
3. Option 1 (Cron-only) lässt historische 381 USDT "im Limbo" — UI/Engine inkonsistent
4. Option 4 räumt einmal sauber auf + verhindert Re-Akkumulation strukturell

### Implementations-Plan (Option 4 detailliert)

**Phase A: Schema + Pre-Snapshot (30min)**
- Backup nexus.db + demo_wallet.json
- `ALTER TABLE strategy_regime_performance ADD COLUMN realized_at INTEGER DEFAULT NULL`
- `ALTER TABLE grid_instances ADD COLUMN profit_realized_at INTEGER DEFAULT NULL`
- Audit-Log: SCHEMA_EXTEND

**Phase B: Historical Backfill (1h)**
- Berechnung:
  - `Σ_strp = SELECT SUM(pnl_usdt) WHERE ts >= dayZero AND realized_at IS NULL` = 276.20
  - `Σ_closed_grids = SELECT SUM(profit_acc) WHERE status IN ('CLOSED','CLOSED_TP') AND closed_at >= dayZero AND profit_realized_at IS NULL` (Achtung: doppel-counting-Check, ATOM-Close +104.77 ist evtl. schon in strategy_regime_performance enthalten)
- `applyPnL(Σ, 'HIST_BACKFILL_20260523')` → Reserve +266.70, Trading +114.30
- Mark rows: `UPDATE strp SET realized_at = NOW`, `UPDATE grid_instances SET profit_realized_at = NOW`
- Verify: data/demo_wallet.json = {total:1381, reserve:266.70, trading:1114.30}
- Audit-Log: HIST_BACKFILL mit before/after-state

**Phase C: Daily-Cron-Modul (3-4h)**
- Neues Modul `modules/mbt_profit_realizer.js`
- Cron 23:55 lokal
- Liest unrealized PnL des Tages
- Ruft applyPnL(Σ, daily_tag)
- Marks realized_at
- Telegram-Alert: "💰 Daily Realize: +X.XX → Reserve +XX, Trading +XX"
- 7-Tage-Trockenlauf (`dry_run=true`) bevor productive

**Phase D: UI-Erweiterung (1h)**
- KAPITAL-Tab: realizedGrid, realizedAllSinceReset, totalEquity, dayZeroAt einbinden
- BOTS-Tab: dito
- "Last Realize" Timestamp + "Pending Realize" indicator

**Phase E: Tests + Rollback-Strategie (1h)**
- Akzeptanz: wallet.total == startTotal + Σ_realized_pnl (innerhalb 0.01 Toleranz)
- Rollback: `UPDATE strp SET realized_at=NULL` + Wallet-Restore aus Backup
- Failure-mode: bei applyPnL-fehlschlag → realized_at bleibt NULL, nächster Cron versucht erneut (idempotent)

**Total: 6-8h Engineering + 1 Woche Beobachtung**

### Akzeptanzkriterien

- ✅ Reserve füllt sich gemäß 70/30 bei MBT-Profit
- ✅ Wallet-Total == sum aller realized PnL since Day-Zero (innerhalb 0.01 USDT)
- ✅ Bei Verlust: Reserve unverändert, Trading reduziert
- ✅ Idempotent: doppelter Cron-Lauf doppelter nicht apply
- ✅ Audit-Trail: jede Realize hat wallet_ledger-Entry
- ✅ Rollback in <5min möglich

---

*Phase 3 Kapital-Audit abgeschlossen — weiter zu Phase 4 Action-Plan*
