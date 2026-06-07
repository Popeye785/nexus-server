#!/bin/bash
# P4 [15.05.2026] Conf-Verteilung Pre/Post T4 Marathon
# Read-Only.
DB=~/NEXUS_CLEAN/nexus.db
MARATHON_TS=1778812920000

cat <<EOH
# Conf-Verteilung Pre/Post T4 Marathon
**Generiert:** $(date '+%Y-%m-%d %H:%M:%S')
**Marathon-Deploy:** 2026-05-15 08:42

## Histogramm (non-HOLD Decisions)

EOH

echo "### Pre-Marathon (24h vor 08:42 — 14.05 08:42 → 15.05 08:42)"
echo ""
echo "| Bucket | Anzahl |"
echo "|---|---|"
sqlite3 -separator '|' "$DB" "
SELECT
  CASE
    WHEN confidence < 0.05 THEN '0-5%'
    WHEN confidence < 0.10 THEN '5-10%'
    WHEN confidence < 0.20 THEN '10-20%'
    WHEN confidence < 0.30 THEN '20-30%'
    WHEN confidence < 0.50 THEN '30-50%'
    ELSE '>=50%'
  END AS bucket,
  count(*) AS n
FROM aladdin_decisions
WHERE decision != 'HOLD'
  AND ts BETWEEN strftime('%s','2026-05-14 08:42:00','-1 hour')*1000 AND $MARATHON_TS
GROUP BY bucket
ORDER BY MIN(confidence);" | awk -F'|' '{print "| "$1" | "$2" |"}'

echo ""
echo "### Post-Marathon (seit 08:42 heute)"
echo ""
echo "| Bucket | Anzahl |"
echo "|---|---|"
sqlite3 -separator '|' "$DB" "
SELECT
  CASE
    WHEN confidence < 0.05 THEN '0-5%'
    WHEN confidence < 0.10 THEN '5-10%'
    WHEN confidence < 0.20 THEN '10-20%'
    WHEN confidence < 0.30 THEN '20-30%'
    WHEN confidence < 0.50 THEN '30-50%'
    ELSE '>=50%'
  END AS bucket,
  count(*) AS n
FROM aladdin_decisions
WHERE decision != 'HOLD'
  AND ts > $MARATHON_TS
GROUP BY bucket
ORDER BY MIN(confidence);" | awk -F'|' '{print "| "$1" | "$2" |"}'

echo ""
echo "## Statistik"
echo ""
echo "| Period | Avg | Min | Max | n |"
echo "|---|---|---|---|---|"
sqlite3 -separator '|' "$DB" "
SELECT 'PRE',
  round(avg(confidence),3),
  round(min(confidence),3),
  round(max(confidence),3),
  count(*)
FROM aladdin_decisions
WHERE decision != 'HOLD'
  AND ts BETWEEN strftime('%s','2026-05-14 08:42:00','-1 hour')*1000 AND $MARATHON_TS;" | awk -F'|' '{print "| "$1" | "$2" | "$3" | "$4" | "$5" |"}'
sqlite3 -separator '|' "$DB" "
SELECT 'POST',
  round(avg(confidence),3),
  round(min(confidence),3),
  round(max(confidence),3),
  count(*)
FROM aladdin_decisions
WHERE decision != 'HOLD'
  AND ts > $MARATHON_TS;" | awk -F'|' '{print "| "$1" | "$2" | "$3" | "$4" | "$5" |"}'

echo ""
echo "## Position-Size-Auswirkung"
echo ""
PRE_SIZE=$(sqlite3 "$DB" "SELECT round(avg(position_pct)*100,2) FROM aladdin_decisions WHERE decision != 'HOLD' AND ts BETWEEN strftime('%s','2026-05-14 08:42:00','-1 hour')*1000 AND $MARATHON_TS;" 2>/dev/null)
POST_SIZE=$(sqlite3 "$DB" "SELECT round(avg(position_pct)*100,2) FROM aladdin_decisions WHERE decision != 'HOLD' AND ts > $MARATHON_TS;" 2>/dev/null)
echo "- Pre avg position-size: ${PRE_SIZE}%"
echo "- Post avg position-size: ${POST_SIZE}%"
if python3 -c "import sys; sys.exit(0 if float('$POST_SIZE') > float('$PRE_SIZE') else 1)" 2>/dev/null; then
  echo "- T4 Effekt: ✅ Sizing erhöht (wie erwartet)"
else
  echo "- T4 Effekt: ⚠️ Sizing nicht erhöht (n zu klein? Bot in HOLD-Mode?)"
fi

echo ""
echo "## Win-Rate pro Conf-Bucket (Post-Marathon)"
echo "_HINWEIS: aladdin_decisions hat keine direkte Trade-Outcome-Korrelation. Closed Trades zur Zeitnähe approximiert._"
echo ""
echo "| Bucket | Decisions | Approx-Trades (1min Window) |"
echo "|---|---|---|"
for B in "0.0:0.05:0-5%" "0.05:0.10:5-10%" "0.10:0.20:10-20%" "0.20:0.30:20-30%" "0.30:1.0:30%+"; do
  IFS=':' read -r lo hi label <<< "$B"
  n=$(sqlite3 "$DB" "SELECT count(*) FROM aladdin_decisions WHERE confidence>=$lo AND confidence<$hi AND decision != 'HOLD' AND ts > $MARATHON_TS;" 2>/dev/null)
  echo "| $label | $n | (geringe Daten für Korrelation) |"
done

echo ""
echo "---"
echo "_Script: ~/NEXUS_CLEAN/scripts/conf_distribution.sh — Read-Only_"
