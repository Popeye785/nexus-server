#!/bin/bash
# scripts/t10_p5_ml_pretrain_v2.sh
# T10-P5 v2 [25.05.2026]: ML-Pretraining auf 5J-Daten — ROBUSTER (kein set -e)
# Änderung vs v1:
#   - 15min-Jobs ENTFERNT (175200 Kerzen hängten den Backtest-Bridge)
#   - NUR 1h × 5J × 20 Coins = 20 Jobs (statt 40)
#   - Kein set -e — explizites Per-Job Error-Handling
#   - Per-Job-Timeout 180s (statt 600s)
#   - Kontinuierliche Statusprüfung (bot reachable?)
# Auto-Rollback bei Accuracy-Regression (>5% Verschlechterung)

cd "$(dirname "$0")/.."

TS=$(date +%Y%m%d_%H%M%S)
RUN_ID="BATCH_5J_$(date +%Y-%m-%d)"   # gleiche Run-ID → Resume
LOG="/tmp/t10_p5_v2_${TS}.log"
ML_BACKUP="/tmp/t10_p5_v2_ml_backup_${TS}.sql"
ROLLBACK_DONE=0
SCRIPT_FAILED=0

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
# Trap nur wenn Rollback explizit angefordert
# (kein automatischer Rollback bei normalem Skript-Ende mehr — verhindert Phantom-Rollbacks)

echo "🧠 T10-P5 v2 ML-PRETRAINING 5J GESTARTET" | tee "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "RUN_ID: $RUN_ID (Resume-fähig)" | tee -a "$LOG"
echo "Log:    $LOG" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# ─── 1. PRE-CHECK ───
echo "📋 PRE-CHECK" | tee -a "$LOG"
WALLET=$(cat data/demo_wallet.json | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "0")
DD=$(cat data/demo_wallet.json | python3 -c "import sys,json;w=json.load(sys.stdin);print(round(((w['peakTotal']-w['total'])/w['peakTotal'])*100,2))" 2>/dev/null || echo "0")
LIVE=$(curl -s -m 10 http://localhost:3000/api/stats/strategy 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('gatesScore','?'))" 2>/dev/null || echo "?")
echo "  Wallet:     \$$WALLET" | tee -a "$LOG"
echo "  Drawdown:   ${DD}%" | tee -a "$LOG"
echo "  LIVE-Ready: $LIVE" | tee -a "$LOG"

WI=$(echo "$WALLET" | awk -F. '{print $1}')
DI=$(echo "$DD" | awk -F. '{print $1}')
if [ "$WI" -lt 1000 ]; then echo "❌ ABBRUCH Wallet < \$1000" | tee -a "$LOG"; exit 1; fi
if [ "$DI" -ge 12 ];   then echo "❌ ABBRUCH DD ≥ 12%" | tee -a "$LOG"; exit 1; fi
if [ "$LIVE" = "?" ] || [ "$LIVE" = "" ]; then echo "❌ ABBRUCH Bot reagiert nicht" | tee -a "$LOG"; exit 1; fi
echo "  ✅ Hartlocks OK" | tee -a "$LOG"

# ─── 2. ML-Modelle BACKUP ───
echo "" | tee -a "$LOG"
echo "💾 ML-BACKUP" | tee -a "$LOG"
{
  echo "DELETE FROM ml_models;"
  echo "DELETE FROM ml_state;"
  sqlite3 nexus.db ".mode insert ml_models" "SELECT * FROM ml_models"
  sqlite3 nexus.db ".mode insert ml_state"  "SELECT * FROM ml_state"
} > "$ML_BACKUP"
echo "  Backup: $ML_BACKUP ($(wc -l < "$ML_BACKUP") lines)" | tee -a "$LOG"

# ─── 3. Baseline-Accuracy ───
echo "" | tee -a "$LOG"
echo "📊 BASELINE ML-Accuracy" | tee -a "$LOG"
BL_RF=$(sqlite3 nexus.db "SELECT ROUND(accuracy*100,2) FROM ml_models WHERE model_id='rf_trees'" 2>/dev/null || echo "0")
BL_GB=$(sqlite3 nexus.db "SELECT ROUND(accuracy*100,2) FROM ml_models WHERE model_id='gb_stumps'" 2>/dev/null || echo "0")
BL_PC=$(sqlite3 nexus.db "SELECT ROUND(accuracy*100,2) FROM ml_models WHERE model_id='pc_weights'" 2>/dev/null || echo "0")
BL_SAMP=$(sqlite3 nexus.db "SELECT trained_on FROM ml_models WHERE model_id='rf_trees'" 2>/dev/null || echo "0")
echo "  RF: ${BL_RF}%  GB: ${BL_GB}%  PC: ${BL_PC}%  Samples: $BL_SAMP" | tee -a "$LOG"

# ─── 4. Jobs definieren (NUR 1h × 5J × 20 Coins = 20 Jobs) ───
COINS=(BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT ADAUSDT AVAXUSDT DOTUSDT DOGEUSDT LINKUSDT \
       ATOMUSDT UNIUSDT LTCUSDT NEARUSDT ARBUSDT OPUSDT SUIUSDT APTUSDT SEIUSDT MATICUSDT)
TOTAL_JOBS=${#COINS[@]}
LIM=43800  # 5J × 1h-Kerzen

echo "" | tee -a "$LOG"
echo "🚀 BATCH 5J-1h: $TOTAL_JOBS Jobs (20 Coins × ema_cross × 1h × 43800 Kerzen)" | tee -a "$LOG"
START=$(date +%s)
APPLIED=0; FAILED=0; ERRORS=0; SKIPPED=0; JOB_I=0

# ─── 5. Resume-Check: bereits completed ───
COMPLETED_LIST=$(curl -s -m 10 "http://localhost:3000/api/backtest/state?run_id=$RUN_ID" 2>/dev/null | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  for it in d.get('items', []):
    if it.get('status') == 'completed':
      print(f\"{it['symbol']}|{it['strategy']}|{it['granularity']}\")
except: pass
" 2>/dev/null || echo "")
if [ -n "$COMPLETED_LIST" ]; then
  PREV_COUNT=$(echo "$COMPLETED_LIST" | grep -c .)
  echo "  📌 Resume: $PREV_COUNT bereits completed → skip" | tee -a "$LOG"
fi

# ─── 6. Job-Loop ───
for COIN in "${COINS[@]}"; do
  JOB_I=$((JOB_I+1))
  KEY="${COIN}|ema_cross|1h"

  if echo "$COMPLETED_LIST" | grep -qF "$KEY"; then
    SKIPPED=$((SKIPPED+1))
    printf "  [%2d/%2d] %-10s — ⏭ skip resume\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" | tee -a "$LOG"
    continue
  fi

  # Health-Check VOR jedem Job
  HEALTH=$(curl -s -m 10 http://localhost:3000/api/stats/strategy 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('gatesScore','?'))" 2>/dev/null || echo "?")
  if [ "$HEALTH" = "?" ] || [ -z "$HEALTH" ]; then
    ERRORS=$((ERRORS+1))
    printf "  [%2d/%2d] %-10s — ❌ Bot reagiert nicht (Pause 30s)\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" | tee -a "$LOG"
    sleep 30
    continue
  fi

  # Status: running
  curl -s -m 10 -X POST http://localhost:3000/api/backtest/state \
    -H "Content-Type: application/json" \
    -d "{\"run_id\":\"$RUN_ID\",\"symbol\":\"$COIN\",\"strategy\":\"ema_cross\",\"granularity\":\"1h\",\"years\":5,\"status\":\"running\",\"candles_requested\":$LIM}" > /dev/null 2>&1

  # Job execute
  JOB_START=$(date +%s)
  RESULT=$(curl -s -X POST http://localhost:3000/api/training/run \
    -H "Content-Type: application/json" \
    -d "{\"symbol\":\"$COIN\",\"granularity\":\"1h\",\"limit\":$LIM,\"strategy\":\"ema_cross\",\"capital\":1000,\"posSize\":0.1,\"slPct\":0.02,\"tpPct\":0.04}" \
    --max-time 180 2>/dev/null)
  JOB_DUR=$(($(date +%s) - JOB_START))

  # Parsing (alle Fail-safe mit defaults)
  PASSED="False"; TRADES="0"; WR="0"; ERR_MSG=""
  if [ -n "$RESULT" ]; then
    PASSED=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('passedFilters',False))" 2>/dev/null || echo "False")
    TRADES=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('trades',0))" 2>/dev/null || echo "0")
    WR=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('winRate',0)*100,1))" 2>/dev/null || echo "0")
    ERR_MSG=$(echo "$RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());e=d.get('error');print(e[:60] if e else '')" 2>/dev/null || echo "")
  else
    ERR_MSG="curl_empty_response"
  fi

  FINAL_STATUS="completed"
  if [ -n "$ERR_MSG" ]; then
    ERRORS=$((ERRORS+1))
    FINAL_STATUS="failed"
    printf "  [%2d/%2d] %-10s — ❌ %s (%ss)\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$ERR_MSG" "$JOB_DUR" | tee -a "$LOG"
  elif [ "$PASSED" = "True" ]; then
    APPLIED=$((APPLIED+1))
    printf "  [%2d/%2d] %-10s — ✅ %s trades wr=%s%% (%ss)\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$TRADES" "$WR" "$JOB_DUR" | tee -a "$LOG"
  else
    FAILED=$((FAILED+1))
    printf "  [%2d/%2d] %-10s — ⚠️ %s trades wr=%s%% (Filter-fail, %ss)\n" "$JOB_I" "$TOTAL_JOBS" "$COIN" "$TRADES" "$WR" "$JOB_DUR" | tee -a "$LOG"
  fi

  # Status final
  curl -s -m 10 -X POST http://localhost:3000/api/backtest/state \
    -H "Content-Type: application/json" \
    -d "{\"run_id\":\"$RUN_ID\",\"symbol\":\"$COIN\",\"strategy\":\"ema_cross\",\"granularity\":\"1h\",\"years\":5,\"status\":\"$FINAL_STATUS\",\"progress\":100,\"candles_requested\":$LIM}" > /dev/null 2>&1

  sleep 1
done

TOTAL_SEC=$(($(date +%s) - START))
echo "" | tee -a "$LOG"
echo "📊 BATCH-ENDE in ${TOTAL_SEC}s ($((TOTAL_SEC/60))min)" | tee -a "$LOG"
echo "  ✅ Applied:  $APPLIED" | tee -a "$LOG"
echo "  ⚠️ Failed:   $FAILED (Filter-Reject — Trades trotzdem im Buffer)" | tee -a "$LOG"
echo "  ❌ Errors:   $ERRORS" | tee -a "$LOG"
echo "  ⏭ Skipped:  $SKIPPED" | tee -a "$LOG"

if [ "$ERRORS" -gt 5 ]; then
  echo "🚨 >5 Errors — Skript abgebrochen, KEIN ML-Training" | tee -a "$LOG"
  exit 1
fi

# ─── 7. ML-TRAINING ───
echo "" | tee -a "$LOG"
echo "🧠 ML-TRAINING aus Backtest-Buffer..." | tee -a "$LOG"
ML_RESULT=$(curl -s -X POST http://localhost:3000/api/training/train-ml --max-time 300 2>/dev/null)
ML_OK=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('ok',False))" 2>/dev/null || echo "False")

if [ "$ML_OK" != "True" ]; then
  echo "❌ ML-Training fehlgeschlagen" | tee -a "$LOG"
  echo "$ML_RESULT" | head -c 500 | tee -a "$LOG"
  rollback
  exit 1
fi

NEW_RF=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('randomForest',0)*100,2))" 2>/dev/null || echo "0")
NEW_GB=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('gradientBoosting',0)*100,2))" 2>/dev/null || echo "0")
NEW_PC=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('perceptron',0)*100,2))" 2>/dev/null || echo "0")
NEW_ENS=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(round(d.get('accuracy',{}).get('ensemble',0)*100,2))" 2>/dev/null || echo "0")
NEW_SAMP=$(echo "$ML_RESULT" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d.get('samples',0))" 2>/dev/null || echo "0")

echo "" | tee -a "$LOG"
echo "📊 ML-VERGLEICH" | tee -a "$LOG"
FACTOR=$(python3 -c "s=$NEW_SAMP;b=max($BL_SAMP,1);print(round(s/b,1))" 2>/dev/null || echo "?")
echo "  Samples:  $BL_SAMP → $NEW_SAMP  (Faktor ${FACTOR}x)" | tee -a "$LOG"
echo "  RF:       ${BL_RF}% → ${NEW_RF}%" | tee -a "$LOG"
echo "  GB:       ${BL_GB}% → ${NEW_GB}%" | tee -a "$LOG"
echo "  PC:       ${BL_PC}% → ${NEW_PC}%" | tee -a "$LOG"
echo "  Ensemble: ${NEW_ENS}%" | tee -a "$LOG"

# ─── 8. VALIDATION ───
RF_REGRESSION=$(python3 -c "print(1 if ($NEW_RF + 5) < $BL_RF else 0)" 2>/dev/null || echo "0")
GB_REGRESSION=$(python3 -c "print(1 if ($NEW_GB + 5) < $BL_GB else 0)" 2>/dev/null || echo "0")

if [ "$RF_REGRESSION" -eq 1 ] || [ "$GB_REGRESSION" -eq 1 ]; then
  echo "" | tee -a "$LOG"
  echo "🚨 REGRESSION ERKANNT: neue Accuracy >5% schlechter als alte" | tee -a "$LOG"
  echo "   → Auto-Rollback..." | tee -a "$LOG"
  rollback
  exit 1
fi

WALLET2=$(cat data/demo_wallet.json | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "$WALLET")
DELTA=$(python3 -c "print(round(abs($WALLET2 - $WALLET), 2))" 2>/dev/null || echo "0")
if [ "$(echo "$DELTA" | awk -F. '{print $1}')" -ge 5 ]; then
  echo "⚠️ Wallet-Drift \$$DELTA während Backtest — investigate" | tee -a "$LOG"
fi

echo "" | tee -a "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "✅ T10-P5 v2 ERFOLGREICH (Total: ${TOTAL_SEC}s)" | tee -a "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "ML-Backup: $ML_BACKUP (für manuellen Rollback)" | tee -a "$LOG"
echo "Bot-Wallet: \$$WALLET2 (Pre: \$$WALLET, Delta: \$$DELTA)" | tee -a "$LOG"
exit 0
