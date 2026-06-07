# FIX 8 SPEC — Echter Brain-Heartbeat (Cosmetic)

**Datum:** 2026-05-26 08:20
**Status:** SPEC ONLY (kein Code-Deploy heute)
**Priorität:** 🟢 LOW (Cosmetic — Bot funktioniert ohne diesen Fix)
**Aufwand:** geschätzt 15min Code + 5min Verify
**Audit-Referenz:** Punkt 2 aus Tag-8-Status

---

## 1. STATUS QUO — Bug-Beweis

### Code (server.js Z.15731-15732)
```js
// brain_alive: heuristisch — wenn uptime > 30s und ws_ready, sollte Brain laufen
brain_alive: uptimeS > 30 && wsReady,
```

**Bug:** `brain_alive` ist NUR ein Mirror von `wsReady`. Es misst NICHT, ob `AladdinBrain.decide()` tatsächlich läuft.

### Live-Beweis (26.05.2026 07:00)
- `brain_alive=false` weil Bitget-WS gerade in Reconnect-Phase war
- UNIFIED-Decisions liefen aber sauber weiter (07:00 - 07:00:30 mehrere ATOMUSDT/SOLUSDT/BTCUSDT Entscheidungen)
- ⇒ Brain war 100% alive, der Health-Endpoint log

### Impact
- Cron-Watchdogs könnten fälschlich Alarm schlagen
- Monitoring-Tools (Telegram-Alerts, Dashboards) zeigen falsches Bild
- Selbstvertrauen in Health-Endpoint untergraben

---

## 2. QUELLEN

### Kubernetes Liveness-Probe-Pattern
Eine echte Liveness-Probe misst die Aktivität der Hauptlogik, nicht Side-Effects.
**Pattern:** Application sets internal `lastWorkTs` → endpoint vergleicht mit `Date.now() - lastWorkTs < threshold`.

### Nautilus Trader Health Checks
**curl:** `https://raw.githubusercontent.com/nautechsystems/nautilus_trader/develop/nautilus_trader/system/kernel.py`
(Wenn nötig in einer späteren Iteration verifizieren — Spec hier ist self-contained)

---

## 3. LÖSUNG

### Schritt 3a — AladdinBrain.decide() instrumentieren
**target:** server.js — AladdinBrain Modul (Z.27290+ Region)
```js
const AladdinBrain = {
  // ... existierende properties
  _lastDecideTs: 0,   // ← FIX 8 NEU

  decide(/* args */) {
    this._lastDecideTs = Date.now();   // ← FIX 8 NEU (am Anfang von decide())
    // ... bestehende Logik unverändert
  },
};
```

### Schritt 3b — /api/health Endpoint umstellen
**target:** server.js Z.15727-15737
```js
app.get('/api/health', (req,res) => {
  try {
    const uptimeS = Math.round(process.uptime());
    const memHeapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const memRssMB  = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const wsReady   = !!(Bitget && Bitget.ws && Bitget.ws.readyState === 1);

    // FIX 8 [26.05.2026]: echter Brain-Heartbeat statt ws_ready-Mirror
    const lastDecideTs = (typeof AladdinBrain !== 'undefined' && AladdinBrain._lastDecideTs) || 0;
    const brainAgeMs   = lastDecideTs > 0 ? (Date.now() - lastDecideTs) : Infinity;
    const brainAlive   = brainAgeMs < 30_000;   // 30s Threshold

    res.json({
      ok: true,
      uptime_s: uptimeS,
      ws_ready: wsReady,
      pid: process.pid,
      mem_heap_mb: memHeapMB,
      mem_rss_mb: memRssMB,
      ts: Date.now(),
      brain_alive: brainAlive,
      brain_last_decide_ms_ago: brainAgeMs === Infinity ? null : brainAgeMs,
    });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});
```

### Schwellen-Begründung
- Bot fährt ~7-8 Decision-Cycles/Symbol × 9 Symbole = ~70 decides/min = ~1.16 decides/sec
- 30s ohne decide = 35 cycles missed = definitiv stuck oder paused
- 60s wäre zu lax (Cron-Watchdog würde zu spät auslösen)
- 10s wäre zu eng (kurze GC-Pausen oder DB-Locks triggern false alarms)

---

## 4. VERIFIKATIONS-PLAN

### Pre-Deploy
- AladdinBrain.decide() Aufrufer in Code-Trace listen (must capture all)
- Sicherstellen `_lastDecideTs` Initial-Wert nicht crashing wenn vor erstem decide() abgefragt

### Post-Deploy
```bash
# 5× /api/health über 30s
for i in 1 2 3 4 5; do
  curl -s http://localhost:3000/api/health | jq '{brain_alive, brain_last_decide_ms_ago, ws_ready}'
  sleep 5
done
```
Erwartung:
- brain_alive: `true` konstant
- brain_last_decide_ms_ago: schwankt zwischen 0-2000ms (basierend auf Decision-Cycle)
- ws_ready: kann variieren (orthogonal jetzt)

### Edge-Case-Test
- Bot manuell `/pause` (über Telegram)
- 30s warten
- brain_alive muss auf `false` gehen (decide() läuft nicht mehr)
- `/resume` → brain_alive zurück auf `true`

---

## 5. RISIKEN + ROLLBACK

| Risiko | Mitigation |
|---|---|
| _lastDecideTs nie gesetzt (Bot bootet ohne erste Decision) | initialer null-Check + return brain_alive=false bei lastDecideTs=0 |
| Bot in DRY-RUN-Mode wo decide() suspended ist | dokumentieren als bekannten Edge-Case |
| Memory leak durch _lastDecideTs? | nein — primitiver Number, kein leak |
| breaking change für Cron-Watchdogs? | weiterhin brain_alive=true/false → kompatibel |

### Rollback
Trivial: Edit revert via .bak; kein State zu wiederherstellen.

---

## 6. PARALLEL-FIX KANDIDAT

`ws_ready` selbst ist auch unzuverlässig — der `Bitget.ws.readyState` wird bei jedem Reconnect kurz `0` (CONNECTING). Wir könnten einen ähnlichen `_lastMessageTs` für WebSocket einbauen:
```js
const wsLastMsg = Bitget._lastMsgTs || 0;
const wsAlive   = (Date.now() - wsLastMsg) < 10_000;
```
**Nicht in diesem PR.** Separat tracken wenn nötig.

---

## 7. DEPLOY-VORAUSSETZUNGEN

- ✅ Bot in PAPER (bestätigt)
- ✅ Backup-Strategie geklärt
- ⏳ Kann zusammen mit FIX 7 deployen (gleicher Restart)
- ⏳ Christian-Approval (geplant Tag 9 zusammen mit FIX 7)

---

*Spec erstellt: 2026-05-26 08:20*
*Trivial-Fix, kein Architektur-Risiko. Bündel mit FIX 7 möglich.*
