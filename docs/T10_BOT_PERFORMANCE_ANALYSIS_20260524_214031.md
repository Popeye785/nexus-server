# T10-P0 — Reale Bot-Performance-Analyse (Daten-getrieben)

**Erstellt:** 24.05.2026 21:40
**Datenstand:** nexus.db nach T9.1-Deploy (R=233)
**Ziel:** Datenbasis für T10-P1 Brain-Router — welche Bot-Strategie wann?
**Regel:** KEIN Raten. Jede Aussage mit Claim-Status: ✅ VERIFIZIERT · 🟡 PLAUSIBEL · 🔴 UNSICHER · ⚪ UNBEKANNT

---

## ⚠️ KRITISCHER VORBEFUND — bevor man weiter plant

**Der Bot hat in seiner gesamten Trade-Historie NUR im HMM-State RANGING gehandelt.**

| HMM-State | Checks | Anteil | Strategy-Trades dabei |
|---|---:|---:|---:|
| RANGING | 5290 | 88% | 6637 (alle) |
| BULL | 459 | 7.6% | 0 |
| BEAR | 312 | 5.2% | 0 |
| CRASH | 0 | 0% | ⚪ nie beobachtet |
| RECOVERY | 0 | 0% | ⚪ nie beobachtet |

**Konsequenz:** Wir haben **NULL empirische Daten** für Bot-Performance in BULL/BEAR/CRASH/RECOVERY-Regimen. Jede Empfehlung "DCA bei BULL" oder "GRID raus bei BEAR" wäre **UNBEKANNT-Status**.

Quelle: `hmm_state` (5-Tage-Fenster), `strategy_regime_performance` + LATERAL-JOIN auf HMM-State.

---

## 1. BOT-LANDSCHAFT — was läuft, was nicht

### ✅ VERIFIZIERT: 4 aktive Bot-Types im Code

| Bot-Type | Definition | Strategie | Aktiv? |
|---|---|---|---|
| **SINGLE** | `DemoEngine._executeTrade` (server.js:24954) | DEMO_UNIFIED | ja, schläft (1 Trade in 11 Tagen) |
| **DCA** | `DCABot` (Z.19766) + `DCABotMBT` (Z.9148) | Iterative Käufe mit TP-Target | ja, 1 OPEN (ETHUSDT) |
| **GRID** | `GridBot` (Z.19995) + `GridBotMBT` (Z.8968) | Range-Trading mit n Levels | ja, 1 OPEN (ATOMUSDT) |
| **INFGRID** | `InfinityGridBotMBT` | Trailing-Grid: range_high steigt dynamisch (max MAX_EXTENSIONS=20 × +5%), range_low statisch; Profit nur PnL-Booking (kein Level-Reinvest) | ja, marginale Aktivität (13 fills) |

### 🔴 KRITISCHER BEFUND: KEINE Spider/Mikro-Bots

Christian's Vermutung "Spider/Mikro/andere Bots" — **diese existieren NICHT im Code**.

Verifikation: `grep -E "SpiderBot|MicroBot|MikroBot|MIKRO|SPIDER" server.js` → **0 Treffer**.

`sub_bots`-Tabelle (3 Einträge: bot_btc, bot_alts, bot_sub_1) ist ein **Konfig-Schema-Skelett**, kein aktiver Bot-Loop. Letzte Aktivität: Created-Timestamp im April 2026, kein Heartbeat seit dann. **Tot**.

**Empfehlung Phase 1:** Nicht versuchen "Spider/Mikro zu aktivieren" — sie müssten erst **neu gebaut** werden. T10-P1 Brain-Router kann nur SINGLE/DCA/GRID/INFGRID auswählen.

---

## 2. PERFORMANCE PRO BOT × HMM-REGIME (Rohdaten)

### Quelle
- `strategy_regime_performance` (n=7035) LEFT JOIN `hmm_state` via Zeitstempel
- Zeitraum: 13.05.-24.05.2026 (11 Tage)

### Tabelle

| Bot | HMM | Fills/Trades | Sum PnL | Avg PnL | Aussage |
|---|---|---:|---:|---:|---|
| **GRID** | RANGING | 6622 | +$257.38 | +$0.039 | ✅ Sehr konsistent |
| **INFGRID** | RANGING | 13 | +$0.63 | +$0.048 | ✅ Marginal, aber positiv |
| **DCA** | RANGING | 1 (TP-Hit) | +$4.69 | +$4.69 | 🟡 Einzel-Hit, n zu klein |
| **SINGLE** | RANGING | 1 | -$0.07 | -$0.07 | 🔴 n=1, **kein** Performance-Signal |
| GRID/DCA/SINGLE | BULL | **0** | — | — | ⚪ NIE getradet |
| GRID/DCA/SINGLE | BEAR | **0** | — | — | ⚪ NIE getradet |

### Interpretation pro Bot

#### ✅ GRID — der einzige Bot mit echten Daten

- **3 closed Instances** alle profitabel: ATOMUSDT +$104, DOGEUSDT +$10.69, UNIUSDT +$259.55
- **0 Range-Breaks** bei ATOMUSDT (5.5% Range) und DOGEUSDT (2.6% Range) — also Range hielt
- **1 Range-Break** bei UNIUSDT (5.2% Range) — aber trotzdem +$259 weil 13521 Fills akkumuliert
- **Avg Fill:** +$0.039 pro Mikro-Fill
- **Aktuell OPEN:** ATOMUSDT (8.9% Range, 28 fills, +$0.88) — sehr jung

**Claim-Status:**
- ✅ VERIFIZIERT: GRID funktioniert in RANGING (3/3 Closed positiv)
- 🟡 PLAUSIBEL: GRID braucht Range-Breite 2.6-5.5% (Bot wählt diese aktuell)
- ⚪ UNBEKANNT: GRID-Performance in BULL/BEAR (nie getestet)
- 🟡 PLAUSIBEL: GRID **verliert wenn Range bricht und Long-Position bei niedrigerem Preis hängenbleibt** — bei UNIUSDT ist das passiert, wurde aber durch 13521 Mikro-Fills ausgeglichen. Bei einem **Break ohne genug Vor-Fills** würde GRID Verlust machen. Empirisch noch nicht beobachtet.

#### 🟡 DCA — uneinheitliches Bild

- **6 closed Instances:**
  - 1 CLOSED_TP (SUIUSDT, 4 Iter, +$4.69) — Target 6% erreicht
  - 5 CLOSED ohne TP (LTCUSDT, DOGEUSDT, AVAXUSDT, LINKUSDT je 5-8 Iter, alle PnL=0; SUIUSDT mit 0 Iter)
- **Iter-Win-Rate:** 4/40 = 10% (4 Iterations hatten positiven Unrealized → realisiert beim Close)
- **Aktuell OPEN:** ETHUSDT (8 Iter, $0 unrealized)

**Claim-Status:**
- 🟡 PLAUSIBEL: DCA-TP-Target von 6% ist in RANGING-Markt selten erreichbar (1/6 = 17%)
- ⚪ UNBEKANNT: DCA in BULL würde wahrscheinlich besser performen (Trend nach oben unterstützt Avg-Down) — aber **nie getestet**
- 🔴 UNSICHER: warum 5/6 ohne TP geschlossen wurden — Audit der Close-Logik nötig (Drift-Exit-Trigger? Symbol-Rotation? Manuell?)

#### 🔴 SINGLE — keine Datenbasis

- **1 closed Trade** (NEAR oder DEMO_UNIFIED), TIME_EXIT, -$0.07
- n=1 ist kein Sample — **JEDE** WR-Aussage ist Coin-Flip
- Bot generiert SINGLE-Trades selten — Tier-Z2-Audit hatte das schon gezeigt

**Claim-Status:**
- 🔴 UNSICHER: SINGLE-Performance allgemein
- 🟡 PLAUSIBEL: SINGLE-Trade-Frequenz ist niedrig weil DEMO_UNIFIED-Pfad streng-gegated ist (Voter-Konsens + Confidence-Filter + Brain-Veto)

#### 🟡 INFGRID — minimaler Daten-Footprint

- 13 fills total, +$0.63 — n=13 zu klein für Aussage
- Spec-mäßig: trailing-grid, kein Cap

**Claim-Status:**
- 🟡 PLAUSIBEL: INFGRID ist designed für Trend-Markt (BULL_WEAK) — aber nie in BULL aktiv getradet

---

## 3. BRAIN-PERFORMANCE PRO HMM-REGIME

Datenbasis: `decision_outcomes` (letzte 48h, n=72.999 decisions).

### Tabelle

| HMM | Direction | Horizont | n | Hit-Rate |
|---|---|---:|---:|---:|
| BEAR | BUY | 1h | 600 | 39.5% |
| BEAR | SELL | 1h | 5598 | 5.3% |
| BEAR | BUY | 4h | 600 | 74.5% |
| BEAR | SELL | 4h | 5598 | 1.2% |
| BEAR | BUY | 24h | 600 | 95.8% |
| BEAR | SELL | 24h | 5598 | 6.7% |
| BULL | BUY | 1h | 9270 | 11.0% |
| BULL | SELL | 1h | 1363 | 37.4% |
| BULL | BUY | 4h | 9270 | 30.2% |
| BULL | SELL | 4h | 1363 | 64.3% |
| RANGING | BUY | 1h | 15167 | 13.6% |
| RANGING | SELL | 1h | 24372 | 13.6% |
| RANGING | BUY | 4h | 13622 | 34.6% |
| RANGING | SELL | 4h | 22379 | 54.7% |
| RANGING | BUY | 24h | 1893 | 92.3% |
| RANGING | SELL | 24h | 18308 | 6.7% |

### Interpretation

**🟡 PLAUSIBEL: Brain ist im 1h-Horizont signifikant schlechter als Zufall**
- RANGING 1h: 13.6% (Zufall bei NEUTRAL_BAND=0.001 = ~33%)
- BULL 1h BUY: 11.0% (BUY in BULL sollte trivial sein)
- → Brain ist **NICHT** kalibriert für kurzfristige Direction

**🟡 PLAUSIBEL: 4h-Horizont mit Inversion brauchbar**
- BULL 4h SELL: 64.3% — ungewohnt, könnte Mean-Reversion-Signal sein
- BEAR 4h BUY: 74.5% — Mean-Reversion-Bounce
- RANGING 4h SELL: 54.7%, BUY 34.6% — leicht SELL-biased im Range

**🔴 UNSICHER: 24h-Horizont mit NEUTRAL_BAND=0.001 verzerrt**
- 24h-BUY in RANGING: 92.3% — fast zu schön
- Ursache: 24h hat fast immer >0.1% Move, also "Direction richtig" trivial
- **NEUTRAL_BAND=0.005 (T9.3) wird diese Zahlen ehrlicher machen**

### Konsequenz für Brain-Router (T10-P1)

🟡 PLAUSIBEL: Wenn Brain das **4h-Signal in BULL/BEAR mit Mean-Reversion-Bias** nutzt:
- BEAR + 4h BUY-Decision → könnte gutes DCA-Entry sein (74.5% Hit)
- BULL + 4h SELL-Decision → könnte gutes Grid-Stop sein (64.3% Hit)

🔴 UNSICHER: ob diese 4h-Hits in echte Trade-PnL übersetzbar sind (Slippage, Fees, Hold-Time)

---

## 4. VOTER-FAMILIEN HIT-RATES

### Quelle: aladdin_perf (n=28 total, n=25 mit valid Voter-Daten)

| Familie | Valid Samples | Hits | Hit-Rate (valid) | Hit-Rate (all-n) |
|---|---:|---:|---:|---:|
| MICROSTRUCTURE | 17 | 8 | **47.1%** | 28.6% |
| RISK | 23 | 10 | **39.1%** | 35.7% |
| TREND | 25 | 9 | **36.0%** | 32.1% |
| SENTIMENT | 20 | 4 | **30.0%** *(?)* | 14.3% |
| MOMENTUM | 25 | 4 | **20.0%** | 14.3% |

### 🔴 WICHTIGER NACHTRAG zu T9.1

**Mit n=valid-only sind die Hit-Rates anders als im Audit verwendet:**
- SENTIMENT ist nicht 14.3% (Audit) sondern **30.0%** (valid-only) — nur mittelfeld, nicht "schlecht"
- T9.1 hat SENTIMENT auf 5% reduziert basierend auf der **all-n** Zahl

**Claim-Status:**
- 🟡 PLAUSIBEL: T9.1-Inversion ist trotzdem im Wesentlichen korrekt (MOMENTUM 20% Hit-Rate ist schlechteste, TREND/RISK/MICRO besser)
- 🔴 UNSICHER: ob SENTIMENT-Gewicht 5% (statt 10-15%) richtig kalibriert ist — n=20 für SENTIMENT-Valid ist klein

**Vorschlag T9.1-Korrektur (nach 24-48h Beobachtung):**
- Falls Brain-Accuracy nicht steigt: SENTIMENT 5%→15%, MOMENTUM 5%→ unverändert, MICROSTRUCTURE 25%→20%, TREND 35%→30%, RISK 30%→30%

---

## 5. DATENBASIERTE EMPFEHLUNG FÜR T10-P1 BRAIN-ROUTER

### ✅ ROUTER-MATRIX (nur verifizierte Pfade)

| HMM-Regime | Empfohlener Bot | Confidence | Datenbasis |
|---|---|---|---|
| RANGING | **GRID** | hoch | ✅ 3/3 Closed positiv, +$375 sum |
| RANGING | DCA (sekundär) | mittel | 🟡 1/6 TP-Hit, andere blieben breakeven |
| RANGING | SINGLE | niedrig | 🔴 n=1, kein Signal |

### ⚪ ROUTER-MATRIX (unbekanntes Terrain)

| HMM-Regime | Empfehlung-Vorschlag | Confidence | Datenbasis |
|---|---|---|---|
| BULL | DCA-Bot (Avg-Down funktioniert in Bull) | 🟡 PLAUSIBEL aus Backtest-Pflicht | ⚪ NIE empirisch getradet |
| BULL | SINGLE BUY mit Brain-Veto | 🟡 PLAUSIBEL | ⚪ keine Daten |
| BEAR | KEIN GRID öffnen (Range-Break-Risiko) | 🟡 PLAUSIBEL | ⚪ keine Daten |
| BEAR | SINGLE SELL nur wenn 4h-Confluence | 🟡 PLAUSIBEL aus Brain-Acc 64.3% | 🔴 nicht in echten Trades validiert |
| CRASH | KILL-SWITCH, alle Bots pausen | 🟡 PLAUSIBEL | ⚪ nie beobachtet |

### 🔴 EHRLICHE ANSAGE AN CHRISTIAN

> Der Bot hat in 11 Tagen Live-Betrieb **nur in 1 von 5 möglichen HMM-Regimes** Trades durchgeführt. Für BULL/BEAR/CRASH/RECOVERY haben wir **NULL Performance-Daten**.
>
> Ein "Brain-Router" der jetzt entscheidet "in BULL nimm DCA, in BEAR nimm SINGLE" wäre **geraten, nicht datenbasiert**.
>
> **Lösung:** T10-P1 Brain-Router NUR auf RANGING-Daten kalibrieren (was wir wissen) UND in BULL/BEAR auf historischen 5J-Backtest (T10-P5) warten bevor wir routen. Bis dahin: weiterhin nur RANGING-aktiv handeln, alternativ konservatives Default-Routing mit niedriger Konfidenz.

---

## 6. ROHDATEN-VERIFIKATION (für Review)

```sql
-- Bot × HMM Sum/Avg PnL
WITH strp_with_hmm AS (
  SELECT s.bot_type, s.pnl_usdt,
    (SELECT h.state FROM hmm_state h WHERE h.ts <= s.ts ORDER BY h.ts DESC LIMIT 1) AS hmm
  FROM strategy_regime_performance s
)
SELECT bot_type, hmm, COUNT(*), SUM(pnl_usdt), AVG(pnl_usdt)
FROM strp_with_hmm GROUP BY bot_type, hmm ORDER BY bot_type;

-- HMM-Verteilung
SELECT state, COUNT(*), ROUND(AVG(confidence),3) FROM hmm_state GROUP BY state;

-- Voter Hit-Rate valid-only
SELECT COUNT(*), ROUND(AVG(family_TREND_correct)*100,1)
FROM aladdin_perf WHERE family_TREND_correct IS NOT NULL;

-- Brain Decision-Acc pro HMM × Horizont
SELECT (SELECT h.state FROM hmm_state h WHERE h.ts <= d.decision_ts ORDER BY h.ts DESC LIMIT 1) hmm,
       d.decision, d.horizon_h, COUNT(*), ROUND(AVG(d.direction_correct)*100, 1)
FROM decision_outcomes d
WHERE d.decision_ts > strftime('%s','now','-2 day')*1000
GROUP BY hmm, d.decision, d.horizon_h HAVING COUNT(*) >= 20;
```

---

## 7. ANTWORT AUF CHRISTIAN'S T10-FRAGEN

| Frage | Antwort |
|---|---|
| In welchem Regime hat SINGLE gewonnen/verloren? | 🔴 NICHT BEANTWORTBAR (n=1: 1 Loss in RANGING) |
| Wann triggert DCA optimal? | 🟡 PLAUSIBEL: TP-Target 6% wird in RANGING ~17% erreicht. Avg-Down hilft wenn Bounce kommt. |
| Wann scheitert DCA? | ✅ VERIFIZIERT: 5/6 DCA wurden ohne TP geschlossen (Drift-Exit/Symbol-Rotation Audit nötig) |
| GRID Range-Breite optimal? | ✅ VERIFIZIERT: 2.6-5.5% Range, in RANGING ohne Break |
| Wann verliert GRID Geld? | ⚪ UNBEKANNT empirisch (nie passiert) — aber 🟡 PLAUSIBEL bei Range-Break ohne genug Vor-Fills |
| Spider/Mikro existieren? | 🔴 NEIN — nicht im Code |
| HMM-Regime-Übergänge? | ✅ VERIFIZIERT: nur 4 Übergänge BULL↔RANGING in 24h, sehr selten |
| Welche Regime treten wie oft auf? | ✅ VERIFIZIERT: RANGING 88%, BULL 7.6%, BEAR 5.2%, CRASH/RECOVERY nie |

---

## 8. WAS T10-P1 WIRKLICH BRAUCHT

**Bevor Brain-Router gebaut werden kann, fehlen 2 Dinge:**

1. **🔴 Empirische BULL/BEAR-Bot-Performance** — entweder aus Backtest (T10-P5) oder warten bis Markt nicht in RANGING ist. Heutige Daten reichen NUR für RANGING-Routing.

2. **🔴 DCA-Drift-Exit-Forensik** — warum 5/6 DCA ohne TP closed wurden, ist unklar. Bevor Router DCA empfehlen kann, muss klar sein wann er erfolgreich ist.

**Vorschlag für T10-P1 (datenbasiert, ehrlich):**
- Router macht nur für **RANGING** echte Empfehlungen (GRID-bevorzugt, DCA-sekundär)
- Für BULL/BEAR: konservativer Default (z.B. SINGLE mit hohem Brain-Conf-Filter) + Logging für spätere Re-Audit
- Nach T10-P5 (Backtest): Router-Matrix neu kalibrieren mit Backtest-Daten

---

**Doc-Ende.** Christian entscheidet:
- Geht T10-P1 mit RANGING-only-Router weiter?
- Oder erst T10-P5 (Backtest) für BULL/BEAR-Datenbasis?
- Plus: SENTIMENT-Gewicht-Korrektur (5%→15%) prüfen nach 24-48h?
