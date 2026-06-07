#!/bin/bash
# 2h-Monitor für 60s-Real-Cycle nach 30s-FAIL.
# KORREKTUREN vs Christian-Original:
#   1. TESTONLY aus /api/test-only/status.active (statt /api/mode.testOnly — existiert nicht)
#   2. ISLIVE aus /api/mode.isLive (camelCase)
#   3. Reserve via python3 json (statt grep)
export LC_NUMERIC=C LC_ALL=C
MAINDB="/Users/christianheilig/NEXUS_CLEAN/nexus.db"
WALLET="/Users/christianheilig/NEXUS_CLEAN/data/demo_wallet.json"
APIPORT=3000
BASE=/tmp/obs_2h_60s_after_30s_fail_real
CSV=${BASE}.csv
HB=${BASE}_heartbeat.txt
STOPLOG=${BASE}_stop.log
DONE=${BASE}.done
SNAPDIR=$(cat /tmp/snap_pre60s_dir.txt 2>/dev/null | grep -o "/.*" | head -1)
RESERVE_LB=4.2661642227906995
DURATION=$((2*3600))
INTERVAL=30
START=$(date +%s)
PREV_DEC=""
ZERO_DEC_STREAK=0
MEM_BASELINE=""
DB_BASELINE_MB=""

BAD='malformed|SQLITE_CORRUPT|SQLITE_NOTADB|database disk image|DATABASE_HEALTHY'
INC='INCIDENTS_MANAGED'
LEAK='PHANTOM|FORBIDDEN_LEAK|forbidden.*leak|phantom.*trade'

[ -f "$CSV" ] || echo "ts,unix,cpu,mem_mb,db_mb,db_qc,reserve,guardian,test_only,is_live,cycle_ms,dec_total,dec_int,malformed,incidents,leak,candle,syslog,balance,subsys_red,ampel" > "$CSV"

trigger_stop() {
  echo "$(date '+%F %T') STOP-GATE: $1" | tee -a "$STOPLOG"
  echo "STOPPED:$1" > "$DONE"
  {
    echo "ROLLBACK-PFAD:"
    echo "  1. pm2 stop nexus"
    echo "  2. cp -p $SNAPDIR/nexus_pre60s_real.db $MAINDB"
    echo "  3. rm -f ${MAINDB}-wal ${MAINDB}-shm"
    echo "  4. sqlite3 $MAINDB \"UPDATE bot_settings SET value='120000' WHERE key='aladdin_cycle_ms';\""
    echo "  5. curl -s -X POST http://localhost:$APIPORT/api/aladdin/cycle -H 'Content-Type: application/json' -d '{\"ms\":120000}'"
    echo "  6. pm2 start nexus"
    echo "  7. quick_check + Reserve verifizieren"
  } >> "$STOPLOG"
  exit 2
}

while :; do
  NOW=$(date +%s); ELAPSED=$((NOW-START))
  [ $ELAPSED -ge $DURATION ] && { echo "DONE:2h_60s_real_clean $(date '+%F %T')" > "$DONE"; exit 0; }

  TS=$(date '+%F %T')
  QC=$(node /Users/christianheilig/NEXUS_CLEAN/nexus_dbq.js "$MAINDB" quick_check 2>/dev/null | head -1)
  DB_MB=$(du -m "$MAINDB" 2>/dev/null | awk '{print $1}')
  RES=$(python3 -c "import json;print(json.load(open('$WALLET')).get('reserve',''))" 2>/dev/null)
  TESTONLY=$(curl -sf --max-time 5 http://localhost:$APIPORT/api/test-only/status 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('active'))" 2>/dev/null)
  ISLIVE=$(curl -sf --max-time 5 http://localhost:$APIPORT/api/mode 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('isLive'))" 2>/dev/null)
  CYCLE=$(curl -sf --max-time 5 http://localhost:$APIPORT/api/aladdin/cycle 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('current_ms'))" 2>/dev/null)
  [ -z "$CYCLE" ] && CYCLE=$(sqlite3 "$MAINDB" "SELECT value FROM bot_settings WHERE key='aladdin_cycle_ms'" 2>/dev/null)
  DEC=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM aladdin_decisions" 2>/dev/null)
  CANDLE=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM candle_cache" 2>/dev/null)
  SYSLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM system_log" 2>/dev/null)
  BAL=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM balance_history" 2>/dev/null)
  DEC_INT="0"
  [ -n "$PREV_DEC" ] && DEC_INT=$((DEC-PREV_DEC))
  PREV_DEC=$DEC
  PROC=$(ps aux | grep "node /Users/christianheilig/NEXUS_CLEAN/server.js" | grep -v grep | head -1)
  CPU=$(echo "$PROC" | awk '{print $3}')
  MEM=$(echo "$PROC" | awk '{print int($6/1024)}')
  GUARD=$(curl -sf --max-time 5 http://localhost:$APIPORT/api/guardian/status 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('lastState',''))" 2>/dev/null)
  RECENT=$(pm2 logs nexus --lines 150 --nostream 2>/dev/null)
  MALF=$(echo "$RECENT" | grep -icE "$BAD")
  INCC=$(echo "$RECENT" | grep -icE "$INC")
  LEAKC=$(echo "$RECENT" | grep -icE "$LEAK")

  [ -z "$MEM_BASELINE" ] && [ -n "$MEM" ] && [ "$MEM" -gt 0 ] && MEM_BASELINE=$MEM
  [ -z "$DB_BASELINE_MB" ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt 0 ] && DB_BASELINE_MB=$DB_MB

  R=0
  RED=""
  RY=""
  echo "$QC" | grep -q "^ok$" || { R=2; RED="DB_qc=$QC"; }
  [ "$MALF" -gt 0 ] && { R=2; RED="malformed x$MALF"; }
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && { R=2; RED="Reserve<LB ($RES)"; }
  [ "$ISLIVE" = "True" ] && { R=2; RED="LIVE=true"; }
  [ "$TESTONLY" = "True" ] || { R=2; RED="TEST_ONLY!=true (got=$TESTONLY)"; }
  [ -z "$PROC" ] && { R=2; RED="Bot offline"; }
  [ "$LEAKC" -gt 0 ] && { R=2; RED="Leak x$LEAKC"; }
  [ "$INCC" -gt 0 ] && { R=2; RED="Incidents x$INCC"; }
  [ "$GUARD" = "RED" ] && { R=2; RED="Guardian RED"; }
  if [ -n "$MEM_BASELINE" ] && [ "$MEM_BASELINE" -gt 0 ] && [ -n "$MEM" ]; then
    if [ "$MEM" -gt $((MEM_BASELINE*5)) ] || [ "$MEM" -gt 2000 ]; then R=2; RED="Mem-Spike ${MEM}MB";
    elif [ "$MEM" -gt $((MEM_BASELINE*3)) ]; then [ $R -lt 1 ] && R=1; RY="Mem hoch ${MEM}MB"; fi
  fi
  [ -n "$DB_BASELINE_MB" ] && [ "$DB_BASELINE_MB" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASELINE_MB*2)) ] && { R=2; RED="DB-Spike ${DB_MB}MB"; }
  [ "$GUARD" = "YELLOW" ] && { [ $R -lt 1 ] && R=1; RY="Guardian YELLOW"; }
  if [ "$DEC_INT" = "0" ]; then ZERO_DEC_STREAK=$((ZERO_DEC_STREAK+1)); else ZERO_DEC_STREAK=0; fi
  [ $ZERO_DEC_STREAK -ge 3 ] && { R=2; RED="decisions=0 x${ZERO_DEC_STREAK}"; }

  case $R in 2) AMPEL="ROT";; 1) AMPEL="GELB";; *) AMPEL="GRUEN";; esac

  echo "$TS,$NOW,$CPU,$MEM,$DB_MB,\"$QC\",$RES,$GUARD,$TESTONLY,$ISLIVE,$CYCLE,$DEC,$DEC_INT,$MALF,$INCC,$LEAKC,$CANDLE,$SYSLOG,$BAL,\"${RED:-${RY:-none}}\",$AMPEL" >> "$CSV"
  echo "$(date '+%F %T') ampel=$AMPEL remaining=$(( (DURATION-ELAPSED)/60 ))min dec_int=$DEC_INT malf=$MALF qc=$QC reserve=$RES test_only=$TESTONLY live=$ISLIVE cycle=$CYCLE mem=${MEM}MB db=${DB_MB}MB" > "$HB"

  # HARTE STOP-GATES
  echo "$QC" | grep -q "^ok$" || trigger_stop "DB_quick_check: $QC"
  [ "$MALF" -gt 0 ] && trigger_stop "malformed x$MALF"
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && trigger_stop "Reserve<LB $RES"
  [ "$ISLIVE" = "True" ] && trigger_stop "LIVE aktiviert"
  [ "$TESTONLY" = "True" ] || trigger_stop "TEST_ONLY!=true (got=$TESTONLY)"
  [ -z "$PROC" ] && trigger_stop "Bot offline"
  [ "$LEAKC" -gt 0 ] && trigger_stop "Leak x$LEAKC"
  [ "$INCC" -gt 0 ] && trigger_stop "INCIDENTS_MANAGED x$INCC"
  [ "$GUARD" = "RED" ] && trigger_stop "Guardian RED"
  [ $ZERO_DEC_STREAK -ge 3 ] && trigger_stop "Decision-Drop x$ZERO_DEC_STREAK"
  if [ -n "$MEM_BASELINE" ] && [ "$MEM_BASELINE" -gt 0 ] && [ -n "$MEM" ]; then
    { [ "$MEM" -gt $((MEM_BASELINE*5)) ] || [ "$MEM" -gt 2000 ]; } && trigger_stop "Mem-Spike ${MEM}MB"
  fi
  [ -n "$DB_BASELINE_MB" ] && [ "$DB_BASELINE_MB" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASELINE_MB*2)) ] && trigger_stop "DB-Spike ${DB_MB}MB"

  sleep $INTERVAL
done
