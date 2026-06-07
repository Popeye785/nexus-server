#!/bin/bash
# Prio F [15.05.2026] Tagesbilanz (22:00 cron-Variante)
# Read-Only. Output: Markdown + Telegram via curl
HOMEDIR=/Users/christianheilig
DB=$HOMEDIR/NEXUS_CLEAN/nexus.db

WALLET=$(curl -s -m 3 http://localhost:3000/api/demo/wallet 2>/dev/null)
DAILY=$(echo "$WALLET" | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d.get('dailyPnl',0),3))" 2>/dev/null)
TOTAL=$(echo "$WALLET" | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d.get('pnl',0),3))" 2>/dev/null)
CASH=$(echo "$WALLET" | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d.get('total',0),2))" 2>/dev/null)
POS=$(curl -s -m 3 http://localhost:3000/api/demo/positions 2>/dev/null | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)

# Trade-Stats (24h)
TRADES_24H=$(sqlite3 -separator '|' "$DB" "SELECT count(*), sum(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END), sum(CASE WHEN realized_pnl<0 THEN 1 ELSE 0 END), round(coalesce(sum(realized_pnl),0),3) FROM trades WHERE state IN ('CLOSED','POSITION_CLOSED') AND closed_at > strftime('%s','now')*1000-86400000;" 2>/dev/null)

EMOJI="📊"
DAILY_FLOAT=$(python3 -c "print(float('$DAILY'))" 2>/dev/null)
if python3 -c "import sys; sys.exit(0 if float('$DAILY') > 0 else 1)" 2>/dev/null; then
  EMOJI="📈✅"
elif python3 -c "import sys; sys.exit(0 if float('$DAILY') < -10 else 1)" 2>/dev/null; then
  EMOJI="📉🚨"
elif python3 -c "import sys; sys.exit(0 if float('$DAILY') < -5 else 1)" 2>/dev/null; then
  EMOJI="📉⚠️"
fi

MSG="$EMOJI NEXUS Tagesbilanz $(date '+%Y-%m-%d %H:%M')
Daily PnL: $DAILY USDT
Total PnL: $TOTAL USDT
Cash: $CASH USDT
Open: $POS
Trades 24h: $TRADES_24H (total|W|L|pnl)"

echo "$MSG"

# Send via Telegram-Bot-Endpoint
curl -s -X POST -H "Content-Type: application/json" -d "{\"msg\":\"$(echo $MSG | sed 's/"/\\"/g')\"}" http://localhost:3000/api/telegram/send 2>/dev/null
