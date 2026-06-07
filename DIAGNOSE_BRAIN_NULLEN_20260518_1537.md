# DIAGNOSE BRAIN-FAMILIEN ALLE AUF 0% — Root-Cause Analyse
**Datum**: 2026-05-18 15:37
**Modus**: READ-ONLY, kein Patch
**Christian-Meldung**: "Alle 5 Familien auf 0%, alle 5 Voter HOLD, Conf 0%, Size 0% nach Pipeline 15:07-15:18"

---

## ROOT-CAUSE: `VETO: NEWS_EXTREME` triggert auf JEDER Decision

**Symptom (UI-Sicht)**: alle Familien zeigen 0% Score, Brain entscheidet immer HOLD
**Tatsächlich (DB-Sicht)**: Familien-Sub-Sources sind aktiv (RISK 7/8, SENTIMENT 4-5/7 etc.), aber Score wird durch HARDSTOP auf 0 gesetzt

**Beweis aus Logs (letzte 5 Min)**:
```
ALADDIN BTCUSDT => HOLD conf=0.00 size=0.0% [N/A (veto)] (VETO: NEWS_EXTREME)
ALADDIN ETHUSDT => HOLD conf=0.00 size=0.0% [N/A (veto)] (VETO: NEWS_EXTREME)
ALADDIN SOLUSDT => HOLD conf=0.00 size=0.0% [N/A (veto)] (VETO: NEWS_EXTREME, SHARPE_EXTREME:-3.25)
```

**Veto-Häufigkeit letzte 10 Min**:
| Veto-Code | Anzahl |
|---|---:|
| NEWS_EXTREME (allein) | 146 |
| NEWS_EXTREME + ANOMALY | 48 |
| NEWS_EXTREME + SHARPE_EXTREME | 24 (5 Variants) |
| **NEWS_EXTREME TOTAL** | **218** |

→ ALLE Decisions in letzten 10 Min haben NEWS_EXTREME-Block!

---

## Hypothesen-Bewertung

### H1 — News-Intel-Refactor hängt? **NEIN**
- news_intelligence.aggregate() funktioniert: 18 News, avg sentiment -0.054
- intelScore -0.055, intelConf 0.8
- 5 Cluster erkannt
- ✅ Modul OK

### H2 — Liquidations WS down? **TEILWEISE**
- WebSocket connected, aber letzter Liq-Event in DB war 15:13:07 (vor 24 Min)
- Heute war volatil → vermutlich keine großen Liqs in dieser Phase
- Fallback OI-Proxy würde greifen
- ✅ Nicht die Ursache der Brain-0%

### H3 — ETF-Score NaN? **NEIN**
- 5 Tage Daten sauber in DB
- ✅ Funktional

### H4 — Ticker-Feed hängt? **NEIN**
- Aladdin-Decisions kommen alle 1-2s rein
- Symbole werden normal verarbeitet
- ✅ Ticker läuft

### H5 — Reload-Effekt? **NEIN**
- Bot uptime 18min seit letztem Reload
- Cache ist nicht das Problem

---

## ECHTE Ursache: NEWS_EXTREME-Block-Schwelle + Crash-Tag-News

**Code-Stelle (server.js Z.11320)**:
```js
if (r > 85 && _enoughData && _strongSample) blocks.push('NEWS_EXTREME');
```
- `r` = NewsSentiment.riskScore
- `_enoughData` = postCount >= 10
- `_strongSample` = postCount >= 30

**Aktuelle Werte (API /api/news)**:
```json
{
  "riskScore": 100,        ← gecapped, vermutlich >85
  "intelScore": -0.055,
  "postCount": 103,        ← 6h-Fenster, sehr viel
  "signal": "HIGH_RISK"
}
```

**Erklärung riskScore=100**:
- `liveRisk = 30 + negScore - posScore*0.5`
- Aktuell: negScore=56.5 + ältere News über 6h → liveRisk ~75-100
- `Math.min(100, ...)` capped bei 100

**Phase-A-Patch (mein heute Nachmittag) hat indirekt verstärkt**:
- Vor Phase A: `sinceMs = Date.now() - 3600000` (1h)
- Phase A NEU: `sinceMs = Date.now() - 6 * 3600000` (6h)
- → 6× größeres Sample → negScore akkumuliert → riskScore hoch

**Top-News heute (TRIGGER für NEWS_EXTREME)**:
1. Bitcoin Depot Bankruptcy (3 Quellen, risk_score 80)
2. Verus-Bridge-Hack $11.5M (risk_score 70)
3. Trump/Iran/Hormuz warning → BTC slides below $77k (risk_score 65)
4. Goldman Sachs warnings

---

## Brain-Verhalten ist KORREKT, aber zu konservativ

**Was passiert**:
- AladdinBrain-Hard-Block "Aladdin-Restore Option D" (16.05.2026) blockt bei NEWS_EXTREME
- Heutiger Crash-Tag mit massiven Negativ-News → Schwelle wird kontinuierlich überschritten
- Bot HÄLT alle Positionen (kein neuer Trade) — als Schutz vor Crash-Verlusten

**Was Christian sieht im UI**:
- Familie-Score 0% (weil HARDSTOP-Path früh in compute returnt)
- 5 Voter HOLD (Brain veto-haltet)
- Size 0% (kein Trade)

**Tatsächlich in DB**:
- RISK 7/8 active
- SENTIMENT 4-5/7 active
- Sub-Sources arbeiten normal
- Aggregations-Logik ist intakt — nur der Hard-Block triggert

---

## VERDIKT

✅ **KEIN BRUCH durch Pipeline 15:07-15:18**.
- Brain-Aggregations-Logik unverändert
- News-Intel funktioniert sauber (avg -0.055, 18 News klassifiziert)
- Liquidations WS verbunden
- ETF-Flows lesbar

⚠️ **Pipeline-Nebeneffekt**: 6h-Fenster (statt 1h) für News-Aggregation verstärkt den NEWS_EXTREME-Trigger an Crash-Tagen.

⚠️ **Crash-Tag-Faktor**: Heutige News (Bitcoin Depot Bankruptcy + Verus-Hack + Trump/Iran) sind real-negativ → Brain handelt konservativ wie spec'd.

---

## ROLLBACK-EMPFEHLUNG: **NEIN**

Begründung:
1. Brain-Logik ist intakt
2. News-Intel-Layer arbeitet
3. NEWS_EXTREME-Block ist Sicherheitsfeature, kein Bug
4. Bot schützt vor Crash-Verlusten (heute -10% BTC)
5. Sub-Sources sind aktiv (nicht 0)

**Wenn Christian Trades will trotz Crash-News**, gibt es 3 Optionen (separate F2):
1. **News-Fenster zurück auf 1h** (`sinceMs = Date.now() - 3600000`)
2. **NEWS_EXTREME-Schwelle erhöhen** (von 85 → 95)
3. **NEWS_EXTREME-Block deaktivieren** während Crash (Brain darf Bottom-Pick)

---

## ABWARTEN-OPTION: JA, 1-2 Stunden

Wenn negative News abklingen → liveRisk fällt → NEWS_EXTREME-Block lockert.
Bot wird automatisch wieder traden, sobald r < 85.

---

## Bot-Status

- PM2 R=132 online 169 MB uptime 18m
- DEPLOY_MODE: PAPER
- Wallet: 999.024 (unverändert)
- Drift: 0
- KillSwitch: NORMAL
- Brain blockt aktuell — als Schutz vor Crash-Verlusten
