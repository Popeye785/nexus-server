#!/bin/bash
export LC_NUMERIC=C LC_ALL=C
MAINDB="./nexus.db"; WALLET="data/demo_wallet.json"; APIPORT="3000"
BASE=/tmp/obs_smoke_p3_120s
CSV=${BASE}.csv; HB=${BASE}_heartbeat.txt; STOPLOG=${BASE}_stop.log; DONE=${BASE}.done
SNAPDIR="/Users/christianheilig/NEXUS_SNAPSHOT_PRE_P1P2_LONGSOAK_20260531_083108"
RESERVE_LB=4.2661642227906995
DURATION=$((2*3600)); INTERVAL=60; START=$(date +%s)
PREV_DEC=""; ZERO_DEC_STREAK=0; MEM_BASE=""; DB_BASE=""; QC_ERR_STREAK=0
DRYRUN=0; [ "$1" = "dryrun" ] && DRYRUN=1
BAD='malformed|SQLITE_CORRUPT|SQLITE_NOTADB|database disk image'
LOCK='database is locked|SQLITE_BUSY'; BUSYRE='SQLITE_BUSY'
INC='INCIDENTS_MANAGED'
LEAK='PHANTOM|FORBIDDEN_LEAK|forbidden.*leak|phantom.*trade'
OPP='idx_opp_symbol_ts|opportunity_log.*malformed|opportunity_log.*corrupt'
CCFAIL='candle_cache write failed'
CKPT='checkpoint[_ ]?owner.*(WARN|HIGH|RESTART)|CheckpointOwner.*(WARN|HIGH|RESTART)'
BT=$(pm2 logs nexus --lines 1500 --nostream 2>/dev/null | grep -oiE 'busy_timeout[^0-9]*[0-9]+' | grep -oE '[0-9]+' | tail -1); [ -z "$BT" ] && BT="?"
WAC=$(pm2 logs nexus --lines 1500 --nostream 2>/dev/null | grep -oiE 'wal_autocheckpoint[^0-9-]*[0-9]+' | grep -oE '[0-9]+' | tail -1); [ -z "$WAC" ] && WAC="?"
[ -f "$CSV" ] || echo "ts,unix,cpu,mem_mb,db_mb,wal_mb,disk_free_gb,db_qc,qc_rc,busy_timeout,wal_autockpt,reserve,guardian,test_only,is_live,deploy_mode,cycle_ms,dec_total,dec_int,malformed,locked,sqlite_busy,db_safe_skip,cc_fail,opp_hint,incidents,leak,ckpt_warns,fgit,candle,syslog,opp_log,subsys_red,ampel" > "$CSV"
trigger_stop(){
  echo "$(date '+%F %T') STOP-GATE: $1" | tee -a "$STOPLOG"
  echo "STOPPED:$1" > "$DONE"
  echo "MANUAL-ROLLBACK (Smoke=kein Auto-Restore): pm2 stop nexus; cp -p $SNAPDIR/nexus_pre.db $MAINDB; rm -f ${MAINDB}-wal ${MAINDB}-shm; pm2 start nexus" >> "$STOPLOG"
  exit 2
}
while :; do
  NOW=$(date +%s); ELAPSED=$((NOW-START))
  [ $ELAPSED -ge $DURATION ] && { echo "DONE:2h_smoke_p3_clean $(date '+%F %T')" > "$DONE"; exit 0; }
  TS=$(date '+%F %T')
  QC=$(node /Users/christianheilig/NEXUS_CLEAN/nexus_dbq.js "$MAINDB" quick_check 2>/dev/null); QC_RC=$?
  DB_MB=$(du -m "$MAINDB" 2>/dev/null | awk '{print $1}')
  WAL_MB=$(du -m "${MAINDB}-wal" 2>/dev/null | awk '{print $1}'); [ -z "$WAL_MB" ] && WAL_MB=0
  DISK_FREE_GB=$(df -g . 2>/dev/null | awk 'NR==2{print $4}'); [ -z "$DISK_FREE_GB" ] && DISK_FREE_GB=-1
  RES=$(python3 -c "import json;print(json.load(open('$WALLET')).get('reserve',''))" 2>/dev/null)
  TESTONLY=$(curl -s localhost:$APIPORT/api/test-only/status 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('active',d.get('testOnly','')))" 2>/dev/null)
  ISLIVE=$(curl -s localhost:$APIPORT/api/mode 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('isLive',d.get('is_live','')))" 2>/dev/null)
  DEPLOY=$(curl -s localhost:$APIPORT/api/mode 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('deployMode',d.get('deploy_mode',d.get('mode',''))))" 2>/dev/null)
  CYCLE=$(curl -s localhost:$APIPORT/api/aladdin/cycle 2>/dev/null | grep -oE '"current_ms":[0-9]+' | grep -oE '[0-9]+')
  [ -z "$CYCLE" ] && CYCLE=$(sqlite3 "$MAINDB" "SELECT value FROM bot_settings WHERE key='aladdin_cycle_ms';" 2>/dev/null)
  DEC=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM aladdin_decisions;" 2>/dev/null)
  CANDLE=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM candle_cache;" 2>/dev/null)
  SYSLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM system_log;" 2>/dev/null)
  OPPLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM opportunity_log;" 2>/dev/null)
  DEC_INT="0"; [ -n "$PREV_DEC" ] && DEC_INT=$((DEC-PREV_DEC)); PREV_DEC=$DEC
  PROC=$(ps aux | grep -E "node.*server|nexus" | grep -v grep | head -1)
  CPU=$(echo "$PROC" | awk '{print $3}'); MEM=$(echo "$PROC" | awk '{print int($6/1024)}')
  FGIT=$(pgrep -f 'core.hooksPath=/dev/null' | head -1); [ -z "$FGIT" ] && FGIT=0
  GUARD=$(pm2 logs nexus --lines 50 --nostream 2>/dev/null | grep -oiE "guardian.*(GREEN|YELLOW|RED)" | grep -oiE "GREEN|YELLOW|RED" | tail -1)
  RECENT=$(pm2 logs nexus --lines 200 --nostream 2>/dev/null)
  MALF=$(echo "$RECENT" | grep -icE "$BAD"); LOCKED=$(echo "$RECENT" | grep -icE "$LOCK"); BUSYC=$(echo "$RECENT" | grep -icE "$BUSYRE")
  DBSAFE=$(echo "$RECENT" | grep -icE "DB_SAFE"); CCF=$(echo "$RECENT" | grep -icE "$CCFAIL"); OPPH=$(echo "$RECENT" | grep -icE "$OPP")
  INCC=$(echo "$RECENT" | grep -icE "$INC"); LEAKC=$(echo "$RECENT" | grep -icE "$LEAK"); CKPTW=$(echo "$RECENT" | grep -icE "$CKPT")
  [ -z "$MEM_BASE" ] && [ -n "$MEM" ] && MEM_BASE=$MEM
  [ -z "$DB_BASE" ] && [ -n "$DB_MB" ] && DB_BASE=$DB_MB
  R=0; RED=""; RY=""
  if   [ "$QC_RC" = "0" ] && [ "$QC" = "ok" ]; then QC_ERR_STREAK=0
  elif [ "$QC_RC" = "1" ] && [ -n "$QC" ]; then QC_ERR_STREAK=0; R=2; RED="DB_malformed=$QC"
  else QC_ERR_STREAK=$((QC_ERR_STREAK+1)); [ $R -lt 1 ] && R=1; RY="qc_tool_error rc=$QC_RC qc=${QC:-empty} streak=$QC_ERR_STREAK"; fi
  [ "$MALF" -gt 0 ] && { R=2; RED="malformed x$MALF"; }
  [ "$OPPH" -gt 0 ] && { R=2; RED="opp_log x$OPPH"; }
  [ "$CCF" -gt 0 ] && { R=2; RED="cc_fail x$CCF"; }
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && { R=2; RED="Reserve<LB"; }
  { [ "$ISLIVE" = "true" ] || [ "$ISLIVE" = "True" ] || [ "$ISLIVE" = "1" ]; } && { R=2; RED="LIVE=true"; }
  { [ "$TESTONLY" = "true" ] || [ "$TESTONLY" = "True" ] || [ "$TESTONLY" = "1" ]; } || { R=2; RED="TEST_ONLY!=true"; }
  [ -z "$PROC" ] && { R=2; RED="Bot offline"; }
  [ "$LEAKC" -gt 0 ] && { R=2; RED="Leak x$LEAKC"; }
  [ "$INCC" -gt 0 ] && { R=2; RED="Incidents x$INCC"; }
  echo "$GUARD" | grep -qi RED && { R=2; RED="Guardian RED"; }
  [ -n "$CYCLE" ] && [ "$CYCLE" != "120000" ] && { R=2; RED="Cycle!=120000 ($CYCLE)"; }
  { [ "$DISK_FREE_GB" != "-1" ] && [ "$DISK_FREE_GB" -lt 5 ]; } && { R=2; RED="Disk<5G (${DISK_FREE_GB}G)"; }
  [ "$WAL_MB" -gt 512 ] && { R=2; RED="WAL-runaway ${WAL_MB}MB"; }
  [ "$FGIT" != "0" ] && { [ $R -lt 1 ] && R=1; RY="fremder git PID $FGIT"; }
  [ "$QC_ERR_STREAK" -ge 10 ] && { R=2; RED="qc_tool_error x$QC_ERR_STREAK"; }
  if [ -n "$MEM_BASE" ] && [ "$MEM_BASE" -gt 0 ] && [ -n "$MEM" ]; then { [ "$MEM" -gt $((MEM_BASE*5)) ] || [ "$MEM" -gt 2000 ]; } && { R=2; RED="Mem-Spike ${MEM}MB"; }; fi
  [ -n "$DB_BASE" ] && [ "$DB_BASE" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASE*2)) ] && { R=2; RED="DB-Spike"; }
  if [ "$DEC_INT" = "0" ]; then ZERO_DEC_STREAK=$((ZERO_DEC_STREAK+1)); else ZERO_DEC_STREAK=0; fi
  [ $ZERO_DEC_STREAK -ge 5 ] && { R=2; RED="decisions=0 x${ZERO_DEC_STREAK}"; }
  case $R in 2) AMPEL="ROT";; 1) AMPEL="GELB";; *) AMPEL="GRUEN";; esac
  echo "$TS,$NOW,$CPU,$MEM,$DB_MB,$WAL_MB,$DISK_FREE_GB,\"$QC\",$QC_RC,$BT,$WAC,$RES,$GUARD,$TESTONLY,$ISLIVE,$DEPLOY,$CYCLE,$DEC,$DEC_INT,$MALF,$LOCKED,$BUSYC,$DBSAFE,$CCF,$OPPH,$INCC,$LEAKC,$CKPTW,$FGIT,$CANDLE,$SYSLOG,$OPPLOG,\"${RED:-${RY:-none}}\",$AMPEL" >> "$CSV"
  echo "$(date '+%F %T') ampel=$AMPEL rem=$(((DURATION-ELAPSED)/60))m qc=$QC(rc=$QC_RC) malf=$MALF locked=$LOCKED busy=$BUSYC ckpt=$CKPTW reserve=$RES cycle=$CYCLE wal=${WAL_MB}MB disk=${DISK_FREE_GB}G fgit=$FGIT" > "$HB"
  if [ "$DRYRUN" = "1" ]; then echo "=== DRY-RUN SAMPLE ==="; tail -1 "$CSV"; echo "--- heartbeat ---"; cat "$HB"; exit 0; fi
  { [ "$QC_RC" = "1" ] && [ -n "$QC" ]; } && trigger_stop "DB_quick_check malformed: $QC"
  [ "$QC_ERR_STREAK" -ge 10 ] && trigger_stop "qc_tool_error x$QC_ERR_STREAK"
  [ "$MALF" -gt 0 ] && trigger_stop "malformed x$MALF"
  [ "$OPPH" -gt 0 ] && trigger_stop "opp_log x$OPPH"
  [ "$CCF" -gt 0 ] && trigger_stop "cc_fail x$CCF"
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && trigger_stop "Reserve<LB $RES"
  { [ "$ISLIVE" = "true" ] || [ "$ISLIVE" = "True" ] || [ "$ISLIVE" = "1" ]; } && trigger_stop "LIVE aktiviert"
  { [ "$TESTONLY" = "true" ] || [ "$TESTONLY" = "True" ] || [ "$TESTONLY" = "1" ]; } || trigger_stop "TEST_ONLY!=true"
  [ -z "$PROC" ] && trigger_stop "Bot offline"
  [ "$LEAKC" -gt 0 ] && trigger_stop "Leak x$LEAKC"
  [ "$INCC" -gt 0 ] && trigger_stop "INCIDENTS_MANAGED x$INCC"
  echo "$GUARD" | grep -qi RED && trigger_stop "Guardian RED"
  [ -n "$CYCLE" ] && [ "$CYCLE" != "120000" ] && trigger_stop "Cycle!=120000 ($CYCLE)"
  { [ "$DISK_FREE_GB" != "-1" ] && [ "$DISK_FREE_GB" -lt 5 ]; } && trigger_stop "Disk<5G (${DISK_FREE_GB}G)"
  [ "$WAL_MB" -gt 512 ] && trigger_stop "WAL-runaway ${WAL_MB}MB"
  [ $ZERO_DEC_STREAK -ge 5 ] && trigger_stop "Decision-Drop x$ZERO_DEC_STREAK"
  if [ -n "$MEM_BASE" ] && [ "$MEM_BASE" -gt 0 ] && [ -n "$MEM" ]; then { [ "$MEM" -gt $((MEM_BASE*5)) ] || [ "$MEM" -gt 2000 ]; } && trigger_stop "Mem-Spike ${MEM}MB"; fi
  [ -n "$DB_BASE" ] && [ "$DB_BASE" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASE*2)) ] && trigger_stop "DB-Spike ${DB_MB}MB"
  sleep $INTERVAL
done
