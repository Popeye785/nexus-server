# DIAGNOSE — Multi-KI-Voting (READ-ONLY)
**Datum**: 2026-05-19 11:58

---

## CODE-BEFUND

### Was ist MultiKI?
- **5-Voter-Quorum** (server.js Z.11241+):
  - SelfHeal
  - AnomalyDetector
  - StressTest
  - SecurityKI
  - Regime
- Quorum: **3/5 nötig** für PASS

### Wo wird MultiKI aufgerufen?
**Nur 1 Stelle**: `POST /api/multiki/vote` (Z.17998) — **manuell via UI-Button**.

**Kein Auto-Cycle**. Kein `setInterval`. Kein Aufruf in Brain-Decision-Pfad.

### Beeinflusst Multi-KI Trade-Decisions?
**NEIN**. Keine Stelle in DecisionFlow oder AladdinBrain prüft `MultiKI`-Result. Es ist ein **Read-only Health-Check-Widget**, dessen Output nur:
- in `MultiKI.history` (50 Einträge In-Memory)
- in Telegram bei FAIL
- im UI angezeigt wird

### Token-Abfrage: warum?
- POST-Endpoint ist seit AUDFIX_E001_PHASE2 (18.05.) **standardmäßig token-pflichtig**
- Token-Auto-Wrapper aus AUDFIX_MULTI_KI_UI (gleichen Tag) erkennt sessionStorage und schickt automatisch
- → **Sollte transparent sein** wenn Token einmal in Session gespeichert

Falls UI weiter Token-Prompt zeigt: `sessionStorage.getItem('deployToken')` ist leer/abgelaufen → Browser-Tab neu öffnen oder neu eingeben.

---

## ANTWORTEN

### 1) Sollte Multi-KI automatisch laufen?

**JA** — sinnvoll als 30-min-Health-Probe. Aktuell ist es ein **toter Button** der nichts steuert.

### 2) Token-Abfrage Sicherheitsfeature mit gutem Grund?

**Halb-richtig**:
- POST-Schutz allgemein ja (AUDFIX_E001_PHASE2)
- Für Health-Check-Action (read-write nur in MultiKI.history) eigentlich **überschützt**
- UX-Bug: Token-Prompt im Browser ist verwirrend
- Lösung: entweder Auto-Cycle (kein UI nötig) ODER separater token-freier GET-Endpoint

### 3) UX-Bug-Fix

**Option 1 — Auto-Voting (empfohlen)**:
```js
setInterval(() => MultiKI.vote('AUTO_HEALTHCHECK', {}), 30*60*1000);
```
- Läuft alle 30 min im Hintergrund
- UI zeigt letztes Vote ohne Knopfdruck
- Telegram-Alert nur bei FAIL (Dedup pro Voter-Set)
- **Aufwand: 15-30 min**

**Option 2 — GET-Endpoint token-frei**:
```js
app.get('/api/multiki/healthcheck', async (req, res) => res.json(await MultiKI.vote('READONLY_CHECK', {})));
```
- UI-Button ruft GET statt POST
- Kein Token nötig
- **Aufwand: 10 min**

**Option 3 — Beides** (Auto-Cycle + GET-Read-Only):
- Auto-Cycle 30 min als Background-Health
- GET-Endpoint für manuelles Refreshen
- **Aufwand: 30-40 min**

### 4) Aufwand für Auto-Voting

| Variante | Aufwand |
|---|---|
| Reines Auto-Cycle 30 min | 15-30 min |
| GET-Endpoint zusätzlich | +10 min |
| Telegram-Dedup für FAIL-Quorum | +10 min |
| **Gesamt Production-Ready** | **30-50 min** |

### 5) Risiken Auto-Voting

| Risiko | Schwere |
|---|---|
| **Telegram-Spam** wenn dauernd FAIL | mittel — Dedup wie heute Vormittag löst |
| **Performance-Overhead** | gering — 1× alle 30 min, kein Hotpath |
| **MultiKI history überläuft** | gering — auf 50 In-Memory begrenzt |
| **Beeinflusst Brain-Decisions?** | KEIN — wurde geprüft, isoliert |
| **Multi-KI sagt FAIL → User-Verwirrung** | mittel — UI muss klar erklären |

---

## EMPFEHLUNG

**Auto-Voting alle 30 Min einbauen (Option 3)** mit:
1. setInterval(30 min) für MultiKI.vote('AUTO_HEALTHCHECK')
2. Telegram-FAIL-Dedup (Hash aus failed-voter-set + 1h-Window)
3. GET `/api/multiki/healthcheck` ohne Token für UI-Read-Only
4. UI-Button "ABSTIMMUNG STARTEN" → GET (kein Token-Prompt mehr)

→ **Bessere UX**, **Hintergrund-Monitoring**, **kein Spam**.

**ABER**: Multi-KI ist aktuell **nicht trade-relevant**. Sollte aus Christian's Sicht echter Mehrwert sein:
- Voter sind UMFASSEND (SelfHeal+Anomaly+Stress+Security+Regime) → Health-Bild
- Aber Brain hat ALREADY 4 Sicherheitsschichten + 4 Ebenen — Multi-KI ist redundant

**Realistische Einordnung**: Multi-KI ist ein **dekoratives 5-Voter-Widget**, das im aktuellen Setup keine echte Funktion hat außer "Bot-Gesundheit zeigen".

→ Auto-Voting würde Widget nützlich machen ohne Trade-Logik anzufassen.

---

## STATUS

- macro_events: **84 Events** (77 hardcoded + 7 ForexFactory, kein DELETE-Loop mehr) ✅
- Bot: PM2 R=142, PAPER, Wallet 999.024, Drift 0
- Multi-KI: unverändert, **kein Patch** in diesem Block
