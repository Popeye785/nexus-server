#!/bin/bash
# Prio A [15.05.2026] Mittagsbilanz / Status-Auto-Report
# Read-Only. Output: Markdown + optional Telegram-Summary
DB=~/NEXUS_CLEAN/nexus.db
MARATHON_TS=1778812920000

WALLET_JSON=$(curl -s -m 3 http://localhost:3000/api/demo/wallet)
NB=$(curl -s -m 3 http://localhost:3000/api/notbremse/status)
PID=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin)[0];print(d['pid'])")
R=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin)[0];print(d['pm2_env'].get('restart_time',0))")
MEM=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin)[0];print(d['monit']['memory']//1024//1024)")
UP_MIN=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json,time;d=json.load(sys.stdin)[0];print((int(time.time()*1000)-d['pm2_env'].get('pm_uptime',0))//60000)")

CASH=$(echo "$WALLET_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d['total'],2))")
DAILY=$(echo "$WALLET_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d['dailyPnl'],3))")
TOTAL=$(echo "$WALLET_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(round(d['pnl'],3))")
POS=$(curl -s -m 3 http://localhost:3000/api/demo/positions | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
AUT=$(sqlite3 "$DB" "SELECT value FROM bot_settings WHERE key='autonomous_demo_trades_enabled';")
NB_TRIG=$(echo "$NB" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('stats',{}).get('triggers',0))")

cat <<EOH
# NEXUS Mittagsbilanz / Status-Snapshot
**Zeitpunkt:** $(date '+%Y-%m-%d %H:%M:%S')

## Bot-Status
- PID: $PID | R=$R | mem=${MEM}MB | uptime: ${UP_MIN}min
- AUTONOMOUS_DEMO: $AUT
- Notbremse-Triggers heute: $NB_TRIG (threshold -15 USDT)

## Wallet
- Cash: $CASH USDT
- DailyPnl: $DAILY USDT
- TotalPnl: $TOTAL USDT
- Open Positionen: $POS

## Marathon-Effekt (seit 08:42)
EOH

# Trades since Marathon
TR_M=$(sqlite3 -separator '|' "$DB" "SELECT count(*), sum(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END), sum(CASE WHEN realized_pnl<0 THEN 1 ELSE 0 END), round(coalesce(sum(realized_pnl),0),3) FROM trades WHERE state IN ('CLOSED','POSITION_CLOSED') AND closed_at > $MARATHON_TS;" 2>/dev/null)
echo "- Trades closed (total|W|L|pnl): $TR_M"
WR=$(echo "$TR_M" | awk -F'|' '{if ($1>0) printf "%.0f%%", $2*100/$1; else print "n/a"}')
echo "- Win-Rate: $WR"

# Long/Short Marathon
LS=$(sqlite3 -separator '|' "$DB" "SELECT count(CASE WHEN side='buy' THEN 1 END), count(CASE WHEN side='sell' THEN 1 END) FROM trades WHERE created_at > $MARATHON_TS;" 2>/dev/null)
echo "- Trades opened (buy|sell): $LS"

# Exposure
SUM_SIZE=$(sqlite3 "$DB" "SELECT round(coalesce(sum(size),0),2) FROM trades WHERE state='POSITION_ACTIVE';" 2>/dev/null)
EXP_PCT=$(python3 -c "print(round($SUM_SIZE / $CASH * 100, 1) if $CASH > 0 else 0)" 2>/dev/null)
echo "- Capital-Exposure: $SUM_SIZE / $CASH = ${EXP_PCT}% (Cap 60%)"

# Top Winner / Loser
echo ""
echo "### Top 3 Gewinner (24h)"
sqlite3 -header -column "$DB" "SELECT substr(id,5,12) AS id, symbol, side, round(realized_pnl,3) AS pnl, exit_reason FROM trades WHERE state IN ('CLOSED','POSITION_CLOSED') AND closed_at > strftime('%s','now')*1000-86400000 AND realized_pnl > 0 ORDER BY realized_pnl DESC LIMIT 3;" 2>/dev/null
echo ""
echo "### Top 3 Verlierer (24h)"
sqlite3 -header -column "$DB" "SELECT substr(id,5,12) AS id, symbol, side, round(realized_pnl,3) AS pnl, exit_reason FROM trades WHERE state IN ('CLOSED','POSITION_CLOSED') AND closed_at > strftime('%s','now')*1000-86400000 AND realized_pnl < 0 ORDER BY realized_pnl ASC LIMIT 3;" 2>/dev/null
echo ""
echo "## Open Positionen mit unrealized PnL"
python3 <<'PY'
import json, urllib.request
try:
    with urllib.request.urlopen('http://localhost:3000/api/demo/positions', timeout=3) as r:
        ps = json.load(r)
except Exception as e:
    ps = []
    print(f"(error fetching: {e})")
    raise SystemExit
if not ps:
    print("(keine offenen Positionen)")
else:
    print("| Symbol | Side | Entry | Aktuell | uPnL% |")
    print("|---|---|---|---|---|")
    for p in ps:
        symbol = p.get('symbol','?')
        try:
            with urllib.request.urlopen(f'http://localhost:3000/api/ticker/{symbol}', timeout=2) as r:
                t = json.load(r)
                cur = t.get('last', 0)
        except:
            cur = 0
        entry = p.get('fillPrice', 0)
        direction = p.get('direction','BUY')
        if entry > 0 and cur > 0:
            if direction.upper() == 'BUY':
                upnl = (cur - entry) / entry * 100
            else:
                upnl = (entry - cur) / entry * 100
            print(f"| {symbol} | {direction} | {entry:.4f} | {cur:.4f} | {upnl:+.2f}% |")
        else:
            print(f"| {symbol} | {direction} | {entry:.4f} | — | — |")
PY

echo ""
echo "---"
echo "_Script: ~/NEXUS_CLEAN/scripts/midday_balance.sh — Read-Only_"
