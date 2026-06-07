# NEXUS V9 — Next Chat Summary for Codex

Stand: 2026-06-05 morgens.

## Arbeitsweise

Christian ist Owner und Entscheider, kein Programmierer. Er kopiert Nachrichten zwischen Claude Code, Claude Web und Codex. Er will keine Multiple-Choice-Karten, keine Option-A/B/C-Fragen und keine künstlichen Stopps. Er erwartet klare technische Einschätzung, Claim-Status, eindeutige Empfehlung und sauberes Durchziehen innerhalb der Rollen.

Codex ist Senior-Reviewer, Analyst, Spezifizierer und Block-Bauer. Codex prüft Claude-Code-Outputs, erklärt kurz verständlich und baut ausführbare Blöcke für Claude Code. Keine echten Code-/DB-Änderungen als deployed verkaufen, wenn sie nicht auf der echten Maschine passiert sind.

Claude Code ist der Akteur auf der echten Maschine. Er darf patchen, starten, stoppen, DB prüfen, PM2 nutzen und Tests ausführen. Er muss Backup/Snapshot/Restore-Disziplin halten.

Claude Web ist Analyse, Gegenprüfung und Übersetzer/Block-Bauer ohne sicheren Maschinenzugriff.

## Pflichtregeln

Claim-Status immer:
- VERIFIZIERT = mit Output/Quelle belegt.
- PLAUSIBEL = logische Inferenz aus Verifiziertem.
- UNSICHER = Indiz, nicht bewiesen.
- UNBEKANNT = keine Aussage möglich.

Safeties:
- LIVE bleibt aus.
- TEST_ONLY bleibt true.
- Modus bleibt PAPER/DEMO.
- Reserve bleibt unantastbar.
- Kein Force-Buy.
- Kein Router-/Trading-Patch während laufendem Test.
- Kein DB-Write bei Read-only-Diagnosen.
- Kein VACUUM live.
- Kein Desktop/iCloud-Cleanup automatisch.
- Keine DB/WAL/SHM löschen.
- Bei DB-Fail: erst Forensik sichern, dann Restore.
- Demo und LIVE müssen denselben Entscheidungsweg nutzen; nur Order-Send darf verschieden sein.

## Was erledigt wurde

DB-Stabilität/P3:
- VERIFIZIERT: P3/P3.1 DB-Korruptionsarbeit abgeschlossen.
- VERIFIZIERT: 120s, 60s, 30s getestet.
- VERIFIZIERT: 30s-Canary 4h clean bestanden.
- VERIFIZIERT: WAL blieb flach, CheckpointOwner funktionierte, DB quick_check ok.
- VERIFIZIERT: Reserve blieb unangetastet.

EventLoop/Telegram/Systemlast:
- VERIFIZIERT: P6.1/P6.2 beruhigten EventLoop- und Telegram-Stürme.
- VERIFIZIERT: Onchain/eth_gas Negative Cache und Security-Log-Coalescing wurden eingebaut.

Governor/Mac-Disk:
- VERIFIZIERT: Alter Fehler war df/hardFree-only. Dadurch falsche Telegram-Warnungen wie DISK_WARN_11GB trotz macOS 70-80 GB verfügbar.
- VERIFIZIERT: P7.2 MacResourceWatcher gebaut.
- VERIFIZIERT: Hauptquelle jetzt NSURLVolumeAvailableCapacityForImportantUsageKey, also macOS/Finder-Sicht.
- VERIFIZIERT: Telegram/Governor nutzt jetzt Disk macOS/hard/purgeable/RAM/CPU/WAL aus gleicher ResourceWatcher-Quelle.

MAC_MINI_GUARDIAN:
- VERIFIZIERT: Externer Guardian gebaut, getrennt von NEXUS.
- VERIFIZIERT: Finaler Laufpfad: /Users/christianheilig/MAC_MINI_GUARDIAN.
- VERIFIZIERT: Läuft per PM2 als mac-mini-guardian.
- VERIFIZIERT: Dashboard/API erreichbar: http://127.0.0.1:8787.
- VERIFIZIERT: Misst Disk macOS/hard/purgeable, RAM, Swap, CPU, Top-Prozesse, NEXUS-Status, externe Platte.
- VERIFIZIERT: Telegram-Command-Receiver gebaut: /mac status, /mac top, /mac disk, /mac ram, /mac clean dryrun, /mac clean confirm, /mac pause-heavy, /mac resume-heavy, /mac restart-nexus-safe.
- VERIFIZIERT: Gefährliche Aktionen brauchen Confirm-Token. Kein Auto-Sudo, keine Trading-Logik, keine DB-Manipulation.

RAM-Erkenntnis:
- VERIFIZIERT: NEXUS war nicht der RAM-Fresser, ungefähr 90-130 MB.
- VERIFIZIERT/PLAUSIBEL: Große Verbraucher waren eher Claude/Codex/Unity/Terminal.
- Konsequenz: Guardian soll Schuldigen anzeigen und NEXUS nicht neu starten, wenn NEXUS nicht Ursache ist.

Trading-Qualität Read-only Diagnose:
- VERIFIZIERT: Testfenster zeigte 0 BUY, 43 HOLD, 759 SELL.
- VERIFIZIERT: Aladdin war komplett bearish.
- VERIFIZIERT: Bot kann Spot/Paper-seitig SELL ohne echte Short-Funktion nicht sinnvoll ausführen. Ergebnis wirkt wie "tradet nicht".
- VERIFIZIERT: NEARUSDT hatte Anomalie: PRICE_SPIKE Z=8.64, VOLATILITY_EXPLOSION Z=9.54.
- VERIFIZIERT: Echt-Bot nahm NEAR nicht; ShortShadow öffnete Simulation.
- VERIFIZIERT: blocked_trades schrieb im Testfenster nichts. SELL ohne Short wird vermutlich still verworfen.
- VERIFIZIERT: Aktive Coin-Liste war zu eng: aktiv nur SEI/NEAR/ADA.
- VERIFIZIERT: EventLoop hatte einen harten Einzelblock ca. 10.8s. Ursache offen, evtl. Checkpoint/Heavy-Compute.

Nach-Test-Backlog:
- VERIFIZIERT: Claude Code speicherte Punkte in memory/project_post_test_todos_2026_06_04.md und memory/MEMORY.md.

## Aktueller Zustand

- LIVE aus.
- PAPER/TEST_ONLY aktiv.
- Reserve unangetastet, zuletzt ca. 5.4237 USDT.
- NEXUS stabil.
- MAC_MINI_GUARDIAN läuft per PM2.
- Dashboard erreichbar unter http://127.0.0.1:8787.
- Laufender Trading-Test soll bis Testende nicht gestört werden.

## Offen nach Testende

1. Endauswertung des laufenden Tests:
   ShortShadow closed/open Sims, GridSim Outcomes, PnL bps, Win/Loss, Symbole, Dauer, NEAR-Outcome.

2. SELL_NO_POSITION_NO_SHORT sichtbar machen:
   SELL-Signale ohne Short vermutlich still verworfen. Als theoretical block in blocked_trades loggen.

3. Eviction-Mode-Switch persistieren:
   DRY_RUN -> LIVE muss in ein Log.

4. EventLoop-Block forensisch fassen:
   10.8s Block um 20:59 untersuchen. Checkpoint? Heavy compute? Scanner? Telegram?

5. Aktive Symbol-Liste reparieren:
   Nicht nur 3 aktive Coins. BTC/ETH/SOL plus starke Scanner-Coins strategisch in aktive Beobachtung, Aladdin/Scanner-getrieben.

6. ShortShadow bewerten:
   Nur bei Edge-Beweis echten Short-Bot bauen. Kein blindes Short-Einschalten.

7. Grid/InfGrid bewerten:
   Nur wenn GridSim echte Edge zeigt. Rest-Inventar mark-to-market zählen.

## Technische Kernaussage

Der Bot handelt nicht zu wenig, weil er tot ist. Er handelt zu wenig, weil Aladdin bearish ist und NEXUS aktuell für bearish Markt noch kein echtes Short-Werkzeug hat. Spot-only SELL ohne Position heißt meistens: nichts tun.

Nächster sinnvoller Auftrag: Test-Ende-Auswertung read-only, dann Forensik-Lücken patchen, danach Trading-Logik entscheiden.
