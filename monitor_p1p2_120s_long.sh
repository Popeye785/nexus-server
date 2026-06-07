#!/bin/bash
export LC_NUMERIC=C LC_ALL=C
MAINDB="./nexus.db"; WALLET="data/demo_wallet.json"; APIPORT="3000"
BASE=/tmp/obs_p1p2_120s_long
CSV=${BASE}.csv; HB=${BASE}_heartbeat.txt; STOPLOG=${BASE}_stop.log; DONE=${BASE}.done
SNAPDIR="/Users/christianheilig/NEXUS_SNAPSHOT_PRE_P1P2_LONGSOAK_20260531_083108"
RESERVE_LB=4.2661642227906995
DURATION=$((12*3600)); INTERVAL=60; START=$(date +%s)
PREV_DEC=""; ZERO_DEC_STREAK=0; MEM_BASE=""; DB_BASE=""

BAD='malformed|SQLITE_CORRUPT|SQLITE_NOTADB|database disk image'
LOCK='database is locked|SQLITE_BUSY'
INC='INCIDENTS_MANAGED'
LEAK='PHANTOM|FORBIDDEN_LEAK|forbidden.*leak|phantom.*trade'
OPP='idx_opp_symbol_ts|opportunity_log.*malformed|opportunity_log.*corrupt'
CCFAIL='candle_cache write failed'

[ -f "$CSV" ] || echo "ts,unix,cpu,mem_mb,db_mb,db_qc,reserve,guardian,test_only,is_live,cycle_ms,dec_total,dec_int,malformed,locked,db_safe_skip,cc_fail,opp_hint,incidents,leak,candle,syslog,opp_log,wal_mb,subsys_red,ampel" > "$CSV"

trigger_stop(){
  echo "$(date '+%F %T') STOP-GATE: $1" | tee -a "$STOPLOG"
  echo "STOPPED:$1" > "$DONE"
  echo "ROLLBACK DB: pm2 stop nexus; cp -p $SNAPDIR/nexus_pre.db $MAINDB; rm -f ${MAINDB}-wal ${MAINDB}-shm; pm2 start nexus" >> "$STOPLOG"
  exit 2
}

while :; do
  NOW=$(date +%s); ELAPSED=$((NOW-START))
  [ $ELAPSED -ge $DURATION ] && { echo "DONE:12h_p1p2_120s_clean $(date '+%F %T')" > "$DONE"; exit 0; }
  TS=$(date '+%F %T')
  QC=$(node /Users/christianheilig/NEXUS_CLEAN/nexus_dbq.js "$MAINDB" quick_check 2>/dev/null | head -1)
  DB_MB=$(du -m "$MAINDB" 2>/dev/null | awk '{print $1}')
  WAL_MB=$(du -m "${MAINDB}-wal" 2>/dev/null | awk '{print $1}'); [ -z "$WAL_MB" ] && WAL_MB=0
  RES=$(python3 -c "import json;print(json.load(open('$WALLET')).get('reserve',''))" 2>/dev/null)
  TESTONLY=$(curl -s localhost:$APIPORT/api/test-only/status 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('active',d.get('testOnly','')))" 2>/dev/null)
  ISLIVE=$(curl -s localhost:$APIPORT/api/mode 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('isLive',d.get('is_live','')))" 2>/dev/null)
  CYCLE=$(curl -s localhost:$APIPORT/api/aladdin/cycle 2>/dev/null | grep -oE '"current_ms":[0-9]+' | grep -oE '[0-9]+')
  [ -z "$CYCLE" ] && CYCLE=$(sqlite3 "$MAINDB" "SELECT value FROM bot_settings WHERE key='aladdin_cycle_ms';" 2>/dev/null)
  DEC=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM aladdin_decisions;" 2>/dev/null)
  CANDLE=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM candle_cache;" 2>/dev/null)
  SYSLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM system_log;" 2>/dev/null)
  OPPLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM opportunity_log;" 2>/dev/null)
  DEC_INT="0"; [ -n "$PREV_DEC" ] && DEC_INT=$((DEC-PREV_DEC)); PREV_DEC=$DEC
  PROC=$(ps aux | grep -E "node.*server|nexus" | grep -v grep | head -1)
  CPU=$(echo "$PROC" | awk '{print $3}'); MEM=$(echo "$PROC" | awk '{print int($6/1024)}')
  GUARD=$(pm2 logs nexus --lines 50 --nostream 2>/dev/null | grep -oiE "guardian.*(GREEN|YELLOW|RED)" | grep -oiE "GREEN|YELLOW|RED" | tail -1)
  RECENT=$(pm2 logs nexus --lines 200 --nostream 2>/dev/null)
  MALF=$(echo "$RECENT" | grep -icE "$BAD")
  LOCKED=$(echo "$RECENT" | grep -icE "$LOCK")
  DBSAFE=$(echo "$RECENT" | grep -icE "DB_SAFE")
  CCF=$(echo "$RECENT" | grep -icE "$CCFAIL")
  OPPH=$(echo "$RECENT" | grep -icE "$OPP")
  INCC=$(echo "$RECENT" | grep -icE "$INC")
  LEAKC=$(echo "$RECENT" | grep -icE "$LEAK")
  [ -z "$MEM_BASE" ] && [ -n "$MEM" ] && MEM_BASE=$MEM
  [ -z "$DB_BASE" ] && [ -n "$DB_MB" ] && DB_BASE=$DB_MB

  R=0; RED=""
  echo "$QC" | grep -q "^ok$" || { R=2; RED="DB_qc=$QC"; }
  [ "$MALF" -gt 0 ] && { R=2; RED="malformed x$MALF"; }
  [ "$OPPH" -gt 0 ] && { R=2; RED="opportunity_log-Hinweis x$OPPH"; }
  [ "$CCF" -gt 0 ] && { R=2; RED="candle_cache-write-fail x$CCF"; }
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && { R=2; RED="Reserve<LB"; }
  { [ "$ISLIVE" = "true" ] || [ "$ISLIVE" = "True" ] || [ "$ISLIVE" = "1" ]; } && { R=2; RED="LIVE=true"; }
  { [ "$TESTONLY" = "true" ] || [ "$TESTONLY" = "True" ] || [ "$TESTONLY" = "1" ]; } || { R=2; RED="TEST_ONLY!=true"; }
  [ -z "$PROC" ] && { R=2; RED="Bot offline"; }
  [ "$LEAKC" -gt 0 ] && { R=2; RED="Leak x$LEAKC"; }
  [ "$INCC" -gt 0 ] && { R=2; RED="Incidents x$INCC"; }
  echo "$GUARD" | grep -qi RED && { R=2; RED="Guardian RED"; }
  if [ -n "$MEM_BASE" ] && [ "$MEM_BASE" -gt 0 ] && [ -n "$MEM" ]; then
    { [ "$MEM" -gt $((MEM_BASE*5)) ] || [ "$MEM" -gt 2000 ]; } && { R=2; RED="Mem-Spike ${MEM}MB"; }
  fi
  [ -n "$DB_BASE" ] && [ "$DB_BASE" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASE*2)) ] && { R=2; RED="DB-Spike"; }
  if [ "$DEC_INT" = "0" ]; then ZERO_DEC_STREAK=$((ZERO_DEC_STREAK+1)); else ZERO_DEC_STREAK=0; fi
  [ $ZERO_DEC_STREAK -ge 5 ] && { R=2; RED="decisions=0 x${ZERO_DEC_STREAK}"; }
  case $R in 2) AMPEL="ROT";; 1) AMPEL="GELB";; *) AMPEL="GRUEN";; esac

  echo "$TS,$NOW,$CPU,$MEM,$DB_MB,\"$QC\",$RES,$GUARD,$TESTONLY,$ISLIVE,$CYCLE,$DEC,$DEC_INT,$MALF,$LOCKED,$DBSAFE,$CCF,$OPPH,$INCC,$LEAKC,$CANDLE,$SYSLOG,$OPPLOG,$WAL_MB,\"${RED:-none}\",$AMPEL" >> "$CSV"
  echo "$(date '+%F %T') ampel=$AMPEL rem=$(( (DURATION-ELAPSED)/3600 ))h$(( ((DURATION-ELAPSED)%3600)/60 ))m qc=$QC malf=$MALF locked=$LOCKED cc_fail=$CCF opp=$OPPH dec_int=$DEC_INT reserve=$RES cycle=$CYCLE mem=${MEM}MB wal=${WAL_MB}MB" > "$HB"

  echo "$QC" | grep -q "^ok$" || trigger_stop "DB_quick_check: $QC"
  [ "$MALF" -gt 0 ] && trigger_stop "malformed x$MALF"
  [ "$OPPH" -gt 0 ] && trigger_stop "opportunity_log-Korruptionshinweis x$OPPH"
  [ "$CCF" -gt 0 ] && trigger_stop "candle_cache write failed x$CCF"
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && trigger_stop "Reserve<LB $RES"
  { [ "$ISLIVE" = "true" ] || [ "$ISLIVE" = "True" ] || [ "$ISLIVE" = "1" ]; } && trigger_stop "LIVE aktiviert"
  { [ "$TESTONLY" = "true" ] || [ "$TESTONLY" = "True" ] || [ "$TESTONLY" = "1" ]; } || trigger_stop "TEST_ONLY!=true"
  [ -z "$PROC" ] && trigger_stop "Bot offline"
  [ "$LEAKC" -gt 0 ] && trigger_stop "Leak x$LEAKC"
  [ "$INCC" -gt 0 ] && trigger_stop "INCIDENTS_MANAGED x$INCC"
  echo "$GUARD" | grep -qi RED && trigger_stop "Guardian RED"
  [ $ZERO_DEC_STREAK -ge 5 ] && trigger_stop "Decision-Drop x$ZERO_DEC_STREAK"
  if [ -n "$MEM_BASE" ] && [ "$MEM_BASE" -gt 0 ] && [ -n "$MEM" ]; then
    { [ "$MEM" -gt $((MEM_BASE*5)) ] || [ "$MEM" -gt 2000 ]; } && trigger_stop "Mem-Spike ${MEM}MB"
  fi
  [ -n "$DB_BASE" ] && [ "$DB_BASE" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASE*2)) ] && trigger_stop "DB-Spike ${DB_MB}MB"

  sleep $INTERVAL
done
