# FIX 7 SPEC — WalletReconciler MBT-aware

**Datum:** 2026-05-26 08:18
**Status:** SPEC ONLY (kein Code-Deploy heute)
**Priorität:** 🔴 BLOCKER für LIVE-Switch (aktuell COSMETIC im PAPER)
**Aufwand:** geschätzt 2-3h Engineering + 30min Verify
**Audit-Referenz:** B1-2 + B2-2 + Punkt 3 aus Tag-8-Status

---

## 1. STATUS QUO — Bug-Beweis

### Aktuelle Formel (server.js Z.18984-18991)
```js
const startTotal = w.startTotal || 1000;
const reserve = w.reserve || 0;
let activeSizes = 0, realizedPnl = 0;
try { const r = DB.db.prepare("SELECT SUM(size) as s FROM trades WHERE state='POSITION_ACTIVE'").get(); activeSizes = (r && r.s) || 0; } catch(_){}
try { const r = DB.db.prepare("SELECT SUM(realized_pnl) as p FROM trades WHERE state='CLOSED'").get(); realizedPnl = (r && r.p) || 0; } catch(_){}
const sollTrading = startTotal + realizedPnl - activeSizes - reserve;
const istTrading = w.trading || 0;
const drift = istTrading - sollTrading;
```

**Bug:** beide SQL-Queries lesen NUR `trades`-Tabelle = SINGLE-Trades. Komplett blind auf:
- `grid_instances` (GRID/INFGRID)
- `dca_instances` (DCA)
- `grid_orders` filled-BUY/SELL Cash-Movements

### Live-Beweis (26.05.2026 07:08)
```
soll = 957.52   ist = 1106.49   drift = 148.97 USDT
```
- Drift = ~13.4% des Wallets, alertThreshold = 1.00 → ständig WARN
- Drift wächst mit MBT-Aktivität (gestern 147.37 → heute 148.97, exakt +1.60 = der NEAR-GRID-Profit aus der Nacht)
- KEINE auto-Korrektur (gut!), aber Log-Spam alle 30s

### Was wäre passiert wenn `autoFix=true` (Z.19004-9)?
```js
w.trading = sollTrading;     // → 957.52 (von 1106.49 abgezogen)
w.total   = sollTrading + reserve;
DemoEngine._persistWallet();
```
**LIVE-Equivalent: $148.97 echtes Geld wäre verschwunden.** Daher BLOCKER für LIVE.

---

## 2. QUELLEN (curl direct)

### LEAN TotalPortfolioValue (eine zentrale Wahrheit)
**curl:** `https://raw.githubusercontent.com/QuantConnect/Lean/master/Common/Securities/SecurityPortfolioManager.cs` (verify in /tmp/lean_pm.cs, 42 802 bytes)
```csharp
// Z.470-473
_totalPortfolioValue = CashBook.TotalValueInAccountCurrency +
                       UnsettledCashBook.TotalValueInAccountCurrency +
                       totalHoldingsValueWithoutForexCryptoFutureCfd +
                       totalFuturesAndCfdHoldingsValue;
```
**Lehre:** EINE zentrale Berechnungsstelle = keine Drift möglich.

### Nautilus Portfolio (per-instrument PnL + balances_locked)
**curl:** `https://raw.githubusercontent.com/nautechsystems/nautilus_trader/develop/nautilus_trader/portfolio/portfolio.pyx`
```python
# Z.804  balances_locked(self, Venue venue=None, AccountId account_id=None)
# Z.868  realized_pnls(...)
# Z.899  unrealized_pnls(...)
# Z.949  total_pnls(...)
```
**Lehre:** `balances_locked` ist explizit das committed-but-not-yet-realized Cash. Reconciliation MUSS das einrechnen.

### AUDFIX_035 in-code Kommentar (Z.10629-10641)
> wallet.total enthält bereits implizit das MBT-Geld (DCA_BUY zieht KEIN Cash vom Wallet ab — sichtbar im wallet_ledger: before_total==after_total).
> Vorher: total + mbtCommitted + unrealized = DOPPELT
> Jetzt: total + unrealized = ehrlich

**Lehre:** MBT-BUYs sind Audit-Only ledger-entries, **nicht echte Cash-Movements**. Wallet.trading wird nicht geleert wenn GRID/DCA-Cash gebunden wird. Das ist der versteckte 3. Teil des Bug.

### wallet_ledger Live-Analyse (26.05.2026 08:16)
```
op                       n      sum_amt
GRID_SELL                8391   4 456 314
GRID_BUY                 8372   4 456 080    ← Audit-Only, kein Cash-Movement
PNL                      53     0.27
PROFIT_SPLIT_RESERVE     50     1.12         ← FIX 3 Live-Beweis
DCA_BUY                  12     240          ← Audit-Only
DEBIT                    5      275.04       ← SINGLE-entry Cash-Outflow
CREDIT                   3      159.21       ← SINGLE-exit Cash-Inflow
GRID_CLOSE_PROFIT        1      104.77       ← historische Single-Close
HIST_BACKFILL            1      276.20       ← initial migration
INITIAL_SPLIT_CORRECTION 1      700          ← initial split
```
**Wahrheit:** Nur DEBIT/CREDIT/PNL/PROFIT_SPLIT_RESERVE/HIST_BACKFILL/INITIAL_SPLIT_CORRECTION sind echte Wallet-Movements. GRID_BUY/GRID_SELL/DCA_BUY sind Audit-Only.

---

## 3. LÖSUNGS-OPTIONEN

### Option A — MBT-Mengen explizit in soll-Formel
```js
sollTrading = startTotal + realizedPnl(SINGLE)
            + Σ(grid_orders BUY filled - SELL filled WHERE status=OPEN)   ← MBT net cash
            + Σ(dca_instances.total_spent WHERE status IN ('OPEN','DD_STOPPED'))
            + Σ(grid_instances.profit_acc WHERE status='CLOSED')   ← gesicherte GRID-Profits
            - activeSizes(SINGLE)
            - reserve
```
**Pro:** explizit, auditierbar, jedes Stück nachvollziehbar
**Con:** komplex; muss FIX-3-Effekt sauber separieren (vor-FIX-3 stranded vs nach-FIX-3 in wallet)

### Option B — Audit-Trail via wallet_ledger
```js
ledgerOps = wallet_ledger WHERE op IN ('PNL','PROFIT_SPLIT_RESERVE','DEBIT','CREDIT','GRID_CLOSE_PROFIT','HIST_BACKFILL','INITIAL_SPLIT_CORRECTION','RECON_FIX')
sollTotal = startTotal + Σ(amount für CREDIT/PNL/PROFIT_SPLIT_RESERVE/GRID_CLOSE_PROFIT/HIST_BACKFILL/INITIAL_SPLIT_CORRECTION)
          - Σ(amount für DEBIT)
istTotal  = wallet.total
drift     = ist - soll
```
**Pro:** Single Source of Truth = ledger; jeder Wallet-Movement hat genau 1 Eintrag; trivial zu auditieren
**Con:** muss op-Liste pflegen wenn neue ledger-ops eingeführt werden; bestehende RECON_FIX-Einträge müssen ausgeschlossen sein

### Option C — getEffectiveDemoEquity als Wahrheit (LEAN-Style)
```js
effectiveTotal  = getEffectiveDemoEquity().effectiveTotal     // = wallet.total + mbtUnrealized
istWallet       = wallet.total
mbtUnrealized   = effectiveTotal - wallet.total
sollEffective   = startTotal + Σ(realized_all_via_PNL_ledger) + mbtUnrealized
drift           = effectiveTotal - sollEffective
```
**Pro:** matcht KillSwitch/Dashboard exakt (FIX 4 referenziert genau diese Quelle); MBT inherent berücksichtigt
**Con:** Tautologie-Gefahr — effectiveTotal == wallet.total + unrealized.total per Definition

---

## 4. EMPFEHLUNG

**Option B (Audit-Trail via wallet_ledger) + Option C (effectiveTotal-Wahrheit) HYBRID.**

Begründung:
- Option B prüft "Cash-Bewegungen waren konsistent" (jeder Movement im ledger)
- Option C prüft "current Wallet entspricht effective Equity-View" (KillSwitch konsistent)
- Beide zusammen decken: (a) Audit-Trail-Integrität + (b) Live-Equity-Konsistenz

### Pseudo-Code (target server.js Z.18981-19020)
```js
WalletReconciler = {
  lastCheck: null, lastDrift: 0, alertThreshold: 1.0,

  check(autoFix) {
    const w = DemoEngine && DemoEngine.wallet;
    if (!w) return { error: 'no wallet' };

    const startTotal = w.startTotal || 1000;
    const reserve = w.reserve || 0;
    const istTotal = w.total || 0;
    const istTrading = w.trading || 0;

    // ─── Audit-Trail-Sum aus wallet_ledger (echte Wallet-Movements only)
    let ledgerNet = 0;
    try {
      const r = DB.db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN op IN ('CREDIT','PNL','PROFIT_SPLIT_RESERVE','GRID_CLOSE_PROFIT','HIST_BACKFILL','INITIAL_SPLIT_CORRECTION','RECON_FIX')
                            THEN amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN op='DEBIT' THEN amount ELSE 0 END), 0) AS net
        FROM wallet_ledger
      `).get();
      ledgerNet = r.net || 0;
    } catch(_) {}

    const sollTotalLedger = startTotal + ledgerNet;
    const driftLedger = istTotal - sollTotalLedger;

    // ─── Effective-Equity-Konsistenz (LEAN-Style, matcht KillSwitch + Dashboard)
    let effectiveTotal = istTotal;
    let mbtUnrealized = 0;
    try {
      if (typeof getEffectiveDemoEquity === 'function') {
        const eq = getEffectiveDemoEquity();
        effectiveTotal = eq.effectiveTotal;
        mbtUnrealized = eq.unrealized?.total || 0;
      }
    } catch(_) {}

    const result = {
      ts: Date.now(),
      startTotal,
      ledgerNet:        Math.round(ledgerNet * 100) / 100,
      sollTotal:        Math.round(sollTotalLedger * 100) / 100,
      istTotal:         Math.round(istTotal * 100) / 100,
      driftLedger:      Math.round(driftLedger * 100) / 100,
      effectiveTotal:   Math.round(effectiveTotal * 100) / 100,
      mbtUnrealized:    Math.round(mbtUnrealized * 100) / 100,
      reserve:          Math.round(reserve * 100) / 100,
      trading:          Math.round(istTrading * 100) / 100,
      consistent:       Math.abs(driftLedger) < this.alertThreshold,
      mode:             'V2_MBT_AWARE',
    };
    this.lastCheck = Date.now();
    this.lastDrift = driftLedger;

    if (!result.consistent) {
      try { Log.warn('RECON', `V2 DRIFT ${driftLedger.toFixed(2)} USDT (soll=${sollTotalLedger.toFixed(2)} ist=${istTotal.toFixed(2)})`); } catch(_){}
      try { ActionStream.push('ERROR','RECON', `Wallet-Drift V2 ${driftLedger.toFixed(2)} USDT`, result); } catch(_){}
      // AutoFix bleibt DEAKTIVIERT bis explizit re-validated
      // (siehe Risiken-Sektion: V2-AutoFix-Aktivierung als separater PR)
    }
    return result;
  },

  // ... (snapshot, status etc. unverändert)
};
```

---

## 5. VERIFIKATIONS-PLAN

### Pre-Deploy (Trockenlauf via SQL)
```sql
-- Erwartetes ledgerNet im aktuellen State:
SELECT
  SUM(CASE WHEN op IN ('CREDIT','PNL','PROFIT_SPLIT_RESERVE','GRID_CLOSE_PROFIT','HIST_BACKFILL','INITIAL_SPLIT_CORRECTION','RECON_FIX') THEN amount ELSE 0 END)
  - SUM(CASE WHEN op='DEBIT' THEN amount ELSE 0 END) AS ledgerNet
FROM wallet_ledger;
```
Erwartung: `1000 + ledgerNet ≈ wallet.total = 1107.62` → drift < 1 USDT.

### Post-Deploy
- Bot 5 Decision-Cycles laufen lassen
- `/api/wallet/recon` (oder Telegram `/recon`) abfragen
- drift_ledger MUSS < 1 USDT sein → status `consistent=true`
- Watch 30min: drift wächst NICHT mit MBT-Aktivität (entscheidender Beweis)

### Live-Vergleich
- Old reconciler: drift 148.97 (SINGLE-only blind)
- New reconciler: drift < 1.00 (MBT-aware)
- Differenz erklärt durch MBT-Komponenten + ledger-Integrität

---

## 6. RISIKEN + ROLLBACK

| Risiko | Mitigation |
|---|---|
| ledger-op-Liste unvollständig (neue ops geadded ohne Update) | Whitelist hardcode + Test-Hook in QA |
| historische ledger-Einträge inkonsistent (Pre-FIX-3 Stranded-Profit-acc) | startTotal-Adjustment per einmaligem CORRECTION-Ledger-Insert beim Deploy |
| autoFix=true catastrophic | bleibt DEAKTIVIERT in V2 — separater PR nach 1 Woche stabiler V2-Verify |
| ledger-Tabelle korrupt (siehe regime_history-Lehre) | Try/Catch + Fallback auf alte Formel + Telegram-CRITICAL |
| Performance: ledger hat ~17k+ Einträge | Index `idx_ledger_op` vorhanden, JOIN-frei → ~10ms |

### Rollback
```bash
# Backup vor Deploy (Pflicht)
cp server.js server.js.bak.FIX7_PRE_$(date +%Y%m%d_%H%M%S)

# Falls drift > 5 USDT konstant ODER unconsistencies:
cp server.js.bak.FIX7_PRE_* server.js
pm2 restart nexus --update-env
# alte Formel restored, drift wieder bei 148.97 (bekannter Zustand)
```

---

## 7. NEBEN-FIXES (in einem PR)

1. **B2-2:** displayReserve vs wallet.reserve discrepancy — beide Felder müssen aus `wallet.reserve` lesen (nicht aus aggregierter SQL-Sicht über alle PROFIT_SPLIT_RESERVE).
2. **alertThreshold:** von 1.0 USDT (zu eng für realistischen ledger-Float) auf 2.0 USDT (rounding-tolerant). Documented in CHANGELOG.
3. **/api/wallet/recon** Endpoint hinzufügen (aktuell nur intern aufgerufen) für UI-Debugging.

---

## 8. DEPLOY-VORAUSSETZUNGEN

- ✅ Bot in PAPER-Mode (bestätigt)
- ✅ Backup-Strategie geklärt (siehe Schritt 1 TAG8_DB_CLEANUP-Backup als Referenz)
- ⏳ Christian-Approval für Deploy (nicht heute, geplant Tag 9)
- ⏳ Implementation + Test (Tag 9, ~3h)

---

*Spec erstellt: 2026-05-26 08:18 nach Code-Trace + Quellen-Verifikation*
*Quellen: LEAN/SecurityPortfolioManager.cs (curl), Nautilus/portfolio.pyx (curl), AUDFIX_035 in-code comment, wallet_ledger Live-Analyse*
*Verifikation aller Quellen via raw-curl, NICHT WebFetch.*
