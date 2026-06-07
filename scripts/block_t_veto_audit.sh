#!/bin/bash
# scripts/block_t_veto_audit.sh
# Block T A2 [27.05.2026]: Veto-Marker Audit in pm2-Logs.
# Verifiziert: erscheinen ANALYSIS_ONLY / STRATEGY_FORBIDDEN / PAIR_VETO / UNIVERSE_VETO
# in pm2-Logs, und korrespondieren sie mit /api/router/veto-stats?

set -e
LINES=${1:-5000}
TMP=/tmp/pm2_block_t.log

echo "═══════════════════════════════════════════════════════════"
echo "Block T A2 — Veto-Marker Audit ($(date +%Y-%m-%d\ %H:%M:%S))"
echo "═══════════════════════════════════════════════════════════"
pm2 logs nexus --lines "$LINES" --nostream > "$TMP" 2>&1 || true

count() {
  local pat="$1"; local label="$2"
  local n
  n=$(grep -cE "$pat" "$TMP" 2>/dev/null || echo 0)
  printf "%-35s %s\n" "$label" "$n"
}

show_tail() {
  local pat="$1"; local label="$2"
  printf "\n── %s last 3 ──\n" "$label"
  grep -E "$pat" "$TMP" 2>/dev/null | tail -3 || echo "(none)"
}

echo ""
echo "## Veto-Marker Counts (last $LINES log-lines)"
count "ANALYSIS_ONLY"            "ANALYSIS_ONLY"
count "STRATEGY_FORBIDDEN|STRATEGY_VETO|STRATEGY_NOT_ALLOWED" "STRATEGY_VETO"
count "PAIR_VETO|PAIR_REQUIRED"  "PAIR_VETO"
count "UNIVERSE_VETO|NOT_IN_TRADING_UNIVERSE" "UNIVERSE_VETO"
count "FINAL_VETO|FINAL_ROUTER"  "FINAL_ROUTER (gesamt)"
count "CUSUM_TRADE_VETO"         "CUSUM_TRADE_VETO"
count "AUTONOMOUS_TRADES_DISABLED" "AUTONOMOUS_TRADES_DISABLED"

echo ""
echo "## Trade-Attempts (DemoEngine _executeTrade entries)"
count "DEMO_OPEN|_executeTrade.*opened|TRADE_OPEN" "TRADE_OPEN"

show_tail "ANALYSIS_ONLY" "ANALYSIS_ONLY Marker"
show_tail "STRATEGY_FORBIDDEN|STRATEGY_VETO" "STRATEGY_VETO Marker"
show_tail "PAIR_VETO|PAIR_REQUIRED" "PAIR_VETO Marker"

echo ""
echo "## /api/router/veto-stats Cross-Check (last 1h)"
curl -s http://localhost:3000/api/router/veto-stats?hours=1 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'  API total: {d.get(\"total\")}')
print(f'  API blocked: {d.get(\"blocked\")} ({d.get(\"analysis_only\")} ANALYSIS_ONLY)')
print(f'  API allowed: {d.get(\"allowed\")}')
print(f'  by_veto: {d.get(\"by_veto\")}')"

echo ""
echo "## Sanity-Check"
echo "  pm2-Logs ≠ API-Stats: weil API READ-TIME über DB-Decisions läuft,"
echo "  pm2-Logs zeigen NUR die Veto-Marker die in _executeTrade greifen."
echo "  Wenn DemoEngine keinen Trade-Attempt macht (z.B. Cooldown, Already-Open),"
echo "  wird kein Router-Hook getriggert → 0 pm2-Veto-Marker trotz API-Blocks."
echo ""
echo "═══════════════════════════════════════════════════════════"
