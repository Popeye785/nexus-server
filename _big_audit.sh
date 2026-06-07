#!/bin/bash
set +e
DB=~/NEXUS_CLEAN/nexus.db
SRV=~/NEXUS_CLEAN/server.js

H() { echo ""; echo "═══════════════════════════════════════════════════════════════"; echo "  $1"; echo "═══════════════════════════════════════════════════════════════"; }
S() { echo ""; echo "── $1 ──"; }

H "1. PROZESS / RUNTIME"
S "PM2 Status"
pm2 list | grep -E "nexus|App name"
S "Uptime + Memory + Restarts"
pm2 info nexus 2>/dev/null | grep -E "uptime|restarts|memory|status|created at|node version" | head -8
S "DB-Größe"
ls -lh $DB
S "server.js-Größe + Datum"
ls -lh $SRV

H "2. WALLET / KAPITAL"
curl -s http://localhost:3000/api/demo 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
w = d.get('wallet', {})
s = d.get('stats', {})
print(f'  enabled:        {d.get(\"enabled\")}')
print(f'  running:        {d.get(\"running\")}')
print(f'  wallet.total:   {w.get(\"total\")}')
print(f'  wallet.trading: {w.get(\"trading\")}')
print(f'  wallet.reserve: {w.get(\"reserve\")}')
print(f'  wallet.peak:    {w.get(\"peakTotal\")}')
print(f'  wallet.pnl:     {w.get(\"pnl\")}')
print(f'  wallet.dailyPnl:{w.get(\"dailyPnl\")}')
print(f'  open_positions: {len(d.get(\"positions\",{}))}')
print(f'  stats.scans:    {s.get(\"scans\")}')
print(f'  stats.signals:  {s.get(\"signals\")}')
print(f'  stats.trades:   {s.get(\"trades\")}')
"

H "3. GATES / VETO / KILLSWITCH"
S "NoTrade-Verdict"
curl -s http://localhost:3000/api/notrade 2>/dev/null | python3 -m json.tool
S "KillSwitch-Status"
curl -s http://localhost:3000/api/killswitch/status 2>/dev/null | python3 -m json.tool | head -20

H "4. REGIME / MARKET"
S "Regime-Snapshot"
curl -s http://localhost:3000/api/regime/snapshot 2>/dev/null | python3 -m json.tool | head -25
S "Regime-Verteilung 24h"
sqlite3 $DB "SELECT regime, COUNT(*) as n FROM aladdin_decisions WHERE ts > (strftime('%s','now')-86400)*1000 GROUP BY regime ORDER BY n DESC;" 2>/dev/null

H "5. BRAIN-PERFORMANCE"
S "Confidence-Verteilung letzte Stunde"
sqlite3 $DB "SELECT decision, COUNT(*) as n, ROUND(AVG(confidence),3) as avg_c, ROUND(MAX(confidence),3) as max_c, SUM(CASE WHEN confidence >= 0.20 THEN 1 ELSE 0 END) as over_20pct FROM aladdin_decisions WHERE ts > (strftime('%s','now')-3600)*1000 GROUP BY decision;" 2>/dev/null
S "Brain-Accuracy (aladdin_perf, last 24h)"
sqlite3 $DB "SELECT COUNT(*) as n, ROUND(AVG(brain_correct),3) as acc, ROUND(AVG(family_TREND_correct),3) as tr, ROUND(AVG(family_MOMENTUM_correct),3) as mo, ROUND(AVG(family_RISK_correct),3) as ri, ROUND(AVG(family_SENTIMENT_correct),3) as se, ROUND(AVG(family_MICROSTRUCTURE_correct),3) as mi FROM aladdin_perf WHERE ts_close > (strftime('%s','now')-86400)*1000;" 2>/dev/null

H "6. NEWS-RISK"
curl -s http://localhost:3000/api/news/risk 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  factor:          {d.get(\"factor\")}')
print(f'  polarity:        {d.get(\"sentiment_polarity\")}')
print(f'  dominant_type:   {d.get(\"dominant_type\")}')
print(f'  fresh_critical:  {d.get(\"fresh_critical_count\")}')
print(f'  contributors:    {len(d.get(\"contributors\",[]))} (top 3)')
for c in d.get('contributors',[])[:3]:
    print(f'    {c[\"contribution\"]:.3f} {c[\"type\"]:11s} age={c[\"age_h\"]:5.2f}h {c[\"title\"][:50]}')
"

H "7. TRADES / POSITIONS / BOTS"
S "Trades-Tabelle Gesamtzahl"
sqlite3 $DB "SELECT COUNT(*) total, COUNT(CASE WHEN state='OPEN' THEN 1 END) open, COUNT(CASE WHEN state='CLOSED' THEN 1 END) closed FROM trades;"
S "Legacy-Trades (vor Reset)"
sqlite3 $DB "SELECT COUNT(*) as n, MAX(datetime(created_at/1000,'unixepoch','localtime')) as letzter FROM trades_day_zero_legacy;"
S "Aktive Bots (DCA/GRID/INFGRID/MARTINGALE)"
echo -n "  DCA-Instances:    "; sqlite3 $DB "SELECT COUNT(*) FROM dca_instances WHERE state='ACTIVE';" 2>/dev/null
echo -n "  GRID-Instances:   "; sqlite3 $DB "SELECT COUNT(*) FROM grid_instances WHERE state='ACTIVE';" 2>/dev/null

H "8. BLOCKED-TRADES (warum bot nicht tradet)"
sqlite3 $DB "SELECT block_reason, theoretical_block, COUNT(*) as n FROM blocked_trades WHERE ts > (strftime('%s','now')-86400)*1000 GROUP BY block_reason, theoretical_block ORDER BY n DESC;"

H "9. STRATEGY-FILTER (letzte 1h aus PM2-Log)"
S "METABRAIN-Verteilung"
pm2 logs nexus --lines 500 --nostream 2>/dev/null | grep "METABRAIN" | grep -oE "HOLD|AGREE|DISAGREE|BREAKOUT_UP|BREAKOUT_DOWN|TREND_UP|TREND_DOWN|MEAN_REVERT" | sort | uniq -c
S "Top-Block-Gründe der Strategies"
pm2 logs nexus --lines 500 --nostream 2>/dev/null | grep "METABRAIN" | grep -oE "VOL_LOW\(x[0-9.]+\)|NO_PULLBACK|ADX_LOW\([0-9]+\)|BB_NOT_EXPANDED|RSI_NOT_OS|NO_BREAKOUT|BB_MIDDLE|BANDS_WIDE|ADX_HIGH" | sort | uniq -c | sort -rn

H "10. SUB-SOURCES (UnifiedScore)"
S "Active vs total sources letzte Stunde"
pm2 logs nexus --lines 500 --nostream 2>/dev/null | grep "UNIFIED" | grep -oE "\[[0-9]+/[0-9]+\]" | sort | uniq -c | sort -rn | head -5

H "11. SAFETY-MECHANISMEN aktiv?"
S "Daily-Loss-Limit"
grep -nE "DAILY_LOSS_LIMIT|dailyLossLimit" $SRV | head -5
S "Drift-Monitor"
grep -nE "ENTRY_PRICE_DRIFT|driftThreshold" $SRV | head -5
S "Profit-Lock HWM"
sqlite3 $DB "SELECT value FROM bot_settings WHERE key='profitlock_hwm';"

H "12. CONFIG-OVERRIDE-CHECK (was steht in bot_settings vs CFG)"
sqlite3 $DB "SELECT key, substr(value,1,80) as v FROM bot_settings ORDER BY key;"

H "13. ERROR-LOGS LETZTE STUNDE"
S "ERROR/WARN-Counts"
pm2 logs nexus --lines 1000 --nostream --err 2>/dev/null | tail -200 | grep -oE "\[ERROR\]|\[WARN\]" | sort | uniq -c
S "Letzte 10 Errors"
pm2 logs nexus --lines 1000 --nostream --err 2>/dev/null | tail -10

H "14. DATA-FRESHNESS"
S "Candle-Cache Aktualität (letzte 1h-Kerze pro Symbol)"
sqlite3 $DB "SELECT symbol, MAX(datetime(ts/1000,'unixepoch','localtime')) as letzte FROM candle_cache WHERE granularity='1h' GROUP BY symbol ORDER BY letzte DESC LIMIT 7;" 2>/dev/null
S "News-Cache Aktualität"
sqlite3 $DB "SELECT COUNT(*) as n_24h, MAX(datetime(ts/1000,'unixepoch','localtime')) as letzte FROM news_enriched WHERE ts > (strftime('%s','now')-86400)*1000;" 2>/dev/null

H "15. SCHEMA-VERSIONIERUNG / KOMMENTARE"
S "Code-Phases / Letzte Tags"
grep -oE "AUDFIX[A-Z0-9_]*|MEGA[A-Z0-9_]*|VISION [0-9.]+|PHASE [0-9]+|STUFE [0-9]+|TIER [0-9.]+|WELLE [0-9a-z]+" $SRV | sort | uniq -c | sort -rn | head -20

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  AUDIT ENDE"
echo "═══════════════════════════════════════════════════════════════"
