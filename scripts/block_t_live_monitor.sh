#!/bin/bash
# scripts/block_t_live_monitor.sh
# Block T-Live [27.05.2026]: 15-Min-Monitor mit Sofort-Abbruch-Disziplin.
# Block T+ Mini [27.05.2026]: Stop-Gates erweitert (pm2-online + Bot-Health + Down>30s).
#
# Usage:
#   bash scripts/block_t_live_monitor.sh                  # single check, exit-code 0=OK, 1=STOP-GATE
#   bash scripts/block_t_live_monitor.sh --abort          # forciert Flag-Reset auf false

set +e
NEXUS=/Users/christianheilig/NEXUS_CLEAN
DB="$NEXUS/nexus.db"
TS=$(date +'%Y-%m-%d %H:%M:%S')
LOG=/tmp/block_t_live_monitor.log
BOT_DOWN_SINCE_FILE=/tmp/block_t_bot_down_since.txt
BOT_DOWN_MAX_SECONDS=30

abort_flag_reset() {
  local reason="$1"
  echo "🔴 STOP-GATE: $reason  [$TS]" | tee -a "$LOG"
  sqlite3 "$DB" "UPDATE bot_settings SET value='false', updated_at=strftime('%s','now')*1000 WHERE key='autonomous_demo_trades_enabled'"
  echo "  → flag autonomous_demo_trades_enabled forced to false" | tee -a "$LOG"
  sqlite3 "$DB" "SELECT 'verify=',value FROM bot_settings WHERE key='autonomous_demo_trades_enabled'" | tee -a "$LOG"
  exit 1
}

check_bot_online() {
  # 1. PM2-Process online?
  local PM2_STATUS
  PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; p=[x for x in json.load(sys.stdin) if x.get('name')=='nexus']; print(p[0]['pm2_env']['status']) if p else print('NO_PROC')" 2>/dev/null || echo "ERROR")
  # 2. Health-Endpoint erreichbar?
  local HTTP_CODE
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/test-only/status 2>/dev/null || echo "0")
  if [ "$PM2_STATUS" = "online" ] && [ "$HTTP_CODE" = "200" ]; then
    rm -f "$BOT_DOWN_SINCE_FILE"
    return 0
  fi
  # Bot down → tracking start
  local NOW=$(date +%s)
  if [ ! -f "$BOT_DOWN_SINCE_FILE" ]; then
    echo "$NOW" > "$BOT_DOWN_SINCE_FILE"
    echo "🟡 Bot health degraded (pm2=$PM2_STATUS http=$HTTP_CODE), tracking started @ $NOW" | tee -a "$LOG"
    return 0
  fi
  local DOWN_SINCE
  DOWN_SINCE=$(cat "$BOT_DOWN_SINCE_FILE" 2>/dev/null || echo "$NOW")
  local DOWN_FOR=$((NOW - DOWN_SINCE))
  if [ "$DOWN_FOR" -gt "$BOT_DOWN_MAX_SECONDS" ]; then
    abort_flag_reset "bot_down_for_${DOWN_FOR}s (pm2=$PM2_STATUS http=$HTTP_CODE)"
  fi
  echo "🟡 Bot still down for ${DOWN_FOR}s (threshold ${BOT_DOWN_MAX_SECONDS}s)" | tee -a "$LOG"
  return 0
}

if [ "${1:-}" = "--abort" ]; then
  abort_flag_reset "manual_abort_requested"
fi

echo "═════════════════════════════════════════════════════════════════"
echo "Block T-Live Monitor — $TS"
echo "═════════════════════════════════════════════════════════════════"

# 1. Bot-Health (Block T+ Mini: pm2-online + http-Endpoint + Auto-Down>30s)
echo ""
echo "## 1. Bot-Health"
pm2 list 2>&1 | awk '/nexus[[:space:]]/' || true
check_bot_online

# 2. Guardian
echo ""
echo "## 2. Guardian"
GUARD=$(curl -s http://localhost:3000/api/guardian/status 2>/dev/null)
echo "$GUARD" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  state={d.get('lastState')} runs={d.get('stats',{}).get('runs')} cons-bad={d.get('consecutiveBad')}\")"
GUARD_STATE=$(echo "$GUARD" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('lastState'))")
if [ "$GUARD_STATE" = "RED" ]; then abort_flag_reset "guardian_RED"; fi

# 3. Reserve
echo ""
echo "## 3. Reserve"
RESERVE=$(cat "$NEXUS/data/demo_wallet.json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('reserve',0))")
echo "  reserve=\$$RESERVE (Erwartung: ~\$3.34)"
RESERVE_INT=$(echo "$RESERVE" | python3 -c "import sys;v=float(sys.stdin.read().strip());print(1 if v < 3.30 or v > 3.40 else 0)")
if [ "$RESERVE_INT" = "1" ]; then abort_flag_reset "reserve_modified: \$$RESERVE"; fi

# 4. Flag-Status
echo ""
echo "## 4. autonomous_demo_trades_enabled"
FLAG=$(sqlite3 "$DB" "SELECT value FROM bot_settings WHERE key='autonomous_demo_trades_enabled'")
echo "  flag=$FLAG"

# 5. Trade-Attempts last 15min
echo ""
echo "## 5. Trades last 15min"
sqlite3 "$DB" "SELECT symbol, count(*), GROUP_CONCAT(state) FROM trades WHERE created_at > strftime('%s','now','-15 minutes')*1000 GROUP BY symbol" | sed 's/^/  /'

# 6. Phantom-Coin-Trade-Check (HARD STOP-GATE)
echo ""
echo "## 6. Phantom-Coin-Trade-Check (HARD STOP-GATE)"
PHANTOM_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM trades WHERE symbol IN ('SEIUSDT','POLUSDT','DOTUSDT','LTCUSDT','UNIUSDT','ARBUSDT','OPUSDT','APTUSDT','ATOMUSDT') AND created_at > strftime('%s','now','-2 hour')*1000")
echo "  phantom-trades last 2h: $PHANTOM_COUNT (Erwartung: 0)"
if [ "$PHANTOM_COUNT" != "0" ]; then abort_flag_reset "phantom_coin_traded: $PHANTOM_COUNT"; fi

# 7. MEGA+TREND-Check (HARD STOP-GATE — falls strategy-Spalte vorhanden)
echo ""
echo "## 7. MEGA+TREND-Check"
MEGATREND=$(sqlite3 "$DB" "SELECT COUNT(*) FROM trades WHERE symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT') AND strategy LIKE '%TREND%' AND created_at > strftime('%s','now','-2 hour')*1000" 2>/dev/null || echo 0)
echo "  MEGA+TREND-trades last 2h: $MEGATREND (Erwartung: 0)"
if [ "${MEGATREND:-0}" -gt 0 ]; then abort_flag_reset "MEGA_TREND_traded: $MEGATREND"; fi

# 8. SUI-only-ohne-NEAR (warnings)
echo ""
echo "## 8. SUI-Pair-Context"
NEAR_DEC=$(sqlite3 "$DB" "SELECT COUNT(*) FROM aladdin_decisions WHERE symbol='NEARUSDT' AND ts > strftime('%s','now','-1 hour')*1000 AND confidence>=0.05")
SUI_TRADES=$(sqlite3 "$DB" "SELECT COUNT(*) FROM trades WHERE symbol='SUIUSDT' AND created_at > strftime('%s','now','-15 minutes')*1000")
echo "  NEAR decisions last 1h: $NEAR_DEC (≥3 = pair-active)"
echo "  SUI trades last 15min: $SUI_TRADES"
if [ "${NEAR_DEC:-0}" -lt 3 ] && [ "${SUI_TRADES:-0}" -gt 0 ]; then abort_flag_reset "SUI_solo_without_NEAR: NEAR=$NEAR_DEC SUI=$SUI_TRADES"; fi

# 9. Router-Veto-Stats
echo ""
echo "## 9. Router Veto-Stats last 1h"
curl -s "http://localhost:3000/api/router/veto-stats?hours=1" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'  total={d.get(\"total\")} allowed={d.get(\"allowed\")} blocked={d.get(\"blocked\")} analysis={d.get(\"analysis_only\")}')
print(f'  by_veto: {d.get(\"by_veto\")}')"

# 10. Veto-Marker im pm2 last 1000 lines
echo ""
echo "## 10. Veto-Marker im pm2-Log (last 1000 lines)"
PM2_LOG=$(pm2 logs nexus --lines 1000 --nostream 2>&1)
ANL=$(echo "$PM2_LOG" | grep -cE "ANALYSIS_ONLY")
STR=$(echo "$PM2_LOG" | grep -cE "STRATEGY_VETO|STRATEGY_FORBIDDEN|STRATEGY_NOT_ALLOWED")
PAR=$(echo "$PM2_LOG" | grep -cE "PAIR_VETO|PAIR_REQUIRED")
UNI=$(echo "$PM2_LOG" | grep -cE "UNIVERSE_VETO|NOT_IN_TRADING_UNIVERSE")
FIN=$(echo "$PM2_LOG" | grep -cE "FINAL_ROUTER")
echo "  ANALYSIS_ONLY:      $ANL"
echo "  STRATEGY_FORBIDDEN: $STR"
echo "  PAIR_REQUIRED:      $PAR"
echo "  UNIVERSE_VETO:      $UNI"
echo "  FINAL_ROUTER total: $FIN"

# 11. Echte Trade-Open-Events (pm2)
echo ""
echo "## 11. Trade-Open-Events in pm2"
echo "$PM2_LOG" | grep -iE "_executeTrade|DEMO.*OPEN|TRADE_OPEN" | grep -v skipped | tail -5

# 12. Errors
echo ""
echo "## 12. Errors last 1000 lines"
ERR=$(echo "$PM2_LOG" | grep -iE "\[ERROR\]|\[FATAL\]|TypeError|ReferenceError|unhandledRejection" | grep -vE "ERROR_RATE|reason.*ERROR|module load" | head -3)
if [ -n "$ERR" ]; then
  echo "$ERR"
else
  echo "  (no errors)"
fi

echo ""
echo "═════════════════════════════════════════════════════════════════"
echo "Monitor PASS — keine Stop-Gates getriggert  [$TS]"
echo "═════════════════════════════════════════════════════════════════"
exit 0
