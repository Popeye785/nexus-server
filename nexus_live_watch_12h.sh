#!/bin/bash
# Live-Watch für 12h-Messung nach Recovery. Auto-Refresh alle 10s.
CSV=/tmp/obs_12h_120s_after_recovery.csv
HB=/tmp/obs_12h_120s_after_recovery_heartbeat.txt
DONE=/tmp/obs_12h_120s_after_recovery.done
RESERVE_LB=4.2661642227906995

while :; do
  clear
  echo "NEXUS LIVE WATCH 12h · $(date '+%d.%m.%Y %H:%M:%S')"
  echo "════════════════════════════════════════════════════════"

  if [ ! -f "$CSV" ]; then
    echo "⏳ Warte auf CSV ($CSV) — Monitor noch nicht gestartet?"
    sleep 10; continue
  fi

  # letzte Datenzeile (Header überspringen)
  LAST=$(tail -1 "$CSV")
  # Spalten: 1ts 2unix 3cpu 4mem_mb 5db_qc 6reserve 7guardian 8test_only 9is_live 10cycle_ms 11dec_total 12dec_5m 13malformed 14incidents 15candle 16syslog 17balance 18subsys_red 19ampel
  IFS=',' read -r TS UNIX CPU MEM QC RES GUARD TESTONLY ISLIVE CYCLE DECT DEC5M MALF INC CANDLE SYSLOG BAL SUBRED AMPEL <<< "$LAST"

  echo "─── HEARTBEAT ───"
  cat "$HB" 2>/dev/null
  echo "Samples: $(($(wc -l < "$CSV")-1))   Letztes: $TS"
  echo

  echo "─── CPU / MEM ───"
  echo "CPU: ${CPU}%"
  echo "MEM: ${MEM} MB"
  echo

  echo "─── DATABASE ───"
  echo "quick_check: $QC"
  if echo "$QC" | grep -q "ok"; then echo "DB: ✅ ok"; else echo "DB: 🚨 ROT ($QC)"; fi
  echo "malformed recent: $MALF"
  echo

  echo "─── RESERVE ───"
  echo "Reserve: $RES   (Lower-Bound $RESERVE_LB)"
  if [ -n "$RES" ] && awk "BEGIN{exit !($RES < $RESERVE_LB)}"; then echo "Reserve: 🚨 UNTER BOUND"; else echo "Reserve: ✅ safe"; fi
  echo

  echo "─── SAFETY ───"
  echo "Guardian : $GUARD"
  echo "TEST_ONLY: $TESTONLY"
  echo "LIVE     : $ISLIVE"
  echo "Cycle    : ${CYCLE}ms"
  echo

  echo "─── BRAIN / ROUTER ───"
  echo "Decisions total: $DECT   (letzte 60s: $DEC5M)"
  echo "Incidents recent: $INC"
  echo "candle_cache: $CANDLE   system_log: $SYSLOG   balance: $BAL"
  echo

  echo "─── GESAMTAMPEL ───"
  case "$AMPEL" in
    GRUEN) echo "✅ GRÜN — läuft sauber";;
    GELB)  echo "🟡 GELB — $SUBRED";;
    ROT)   echo "🚨 ROT — $SUBRED";;
    *)     echo "? $AMPEL";;
  esac
  echo

  if [ -f "$DONE" ]; then
    echo "─── STATUS ───"; cat "$DONE"
  else
    echo "─── STATUS ───"; echo "läuft · kein Stop-Gate · kein Done"
  fi

  echo
  echo "Refresh alle 10s · Abbruch mit CTRL+C"
  sleep 10
done
