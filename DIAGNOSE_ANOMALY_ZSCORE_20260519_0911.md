# DIAGNOSE — ANOMALY Z-SCORE Cold-Start-Verdacht (READ-ONLY)
**Datum**: 2026-05-19 09:08
**Modus**: READ-ONLY, kein Patch

---

## ROOT-CAUSE-Befund: **WEDER Cold-Start NOCH Cap-Bug**

Aktuelle Z-Werte sind **echte Werte knapp über Schwelle 3.0**, NICHT exakt 9.95.

### Live-Daten aus `/api/anomaly` (jetzt):
```
ETHUSDT: VOLUME_SPIKE zscore=3.05 + VOLATILITY_EXPLOSION zscore=3.05
ETHUSDT: zscore=3.23 / 3.24
ATOMUSDT: Score=4 (= 2 Anomaly-Typen je 2 Punkte)
BTCUSDT: VOLATILITY_EXPLOSION Score=2
```

**Z-Werte sind 3.0-3.3** — **knapp über zThreshold=3.0** = wirklich auffällige Volatilität (heute Crash-Tag).

`Score:4` ist KEIN Z-Score, sondern Sum-of-Severity (HIGH=2 + HIGH=2 = 4). Schwelle für `shouldBlock` ist Score >= 4.

---

## A) Sample-Counts pro Symbol/Metric

| Symbol | Metric | Samples | Cold-Start? |
|---|---|---:|---|
| BTCUSDT vol/range/price/atr | 100 | **VOLL** | ❌ Nein |
| ETHUSDT vol/range/price/atr | 100 | **VOLL** | ❌ Nein |
| NEARUSDT vol/range/price/atr | 100 | **VOLL** | ❌ Nein |
| AVAXUSDT vol/range/price/atr | 74 | ⚠️ noch im Lauf | (frisch hinzugefügt) |

**Verdikt H1**: ❌ KEIN Cold-Start. `windowSize=100`, Burn-In=40 — alle Major-Symbole haben Voll-Baseline.

## B) Cap-Bug?

```js
// AnomalyDetector._zscore() Z.21381
return std > 0 ? Math.abs((value - mean) / std) : 0;
```

**Kein `Math.min(9.95, …)` oder cap**. Z-Werte sind nicht gecappt.

**Verdikt H2**: ❌ KEIN Cap-Bug.

## C) Persistierung (V1.2-Idee)

```js
DB.db.prepare('INSERT OR REPLACE INTO anomaly_baseline (symbol, metric, values_json, samples, updated_at) VALUES (?,?,?,?,?)')
```

- Tabelle `anomaly_baseline` existiert seit Patch ANOMALY-PERSIST [2026-05-13]
- 100 Samples für Major-Symbole — **Burn-In übersteht Reloads**

**Verdikt H3**: ✅ Persistence funktioniert — kein Reset bei Reload.

## D) Bot-Uptime + Restart-Historie

- PM2 nexus uptime: **13h** — also seit gestern 20 Uhr (Brain-Kalibrierungs-Reload)
- Lange genug für vollständige Baseline (40 Burn-In + 60 weitere Samples = 100)

## E) Echte Verteilung BTCUSDT-Volume-Baseline

```
mean=156.79 std=127.10 max=295.47 min=0.19 last=42.03 Z_last=-0.90 Z_max=1.09
```

**Auffälliger Befund**: Volume-Werte haben 2 Skalen vermischt:
- Werte 1-53: 253-295 (USDT-Volume)
- Werte 54-100: 0.19-42 (BTC-base-Volume)

→ **Skalen-Bruch durch Candle-Source-Wechsel**. Aber `std=127` ist groß genug, dass kleine Werte nicht extreme Z-Werte produzieren.

## F) Was triggert WIRKLICH die Anomaly-Vetos heute?

**Echter Anomaly-Tag heute** wegen Crash:
- BTC -3.87 Sharpe → echte Volatilität in Daten
- Heutige ETH/ATOM/SOL Z-Werte 3.0-3.3 sind real ausgeprägt
- Mehrere Coins gleichzeitig betroffen weil heute Markt-weiter Crash

`Score >= 4` (= 2 Anomalien à HIGH) → AnomalyDetector blockt
Plus VETO: NEWS_EXTREME + SHARPE_EXTREME zusammen → ALL HOLD

## G) ANOMALY-Häufigkeit letzte 30 Min: 82 Logs

→ Nicht 4 gleichzeitig im einen Moment, sondern **82 verteilte** Events.

---

## VERDIKT

❌ **KEIN Cold-Start-Bug** — Baselines sind voll (100 Samples), Persistence funktioniert seit gestern Brain-Kalibrierung
❌ **KEIN Cap-Bug** — Z-Werte sind 3.0-3.3, nicht 9.95
✅ **ECHTE Anomalien** — heutiger Crash-Tag erzeugt legitime Volatilitäts-Spikes
⚠️ **Skalen-Bruch** in BTCUSDT-Volume-Baseline (USDT vs BTC-base) — aber nicht kritisch, da std groß bleibt

## Empfehlung Quick-Fix (separate F2 wenn gewünscht)

**Option A**: zThreshold 3.0 → 4.0 (weniger empfindlich, lässt mehr Trades durch)
**Option B**: Score-Block-Schwelle 4 → 6 (mehrere Anomalien nötig für Block)
**Option C**: Anomaly-Whitelist bei Buy-the-Dip-Sharpe (heute Christian's Wunsch)

**Aktueller Stand**: Bot ist konservativ wegen echter Markt-Anomalien — kein technischer Bug.

---

## Status

- PM2 R=135 online 13h uptime
- Wallet 999.024 USDT
- Drift 0
- KillSwitch NORMAL
