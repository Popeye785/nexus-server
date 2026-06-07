#!/bin/bash
# Live-Watch für 2h-45s-Real-Test. Auto-Refresh alle 10s.
CSV=/tmp/obs_2h_45s_after_30s_fail_real.csv
HB=/tmp/obs_2h_45s_after_30s_fail_real_heartbeat.txt
DONE=/tmp/obs_2h_45s_after_30s_fail_real.done
STOPLOG=/tmp/obs_2h_45s_after_30s_fail_real_stop.log
RESERVE_LB=4.2661642227906995

while :; do
  clear
  echo "NEXUS LIVE WATCH · 45s-REAL · $(date '+%d.%m.%Y %H:%M:%S')"
  echo "════════════════════════════════════════════════════════"

  if [ ! -f "$CSV" ]; then
    echo "⏳ Warte auf CSV — Monitor noch nicht gestartet?"
    sleep 10; continue
  fi

  LAST=$(tail -1 "$CSV")
  IFS=',' read -r TS UNIX CPU MEM DBMB QC RES GUARD TESTONLY ISLIVE CYCLE DECT DECINT MALF INC LEAK CANDLE SYSLOG BAL SUBRED AMPEL <<< "$LAST"

  echo "─── HEARTBEAT ───"
  cat "$HB" 2>/dev/null
  echo "Samples: $(($(wc -l < "$CSV")-1))   Letztes: $TS"
  echo

  echo "─── CPU / MEM ───"
  echo "CPU: ${CPU}%    MEM: ${MEM} MB"
  echo

  echo "─── DATABASE ───"
  echo "quick_check: $QC"
  echo "$QC" | grep -q "ok" && echo "DB: ✅ ok" || echo "DB: 🚨 ROT ($QC)"
  echo "DB-Größe: ${DBMB} MB   malformed: $MALF"
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
  echo "Decisions total: $DECT   (letztes Intervall: $DECINT)"
  echo "Incidents: $INC   Leak: $LEAK"
  echo "candle: $CANDLE   syslog: $SYSLOG   balance: $BAL"
  echo

  echo "─── GESAMTAMPEL ───"
  case "$AMPEL" in
    GRUEN) echo "✅ GRÜN — läuft sauber";;
    GELB)  echo "🟡 GELB — $SUBRED";;
    ROT)   echo "🚨 ROT — $SUBRED";;
    *)     echo "? $AMPEL  ($SUBRED)";;
  esac
  echo

  echo "─── STATUS ───"
  if [ -f "$DONE" ]; then
    cat "$DONE"
    [ -f "$STOPLOG" ] && { echo "--- STOP-LOG ---"; cat "$STOPLOG"; }
  else
    echo "läuft · kein Stop-Gate · kein Done"
  fi

  echo
  echo "Refresh alle 10s · CTRL+C beendet NUR die Anzeige, nicht den Test"
  sleep 10
done
