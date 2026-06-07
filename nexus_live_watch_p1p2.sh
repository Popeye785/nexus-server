#!/bin/bash
export LC_NUMERIC=C LC_ALL=C
BASE=/tmp/obs_p1p2_120s_long
CSV=${BASE}.csv; HB=${BASE}_heartbeat.txt; DONE=${BASE}.done; STOP=${BASE}_stop.log
while :; do
  clear
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║         NEXUS P1+P2 — 12h LONG-SOAK LIVE (120s Cycle)        ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  date '+ %F %T'
  echo "────────────────────────────────────────────────────────────────"
  # DONE / STOP zuerst
  if [ -f "$DONE" ]; then
    echo " STATUS: $(cat "$DONE")"
    grep -qi STOPPED "$DONE" && echo " ⚠️  STOP-LOG:" && cat "$STOP" 2>/dev/null
  else
    echo " STATUS: läuft…"
  fi
  echo "────────────────────────────────────────────────────────────────"
  echo " HEARTBEAT:"
  cat "$HB" 2>/dev/null | fold -s -w 62 | sed 's/^/  /'
  echo "────────────────────────────────────────────────────────────────"
  # letzte Ampel + Kennzahlen aus CSV
  LAST=$(tail -1 "$CSV" 2>/dev/null)
  if [ -n "$LAST" ]; then
    AMPEL=$(echo "$LAST" | awk -F, '{print $NF}')
    case "$AMPEL" in
      *ROT*)   FARBE="🔴 ROT";;
      *GELB*)  FARBE="🟡 GELB";;
      *GRUEN*) FARBE="🟢 GRUEN";;
      *)       FARBE="$AMPEL";;
    esac
    echo " AMPEL: $FARBE"
    echo "$LAST" | awk -F, '{
      print "  qc="$6"  malformed="$14"  locked="$15
      print "  DB_SAFE="$16"  cc_fail="$17"  opp_hint="$18
      print "  reserve="$7
      print "  test_only="$9"  is_live="$10"  cycle="$11
      print "  dec_total="$12"  dec_int="$13"  guardian="$8
      print "  candle="$21"  syslog="$22"  opp_log="$23
      print "  mem="$4"MB  db="$5"MB  wal="$24"MB  cpu="$3"%"
    }'
  else
    echo " (noch keine CSV-Zeile)"
  fi
  echo "────────────────────────────────────────────────────────────────"
  # Sample-Zähler + grobe Laufzeit
  N=$(($(wc -l < "$CSV" 2>/dev/null)-1)); [ "$N" -lt 0 ] && N=0
  echo " Samples: $N / ~720   (12h Ziel)"
  echo "════════════════════════════════════════════════════════════════"
  echo " Refresh alle 10s · Strg+C zum Beenden (Monitor läuft weiter)"
  [ -f "$DONE" ] && { echo; echo " >>> SOAK BEENDET — siehe STATUS oben <<<"; break; }
  sleep 10
done
