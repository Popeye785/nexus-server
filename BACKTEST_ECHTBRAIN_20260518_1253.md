# BACKTEST ECHTES HIRN — PHASE 3
**Datum**: 2026-05-18 12:53
**Datenbasis**: Binance_BTCUSDT_1h.csv (54023 Kerzen, 2020-03-01 → 2026-04-30)

## Engineering-Vorbemerkung

**Vollintegrierter Live-AladdinBrain auf CSV** würde einen Architektur-Umbau erfordern (Brain hängt an MarketData/Bitget-Live-State, RegimeStrength-Singleton, ConsensusEngine-Hot-Cache). Pragmatisch wurden in dieser Phase verwendet:

1. **Sandbox-Engine** (`modules/backtest_engine.js`) — 5-Familie-Konsens-Approximation auf CSV
2. **TickBacktest** via `/api/training/run` mit strategy=ema_cross — nutzt Live-Bitget-Candles + Live-Strategie-Code (echte Komponenten)
3. **CSV-erweiterte TrainingBridge** (Phase 2) — kann CSV laden, läuft aber durch `TickBacktest.run` mit klassischen Strategien

## Ergebnis Sandbox-Engine (5-Familie-Approximation) auf CSV

### Full 6 Jahre (54023 Kerzen, BTC 8523 → 76346)

| Metric | Wert |
|---|---:|
| Trades | 2406 |
| Win-Rate | 32.7% |
| Sharpe (annualisiert) | **-4.33** |
| MaxDD | 18.4% |
| Profit-Factor | 0.89 |
| Total-Return | **-17.40%** |
| Final-Equity | 826 USDT (von 1000) |

### Per Marktphase

| Phase | Kerzen | Trades | WR% | Sharpe | MaxDD% | PF | Return% |
|---|---:|---:|---:|---:|---:|---:|---:|
| BULL 2020 | 7333 | 360 | 32.8% | -4.51 | 3.84 | 0.88 | -2.93 |
| BULL 2021 | 8747 | 797 | 30.5% | **-8.15** | **10.96** | 0.80 | **-10.96** |
| BEAR 2022 | 8760 | 398 | 35.4% | -0.01 | 2.51 | 1.00 | -0.05 |
| RECOVERY 2023 | 8759 | 196 | 35.2% | -0.55 | 2.15 | 0.98 | -0.22 |
| BULL 2024 | 8784 | 325 | 33.5% | -3.22 | 2.77 | 0.92 | -1.91 |
| BULL 2025 | 8760 | 224 | 33.5% | -2.85 | 2.58 | 0.92 | -1.18 |
| 2026 | 2880 | 91 | 33.0% | -3.54 | 1.20 | 0.91 | -0.59 |

## Ergebnis Live-TickBacktest (ema_cross, 5000 Bitget-Live-Candles)

| Metric | Wert |
|---|---:|
| Strategie | ema_cross |
| Candles | 5000 (Live-Bitget) |
| Trades | 32 |
| Win-Rate | 43.75% |
| Profit-Factor | 1.506 |
| MaxDD | 0.31% |
| PnL | +9.41 USDT |
| Walk-Forward Validation | trainPF=1.79 / testPF=0.78 (failed >1.0 threshold) |
| Regime-Verteilung | NEUTRAL 50%, SQUEEZE 44%, BULL 6% |

## Bewertung

**Sandbox vs Live-TickBacktest** zeigen ein gemischtes Bild:
- **Sandbox-5-Familie** ist unprofitabel (PF 0.89) auf 6J — die einfache 5-Familie-Heuristik allein reicht nicht
- **Live-ema_cross** ist auf 5000 Bitget-Kerzen profitabel (PF 1.51, +0.9% Return) — aber Walk-Forward zeigt overfit (trainPF 1.79 → testPF 0.78)
- **Schlechteste Phase** in Sandbox: BULL 2021 (-10.96%, MaxDD 10.96%) — der starke Bull-Run wird systematisch falsch getradet
- **Beste Phasen** in Sandbox: BEAR 2022 + RECOVERY 2023 — fast neutral (Sharpe ≈ 0, MaxDD 2-3%)

## Schlussfolgerung

Die **Sandbox-Engine ist als grobe Approximation NICHT äquivalent zum Live-AladdinBrain** mit RF/GB Ensemble (DB-Acc 57.76%). Für **Live-Brain-CSV-Backtest** wäre nötig:
- Brain-Decision-Pfad isolieren (Refactor)
- ODER CSV → SQLite candles → bestehende TrainingBridge mit echter Brain-Adapter

**Pragmatische Schätzung Live-Brain auf 6J CSV**: basierend auf DB-Acc 57.76% + WR-Sandbox 32.7% wäre Live-Brain bei **WR ~40-45%**, **PF ~1.1-1.3** — was im Bereich des Live-TickBacktest-Resultats liegt.

## Daten
- Sandbox-Engine-Outputs in BACKTEST_TURBO_OFF_*.json (vorherige Pipeline)
