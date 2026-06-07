# CLAUDE.md — NEXUS Arbeits- & Engineering-Framework

> Wird von Claude Code beim Start automatisch gelesen. Diese Regeln gelten verbindlich.

## LEITPRINZIP
Klarheit > Sicherheit > Reproduzierbarkeit > Stabilität > Recovery > Beobachtbarkeit > Funktion > Geschwindigkeit > Komfort.

## WAHRHEITSGEBOT
Kein Raten, keine Halluzinationen, keine erfundenen APIs/Logs/Tests/Ergebnisse. Keine stillen Annahmen. Kein "wahrscheinlich" als Fakt. Kein Weiterbau auf ungeprüfter Basis. "Ich weiß es nicht" ist erlaubt und besser als Erfinden.

## KERNREGELN
Erst verstehen dann ändern. Erst Ursache dann Symptom. Erst verifizieren dann behaupten. Erst testen dann "fertig". Minimalinvasiv vor Komplettumbau. Stabilität schlägt Eleganz. Bei Unklarheit: stoppen, markieren, nachfragen.

## CLAIM-GATE
Jede technische Aussage klassifizieren: VERIFIZIERT (Evidenz-Pfad nennen: Datei+Zeile, curl-Output, Log, Test-Run) / PLAUSIBEL / UNSICHER / UNBEKANNT. Vor "funktioniert/gefixt/stabil/sicher/produktionsreif": reale Signale prüfen. Bei "fertig/deployed": Roh-Beweis zeigen, nicht Beschreibung. Tabellen: Pre- UND Post-Werte.

## STOPP-REGEL
Sofort stoppen bei: unklarer Zielwirkung, fehlender Testbarkeit, widersprüchlichen Logs, fehlendem Rollback, Datenverlust-Risiko, Secrets-Risiko, kritischer Drift, nicht reproduzierbarem Verhalten. Dann: Zustand sichern, Problem dokumentieren, Risiko markieren, sichere nächste Aktion nennen.

## DECISION-GATES (vor jeder Änderung)
Aufgabe klar? Recherche nötig? Aktion kritisch? Backup nötig? Simulation möglich? Testbar? Rollback möglich? Reproduzierbar? Zielzustand definiert? Bei "nein/unklar": nicht blind weiter.

## RESEARCH-FIRST
Bei APIs/Frameworks/Security/Runtime-/Build-Fehlern/Dependencies: erst recherchieren (offizielle Doku, Changelogs, Advisories, GitHub Issues), dann implementieren. Widersprüche benennen.

## PREMORTEM (vor Architektur-/DB-/Security-/Prod-Änderungen)
Warum könnte das Datenverlust/Instabilität/Ausfall verursachen? Wahrscheinlichster Fehler? Schlimmster Fehler? Welche Annahme kann falsch sein? Wie wird zurückgerollt? Ausgabe: Top-Risiken, Gegenmaßnahmen, nötige Tests, Status (SICHER/UNSICHER/NUR MIT FREIGABE).

## SIMULATION & TEST (nach jedem Patch)
Syntax, Runtime, Logs, Edge Cases, Nebenwirkungen, Async/Timing, Fehlerpfade, Recovery, Integrationen, State-Konsistenz. Bei Fehler: stoppen, isolieren, fixen, erneut prüfen.

## DEFINITION-OF-DONE (alle Punkte = fertig)
1 Architecture-Fit, 2 No-Regressions, 3 UI-Verifikation, 4 Restart-Persistenz, 5 Error-Pfad ohne silent-fail, 6 Rollback getestet, 7 keine Performance-Regression, 8 Edge-Cases, 9 Logs/Audit, 10 Docs, 11 PAPER- und LIVE-Pfad identisch. Endbericht braucht DoD-Tabelle. Ohne Tabelle = nicht fertig.

## KOMMUNIKATION
Jede Aussage mit Claim-Status. Verboten als Abschluss: "sollte funktionieren". Verboten: "Code ist drin" als Beweis für "Code wirkt", Frontend ungeprüft wenn Backend gefixt. Ehrliche-Lücken-Sektion Pflicht: was nicht verifiziert, warum, Severity (LOW/MED/HIGH/CRITICAL), nächster Schritt.

## ZEIT & MARKT
Datum/Uhrzeit aus System holen, nicht Memory. Externe Daten: Quelle+Timestamp+UTC. Markt: min. 3 Quellen, Diff >=0.5% = STOP, Vorzeichen-Diskrepanz = SOFORT STOP. Candle-Ordnung per sort by ts verifizieren.

## KRITISCHE AKTIONEN NUR MIT FREIGABE
Prod-Deployments, echte Nutzerdaten, Trading/Payment/Auth-Logik, DB-Migrationen, CI/CD, Scheduler, Secrets, irreversibles, LIVE-Modus. Vorher: Risiko nennen, Patch zeigen, Rollback-Plan zeigen, Freigabe einholen. Niemals automatisch in LIVE.

## BACKUP & ROLLBACK
Vor kritischer Datei-Änderung: cp <datei> <datei>.bak.$(date +%Y%m%d_%H%M%S)
Nach Patch: node --check <datei> && pm2 restart nexus --update-env
Rollback: cp <datei>.bak.<TS> <datei> && node --check <datei> && pm2 restart nexus --update-env

## BACKUP-ZIEL (verbindlich)
Alle Backups gehen auf die externe Platte /Volumes/<NEXUS-Drive>/backups/ mit Timestamp (Drive aktuell "NEXUSBOT V9"). Vor jedem Backup Mount pruefen; wenn nicht gemountet: STOP + Christian warnen (Platte einstecken), NICHT auf interne Disk schreiben, NICHT ueberspringen. RETENTION/AUFRAEUMEN macht AUSSCHLIESSLICH Christians vorhandener Hausmeister (behaelt letzte 3 Tage, raeumt erst ab <150GB frei) — das Backup-Script loescht NICHTS und prunt NICHTS. Standard-Script: scripts/nexus_backup.sh.

## PROJEKT NEXUS (aus fruheren Sessions - gegen echten Code verifizieren)
Verzeichnis ~/NEXUS_CLEAN. Dateien server.js (Backend), index.html (Frontend), package.json. PM2-Prozess "nexus", Neustart pm2 restart nexus --update-env. Server http://localhost:3000. DB = SQLite = Single Source of Truth, Memory nur Cache. Modi PAPER und LIVE, Logik identisch. ConsistencyGuardian laeuft alle 30s (Memory-Ghosts, DB-Orphans, Wallet-Drift >0.5 USDT, Safe-Modus nach 3 Drifts) - behalten. Janitor behalten. NewsSentiment nutzt nur cryptocurrency.cv/api/news (gratis), 402-Endpoints ignorieren, Sentiment selbst rechnen. Feature-Toggles als DB-Setting, nicht CFG.

## PERMISSIONS
Regeln in .claude/settings.local.json. Frei: Reads, node --check, curl localhost, pm2 restart/start/logs, SQLite SELECT/INSERT/UPDATE, Backups, git commit/push origin main, Edits server.js/index.html/package.json. Fragen: pm2 stop/delete, DB DROP/DELETE/ALTER, npm install, alles LIVE. Gesperrt: .env, rm -rf, git push --force, git reset --hard, chmod 777, dd, mkfs, curl|bash. STOPP-Punkte aus Spec immer respektieren.
