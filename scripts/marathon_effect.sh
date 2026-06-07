#!/bin/bash
# P2 [15.05.2026] Marathon-Effekt-Analyse-Script
# Misst Effekt der T1-T4 Architektur-Fixes (deployed 2026-05-15 08:42).
# Read-Only — keine DB-Writes.

DB=~/NEXUS_CLEAN/nexus.db
MARATHON_TS=1778812920000  # 2026-05-15 08:42:00 UTC+2 = epoch ms
NOW=$(date +%s)000
NOW_INT=$(date +%s)
SINCE_MARATHON_S=$((NOW_INT - 1778812920))
SINCE_MARATHON_MIN=$((SINCE_MARATHON_S / 60))

cat <<EOH
# Marathon-Effekt-Report
**Generiert:** $(date '+%Y-%m-%d %H:%M:%S')
**Marathon-Deploy:** 2026-05-15 08:42 (vor ${SINCE_MARATHON_MIN}min)

---

## T1 — Auto-Notbremse (-15 USDT)
EOH

# T1 Notbremse-Trigger
NB_STATUS=$(curl -s -m 3 http://localhost:3000/api/notbremse/status 2>/dev/null)
NB_TRIGGERS=$(echo "$NB_STATUS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('stats',{}).get('triggers',0))" 2>/dev/null)
NB_THRESH=$(echo "$NB_STATUS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('threshold','?'))" 2>/dev/null)
NB_TODAY=$(echo "$NB_STATUS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('triggeredToday',False))" 2>/dev/null)
DAILY=$(curl -s -m 3 http://localhost:3000/api/demo/wallet | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d['dailyPnl'],3))" 2>/dev/null)
cat <<EOT
- Threshold: $NB_THRESH USDT
- Triggers heute: $NB_TRIGGERS
- TriggeredToday-Flag: $NB_TODAY
- Aktueller dailyPnl: $DAILY USDT
- Status: $([ "$NB_TRIGGERS" = "0" ] && echo "✅ Bot tradet weiter" || echo "🚨 NOTBREMSE GETRIGGERT")
EOT

cat <<'EOH'

---

## T2 — Capital-Exposure-Cap (60% Total / 45% Alt)
EOH

# T2 Exposure-Blocks (in consistency_log oder via Trade-Skip-Logs)
# Da Skips nur loggen, nicht in DB: zähle exposure-related logs aus pm2 logs
EXP_BLOCKS=$(pm2 logs nexus --lines 2000 --nostream 2>/dev/null | grep -ic "EXPOSURE_CAP\|EXPOSURE.*skipped" || echo 0)
POS_COUNT=$(curl -s -m 3 http://localhost:3000/api/demo/positions | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
WALLET=$(curl -s -m 3 http://localhost:3000/api/demo/wallet | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d['total'],2))" 2>/dev/null)
SUM_SIZE=$(sqlite3 "$DB" "SELECT round(coalesce(sum(size),0),2) FROM trades WHERE state='POSITION_ACTIVE';" 2>/dev/null)
EXP_PCT=$(python3 -c "print(round($SUM_SIZE / $WALLET * 100, 1) if $WALLET > 0 else 0)" 2>/dev/null)
cat <<EOT
- Aktuelle Positionen: $POS_COUNT
- Total exposed: $SUM_SIZE USDT (von $WALLET total = ${EXP_PCT}%)
- Cap-Blocks im pm2-log (last 2000 lines): $EXP_BLOCKS
- Cap-Limits: 60% Total / 45% Alt
- Status: $([ "$EXP_PCT" \< "60" ] && echo "✅ unter Cap" || echo "⚠️ Cap-Bereich")
EOT

cat <<'EOH'

---

## T3 — SELL-Symmetrie (Long/Short Ratio)
EOH

# Pre-Marathon (24h vor 08:42)
PRE_TRADES=$(sqlite3 -separator '|' "$DB" "SELECT
  sum(CASE WHEN side='buy' THEN 1 ELSE 0 END) AS buy,
  sum(CASE WHEN side='sell' THEN 1 ELSE 0 END) AS sell,
  count(*) AS total
FROM trades
WHERE created_at BETWEEN strftime('%s','2026-05-14 08:42:00','-1 hour')*1000 AND 1778812920000;" 2>/dev/null)

POST_TRADES=$(sqlite3 -separator '|' "$DB" "SELECT
  sum(CASE WHEN side='buy' THEN 1 ELSE 0 END) AS buy,
  sum(CASE WHEN side='sell' THEN 1 ELSE 0 END) AS sell,
  count(*) AS total
FROM trades
WHERE created_at > 1778812920000;" 2>/dev/null)

echo "**Pre-Marathon (08:42 vorgestern → gestern 08:42, 24h):**"
echo "- $PRE_TRADES (buy|sell|total)"
echo ""
echo "**Post-Marathon (seit 08:42 heute):**"
echo "- $POST_TRADES (buy|sell|total)"

cat <<'EOH'

---

## T4 — Conf-Damping (Re-Mapping conf/0.30)
EOH

# Pre-Marathon Conf-Verteilung
PRE_CONF=$(sqlite3 -separator '|' "$DB" "SELECT
  round(avg(confidence),3) AS avg_c,
  round(min(confidence),3) AS min_c,
  round(max(confidence),3) AS max_c,
  count(*) AS n
FROM aladdin_decisions
WHERE decision != 'HOLD'
  AND ts BETWEEN strftime('%s','2026-05-14 08:42:00','-1 hour')*1000 AND 1778812920000;" 2>/dev/null)

POST_CONF=$(sqlite3 -separator '|' "$DB" "SELECT
  round(avg(confidence),3) AS avg_c,
  round(min(confidence),3) AS min_c,
  round(max(confidence),3) AS max_c,
  count(*) AS n
FROM aladdin_decisions
WHERE decision != 'HOLD'
  AND ts > 1778812920000;" 2>/dev/null)

# Position-Pct
PRE_SIZE=$(sqlite3 "$DB" "SELECT round(avg(position_pct)*100,2) FROM aladdin_decisions WHERE decision != 'HOLD' AND ts BETWEEN strftime('%s','2026-05-14 08:42:00','-1 hour')*1000 AND 1778812920000;" 2>/dev/null)
POST_SIZE=$(sqlite3 "$DB" "SELECT round(avg(position_pct)*100,2) FROM aladdin_decisions WHERE decision != 'HOLD' AND ts > 1778812920000;" 2>/dev/null)

echo "**Pre-Marathon Conf (24h):**"
echo "- avg|min|max|n: $PRE_CONF"
echo "- avg position size: ${PRE_SIZE}%"
echo ""
echo "**Post-Marathon Conf:**"
echo "- avg|min|max|n: $POST_CONF"
echo "- avg position size: ${POST_SIZE}%"

cat <<'EOH'

---

## Gesamt-Bilanz seit Marathon
EOH

REALIZED_POST=$(sqlite3 "$DB" "SELECT round(coalesce(sum(realized_pnl),0),3) FROM trades WHERE state IN ('CLOSED','POSITION_CLOSED') AND closed_at > 1778812920000;" 2>/dev/null)
TRADES_POST=$(sqlite3 -separator '|' "$DB" "SELECT
  count(*) AS total,
  sum(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) AS W,
  sum(CASE WHEN realized_pnl<0 THEN 1 ELSE 0 END) AS L
FROM trades WHERE state IN ('CLOSED','POSITION_CLOSED') AND closed_at > 1778812920000;" 2>/dev/null)

echo "- Realized PnL since Marathon: $REALIZED_POST USDT"
echo "- Trades closed (total|W|L): $TRADES_POST"
echo "- dailyPnl: $DAILY USDT"

# Bewertung
DAILY_FLOAT=$(python3 -c "print(float('$DAILY'))" 2>/dev/null)
if python3 -c "import sys; sys.exit(0 if float('$DAILY') > 0 else 1)" 2>/dev/null; then
  echo "- Verdikt: ✅ Marathon-Effekt positiv (dailyPnl > 0)"
elif python3 -c "import sys; sys.exit(0 if float('$DAILY') > -5 else 1)" 2>/dev/null; then
  echo "- Verdikt: ⚠️ Marathon-Effekt unklar (dailyPnl >= -5)"
elif python3 -c "import sys; sys.exit(0 if float('$DAILY') > -10 else 1)" 2>/dev/null; then
  echo "- Verdikt: ⚠️ Marathon-Effekt negativ (dailyPnl < -5)"
else
  echo "- Verdikt: 🚨 Marathon-Effekt negativ stark (dailyPnl < -10) — Rollback überlegen"
fi

echo ""
echo "---"
echo "_Script: ~/NEXUS_CLEAN/scripts/marathon_effect.sh — Read-Only_"
