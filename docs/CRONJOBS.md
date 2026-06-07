# NEXUS Cronjobs — Stand 15.05.2026

## User-Crontab (`crontab -l`)

| Time | Job | Effect |
|---|---|---|
| `0 * * * *` | `sudo purge` | macOS memory cleanup stündlich |
| `0 3 */3 * *` | DB WAL-Checkpoint + VACUUM | DB-Kompaktierung alle 3 Tage 03:00 |
| `*/2 * * * *` | `cron_health_watchdog.sh` | C.2 externer Bot-Watchdog (alle 2 Min) |
| `0 12 * * *` | `midday_balance.sh` → `.midday_latest.md` | **F NEU** Mittagsbilanz |
| `0 22 * * *` | `daily_summary.sh` → `.daily_latest.log` | **F NEU** Tagesbilanz + Telegram |

## Output-Files
- `.midday_latest.md` — letzter 12:00-Snapshot (überschrieben täglich)
- `.daily_latest.log` — letzter 22:00-Log
- Falls Versionierung gewünscht: cron-line um `$(date +\%Y\%m\%d)` ergänzen (siehe Hinweis unten)

## Versionierung (Optional)

Bei cron-Befehlen müssen `%` mit `\%` escaped werden, sonst behandelt cron alles nach `%` als stdin. Beispiel mit Datum-Suffix:
```cron
0 12 * * * /Users/christianheilig/NEXUS_CLEAN/scripts/midday_balance.sh > /Users/christianheilig/NEXUS_CLEAN/.midday_$(date +\%Y\%m\%d).md 2>&1
```

Aktuell ohne Suffix — überschreibt täglich. Bei Bedarf manuell anpassen.

## Existing System-LaunchAgents (`~/Library/LaunchAgents/`)

- `pm2.christianheilig.plist` (root) — PM2-Auto-Start beim Boot
- `com.christian.nexus-wartung.plist` — **DEAKTIVIERT** Tier-Z (12.05.) wegen fehlendem Script

## Smart-Poke

Christian's externer Anstups-Mechanismus (`/tmp/smart_poke.sh`) ist KEIN Cron — manuell in eigenem Terminal-Tab gestartet. Lebenszeit nur Session.

## Health-Watchdog

`cron_health_watchdog.sh` (C.2 Phase 1.4 deployed 14.05.):
- Alle 2 Min /api/health-Check
- Bei Fail: PM2-Restart
- PM2-Pfad mit Fallback-Kette (NVM → homebrew → /usr/local → npm-global)

## Logfiles
- Cron-Output landet typisch in Mail oder stdout-Redirect
- macOS Mail-Spool: `/var/mail/christianheilig`
- Empfehlung: alle cron-jobs mit `>> /tmp/cron.log 2>&1` redirect (oder spezifisches log)

## Status
✅ Doku vollständig
