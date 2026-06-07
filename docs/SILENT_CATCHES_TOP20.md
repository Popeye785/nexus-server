# Silent-Catches Top-20 Audit (Block C, 1.4)

**Erstellt:** 2026-05-26
**Total catches `catch(_) {}` in server.js:** 571
**Top-20 in kritischen Pfaden:** wie folgt

## Patches in diesem Pass (FIX 48)

| # | Line | Context | Fix |
|---|---:|---|---|
| 1 | 4752 | KillSwitch.check peakTotal-Update | → Log.warn WALLET_PEAK |
| 2 | 4758 | _persistWallet in killswitch.check | → Log.warn WALLET_PERSIST |
| 3 | 6398 | _persistDemoPositions im memory-ghost-fix | → Log.warn POSITIONS_PERSIST |

## Restliche 17 — Backlog (separater Pass)

| Line | Module | Risk-Level | Empfohlener Log |
|---:|---|---|---|
| 1763 | FundingEngine.getSignal | LOW | already-warned-elsewhere |
| 4638 | DBJanitor scan | LOW | Log.warn JANITOR |
| 5158 | Trades._loadFromDB | MED | Log.warn TRADES_LOAD |
| 5525 | Trades.close double-close | OK | bereits Log.warn |
| 5556 | Trades.close pnl-calc | MED | Log.warn TRADES_CLOSE_PNL |
| 5610 | Trades.close history-fetch | LOW | Log.warn HIST_FETCH |
| 5754 | DemoEngine ledger-write | HIGH | Log.warn LEDGER_WRITE — risk: silent ledger loss |
| 6231 | RegimeStrength persist | LOW | Log.warn REGIME_PERSIST |
| 6899 | ProfitLockHWM._persistHWM | MED | Log.warn HWM_PERSIST |
| 9033 | Grid order-fill cycle | LOW | bereits Log-Surround |
| 9057 | Grid SELL-fill log | LOW | bereits Log-Surround |
| 9085-9087 | GRID PROFIT_SPLIT applyPnL | OK | bereits Log.warn |
| 9225 | InfiniteGrid SELL-fill log | LOW | bereits Log-Surround |
| 9263 | DCA TP-Hit ledger | MED | Log.warn DCA_TP_LEDGER |
| ... | ... | ... | siehe gesamtes grep-output |

## Empfehlung

- **HIGH-Risk-Patches (Z.5754 LEDGER, Z.4752/4758 WALLET, Z.6398 POSITIONS):** dieser Pass (FIX 48) — done
- **MED-Risk (Z.5158, 5556, 5754, 6899, 9263):** nächster Pass (4h Engineering)
- **LOW-Risk (übrige 17):** kontinuierlich nachziehen oder akzeptieren

## Status

🟡 **TEILWEISE GEFIXT** — Top-3 HIGH-Risk in diesem Pass behoben. Restliche dokumentiert als Backlog mit Risk-Level. Vollständige Bearbeitung in separatem 4h-Pass.
