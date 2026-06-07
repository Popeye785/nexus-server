#!/bin/bash
export LC_NUMERIC=C LC_ALL=C
MAINDB="./nexus.db"; WALLET="data/demo_wallet.json"; APIPORT=3000
BASE=/tmp/obs_30s_4h
CSV=${BASE}.csv; HB=${BASE}_heartbeat.txt; STOPLOG=${BASE}_stop.log; DONE=${BASE}.done
SNAPDIR="/Users/christianheilig/NEXUS_SNAPSHOT_PRE_30s_20260602_134630"
RESERVE_LB=4.2661642227906995
DURATION=$((4*3600)); INTERVAL=30; START=$(date +%s)
PREV_DEC=""; ZERO_DEC_STREAK=0; MEM_BASE=""; DB_BASE=""; LOCK_STREAK=0; QC_ERR_STREAK=0
DRYRUN=0; [ "$1" = "dryrun" ] && DRYRUN=1

BAD='malformed|SQLITE_CORRUPT|SQLITE_NOTADB|database disk image'
LOCK='database is locked|SQLITE_BUSY'
INC='INCIDENTS_MANAGED'
LEAK='PHANTOM|FORBIDDEN_LEAK|forbidden.*leak|phantom.*trade'
OPP='idx_opp_symbol_ts|opportunity_log.*malformed|opportunity_log.*corrupt'
CCFAIL='candle_cache write failed'

[ -f "$CSV" ] || echo "ts,unix,cpu,mem_mb,db_mb,db_qc,qc_rc,reserve,guardian,test_only,is_live,cycle_ms,dec_total,dec_int,malformed,locked,db_safe,cc_fail,opp_hint,incidents,leak,candle,syslog,opp_log,bal,wal_mb,disk_free_gb,subsys_red,ampel" > "$CSV"

auto_restore(){
  echo "$(date '+%F %T') STOP-GATE: $1" | tee -a "$STOPLOG"
  echo "STOPPED:$1" > "$DONE"
  echo "### AUTO-RESTORE laeuft..." | tee -a "$STOPLOG"
  pm2 stop nexus 2>/dev/null
  FORENSIC="$HOME/NEXUS_30s_FORENSIC_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$FORENSIC"
  cp -p "$MAINDB" "$FORENSIC/" 2>/dev/null
  cp -p "${MAINDB}-wal" "$FORENSIC/" 2>/dev/null
  cp -p "${MAINDB}-shm" "$FORENSIC/" 2>/dev/null
  cp -p "$CSV" "$FORENSIC/" 2>/dev/null
  cp -p "$HB" "$FORENSIC/" 2>/dev/null
  cp -p "$STOPLOG" "$FORENSIC/" 2>/dev/null
  pm2 logs nexus --lines 500 --nostream > "$FORENSIC/pm2_nexus.log" 2>/dev/null
  echo "### Forensik gesichert (vor Restore): $FORENSIC" | tee -a "$STOPLOG"
  cp -p "$SNAPDIR/nexus_pre.db" "$MAINDB"
  rm -f "${MAINDB}-wal" "${MAINDB}-shm"
  RQC=$(node /Users/christianheilig/NEXUS_CLEAN/nexus_dbq.js "$MAINDB" quick_check 2>/dev/null); RQC_RC=$?
  if [ "$RQC_RC" = "0" ] && [ "$RQC" = "ok" ]; then
    node /Users/christianheilig/NEXUS_CLEAN/nexus_dbset.js "$MAINDB" aladdin_cycle_ms 120000 2>>"$STOPLOG"
    echo "### Restore-Verify OFFLINE ok (qc=ok), cycle->120000 — starte Bot..." | tee -a "$STOPLOG"
    pm2 start nexus --update-env 2>/dev/null
    sleep 8
    echo "### Bot gestartet nach Restore." | tee -a "$STOPLOG"
  else
    echo "### KRITISCH: Snapshot-qc NICHT ok (rc=$RQC_RC qc=${RQC:-empty}) — Bot NICHT gestartet, manueller Eingriff noetig." | tee -a "$STOPLOG"
  fi
  exit 2
}

halt_no_restore(){
  echo "$(date '+%F %T') HALT (kein Restore): $1" | tee -a "$STOPLOG"
  echo "STOPPED:$1" > "$DONE"
  FORENSIC="$HOME/NEXUS_30s_HALT_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$FORENSIC"
  cp -p "$CSV" "$FORENSIC/" 2>/dev/null
  cp -p "$HB" "$FORENSIC/" 2>/dev/null
  cp -p "$STOPLOG" "$FORENSIC/" 2>/dev/null
  pm2 logs nexus --lines 500 --nostream > "$FORENSIC/pm2_nexus.log" 2>/dev/null
  echo "### HALT ohne Restore (Disk/WAL). DB NICHT angefasst, Bot laeuft weiter. Forensik: $FORENSIC" | tee -a "$STOPLOG"
  echo "### SOFORT pruefen: Disk/WAL. Cycle-Rollback: node /Users/christianheilig/NEXUS_CLEAN/nexus_dbset.js ./nexus.db aladdin_cycle_ms 120000 && pm2 restart nexus --update-env" | tee -a "$STOPLOG"
  exit 3
}

while :; do
  NOW=$(date +%s); ELAPSED=$((NOW-START))
  [ $ELAPSED -ge $DURATION ] && { echo "DONE:4h_30s_clean $(date '+%F %T')" > "$DONE"; exit 0; }
  TS=$(date '+%F %T')
  QC=$(node /Users/christianheilig/NEXUS_CLEAN/nexus_dbq.js "$MAINDB" quick_check 2>/dev/null); QC_RC=$?
  DB_MB=$(du -m "$MAINDB" 2>/dev/null | awk '{print $1}')
  WAL_MB=$(du -m "${MAINDB}-wal" 2>/dev/null | awk '{print $1}'); [ -z "$WAL_MB" ] && WAL_MB=0
  DISK_FREE_GB=$(df -g . 2>/dev/null | awk 'NR==2{print $4}'); [ -z "$DISK_FREE_GB" ] && DISK_FREE_GB=-1
  RES=$(python3 -c "import json;print(json.load(open('$WALLET')).get('reserve',''))" 2>/dev/null)
  TESTONLY=$(curl -s localhost:$APIPORT/api/test-only/status 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('active',d.get('testOnly','')))" 2>/dev/null)
  ISLIVE=$(curl -s localhost:$APIPORT/api/mode 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('isLive',d.get('is_live','')))" 2>/dev/null)
  CYCLE=$(curl -s localhost:$APIPORT/api/aladdin/cycle 2>/dev/null | grep -oE '"current_ms":[0-9]+' | grep -oE '[0-9]+')
  DEC=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM aladdin_decisions;" 2>/dev/null)
  CANDLE=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM candle_cache;" 2>/dev/null)
  SYSLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM system_log;" 2>/dev/null)
  OPPLOG=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM opportunity_log;" 2>/dev/null)
  BAL=$(sqlite3 "$MAINDB" "SELECT COUNT(*) FROM balance_history;" 2>/dev/null)
  DEC_INT="0"; [ -n "$PREV_DEC" ] && DEC_INT=$((DEC-PREV_DEC)); PREV_DEC=$DEC
  PROC=$(ps aux | grep -E "node.*server|nexus" | grep -v grep | head -1)
  CPU=$(echo "$PROC" | awk '{print $3}'); MEM=$(echo "$PROC" | awk '{print int($6/1024)}')
  GUARD=$(pm2 logs nexus --lines 50 --nostream 2>/dev/null | grep -oiE "guardian.*(GREEN|YELLOW|RED)" | grep -oiE "GREEN|YELLOW|RED" | tail -1)
  RECENT=$(pm2 logs nexus --lines 250 --nostream 2>/dev/null)
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
  if [ "$QC_RC" = "0" ] && [ "$QC" = "ok" ]; then QC_ERR_STREAK=0
  elif [ "$QC_RC" = "1" ] && [ -n "$QC" ]; then QC_ERR_STREAK=0; R=2; RED="DB_malformed=$QC"
  else QC_ERR_STREAK=$((QC_ERR_STREAK+1)); [ $R -lt 1 ] && R=1; RED="qc_tool_error rc=$QC_RC qc=${QC:-empty} streak=$QC_ERR_STREAK"; fi
  [ "$MALF" -gt 0 ] && { R=2; RED="malformed x$MALF"; }
  [ "$OPPH" -gt 0 ] && { R=2; RED="opportunity_log-Hinweis x$OPPH"; }
  [ "$CCF" -gt 0 ] && { R=2; RED="candle_cache-write-fail x$CCF"; }
  if [ "$LOCKED" -gt 0 ]; then LOCK_STREAK=$((LOCK_STREAK+1)); else LOCK_STREAK=0; fi
  [ $LOCK_STREAK -ge 3 ] && { R=2; RED="locked-cascade x${LOCK_STREAK}"; }
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && { R=2; RED="Reserve<LB"; }
  { [ "$ISLIVE" = "true" ] || [ "$ISLIVE" = "True" ] || [ "$ISLIVE" = "1" ]; } && { R=2; RED="LIVE=true"; }
  { [ "$TESTONLY" = "true" ] || [ "$TESTONLY" = "True" ] || [ "$TESTONLY" = "1" ]; } || { R=2; RED="TEST_ONLY!=true"; }
  [ -z "$PROC" ] && { R=2; RED="Bot offline"; }
  [ "$LEAKC" -gt 0 ] && { R=2; RED="Leak x$LEAKC"; }
  [ "$INCC" -gt 0 ] && { R=2; RED="Incidents x$INCC"; }
  echo "$GUARD" | grep -qi RED && { R=2; RED="Guardian RED"; }
  [ "$CYCLE" != "30000" ] && [ -n "$CYCLE" ] && { R=2; RED="Cycle!=30000 ($CYCLE)"; }
  { [ "$DISK_FREE_GB" != "-1" ] && [ "$DISK_FREE_GB" -lt 5 ]; } && { R=2; RED="Disk<5G (${DISK_FREE_GB}G)"; }
  [ "$WAL_MB" -gt 512 ] && { R=2; RED="WAL-runaway ${WAL_MB}MB"; }
  if [ -n "$MEM_BASE" ] && [ "$MEM_BASE" -gt 0 ] && [ -n "$MEM" ]; then
    { [ "$MEM" -gt $((MEM_BASE*5)) ] || [ "$MEM" -gt 2000 ]; } && { R=2; RED="Mem-Spike ${MEM}MB"; }
  fi
  [ -n "$DB_BASE" ] && [ "$DB_BASE" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASE*2)) ] && { R=2; RED="DB-Spike"; }
  if [ "$DEC_INT" = "0" ]; then ZERO_DEC_STREAK=$((ZERO_DEC_STREAK+1)); else ZERO_DEC_STREAK=0; fi
  [ $ZERO_DEC_STREAK -ge 8 ] && { R=2; RED="decisions=0 x${ZERO_DEC_STREAK}"; }
  case $R in 2) AMPEL="ROT";; 1) AMPEL="GELB";; *) AMPEL="GRUEN";; esac

  echo "$TS,$NOW,$CPU,$MEM,$DB_MB,\"$QC\",$QC_RC,$RES,$GUARD,$TESTONLY,$ISLIVE,$CYCLE,$DEC,$DEC_INT,$MALF,$LOCKED,$DBSAFE,$CCF,$OPPH,$INCC,$LEAKC,$CANDLE,$SYSLOG,$OPPLOG,$BAL,$WAL_MB,$DISK_FREE_GB,\"${RED:-none}\",$AMPEL" >> "$CSV"
  echo "$(date '+%F %T') ampel=$AMPEL rem=$(( (DURATION-ELAPSED)/60 ))min qc=$QC(rc=$QC_RC) malf=$MALF locked=$LOCKED cc_fail=$CCF opp=$OPPH dec_int=$DEC_INT reserve=$RES cycle=$CYCLE mem=${MEM}MB wal=${WAL_MB}MB disk=${DISK_FREE_GB}G opp_log=$OPPLOG" > "$HB"

  if [ "$DRYRUN" = "1" ]; then echo "=== DRY-RUN SAMPLE ==="; tail -1 "$CSV"; echo "--- heartbeat ---"; cat "$HB"; exit 0; fi

  { [ "$DISK_FREE_GB" != "-1" ] && [ "$DISK_FREE_GB" -lt 5 ]; } && halt_no_restore "Disk<5G (${DISK_FREE_GB}G)"
  [ "$WAL_MB" -gt 512 ] && halt_no_restore "WAL-runaway ${WAL_MB}MB"
  { [ "$QC_RC" = "1" ] && [ -n "$QC" ]; } && auto_restore "DB_quick_check malformed: $QC"
  [ "$MALF" -gt 0 ] && auto_restore "malformed x$MALF"
  [ "$OPPH" -gt 0 ] && auto_restore "opportunity_log-Korruptionshinweis x$OPPH"
  [ "$CCF" -gt 0 ] && auto_restore "candle_cache write failed x$CCF"
  [ $LOCK_STREAK -ge 3 ] && auto_restore "locked-cascade x${LOCK_STREAK}"
  [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}" && auto_restore "Reserve<LB $RES"
  { [ "$ISLIVE" = "true" ] || [ "$ISLIVE" = "True" ] || [ "$ISLIVE" = "1" ]; } && auto_restore "LIVE aktiviert"
  { [ "$TESTONLY" = "true" ] || [ "$TESTONLY" = "True" ] || [ "$TESTONLY" = "1" ]; } || auto_restore "TEST_ONLY!=true"
  [ -z "$PROC" ] && auto_restore "Bot offline"
  [ "$LEAKC" -gt 0 ] && auto_restore "Leak x$LEAKC"
  [ "$INCC" -gt 0 ] && auto_restore "INCIDENTS_MANAGED x$INCC"
  echo "$GUARD" | grep -qi RED && auto_restore "Guardian RED"
  [ $ZERO_DEC_STREAK -ge 8 ] && auto_restore "Decision-Drop x$ZERO_DEC_STREAK"
  if [ -n "$MEM_BASE" ] && [ "$MEM_BASE" -gt 0 ] && [ -n "$MEM" ]; then
    { [ "$MEM" -gt $((MEM_BASE*5)) ] || [ "$MEM" -gt 2000 ]; } && auto_restore "Mem-Spike ${MEM}MB"
  fi
  [ -n "$DB_BASE" ] && [ "$DB_BASE" -gt 0 ] && [ -n "$DB_MB" ] && [ "$DB_MB" -gt $((DB_BASE*2)) ] && auto_restore "DB-Spike ${DB_MB}MB"

  sleep $INTERVAL
done
