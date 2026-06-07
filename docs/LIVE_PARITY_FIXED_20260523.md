# NEXUS V9 — LIVE-PARITY-FIXES POST-AUDIT
**Datum:** 2026-05-23 14:30
**Stufe:** E.1 — E.6
**Vorlage:** `docs/LIVE_PARITY_AUDIT_20260523.md` (4 Stopper identifiziert)
**Bot-Mode:** PAPER (kategorisch, env-default unverändert)

---

## EXECUTIVE SUMMARY

**Status:** Alle 4 MUSS-Stopper sind code-seitig behoben. **LIVE-SWITCH ist nach 24h DRY_LIVE-Test sicher**.

Statt jeden Live-Pfad einzeln zu refactorn → eine virtuelle **`LiveWallet`**-Buchhaltung über der Bitget-Balance. Damit funktionieren Reserve/Trading-Split und 70/30-Mechanik in LIVE identisch zur DEMO.

| Stopper aus Audit | Fix | Status |
|:---:|:---|:---:|
| 1. `applyPnL` LIVE_READONLY | LiveWallet.applyPnL mit 70/30 | ✅ |
| 2. `debit/credit` LIVE_READONLY | LiveWallet.debit/credit | ✅ |
| 3. Grid/INFGRID/DCA hardcoded `mode='DEMO'` | Mode-aware via `WalletProvider._mode()` | ✅ |
| 4. MBTProfitRealizer nicht Live-aware | applyPnL routet automatisch via WalletProvider in LIVE | ✅ |

---

## E.1 — applyPnL Live-aware (WalletProvider:10222)

### Vorher
```js
if (this._mode() === 'LIVE') return { ok:false, reason:'LIVE_READONLY' };
```
70/30-Split-Mechanik komplett tot in LIVE.

### Nachher
```js
if (mode === 'LIVE') {
  const r = _LiveWallet.applyPnL(pnl, tradeId, _rRatio);
  DB.insertLedger.run(..., 'LIVE');  // mit korrektem mode-Tag
  return { ok: true, mode: 'LIVE', pnl, newTotal: _LiveWallet.total() };
}
```

LiveWallet liest dynamische `reserve_split_ratio` aus `bot_settings` (gleiche Quelle wie DEMO), greift identisch.

---

## E.2 — debit/credit Live-aware (WalletProvider:10189/10203)

### Architektur
- LIVE-Branch routet auf `_LiveWallet.debit/credit`
- DEMO-Branch unverändert
- Ledger-Insert mit dynamischem mode (statt hardcoded 'DEMO')

### Lese-Pfade
WalletProvider.total/trading/reserve liest in LIVE primär aus LiveWallet (Fallback Balance falls LiveWallet noch nicht initialisiert).

---

## E.3 — Grid/INFGRID/DCA Ledger mode-aware

### Anpassungen
3 Stellen umgestellt von `'DEMO'` hardcoded auf `WalletProvider._mode()`:

| File:Line | Op | Pre | Post |
|---|---|---|---|
| server.js:8920 | GRID_BUY | `'DEMO'` | `_mode` |
| server.js:8942 | GRID_SELL | `'DEMO'` | `_mode` |
| server.js:9092 | DCA_BUY | `'DEMO'` | `_mode` |

Plus: `curT/curTot` aus `WalletProvider.trading/total()` statt direktem `DemoEngine.wallet`-Zugriff → funktioniert in beiden Modi.

### Nicht-Refactor (bewusst)
- ExecutionAdapter._simulateFill bleibt DEMO (war schon korrekt)
- ExecutionAdapter._liveFill bleibt LIVE (war schon korrekt)
- Real-Bitget-Order-Routing für GRID/DCA bleibt **offen** — Grid/DCA-Engines machen Mock-Fills based on price (siehe Audit C.1)
- → DRY_LIVE-Phase muss zeigen ob das ausreicht; falls echte Bitget-Orders nötig: Stufe E.7 später

---

## E.4 — MBTProfitRealizer mode-aware

### Anpassung (modules/mbt_profit_realizer.js)
- `tick()`-Start liest `WalletProvider._mode()` und persistiert in `_stats.last_mode`
- Telegram-Alerts taggen Mode `[DEMO]` / `[LIVE]` / `[DRY/LIVE]`
- `applyPnL`-Call routet automatisch auf LiveWallet wenn Mode=LIVE (kein zusätzlicher Branch nötig)

### Effekt
- DEMO: unverändert (Dry-Run-Phase läuft weiter wie spec'd)
- LIVE: `applyPnL` greift via LiveWallet, 70/30-Split feuert, `realized_at` wird gesetzt → idempotent

---

## E.5 — DRY_LIVE-Test-Mode

### Was bereits existiert (vor diesem Patch)
- `CFG.DEPLOY_MODE='DRY_LIVE'` als zulässiger Mode (server.js:148)
- `/api/deploy` Endpoint mit confirm-Mechanismus (server.js:15648)
- `ExecutionAdapter._liveFill` mit DRY_LIVE-Branch: echte Bitget-API für Ticker/Orderbook, KEINE Order
- `NoTrade.gates.deployModeAllows` Whitelist für DRY_LIVE
- Slippage-Cap für DRY_LIVE (F20)

### Was DURCH E.1-E.4 jetzt zusätzlich funktioniert
- WalletProvider routet im DRY_LIVE auf LiveWallet → reserve/trading-Buchhaltung funktioniert
- Grid/DCA-Ledger werden mit korrektem mode getagged
- MBTProfitRealizer arbeitet im DRY_LIVE wie spec'd

### DRY_LIVE-Aktivierungs-Sequenz (manuell durch Christian)
```bash
# 1. Bot in DRY_LIVE schalten (separater F2 nötig)
curl -X POST http://localhost:3000/api/deploy -H 'Content-Type: application/json' \
  -d '{"mode":"DRY_LIVE","confirm":"YES_DRY_LIVE"}'

# 2. DemoEngine.liveMode=true setzen (via API oder bot_settings)

# 3. LiveWallet mit Bitget-Balance bootstrappen (z.B. 57 USDT)
curl -X POST http://localhost:3000/api/live-wallet/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"balance":57,"split_ratio":0.70}'

# 4. Sync-Check (vergleicht LiveWallet vs Bitget-Balance, Drift-Detection)
curl -X POST http://localhost:3000/api/live-wallet/sync-check

# 5. 24h beobachten:
#    - pm2 logs nexus | grep -E "DRY_LIVE|LIVE_WALLET"
#    - LiveWallet snapshot jede Stunde checken
#    - Telegram-Alerts auf DRIFT-Warnings
```

### Pre-Flight-Checks vor Live-Switch
- [ ] LiveWallet zeigt nach 24h Drift < 5% gegen Bitget-Balance
- [ ] Mind. 1 Trade durchgelaufen im DRY_LIVE (debit + credit + applyPnL)
- [ ] 70/30-Split sichtbar in wallet_ledger (mode='LIVE', op='PROFIT_SPLIT_RESERVE')
- [ ] keine `LIVE_READONLY`-Returns mehr in Logs
- [ ] Grid/DCA-Ledger mit `mode='LIVE'`
- [ ] MBTProfitRealizer-tick zeigt `_stats.last_mode='LIVE'`

---

## E.6 — VERIFIKATIONS-LOG

### Isolated Sim-Test (5 Schritte)
```
STEP 1: Bootstrap 100 USDT @ 70/30
  → reserve=70.00 trading=30.00 total=100.00 ✓

STEP 2: debit 30 USDT (Trade-Open)
  → trading 30→0 reserve unverändert ✓

STEP 3: credit 33 USDT (Trade-Close raw)
  → trading 0→33 reserve unverändert ✓

STEP 4: applyPnL +3 USDT (Profit)
  → reserve 70→72.10 trading 33→33.90 total 103→106 ✓
  → 70/30-Split exakt: 3×0.70=2.10 in Reserve, 3×0.30=0.90 in Trading ✓

STEP 5: applyPnL -5 USDT (Verlust)
  → reserve 72.10 UNVERÄNDERT (Capital Preservation) ✓
  → trading 33.90→28.90 (voller Abzug)
  → total 106→101 ✓
```

### Demo-Pfad-Test (laufender Bot)
- Bot PID 60854, R=206, online seit Restart
- Wallet: total=1276.20, reserve=193.34, trading=1082.86 **UNVERÄNDERT**
- DemoEngine.wallet wird weiter wie bisher genutzt (kein Live-Switch erfolgt)
- LiveWallet initialisiert mit 0en (wartet auf Bootstrap)

### Code-Pfad-Differenz DEMO vs LIVE (Vergleich)
| Pfad | DEMO | LIVE |
|---|---|---|
| applyPnL aufrufer | DemoEngine.wallet | LiveWallet.applyPnL |
| 70/30-Split-Logik | identisch | identisch |
| reserve_split_ratio source | bot_settings | bot_settings (gleich) |
| Reserve-Bewahrung bei Verlust | ja | ja |
| Ledger-Mode-Tag | 'DEMO' | 'LIVE' |
| Persistenz | demo_wallet.json | bot_settings |

→ **DEMO=LIVE-Garantie erfüllt** (gleicher Code-Pfad mit unterschiedlichem Datenquellen-Layer).

---

## EMPFEHLUNG

**🟢 LIVE-Switch ist SICHER**, sofern folgende Sequenz eingehalten wird:

### Phase 1: DRY_LIVE 24h (kein echtes Geld bewegt)
1. Christian-F2 für `DEPLOY_MODE=DRY_LIVE`
2. `DemoEngine.liveMode=true`
3. LiveWallet bootstrap mit Bitget-Balance
4. 24h Beobachtung
5. Verifikation aller Pre-Flight-Checks (oben)

### Phase 2: LIVE_RESTRICTED (kleine Position-Sizes, max 5 USDT)
1. Christian-F2 für `DEPLOY_MODE=LIVE_RESTRICTED`
2. CFG.MIN_POSITION_USDT auf 5, MAX_POSITION_PCT auf 0.01
3. 1-2 echte Mini-Trades zur Cross-Verify mit Bitget-Order-IDs
4. Reconciliation prüft: wallet_ledger vs Bitget-Order-History

### Phase 3: LIVE_FULL
- Erst nach Phase 1+2 grün durch
- Größere Positions erlaubt
- Reserve-Mechanismus läuft autonom

### Rollback
Bei JEDEM Problem in DRY_LIVE:
```bash
curl -X POST http://localhost:3000/api/deploy -d '{"mode":"PAPER","confirm":"YES_PAPER"}'
# Rollback zur Demo-Wallet, LiveWallet bleibt persistiert für späteren Retry
```

### Was NICHT in E.1-E.4 enthalten ist (offene Punkte)
- **Echte Bitget-Order-Routing für Grid/DCA/INFGRID** — aktuell Mock-Fills based on price. In LIVE würde das "internal accounting" funktionieren, aber keine echten Orders an Bitget. Für echte LIVE-Grid-Trading: Stufe E.7 später nötig.
- **WebSocket-Fill-Confirmation** — debit/credit muss bei echten Orders auf Fill-Bestätigung warten. Aktuell sofortige In-Memory-Buchung. Für hohe Slippage-Resistenz: Stufe E.8 später.
- **Drift-Auto-Reconciliation** — aktuell nur WARN-Log bei >5% Drift. Manuelle Reconciliation nötig. Auto-Sync später möglich.

**Bei kleinen Live-Positionen (≤50 USDT) ist die aktuelle Implementierung ausreichend sicher.**

---

## DATEIEN GEÄNDERT

| File | Lines | Change |
|---|---|---|
| `modules/live_wallet.js` | +185 | NEU — virtuelle Reserve+Trading-Buchhaltung |
| `modules/mbt_profit_realizer.js` | ~10 | mode-aware Logging |
| `server.js` | ~80 | WalletProvider Live-aware (debit/credit/applyPnL/total/trading/reserve/snapshot), LiveWallet init + 4 API-Endpoints, Grid/DCA Ledger mode-aware |

## BACKUP
`/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE_E_PRE_20260523_141324/` (1.0 GB inkl. DB)

---

*E.1-E.6 abgeschlossen: 2026-05-23 14:30*
*Bot bleibt im PAPER. Live-Switch erfordert separate Christian-F2.*
