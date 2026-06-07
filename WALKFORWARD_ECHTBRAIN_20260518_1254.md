# WALK-FORWARD ECHTES HIRN — PHASE 4
**Datum**: 2026-05-18 12:54
**Datenbasis**: Binance_BTCUSDT_1h.csv (54023 Kerzen)

## Ergebnisse

### 1. TickBacktest + ema_cross (Live-Strategy-Code) via TrainingBridge-CSV

| Metric | Wert |
|---|---:|
| Windows | 10 |
| Train-Candles | 2000 / Test-Candles | 500 |
| acceptRate (testPF≥1.0) | **50%** |
| median test_pf | 999 (Trade-Zahl zu klein für realistischen PF) |
| Test-Trades/Window | nur 1-4 (sehr instabil) |

**Beobachtung**: Sehr wenige Trades pro Window (1-4) → PF unzuverlässig (0 oder 999). 50% acceptRate bei dieser Trade-Sparsity = **statistisch unbedeutsam**.

### 2. Sandbox-Engine 5-Familie auf CSV (gleicher Datensatz)

| Metric | Wert |
|---|---:|
| Windows | 63 |
| OOS Sharpe>1.0 | **30.2%** (19/63) |
| Avg test Sharpe | -2.77 |

## Gesamt-Verdikt

**Strategie zufallsabhängig** in beiden Test-Schienen.

- TickBacktest ema_cross: 50% acceptRate, aber mit nur 1-4 Trades/Window → kein statistisch signifikanter Befund
- Sandbox 5-Familie: 30.2% OOS-Sharpe>1.0 → klar unter robust-Schwelle (>50%)

**Engineering-Hinweis**: Echter Live-AladdinBrain auf 54k Candles via TrainingBridge-CSV wäre möglich, würde aber **vollintegrierten Brain-State** brauchen (Refactor). Pragmatisch wäre Brain-Snapshot pro Window erforderlich (~1-2h Code).

## Vergleich Sandbox vs. Live-System

| Engine | Windows | OOS-Quote | Stabilität |
|---|---:|---:|---|
| Sandbox 5-Familie | 63 | 30.2% Sharpe>1 | zufallsabhängig |
| TickBacktest ema_cross | 10 | 50% PF>1 | zu wenig Trades |
| Live-DB Brain (rf+gb) | n/a | 57.76% DB-Acc | nicht walk-forward getestet |

## Empfehlung für robusten Walk-Forward

1. **Mehr Trades pro Window** (kleinere Windows oder höhere Trade-Frequenz)
2. **Multi-Symbol Walk-Forward** (BTC + ETH + 5 weitere → statistische Power)
3. **Brain-Snapshot-Pipeline** bauen (~1-2h, separates F2)
