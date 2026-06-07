# NEXUS V9 — LIVE-PARITY-AUDIT
**Datum:** 2026-05-23 13:35
**Stufe:** NACHTRAG-A · TEIL 2 (read-only)
**Methodik:** Code-Inspektion server.js + modules/ + execution paths
**Aktueller DEPLOY_MODE:** `PAPER` (kategorisch, env-gesteuert)
**Aktueller DemoEngine.liveMode:** `false`

---

## EXECUTIVE SUMMARY

**Verdict:** 🔴 **LIVE-SWITCH IST NICHT SICHER.**
Demo↔Live haben **4 KRITISCHE DIFFERENZEN** (Live-Schalt-Stopper) + **3 leichte Abweichungen**.
Aktuell ist PAPER kategorisch geschützt → keine akute Gefahr.
**Mindestens 4 Code-Fixes** sind nötig, BEVOR ein LIVE-Switch verantwortbar wäre.

| # | Bereich | Severity | Status |
|--:|---|:-:|:-:|
| 1 | WalletProvider.applyPnL blockt LIVE (`LIVE_READONLY`) | 🔴 | Stopper |
| 2 | WalletProvider.debit/credit blockt LIVE (`LIVE_READONLY`) | 🔴 | Stopper |
| 3 | Grid/INFGRID/DCA-Engines hardcoded `mode='DEMO'` in Ledger | 🔴 | Stopper |
| 4 | MBT-Profit-Realizer-Cron nicht Live-aware | 🔴 | Stopper |
| 5 | Reserve-70/30-Split lebt komplett auf `DemoEngine.wallet` | 🟡 | Funktionslos LIVE |
| 6 | Grid/DCA mutieren direkt `DemoEngine?.wallet?.trading` | 🟡 | Inkonsistent LIVE |
| 7 | `_executeTrade` Order-Routing via ExecutionAdapter | 🟢 | OK (sauber gekapselt) |

---

## A) MODUS-DETECTION-MAPPING

### Aktuelle Quelle der Wahrheit

| Quelle | Wert | Verwendung |
|---|---|---|
| `process.env.DEPLOY_MODE` | `'PAPER'` (default) | Init-Zeit, einmal gelesen in CFG.DEPLOY_MODE |
| `CFG.DEPLOY_MODE` | `'PAPER'` | runtime-konstant, gates DRY_LIVE / LIVE in ExecutionAdapter |
| `DemoEngine.liveMode` | `false` (Z.23441) / `true` (Z.23432) | Wallet-Routing in WalletProvider._mode() |
| `WalletProvider._mode()` | `liveMode ? 'LIVE' : 'DEMO'` | Innen-Schalter für ALLE Wallet-Mutationen |

### Mode-Switch-Pfad
1. `process.env.DEPLOY_MODE='LIVE'` → restart bot
2. `DemoEngine.liveMode = true` setzen (Z.23432)
3. Ab dann `_mode() === 'LIVE'` → **alle applyPnL/debit/credit Calls returnen LIVE_READONLY**

### Befund
🟡 **Drei verschiedene Modus-Quellen** (env, CFG, DemoEngine.liveMode) ohne zentralen Sync. Ein Live-Switch erfordert beide manuell (env + liveMode). **Pre-Flight-Punkt:** Single-Source-of-Truth einführen (z.B. `CFG.DEPLOY_MODE` lesen DemoEngine.liveMode automatisch).

---

## B) WALLET-LOGIK DEMO vs LIVE

### B.1 WalletProvider._mode() Routing
```js
// server.js Z.~10180
_mode() {
  return (typeof DemoEngine !== 'undefined' && DemoEngine.liveMode === true) ? 'LIVE' : 'DEMO';
}
```

### B.2 KRITISCHER GUARD: applyPnL (Z.10222)
```js
applyPnL(pnl, reason) {
  if (this._mode() === 'LIVE') return { ok:false, reason:'LIVE_READONLY' };
  // ... 70/30-Split nur in DEMO ...
}
```
**Konsequenz:** In LIVE-Mode wird **kein PnL ins Wallet eingebucht** — der gesamte 70/30-Split-Mechanismus ist **funktionslos**.

### B.3 KRITISCHER GUARD: debit/credit (Z.10189/10203)
```js
debit(amount, ref) {
  if (this._mode() === 'LIVE') return { ok:false, reason:'LIVE_READONLY' };
  ...
}
credit(amount, ref) {
  if (this._mode() === 'LIVE') return { ok:false, reason:'LIVE_READONLY' };
  ...
}
```
**Konsequenz:** Order-Margin-Allokation (debit) und Margin-Rückgabe (credit) **funktionieren in LIVE NICHT**.

### B.4 LIVE-Wallet-Quelle
- `Balance.usable` (Z.5602) wird in LIVE direkt mutiert: `Balance.usable=Math.max(0,Balance.usable+pnl)`
- Dieses Update ist eine **lokale Approximation**, nicht synchron mit Bitget-Server-Balance
- Kein Reserve-Konzept, kein 70/30-Split

### Bewertung
🔴 **Stopper.** Wallet-Logik in LIVE ist **rudimentär** und ignoriert die zentrale 70/30-Architektur.

---

## C) GRID / DCA / INFGRID IN LIVE

### C.1 GridBotMBT
- Ledger-Inserts: hardcoded `mode='DEMO'` (statt dynamisch aus _mode())
- Wallet-Mutation: direkt auf `DemoEngine?.wallet?.trading` (in LIVE = undefined)
- **KEIN echter Bitget-Order-Call** in der Grid-Engine — sie macht Mock-Fills auf Price-Bewegung
- In LIVE würde Grid trotzdem Mock-Fills "buchen", aber Bitget hat keine echte Position → **Ghost-Trades**

### C.2 INFGRID
- Identisches Pattern wie GridBotMBT
- Selbe Mock-Fill-Logik, hardcoded `mode='DEMO'`

### C.3 DCABotMBT.scheduledBuy (Z.9091)
```js
const curT = (DemoEngine?.wallet?.trading) || 0;
const curTot = (DemoEngine?.wallet?.total) || 0;
DB.insertLedger.run(Date.now(), 'DCA_BUY', buyUsdt,
  `DCA ${d.symbol} Iter ${newIter} ...`,
  dca_id, curT, curT, curTot, curTot, 'DEMO');  // ← HARDCODED 'DEMO'
```
- In LIVE würde `DemoEngine.wallet` undefined sein → `curT=0, curTot=0` → **Ledger-Werte falsch**
- Buy wird "intern gebucht", aber kein Bitget-Call → **DCA macht in LIVE 0 echte Trades**, aber DB suggeriert offene Position

### Bewertung
🔴 **Stopper.** Grid + INFGRID + DCA sind **DEMO-only-Module**. Live-Schaltung würde Ghost-Trades produzieren (DB hat Positionen, Bitget nicht).

---

## D) RESERVE-SPLIT IN LIVE

### D.1 Wo lebt die 70/30-Logik?
- `WalletProvider.applyPnL` (Z.10222) — gated mit LIVE_READONLY
- `DemoEngine.wallet.{total,reserve,trading}` — In-Memory + `data/demo_wallet.json`
- `CFG.RESERVE_RATIO=0.70` + `bot_settings.reserve_split_ratio` (override)

### D.2 LIVE-Equivalent?
**Existiert NICHT.** In LIVE:
- Kein `LiveWallet`-Modul
- Kein Reserve-Konzept
- Kein Profit-Split-Mechanismus
- Bitget-Account kennt nur `available`/`locked` für Spot, kein Hierarchie-Konzept

### D.3 Was würde passieren beim Switch?
- DEPLOY_MODE='LIVE' → applyPnL liefert nur noch `{ok:false, reason:'LIVE_READONLY'}`
- Reserve bleibt eingefroren auf dem letzten DEMO-Stand (193.34 USDT)
- Trading-Balance wird nicht mehr aus PnL gespeist
- **70/30-Mechanik ist tot in LIVE**

### Bewertung
🔴 **Stopper.** Reserve-Split ist eine reine Demo-Konstruktion. Für LIVE braucht es entweder (a) eigenes Live-Wallet-Modul mit virtueller Reserve-Buchhaltung ODER (b) Bitget-Sub-Account-Architektur (außerhalb Code).

---

## E) SCHWELLEN-PARITÄT

### E.1 Trade-Entscheidungs-Schwellen
| Schwelle | DEMO | LIVE | Identisch? |
|---|:-:|:-:|:-:|
| `CFG.SCORE_FLOOR=0.08` | ✅ | ✅ | ja (CFG-konstant) |
| `CFG.CONSENSUS_MIN=2` | ✅ | ✅ | ja |
| `CFG.CONFIDENCE_FAMILY_MIN=0.05` | ✅ | ✅ | ja |
| RiskSizing-Schwellen | ✅ | ✅ | ja (gleiche CFG) |
| Brain-Veto-Bedingungen | ✅ | ✅ | ja |
| HMM-Regime-Klassifikation | ✅ | ✅ | ja |
| Aladdin-Hard-Blocks (4 stk) | ✅ | ✅ | ja |

### E.2 Decision-Path
Identisch — `_cycle` ruft `UnifiedScore.compute() → AladdinBrain.decide() → BrainVeto → RiskSizing` **vor** Modus-Branch.

### Bewertung
🟢 **identisch.** Decision-Pipeline ist sauber zentralisiert. CLAUDE.md Regel 1 (EIN CODE-PFAD) erfüllt.

---

## F) ENGINE-DIFFERENZEN — ExecutionAdapter

### F.1 _simulateFill (DEMO)
- Orderbook-walk für realistische Slippage
- Latency-Sim 50-200ms
- Taker-Fee 0.06% / Maker-Fee 0.02%
- Partial-Fill-Sim
- OrderID-Prefix `DEMO_`

### F.2 _liveFill (LIVE)
- **DRY_LIVE-Mode (CFG.DEPLOY_MODE='DRY_LIVE'):** echte Bitget-API-Calls für Ticker+Orderbook, ABER **kein `placeSpotOrder`** → Connectivity-Test ohne Geld-Risiko
- **LIVE-Mode (CFG.DEPLOY_MODE='LIVE'):** Code-Path existiert für echte Bitget-Order, aber muss separat F2-aktiviert werden

### F.3 Symmetrie
Single-Trades (`SINGLE`/`UNIFIED`) durchlaufen ExecutionAdapter sauber. Grid/DCA/INFGRID NICHT (siehe C).

### Bewertung
🟢 **OK für SINGLE.** 🔴 **gebrochen für GRID/DCA/INFGRID.**

---

## G) BACKFILL-FRAGE (Reserve-Stand bei Live-Switch)

### Aktuelle Position
- DEMO-Wallet: `total=1276.20, reserve=193.34, trading=1082.86`
- Reserve ist **Demo-virtuell** (resident nur in `data/demo_wallet.json`)

### Bei Live-Switch:
- Bitget-Account hat **eigene Balance** (ca. 57 USDT laut V14-Notiz)
- `data/demo_wallet.json` wird in LIVE **ignoriert**
- Reserve-Stand 193.34 USDT ist **NICHT real auf Bitget**
- `Balance.usable` startet leer und wird über Bitget-API gefüllt

### Optionen für Live-Reserve
1. **Manuelle Bitget-Sub-Account-Anlage** (außerhalb Code, Christian-Eingriff)
2. **Virtuelle Live-Reserve** im Code (neues Modul `LiveWallet` mit eigener JSON-Persistenz)
3. **Reserve aufgeben in LIVE** (nicht empfohlen, Capital-Preservation verloren)

### Bewertung
🟡 **Architekturentscheidung nötig** vor Live-Schaltung.

---

## H) DAILY-CRON-PROFIT-REALIZER IN LIVE

### Code-Status (modules/mbt_profit_realizer.js)
- Cron tickt alle 30s, feuert 23:55 lokal
- `_dry_run=true` (Stufe C.3, bis 7-Tage-Verify durch)
- Productive-Path Z.97: `this._walletProvider.applyPnL(pending.total, ...)`
- **Kein `DemoEngine.liveMode`-Check**

### Verhalten in LIVE
- `applyPnL` returnt `{ok:false, reason:'LIVE_READONLY'}`
- Realizer-Code Z.114: `this._stats.errors++; Log.warn('applyPnL returned not-ok')`
- → **Realize läuft NIE durch in LIVE, error-counter steigt täglich**
- `realized_at` bleibt NULL → bei jedem Cron-Tick **gleiches Delta** akkumuliert → Telegram-Spam

### Bewertung
🔴 **Stopper.** Cron würde in LIVE entweder (a) silent-failen oder (b) bei späterer applyPnL-Fix doppelt-buchen, weil `realized_at` nie gesetzt wurde.

---

## I) RISIKEN-MAPPING

| Risiko | Wahrscheinlichkeit bei Live-Switch | Impact | Mitigation |
|---|:-:|:-:|---|
| Reserve-Logik tot → keine Capital-Preservation | 100% | 🔴 hoch | Fix #1+#2 (applyPnL/debit/credit LIVE-aware) |
| Ghost-Trades durch Grid/DCA-Mock-Fills | 100% | 🔴 hoch | Grid/DCA komplett LIVE-deaktivieren ODER auf ExecutionAdapter umbauen |
| Ledger hardcoded 'DEMO' → Audit-falsche Mode-Markierung | 100% | 🟡 mittel | `mode` aus `_mode()` ableiten |
| MBT-Realizer Telegram-Spam | 100% | 🟡 mittel | `if (DemoEngine.liveMode) return;` am Anfang von tick() |
| `data/demo_wallet.json` als Stale-Quelle | 50% | 🟢 niedrig | klar dokumentieren — JSON wird in LIVE ignoriert |
| Schwellen-Drift Demo vs Live | 5% | 🟢 niedrig | bereits zentralisiert via CFG |
| 1276 USDT Reserve-Show im UI während LIVE | 100% | 🟡 mittel | UI braucht Live-Mode-Banner + "Reserve = Demo-virtuell" |
| Profit-Realizer Doppel-Buchung bei Mode-Flip-Flop | 30% | 🔴 hoch | `realized_at`-Marker mit `mode`-Spalte erweitern |
| Bitget-API-Fail im LIVE-cycle → kein Fallback | 20% | 🟡 mittel | Circuit-Breaker für N-Fail-Retries |
| ConsistencyGuardian erkennt Live-DEMO-Drift nicht | 80% | 🟡 mittel | Guardian Live-aware machen |

---

## J) PRE-FLIGHT-CHECKLISTE VOR LIVE-SWITCH

### MUSS-Fixes (Stopper-Beseitigung)
- [ ] **Fix 1: WalletProvider Live-aware machen** — applyPnL/debit/credit dürfen in LIVE nicht silent-failen, sondern entweder (a) auf Bitget-Account-Balance routen ODER (b) eigene virtuelle Live-Wallet-Buchhaltung führen. Reserve-Split-Mechanik in LIVE erhalten.
- [ ] **Fix 2: Grid/INFGRID/DCA-Ledger-Mode dynamisch** — `'DEMO'` durch `WalletProvider._mode()` ersetzen in allen `DB.insertLedger.run()`-Calls.
- [ ] **Fix 3: Grid/DCA/INFGRID Live-Path bauen oder hart deaktivieren** — entweder ExecutionAdapter-Integration für echte Bitget-Orders ODER `if (DemoEngine.liveMode) return {skip:'GRID_NOT_LIVE_READY'}` als Schutz.
- [ ] **Fix 4: MBTProfitRealizer Live-aware** — `tick()`-Start: `if (typeof DemoEngine !== 'undefined' && DemoEngine.liveMode) { Log.info('MBT_REALIZER', 'skip in LIVE'); return; }`

### SOLL-Fixes (Architektur-Sauberkeit)
- [ ] **Fix 5: Single-Source-of-Truth für Modus** — `DemoEngine.liveMode` aus `CFG.DEPLOY_MODE === 'LIVE'` ableiten (kein 2-Schalter-Problem).
- [ ] **Fix 6: Live-Wallet-Modul** mit eigener JSON-Persistenz (`data/live_wallet.json`) und Reserve-Split-Buchhaltung.
- [ ] **Fix 7: UI-Banner "LIVE-MODE"** — Dashboard-Hinweis "💸 ECHTES GELD, Reserve = virtuell" wenn `_mode()==='LIVE'`.
- [ ] **Fix 8: ConsistencyGuardian Live-aware** — Bitget-Balance gegen In-Memory-Live-Wallet abgleichen statt Demo-JSON.

### Pre-Flight-Verifikation (nach Fix 1-4)
- [ ] DRY_LIVE-Run 24h mit DEPLOY_MODE='DRY_LIVE' → Ticker/Orderbook-Calls real, keine Order, alle Pfade getestet
- [ ] CLAUDE.md Regel 4 ausführen: Sim-Test PAPER vs DRY_LIVE → Diff=0 außer Order-Send-Block
- [ ] Telegram-Alert-Test: Live-Mode-Boot-Telegram mit "🔴 LIVE AKTIVIERT" + Reserve-Status
- [ ] Bitget-Account-Min-Balance verifizieren (≥ 100 USDT empfohlen)
- [ ] Rollback-Pfad getestet: `DEPLOY_MODE=PAPER` + Restart → alles auf Demo zurück
- [ ] 1 manueller Mini-Trade (≤ 5 USDT) in LIVE → ledger-Eintrag + Bitget-Order-ID cross-verify

---

## EMPFEHLUNG

🔴 **LIVE-SWITCH IST AKTUELL NICHT SICHER.**

Aktuell ist PAPER kategorisch geschützt (env-default), daher **keine akute Gefahr**. Aber ein Live-Switch heute würde:
1. Den **70/30-Reserve-Mechanismus** komplett deaktivieren (Capital-Preservation verloren)
2. **Ghost-Trades** durch Grid/DCA produzieren (DB ≠ Bitget)
3. Den **Profit-Realizer-Cron** silent-fail oder Telegram-Spam erzeugen
4. **Ledger-Audit** korrupt machen (mode='DEMO' für Live-Trades)

**Verantwortbare Sequenz für Live-Aktivierung:**
1. Fix 1-4 implementieren (geschätzt: 1-2 Tage Engineering + Audit)
2. SOLL-Fix 5-7 ergänzen für Architektur-Sauberkeit (geschätzt: 1 Tag)
3. 24h DRY_LIVE-Run + CLAUDE.md-Verify-Doc
4. 1 manueller Mini-Trade (5 USDT) → cross-verify Bitget
5. Christian-F2 explizit für `DEPLOY_MODE=LIVE` + `DemoEngine.liveMode=true`

**Bis dahin:** `DEPLOY_MODE=PAPER` halten. Demo läuft sauber, ist 1:1 testbar, ist nicht-destruktiv.

---

## ANHANG — VERIFIZIERTE CODE-STELLEN

| Befund | Datei | Zeile |
|---|---|---:|
| CFG.DEPLOY_MODE from env | server.js | 148 |
| WalletProvider._mode() | server.js | ~10180 |
| WalletProvider.debit LIVE_READONLY | server.js | 10189 |
| WalletProvider.credit LIVE_READONLY | server.js | 10203 |
| WalletProvider.applyPnL LIVE_READONLY | server.js | 10222 |
| ExecutionAdapter._simulateFill | server.js | 10729 |
| ExecutionAdapter._liveFill (DRY_LIVE branch) | server.js | 10731+ |
| Balance.usable LIVE-Update | server.js | 5602 |
| DCABotMBT hardcoded mode='DEMO' | server.js | ~9091 |
| DemoEngine.liveMode setter true | server.js | 23432 |
| DemoEngine.liveMode setter false | server.js | 23441 |
| MBTProfitRealizer.tick (productive applyPnL) | modules/mbt_profit_realizer.js | 97 |
| MBTProfitRealizer kein Live-Check | modules/mbt_profit_realizer.js | 59-93 |

---

*Audit abgeschlossen: 2026-05-23 13:35*
*Quellen: server.js (read-only grep + sed), modules/mbt_profit_realizer.js (full read), CLAUDE.md (Regel-Konsistenz-Check)*
*Bot-State während Audit: PID 35906, R=196, PAPER, Wallet 1276.20 stabil*
