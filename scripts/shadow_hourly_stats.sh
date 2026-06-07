#!/bin/bash
DATE=$(/bin/date +%Y%m%d)
REPORT=/Users/christianheilig/NEXUS_CLEAN/SHADOW_BEOBACHTUNG_${DATE}.md
DB=/Users/christianheilig/NEXUS_CLEAN/nexus.db
echo "" >> "$REPORT"
echo "## $(/bin/date '+%Y-%m-%d %H:%M')" >> "$REPORT"
echo "### Predictions letzte 1h" >> "$REPORT"
/usr/bin/sqlite3 "$DB" "SELECT '- ' || model_name || ': ' || COUNT(*) || ' preds, evaluated=' || SUM(CASE WHEN actual_outcome IS NOT NULL THEN 1 ELSE 0 END) || ', accuracy=' || COALESCE(ROUND(100.0*SUM(CASE WHEN is_correct=1 THEN 1.0 ELSE 0.0 END)/MAX(1,SUM(CASE WHEN actual_outcome IS NOT NULL THEN 1 ELSE 0 END)), 2), 'N/A') || '%' FROM shadow_predictions WHERE ts > strftime('%s','now','-1 hour')*1000 GROUP BY model_name" >> "$REPORT"
echo "" >> "$REPORT"
echo "### Live-Brain letzte 1h" >> "$REPORT"
/usr/bin/sqlite3 "$DB" "SELECT '- ' || decision || ': ' || COUNT(*) FROM aladdin_decisions WHERE ts > strftime('%s','now','-1 hour')*1000 GROUP BY decision" >> "$REPORT"
echo "" >> "$REPORT"
WALLET=$(/usr/bin/curl -s http://localhost:3000/api/heartbeat 2>/dev/null | /usr/bin/jq -r '.wallet.total // "N/A"')
echo "### Bot: Wallet=$WALLET" >> "$REPORT"
