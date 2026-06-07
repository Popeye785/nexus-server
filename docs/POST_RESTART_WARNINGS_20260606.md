# POST-RESTART WARNUNGEN REPORT — 06.06.2026

> Read-only Diagnose nach Restart (PID 91590, Dark-Deploy-Code geladen). KEINE Aktivierung, kein Patch, kein DB-Write, kein Trade. MR_ENTRY_ENABLED=false.

## Claim: PASS / GRÜN
Alle 4 Warnungen eingeordnet. Kein neuer Fehler durch Dark Deploy. Kein Kapitalrisiko. Keine MR-Aktivierung.

## Dark Deploy Status (VERIFIZIERT)
- nexus PID 91590, DEMO/PAPER, `brain_alive:true`, uptime ~32 min beim Check.
- `MR_ENTRY_ENABLED=false`, trades=0 seit Restart, killSwitch NORMAL.
- Wallet: total 864.05 / reserve 13.36 (>Bound 4.2661) / trading 850.69. dailyPnl +9.94.

## 1. GRID/BNB Final-Veto — KORREKTES SCHUTZVERHALTEN
- Log: `[FINAL_VETO] sourceBot=GRID symbol=BNBUSDT strategy=GRID op=BUY_FILL reason=STRATEGY_NOT_ALLOWED`.
- Ursache: BNB=MEGA, `allowed_strategies=['MR']` (symbol_universe.js). GRID nicht erlaubt → StrategyVeto blockt. Greift nur bei `BUY_FILL` (exposure-increasing); Maintenance/Sell-Fills laufen durch.
- Live-Grid: `GRID_mq0sb30g_kfss0m` BNB, 10 Levels, 5 Fills, profit +0.0936. → Orphan-Grid auf MEGA-MR-only-Symbol. Kann nur noch auslaufen (keine neuen BUY-Levels).
- Bewertung: kein Bug, Veto korrekt. Konflikt = altes Grid vs. MEGA-Policy. Geld: nur Opportunitätskosten BNB-Range, kein Kapitalrisiko. MR-unabhängig.

## 2. CrashHandler / Evict DISABLED — REALER BEAR-SCHUTZ, Nebenwirkung
- Crash-Snapshot: `lastState=BEAR`, `crash_actions=4`, `longs_closed=0`, `recovery_actions=0`.
- Eviction live: `mode:DISABLED` (`crash_mode_active`), pipeline_runs=37, blocked DISABLED=33.
- Auslöser: CRASH-Detection im BEAR-Markt (crash_recovery_handler.js:113 setzt Eviction DISABLED). 0 Longs geschlossen, weil aktuelles Buch SELL-Sim ist (Handler schließt nur BUY-Longs, :98).
- Re-Enable nur via `_triggerRecoveryActions` (crash_recovery_handler.js:179 → Eviction DRY_RUN) bei RECOVERY-Detection. `recovery_actions=0` → State hängt im Schutzmodus, Eviction bleibt DISABLED.
- Nebenwirkung: Pool 5/5 (`concurrencyOk=false`) rotiert nicht → weniger neue Entries. Handler setzte zudem `dca_size_multiplier=0.3` (System-DB-Write, nicht von Claude). Konservativ, kein Kapitalrisiko.

## 3. RECON V2 DRIFT -5.20 — STABIL, BEKANNTER BACKLOG
- Log (server.js:19941): `V2 DRIFT -5.20 USDT (soll=869.26 ist=864.05 eff=~1072)`. WARN-only, kein Hard-Stop.
- Konstant -5.20 über alle Zeilen → stabil, nicht wachsend, kein neuer Fehler durch Restart. `ist`=Wallet-total.
- Separater Abgleich als WALLET_DRIFT (server.js:6441, total-reserve-trading). Für LIVE Pflicht <1 USDT (CLAUDE.md) — geld-naher Backlog, KEIN MR-Aktivierungs-Blocker.

## 4. ONCHAIN / MACRO — HARMLOS, EXTERNE FEEDS
- `ONCHAIN eth_gas rate-limit NOTOK` (negativer Cache bis TTL); `MACRO btcd fetch fail 400`.
- btcd nur als broadMarket-Feature (server.js:30590-30631, liest ms.cache.btcd). Fail → btcd_change_pct=0/stale. KEIN Trade-Gate (grep: kein block/veto/noTrade-Pfad).
- Bewertung: harmlos, Observability/Sub-Source. Backlog: Feed-Endpoints fixen.

## Geld-/Trading-Effekt
Keine Verluste, kein Kapitalrisiko. Opportunitätskosten: BNB-Grid läuft aus + Eviction-DISABLED hemmt Pool-Rotation (im BEAR ohnehin konservativ gewollt). RECON-Drift = Buchhaltungs-Delta, nicht real abgeflossen.

## Muss vor MR-Aktivierung behoben werden?
- GRID/BNB-Veto: NEIN (MR-unabhängig, korrekt).
- ONCHAIN/MACRO: NEIN (harmlos).
- RECON-Drift: NEIN für MR; JA erst vor LIVE (<1 USDT).
- Eviction-DISABLED: EMPFOHLEN vorher zu klären — wenn MR später MEGA-Positionen öffnet, muss Pool-Rotation funktionieren, sonst tote Slots trotz MR. Kein harter Blocker.

## Backlog (alle Aktionen brauchen eigenes Christian-Go)
1. BNB-Orphan-Grid `GRID_mq0sb30g_kfss0m`: bewusst auslaufen lassen oder schließen.
2. Eviction-Re-Enable: warum triggert Recovery nicht / ggf. manuelles DRY_RUN-Reset (crash_recovery_handler.js:179).
3. MACRO btcd-Endpoint (HTTP 400, API-Format) + eth_gas-Rate-Limit-Quelle.
4. RECON-Drift -5.20 Root-Cause (geld-nah, vor LIVE).

## Nächster sicherer Schritt
Read-only weiter beobachten: Drift-Stabilität + ob Eviction bei Regime-Erholung selbst re-enabled. Alle Backlog-Punkte sind Aktionen mit eigenem Go.

---
2-Wochen-Test wurde NICHT gestartet.
