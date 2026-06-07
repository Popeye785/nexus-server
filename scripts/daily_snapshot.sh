#!/bin/zsh
# scripts/daily_snapshot.sh — täglicher Performance-Window-Snapshot
# Verankert 2026-05-26 (Block B OPTION 3.2)
# Schreibt täglich um 23:55 nach docs/daily_snapshots/YYYY-MM-DD.md
# Cron: 55 23 * * * cd /Users/christianheilig/NEXUS_CLEAN && ./scripts/daily_snapshot.sh
set -e
cd "$(dirname "$0")/.."
DATE=$(date +%Y-%m-%d)
OUT="docs/daily_snapshots/${DATE}.md"
mkdir -p docs/daily_snapshots

curl -s --max-time 30 http://localhost:3000/api/recon/check > /tmp/_snap_recon.json
curl -s --max-time 30 http://localhost:3000/api/bots/dashboard > /tmp/_snap_dash.json
curl -s --max-time 30 http://localhost:3000/api/sortino/snapshot > /tmp/_snap_sortino.json
curl -s --max-time 30 http://localhost:3000/api/kelly/snapshot > /tmp/_snap_kelly.json
curl -s --max-time 30 http://localhost:3000/api/live-ready/audit > /tmp/_snap_audit.json

DATE_PARAM="$DATE" python3 - <<'PYEOF' > "$OUT"
import json
import os
from datetime import datetime
DATE = os.environ.get('DATE_PARAM', 'unknown')
recon = json.load(open('/tmp/_snap_recon.json'))
dash = json.load(open('/tmp/_snap_dash.json'))
sortino = json.load(open('/tmp/_snap_sortino.json'))
kelly = json.load(open('/tmp/_snap_kelly.json'))
audit = json.load(open('/tmp/_snap_audit.json'))
now = datetime.now().isoformat(timespec='seconds')
e = dash.get('engine', {}); s = dash.get('stats', {}); p = dash.get('portfolio', {})
print(f"# Daily Snapshot {DATE}")
print(f"\nGenerated: {now}\n")
print("## Wallet & Drift")
print(f"- istTotal: {recon.get('istTotal')} USDT · effectiveTotal: {recon.get('effectiveTotal')}")
print(f"- reserve: {recon.get('reserve')} · trading: {recon.get('trading')}")
print(f"- drift: {recon.get('drift')} USDT · consistent: {recon.get('consistent')}")
print()
print("## Trade Stats")
print(f"- tradesTotal (SINGLE): {s.get('tradesTotal')} wins={s.get('wins')} losses={s.get('losses')}")
print(f"- winRateWeighted: {s.get('winRateWeighted')}%")
print(f"- winRateSingle: {s.get('winRateSingle')}% · Grid: {s.get('winRateGrid')}% · DCA: {s.get('winRateDca')}%")
print(f"- realizedAllSinceReset: {p.get('realizedAllSinceReset')} USDT")
print(f"- unrealizedPnl: {p.get('unrealizedPnl')}")
print()
print("## Quant Metrics")
print(f"- Sortino: {sortino.get('sortino')} · class: {sortino.get('classification')} · n={sortino.get('n')}")
print(f"- Kelly used: {kelly.get('used')} · reason: {kelly.get('reason')} · n={kelly.get('n')}")
print()
print("## LIVE-Ready Audit")
print(f"- passed: {audit.get('passed')}/{audit.get('total')} ({audit.get('pct')}%) · ready_for_live: {audit.get('ready_for_live')}")
for k, v in audit.get('gates', {}).items():
    icon = '✅' if v is True else ('❌' if v is False else '⏳')
    print(f"  {icon} {k}")
PYEOF

echo "Daily snapshot written: $OUT"
