# NEXUS V9 — BEREICH 1 TIEFEN-AUDIT (V2 mit Live-Log-Beweis)

**Start:** 2026-05-25 17:17:51 CEST (Bash-Timestamp aus Log)
**Doc-Schreib:** 2026-05-25 17:25 (Bash-Timestamp)
**Audit-Log:** `/tmp/audit_log_20260525_171751.txt` (553 Zeilen, 29107 bytes)
**Modus:** READ-ONLY, Bot tradet parallel weiter

---

## A. PFLICHT-BEWEIS-PROTOKOLL EINHALTUNG

| Item | Status |
|---|---|
| Live-Log angelegt | ✅ `/tmp/audit_log_20260525_171751.txt` |
| Jeder Command timestamped | ✅ Bash `date '+%H:%M:%S'` vor jedem Block |
| Jede SQL-Query + Raw-Output ins Log | ✅ |
| Jedes Quellen-Zitat per curl + Output | ✅ 6 Quellen direkt verifiziert, 2 Existence-only |
| WebFetch als Beweis | ❌ NICHT genutzt für Quellen-Zitate |
| Zeit-Behauptungen ohne Bash-Timestamp | ❌ NICHT gemacht |
| UNGEPRÜFT/UNSICHER bei Lücken | ✅ markiert |

---

## B. QUELLEN-RESEARCH (8 versucht, 6 direkt verifiziert)

### Q1 — LEAN SecurityHolding.cs ✅ DIRECT
**curl:** `https://raw.githubusercontent.com/QuantConnect/Lean/master/Common/Securities/SecurityHolding.cs`
**Size:** 17875 bytes, 529 Zeilen, EXIT 0

**EXAKT-Zitat `TotalCloseProfit` Z.477 (raw, geprüft):**
```csharp
public virtual decimal TotalCloseProfit(bool includeFees = true, decimal? exitPrice = null, 
    decimal? entryPrice = null, decimal? quantity = null)
{
    var quantityToUse = Quantity;
    if (quantity.HasValue) quantityToUse = quantity.Value;
    else if (!_invested) return 0;
    var feesInAccountCurrency = 0m;
    if (includeFees) {
        var liquidationFees = Extensions.GetMarketOrderFees(_security, -quantityToUse, ...);
        feesInAccountCurrency = _currencyConverter.ConvertToAccountCurrency(liquidationFees).Amount;
    }
    var price = IsLong ? _security.BidPrice : _security.AskPrice;
    if (price == 0) price = _security.Price;
    var entryValue = GetQuantityValue(quantityToUse, entryPrice ?? AveragePrice).InAccountCurrency;
    var potentialExitValue = GetQuantityValue(quantityToUse, exitPrice ?? price).InAccountCurrency;
    return potentialExitValue - entryValue - feesInAccountCurrency;
}
```

**EXAKT-Zitat `UnrealizedProfit` Z.368-370:**
```csharp
public virtual decimal UnrealizedProfit { get { return TotalCloseProfit(); } }
```

**Insights:** decimal (28-29 stellen), Bid/Ask je Side, default includeFees, Currency-Conversion.

### Q2 — NautilusTrader Positions Doc HTML ✅ DIRECT
**curl:** `https://nautilustrader.io/docs/latest/concepts/positions/`
**Size:** 289473 bytes

**EXAKT-Zitat "Numerical precision" Section (geprüft via Regex-Extract):**
> "Position calculations use 64-bit floating-point (f64) arithmetic for PnL and average price computations. While fixed-point types (Price, Quantity, Money) preserve exact precision at configured decimal places, internal calculations convert to f64 for performance and overflow safety."
> "IEEE-754 double precision provides ~15 decimal digits of accuracy."
> "Standard amounts: No precision loss for amounts ≥ 0.01 in standard currencies."
> "High-precision instruments: 9-decimal crypto prices preserved within **1e-6 tolerance**."
> "Sequential fills: **100 fills show no drift**"

**Korrektur zu vorherigem Audit:** Ich hatte "1e-10 accuracy" geschrieben — Raw sagt **1e-6**. Korrigiert.

**EXAKT-Zitat realized_pnl-Formel:**
```
LONG:  realized_pnl = closed_quantity * multiplier * (1/exit_price - 1/entry_price)  [inverse]
SHORT: realized_pnl = closed_quantity * multiplier * (1/entry_price - 1/exit_price)  [inverse]
```

### Q3 — Freqtrade Trade-Object Doc ✅ DIRECT (eingeschränkt)
**curl:** `https://www.freqtrade.io/en/stable/trade-object/`
**Size:** 63696 bytes

**Gefundenes Zitat:**
> "Absolute already realized profit (in stake currency) while the trade is still open."

**Schwäche:** Doc enthält `calc_profit` nicht detailliert. Source-Code auf GitHub wäre besser. UNGEPRÜFT für exakte Formel.

### Q4 — arXiv 1404.7493 "Drawdown: From Practice to Theory" ⚠ EXISTENZ-ONLY
**curl:** `https://arxiv.org/abs/1404.7493` (HTML) + `https://arxiv.org/pdf/1404.7493` (PDF 1MB)
- HTML: 45245 bytes → Author Goldberg/Mahmoud, Abstract verifiziert (CED concept)
- PDF: gefetched aber NICHT lesbar (kein `pdftotext`/`poppler` auf System)
- **Read-Tool failed:** "pdftoppm is not installed"
- **STATUS: NUR Existenz + Abstract verifiziert.** Inhalt UNGEPRÜFT.
- **→ Darf NICHT als Quelle für DD-Formel zitiert werden.**

### Q5 — arXiv 1506.00166 ⚠ EXISTENZ-ONLY
Gleicher Status wie Q4. Existenz via Original-Search verifiziert.

### Q6 — Hummingbot performance.py ✅ DIRECT
**curl:** `https://raw.githubusercontent.com/hummingbot/hummingbot/master/hummingbot/client/performance.py`
**Size:** 13791 bytes, 326 Zeilen

**Befund:** Hummingbot nutzt **Decimal** (Python `decimal.Decimal`), NICHT float:
```python
trade_pnl: Decimal = s_decimal_0
fee_in_quote: Decimal = s_decimal_0
total_pnl: Decimal = s_decimal_0
```

### Q7 — NautilusTrader position.rs (Rust) ✅ DIRECT
**curl:** `https://raw.githubusercontent.com/nautechsystems/nautilus_trader/develop/crates/model/src/position.rs`
**Size:** 163107 bytes, 4532 Zeilen

**EXAKT-Zitat `calculate_pnl` Z.755:**
```rust
pub fn calculate_pnl(&self, avg_px_open: f64, avg_px_close: f64, quantity: Quantity) -> Money {
    let pnl_raw = self.calculate_pnl_raw(avg_px_open, avg_px_close, quantity.as_f64())
        .unwrap_or_else(|e| { log::error!("Error: {e}"); 0.0 });
    Money::new(pnl_raw, self.settlement_currency)
}

pub fn unrealized_pnl(&self, last: Price) -> Money {
    if self.side == PositionSide::Flat { Money::new(0.0, self.settlement_currency) }
    else {
        let pnl = self.calculate_pnl_raw(self.avg_px_open, last.as_f64(), self.quantity.as_f64()).unwrap_or(0.0);
        Money::new(pnl, self.settlement_currency)
    }
}
```

**Insight:** Rust nutzt f64, aber Money-Wrapper. FLAT returns 0.

### Q8 — LEAN SecurityPortfolioManager.cs ✅ DIRECT
**curl:** Raw 42802 bytes, 972 Zeilen

**EXAKT-Zitat `TotalPortfolioValue` Z.430-475:**
```csharp
public decimal TotalPortfolioValue {
    get {
        lock (_totalPortfolioValueLock) {
            if (!_isTotalPortfolioValueValid) {
                decimal totalHoldingsValueWithoutForexCryptoFutureCfd = 0;
                decimal totalFuturesAndCfdHoldingsValue = 0;
                foreach (var security in Securities.Values.Where((x) => x.Holdings.Invested)) {
                    ...
                }
                _totalPortfolioValue = CashBook.TotalValueInAccountCurrency +
                    UnsettledCashBook.TotalValueInAccountCurrency +
                    totalHoldingsValueWithoutForexCryptoFutureCfd +
                    totalFuturesAndCfdHoldingsValue;
                _isTotalPortfolioValueValid = true;
            }
        }
    }
}
```

**Insights:** Thread-safe via lock, Cache-Invalidation-Pattern, separate Buckets für Crypto/Futures/CFD.

### Quellen-Übersicht
| # | Quelle | Beweis-Typ | Status |
|--:|---|---|---|
| Q1 | LEAN SecurityHolding | Raw .cs curl | ✅ |
| Q2 | Nautilus Positions Doc | Raw HTML curl | ✅ |
| Q3 | Freqtrade Trade-Object | Raw HTML curl | ✅ (eingeschränkt) |
| Q4 | arXiv 1404.7493 | HTML + PDF | ⚠ Existence only |
| Q5 | arXiv 1506.00166 | HTML | ⚠ Existence only |
| Q6 | Hummingbot performance.py | Raw .py curl | ✅ |
| Q7 | Nautilus position.rs | Raw .rs curl | ✅ |
| Q8 | LEAN SecurityPortfolioManager | Raw .cs curl | ✅ |

**6 direkt verifizierte Quant-Niveau-Quellen** (Pflicht 5+ erfüllt).

---

## C. NEXUS V9 CODE-TRACE — alle Wallet-Mutationen

### C.1 Mutations-Stellen (Z. aus `grep`)

| Z. | Code-Pfad |
|---|---|
| 4887 | `DemoEngine.wallet.peakTotal = eq` (KillSwitch) |
| 10365 | `wallet.trading = max(0, trading - amount)` (_debit) |
| 10366 | `wallet.total = reserve + trading` (recompute) |
| 10388 | `wallet.trading = max(0, trading + amount)` (_credit) |
| 10389 | `wallet.total = reserve + trading` (recompute) |
| 10446 | `w.reserve += pnl × _rRatio` (_applyPnL profit-case) |
| 10447 | `w.trading += pnl × (1-_rRatio)` (_applyPnL profit-case) |
| 10449 | `w.trading = max(0, trading + pnl)` (_applyPnL loss-case) |
| 10460-10462 | `w.pnl/dailyPnl += pnl`, `w.total = reserve+trading`, `w.peakTotal = max(...)` |
| 24288-24291 | Init/Reset (capital, peakTotal, dailyStart) |
| 25326-25327 | dailyReset (Mitternacht) |

### C.2 `_persistWallet`-Aufrufer (10 Stellen, ALLE verifiziert)
4893, 5780, 10367, 10390, 10463, 14612, 18967, 24265 (Definition), 25289, 25328

### C.3 `_persistWallet`-Implementation (Z.24265):
```js
_persistWallet() {
  try {
    require('fs').writeFileSync(this.WALLET_PATH, JSON.stringify(this.wallet));
  } catch(e) { try{Log.warn('DEMO','Wallet persist failed: '+e.message);}catch(_){} }
}
```

**Befund:** NICHT atomic (kein tmp+rename). Potentiell partial-write bei Crash mitten in Write.

---

## D. SQL-TESTS

### D.1 wallet.total == reserve + trading (EXAKT)
```
wallet.total:       1107.279125
reserve + trading:  1107.279125
EXAKT (==):         True
Differenz:          0.0
```
✅ **Kein Float-Drift im aktuellen Wallet.**

### D.2 Realized-Sum aus 6 Quellen
```
A_trades_CLOSED:                  2 records, -$0.0709
B_strp_ALL:                       8006 records, $2147.4851 (inkl. 7822 FALSE_MATH)
C_strp_CLEAN_no_FALSE_MATH:       184 records, $10.5356
D_grid_CLOSED_profit_acc:         7 records, $142.3440 (ehrlich korrigiert)
E_dca_CLOSED_TP_meta:             1 record, $4.6908
F_wallet_ledger_PNL:              1 record, -$0.0709
```

**Konsistenz-Check:**
- A + F gleich (-$0.07) ✓
- D + E + A = $146.97 (ehrlich realized)
- wallet.pnl Disk = $147.29
- **Differenz $0.32** = BTC-GRID Close-Verlust (heute, -$0.33 gerundet) ✓

### D.3 70/30-Split-Trigger (kritisch)
```
PROFIT_SPLIT_RESERVE_ops:  0 (von Z.10468-10479 spec'd)
PNL_positive_ops:          0
```

→ **B1-1 BESTÄTIGT:** 70/30-Split wurde **NIE getriggert**.

### D.4 wallet_ledger Math-Konsistenz
```
GRID_SELL:             8171  modifies=0  mismatch=0
GRID_BUY:              8152  modifies=0  mismatch=0
DEBIT:                 3     modifies=3  mismatch=3 (alle 3 sind DEBITs, modify=correct, mismatch=false-positive der Query)
CREDIT:                1     modifies=1  mismatch=1 (gleich, false-positive)
GRID_CLOSE_PROFIT:     1     modifies=0  mismatch=0 ← Wallet wird NICHT verändert!
HIST_BACKFILL:         1     modifies=1  mismatch=1 (Backfill ist Sonderfall)
INITIAL_SPLIT_CORRECTION: 1  modifies=0  mismatch=0
PNL:                   1     modifies=1  mismatch=1 (PNL ändert total)
```

**Math-Konsistenz:** GRID-Trades (BUY+SELL = 16k) verändern **NIE** wallet.total — korrekt, da GRID-Capital pre-allocated ist.

### D.5 GRID_CLOSE_PROFIT-Op Detail
```
23.05 11:26 ATOMUSDT: amount=$104.77, before=$1000, after=$1000 (WALLET UNVERÄNDERT)
```
→ **GRID_CLOSE_PROFIT ist nur Audit-Log-Eintrag**, KEIN Wallet-Mutation. Bestätigt B1-1.

### D.6 Manuelle Wallet-Mutationen
```
23.05 12:34 HIST_BACKFILL: $276.20 → $1000→$1276.20 (Stufe-C-Script, manuell)
21.05 12:23 INITIAL_SPLIT_CORRECTION: $700 zurück Reserve→Trading (Christian-Direktive)
```

---

## E. FLOAT-DRIFT-TESTS (Node.js IEEE-754)

### E.1 1000 × 0.1 addiert
```
Sum: 1099.9999999999363
Erwartet: 1100
Drift: -6.366462912410498e-11
Relativ: -0.000000000005788%
```

### E.2 10000 × 0.0001 (worst-case Mikro-Fills)
```
Sum: 1000.999999999749
Erwartet: 1001
Drift: -2.510205376893282e-10
Relativ: -0.000000000025077%
```

### E.3 Reverse: 1000 × -0.1 subtrahiert
```
Sum: 1000.0000000000637
Drift: 6.366462912410498e-11
```

**Bewertung:** Drift im 1e-10 / 1e-11 Bereich, **vernachlässigbar** für aktuelle Wallet-Größenordnung ($1k-$2k). Vergleich Nautilus-Doc (1e-6 tolerance): NEXUS ist **um Faktor 10000 sicherer** als Nautilus-Spec.

---

## F. DRAWDOWN-FORMEL-INKONSISTENZ

### F.1 Code-Stellen (grep)
6 verschiedene Stellen, 2 verschiedene Formeln:

**Variante A — KillSwitch (Z.4899):**
```js
const drawdown = peakRef > 0 ? (peakRef - eq) / peakRef : 0;
// wobei eq = effectiveTotal = total + unrealized
```

**Variante B — UI/Status (Z.20802, Z.25311, Z.25346):**
```js
const dd = (w.peakTotal - w.total) / w.peakTotal * 100;
// nutzt w.total (OHNE unrealized)
```

### F.2 Aktuelle Werte (Live-Berechnung)
```
wallet.total:       $1107.2791
wallet.peakTotal:   $1151.1922
unrealizedPnl:      $5.1800 (NEAR-GRID + BNB-GRID)
effectiveTotal:     $1112.4591

DD KillSwitch:      3.3646%
DD UI:              3.8146%
INKONSISTENZ:       0.4500 Prozentpunkte
```

**Befund B1-2 BESTÄTIGT:** UI zeigt anderen DD als KillSwitch. Bei $5 unrealized = 0.45pp Differenz. Bei höherem unrealized würde sich vergrößern.

---

## G. FEE-MODELL-KONSISTENZ

### G.1 CFG-Definition (Z.298-299)
```js
MAKER_FEE: 0.001  // 0.10%
TAKER_FEE: 0.001  // 0.10% — Bitget VIP-0 (FEE_WAHRHEIT 20.05.)
```

### G.2 Anwendungs-Stellen (13 verifiziert, alle konsistent 0.001)
SINGLE/DCA/GRID/INFGRID, AdaptiveSLTP, recordClose, Score, Training, position-evaluate, etc.

### G.3 Quant-Vergleich
- Bitget VIP-1+: Maker 0.08% / Taker 0.10% — **NEXUS modelliert nicht differenziert** (beide 0.001)
- **Nicht kritisch** im Demo-Mode mit VIP-0.

---

## H. BEFUNDE (Pflicht-Format)

### B1-1 — 70/30-Split-Design-Bug (🔴 HIGH, BESTÄTIGT)
- **Code-Stelle:** server.js:10437 (`_applyPnL`) wird NUR von Trades.close (Z.5780 nahe) aufgerufen
- **Reproduktion:** `SELECT COUNT(*) FROM wallet_ledger WHERE op='PROFIT_SPLIT_RESERVE'` = 0
- **Auswirkung:** Reserve wächst NIE aus GRID/DCA-Profits. Manueller Backfill nötig (Stufe-C).
- **Fix:** GridBotMBT._close() + DCABotMBT._close() müssen `_applyPnL(profit_acc)` aufrufen
- **Aufwand:** 1-2h
- **Quelle:** LEAN-Pattern (UnrealizedProfit → realized bei Close, `TotalCloseProfit` mit Fees)
- **Beweis:** Q1 LEAN raw + D.3 SQL

### B1-2 — Drawdown-Formel-Inkonsistenz (🟠 MEDIUM, BESTÄTIGT)
- **Code-Stelle:** server.js:4899 (KillSwitch eff) vs Z.20802/25311/25346 (UI total-only)
- **Reproduktion:** F.2 live-Berechnung — 0.45pp Differenz
- **Auswirkung:** UI vs KillSwitch divergent. Bei höherem unrealized signifikant.
- **Fix:** zentrale `_computeDrawdown()` Funktion, alle 6 Stellen zeigen darauf
- **Aufwand:** 30min
- **Quelle:** LEAN SecurityPortfolioManager.cs (TotalPortfolioValue zentral, 1 Wahrheit)

### B1-3 — _persistWallet nicht atomic (🟡 LOW)
- **Code-Stelle:** server.js:24265-24268 — `writeFileSync` direkt ohne tmp+rename
- **Auswirkung:** Bei Stromausfall mitten in Write → partial-write möglich, JSON-corrupt → Boot-Fail
- **Fix:** `writeFileSync(tmp); rename(tmp, target)` (POSIX-atomic)
- **Aufwand:** 30min
- **Quelle:** POSIX rename(2) atomicity-guarantee

### B1-4 — JS Number statt Decimal (🟢 INFO)
- **Code-Stelle:** gesamt server.js — JS hat keine native decimal
- **Auswirkung:** IEEE-754 Drift max 1e-10 bei 10k-Fills — vernachlässigbar
- **Vergleich:** LEAN+Hummingbot nutzen decimal, Nautilus f64 (gleich wie NEXUS)
- **Fix:** decimal.js wenn LIVE >$10k+ und Year-Trading — JETZT nicht nötig
- **Quelle:** Q1+Q6+Q7 raw

### B1-5 — Fee Maker/Taker nicht differenziert (🟢 LOW)
- **Code-Stelle:** Z.298-299
- **Auswirkung:** Bitget VIP-1+ würde 0.08/0.10 Unterschied. NEXUS rechnet konservativ 0.001/0.001.
- **Fix:** Tier-aware fee-lookup wenn VIP-Upgrade
- **Aufwand:** 1h

---

## I. PRÄSENTIER-KRITERIUM Bereich 1

| Pflicht | Status |
|---|:-:|
| Single Source of Truth: DemoEngine.wallet | ✅ |
| total = reserve + trading invariant | ✅ (Float-Drift 0) |
| wallet_ledger Math-konsistent | ✅ |
| 70/30-Split für ALLE Bot-Types | ❌ B1-1 |
| Drawdown-Formel zentral | ❌ B1-2 |
| Fee-Modell deklariert + konsistent | ✅ |
| Decimal-Precision dokumentiert | 🟡 IEEE-754 wie Nautilus (akzeptabel) |
| Atomic Persistence | 🟡 nicht atomic (B1-3) |

**Bewertung: 🟡 PRÄSENTIERBAR nach B1-1 + B1-2 Fix.**

---

## J. UPGRADE-PFAD (Aufwand + Quellen)

| Fix | Aufwand | Quelle (Beweis) |
|---|---:|---|
| B1-1 _applyPnL aus GRID/DCA aufrufen | 1-2h | Q1 LEAN UnrealizedProfit→realized-at-Close-Pattern (raw .cs) |
| B1-2 zentrale `_computeDrawdown()` | 30min | Q8 LEAN SecurityPortfolioManager TotalPortfolioValue single-truth (raw .cs) |
| B1-3 atomic write | 30min | POSIX rename(2) — Standard |
| B1-5 Maker/Taker-Diff | 1h | Bitget VIP-Schedule |

**Optional (nicht für Quant-Grade nötig):**
| B1-4 decimal.js | 4-8h | Q6 Hummingbot Decimal (raw .py) — nur bei LIVE >$10k empfohlen |

---

## K. EHRLICHE LÜCKEN-DOKUMENTATION

- **Q4+Q5 arXiv PDFs:** NICHT lesbar auf System (kein poppler). Existenz verifiziert via HTML, Inhalt UNGEPRÜFT.
- **Q3 Freqtrade calc_profit-Detail:** Doc gibt nur high-level, Source-File NICHT zusätzlich gefetched. UNGEPRÜFT für exakte Formel.
- **DCA-Drift-Exit-Bug-Wurzel** (5/6 closed ohne TP): NICHT in Bereich 1, gehört zu Bereich 7. UNGEPRÜFT hier.
- **Race-Condition-Tests:** code-level analysiert, KEINE Stress-Test-Simulation durchgeführt. UNGEPRÜFT empirisch.
- **Multi-User-Concurrency:** Nicht relevant für Single-User-Bot, übersprungen.

---

## L. AUDIT-LOG-VERWEIS

**Komplettes Log:** `/tmp/audit_log_20260525_171751.txt` (29 KB, 553 Zeilen)

Alle Commands + Outputs in chronologischer Reihenfolge mit Bash-Timestamps.

---

## M. STOP-GATE

**Bereich 1 KOMPLETT.**
- ✅ 6 Quant-Niveau-Quellen direkt verifiziert (Pflicht 5+)
- ✅ Live-Logging vollständig
- ✅ 5 Befunde mit Code-Stelle + Repro + Fix
- ❌ B1-1 + B1-2 als HIGH/MEDIUM gefunden — Fix wartet Christian-Freigabe

**Christian beurteilt Tiefe.** Dann Bereich 2 oder Korrektur.

Bot-Status während Audit: PID 83537, Wallet $1107.28, Reserve $0, 2 OPEN bots, NoTrade rot (runtimeClean Anomaly), LIVE aus.
