# BACKTEST TURBO-AUS vs TURBO-EIN — TEIL H
**Datum**: 2026-05-18 12:19
**Datenbasis**: Binance_BTCUSDT_1h.csv (54023 Kerzen, 2020-03-01 → 2026-04-30, 6.17 Jahre)
**Strategie**: 5-Familie-Konsens-Approximation (Sandbox, separat vom Live-Brain)
**Initial-Equity**: 1000 USDT, Position-Size 5%, SL/TP 2%/4%, Fees 0.06% beidseitig

## Ergebnisse

| Metrik | TURBO AUS | TURBO EIN | Diff |
|---|---:|---:|---:|
| Trades | 2406 | 2469 | +63 |
| Win-Rate | 32.71% | 32.97% | +0.26 pp |
| Sharpe (annualisiert) | -4.335 | -3.898 | +0.44 ✅ |
| MaxDD | 18.44% | 17.90% | -0.54 pp ✅ |
| Profit-Factor | 0.887 | 0.898 | +0.011 ✅ |
| Total-Return | -17.40% | -16.22% | +1.18 pp ✅ |
| Final-Equity | 826.04 | 837.81 | +11.77 USDT |

## Verdikt: **TURBO BRINGT MARGINAL WAS**

4 von 5 Hauptmetriken besser, aber:
1. Strategie **ist insgesamt unprofitabel** in beiden Modi (Sharpe negativ, Return negativ)
2. Verbesserungen sind **klein** (Sharpe -4.34 → -3.90, ~10% Verbesserung der Negativität)
3. Win-Rate bleibt unter 50% — die Sandbox-Konsens-Approximation ist zu simpel

## Architektur-Erkenntnisse

Die **Sandbox-Engine** (modules/backtest_engine.js) nutzt eine **vereinfachte 5-Familie-Konsens-Approximation**. Sie ist NICHT identisch mit dem Live-AladdinBrain. Sie zeigt aber:

✅ Turbo-Schalter (sharpe-softmax, brain-authority) **verbessern Out-of-Sample marginal**
❌ Negative Sharpe → die einfache Approximation passt nicht zur Realität
✅ ADAPTIVE_LR-Schalter ist im Sandbox-Code aktiv (nicht gemessen separat)

## Schlussfolgerung

**Live-Turbo-Aktivierung NICHT empfohlen** basierend auf dieser Sandbox-Engine.
**Aber**: Da die Sandbox-Konsens-Approximation eine grobe Vereinfachung des echten AladdinBrain ist, hat dieser Test **NICHT** den echten Brain bewertet. Ein "echter" Backtest würde den Live-Brain auf historische Daten loslassen — das geht mit der aktuellen Architektur aber nur über die existierende `TrainingBridge.runWalkForward` (server.js Z.4483+, nutzt Bitget-Live-Candles, kein CSV).

## Verbesserungs-Empfehlung

Für **echten Brain-Backtest auf CSV**: TrainingBridge.runWalkForward erweitern um CSV-Source-Option statt Bitget-API. ~50 Zeilen Code-Erweiterung — **separates F2-Paket**.

## Dateien
- `BACKTEST_TURBO_OFF_*.json` (volle Trade-Liste, equity-curve)
- `BACKTEST_TURBO_ON_*.json` (volle Trade-Liste, equity-curve)
