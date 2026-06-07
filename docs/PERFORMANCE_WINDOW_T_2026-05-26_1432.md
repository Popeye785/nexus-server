# Performance Snapshot 2026-05-26T14:32:08

## Day-Zero-Reset: 20.05.2026 16:53 — 30d-Window bis 19.06.2026

## Wallet & Drift
- istTotal: 1100.27 USDT
- effectiveTotal: 1101.39 USDT
- reserve: 3.81, trading: 1096.46
- drift: 0 USDT (consistent=True)
- mbtUnrealized: 1.12

## Stats
- tradesTotal (SINGLE): 4 wins=1 losses=3
- activeTrades: 3 (Single: 1, Grid: 1, DCA: 0)
- winRateWeighted: 34.3%
- winRateSingle: 25%  Grid: 100%  DCA: 10%
- realizedAllSinceReset: 15.77 USDT
- unrealizedPnl: 1.12

## Quant-Metrics
- Sortino: 0.7066189789476651 (reason=OK, n=5, classification=ACCEPTABLE)
- Kelly used: 1 (reason=SAMPLE_TOO_SMALL, n=4, p=None, b=None)

## LIVE-Ready Audit
- passed: 6/7 (85.7%)
- ready_for_live: False
  ✅ drift_under_5_usdt: True
  ❌ brain_acc_sample_n50: False
  ✅ engine_endpoints_alive: True
  ✅ no_critical_errors_24h: True
  ✅ profit_split_correct: True
  ✅ black_swan_survives: True
  ✅ ml_imbalance_fixed: True

## Black-Swan-Replay (4 events all-survived):
- COVID-Black-Thursday 2020: peak_DD 52.21%, all survived
- LUNA-Collapse 2022: peak_DD 21.80%, all survived
- FTX-Implosion 2022: peak_DD 25.41%, all survived
- Yen-Carry-Unwind 2024: peak_DD 12.77%, all survived
