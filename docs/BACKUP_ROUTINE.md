# NEXUS V9 — Backup-Routine

**Stand:** 15.05.2026
**Autor:** Claude Code F2-Pipeline

## Aktuelle Backup-Statistik

- `server.js.bak.*`: **63 Backups** (~800K each → ~50MB total)
- `public/index.html.bak.*`: **29 Backups**
- `nexus.db.bak.*`: **34 Backups** (~140MB each → ~4.8GB total ⚠️)

Hinweis: DB-Backups sind groß. Bei Bedarf manueller Cleanup (siehe unten).

## Was wird gesichert?

| File | Trigger | Path |
|---|---|---|
| `server.js` | VOR jedem Server-Code-Touch | `~/NEXUS_CLEAN/server.js.bak.{TASK}_{TS}` |
| `public/index.html` | VOR jedem Frontend-Touch | `~/NEXUS_CLEAN/public/index.html.bak.{TASK}_{TS}` |
| `nexus.db` | VOR jeder DB-Migration | `~/NEXUS_CLEAN/nexus.db.bak.{TASK}_{TS}` |
| `data/demo_wallet.json` | Bot persistiert bei Exit automatisch | (kein expliziter Backup-Pfad nötig) |
| `data/demo_positions.json` | Bot persistiert periodisch (5min) | (siehe oben) |

## Naming-Convention

```
{file}.bak.{TASK_LABEL}_{YYYYMMDD_HHMMSS}
```

Beispiele:
- `server.js.bak.BUG2_20260515_073200`
- `server.js.bak.MARATHON_20260515_084200`
- `nexus.db.bak.B5_PRE_APPLY_20260514_162936`
- `public/index.html.bak.V10_ANIM_20260515_082345`

## Git-Tags (parallel zu File-Backups)

```
pre-{task-label}-{YYYYMMDD_HHMMSS}
```

Beispiele:
- `pre-bug2-loss-cooldown-20260515_073201`
- `pre-marathon-architekturfixes-20260515_084200`
- `pre-v10-brain-cockpit-20260515_080507`

Vorteil Git-Tags: kompletter Tree-State, nicht nur einzelne Files.

## Rollback-Anleitung

### Option A — Schnell-Rollback einzelne Datei
```bash
cd ~/NEXUS_CLEAN
cp server.js.bak.{TS} server.js
node --check server.js          # Sanity-Check
pm2 restart nexus --update-env  # Bot neu laden
```

### Option B — Full-Tree-Rollback via Git
```bash
cd ~/NEXUS_CLEAN
git stash                       # Aktuelle Änderungen sichern
git checkout {pre-tag-name}     # zu Tag springen
pm2 restart nexus --update-env  # Bot neu laden
# Bei OK: git checkout main + restore
# Bei Bedarf: git stash pop
```

### Option C — DB-Rollback (ACHTUNG: data loss!)
```bash
# DB-Rollback verwirft ALLE Trade-Daten seit Backup
pm2 stop nexus
cp ~/NEXUS_CLEAN/nexus.db.bak.{TS} ~/NEXUS_CLEAN/nexus.db
pm2 start nexus
```

## Wann wird gesichert?

**VOR JEDEM PATCH** der eine kritische Datei berührt. Niemals skippen mit "war nur klein":

- server.js-Edit → Backup VOR Edit
- public/index.html-Edit → Backup VOR Edit
- DB-Schema-Migration (ALTER TABLE) → Backup VOR Migration
- nexus.db Direct-Insert/Update (außer Bot-Trade-Flow) → Backup

## Backup-Lifecycle (keine Auto-Deletes)

Aktuell: **alle Backups bleiben für immer**. Bei Bedarf manueller Cleanup:

```bash
# Sehr alte server-Backups löschen (>14 Tage)
find ~/NEXUS_CLEAN -name "server.js.bak.*" -mtime +14 -delete

# DB-Backups behalten (selten, kritisch)
ls -la ~/NEXUS_CLEAN/nexus.db.bak.* | wc -l

# Selektiver Cleanup nach Task-Label
ls -la ~/NEXUS_CLEAN/server.js.bak.PHASE1_*
```

**Empfehlung**: DB-Backups nur bei nächster reset_day_zero archivieren/komprimieren.

## Restore-Test (Sanity-Check)

Letzte gemachte Backups stimmen byte-genau mit damaligem State überein:

```bash
# Beispiel: Marathon-Backup
md5 ~/NEXUS_CLEAN/server.js.bak.NOTBREMSE_20260515_*
# Verifiziert pre-T1-State
```

## Aktiver Backup-Workflow

Jeder Patch der diese Anleitung folgt:

```bash
TS=$(date +%Y%m%d_%H%M%S)
cp server.js server.js.bak.{TASK}_$TS
md5 server.js.bak.{TASK}_$TS | awk '{print "md5:",$NF}'  # Verifikation
git tag pre-{task-slug}-$TS
echo "✅ Backup + tag"
# ... Edits ...
node --check server.js
pm2 restart nexus --update-env
```

## Critical Files NICHT in Backups (Risikohinweise)

- `.env` — Bitget-Keys; NICHT in Backups (sicherheits-kritisch). Christian verwaltet via System.
- `.pm2/` — PM2-Config (logrotate, etc.); würde sich bei jedem Restart ändern.
- `node_modules/` — re-installierbar via `npm install`.

## Notfall-Recovery

Bei kompletten System-Crash:

1. `git log` zeigt letzte committed-States
2. `git tag -l "pre-*"` zeigt alle Pre-Patch-Tags
3. `ls server.js.bak.*` zeigt File-Backups
4. Latest stable Tag: `git checkout {tag}` + Bot-Restart

## Status
✅ Doku vollständig
✅ 63 server / 29 html / 34 db Backups aktuell
⚠️ DB-Backups optional cleanup wegen Volumen (4.8GB)
