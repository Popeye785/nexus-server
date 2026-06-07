# NEXUS V9 — MULTI-KI-AUDIT
**Datum:** 2026-05-24 09:35
**Stufe:** T0.7 (KRITISCHER STOPP-PUNKT)
**Auftrag:** Was ist Multi-KI? Genutzt? Sinnvoll? Empfehlung KEEP/REMOVE/FIX

---

## TL;DR — EMPFEHLUNG

**🟡 REMOVE** (sauber raus) ODER **KEEP** als ungenutzter Code mit Aktivierungs-Option

**Daten:**
- Multi-KI ist ein **Voting-System mit 5 Votern** (SelfHeal, AnomalyDetector, StressTest, SecurityKI, Regime)
- **0 Aufrufe** in den letzten 24h
- **Kein autonomer Trigger** — nur manueller UI-Button (der UI-Button existiert nicht mehr in aktuellem index.html, nur in BACKUP-Files)
- **Keine Brain-Integration** — Brain-Decisions werden NICHT durch MultiKI gefiltert
- **Memory-Last:** minimal (50-Element history)
- **CPU-Last:** 0 (nur on-demand)
- **Brain-Accuracy mit/ohne:** unverändert (weil nicht im Brain-Pfad)

→ **Code lebt verwaist.** UI ist weg, kein Auto-Trigger, keine Telegram-Integration, keine Brain-Integration. Pure orphan-feature.

---

## DETAIL-ANALYSE

### Was Multi-KI macht (server.js:11435+)

```js
const MultiKI = {
  requiredVotes: 3,
  voters: ['SelfHeal', 'AnomalyDetector', 'StressTest', 'SecurityKI', 'Regime'],
  history: [],  // 50-Element ring-buffer

  async vote(action, context) {
    // Sammelt 5 Boolean-Votes von:
    // - SelfHeal.fullCheck() → ok/issues
    // - AnomalyDetector.shouldBlock('BTCUSDT') → block
    // - StressTest.run() → pass/fail
    // - SecurityKI.snapshot().status === 'OK'
    // - !['EXTREME_BEAR','FLASH_CRASH'].includes(Regime.regime)
    // 3 von 5 → GENEHMIGT, sonst ABGELEHNT
    // Bei ABGELEHNT: Telegram-Alert
  }
}
```

### Was Multi-KI NICHT macht

- **Keine Brain-Integration:** Wird in `AladdinBrain.decide()` NICHT aufgerufen
- **Keine Trade-Filterung:** Wird in `DemoEngine._executeTrade()` NICHT aufgerufen
- **Keine Eviction-Integration:** Wird in `EvictionEngine` NICHT aufgerufen
- **Keine periodische Ausführung:** Kein Cron, kein setInterval
- **Keine UI-Anzeige aktuell:** Code-Verweis nur in `.bak`-Files (Mai 11)

### Code-Stellen

| File | Lines | Status |
|---|---|---|
| `server.js:11435` | MultiKI-Objekt | Aktiv geladen |
| `server.js:19229` | `POST /api/multiki/vote` | Endpoint existiert, requireDeployToken |
| `server.js:19230` | `GET /api/multiki/snapshot` | Endpoint existiert, public |
| `public/index.html` | KEINE Verweise | UI komplett entfernt (vor 11.5.2026) |
| `public/index.html.bak.TIER14A_BIS_20260511_152048` | `2434, 2443, 6945-6951` | nur Historisch |

### Nutzungs-Stats

| Metric | Wert |
|---|---|
| API-Aufrufe (24h) | 0 |
| `system_log` MULTI_KI-Einträge (lifetime) | 0 |
| Memory-Footprint | ~5 KB (50-element history) |
| CPU-Impact | 0 (kein Cron) |

### Wirkungs-Analyse (was würde sich ändern)

**Bei REMOVE:**
- ~25 Code-Zeilen weniger in server.js
- 2 ungenutzte API-Endpoints weg
- Keine Trade-Logik-Auswirkung (war eh nicht im Brain-Pfad)
- Reduktion Komplexität

**Bei KEEP:**
- Code bleibt für ggf. spätere Reaktivierung
- Endpoints `/api/multiki/snapshot` + `/api/multiki/vote` bleiben verfügbar
- ~5 KB Memory dauerhaft gebunden
- Telegram-Alert-Code bei `passed=false` (würde aber nie feuern, weil keine Aufrufe)

**Bei FIX (Reaktivierung):**
- 1) Brain-Integration einbauen: `AladdinBrain.decide()` ruft `MultiKI.vote('TRADE_OPEN')` → bei ABGELEHNT skip
- 2) UI im SICHERHEIT-Tab wieder einbauen
- 3) Telegram-Command `/multiki` für on-demand-Vote
- Geschätzter Aufwand: 2-3h Engineering

---

## COST-BENEFIT-MATRIX

| Option | Effort | Reward | Risk |
|---|---|---|---|
| **REMOVE** | 10 min | -25 LOC, klarer Code | wenn später gewünscht → Re-Build nötig |
| **KEEP** | 0 min | nichts | tote Funktion, Reviewer-Verwirrung |
| **FIX (Brain-Integration)** | 2-3h | echte Voter-Filter vor jedem Trade | viele False-Blocks möglich; Brain ist schon mit D1-D7+G1-G7 sehr gefiltert |

---

## EMPFEHLUNG (mit Begründung)

### Christian-Entscheidung gefragt:

**A) REMOVE (empfohlen):**
- Pro: cleanere Codebase, kein orphan-feature
- Contra: wenn Christian später Voter-Gate haben will → Re-Build

**B) KEEP as-is:**
- Pro: kein Aufwand
- Contra: tote Funktion im Code, Reviewer-Frage "warum ist das da?"

**C) FIX (Brain-Integration):**
- Pro: zusätzliche Schutzschicht vor jedem Trade
- Contra: Brain hat schon **15+ Schutzschichten** (HARD_BLOCKS, BAYESIAN_VETO, FLOOR, D5/D6-Damping, RiskSizing, Pool-Limits, etc.). Multi-KI als 16. wäre redundant.
- Plus: Brain-Pfad ist sehr empfindlich auf False-Blocks (sehe T0.6 DRY_RUN-Phase) — neue Filter brauchen Backtest

### Meine Einschätzung
Wenn der Bot 5 Schutzschichten haben würde, wäre **FIX (C)** sinnvoll. Aber bei 15+ Schichten ist Multi-KI **redundant**. Empfehle **REMOVE (A)** um Komplexität zu reduzieren.

---

## STOPP-PUNKT

**🔴 KRITISCHER STOPP — Christian-Entscheidung erforderlich:**

```
A) REMOVE — sauber raus (10 min)
B) KEEP   — bleibt as-is, ungenutzt
C) FIX    — Brain-Integration (2-3h, Backtest-Risiko)
```

Ich pausiere T0.7 hier. **T1-T5 läuft weiter, da Multi-KI nicht im Trade-Pfad ist** und Pipeline nicht blockiert.

---

*Multi-KI-Audit abgeschlossen: 2026-05-24 09:35*
*Doc-Quelle für Christian-Entscheidung. T1-T5 läuft autonom weiter.*
