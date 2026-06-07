# KillSwitch-Fix Plan — Option A (minimal-invasiv)
**Datum**: 18.05.2026 ~11:02
**Modus**: READ-ONLY (Plan — Patch erst nach Christian-Freigabe)
**Brain-Schutzzone**: ✅ konform (kein Brain-Code berührt)

---

## 1. X-PIPELINE-RÜCKROLLUNG — Was war passiert?

### Was war die X-Pipeline?
- **Pipeline-Name**: "Kapital+ATOM-Fix Pipeline" (heute Morgen)
- **Backup-Pfad**: `~/Desktop/NEXUS_BACKUPS/KAPITAL_ATOM_FIX_20260518_074057/`
- **Plan damals**: 4 Teile X/Y/V/W
  - **X**: Wallet-Display Doppel-Count fixen (effectiveTotal)
  - **Y**: Reserve-Routing MBT-Profits (deferred)
  - **V**: KillSwitch.snapshot() MBT-aware (success, commit 277e733)
  - **W**: ATOMUSDT Doppel-Grid Filter (success, commit 7418560)

### Wann zurückgerollt?
- **X-Start**: 18.05.2026 ~07:40
- **X-Patch deployed**: ~07:41
- **PM2 reload**: ~07:41 — Bot R=98→99
- **HARD KILL ausgelöst**: ~07:42
- **X-Rollback**: ~07:42 (innerhalb 1 Min nach Reload erkannt + rollback)
- **PROGRESS.csv-Eintrag**: `X,1779083050,1779083050,ROLLED_BACK,-,killswitch-side-effect-peakTotal-stale,-,-,needs-peakTotal-coordinated-fix`

### Welcher Patch wurde damals versucht?
**Genau die Änderung die jetzt Option A vorsieht — nur Code, NICHT Daten**:
- **Ziel**: Z.10125 (heute: Z.10177) — `effectiveTotal: total + unrealized.total` (mbtCommitted nicht addieren)
- **Effekt**: effectiveTotal von 1239 → 1014.55 (ehrlich)

### Warum gescheitert?
- Code-Patch war technisch korrekt
- ABER: `DemoEngine.wallet.peakTotal` stand bei **1217.574** (verfälscht von Pre-Fix-Berechnung)
- Nach Reload: `KillSwitch.check()` sah nun ehrliches `eq = 1014.55`, vergleichte mit verfälschtem `peakRef = 1217.57`
- Berechnung: `(1217.57 - 1014.55) / 1217.57 = 16.67%` > 12% MAX_DRAWDOWN_PCT
- **HARD KILL gefeuert** → mode='HALTED' → AladdinBrain-Decisions alle vetoed mit `KILL_SWITCH_ACTIVE`
- Bot stoppte Trading → Rollback notwendig

### Liegt noch ein Backup vor?
**JA**:
- `~/Desktop/NEXUS_BACKUPS/KAPITAL_ATOM_FIX_20260518_074057/X_wallet/server.js.pre` (Pre-X-Stand)
- `~/Desktop/NEXUS_BACKUPS/KAPITAL_ATOM_FIX_20260518_074057/X_wallet/X6_snapshot_after.json` (Stand nach X-Patch mit peakTotal=1217.574)
- Diff zum aktuellen server.js zeigt: **X-Patch ist EXAKT zurückgerollt** (Diff Z.10170-10180 identisch heute)

### Wurde damals an Z.10177 oder Z.4735 etwas verändert?
- **Z.10177** (heute = Z.10125 damals): JA — wurde von `total + mbtCommitted + unrealized.total` auf `total + unrealized.total` gepatcht → DANACH wieder zurückgerollt
- **Z.4735** (peakTotal-Setzung): NEIN — wurde damals nicht angefasst (wäre die "koordinierte" Lösung gewesen die fehlte)
- **demo_wallet.json**: NEIN — wurde nicht migriert (deshalb peakTotal=1217.574 noch alt war)

---

## 2. KONKRETER PATCH-PLAN OPTION A

### Patch P1 — server.js Z.10177 (getEffectiveDemoEquity)

**ALT (Z.10171-10180)**:
```js
  return {
    cash: Number(cash.toFixed(4)),
    reserve: Number(reserve.toFixed(4)),
    walletTotal: Number(total.toFixed(4)),
    mbtCommitted: Number(mbtCommitted.toFixed(4)),
    unrealized,
    effectiveTotal: Number((total + mbtCommitted + unrealized.total).toFixed(4)),
    effectiveImMarkt: Number((mbtCommitted + unrealized.total).toFixed(4)),
  };
}
```

**NEU**:
```js
  return {
    cash: Number(cash.toFixed(4)),
    reserve: Number(reserve.toFixed(4)),
    walletTotal: Number(total.toFixed(4)),
    mbtCommitted: Number(mbtCommitted.toFixed(4)),
    unrealized,
    // AUDFIX_KS001 [18.05.2026]: KEIN Doppel-Count von mbtCommitted.
    // wallet.total enthält bereits implizit das MBT-Geld (DCA_BUY zieht KEIN Cash vom Wallet ab).
    // Vorher: effectiveTotal = total + mbtCommitted + unrealized = 999 + 260 + 3.44 = 1262 (falsch)
    // Jetzt:  effectiveTotal = total + unrealized = 999 + 3.44 = 1002.47 (ehrlich)
    effectiveTotal: Number((total + unrealized.total).toFixed(4)),
    effectiveImMarkt: Number((mbtCommitted + unrealized.total).toFixed(4)),
  };
}
```

### Patch P2 — Daten-Migration `DemoEngine.wallet.peakTotal`

**Aktueller Zustand**:
- `DemoEngine.wallet.peakTotal` (Memory): **1262.8824** (verfälscht durch tick-update mit altem effectiveTotal)
- `demo_wallet.json` auf Disk: `peakTotal: 1217.574` (verfälscht aus früheren Pre-Fix-Berechnung)

**Migration vor Reload**:
1. **demo_wallet.json patchen** mit neuem peakTotal = `total + unrealized_aktuell` ≈ **1002.47**
2. Bei Reload: DemoEngine.wallet wird aus demo_wallet.json geladen → peakTotal = 1002.47
3. Nach Reload: KillSwitch.check() sieht eq ≈ 1002.47, peakRef = 1002.47 → DD ≈ 0% ✅
4. Falls eq je real wieder steigt → tick-update Z.4735 schreibt sauberen Wert

**Konkrete Migration**:
```json
// ALT demo_wallet.json:
{"total":999.024025457343,"reserve":15.045179450405826,"trading":983.9788460069371,"startTotal":1000,"peakTotal":1217.574,"dailyStart":999.024025457343,"pnl":-0.9759745426572933,"dailyPnl":0,"resetAt":1778670381173}

// NEU:
{"total":999.024025457343,"reserve":15.045179450405826,"trading":983.9788460069371,"startTotal":1000,"peakTotal":1002.47,"dailyStart":999.024025457343,"pnl":-0.9759745426572933,"dailyPnl":0,"resetAt":1778670381173}
```

Nur `peakTotal: 1217.574 → 1002.47`, alle anderen Felder unverändert.

### Patch P3 — Z.4735 (peakTotal-Setzung in KillSwitch.check)

**NICHT angepasst in Option A** (minimal-invasiv). Begründung:
- Nach P1: eq = effectiveTotal ist ehrlich (1002.47)
- Z.4735 schreibt dann sauberen Wert in peakTotal — kein Schaden mehr
- Falls in Option B/C: hier zusätzlich `peakTotal = Math.max(eq, walletTotal)` als Defense-in-Depth

### Patch P4 — Incidents-Cleanup (optional)

24 META_WATCHDOG_CRITICAL-Incidents in Memory blockieren `runtimeClean`. Nach Fix sollten neue Ticks keine Alarms mehr werfen, ABER alte bleiben in Memory bis ihre `pressureAdded` abgezogen wird.

**Optional**: Nach Reload `Incidents.resetAll()` aufrufen (via `/api/incidents/reset` mit Token — heute morgen AUDFIX_E001 abgesichert).

### Wird mbtCommitted-Tracking betroffen?
**NEIN**. `mbtCommitted` bleibt im Output erhalten (für UI-Anzeige), wird nur nicht mehr DOPPELT in `effectiveTotal` addiert. Alle anderen Endpoints die `mbtCommitted` separat lesen funktionieren weiter.

---

## 3. NACH-FIX-TESTS

### Pflicht-Tests (Christian-Vorschlag a-f)
| # | Test | Erwartung | Wie messen |
|---|------|-----------|-----------|
| a | KillSwitch.check liefert plausiblen DD% | DD ≈ 0% (eq ≈ peak nach Migration) | `curl /api/killswitch/status \| jq '.currentDrawdown'` |
| b | KILLSWITCH_SANE-Alarm verschwindet | innerhalb 30s (MetaWatchdog-Tick) keine neuen META_WATCHDOG-Incidents | `curl /api/incidents \| jq '.open\|length'` über 1min |
| c | peakTotal-Wert plausibel | peakTotal ≈ 1002.47, < 1100 USDT | `curl /api/wallet/snapshot \| jq '.demoWallet.peakTotal'` |
| d | Wallet.total unverändert | 999.024025457343 | `curl /api/wallet/snapshot \| jq '.total'` |
| e | Bot kann wieder traden | NoTrade.allowTrade=true, runtimeClean=true | `curl /api/status \| jq '.noTrade'` |
| f | pressureScore sinkt | innerhalb 5min < 0.5 | `curl /api/incidents \| jq '.pressure'` |

### Zusätzlich vorgeschlagene Tests
| # | Test | Erwartung |
|---|------|-----------|
| g | effectiveTotal in heartbeat ehrlich | `curl /api/heartbeat \| jq '.wallet.effectiveTotal'` ≈ 1002, nicht 1262 |
| h | demo_wallet.json persistiert nach 5 Min | mtime aktualisiert, peakTotal-Wert wird durch Bot bei wachsendem Profit weitergeschrieben |
| i | AladdinBrain wieder voll aktiv | `aladdin_decisions` letzte 5min > 100 (nicht alle vetoed) |
| j | TIER2-Module noch erreichbar | `curl /api/walkforward/list \| jq .ok` = true (Regression von vorherigem AUDFIX_E001-Wrapper-Pass) |

### Brain-Schutzzone-Verifikation
- Vor + Nach Fix: `git diff` zeigt KEIN Touch in AladdinBrain/MetaBrain/Bayesian/Consensus/Score
- Verify-Befehl: `grep -c "AladdinBrain\|Bayesian\|consensus" server.js` muss identisch sein

---

## 4. ROLLBACK-PLAN

### Backups VOR Patch (Regel 14 automatisch)
1. **Code-Backups**:
   - `server.js.bak.AUDFIX_KS001_<TS>`
   - (kein index.html-Backup nötig — UI nicht berührt)
2. **demo_wallet.json-Backup**:
   - `~/NEXUS_CLEAN/data/demo_wallet.json.bak.AUDFIX_KS001_<TS>`
3. **Voll-Snapshot** (Regel 14):
   - `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/SNAPSHOT_<TS>_KS001_PRE/`
   - Enthält: server.js + demo_wallet.json + nexus.db + alle Modules + alle Audit-Reports

### Rollback-Befehl bei FAIL (Test a-f rot)
```bash
PM2=/Users/christianheilig/.nvm/versions/node/v20.20.2/bin/pm2
TS=<TIMESTAMP_PRE_PATCH>
cd ~/NEXUS_CLEAN

# 1. Code zurück
cp "server.js.bak.AUDFIX_KS001_$TS" server.js

# 2. demo_wallet.json zurück
cp "data/demo_wallet.json.bak.AUDFIX_KS001_$TS" data/demo_wallet.json

# 3. PM2 reload — lädt server.js + demo_wallet.json wieder ein
$PM2 reload nexus

# 4. Status prüfen
sleep 5
curl -s http://localhost:3000/api/wallet/snapshot | jq '.demoWallet.peakTotal'  # erwartet: 1262.88 (alter Stand)
$PM2 jlist | jq '.[]|select(.name=="nexus")|.pm2_env.restart_time'
```

### Rollback-Garantie
- demo_wallet.json wird vom Bot beim Boot via `_restoreDemoPositions` + Wallet-Persist gelesen
- Rollback ist garantiert: kein Trade-Zustand-Verlust (nexus.db unverändert)
- Voller Pipeline-Rollback via Voll-Snapshot möglich (alle Patches heute zurück)

---

## 5. CASCADE-RISIKO — Wie viel Zeit?

### Korrektur zur Aufklärung 11:00
**MetaWatchdog erzeugt Incidents mit `severity='HIGH'` (Z.19843), NICHT `CRITICAL`** → Incidents.create Z.4790 löst KillSwitch._preKill NUR bei `severity==='CRITICAL'` aus → **keine HARD-KILL-Cascade via Pressure**.

### Was bei pressure=1.0 wirklich passiert
- Z.5072 `gates.runtimeClean = Incidents.pressureScore() < 0.5` → `runtimeClean=false`
- NoTrade.allowTrade = false → **neue Trades blockiert**
- Bestehende Positionen laufen weiter (DCA, Grid)
- AladdinBrain läuft weiter (keine Veto-Cascade)
- KillSwitch bleibt NORMAL (kein automatischer Mode-Wechsel)

### Wie lange "noch" Zeit?
**Effektiv unbegrenzt im PAPER**. Pressure ist gecappt bei 1.0. Solange pressureScore > 0.5 bleibt der Bot in defensiver Selbstreaktion (kein neuer Trade), aber **keine Eskalation auf HARD-KILL via Pressure**.

### Falls Cascade während Patch
- Patch dauert max. 60s (siehe 6)
- Während Patch ist Bot in `runtimeClean=false`-Modus (keine neuen Trades)
- Reload während Patch unterbricht MetaWatchdog kurzzeitig (1-3s)
- Nach Reload: frische Memory, alle alten Incidents weg (sind nur in Memory, nicht persistiert)
- **Stört Patch NICHT** ✅

---

## 6. PATCH-DAUER-ABSCHÄTZUNG

| Schritt | Zeit |
|---------|------|
| Snapshot Pre-Patch (Regel 14) | 30-60s (M.2-Backup) |
| server.js Z.10177 Edit | 5s |
| demo_wallet.json-Backup + Migration | 5s |
| node --check server.js | 2s |
| pm2 reload nexus | 1s (reload-command) |
| Wait für Bot-Start | 5s |
| Tests a-f durchführen | 30-60s |
| Audit-Log-Eintrag | 1s |
| Regel-13-Bericht | 30s |
| **Total** | **~2-3 Min** |

### Schaffen wir das vor der Cascade?
**JA — Cascade ist Plateau, keine Eskalation**. Selbst wenn 10+ Min vergehen, ändert sich an pressure=1.0 nichts (gecappt). Sicherheit-First-Vorgehen ist OK.

---

## REGEL-13-BERICHT A-J

**A) GEMACHT**
- Klärungsfragen 1-6 beantwortet
- X-Pipeline-Backup-Spuren rekonstruiert
- Wörtlichen Patch-Plan formuliert (Code + Daten)
- Test-Liste a-j (6 + 4 zusätzliche)
- Rollback-Befehl-Sequenz
- Cascade-Risiko korrigiert (HIGH, nicht CRITICAL — keine PreKill-Cascade)
- Patch-Dauer geschätzt (~2-3 Min)

**B) GEÄNDERT**
- Nichts (READ-ONLY ✅)

**C) NICHT GEMACHT / SKIPPED**
- KEIN Patch
- KEIN Restart
- KEIN git commit
- KEIN demo_wallet.json-Edit
- Auf Christian-Freigabe für Patch wartend

**D) Bot-Status**
- PM2 R: 107 (unverändert)
- Wallet: 999.024025457343 (unverändert)
- Drift: 0
- DEPLOY: PAPER
- KillSwitch.mode: NORMAL (kein Trigger)
- Open Incidents: 24 (Cascade plateaut bei pressure=1.0)
- NoTrade.allowTrade: false (durch runtimeClean wegen pressure)

**E) ERROR/WARN-LOGS**
- Letzte 10 Min: ~12 META_WATCHDOG-Alarm-Bursts (Telegram)
- pm2 error-log: leer ✅
- Keine Bot-Stack-Traces

**F) Tests**
- N/A (Read-Only-Phase)

**G) Audit-Log-Count**
- system_log seit Pipeline-Start: ~9 module-spezifische Einträge unverändert
- Keine neuen Audit-Einträge durch diese Klärungsphase

**H) Backup-Status**
- Baseline-Snapshot existiert (10:43:47)
- Voll-Snapshot Pre-Patch wird **bei Patch-Start automatisch** angelegt (Regel 14)
- BAK-Archiv intakt

**I) Nächster Schritt**
- Christian liest Plan
- Falls Freigabe: Patch-Block starten mit:
  1. Voll-Snapshot Pre-Patch
  2. Code-Patch P1 (Z.10177)
  3. demo_wallet.json-Migration P2
  4. PM2 reload
  5. Tests a-j
  6. Audit-Eintrag + Telegram-OK-Bericht
  7. Snapshot Post-Patch

**J) RISIKEN OFFEN**
1. **Cascade plateau bei pressure=1.0 — kein zusätzliches Risiko** (HIGH-Severity statt CRITICAL bedeutet keine PreKill-Cascade)
2. **demo_wallet.json-Migration**: peakTotal 1002.47 ist Schätzwert. Falls Bot unmittelbar nach Reload höhere effectiveTotal erreicht (z.B. durch Grid-Profit-Tick) → tick-update Z.4735 schreibt höheren Peak → das ist OK.
3. **Bot blockiert Trades bis pressure < 0.5** — durch Incidents-Memory-Cleanup bei Reload automatisch gelöst (Incidents nur in Memory, nicht persistiert).

---

**Pfad dieser Plan-Datei**:
`/Users/christianheilig/NEXUS_CLEAN/KILLSWITCH_FIX_PLAN_20260518_1102.md`
