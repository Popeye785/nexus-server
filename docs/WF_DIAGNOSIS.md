# Walk-Forward `test_pf=0` Diagnose & Fix (15.05.2026)

## Beobachtung
Aktueller Endpoint `/api/backtest/walkforward12m` mit Default-Params:
- granularity: `1day`
- trainCandles: 60, testCandles: 30
- 6 Windows berechnet, **alle 6 mit `test_pf=0, test_trades=0`**

## Root-Cause-Analyse

### Hauptursache: TickBacktest Burn-In + zu kleines Test-Window
`TickBacktest.run()` startet die Trading-Schleife bei **`i=50`** (server.js:2956)
um den 50-period EMA-Lookback abzudecken:

```js
for (let i = 50; i < candles.length - 1; i++) { ... }
```

WF ruft TickBacktest mit `limit=testCandles=30` (offset=testStart) auf. TickBacktest
fetcht 30 Candles → die Schleife läuft von `i=50..29` = **0 Iterationen**.
**Mathematisch unmöglich**, ein Signal im Test-Window zu generieren.

### Zweite Ursache: ema_cross-Signal-Frequenz auf Daily
ema_cross-Bedingung (strikter Crossover):
```js
signal = e20>e50 && pe20<=pe50
```
Feuert **nur am Crossover-Tag selbst** — auf Daily-BTC im Schnitt **2-5× pro Jahr**.
Selbst wenn die Burn-In-Hürde fiele, wäre `testCandles=30` (≈1 Monat) deutlich
zu kurz für statistisch sinnvolle Signal-Hits.

### Dritte Ursache: Bitget-Fetch-Limit für Daily
`Bitget.fetchCandles(symbol, '1day', trainCandles*4)` liefert nur **240 daily candles**
≈ 8 Monate, nicht die geforderten 12 Monate.

## Hypothesen-Mapping
- ❌ H1 (Crossover-Schwelle) — Teil-Ursache, aber durch H3/H5 dominiert
- ❌ H2 (SCORE_FLOOR) — irrelevant; TickBacktest hat keinen FLOOR-Check
- ✅ **H3 (Test-Window zu klein)** — Hauptursache: 30 < 50 (Burn-In)
- ❌ H4 (ADX) — irrelevant; ema_cross prüft kein ADX
- ✅ **H5 (Timeframe-Mismatch)** — sekundär: Daily-Frequenz unzureichend

## Fix-Strategie (kombiniert H3 + H5)

**Endpoint-Default-Änderung (kein TickBacktest-Eingriff, kein Live-Decision-Impact):**

| Param | Vorher | Neu | Begründung |
|---|---|---|---|
| granularity | `1day` | `4h` | 6× mehr Candles pro Tag → mehr Crossover-Chancen |
| trainCandles | 60 | 240 | 40 Tage @ 4h Burn-In + Training |
| testCandles | 30 | 90 | 15 Tage @ 4h, gibt 40 Trading-Candles nach i=50 |

Ergebnis für 12M @ 4h = 2190 Candles total. Mit train=240, test=90 →
~21 Windows mit echten Signal-Chancen.

## Compat
- API bleibt überridable: `{ "granularity": "1day", "trainCandles": 60, "testCandles": 30 }`
  bleibt als legacy-Setting nutzbar
- Live-Decision-Flow unverändert (WF ist Test-Tool, kein Trade-Trigger)
- TickBacktest unverändert (Bug ist Window-Sizing, nicht Engine-Logik)

## Sources
- [QuantInsti Walk-Forward Optimization](https://blog.quantinsti.com/walk-forward-optimization-introduction/)
- [TrendRider Backtest Guide 2026](https://trendrider.net/blog/how-to-backtest-crypto-trading-strategy-2026)
- [LuxAlgo MA-Crossovers](https://www.luxalgo.com/blog/moving-average-crossovers-for-entry-and-exit/)
