# DIAGNOSE — Strategie-Performance pro Markt-Phase (READ-ONLY)
**Datum**: 2026-05-19 11:02
**Modus**: READ-ONLY

---

## ROHDATEN

### SINGLE-Trades pro Regime (state=CLOSED, alle 27)

| Regime | Trades | Total PnL | Avg PnL | Win-Rate |
|---|---:|---:|---:|---:|
| **NEUTRAL** | **27** | -0.976 USDT | -0.036 | **37.0%** |

⚠️ **Alle 27 closed SINGLE-Trades waren in NEUTRAL** — keine BULL/BEAR-Daten zum Vergleich.

### GRID-Performance (gesamt)

| Symbol | Status | profit_acc | Fills | Range-Breaks |
|---|---|---:|---:|---:|
| **UNIUSDT** | OPEN | **+22.04** | 1904 | 0 |
| DOGEUSDT | CLOSED | +10.69 | 1819 | 1 |
| ATOMUSDT | OPEN | +9.48 | 761 | 0 |
| ATOMUSDT (2) | OPEN | +0.25 | 15 | 0 |

**GRID Total: +42.49 USDT** über 4 Grids — alle profitabel!

### DCA-Performance

| Symbol | Status | Iterations | Total Spent |
|---|---|---:|---:|
| LINKUSDT | CLOSED | 8 | 160 USDT |
| AVAXUSDT | CLOSED | 7 | 140 USDT |
| DOGEUSDT | OPEN | 4 | 80 USDT |
| LTCUSDT | OPEN | 4 | 80 USDT |
| SUIUSDT | CLOSED | 0 | 0 USDT |

⚠️ `dca_iterations` hat **keine `pnl`-Spalte** — PnL nicht direkt berechenbar.

### Regime-Verteilung letzte 7 Tage (aladdin_decisions)

| Consensus-State | Decisions |
|---|---:|
| N/A (veto) | 57.865 (NEWS_EXTREME / SHARPE_EXTREME) |
| 1B/3S/1N (5 aktiv) | 22.058 |
| 2B/2S/1N | 19.770 |
| 1B/2S/2N | 14.515 |
| 3B/1S/1N | 14.443 |
| 4B/0S/1N | 12.525 |

→ **Regime-Klassifikation** wird in DB nicht direkt gespeichert; Live: `NEUTRAL` (conf 0.5).

### Backtest-Runs: nur 5 in 30 Tagen (wenig Daten)

---

## ANTWORTEN

### A) In welcher Marktphase ist SINGLE Hauptverdiener?
**UNKLAR aus Live-Daten.** Alle 27 closed SINGLE-Trades waren in NEUTRAL → -0.97 USDT.
Aus **MetaBrain-Map** (server.js Z.8305) ist SINGLE designiert für:
- **BULL_STRONG** (Trend-Mitlaufen)
- **SQUEEZE** (Pre-Breakout)

Live-Daten **bestätigen das nicht**, weil nie in BULL_STRONG/SQUEEZE getradet (NEUTRAL dominiert).

### B) GRID & DCA Performance

**GRID**: ✅ **+42.49 USDT in 4 Grids** — klarer **Hauptverdiener** im Bot!
- UNI: +22 USDT (großer Range, 1904 Fills)
- DOGE: +10 USDT
- ATOM: +9.7 USDT (2 Grids)

Per Map: GRID läuft in **RANGING** (klassischer Use-Case). Daten bestätigen Performance.

**DCA**: ⚠️ schwer messbar ohne PnL-Spalte. LINK 8 Iterations + AVAX 7 = ~30 USDT Buys, gewinnt durch DD-Recovery.
Per Map: DCA für **BEAR_WEAK** (langsamer Bear, akkumulieren).

### C) Markt-Phasen-Verteilung letzte 7 Tage

**Regime-Klassifikation** wird nicht persistiert — nur aktueller Wert verfügbar:
- Live aktuell: **NEUTRAL** (conf 0.5)
- Aus aladdin_decisions: 57.865 Vetos (NEWS_EXTREME) + Mixed-Consensus → meiste Phase neutral mit Bear-Tendenz

→ **Keine guten Daten für Regime-Verteilung** in DB.

### D) Ist 40/25/20/15 wirklich starr?

**NEIN — MetaBrain Regime-Routing existiert:**

```js
REGIME_TO_BOTTYPE = {
  'BULL_STRONG':  'SINGLE',
  'BULL_WEAK':    'INFGRID',
  'NEUTRAL':      'CONSERVATIVE',
  'RANGING':      'GRID',
  'SQUEEZE':      'SINGLE',
  'BEAR_WEAK':    'DCA',
  'BEAR_STRONG':  'CONSERVATIVE',
  'EXTREME_VOL':  'CONSERVATIVE',
}
```

**`CFG.MULTI_BOTTYPE_AUTO_INVOKE = true`** seit Z.336 — also Auto-Create AKTIV (auf Disk seit längerem).
Aber: **alle SINGLE-Trades in NEUTRAL** → MetaBrain routed NEUTRAL → CONSERVATIVE → skip → SINGLE wird NICHT bevorzugt.

Aktuell läuft also so:
1. Regime aktuell NEUTRAL → MetaBrain sagt CONSERVATIVE (skip)
2. SINGLE trotzdem aktiv weil _default_ Pfad (CFG.AUTONOMOUS_DEMO_TRADES_ENABLED)
3. GRID-Pool ist 2/2 (full) → keine neuen GRIDs trotz Auto-Invoke
4. CapitalPool 40/25/20/15 ist fix-quotiert

**Verdikt**: Regime→BotType-Map ist da, aber **MULTI_BOTTYPE_AUTO_INVOKE wechselt nicht das Capital-Pool-Quoten**, sondern entscheidet nur ob neue Bots erstellt werden. Capital bleibt fix bei 40/25/20/15.

### E) Empfehlung

| Option | Aufwand | Wirkung |
|---|---|---|
| **A) Adaptive Capital (Regime-basiert)** | 2-3h | Quoten verschieben je Regime |
| **B) Adaptive Capital (Performance-basiert)** | 2-3h | Quoten nach 7d-PnL gewichten |
| **C) Beides kombiniert** | 3-4h | maximaler Effekt |

**Empfehlung**: **C) Hybrid** — wenn Live-Daten zeigen dass GRID +42 USDT macht und SINGLE -1 USDT, sollte Capital-Quote nicht starr 40/25 bleiben. Performance-Gewichtung wäre logisch.

**ABER vorher Daten-Lücke schließen**:
1. **Regime-Historie persistieren** (5 min Patch) — sonst keine BULL/BEAR-Statistik
2. **`dca_iterations.pnl`-Spalte hinzufügen** — sonst kein DCA-Vergleich
3. **30 Tage warten** mit besserer Daten-Erfassung
4. **Dann erst** Capital-Anpassung

Sonst: **Bauchgefühl statt Daten**, exakt was Christian vermeiden wollte.

---

## KOMPAKT-ANTWORT

**A) SINGLE Hauptverdiener?** Live-Daten ZEIGEN NEIN (-0.97 USDT). MetaBrain-Spec sagt BULL_STRONG/SQUEEZE, aber nie in DB.

**B) GRID/DCA?** GRID ist der **echte Hauptverdiener** (+42.49 USDT). DCA-PnL nicht direkt messbar.

**C) Markt-Phasen 7d?** Nicht persistiert in DB. Live aktuell NEUTRAL.

**D) Quote starr?** **Halb**: MetaBrain-Map+AUTO_INVOKE wechselt BotType, aber Capital-Quote bleibt 40/25/20/15.

**E) Empfehlung**: Erst Daten-Lücken schließen (Regime-Persistence + dca_iterations.pnl), dann Performance-Gewichtung. Sonst → Bauchgefühl-Risk.

**Größter Datenlücke-Fix (1h)**:
- `regime_history`-Tabelle anlegen
- `Regime.detect()` jedes Mal mit INSERT abschließen
- Nach 7d echte BULL/BEAR/RANGING-Verteilung sichtbar
