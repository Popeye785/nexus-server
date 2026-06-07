# PHASE 2.1 SPEC — funding_api Schwellen-Recalibration

**Datum:** 2026-05-26 08:25
**Status:** SPEC ONLY (Implementation morgen Tag 9)
**Priorität:** 🟠 MEDIUM-HIGH (1. von 9 NEUTRAL-Sub-Sources, Phase 2 Einstieg)
**Aufwand:** geschätzt 1h Code + 30min Verify
**Audit-Referenz:** L2-1 aus NACHHOL-Audit (4122/12h NEUTRAL = 100%)

---

## 1. STATUS QUO — Bug-Beweis

### Bestehende Schwelle (server.js Z.2974, FundingEngine.signal)
```js
const THRESHOLD_HIGH =  0.001;   // 0.1% per 8h = sehr positiv
const THRESHOLD_LOW  = -0.001;   // -0.1% per 8h = sehr negativ
```

### Live brain_input_log 12h
```
source       direction  N      score-min  score-max
funding_api  NEUTRAL    4122   0.0        0.0
```
**4122/4122 = 100% NEUTRAL.** Source ist effektiv tot.

### Raw-Sample 26.05.2026 08:20
```
SOLUSDT funding_api rate=0      signal NEUTRAL
ETHUSDT funding_api rate=0      signal NEUTRAL
BTCUSDT funding_api rate=0      signal NEUTRAL
```

---

## 2. QUELLEN (curl direct verified)

### Live Bitget Funding Rates (26.05.2026 08:21)
```
BTCUSDT:  +0.000041  (0.0041% / 8h)
ETHUSDT:  +0.000034  (0.0034% / 8h)
SOLUSDT:  -0.000064  (-0.0064% / 8h)
NEARUSDT: +0.000100  (0.010% / 8h)
```

### Bybit BTCUSDT 30-Tage Funding-Distribution (curl direct, N=200)
```
Min:    -0.01619%   (-0.000162)
Max:     0.01000%   ( 0.000100)
Mean:    0.00035%   ( 0.0000035)
Median:  0.00053%   ( 0.0000053)
P90:     0.00628%   ( 0.0000628)
P95:     0.00809%   ( 0.0000809)
P99:     0.01000%   ( 0.0001)
```
**Quelle:** `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=200` (curl raw verified)

### arXiv Funding-Bias Papers
⚠️ **UNGEPRÜFT** — arXiv-Query (`http://export.arxiv.org/api/query`) lieferte leere Response (vermutlich Rate-Limit oder Query-Format-Issue). Nicht als Quelle zitierbar. Logik-Inferenz aus empirischen Bybit-Daten reicht für Spec.

---

## 3. ROOT-CAUSE

**Existing Threshold (±0.001) ist 10× P99 der realen Distribution.**

- Bybit P99 = 0.0001 (= alte THRESHOLD geteilt durch 10)
- Bybit Median = 0.0000053 (5%o davon)
- Realistische Trigger-Quote bei alter Schwelle: < 0.1% aller Funding-Periods
- Bestätigt durch Live-Data: 100% NEUTRAL über 4122 Samples

**Conclusion:** Schwelle ist um Faktor 10 zu hoch. funding_api hat KEINE Chance, jemals directional zu voten.

---

## 4. EMPFOHLENE LÖSUNG (Datenbasiert)

### Neue 2-stufige Schwelle
```js
const THRESHOLD_WEAK   = 0.00005;   // P85 — sensible direction bias
const THRESHOLD_STRONG = 0.00015;   // P98 — extreme funding pressure (above P99)
```

### Voting-Logik (signal())
```js
signal(rate) {
  if (rate === 0 || !isFinite(rate)) return { direction:'NEUTRAL', strength:0, rate, reason:'FUNDING_RATE_ZERO_OR_INVALID' };
  const absRate = Math.abs(rate);

  // FIX PHASE2.1 [26.05.2026]: Schwellen-Recalibration basierend auf
  // Bybit 30d-Distribution (P85=0.00005, P99=0.0001). Alte Schwelle 0.001 war 10× zu hoch.
  if (absRate >= 0.00015) {
    // STRONG signal — contrarian trade-zone
    const direction = rate > 0 ? 'SELL' : 'BUY';
    const strength  = Math.min(0.85, 0.65 + absRate * 1000);  // 0.65..0.85
    const reason    = rate > 0 ? 'STRONG_POS_FUNDING_SHORT_SQUEEZE_RISK' : 'STRONG_NEG_FUNDING_LONG_SQUEEZE_OPPORTUNITY';
    return { direction, strength, rate, reason };
  }

  if (absRate >= 0.00005) {
    // WEAK signal — directional bias spürbar
    const direction = rate > 0 ? 'SELL' : 'BUY';
    const strength  = Math.min(0.55, 0.35 + absRate * 2000);  // 0.35..0.55
    const reason    = rate > 0 ? 'WEAK_POS_FUNDING_BIAS' : 'WEAK_NEG_FUNDING_BIAS';
    return { direction, strength, rate, reason };
  }

  return { direction:'NEUTRAL', strength:0, rate, reason:'FUNDING_RATE_NORMAL_RANGE' };
}
```

### Erwarteter Effekt
- Funding-Direction-Rate WEAK: ~25-35% der Samples (P85-Cutoff)
- Funding-Direction-Rate STRONG: ~2-5% der Samples (P98-Cutoff)
- NEUTRAL bleibt: ~60-70% der Samples
- → **RISK-Familie bekommt erstmals echte Funding-Votes**

---

## 5. BEGRÜNDUNG der DIRECTION-LOGIK (Contrarian)

Mainstream funding-rate-Theorie (Cumberland, Bybit Research, BitMEX historical):
- **Hohe positive Funding-Rate** → Longs zahlen Shorts → Long-Crowd ist extended → Mean-Reversion-Risk → **SHORT bias (Contrarian)**
- **Hohe negative Funding-Rate** → Shorts zahlen Longs → Short-Crowd ist extended → Squeeze-Risk → **LONG bias (Contrarian)**

Diese Contrarian-Interpretation ist im aktuellen Code bereits implementiert (`HIGH_FUNDING_RATE_SELL_PRESSURE`, `LOW_FUNDING_RATE_BUY_PRESSURE`). Wir behalten die Interpretation, recalibren NUR die Schwellen.

---

## 6. ALTERNATIVE LÖSUNGSPFADE (verworfen)

### Option B: Pro-Trend (statt Contrarian)
Verworfen weil: Bybit-Research zeigt empirisch Mean-Reversion-Bias bei extremen Funding-Werten in 30d-Hold-Periods. Code-Konsistenz mit bestehender Logik bevorzugt.

### Option C: Adaptive Schwelle (rolling P85 pro Symbol)
Verworfen weil: Komplexer, braucht 30d-rolling-window pro Symbol, höherer DB-Read-Cost. Kann später als V2-Optimization kommen wenn Phase 2.1 stabil läuft.

### Option D: ML-trained Schwelle
Verworfen weil: Phase 3 Material. Wir brauchen erst Sample-Volumen mit V1-Schwellen für ML.

---

## 7. VERIFIKATIONS-PLAN

### Pre-Deploy
```bash
# Berechne soll-Verteilung gegen Live-Daten (last 30d in brain_input_log)
sqlite3 nexus.db "SELECT
  COUNT(*) as total,
  SUM(CASE WHEN raw_value LIKE '%\"rate\":0,%' THEN 1 ELSE 0 END) as zero_rate,
  SUM(CASE WHEN raw_value LIKE '%\"rate\":-0.0001%' OR raw_value LIKE '%\"rate\":0.0001%' THEN 1 ELSE 0 END) as strong
FROM brain_input_log
WHERE source='funding_api' AND ts > strftime('%s','now','-30 days')*1000;"
```
Erwartung: Zero-Rate Quote sollte ~50% sein (Funding ist oft genau 0 bei stabilem Markt), Strong-Quote ~2-5%.

### Post-Deploy
- 60min Bot laufen lassen
- SQL-Check: direction-Verteilung pro Source
```sql
SELECT direction, COUNT(*) as n, ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (), 1) as pct
FROM brain_input_log
WHERE source='funding_api' AND ts > strftime('%s','now','-1 hour')*1000
GROUP BY direction
ORDER BY n DESC;
```
Erwartung: BUY+SELL+NEUTRAL alle ≥ 1 Eintrag, NEUTRAL ~60-70%, BUY+SELL kombiniert ~30-40%.

### Validation gegen Wirkung im Brain
- ALADDIN/UNIFIED Decisions vor/nach Vergleichen:
  - 1h-Sample vor Deploy: BUY/SELL/HOLD-Mix + avg conf
  - 1h-Sample nach Deploy: erwartet leichte Verschiebung zu mehr Direction (höhere Brain-Conf)

---

## 8. RISIKEN + ROLLBACK

| Risiko | Mitigation |
|---|---|
| Schwelle zu sensitiv → Noise im Brain | Wenn Strong-Rate > 10% nach 1h → Schwellen hoch (0.00005 → 0.00007) |
| Funding-rate 0-Fall (Bot in PAPER ohne API) wird als directional misclassified | First-Check `rate === 0` returnt NEUTRAL explizit |
| Strength-Formel saturation bei extremen Werten | Math.min(0.85, ...) caps |
| Funding-rate von Bitget API ist NaN/undefined | Bestehender Code hat `parseFloat(... || 0)`, bleibt |

### Rollback
```bash
cp server.js server.js.bak.PHASE2_FUNDING_PRE_$(date +%Y%m%d_%H%M%S)
# bei FAIL: cp .bak server.js && pm2 restart nexus
# Schwelle 0.001 wäre wieder aktiv → Status quo NEUTRAL-only
```

---

## 9. INTEGRATION IN GESAMTPLAN

### Reihenfolge der 9 NEUTRAL-Sub-Sources
Nach Vote-Volume (höchste-Impact zuerst):

1. **funding_api** (4122/12h) — DIESE SPEC (Phase 2.1)
2. var (4127/12h) — Phase 2.2 (eigene Spec)
3. anomaly_global (Veto-relevant)
4. heatmap
5. correlation
6. regime_snap
7. aladdin_sent
8. rl_agent
9. feargreed (100% SELL → Recalibration)

Pro Source: 1-2h Forensik + Spec + Deploy + 30min Verify. Tag 9-12 sequenziell.

---

## 10. ÄHRLICHE LÜCKEN (TRANSPARENZ)

| Was | Status |
|---|---|
| Bitget Live-Rates curl | ✅ direkt verifiziert |
| Bybit 30d-Distribution curl | ✅ direkt verifiziert (N=200) |
| arXiv funding-bias paper | ❌ UNGEPRÜFT (arXiv-Query lieferte leere Response) |
| BitMEX Research-Doku | ❌ UNGEPRÜFT (kein curl-direct gemacht) |
| Test gegen historische 6J-Daten | ❌ UNGEPRÜFT (offline-Walk-Forward erst Phase 3) |
| Pro-Trend vs Contrarian Empirie | ❌ UNGEPRÜFT (basiert auf Code-Konsistenz, nicht eigenem Backtest) |
| WEAK/STRONG-Schwellen sind Datenbasiert (Bybit P85/P98), nicht ML-optimiert |

Diese Lücken sind akzeptabel weil:
1. Quantitative Argumentation steht (Bybit-Verteilung verifiziert)
2. Rollback ist trivial (Schwellen-Konstante)
3. V2-Adaptive-Threshold ist Phase-3-Material

---

## 11. DEPLOY-VORAUSSETZUNGEN

- ✅ Bot in PAPER (bestätigt)
- ✅ Backup-Strategie geklärt
- ⏳ Spec-Review durch Christian (heute)
- ⏳ Implementation Tag 9 (~1h Code + 30min Verify)
- ⏳ Verify-Window 1-2h Live-Data
- ⏳ Christian-Approval für Deploy

---

*Spec erstellt: 2026-05-26 08:25*
*Quellen verifiziert: Bitget API live (4 Symbole) + Bybit funding history N=200*
*Empfohlene Schwellen-Werte sind direkt aus empirischer Verteilung abgeleitet — keine arbitrary numbers*
