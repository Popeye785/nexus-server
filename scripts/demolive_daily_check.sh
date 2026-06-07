#!/bin/bash
# DEMO=LIVE Daily Check — 06:00 cron
# Vergleicht 24h Demo+LIVE Trades; bei Drift > 5% → Telegram-Alarm
# Output: ~/NEXUS_CLEAN/.demolive_daily_{YYYYMMDD}.md
DB=$HOME/NEXUS_CLEAN/nexus.db
OUT=$HOME/NEXUS_CLEAN/.demolive_daily_$(date +%Y%m%d).md
SINCE=$(($(date +%s)*1000 - 86400000))

# Aktueller DEPLOY_MODE
DEPLOY=$(grep -E "DEPLOY_MODE:" $HOME/NEXUS_CLEAN/server.js | head -1 | grep -oE "'[A-Z_]+'" | head -1 | tr -d "'")
LIVEMODE=$(curl -s -m 3 http://localhost:3000/api/snapshot 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('mode','?'))" 2>/dev/null)

cat > "$OUT" <<EOH
# DEMO=LIVE Daily Check — $(date '+%Y-%m-%d %H:%M')

## Mode-State
- CFG.DEPLOY_MODE (default): $DEPLOY
- /api/snapshot mode: $LIVEMODE

EOH

# Demo-Trades + LIVE-Trades zählen (strategy-Filter: DEMO_UNIFIED vs andere)
DEMO_STATS=$(sqlite3 -separator '|' "$DB" "SELECT
  count(*),
  sum(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END),
  sum(CASE WHEN realized_pnl<0 THEN 1 ELSE 0 END),
  round(coalesce(avg(realized_pnl),0),3),
  round(coalesce(avg(size),0),2),
  round(coalesce(avg((closed_at - created_at)/60000.0),0),1)
FROM trades
WHERE state IN ('CLOSED','POSITION_CLOSED')
  AND strategy LIKE 'DEMO%'
  AND closed_at > $SINCE;" 2>/dev/null)

LIVE_STATS=$(sqlite3 -separator '|' "$DB" "SELECT
  count(*),
  sum(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END),
  sum(CASE WHEN realized_pnl<0 THEN 1 ELSE 0 END),
  round(coalesce(avg(realized_pnl),0),3),
  round(coalesce(avg(size),0),2),
  round(coalesce(avg((closed_at - created_at)/60000.0),0),1)
FROM trades
WHERE state IN ('CLOSED','POSITION_CLOSED')
  AND strategy NOT LIKE 'DEMO%'
  AND closed_at > $SINCE;" 2>/dev/null)

IFS='|' read -r D_N D_W D_L D_AVG D_SIZE D_HOLD <<< "$DEMO_STATS"
IFS='|' read -r L_N L_W L_L L_AVG L_SIZE L_HOLD <<< "$LIVE_STATS"

cat >> "$OUT" <<EOT
## 24h-Vergleich
| Metric | DEMO | LIVE |
|---|---|---|
| Trades | $D_N | $L_N |
| Wins | $D_W | $L_W |
| Losses | $D_L | $L_L |
| Avg PnL | $D_AVG | $L_AVG |
| Avg Size | $D_SIZE | $L_SIZE |
| Avg Hold (min) | $D_HOLD | $L_HOLD |

EOT

# Wenn LIVE = 0 → skip Drift-Check
if [ "$L_N" = "0" ] || [ -z "$L_N" ]; then
  cat >> "$OUT" <<EOT
## Status: SKIPPED
- Demo=Live-Check skipped: kein LIVE-Trading in 24h.
- LIVE-Trades=$L_N, Demo-Trades=$D_N
- Bei Aktivierung von DRY_LIVE/LIVE_*: Check auto-aktiv.

EOT
else
  # Drift-Berechnung: Win-Rate, Avg-PnL, Avg-Size relativ
  DRIFT=$(python3 <<PY
d_n, d_w, d_avg, d_size = $D_N or 1, $D_W or 0, $D_AVG or 0, $D_SIZE or 0
l_n, l_w, l_avg, l_size = $L_N or 1, $L_W or 0, $L_AVG or 0, $L_SIZE or 0
d_wr = d_w / d_n if d_n > 0 else 0
l_wr = l_w / l_n if l_n > 0 else 0
wr_drift = abs(d_wr - l_wr)
avg_drift = abs(d_avg - l_avg) / max(abs(d_avg), abs(l_avg), 1e-6)
size_drift = abs(d_size - l_size) / max(abs(d_size), abs(l_size), 1e-6)
worst = max(wr_drift, avg_drift, size_drift)
print(f"{wr_drift:.4f}|{avg_drift:.4f}|{size_drift:.4f}|{worst:.4f}")
PY
)
  IFS='|' read -r WR_DRIFT AVG_DRIFT SIZE_DRIFT WORST <<< "$DRIFT"
  cat >> "$OUT" <<EOT
## Drift-Analyse
- WR-Drift: $WR_DRIFT
- Avg-PnL-Drift: $AVG_DRIFT (relative)
- Avg-Size-Drift: $SIZE_DRIFT (relative)
- Worst: $WORST

EOT
  if python3 -c "import sys; sys.exit(0 if float('$WORST') > 0.05 else 1)" 2>/dev/null; then
    cat >> "$OUT" <<EOT
## Verdikt: 🚨 DEMO=LIVE-DRIFT > 5%

Telegram-Alarm wird gesendet. Sofortige Forensik erforderlich.
EOT
    # Telegram
    MSG="🚨 DEMO=LIVE-DRIFT detected: worst $WORST > 5% threshold | WR_drift=$WR_DRIFT AvgPnL_drift=$AVG_DRIFT Size_drift=$SIZE_DRIFT"
    curl -s -X POST -H "Content-Type: application/json" \
      -d "{\"msg\":\"$MSG\"}" \
      http://localhost:3000/api/telegram/send 2>/dev/null
  else
    cat >> "$OUT" <<EOT
## Verdikt: ✅ DEMO=LIVE parität (worst $WORST < 5%)
EOT
  fi
fi

echo "Output: $OUT"
