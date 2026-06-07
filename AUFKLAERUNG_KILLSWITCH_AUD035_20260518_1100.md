# AUFKLÄRUNG KillSwitch-Doppel-Count (AUD-VOLL-035)
**Datum**: 18.05.2026 ~11:00
**Auditor**: Senior-Audit-Engineer (Claude Opus 4.7)
**Modus**: READ-ONLY — kein Patch, kein Restart, keine Order
**Auslöser**: Live-Telegram-Alarme 10:38 + 10:43 "KILLSWITCH_SANE: Drawdown 20.9% aber KillSwitch NICHT ausgelöst!"

---

## 🔴 ROOT CAUSE GEFUNDEN (kurz)

**Zwei DD-Berechnungen lesen verschiedene Werte:**
- `KillSwitch.check()` Z.4741: nutzt `eq = getEffectiveDemoEquity().effectiveTotal = 1262.467` (DOPPELT-gezählt) → DD = 0.03% → kein Trigger
- `MetaWatchdog KILLSWITCH_SANE` Z.19720: nutzt `usable = wallet.total + positionsValue = 999.024` (ehrlich) → DD = **20.89%** → Alarm

**Das Doppel-Count vergiftet auch peakTotal**: jeder Tick-Update Z.4734-4736 schreibt `peakTotal = eq` (= effectiveTotal, doppelt). Damit ist peakTotal künstlich hochgepumpt auf **1262.8824** statt ehrlicher ~1000-1015.

---

## 1. KILLSWITCH-MODUL (server.js Z.4698-4773, wörtlich)

```js
const KillSwitch = {
  active:   false,
  mode:     'NORMAL', // NORMAL|RISK_COMPRESSION|EXIT_ONLY|HALTED
  triggers: [],

  check() {
    const isDemo = (DemoEngine && !DemoEngine.liveMode);
    let eq, peakRef, sessionStartRef;
    if (isDemo && typeof getEffectiveDemoEquity === 'function') {
      try {
        const eqInfo = getEffectiveDemoEquity();
        eq = eqInfo.effectiveTotal;           // ← LIEST DOPPELT-GEZÄHLTEN WERT
      } catch(_) {
        eq = (DemoEngine.wallet && DemoEngine.wallet.total) || 0;
      }
      peakRef = (DemoEngine.wallet && DemoEngine.wallet.peakTotal) || 1000;  // ← LIEST DOPPELT-GEZÄHLTEN PEAK
      sessionStartRef = (DemoEngine.wallet && DemoEngine.wallet.startTotal) || 1000;
    } else {
      eq = Balance.usable;
      peakRef = Balance.peakEquity;
      sessionStartRef = Balance.sessionStart;
    }
    if (!eq || eq <= 0) return { mode: this.mode, triggered: false, skipped: 'eq_invalid' };
    if (!peakRef || peakRef <= 10) return { mode: this.mode, triggered: false, skipped: 'peak_init' };
    if (peakRef > 0 && eq < peakRef * 0.5) {
      Log.warn('KILL', `Verdaechtiger eq-Einbruch ignoriert: peakEq=${peakRef.toFixed(2)} eq=${eq.toFixed(2)}`);
      return { mode: this.mode, triggered: false, skipped: 'glitch_protection' };
    }
    if (isDemo) {
      if (eq > peakRef) {
        try { DemoEngine.wallet.peakTotal = eq; } catch(_) {}   // ← SCHREIBT DOPPELT-WERT in peakTotal!
        peakRef = eq;
      }
    } else {
      if (eq > Balance.peakEquity) Balance.peakEquity = eq;
    }
    const drawdown = peakRef > 0 ? (peakRef-eq)/peakRef : 0;
    if (drawdown >= CFG.MAX_DRAWDOWN_PCT) return this._hardKill('MAX_DRAWDOWN', { drawdown, eq, peakRef });
    ...
  },
  ...
};
```

**Caller** (10 Stellen): Z.11326 (DecisionFlow), Z.11723 (DemoEngine cycle), Z.11995 (Exits), Z.13500 (/api/kill), Z.13516 (/api/kill/reset), Z.17668 (Auto-Reset), Z.19010+Z.19014 (Telegram /kill /kill_reset), Z.21833 (DrawdownRecovery), Z.23299 (Cycle).

---

## 2. PEAKTOTAL-LOGIK (alle Stellen)

| Stelle | Typ | Code |
|--------|-----|------|
| Z.4718 | LESEN | `peakRef = DemoEngine.wallet.peakTotal \|\| 1000` (KillSwitch.check) |
| Z.4735 | **SETZEN** | `DemoEngine.wallet.peakTotal = eq` (KillSwitch.check, bei eq > peakRef) |
| Z.4770 | LESEN | snapshot() — DEMO-aware peakEquity (AUDFIX_V) |
| Z.10035 | **SETZEN** | `if (w.total > (w.peakTotal\|\|0)) w.peakTotal = w.total` (WalletProvider.applyPnL) |
| Z.10095 | LESEN | snapshot-Export |
| Z.16754 | INIT (Reset) | demo/reset Endpoint: `peakTotal: cap` |
| Z.19706 | LESEN | MetaWatchdog KILLSWITCH_SANE — nutzt peakTotal genauso |
| Z.21914 | INIT | DemoEngine.wallet default `peakTotal: 1000` |
| Z.21955 | INIT (Start) | DemoEngine.start: `wallet.peakTotal=capital` |
| Z.22950 | LESEN | dd-Calc für Telegram-Reports |
| Z.22986 | LESEN | maxDD für Stats |
| Z.24848 | LESEN | TelegramBot.sendKapital-Anzeige |

**KRITISCH**: Z.4735 und Z.10035 schreiben peakTotal aus 2 verschiedenen Quellen:
- Z.4735: `peakTotal = eq` (eq = effectiveTotal = DOPPELT-gezählt 1262)
- Z.10035: `peakTotal = w.total` (= wallet.total = ehrlich 999)

→ peakTotal wird also IMMER von der höchsten Quelle hochgepumpt = **1262** (durch Z.4735 dominant).

---

## 3. getEffectiveDemoEquity (server.js Z.10151-10180, wörtlich)

```js
function getEffectiveDemoEquity() {
  const dw = (DemoEngine && DemoEngine.wallet) || {};
  const cash = Number(dw.trading || 0);          // 983.98
  const reserve = Number(dw.reserve || 0);       // 15.05
  const total = Number(dw.total || 0);           // 999.02 (= cash + reserve)
  let mbtCommitted = 0;
  try {
    const dcaSum = DB.db.prepare("SELECT COALESCE(SUM(total_spent),0) AS s FROM dca_instances WHERE status IN ('OPEN','DD_STOPPED')").get();
    mbtCommitted += dcaSum.s || 0;               // ~260 (DCA)
  } catch(_) {}
  try {
    const gridNet = DB.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN go.side='BUY' THEN go.size*go.fill_price ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN go.side='SELL' THEN go.size*go.fill_price ELSE 0 END), 0) AS net
      FROM grid_orders go JOIN grid_instances gi ON go.grid_id=gi.grid_id
      WHERE gi.status='OPEN' AND go.filled=1
    `).get();
    mbtCommitted += Math.max(0, gridNet.net || 0);   // ~0 (Grid BUY-SELL netto)
  } catch(_) {}
  const unrealized = computeUnrealizedPnLMBT();      // ~3.44
  return {
    cash: Number(cash.toFixed(4)),
    reserve: Number(reserve.toFixed(4)),
    walletTotal: Number(total.toFixed(4)),
    mbtCommitted: Number(mbtCommitted.toFixed(4)),
    unrealized,
    effectiveTotal: Number((total + mbtCommitted + unrealized.total).toFixed(4)),  // ← 999+260+3.44 = 1262 ← FALSCH
    effectiveImMarkt: Number((mbtCommitted + unrealized.total).toFixed(4)),
  };
}
```

**Caller**:
- Z.4712 (KillSwitch.check) ← liest effectiveTotal
- Z.16027 (`/api/heartbeat`)
- Z.17146 (`/api/kapital`)
- Z.17206 (`/api/killswitch/status`)
- Z.17208 (currentDrawdown-Anzeige im UI)
- Z.18329 (Telegram-Kapital-Report)
- Z.18529 (Telegram-Demo-Kapital)

**Doppel-Count-Beweis**:
- `total` = 999.02 enthält bereits implizit das DCA/Grid-Geld (DCA_BUY-Ledger-Op hat `before_total == after_total` — Wallet wird NICHT abgezogen, siehe Kapital-Diagnose 18.05. 06:30)
- `mbtCommitted` = 260 ist genau dieses Geld separat berechnet
- `effectiveTotal = total + mbtCommitted + unrealized` rechnet das DCA-Geld also DOPPELT.

---

## 4. KILLSWITCH.CHECK — DD-Berechnung

```js
const drawdown = peakRef > 0 ? (peakRef-eq)/peakRef : 0;
// peakRef = DemoEngine.wallet.peakTotal = 1262.8824 (doppelt-gezählt)
// eq      = effectiveTotal             = 1262.467  (ebenfalls doppelt)
// drawdown = (1262.8824 - 1262.467) / 1262.8824 = 0.000329 = 0.03%
```

**0.03% << 12% Threshold** → kein Trigger. ✅ aus check()-Sicht "korrekt".

ABER die Realität ist:
- Reales Wallet-Total: 999.02
- Reales Peak: nie 1262 erreicht (Bot hat NIE 1262 real gehabt — das ist Doppel-Count-Artefakt!)
- Echter DD vs Start 1000: -0.1% (Gewinn 0.1%)
- Echter DD vs falschem Peak 1262: **20.89%** (was MetaWatchdog erkennt)

---

## 5. KILLSWITCH_SANE-Meldung (server.js Z.19700-19731, wörtlich)

```js
results.push(this._check('KILLSWITCH_SANE', () => {
  const isPaper = CFG.DEPLOY_MODE === 'PAPER';
  const peak = isPaper ? (DemoEngine.wallet?.peakTotal || 1000) : Balance.peakEquity;   // 1262.88
  const cash = isPaper ? (DemoEngine.wallet?.total || 0) : Balance.usable;              // 999.02
  let positionsValue = 0;
  if (isPaper) {
    try {
      const active = (typeof Trades !== 'undefined' && Trades.getActive) ? Trades.getActive() : [];
      for (const t of active) {
        if (t.strategy === 'DEMO_UNIFIED' || t.strategy === 'DEMO_AUTO' || (t.id && t.id.startsWith('DEMO_'))) {
          positionsValue += (t.size || 0);                                              // 0 (keine SINGLE-Trades)
        }
      }
    } catch(_) {}
  }
  const usable = cash + positionsValue;                                                 // 999.02
  const dd = peak > 0 ? (peak - usable) / peak : 0;                                     // (1262-999)/1262 = 0.209
  // Kill Switch sollte HALTED sein wenn Drawdown > 12%
  if (dd > CFG.MAX_DRAWDOWN_PCT && KillSwitch.mode !== 'HALTED') {
    return { ok:false, msg:`Drawdown ${(dd*100).toFixed(1)}% aber KillSwitch NICHT ausgelöst! Mode: ${KillSwitch.mode}`, severity:'CRITICAL' };
  }
  ...
}));
```

MetaWatchdog **rechnet ehrlicher**:
- nutzt `wallet.total` (999) statt `effectiveTotal` (1262)
- Plus `positionsValue` aus SINGLE-Trades (DEMO_UNIFIED only) — derzeit 0
- ABER: MetaWatchdog **erkennt nicht** dass MBT-Position-Wert (DCA/Grid) fehlt (Code-Pfad-Lücke)
- ABER: MetaWatchdog **erkennt nicht** dass peakTotal selbst korrupt ist

Resultat: MetaWatchdog ist **falsch-genug-um-Alarm-zu-werfen** aber **noch nicht voll korrekt** — die 20.9% sind die DD gegen den FALSCHEN peak. Der wahre DD ist negativ (Gewinn).

---

## 6. META-WATCHDOG (server.js Z.19677+, wörtlich)

```js
const MetaWatchdog = {
  checks:    [],
  alerts:    [],
  lastCheck: null,
  timer:     null,
  checkCount: 0,
  async runAllChecks() {
    ...
    // 10 checks: SELFHEAL_ALIVE, KILLSWITCH_SANE, SAFETIES_FUNCTIONAL, NOTRADE_CONSISTENT,
    //            BALANCE_CONSISTENT, EXCHANGE_STABLE, AUTOENGINE_ALIVE, INCIDENTS_MANAGED,
    //            BOTMANAGER_SANE, DATABASE_HEALTHY
    ...
    const critical = results.filter(r => !r.ok && r.severity === 'CRITICAL');
    if (critical.length) {
      const lines = ['🚨 META-WÄCHTER ALARM', ''].concat(critical.map(c=>'⛔ '+c.name+': '+c.msg));
      // Telegram-Send
    }
  },
};
```

Telegram-Alert Z.19840.

---

## 7. INCIDENTS — Live-Stand

7 offene Incidents (Memory):
- INC-76 bis INC-82: alle `META_WATCHDOG_CRITICAL`, msg "Drawdown 20.9% aber KillSwitch NICHT ausgelöst"
- pressureScore = 0.9 (= 90%) → INCIDENTS_MANAGED-Check meldet **CRITICAL "System unter starkem Stress"** (Z.19796)
- Letzte 2 Min: jede 30s ein neuer Incident vom MetaWatchdog-Tick

**Incidents-Tabelle in DB**: existiert NICHT (Incidents.store ist nur in-Memory, Z.4780 `store: {}`).

---

## 8. AKTUELLE BALANCE — Live-Werte (curl)

```json
"demo": {
  "wallet": {
    "total": 999.024,
    "reserve": 15.045,
    "trading": 983.979,
    "startTotal": 1000,
    "peakTotal": 1262.8824,                   // ← DOPPEL-COUNT-VERGIFTET
    "dailyStart": 999.024,
    "pnl": -0.976,
    "dailyPnl": 0
  },
  "stats": { "maxDD": 0.2089 }                // 20.89% gegen falschen peakTotal
}
```

```json
"killSwitch": {
  "active": false,
  "mode": "NORMAL",
  "peakEquity": 1262.8824,
  "effectiveEquity": 1262.467,
  "startingEquity": 1000,
  "currentDrawdown": -0.2624670000000001,    // = -26.2% = +26% GEWINN vs Start
  "thresholdDrawdown": 0.12
}
```

```json
"heartbeat.wallet": {
  "total": 999.024,
  "effectiveTotal": 1262.467,
  "mbtCommitted": 260,
  "effectiveImMarkt": 263.443,
  "unrealizedTotal": 3.443
}
```

Bot zeigt 26% **Gewinn** vs Start 1000 — aber MetaWatchdog meldet 20% **Drawdown** vs peakTotal.

**Beide haben Recht aus ihrer Sicht**, beide rechnen mit korruptem peakTotal.

---

## 9. PRICE_SPIKE Z=7.36 BNBUSDT

Code Z.21007:
```js
if (rangeZ > this.zThreshold) anomalies.push({ type:'PRICE_SPIKE', zscore:rangeZ.toFixed(2), severity:rangeZ>5?'CRITICAL':'HIGH' });
```

PRICE_SPIKE ist eine **separate Anomaly-Detection** (im AnomalyDetector-Modul), nicht im KillSwitch-Pfad. Hat die DD-Verzerrung NICHT direkt ausgelöst — eher ein Symptom des selben Marktes.

---

## 10. BRAIN-SCHUTZZONE-CHECK

**grep Z.4695-4775 (KillSwitch-Modul) nach `aladdin|bayesian|brain|consensus`**:
→ NUR Kommentar Z.4707 `// - AladdinBrain bleibt UNANGETASTET`

**KillSwitch berührt NICHT**:
- AladdinBrain ❌ keine Calls
- Bayesian ❌ keine Calls
- Consensus ❌ keine Calls
- Score ❌ keine Calls
- Strategie-Logik ❌ keine Calls

✅ **Fix-Pfad ist Brain-Schutzzone-konform**. Alle Reparaturen können sich auf KillSwitch.check + getEffectiveDemoEquity + peakTotal-Migration beschränken, ohne Brain-Code zu berühren.

---

## DIAGNOSE A-G

### A) HYPOTHESE: warum DD 20.9% nicht zum Auslösen führt

`KillSwitch.check()` und `MetaWatchdog KILLSWITCH_SANE` rechnen mit unterschiedlichen Werten:

| Variable | KillSwitch.check | MetaWatchdog |
|----------|-----------------|--------------|
| `eq` / `usable` | `effectiveTotal` = 1262.467 (DOPPELT-gezählt) | `wallet.total` = 999.024 (ehrlich) |
| `peak` | `wallet.peakTotal` = 1262.88 (verfälscht) | `wallet.peakTotal` = 1262.88 (gleich verfälscht) |
| **DD-Berechnung** | (1262.88 - 1262.47) / 1262.88 = **0.03%** | (1262.88 - 999.02) / 1262.88 = **20.89%** |
| Schwelle 12% | ❌ nicht erreicht → kein Trigger | ✅ erreicht → ALARM |

KillSwitch.check ist **selbst-konsistent inkorrekt** (beide Werte doppelt → DD bleibt scheinbar 0).
MetaWatchdog ist **inkonsistent korrekt** (vergleicht ehrlich gegen verfälschten Peak).

### B) BETROFFENE FUNKTIONEN/ZEILEN
| Datei:Zeile | Funktion | Rolle |
|-------------|----------|-------|
| server.js:4703-4747 | KillSwitch.check | bekommt eq=effectiveTotal, schreibt peakTotal=eq |
| server.js:4734-4736 | Peak-Update | `if eq > peakRef → peakTotal = eq` (vergiftet peakTotal) |
| server.js:10151-10180 | getEffectiveDemoEquity | DOPPELT-Count: total + mbtCommitted + unrealized |
| server.js:10177 | effectiveTotal-Rechnung | `total + mbtCommitted + unrealized.total` ← FALSCH |
| server.js:19700-19731 | MetaWatchdog KILLSWITCH_SANE | rechnet ehrlich, erkennt Diskrepanz |
| server.js:19706 | MetaWatchdog peak-Read | nutzt SELBEN korrupten peakTotal |

### C) BRAIN-SCHUTZZONE-BERÜHRUNG
**NEIN.** Alle 6 Code-Stellen sind außerhalb von AladdinBrain/MetaBrain/Consensus/Bayesian/Score/Strategie-Logik. Patch ist Brain-Schutzzone-konform.

### D) RISIKO

| Modus | Risiko-Level | Konkret |
|-------|--------------|---------|
| **PAPER** (aktuell) | MITTEL | Reputations- + Diagnose-Schaden. Telegram-Spam. ConsistencyGuardian-Pressure steigt. Bei pressure > 0.5 wird `runtimeClean=false` → NoTrade-Gate blockt Trades. |
| **LIVE** (hypothetisch) | **EXISTENZGEFÄHRDEND** | KillSwitch würde 20%+ DD NICHT stoppen. Bei 12% MAX_DRAWDOWN_PCT würde Bot blind weiter-traden bis Bitget-Bilanz auf 0. |

### E) FIX-VORSCHLAG (NICHT umsetzen — Skizze)

**Option A (minimal-invasiv, Brain-Schutzzone-konform)**:
1. `getEffectiveDemoEquity` Z.10177 ändern: `effectiveTotal = total + unrealized.total` (mbtCommitted NICHT addieren — es ist bereits in total)
2. `DemoEngine.wallet.peakTotal` einmalig zurücksetzen auf max(wallet.total, current_peak_real)
3. `demo_wallet.json` schreiben für Persistenz
4. PM2 reload — KillSwitch.check beginnt mit sauberen Werten

**Option B (umfassend)**:
1. Wie A
2. ZUSÄTZLICH: Z.4735 `peakTotal = eq` durch `peakTotal = Math.max(eq, walletTotal)` ersetzen, damit selbst bei fortdauerndem effectiveTotal-Bug peakTotal nicht überschrieben wird
3. MetaWatchdog Z.19720 erweitern: ehrlicher DD-Vergleich (cash + MBT-Mark-to-Market via getEffectiveDemoEquity, aber mit dem korrigierten effectiveTotal)

**Option C (rolling rollback wegen X-Pipeline gestern)**:
- Heute Morgen wurde X-Pipeline (effectiveTotal-Fix) gerollt zurück WEGEN dieses peakTotal-Stale-Problems
- Lösung: koordinierter X-Fix + peakTotal-Migration in einem reload
- Dieser Pfad ist genau das was AUDIT_GESAMT-Empfehlung #2 vorsieht

### F) TESTBARKEIT

**Test 1 — Fake-DD im PAPER**:
```js
// Nicht ausführen — nur Skizze:
// 1. DemoEngine.wallet.peakTotal = 1500 (künstlich erhöht)
// 2. DemoEngine.wallet.total = 1000 (= 33% DD vs peak)
// 3. KillSwitch.check() aufrufen
// → erwartet: _hardKill('MAX_DRAWDOWN'), mode='HALTED'
```

**Test 2 — Recon-Approve-Equivalent**:
- Nach Fix: peakTotal sollte ≤ walletTotal sein (DEMO ohne MBT-Doppel-Count)
- Verify: `curl /api/killswitch/status` zeigt `peakEquity ≈ walletTotal ± unrealized`

**Test 3 — MetaWatchdog grün**:
- Nach Fix: keine neuen `META_WATCHDOG_CRITICAL` Incidents
- Verify: `curl /api/incidents` → `open.length == 0` nach 5 Min

### G) BOT-STATUS aktuell — drohende Folgeschäden?

| Indikator | Aktuell | Schwelle | Status |
|-----------|---------|----------|--------|
| Incidents open | 7 | 15 (HOCH) | 🟡 |
| pressureScore | 0.9 | 0.8 → CRITICAL Z.19796 | 🔴 **DROHT** |
| `runtimeClean` Gate | false (wg. pressure) | < 0.5 = clean | 🟡 Trades blockiert |
| NoTrade.allowTrade | **false** | — | 🟡 |
| AladdinBrain | aktiv | — | ✅ |
| Wallet | unverändert | — | ✅ |

**Eskalations-Risiko**: pressureScore steigt mit jedem 30s-MetaWatchdog-Tick. Bei jedem `severity=CRITICAL`-Incident wird auch `KillSwitch._preKill('CRITICAL_INCIDENT')` aufgerufen (Incidents.create Z.4790)! Aktuell sind die META_WATCHDOG-Incidents nur HIGH, nicht CRITICAL — daher kein KillSwitch-PRE-Kill aktuell.

ABER: INCIDENTS_MANAGED-Check selbst (Z.19796) wirft beim nächsten Tick einen **eigenen CRITICAL-Incident** zurück → Kettenreaktion:
- 7 META_WATCHDOG_CRITICAL (HIGH) → pressure 90%
- INCIDENTS_MANAGED-Check meldet CRITICAL bei pressure > 0.8 → erzeugt neuen Incident mit severity=CRITICAL
- Incidents.create Z.4790: severity===CRITICAL ruft `KillSwitch._preKill('CRITICAL_INCIDENT')` → **KillSwitch.mode wird RISK_COMPRESSION**
- Bot fährt Sizing auf 0 herunter via PreKill

→ **In 1-5 Min wird der Bot SELBST in RISK_COMPRESSION fahren** (Cascade via Incident-Pressure). Das ist kein Real-Risk-Schutz aber zumindest defensive Reaktion.

Wallet aktuell sicher (999.02 unverändert seit Pipeline 1.4 Nachmittag).

---

## ABSCHLUSSBERICHT — REGEL 13 A-J

**A) GEMACHT**
- Aufklärung Punkt 1-10 + Diagnose A-G
- KillSwitch-Modul wörtlich (Z.4698-4773)
- peakTotal-Logik tracing (alle 13 Stellen)
- getEffectiveDemoEquity wörtlich (Z.10151-10180)
- MetaWatchdog KILLSWITCH_SANE wörtlich (Z.19700-19731)
- Live-curl: /api/status, /api/wallet/snapshot, /api/heartbeat, /api/killswitch/status, /api/incidents
- Brain-Schutzzone-Check ✅

**B) GEÄNDERT**
- Nichts (READ-ONLY ✅)

**C) NICHT GEMACHT / SKIPPED**
- KEIN Patch
- KEIN Restart
- KEIN git commit
- Auf Christian-Freigabe für Fix-Block wartend

**D) Bot-Status final**
- PM2 R: 107
- Wallet: 999.024025457343 (unverändert)
- Drift: 0
- DEPLOY: PAPER
- KillSwitch.mode: NORMAL (sollte aber CRITICAL_INCIDENT-PreKill in 1-5min triggern via Cascade)

**E) ERROR/WARN-LOGS**
- Letzte 5min: 7 META_WATCHDOG_CRITICAL-Incidents (HIGH)
- Telegram-Alarme alle 30s
- KEIN Stack-Trace im pm2 error-log ✅

**F) Tests**
- N/A (Read-Only — keine Test-Pflicht in dieser Phase)

**G) Audit-Log-Count**
- system_log seit Pipeline-Start: 9 module-spezifische Einträge
  - deploy_endpoint: 3
  - mode_demo_endpoint: 1
  - mode_switch_endpoint: 2
  - scripts_execute_endpoint: 1
  - score_floor_doc: 1
  - kill_endpoint, kill_reset_endpoint: 0 (keine echten Trigger heute)
  - recon_correction: 0 (kein Hard-Drift)

**H) Backup-Status**
- Baseline-Snapshot existiert: `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/SNAPSHOT_20260518_104347_BASELINE_18052026/`
- Kein neuer Snapshot nötig (READ-ONLY-Phase)
- BAK-Archiv intakt: `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/BAK_ARCHIV_18052026/`

**I) Nächster Schritt**
- Christian liest Aufklärung
- Christian gibt Fix-Block (Option A/B/C aus Diagnose-E)
- Vorher: Snapshot pre-fix automatisch via Regel 14

**J) RISIKEN OFFEN**
1. 🔴 KillSwitch rechnet inkorrekt — würde in LIVE existenzgefährdend
2. 🟡 Cascade via Incident-Pressure: in 1-5 min könnte INCIDENTS_MANAGED-CRITICAL-Loop entstehen → KillSwitch._preKill('CRITICAL_INCIDENT') → mode='RISK_COMPRESSION' (defensive Selbst-Reaktion, aber nicht über DD-Pfad)
3. 🟡 X-Pipeline (heute Morgen) rollback weil peakTotal-Stale — selber Bug. Fix muss koordiniert (Code + Daten-Migration in einem reload)

---

**Pfad dieser Aufklärung**:
`/Users/christianheilig/NEXUS_CLEAN/AUFKLAERUNG_KILLSWITCH_AUD035_20260518_1100.md`
