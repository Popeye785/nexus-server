#!/usr/bin/env bash
# Audit V10 Watcher (15.05.2026 LIVE-Readiness)
# Pollt alle 60s Bot-Health. Trigger bei:
#   - PM2 restart-count > PRE_R + 10
#   - recon drift > 0
#   - wallet total delta > 1 USDT zwischen zwei polls
#   - ERROR in pm2 logs seit letztem poll
# Bei Trigger: log + Telegram (wenn Token verfügbar)
# Output: /tmp/audit_v10.log (rolling), /tmp/audit_v10_events.jsonl

set -u
LOG=/tmp/audit_v10.log
EVT=/tmp/audit_v10_events.jsonl
PIDFILE=/tmp/audit_v10.pid
echo "$$" > "$PIDFILE"

BASE_URL="http://localhost:3000"
NEXUS_CWD="$HOME/NEXUS_CLEAN"
SLEEP_S=60

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG"; }
evt() { echo "{\"ts\":\"$(ts)\",\"kind\":\"$1\",\"msg\":$(echo "$2" | python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))")}" >> "$EVT"; }

PRE_R=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);n=next((p for p in d if p['name']=='nexus'),None);print(n['pm2_env']['restart_time'] if n else 0)" 2>/dev/null || echo 0)
PRE_WALLET=$(curl -s -m 3 "$BASE_URL/api/wallet/snapshot" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('total',0))" 2>/dev/null || echo 0)
TRIGGER_R=$((PRE_R + 10))

log "═══ Audit V10 START — PRE_R=${PRE_R}, TRIGGER_R=${TRIGGER_R}, PRE_WALLET=${PRE_WALLET}, sleep=${SLEEP_S}s ═══"
evt "START" "PRE_R=${PRE_R} TRIGGER_R=${TRIGGER_R} PRE_WALLET=${PRE_WALLET}"

LAST_WALLET="$PRE_WALLET"
LAST_LOG_TS=$(date +%s)

while true; do
    sleep "$SLEEP_S"

    # Restart count
    R=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);n=next((p for p in d if p['name']=='nexus'),None);print(n['pm2_env']['restart_time'] if n else -1)" 2>/dev/null || echo -1)

    # Wallet + recon
    W=$(curl -s -m 5 "$BASE_URL/api/wallet/snapshot" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('total',0))" 2>/dev/null || echo "$LAST_WALLET")
    RECON=$(curl -s -m 5 "$BASE_URL/api/recon/check" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('drift',0),'|',d.get('consistent',False))" 2>/dev/null || echo "?|?")

    # Wallet delta
    DELTA=$(python3 -c "print(abs(${W} - ${LAST_WALLET}))" 2>/dev/null || echo 0)

    log "tick: R=${R} W=${W} ΔW=${DELTA} recon=${RECON}"

    # Triggers
    if [ "$R" != "-1" ] && [ "$R" -gt "$TRIGGER_R" ]; then
        log "🚨 TRIGGER: PM2 R=${R} > TRIGGER_R=${TRIGGER_R}"
        evt "PM2_RESTART_STORM" "R=${R} TRIGGER_R=${TRIGGER_R}"
    fi

    DRIFT=$(echo "$RECON" | awk -F'|' '{print $1}' | tr -d ' ')
    if [ -n "$DRIFT" ] && [ "$DRIFT" != "0" ] && [ "$DRIFT" != "?" ]; then
        # Drift could be float; check if > 0
        IS_NZ=$(python3 -c "print(1 if abs(${DRIFT}) > 0.001 else 0)" 2>/dev/null || echo 0)
        if [ "$IS_NZ" = "1" ]; then
            log "🚨 TRIGGER: recon drift=${DRIFT}"
            evt "RECON_DRIFT" "drift=${DRIFT}"
        fi
    fi

    DELTA_TRIG=$(python3 -c "print(1 if ${DELTA} > 1.0 else 0)" 2>/dev/null || echo 0)
    if [ "$DELTA_TRIG" = "1" ]; then
        log "⚠️  Wallet ΔW=${DELTA} > 1 USDT (W=${W} prev=${LAST_WALLET})"
        evt "WALLET_DELTA" "delta=${DELTA} now=${W} prev=${LAST_WALLET}"
    fi

    # Check for new ERROR in pm2 error log (since last poll)
    NEW_ERR=$(tail -100 ~/.pm2/logs/nexus-error.log 2>/dev/null | grep -c "^$(date '+%Y-%m-%d')" || echo 0)
    if [ "$NEW_ERR" != "0" ] && [ "$NEW_ERR" != "" ]; then
        # Crude check — log first error from today
        ERR_LINE=$(tail -100 ~/.pm2/logs/nexus-error.log 2>/dev/null | grep "^$(date '+%Y-%m-%d')" | head -1 || echo "")
        log "⚠️  Today error-log lines=${NEW_ERR}, sample: ${ERR_LINE:0:120}"
    fi

    LAST_WALLET="$W"
done
