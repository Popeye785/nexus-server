#!/bin/bash
# scripts/t10_p5_ml_pretrain.sh
# T10-P5 [25.05.2026]: ML-Pretraining auf 5J-Daten (Bitget max verfügbar)
# 20 Coins × 2 Strategien × ~44k Kerzen → train RF/GB/PC
# Auto-Rollback bei Accuracy-Regression (>5% Verschlechterung)

set -e
cd "$(dirname "$0")/.."

TS=$(date +%Y%m%d_%H%M%S)
RUN_ID="BATCH_5J_$(date +%Y-%m-%d)"
LOG="/tmp/t10_p5_${TS}.log"
ML_BACKUP="/tmp/t10_p5_ml_backup_${TS}.sql"
ROLLBACK_DONE=0

# Anti-Brick Rollback
rollback() {
  if [ "$ROLLBACK_DONE" -eq 1 ]; then return 0; fi
  ROLLBACK_DONE=1
  echo "" | tee -a "$LOG"
  echo "🔄 ROLLBACK ML-Modelle aus Backup..." | tee -a "$LOG"
  if [ -f "$ML_BACKUP" ]; then
    sqlite3 nexus.db < "$ML_BACKUP"
    echo "  ✅ ml_models + ml_state aus Backup wiederhergestellt" | tee -a "$LOG"
  fi
}
trap rollback EXIT INT TERM

echo "🧠 T10-P5 ML-PRETRAINING 5J GESTARTET" | tee "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "RUN_ID: $RUN_ID" | tee -a "$LOG"
echo "Log:    $LOG" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# ─── 1. PRE-CHECK ───
echo "📋 PRE-CHECK" | tee -a "$LOG"
WALLET=$(cat data/demo_wallet.json | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
DD=$(cat data/demo_wallet.json | python3 -c "import sys,json;w=json.load(sys.stdin);print(round(((w['peakTotal']-w['total'])/w['peakTotal'])*100,2))")
LIVE=$(curl -s http://localhost:3000/api/stats/strategy 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('gatesScore','?'))")
echo "  Wallet:     \$$WALLET" | tee -a "$LOG"
echo "  Drawdown:   ${DD}%" | tee -a "$LOG"
echo "  LIVE-Ready: $LIVE" | tee -a "$LOG"

WI=$(echo "$WALLET" | awk -F. '{print $1}')
DI=$(echo "$DD" | awk -F. '{print $1}')
[ "$WI" -lt 1000 ] && { echo "❌ ABBRUCH Wallet < \$1000"; exit 1; }
[ "$DI" -ge 12 ]   && { echo "❌ ABBRUCH DD ≥ 12%"; exit 1; }
echo "  ✅ Hartlocks OK" | tee -a "$LOG"

# ─── 2. ML-Modelle BACKUP ───
echo "" | tee -a "$LOG"
echo "💾 ML-BACKUP" | tee -a "$LOG"
sqlite3 nexus.db <<SQL > "$ML_BACKUP"
.mode insert ml_models
SELECT * FROM ml_models;
.mode insert ml_state
SELECT * FROM ml_state;
SQL
# Add DELETE prefix for clean restore
sed -i.tmp '1i\
DELETE FROM ml_models;\
DELETE FROM ml_state;
' "$ML_BACKUP"
rm -f "${ML_BACKUP}.tmp"
echo "  Backup: $ML_BACKUP ($(wc -l < "$ML_BACKUP") lines)" | tee -a "$LOG"

# ─── 3. Baseline-Accuracy ───
echo "" | tee -a "$LOG"
echo "📊 BASELINE ML-Accuracy" | tee -a "$LOG"
BL_RF=$(sqlite3 nexus.db "SELECT ROUND(accuracy*100,2) FROM ml_models WHERE model_id='rf_trees'")
BL_GB=$(sqlite3 nexus.db "SELECT ROUND(accuracy*100,2) FROM ml_models WHERE model_id='gb_stumps'")
BL_PC=$(sqlite3 nexus.db "SELECT ROUND(accuracy*100,2) FROM ml_models WHERE model_id='pc_weights'")
BL_SAMP=$(sqlite3 nexus.db "SELECT trained_on FROM ml_models WHERE model_id='rf_trees'")
echo "  RF: ${BL_RF}%  GB: ${BL_GB}%  PC: ${BL_PC}%  Samples: $BL_SAMP" | tee -a "$LOG"

# ─── 4. Jobs definieren ───
COINS=(BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT ADAUSDT AVAXUSDT DOTUSDT DOGEUSDT LINKUSDT \
       ATOMUSDT UNIUSDT LTCUSDT NEARUSDT ARBUSDT OPUSDT SUIUSDT APTUSDT SEIUSDT MATICUSDT)
TOTAL_JOBS=$((${#COINS[@]} * 2))

echo "" | tee -a "$LOG"
echo "🚀 BATCH 5J: $TOTAL_JOBS Jobs (20 Coins × 2 Strategien)" | tee -a "$LOG"
echo "   ema_cross 1h: 43800 Kerzen" | tee -a "$LOG"
echo "   patterns 15min: 175200 Kerzen" | tee -a "$LOG"
START=$(date +%s)

APPLIED=0; FAILED=0; ERRORS=0; SKIPPED=0; JOB_I=0

# ─── 5. Resume-Check: bereits completed ───
COMPLETED_LIST=$(curl -s "http://localhost:3000/api/backtest/state?run_id=$RUN_ID" 2>/dev/null | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  for it in d.get('items', []):
    if it.get('status') == 'completed':
      print(f\"{it['symbol']}|{it['strategy']}|{it['granularity']}\")
except: pass
" 2>/dev/null || echo "")

if [ -n "$COMPLETED_LIST" ]; then
  PREV_COUNT=$(echo "$COMPLETED_LIST" | wc -l | tr -d ' ')
  echo "  📌 Resume: $PREV_COUNT bereits completed → skip" | tee -a "$LOG"
fi

# ─── 6. Job-Loop ───
for COIN in "${COINS[@]}"; do
  for COMBO in "ema_cross|1h|43800" "patterns|15min|175200"; do
    STRAT="${COMBO%%|*}"
    REST="${COMBO#*|}"
    GRAN="${REST%%|*}"
    LIM="${REST##*|}"
    JOB_I=$((JOB_I+1))
    KEY="${COIN}|${STRAT}|${GRAN}"

    # Skip-Check
    if echo "$COMPLETED_LIST" | grep -qF "$KEY"; then
      SKIPPED=$((SKIPPED+1))
      printf "  [%2d/%2d] %s %s %s — ⏭ skip resume\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$STRAT" "$GRAN" | tee -a "$LOG"
      continue
    fi

    # Status: running
    curl -s -X POST http://localhost:3000/api/backtest/state \
      -H "Content-Type: application/json" \
      -d "{\"run_id\":\"$RUN_ID\",\"symbol\":\"$COIN\",\"strategy\":\"$STRAT\",\"granularity\":\"$GRAN\",\"years\":5,\"status\":\"running\",\"candles_requested\":$LIM}" > /dev/null

    # Job execute
    JOB_START=$(date +%s)
    RESULT=$(curl -s -X POST http://localhost:3000/api/training/run \
      -H "Content-Type: application/json" \
      -d "{\"symbol\":\"$COIN\",\"granularity\":\"$GRAN\",\"limit\":$LIM,\"strategy\":\"$STRAT\",\"capital\":1000,\"posSize\":0.1,\"slPct\":0.02,\"tpPct\":0.04}" \
      --max-time 600)
    JOB_DUR=$(($(date +%s) - JOB_START))

    PASSED=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('passedFilters',False))" 2>/dev/null || echo "False")
    TRADES=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('trades',0))" 2>/dev/null || echo "0")
    WR=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('winRate',0)*100,1))" 2>/dev/null || echo "0")
    ERR_MSG=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('error','')[:60])" 2>/dev/null || echo "")

    if [ -n "$ERR_MSG" ]; then
      ERRORS=$((ERRORS+1))
      printf "  [%2d/%2d] %s %s %s — ❌ %s\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$STRAT" "$GRAN" "$ERR_MSG" | tee -a "$LOG"
      FINAL_STATUS="failed"
    elif [ "$PASSED" = "True" ]; then
      APPLIED=$((APPLIED+1))
      printf "  [%2d/%2d] %s %s %s — ✅ %s trades wr=%s%% (%ss)\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$STRAT" "$GRAN" "$TRADES" "$WR" "$JOB_DUR" | tee -a "$LOG"
      FINAL_STATUS="completed"
    else
      FAILED=$((FAILED+1))
      printf "  [%2d/%2d] %s %s %s — ⚠️ %s trades wr=%s%% (Filter-fail, %ss)\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$STRAT" "$GRAN" "$TRADES" "$WR" "$JOB_DUR" | tee -a "$LOG"
      FINAL_STATUS="completed"
    fi

    # Status final
    curl -s -X POST http://localhost:3000/api/backtest/state \
      -H "Content-Type: application/json" \
      -d "{\"run_id\":\"$RUN_ID\",\"symbol\":\"$COIN\",\"strategy\":\"$STRAT\",\"granularity\":\"$GRAN\",\"years\":5,\"status\":\"$FINAL_STATUS\",\"progress\":100,\"candles_requested\":$LIM}" > /dev/null

    # Pause: 800ms bei großen Jobs, 300ms sonst
    if [ "$LIM" -gt 50000 ]; then sleep 1; else sleep 0.3; fi
  done
done

TOTAL_SEC=$(($(date +%s) - START))
echo "" | tee -a "$LOG"
echo "📊 BATCH-ENDE in ${TOTAL_SEC}s ($((TOTAL_SEC/60))min)" | tee -a "$LOG"
echo "  ✅ Applied:  $APPLIED" | tee -a "$LOG"
echo "  ⚠️ Failed:   $FAILED (Filter-Reject)" | tee -a "$LOG"
echo "  ❌ Errors:   $ERRORS" | tee -a "$LOG"
echo "  ⏭ Skipped:  $SKIPPED (Resume)" | tee -a "$LOG"

# ─── 7. ML-TRAINING ───
echo "" | tee -a "$LOG"
echo "🧠 ML-TRAINING aus Backtest-Buffer..." | tee -a "$LOG"
ML_RESULT=$(curl -s -X POST http://localhost:3000/api/training/train-ml --max-time 600)
ML_OK=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('ok',False))" 2>/dev/null || echo "False")

if [ "$ML_OK" != "True" ]; then
  echo "❌ ML-Training fehlgeschlagen" | tee -a "$LOG"
  echo "$ML_RESULT" | head -c 500 | tee -a "$LOG"
  exit 1
fi

NEW_RF=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('randomForest',0)*100,2))")
NEW_GB=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('gradientBoosting',0)*100,2))")
NEW_PC=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('perceptron',0)*100,2))")
NEW_ENS=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('ensemble',0)*100,2))")
NEW_SAMP=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('samples',0))")

echo "" | tee -a "$LOG"
echo "📊 ML-VERGLEICH" | tee -a "$LOG"
echo "  Samples:  $BL_SAMP → $NEW_SAMP  (Faktor $(python3 -c "print(round($NEW_SAMP/max($BL_SAMP,1),1))")x)" | tee -a "$LOG"
echo "  RF:       ${BL_RF}% → ${NEW_RF}%" | tee -a "$LOG"
echo "  GB:       ${BL_GB}% → ${NEW_GB}%" | tee -a "$LOG"
echo "  PC:       ${BL_PC}% → ${NEW_PC}%" | tee -a "$LOG"
echo "  Ensemble: ${NEW_ENS}%" | tee -a "$LOG"

# ─── 8. VALIDATION ───
# Wenn neue RF+GB-Accuracy schlechter als alte → Rollback
RF_REGRESSION=$(python3 -c "print(1 if ($NEW_RF + 5) < $BL_RF else 0)")
GB_REGRESSION=$(python3 -c "print(1 if ($NEW_GB + 5) < $BL_GB else 0)")

if [ "$RF_REGRESSION" -eq 1 ] || [ "$GB_REGRESSION" -eq 1 ]; then
  echo "" | tee -a "$LOG"
  echo "🚨 REGRESSION ERKANNT: neue Accuracy >5% schlechter als alte" | tee -a "$LOG"
  echo "   → Auto-Rollback wird ausgeführt..." | tee -a "$LOG"
  exit 1  # trap rollback
fi

# Wallet-Check (Bot lief weiter — Wallet darf sich kaum bewegt haben)
WALLET2=$(cat data/demo_wallet.json | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
DELTA=$(python3 -c "print(round(abs($WALLET2 - $WALLET), 2))")
if [ "$(echo "$DELTA" | awk -F. '{print $1}')" -ge 5 ]; then
  echo "⚠️ Wallet-Drift $DELTA während Backtest — investigate" | tee -a "$LOG"
fi

echo "" | tee -a "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "✅ T10-P5 ERFOLGREICH (Total: ${TOTAL_SEC}s)" | tee -a "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "Backup: $ML_BACKUP (für manuellen Rollback aufgehoben)" | tee -a "$LOG"

# Trap entfernen — kein Rollback bei Erfolg
trap - EXIT INT TERM
exit 0
