#!/usr/bin/env bash
# nexus_backup.sh — NEXUS V9 Komplett-Backup auf externe Platte.
# Regel (CLAUDE.md "BACKUP-ZIEL"): nur extern, Mount-Pflicht, STOP wenn nicht gemountet,
# NIE auf interne Disk ausweichen, NIE ueberspringen.
# Dieses Script LOESCHT/PRUNT NICHTS — Retention macht ausschliesslich Christians Hausmeister
# (behaelt letzte 3 Tage, raeumt erst ab <150GB frei).
set -euo pipefail

SRC="$HOME/NEXUS_CLEAN"

# 1. Externe Platte finden (Mount-Pflicht)
DRIVE=$(ls /Volumes/ 2>/dev/null | grep -i nexus | head -1)
if [ -z "$DRIVE" ]; then
  echo "STOP: Externe Platte 'NEXUSBOT V9' nicht gemountet — bitte einstecken. KEIN Fake-Backup auf interne Disk." >&2
  exit 1
fi
echo "DRIVE=$DRIVE"

# 2. Zielpfad mit Timestamp
TS=$(date +%Y%m%d_%H%M%S)
DEST="/Volumes/$DRIVE/backups/NEXUS_CLEAN_$TS"
mkdir -p "$DEST/project" "$DEST/desktop"
echo "DEST=$DEST"

# 3. Projekt (ohne node_modules/.git)
rsync -a --exclude node_modules --exclude .git --exclude '*.bak.*' "$SRC/" "$DEST/project/"

# 4. DB explizit mitnehmen (SQLite + WAL + SHM)
cp "$SRC/nexus.db" "$SRC/nexus.db-wal" "$SRC/nexus.db-shm" "$DEST/project/" 2>/dev/null || true

# 5. Git-Historie als Bundle
( cd "$SRC" && git bundle create "$DEST/project_git.bundle" --all )

# 6. Desktop-Dateien (nexus session + handover)
find "$HOME/Desktop" -maxdepth 1 -iname '*nexus*' -exec cp -a {} "$DEST/desktop/" \;
ls -la "$DEST/desktop/"

# 7. Verify + Manifest
du -sh "$DEST"
ls -lhR "$DEST" | tee "$DEST/BACKUP_MANIFEST_$TS.txt"
echo "BACKUP OK -> $DEST"
