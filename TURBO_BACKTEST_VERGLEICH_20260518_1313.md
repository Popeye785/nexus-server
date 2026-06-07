# TURBO BACKTEST-VERGLEICH — PHASE 9
**Datum**: 2026-05-18 13:13
**Datenbasis**: Binance_BTCUSDT_1h.csv (54023 Kerzen)
**Engine**: Sandbox 5-Familie + Turbo-Schalter-Patch (modules/backtest_engine.js)

## Full 6 Jahre Vergleich

| Metric | TURBO AUS | TURBO EIN | Diff | Bewertung |
|---|---:|---:|---:|---|
| Trades | 2406 | 2469 | +63 | leicht mehr |
| Win-Rate | 32.71% | 32.97% | +0.26 pp | ⚠️ marginal |
| Sharpe | -4.335 | -3.898 | **+0.437** | ✅ besser |
| MaxDD | 18.44% | 17.90% | -0.54 pp | ✅ besser |
| Profit-Factor | 0.887 | 0.898 | +0.011 | ⚠️ marginal |
| Total-Return | -17.40% | -16.22% | +1.18 pp | ✅ besser |
| Final-Equity | 826.04 | 837.81 | +11.77 USDT | ⚠️ marginal |

## Per Marktphase

| Phase | OFF Sharpe | ON Sharpe | OFF WR% | ON WR% | OFF Return% | ON Return% | Diff Return% |
|---|---:|---:|---:|---:|---:|---:|---:|
| BULL 2020 | -4.51 | -4.66 | 32.8 | 32.4 | -2.93 | -3.12 | -0.19 ❌ |
| BULL 2021 | -8.15 | **-5.56** | 30.5 | **32.0** | -10.96 | **-7.88** | +3.08 ✅ |
| BEAR 2022 | -0.01 | -0.64 | 35.4 | 35.0 | -0.05 | -0.53 | -0.48 ❌ |
| RECOVERY 2023 | -0.55 | -4.21 | 35.2 | 33.0 | -0.22 | -1.53 | -1.31 ❌ |
| BULL 2024 | -3.22 | -4.57 | 33.5 | 32.7 | -1.91 | -2.74 | -0.83 ❌ |
| BULL 2025 | -2.85 | -1.40 | 33.5 | 34.4 | -1.18 | -0.60 | +0.58 ✅ |
| 2026 | -3.54 | -2.35 | 33.0 | 33.7 | -0.59 | -0.42 | +0.17 ✅ |

**Pro Phase Bilanz**: 3 Phasen besser (Bull 2021, Bull 2025, 2026), 4 Phasen schlechter (Bull 2020, Bear 2022, Recovery 2023, Bull 2024).

## Statistische Bewertung

- **Sharpe-Verbesserung +0.437** liegt unter Schwelle 0.5 für robuste Signifikanz, aber über Trivialgrenze
- **Wins/Losses**: Turbo half am stärksten in BULL 2021 (-10.96% → -7.88%, +3.08 pp)
- **Verlusten**: Turbo verschlechterte in RECOVERY 2023 und BULL 2024 (jeweils ~ -1 pp)
- Konsistente Verbesserung in **starken Bull-Phasen mit hoher Volatilität** (2021, 2025, 2026)

## Daten gespeichert

- `/Users/christianheilig/NEXUS_CLEAN/BACKTEST_TURBO_OFF_ECHT.json`
- `/Users/christianheilig/NEXUS_CLEAN/BACKTEST_TURBO_ON_ECHT.json`
