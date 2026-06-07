# PUNKT 1 — WALLET DISK-SYNC + WERT-WAHRHEIT

**Erstellt:** 25.05.2026 (Quant-Niveau-Audit nach Christian-Direktive)
**Status:** Read-only Forensik, kein Patch

---

## 1. QUANT-NIVEAU RESEARCH

### Konsens der Pro-Engines

| Engine | Single Source of Truth | Persistence-Pattern |
|---|---|---|
| **QuantConnect LEAN** (`SecurityPortfolioManager.cs`) | Memory (`_totalPortfolioValue`, `CashBook`) | **Memory-only** in der Klasse, keine Disk-I/O. Invalidation-Pattern: `ProcessFills() → InvalidateTotalPortfolioValue() → lazy recompute`. Persistence im Parent-Algorithm-Context |
| **NautilusTrader** | `Cache` als Runtime SSOT | "Critical state persisted externally when configured" — **Crash-Only-Design**, Startup-Path == Crash-Recovery-Path. Event-Sourcing via `AccountState`-Events |
| **Freqtrade** | SQLite (`tradesv3.dryrun.sqlite`) | **Trades persistent, Wallet NICHT.** Wallet wird beim Boot aus Trade-History **rebuilt** |
| **Hummingbot** | Memory (PaperTradeExchange) | Snapshot-Details: **UNBEKANNT** (nicht öffentlich detailliert dokumentiert) |
| **Lopez de Prado AFML** | — | Spezifisches MTM-Reconciliation-Kapitel: **UNBEKANNT** (nicht öffentlich im Detail) |

### Best-Practice-Pattern (Konsens)
1. **Memory = Truth, Disk = Backup** (LEAN, Nautilus)
2. **Lazy Invalidation** statt eager re-compute (LEAN)
3. **Event-Sourcing oder Snapshot-at-Critical-Change** (Nautilus)
4. **Rebuild aus Event-Log möglich** (Freqtrade-Trade-History)

### Quellen
- [QuantConnect LEAN — SecurityPortfolioManager.cs](https://github.com/QuantConnect/Lean/blob/master/Common/Securities/SecurityPortfolioManager.cs)
- [NautilusTrader Architecture](https://nautilustrader.io/docs/latest/concepts/architecture/)
- [Freqtrade Configuration & Wallet](https://www.freqtrade.io/en/stable/configuration/)
- [Freqtrade DryRunWallet Issue #2421](https://github.com/freqtrade/freqtrade/issues/2421)
- [Freqtrade Persistence Issue #2061](https://github.com/freqtrade/freqtrade/issues/2061)
- [Hummingbot Paper Trade Docs](https://hummingbot.org/client/global-configs/paper-trade/)
- [Lopez de Prado AFML SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3104847)

---

## 2. CODE-AUDIT NEXUS V9

### A) Disk-I/O — wann wird `demo_wallet.json` geschrieben?

**Datei:** `data/demo_wallet.json` (`WALLET_PATH` Z.24252)

**`_persistWallet()`** (Z.24253) — synchroner `fs.writeFileSync(JSON.stringify(this.wallet))`

**Aufrufer (9 Stellen):**
| Z. | Kontext | Trigger |
|---:|---|---|
| 5774 | Nach Trade-Close (SINGLE) | event-getrieben |
| 10355 | Wallet-Mutation `_debit` | event-getrieben |
| 10378 | Wallet-Mutation `_credit` | event-getrieben |
| 10451 | nach `_applyPnL`-Update | event-getrieben |
| 14600 | API-Endpoint `/api/demo/wallet/...` | manuell |
| 18955 | Reset-Endpoint | manuell |
| 25277 | DemoEngine `_cycle` Wallet-Sync | jeder Cycle (~5s) |
| 25316 | DemoEngine stop() | bei Bot-Stop |

### B) BUG IDENTIFIZIERT — `peakTotal`-Drift

**Z.4886-4889** (`KillSwitch.check()`):
```js
if (isDemo) {
  if (eq > peakRef) {
    try { DemoEngine.wallet.peakTotal = eq; } catch(_) {}  // ← MEMORY-WRITE
    peakRef = eq;
  }
}
```

→ `peakTotal` wird in-memory aktualisiert mit `eq = effectiveTotal = total + unrealized`
→ **KEIN `_persistWallet()`-Call hier!**

**Konsequenz:**
- Disk-`peakTotal` = $1327.55 (letzter wirklicher Persist-Trigger)
- Memory-`peakTotal` = $2142.18 (durch laufende KillSwitch-Checks aktualisiert)
- **Drift: $814.63**

### C) Memory-State-Mutation `DemoEngine.wallet.*`

| Field | Code-Quelle | Mutiert in |
|---|---|---|
| `total` | Z.24237 `1000` initial | `_applyPnL` (Z.10449), `_debit`/`_credit` (Z.10354/10376) |
| `trading` | Z.24237 `1000` initial | gleiche Stellen wie total |
| `reserve` | Z.24237 `0` initial | nur durch Profit-Split (kein RESERVE-Eintrag in 24h) |
| `peakTotal` | Z.24237 `1000` initial | **Z.4887 KillSwitch (OHNE _persistWallet)**, Z.10450, Z.24278 |
| `pnl` | accumulated | `_applyPnL` |
| `dailyPnl` | reset 00:00 | `_applyPnL`, Daily-Cron |

---

## 3. DIE 6 WALLET-WERTE — DEFINITION

| Wert | Wo | Formel | Aktueller Wert | Was bedeutet er |
|---|---|---|---:|---|
| **`total`** | `DemoEngine.wallet.total` | Wallet-Cash-Topf (Trading + Reserve) | **$1276.13** | Cash der dem Bot intern gehört. UNVERÄNDERT bei MBT-Trades weil DCA/Grid kein Cash abziehen |
| **`peakTotal` (Disk)** | `demo_wallet.json.peakTotal` | letzter Disk-Persist-Wert | $1327.55 | Veralteter Snapshot (Disk-Drift!) |
| **`peakTotal` (Memory)** | `DemoEngine.wallet.peakTotal` | höchster `effectiveTotal` je gesehen | **$2142.18** | Memory-aktuell, NICHT persistiert |
| **`effectiveTotal`** | `getEffectiveDemoEquity()` Z.10600 | `total + unrealized.total` | $2473.38 | Cash + Mark-to-Market der OPEN Grids/DCAs |
| **`vermoegenStat` (UI "IST")** | `public/index.html:4118` | `safe + reinv + imMarkt` = `$193 + $1082 + $150` | **$1426.13** | Cash-Topf + Hard-Committed-Capital. Christian's "$1426 IST" |
| **`vermoegenLive` (UI "LIVE")** | `public/index.html:4119` | `vermoegenStat + unrealized` = `$1426 + $1197` | **$2623.38** | UI-Anzeige inkl. Unrealized. Christian's "$2207 LIVE" — Schwankung in der Zeit (war vor 1h $866 unrealized = $2292) |
| **`portfolio.totalEquity`** | `/api/bots/dashboard` | `effectiveTotal + realizedAllSinceReset` ? | **$2627.12** | Aggregat aller Dashboard-Komponenten |
| **`realizedAllSinceReset`** | `portfolio.realizedAllSinceReset` | SUM(strategy_regime_performance.pnl_usdt) seit Day-Zero | **$1477.19** | Realized PnL der Grid-Fills |
| **`unrealizedPnl`** | `portfolio.unrealizedPnl` | `computeUnrealizedPnLMBT()` mark-to-market | **$1197.25** | Aktueller MTM der 3 offenen Bots |

### Wer ist der "Wahrheits-Wert"?

**Es gibt 3 EHRLICHE Werte, jeder mit anderem Scope:**

1. **`$1276.13` (Wallet-Cash-Topf)** — was im "Geldbeutel" liegt, sofort abrufbar
2. **`$1426.13` (Vermögen-IST)** — Cash + hartes Committed-Capital (50 USDT pro Bot × 3 Bots = $150 zugesichert)
3. **`$2473.38` (effectiveTotal)** — Cash + Mark-to-Market alle offenen Positionen

→ **Welcher Wert "der wahre" ist hängt vom Use-Case ab** (Quant-Standard).

### Christian's verwirrender UI-Mix
- "$1276" = Cash-only (zu konservativ)
- "$1426" = Vermögen mit Committed (UI default)
- "$2207" = Vermögen mit Unrealized (UI live, schwankend)
- Discrepanzen sind **NICHT BUG** — verschiedene legitime Definitionen

---

## 4. ECHTE BUGS IDENTIFIZIERT

### Bug #1: `peakTotal`-Disk-Drift (KRITISCH)
- **Symptom:** Disk $1327 vs Memory $2142 = $815 Drift
- **Code:** Z.4886-4889 `KillSwitch.check()` setzt `peakTotal` in-memory, vergisst `_persistWallet()`
- **Risiko:** Bei PM2-Restart wird `peakTotal=$1327` geladen → DD-Berechnung verfälscht
  - DD = (peak - total) / peak
  - Mit peak=$1327: DD = ($1327 - $1276) / $1327 = **3.87%** ← was wir aktuell sehen
  - Mit peak=$2142 (real): DD = ($2142 - $1276) / $2142 = **40.4%** ← würde KillSwitch triggern!
- **Hinweis:** KillSwitch arbeitet aber MIT peakTotal=memory, also aktuell sicher. Aber nach Restart wäre `peakTotal=$1327` aus Disk → trivial-niedriger DD-Wert → falsche Sicherheit
- **Quant-Niveau-Fix:** Memory ist SSOT, Disk-Persist bei jedem `peakTotal`-Update (Nautilus-Pattern) ODER bei Crash-Recovery Memory rebuilt aus `strategy_regime_performance` (Freqtrade-Pattern)

### Bug #2: `dailyStart` Disk-Drift
- `dailyStart` (auf Disk: $1276.13 vom 00:02) sollte täglich um Mitternacht resettet werden
- Aktuell: passt zufällig, weil Day-Start gestern 00:02 = $1276 ≈ heute $1276
- Aber wenn realized PnL in Wallet einbucht (was nicht passiert weil GRID-Profits in `profit_acc` separat), wäre `dailyPnl` falsch

### Nicht-Bug: $1426 IST + $2207 LIVE Diskrepanz
- Sind verschiedene Sichten — wie LEAN's `Cash` vs `TotalPortfolioValue`
- UI sollte beide klar labeln (macht sie teilweise mit "IST" / "Vermögen GESAMT")

---

## 5. EMPFEHLUNG

### Fix (minimal-invasiv, Quant-Niveau, Pattern aus LEAN+Nautilus):

**Patch 1 — Z.4886-4889:** `_persistWallet()` nach `peakTotal`-Update
```js
if (eq > peakRef) {
  try { DemoEngine.wallet.peakTotal = eq; } catch(_) {}
  try { DemoEngine._persistWallet(); } catch(_) {}  // NEU: Disk-Sync
  peakRef = eq;
}
```

**Risiko:** 🟢 niedrig — synchronous fs.writeFileSync auf ~1.5 KB JSON, alle ~5s wenn neuer Peak. Performance-Impact vernachlässigbar.

**Patch 2 (optional):** UI-Label-Klarheit
- `cap-total` (UI) heißt heute "VERMÖGEN" — sollte als "Vermögen IST (Cash + Committed)" labeled werden
- Zusätzliche Zeile "Vermögen LIVE (mit Unrealized)" daneben

### NICHT empfohlen
- Wallet-Schema komplett umbauen (zu riskant, Wallet ist Single-Source seit Day-Zero)
- LEAN's `_isTotalPortfolioValueValid`-Pattern hier importieren (Komplexitäts-Overhead, nicht nötig)

---

## 6. ANTWORTEN AUF CHRISTIAN'S FRAGEN

| Frage | Antwort |
|---|---|
| Welcher der 6 Wallet-Werte ist Wahrheit? | **Alle 6 sind richtig** — jeder mit anderem Scope. Cash=$1276, IST=$1426, LIVE=$2207/$2473/$2627 sind verschiedene legitime Definitionen |
| Wo schreibt Disk, wann? | `_persistWallet` Z.24253, 9 Aufrufer. Triggert event-getrieben + jeder Bot-Cycle (Z.25277). **ABER:** vergisst peakTotal-Update aus KillSwitch |
| Wo lebt Memory-State? | `DemoEngine.wallet.*` Z.24232+ |
| Warum peakTotal Disk $1327 vs Memory $2118? | **BUG:** KillSwitch.check() Z.4887 setzt peakTotal in-memory bei neuem high, ruft aber `_persistWallet()` NICHT auf → Disk hinkt hinterher |
| Definition pro Wert? | Tabelle in Abschnitt 3 oben |
| Welche Funktion → UI-Stelle? | `getEffectiveDemoEquity` → UI `cap-total` (Vermögen). UI berechnet zusätzlich `vermoegenStat` (Z.4118) + `vermoegenLive` (Z.4119) lokal |

---

**Status:** Read-only Audit komplett. **Christian-Freigabe für Fix-Patch nötig.**

**Vorschlag-Reihenfolge:**
1. Backup `server.js`
2. Patch 1 (`_persistWallet` nach peakTotal-Update) deployen
3. Verify Disk-Memory-Konsistenz nach Restart
4. **DANN** weiter zu Punkt 2 (Realized vs Unrealized Double-Counting)
