#!/bin/bash
# 24h-Komplett-Audit — Verhaltens-Teil (alle 15 Min)
# Trackt: Brain, MetaBrain, Aladdin, Trades, Vetos, Strategy-Performance
# Schema-korrekt für aktuelle nexus.db (16.05.2026)

set -u
AUDIT_DIR="${AUDIT_DIR_PATH:-}"
if [ -z "$AUDIT_DIR" ]; then echo "AUDIT_DIR_PATH env missing"; exit 1; fi
BEHAV="$AUDIT_DIR/behavioral"
mkdir -p "$BEHAV"

DB="$HOME/NEXUS_CLEAN/nexus.db"
END_TS=$(($(date +%s) + 86400))

LOG="$BEHAV/behavioral.log"
echo "[BEHAV] Start $(date)" >> "$LOG"

while [ $(date +%s) -lt $END_TS ]; do
  TS=$(date +%Y%m%d_%H%M%S)
  CUT_15MIN=$(( ($(date +%s) - 900) * 1000 ))

  # ────────────────────────────────────────
  # 1. NEUE TRADES seit letzten 15 Min
  # (Schema: trades.created_at = open, closed_at = close, realized_pnl = pnl, exit_reason)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT id, symbol, side, size, strategy, state, entry_price,
           entry_regime_class, bot_type, created_at
    FROM trades
    WHERE created_at > $CUT_15MIN
    ORDER BY created_at DESC;
  " > "$BEHAV/${TS}_new_trades.txt"
  NEW_TRADES=$(wc -l < "$BEHAV/${TS}_new_trades.txt" | tr -d ' ')

  # ────────────────────────────────────────
  # 2. GESCHLOSSENE TRADES letzten 15 Min (Outcomes)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT symbol, side, strategy, bot_type,
           entry_price, exit_price, realized_pnl,
           ROUND((closed_at - created_at) / 60000.0, 1) AS duration_min,
           exit_reason
    FROM trades
    WHERE closed_at > $CUT_15MIN AND state IN ('CLOSED','POSITION_CLOSED')
    ORDER BY closed_at DESC;
  " > "$BEHAV/${TS}_closed_trades.txt"
  NEW_CLOSED=$(wc -l < "$BEHAV/${TS}_closed_trades.txt" | tr -d ' ')

  # ────────────────────────────────────────
  # 3. GEBLOCKTE TRADES letzten 15 Min
  # (Schema: blocked_trades.intended_direction = direction, block_reason)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT ts, symbol, intended_direction, block_reason, theoretical_block
    FROM blocked_trades
    WHERE ts > $CUT_15MIN
    ORDER BY ts DESC;
  " > "$BEHAV/${TS}_blocked.txt"
  NEW_BLOCKS=$(wc -l < "$BEHAV/${TS}_blocked.txt" | tr -d ' ')

  # ────────────────────────────────────────
  # 4. VETO-QUELLEN-VERTEILUNG (Top-Reasons)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT block_reason, COUNT(*) AS cnt
    FROM blocked_trades
    WHERE ts > $CUT_15MIN
    GROUP BY block_reason
    ORDER BY cnt DESC;
  " > "$BEHAV/${TS}_veto_distribution.txt"

  # ────────────────────────────────────────
  # 5. METABRAIN-ENTSCHEIDUNGEN pro Symbol
  # ────────────────────────────────────────
  > "$BEHAV/${TS}_metabrain_decisions.txt"
  for sym in BTCUSDT ETHUSDT SOLUSDT SUIUSDT LINKUSDT BNBUSDT NEARUSDT ATOMUSDT OPUSDT; do
    DEC=$(curl -s "http://localhost:3000/api/metabrain/decide/$sym" 2>/dev/null)
    SHORT=$(echo "$DEC" | jq -c '.decision | {metaRegime, strategy, botType, botTypeOverride}' 2>/dev/null || echo "{}")
    echo "$sym $SHORT" >> "$BEHAV/${TS}_metabrain_decisions.txt"
  done

  # ────────────────────────────────────────
  # 6. ALADDIN-DECISIONS letzten 15 Min
  # (Schema: aladdin_decisions hat decision, confidence, consensus, vetos, reason, regime)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT ts, symbol, decision, confidence, regime,
           SUBSTR(vetos, 1, 100), SUBSTR(reason, 1, 100)
    FROM aladdin_decisions
    WHERE ts > $CUT_15MIN
    ORDER BY ts DESC
    LIMIT 100;
  " > "$BEHAV/${TS}_aladdin_decisions.txt"

  # ────────────────────────────────────────
  # 7. STRATEGY-PERFORMANCE aggregiert (lifetime, NICHT backtest)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT
      strategy,
      regime,
      bot_type,
      COUNT(*) AS trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      ROUND(AVG(CASE WHEN pnl > 0 THEN 1.0 ELSE 0.0 END) * 100, 1) AS win_rate_pct,
      ROUND(SUM(pnl), 2) AS total_pnl,
      ROUND(AVG(pnl), 4) AS avg_pnl
    FROM strategy_performance
    WHERE is_backtest = 0
    GROUP BY strategy, regime, bot_type
    ORDER BY trades DESC;
  " > "$BEHAV/${TS}_strategy_perf.txt"

  # ────────────────────────────────────────
  # 8. DCA-STATUS (Schema: status='OPEN', last_block_reason, paused)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT dca_id, symbol, iteration, max_iterations,
           ROUND(avg_buy_price, 4), ROUND(total_spent, 2),
           status, paused,
           last_block_reason, last_block_value,
           CASE WHEN last_block_ts IS NULL THEN NULL
                ELSE ROUND((strftime('%s','now')*1000 - last_block_ts) / 60000.0, 0)
           END AS block_age_min
    FROM dca_instances
    WHERE status IN ('OPEN','DD_STOPPED');
  " > "$BEHAV/${TS}_dca_status.txt"

  # ────────────────────────────────────────
  # 9. GRID-STATUS (Schema: status='OPEN', kein levels_filled-Spalte, aus orders zählen)
  # ────────────────────────────────────────
  sqlite3 -separator '|' "$DB" "
    SELECT g.grid_id, g.symbol, g.bot_type,
           ROUND(g.range_low, 4), ROUND(g.range_high, 4),
           g.num_levels,
           (SELECT COUNT(*) FROM grid_orders go WHERE go.grid_id=g.grid_id AND go.filled=1) AS levels_filled,
           g.fills_acc, g.range_breaks, g.paused, g.status,
           ROUND(g.profit_acc, 4)
    FROM grid_instances g
    WHERE g.status = 'OPEN';
  " > "$BEHAV/${TS}_grid_status.txt"

  # ────────────────────────────────────────
  # 10. MBTTicker Stats
  # ────────────────────────────────────────
  curl -s http://localhost:3000/api/mbtticker/status > "$BEHAV/${TS}_mbtticker.json"

  # ────────────────────────────────────────
  # 11. CapitalPool snapshot
  # ────────────────────────────────────────
  curl -s http://localhost:3000/api/capitalpool/status > "$BEHAV/${TS}_capitalpool.json"

  # ────────────────────────────────────────
  # ZUSAMMENFASSUNG
  # ────────────────────────────────────────
  TOP_VETO=$(head -1 "$BEHAV/${TS}_veto_distribution.txt" 2>/dev/null || echo "—")

  # Verteilung botTypes aus metabrain decisions
  CONS_COUNT=$(grep -c '"strategy":"CONSERVATIVE"' "$BEHAV/${TS}_metabrain_decisions.txt" 2>/dev/null | tr -d '[:space:]')
  SINGLE_BT=$(grep -c '"botType":"SINGLE"' "$BEHAV/${TS}_metabrain_decisions.txt" 2>/dev/null | tr -d '[:space:]')
  GRID_BT=$(grep -c '"botType":"GRID"' "$BEHAV/${TS}_metabrain_decisions.txt" 2>/dev/null | tr -d '[:space:]')
  DCA_BT=$(grep -c '"botType":"DCA"' "$BEHAV/${TS}_metabrain_decisions.txt" 2>/dev/null | tr -d '[:space:]')
  INFGRID_BT=$(grep -c '"botType":"INFGRID"' "$BEHAV/${TS}_metabrain_decisions.txt" 2>/dev/null | tr -d '[:space:]')
  CONS_COUNT=${CONS_COUNT:-0}
  SINGLE_BT=${SINGLE_BT:-0}
  GRID_BT=${GRID_BT:-0}
  DCA_BT=${DCA_BT:-0}
  INFGRID_BT=${INFGRID_BT:-0}

  MBT_TICKS=$(jq -r '.stats.ticks // 0' "$BEHAV/${TS}_mbtticker.json" 2>/dev/null)
  MBT_BUYS=$(jq -r '.stats.dcaBuys // 0' "$BEHAV/${TS}_mbtticker.json" 2>/dev/null)
  MBT_BLOCKED=$(jq -r '.stats.blocked // 0' "$BEHAV/${TS}_mbtticker.json" 2>/dev/null)

  echo "[$TS] Tick: NewTrades=$NEW_TRADES Closed=$NEW_CLOSED Blocks=$NEW_BLOCKS | MetaBrain[CONS=$CONS_COUNT/SINGLE=$SINGLE_BT/GRID=$GRID_BT/DCA=$DCA_BT/INFGRID=$INFGRID_BT] | MBTTicker[ticks=$MBT_TICKS buys=$MBT_BUYS blocked=$MBT_BLOCKED] | TopVeto=$TOP_VETO" >> "$LOG"

  sleep 900  # 15 Min
done

echo "[BEHAV] Ende $(date)" >> "$LOG"
