# SCORE_FLOOR Status — Dokumentation (KEIN Code-Patch)
**Datum**: 18.05.2026
**Brain-Schutzzone**: SCORE_FLOOR ist Brain-Logik → diese Datei ist NUR Doku.

---

## Aktuelle CFG-Werte (server.js Z.170-192, wörtlich)

```js
CFG.SCORE_FLOOR              = 0.08    // strenge Schwelle
CFG.SCORE_FLOOR_OLD          = 0.04    // alte Schwelle (Fallback)
CFG.SCORE_FLOOR_MODE         = 'log_only'  // 'log_only' | 'active_block'
CFG.SCORE_FLOOR_REGIME_ADAPTIVE = true
CFG.SCORE_FLOOR_REGIME_MAP   = {
  SQUEEZE: 0.06, CHOPPY: 0.07, RANGING: 0.08,
  NEUTRAL: 0.06, WEAK_BULL: 0.06, WEAK_BEAR: 0.06,
  BULL: 0.08, BEAR: 0.08,
  STRONG_BULL: 0.10, STRONG_BEAR: 0.10,
  EXTREME_BEAR: 0.12, FLASH_CRASH: 0.12, EXTREME: 0.12,
}
```

## Code-Pfad (server.js Z.11148-11161 wörtlich)

```js
let _scoreFloor;
const _regimeAdaptive = (typeof CFG !== 'undefined' && CFG.SCORE_FLOOR_REGIME_ADAPTIVE === true);
const _currentRegime  = (typeof Regime !== 'undefined' && Regime.regime) ? Regime.regime : 'NEUTRAL';
if (_regimeAdaptive && CFG.SCORE_FLOOR_REGIME_MAP && CFG.SCORE_FLOOR_REGIME_MAP[_currentRegime] !== undefined) {
  _scoreFloor = CFG.SCORE_FLOOR_REGIME_MAP[_currentRegime];
} else {
  _scoreFloor = (typeof CFG !== 'undefined' && CFG.SCORE_FLOOR) ? CFG.SCORE_FLOOR : 0.08;
}
const _scoreFloorOld = (typeof CFG !== 'undefined' && CFG.SCORE_FLOOR_OLD)? CFG.SCORE_FLOOR_OLD: 0.04;
const _scoreFloorMode= (typeof CFG !== 'undefined' && CFG.SCORE_FLOOR_MODE)? CFG.SCORE_FLOOR_MODE: 'log_only';
const _strictDir = uScore > _scoreFloor    ? 'BUY' : uScore < -_scoreFloor    ? 'SELL' : 'HOLD';
const _oldDir    = uScore > _scoreFloorOld ? 'BUY' : uScore < -_scoreFloorOld ? 'SELL' : 'HOLD';
let direction    = (_scoreFloorMode === 'active_block') ? _strictDir : _oldDir;
const _floorBlocked     = (_strictDir === 'HOLD' && _oldDir !== 'HOLD');
const _floorTheoretical = (_scoreFloorMode === 'log_only');
```

## Effektives Verhalten

- **MODE='log_only'** (aktuell): `direction = _oldDir` → **0.04 wirkt aktiv**
- 0.08 (oder regime-adaptive 0.06-0.12) wird nur als `_floorBlocked`-Flag im result-Objekt geloggt
- Das `floorBlocked=true`-Flag wird in `blocked_trades` mit `theoretical=true` persistiert

## Daten-Spuren

- **blocked_trades-Tabelle**: `FLOOR_THRESHOLD` mit 410 Einträgen
- **aladdin_decisions 24h**: BUY 23079, HOLD 15412, SELL 1419 → HOLD 38.6%
- Wenn 0.08 aktiv-blocking wäre, würden zusätzliche ~410 BUYs/SELLs zu HOLD werden

## Elite-Benchmark — Threshold-Hybride

### Freqtrade `entry_pricing.price_side` + `unfilledtimeout`
- Trennt Order-Trigger (entry-signal) von Order-Acceptance (price-side)
- Kein "log_only"-Modus, sondern explizite Dual-Threshold-Konfiguration
- Quelle: [Freqtrade Configuration](https://www.freqtrade.io/en/stable/configuration/)

### NautilusTrader `inflight_check_threshold_ms`
- Default 5000ms, configurable
- Klare Soft/Hard-Trennung, kein "log_only"-Schatten-Modus
- Quelle: [NautilusTrader Live Concepts](https://nautilustrader.io/docs/latest/concepts/live/)

### BlackRock Aladdin (per drift-Insights)
- "Built-in quality controls + exception-based handling"
- Drift-Schwellen werden konfiguriert mit "rules and alerts to systematically identify deviation"
- Quelle: [Aladdin Catch The Drift](https://www.blackrock.com/aladdin/products/aladdin-wealth/insights/catch-the-drift)

### Superalgos (Open-Source)
- Visual scripting hat keine "log_only"-Konstante, sondern aktive Threshold-Vergleich pro Trading-System
- Quelle: [Superalgos GitHub](https://github.com/Superalgos/Superalgos)

## Empfehlung an Christian (separate Freigabe-Runde)

**Optionen**:
1. **Beibehalten log_only**: 0.04 effektiv, 0.08 als Schatten-Beobachtung — gewolltes A/B-Testing
2. **Auf active_block ziehen**: 0.08 als Hard-Block aktivieren — strenger, weniger Trades
3. **Hybrid ersetzen**: log_only entfernen, regime-adaptive direkt aktiv (`SCORE_FLOOR_MODE` raus)

**Mein Engineering-Bias**: Elite-Niveau bedeutet KEINE Schatten-Schwellen.
NautilusTrader/Aladdin haben **eine** Schwelle pro Use-Case, klar definiert.
Log-only ist hilfreich im Übergang, aber sollte ein finales Datum haben.

## NICHT GEÄNDERT (Brain-Schutzzone)
- KEINE Code-Änderung
- KEINE CFG-Änderung
- NUR diese Doku

## Audit-Eintrag
SCORE_FLOOR-Status dokumentiert in: `/Users/christianheilig/NEXUS_CLEAN/SCORE_FLOOR_STATUS_20260518.md`

---

**Quellen**:
- [Freqtrade Configuration](https://www.freqtrade.io/en/stable/configuration/)
- [NautilusTrader Live Concepts](https://nautilustrader.io/docs/latest/concepts/live/)
- [BlackRock Aladdin — Recognize and catch the drift](https://www.blackrock.com/aladdin/products/aladdin-wealth/insights/catch-the-drift)
- [Superalgos GitHub](https://github.com/Superalgos/Superalgos)
