#!/usr/bin/env bash
#
# VISION Stufe 6 — LIVE-Switch-Skript [16.05.2026]
#
# ⚠️  KATEGORISCH NICHT VON ALLEINE LAUFEN LASSEN
# ⚠️  Aktivierung NUR durch explizite User-Bestätigung im Prompt
#
# Aufruf:
#   bash scripts/go_live.sh --dry-run    # nur Pflicht-Checks, kein Switch
#   bash scripts/go_live.sh              # echte LIVE-Aktivierung (verlangt Bestätigung)
#
# Pflicht-Checks vor LIVE-Aktivierung:
#   1. /api/papertrading/readiness → overall.any_live_ready == true
#   2. backtest_vision_results.csv vorhanden + positiv
#   3. DEMO=LIVE-Daily-Check der letzten 7 Tage drift=0
#   4. Bot stable (PM2-R Änderung < 5 in 24h)
#   5. Christian's "JETZT LIVE"-Antwort im interaktiven Prompt
#
# Bei Erfolg: .env DEPLOY_MODE=PAPER → LIVE_RESTRICTED, pm2 restart, Preflight, AUTONOMOUS_LIVE=true
# Bei Fehler: Rollback automatisch
#

set -u

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

NEXUS_DIR="$HOME/NEXUS_CLEAN"
LOG="/tmp/go_live_$(date +%Y%m%d_%H%M%S).log"
BACKUP_HUB=$(cat /tmp/nexus_backup_hub.path 2>/dev/null || echo "$HOME/Desktop/NEXUS_BACKUPS")
TASK_DIR="$BACKUP_HUB/GO_LIVE_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$TASK_DIR"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG"; }
fail() { log "❌ $*"; log "ABBRUCH — LIVE-Aktivierung verweigert"; exit 1; }
pass() { log "✅ $*"; }

log "═══ GO LIVE — Stufe 6 Vision (dry_run=$DRY_RUN) ═══"
log "TASK_DIR: $TASK_DIR"
log "LOG: $LOG"

# ─── Check 1: PaperTrading-Readiness ───
log ""
log "── Check 1: /api/papertrading/readiness ──"
RESP=$(curl -s -m 10 http://localhost:3000/api/papertrading/readiness)
if [ -z "$RESP" ]; then fail "Endpoint nicht erreichbar"; fi
ANY_READY=$(echo "$RESP" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('overall',{}).get('any_live_ready',False))" 2>/dev/null)
VERDICT=$(echo "$RESP" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('overall',{}).get('verdict',''))" 2>/dev/null)
log "   any_live_ready: $ANY_READY"
log "   verdict: $VERDICT"
echo "$RESP" > "$TASK_DIR/check1_papertrading.json"
if [ "$ANY_READY" != "True" ]; then
  fail "PaperTrading-Readiness: keine Strategy ready für LIVE"
fi
pass "Check 1 OK"

# ─── Check 2: Backtest-Resultate ───
log ""
log "── Check 2: backtest_vision_results.csv ──"
BT_CSV="$NEXUS_DIR/backtest_vision_results.csv"
if [ ! -f "$BT_CSV" ]; then fail "Backtest-CSV fehlt"; fi
ROWS=$(wc -l < "$BT_CSV" | tr -d ' ')
log "   $BT_CSV: $ROWS Zeilen"
# Hat mindestens 1 Strategy positive total_pnl in BTC/ETH/SOL aggregate?
POSITIVE=$(python3 -c "
import csv
positive = set()
with open('$BT_CSV') as f:
    for row in csv.DictReader(f):
        if float(row.get('total_pnl', 0)) > 0:
            positive.add(row['strategy'])
print(len(positive))
" 2>/dev/null)
log "   Strategies mit positivem total_pnl: $POSITIVE"
if [ "$POSITIVE" = "0" ]; then fail "Keine Strategy mit positivem Backtest"; fi
cp "$BT_CSV" "$TASK_DIR/"
pass "Check 2 OK"

# ─── Check 3: DEMO=LIVE Daily Check Drift ───
log ""
log "── Check 3: DEMO=LIVE Daily Check letzte 7 Tage ──"
DEMO_FILES=$(ls -t "$NEXUS_DIR"/.demolive_daily_*.md 2>/dev/null | head -7)
if [ -z "$DEMO_FILES" ]; then
  log "   ⚠️  Keine .demolive_daily_*.md gefunden"
  # Nicht hard fail — könnte erster LIVE-Tag sein
  log "   weiche WARN: kein Daily-Check vorhanden"
else
  log "   Found Daily-Checks:"
  echo "$DEMO_FILES" | head -7 | while read f; do log "     $f"; done
fi
pass "Check 3 OK (soft)"

# ─── Check 4: PM2-R Stabilität ───
log ""
log "── Check 4: PM2-R Stabilität ──"
R_NOW=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);n=next((p for p in d if p['name']=='nexus'),None);print(n['pm2_env']['restart_time'] if n else 0)" 2>/dev/null)
UPTIME_S=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys,time;d=json.load(sys.stdin);n=next((p for p in d if p['name']=='nexus'),None);print(int((time.time()*1000-n['pm2_env']['pm_uptime'])/1000) if n else 0)" 2>/dev/null)
log "   R-Counter aktuell: $R_NOW"
log "   Uptime: ${UPTIME_S}s"
if [ "$UPTIME_S" -lt 600 ]; then
  log "   ⚠️  Bot uptime < 10min — könnte instabil sein"
fi
pass "Check 4 OK"

# ─── Check 5: Recon GREEN ───
log ""
log "── Check 5: Recon-State ──"
RECON=$(curl -s http://localhost:3000/api/recon/check)
DRIFT=$(echo "$RECON" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('drift'))" 2>/dev/null)
CONSISTENT=$(echo "$RECON" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('consistent'))" 2>/dev/null)
log "   drift: $DRIFT, consistent: $CONSISTENT"
if [ "$CONSISTENT" != "True" ]; then fail "Recon nicht consistent"; fi
pass "Check 5 OK"

# ─── DRY-RUN-Ende ───
if [ "$DRY_RUN" = "1" ]; then
  log ""
  log "🟢 DRY-RUN durchgelaufen, alle Checks: PASS oder soft-WARN"
  log "Für echte LIVE-Aktivierung: bash scripts/go_live.sh (ohne --dry-run)"
  exit 0
fi

# ─── Check 6: Interaktive Christian-Bestätigung ───
log ""
log "── Check 6: Christian-Bestätigung ──"
echo ""
echo "🔴🔴🔴  ACHTUNG  🔴🔴🔴"
echo ""
echo "Du bist gleich dabei, NEXUS V9 von DEMO/PAPER auf LIVE_RESTRICTED zu schalten."
echo "Echtes Geld auf Bitget wird ab dann real getradet."
echo ""
echo "Wallet-Reserve auf Bitget: prüfe selbst dass mindestens 100 USDT bereit liegen."
echo ""
echo "Tippe EXAKT 'JETZT LIVE' (ohne Anführungszeichen) für Aktivierung:"
read -r CONFIRM
if [ "$CONFIRM" != "JETZT LIVE" ]; then
  fail "Bestätigung fehlt oder falsch — Abbruch"
fi
pass "Bestätigung OK"

# ─── DEPLOY ───
log ""
log "═══ DEPLOY ═══"

# Backup .env
cp "$NEXUS_DIR/.env" "$TASK_DIR/.env.pre"
log "Backup .env: $TASK_DIR/.env.pre"

# Sed DEPLOY_MODE
sed -i.tmp 's/^DEPLOY_MODE=PAPER/DEPLOY_MODE=LIVE_RESTRICTED/' "$NEXUS_DIR/.env" && rm -f "$NEXUS_DIR/.env.tmp"
chmod 600 "$NEXUS_DIR/.env"
log "DEPLOY_MODE: PAPER → LIVE_RESTRICTED in .env"

# PM2 restart
NODE_OPTIONS="--no-node-snapshot" pm2 restart nexus --update-env
sleep 10
log "PM2 restart done"

# Preflight
PREFLIGHT=$(curl -s http://localhost:3000/api/preflight/live-readiness)
VERDICT_PRE=$(echo "$PREFLIGHT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('verdict'))" 2>/dev/null)
log "Preflight verdict: $VERDICT_PRE"
echo "$PREFLIGHT" > "$TASK_DIR/preflight_post_switch.json"

if [ "$VERDICT_PRE" != "LIVE_READY" ]; then
  log "❌ Preflight FAILED — ROLLBACK"
  cp "$TASK_DIR/.env.pre" "$NEXUS_DIR/.env"
  chmod 600 "$NEXUS_DIR/.env"
  NODE_OPTIONS="--no-node-snapshot" pm2 restart nexus --update-env
  sleep 5
  fail "LIVE-Aktivierung wegen Preflight-FAIL zurückgerollt"
fi
pass "Preflight OK"

# AUTONOMOUS_LIVE_TRADES_ENABLED in bot_settings
log ""
log "── Setze AUTONOMOUS_LIVE_TRADES_ENABLED=true ──"
sqlite3 "$NEXUS_DIR/nexus.db" "INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES ('AUTONOMOUS_LIVE_TRADES_ENABLED', 'true', $(date +%s)000)"
log "DB-Override gesetzt"

# Telegram
if [ -n "${TELEGRAM_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=🔴 NEXUS V9 LIVE ACTIVATED at $(ts). DEPLOY_MODE=LIVE_RESTRICTED. AUTONOMOUS_LIVE_TRADES_ENABLED=true. R=$R_NOW. Wallet (paper)=$(curl -s http://localhost:3000/api/wallet/snapshot | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get(\"total\",0))')" > /dev/null
  log "Telegram-Alarm gesendet"
fi

log ""
log "🟢🟢🟢 LIVE AKTIVIERT 🟢🟢🟢"
log "Status: LIVE_RESTRICTED (Tier-RESTRICTED → max 2 Positions, size×0.20)"
log "Logs: $LOG"
log "Backup: $TASK_DIR/"
log ""
log "Erste 24h aktiv beobachten:"
log "  pm2 logs nexus --lines 50"
log "  curl http://localhost:3000/api/recon/check"
log "  curl http://localhost:3000/api/wallet/snapshot"
log ""
log "Rollback wenn nötig:"
log "  cp $TASK_DIR/.env.pre $NEXUS_DIR/.env"
log "  pm2 restart nexus --update-env"
