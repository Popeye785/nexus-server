#!/bin/zsh
# scripts/monthly_npm_audit.sh — npm audit monthly (Block E 1.7)
# Cron: 0 9 1 * *  (1. jedes Monats, 9:00 Uhr)
set -e
cd "$(dirname "$0")/.."
YEAR_MONTH=$(date +%Y-%m)
OUT="docs/npm_audit_${YEAR_MONTH}.md"
mkdir -p docs
{
  echo "# npm audit Report ${YEAR_MONTH}"
  echo ""
  echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  echo "## Summary"
  echo '```'
  npm audit --json 2>&1 | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  m = d.get('metadata', {})
  v = m.get('vulnerabilities', {})
  print(f\"  Total Dependencies: {m.get('totalDependencies','n/a')}\")
  print(f\"  Critical: {v.get('critical', 0)}\")
  print(f\"  High:     {v.get('high', 0)}\")
  print(f\"  Moderate: {v.get('moderate', 0)}\")
  print(f\"  Low:      {v.get('low', 0)}\")
  print(f\"  Info:     {v.get('info', 0)}\")
  print(f\"  Total Vulns: {v.get('total', 0)}\")
except Exception as e:
  print(f'parse error: {e}')
"
  echo '```'
  echo ""
  echo "## Full audit output (--omit=dev)"
  echo '```'
  npm audit --omit=dev 2>&1 | head -80
  echo '```'
} > "$OUT"
echo "Audit written: $OUT"
