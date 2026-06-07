# WALK-FORWARD AUF CSV — TEIL J
**Datum**: 2026-05-18 12:21
**Datenbasis**: Binance_BTCUSDT_1h.csv (54023 Kerzen)
**Windows**: 63 rolling 1-Jahr-Fenster (Step 30 Tage, 70% Train / 30% Test)

## Ergebnisse

| Mode | Windows | OOS Sharpe>1.0 | Quote | Avg Train Sharpe | Avg Test Sharpe |
|---|---:|---:|---:|---:|---:|
| TURBO OFF | 63 | 19 | **30.2%** | -3.63 | -2.77 |
| TURBO ON | 63 | 16 | **25.4%** | -4.01 | -2.93 |

## Verdikt

**Strategie zufallsabhängig** in beiden Modi.

- Quote OOS Sharpe>1.0 unter 50% → **kein robustes Edge**
- Avg Test-Sharpe negativ → **Mehrheit der Test-Perioden verliert**
- Turbo verschlechtert leicht in Sandbox-Approximation

## Wichtige Einschränkung

Wie in TEIL H+I bereits ausgeführt: Die **Sandbox-Konsens-Approximation** ist eine **vereinfachte Heuristik**, NICHT der Live-AladdinBrain mit RF/GB Ensemble + 35-dim Features. Dieses Walk-Forward bewertet **nicht** den echten Brain, sondern die einfache 5-Familie-Logik.

## Interpretation

Wenn man die einfache 5-Familie-Heuristik isoliert (ohne ML-Ensemble) walk-forward-tested, ist sie **statistisch nicht robust**. Das war zu erwarten und bestätigt: **Der Live-Mehrwert liegt im ML-Ensemble**, nicht in der Familie-Aggregation allein.

## Empfehlung

Für **echten Brain-Walk-Forward** auf CSV-Basis: Bestehende `modules/walkforward.js` (196 Z., schon vorhanden) ist auf Bitget-Live-Candles ausgelegt. Erweiterung um CSV-Source ist **separates F2-Paket** (~50 Z. Code-Erweiterung).

## Daten
- `WALKFORWARD_CSV_OFF.json` (63 Window-Detail-Ergebnisse)
- `WALKFORWARD_CSV_ON.json` (63 Window-Detail-Ergebnisse)
