#!/bin/bash
# C.2 [14.05] Cron-Watchdog für NEXUS V9
# Läuft alle 2 Min via crontab, pingt /api/health.
# Bei 3 Fails in Folge: pm2 restart nexus.
# Externer Failsafe gegen Event-Loop-Block (WSWatchdog v2 ist intern blind dafür).

HEALTH_URL="http://localhost:3000/api/health"
STATE_FILE="/tmp/nexus_health_fails.count"
LOG="$HOME/NEXUS_CLEAN/.cron_watchdog.log"

# PM2-Pfad robust ermitteln — Cron hat minimalen PATH, NVM-Pfade fehlen oft.
# Fallback-Kette: NVM-Pfad direkt → homebrew → which → npm-global.
PM2=""
for p in \
  "$HOME/.nvm/versions/node/v20.20.2/bin/pm2" \
  "/opt/homebrew/bin/pm2" \
  "/usr/local/bin/pm2" \
  "$HOME/.npm-global/bin/pm2"; do
  if [ -x "$p" ]; then PM2="$p"; break; fi
done
[ -z "$PM2" ] && PM2=$(which pm2 2>/dev/null)

FAILS=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
RESP=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$HEALTH_URL")
TS=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$RESP" = "200" ]; then
  echo "$TS OK 200 (fails was $FAILS)" >> "$LOG"
  echo 0 > "$STATE_FILE"
else
  FAILS=$((FAILS + 1))
  echo "$TS FAIL http=$RESP count=$FAILS" >> "$LOG"
  echo "$FAILS" > "$STATE_FILE"
  if [ "$FAILS" -ge 3 ]; then
    echo "$TS TRIGGER: 3x fail → pm2 restart nexus" >> "$LOG"
    "$PM2" restart nexus >> "$LOG" 2>&1
    echo 0 > "$STATE_FILE"
  fi
fi
