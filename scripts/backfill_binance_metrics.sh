#!/bin/bash
# Binance Vision metrics-Download (OI + Long/Short Ratios) als Liquidations-Proxy
SYMBOLS=("BTCUSDT" "ETHUSDT" "SOLUSDT" "BNBUSDT")
TARGET_DIR=/tmp/binance_metrics
mkdir -p "$TARGET_DIR"
DAYS_BACK=90
DOWNLOADED=0

for sym in "${SYMBOLS[@]}"; do
  for i in $(seq 0 $DAYS_BACK); do
    DATE=$(/bin/date -v-${i}d +%Y-%m-%d)
    FILE="${sym}-metrics-${DATE}.zip"
    URL="https://data.binance.vision/data/futures/um/daily/metrics/${sym}/${FILE}"
    if [ -f "$TARGET_DIR/$FILE" ]; then continue; fi
    /usr/bin/curl -s -o "$TARGET_DIR/$FILE" "$URL" --max-time 8
    if [ -s "$TARGET_DIR/$FILE" ] && [ $(/usr/bin/wc -c < "$TARGET_DIR/$FILE") -gt 500 ]; then
      DOWNLOADED=$((DOWNLOADED+1))
    else
      /bin/rm -f "$TARGET_DIR/$FILE"
    fi
  done
  echo "$sym done"
done
echo "Total downloaded: $DOWNLOADED"
/bin/ls "$TARGET_DIR" | /usr/bin/wc -l
/bin/du -sh "$TARGET_DIR"
