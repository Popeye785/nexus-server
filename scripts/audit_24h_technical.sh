#!/bin/bash
# 24h-Komplett-Audit — Technischer Teil (alle 30 Min)
# Erstellt: 16.05.2026 — läuft genau 24h, dann Auto-Ende

set -u
AUDIT_DIR="${AUDIT_DIR_PATH:-}"
if [ -z "$AUDIT_DIR" ]; then
  echo "AUDIT_DIR_PATH env missing"; exit 1
fi
mkdir -p "$AUDIT_DIR/snapshots"

# Telegram env aus .env laden
if [ -f "$HOME/NEXUS_CLEAN/.env" ]; then
  export $(grep -E '^TELEGRAM_(TOKEN|CHAT_ID)' "$HOME/NEXUS_CLEAN/.env" | xargs)
fi

END_TS=$(($(date +%s) + 86400))

BASELINE_WALLET=$(curl -s http://localhost:3000/api/wallet/snapshot | jq -r '.total // 0')
BASELINE_R=$(pm2 jlist | jq -r '.[] | select(.name=="nexus") | .pm2_env.restart_time')

LOG="$AUDIT_DIR/audit_tech.log"
echo "[TECH] Start $(date)" >> "$LOG"
echo "Baseline: Wallet=$BASELINE_WALLET R=$BASELINE_R END_TS=$END_TS" >> "$LOG"

tg() {
  local msg="$1"
  if [ -n "${TELEGRAM_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${msg}" > /dev/null
  fi
}

while [ $(date +%s) -lt $END_TS ]; do
  TS=$(date +%Y%m%d_%H%M%S)

  curl -s http://localhost:3000/api/wallet/snapshot > "$AUDIT_DIR/snapshots/${TS}_wallet.json"
  curl -s http://localhost:3000/api/positions/active > "$AUDIT_DIR/snapshots/${TS}_positions.json"
  curl -s http://localhost:3000/api/recon/check > "$AUDIT_DIR/snapshots/${TS}_recon.json"

  WALLET=$(jq -r '.total // 0' "$AUDIT_DIR/snapshots/${TS}_wallet.json" 2>/dev/null)
  DRIFT=$(jq -r '.drift // -999' "$AUDIT_DIR/snapshots/${TS}_recon.json" 2>/dev/null)
  CONSISTENT=$(jq -r '.consistent // "false"' "$AUDIT_DIR/snapshots/${TS}_recon.json" 2>/dev/null)
  POS_COUNT=$(jq -r '.total // 0' "$AUDIT_DIR/snapshots/${TS}_positions.json" 2>/dev/null)

  R_NOW=$(pm2 jlist | jq -r '.[] | select(.name=="nexus") | .pm2_env.restart_time' 2>/dev/null)
  BOT_STATUS=$(pm2 jlist | jq -r '.[] | select(.name=="nexus") | .pm2_env.status' 2>/dev/null)
  DEPLOY_MODE=$(grep '^DEPLOY_MODE' "$HOME/NEXUS_CLEAN/.env" | cut -d= -f2)

  # KATASTROPHE: DEPLOY != PAPER
  if [ "$DEPLOY_MODE" != "PAPER" ]; then
    echo "[$TS] 🔴 KATASTROPHE: DEPLOY_MODE=$DEPLOY_MODE (sollte PAPER)" >> "$LOG"
    tg "🔴 KATASTROPHE 24h-Audit: DEPLOY_MODE=$DEPLOY_MODE bei $TS"
  fi

  # KRITISCH: drift != 0
  if [ "$DRIFT" != "0" ] && [ "$DRIFT" != "-999" ]; then
    echo "[$TS] 🔴 KRITISCH: drift=$DRIFT" >> "$LOG"
    tg "🔴 ALARM 24h-Audit: drift=$DRIFT bei $TS"
  fi

  # KRITISCH: Bot offline
  if [ "$BOT_STATUS" != "online" ]; then
    echo "[$TS] 🔴 KRITISCH: Bot status=$BOT_STATUS" >> "$LOG"
    tg "🔴 ALARM 24h-Audit: Bot status=$BOT_STATUS bei $TS"
  fi

  # R-Sprung (>15 in 24h ist ungewöhnlich)
  R_DELTA=$((${R_NOW:-0} - ${BASELINE_R:-0}))
  if [ $R_DELTA -gt 15 ]; then
    echo "[$TS] 🟡 R-Sprung: PRE=$BASELINE_R NOW=$R_NOW (+$R_DELTA)" >> "$LOG"
  fi

  # Wallet-Sprung > 50 USDT
  WALLET_DELTA=$(echo "$WALLET - $BASELINE_WALLET" | bc -l 2>/dev/null || echo "0")
  WALLET_ABS=$(echo "$WALLET_DELTA" | tr -d '-')
  if [ "$(echo "$WALLET_ABS > 50" | bc -l 2>/dev/null)" = "1" ]; then
    echo "[$TS] 🟡 Wallet-Bewegung: $WALLET_DELTA USDT (Baseline=$BASELINE_WALLET, Now=$WALLET)" >> "$LOG"
  fi

  # Normal-Tick
  echo "[$TS] OK Wallet=$WALLET Drift=$DRIFT R=$R_NOW Pos=$POS_COUNT Mode=$DEPLOY_MODE Status=$BOT_STATUS Consist=$CONSISTENT" >> "$LOG"

  sleep 1800
done

echo "[TECH] Ende $(date)" >> "$LOG"
tg "✅ 24h-Tech-Audit beendet $(date +%H:%M). Log: $LOG"
