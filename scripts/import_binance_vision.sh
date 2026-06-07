#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# import_binance_vision.sh
# Lädt 5J historische Kerzen von data.binance.vision (offizielle Binance-Quelle)
# und konvertiert sie ins HistoricalData-Format des NEXUS-Bots.
#
# Output:
#   ~/NEXUS_CLEAN/historical_data/Binance_<SYMBOL>_<INTERVAL>.csv
#   Header: unix,date,symbol,open,high,low,close,Volume USDT
#
# Usage:
#   ./scripts/import_binance_vision.sh                 # alle 20 Coins × {1h,15m} × 60 Monate
#   ./scripts/import_binance_vision.sh --intervals 1h  # nur 1h
#   ./scripts/import_binance_vision.sh --symbols BTC,ETH,SOL
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail

BASE_DIR="${HOME}/NEXUS_CLEAN"
OUT_DIR="${BASE_DIR}/historical_data"
RAW_DIR="${OUT_DIR}/_raw"
LOG_FILE="${BASE_DIR}/.import_binance_vision.log"

# Defaults
SYMBOLS=(BTC ETH SOL BNB XRP ADA AVAX DOT DOGE LINK ATOM UNI LTC NEAR ARB OP SUI APT SEI MATIC)
INTERVALS=(1h 15m)
START_YEAR=2021
START_MONTH=5
END_YEAR=2026
END_MONTH=5
PARALLEL=8

# Args parsen
while [[ $# -gt 0 ]]; do
  case "$1" in
    --symbols)   IFS=',' read -ra SYMBOLS <<< "$2"; shift 2;;
    --intervals) IFS=',' read -ra INTERVALS <<< "$2"; shift 2;;
    --parallel)  PARALLEL="$2"; shift 2;;
    --from)      START_YEAR="${2%-*}"; START_MONTH="${2#*-}"; shift 2;;
    --to)        END_YEAR="${2%-*}";   END_MONTH="${2#*-}";   shift 2;;
    *) echo "Unbekanntes Argument: $1"; exit 1;;
  esac
done

mkdir -p "$OUT_DIR" "$RAW_DIR"
echo "" > "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Binance-Vision Bulk-Import gestartet $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Symbols:   ${#SYMBOLS[@]} (${SYMBOLS[*]})"
echo "  Intervals: ${INTERVALS[*]}"
echo "  Range:     ${START_YEAR}-${START_MONTH} bis ${END_YEAR}-${END_MONTH}"
echo "  Parallel:  $PARALLEL"
echo "  Output:    $OUT_DIR"
echo "═══════════════════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────
# Helper: Lade ein Monats-ZIP, entpacke es. Gibt Pfad zur CSV zurück, oder "".
# ─────────────────────────────────────────────────────────────────────────────
download_one() {
  local sym="$1" ivl="$2" yr="$3" mo="$4"
  local pair="${sym}USDT"
  local mostr; printf -v mostr "%02d" "$mo"
  local fn_base="${pair}-${ivl}-${yr}-${mostr}"
  local zip_url="https://data.binance.vision/data/spot/monthly/klines/${pair}/${ivl}/${fn_base}.zip"
  local zip_path="${RAW_DIR}/${fn_base}.zip"
  local csv_path="${RAW_DIR}/${fn_base}.csv"

  if [[ -s "$csv_path" ]]; then
    echo "$csv_path"
    return 0
  fi

  local http_code
  http_code=$(curl -sS --max-time 30 -o "$zip_path" -w "%{http_code}" "$zip_url" 2>/dev/null)
  if [[ "$http_code" != "200" ]]; then
    rm -f "$zip_path"
    echo "MISS $pair $ivl $yr-$mostr ($http_code)" >> "$LOG_FILE"
    echo ""
    return 1
  fi

  if ! unzip -qo "$zip_path" -d "$RAW_DIR" 2>/dev/null; then
    echo "UNZIP_FAIL $pair $ivl $yr-$mostr" >> "$LOG_FILE"
    rm -f "$zip_path"
    echo ""
    return 1
  fi
  rm -f "$zip_path"
  echo "$csv_path"
}

export -f download_one
export RAW_DIR LOG_FILE

# ─────────────────────────────────────────────────────────────────────────────
# Phase 1: Parallel-Downloader (alle ZIPs entpacken)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "PHASE 1: Download + Unzip..."
download_jobs=()
for sym in "${SYMBOLS[@]}"; do
  for ivl in "${INTERVALS[@]}"; do
    y="$START_YEAR"; m="$START_MONTH"
    while (( y < END_YEAR || (y == END_YEAR && m <= END_MONTH) )); do
      download_jobs+=("$sym $ivl $y $m")
      m=$((m+1))
      if (( m > 12 )); then m=1; y=$((y+1)); fi
    done
  done
done

total=${#download_jobs[@]}
echo "  ${total} ZIPs zu laden..."

# Parallel via xargs
printf "%s\n" "${download_jobs[@]}" | xargs -P "$PARALLEL" -I {} bash -c '
  IFS=" " read -r s i y m <<< "{}"
  download_one "$s" "$i" "$y" "$m" >/dev/null
'

raw_count=$(find "$RAW_DIR" -name "*.csv" 2>/dev/null | wc -l | tr -d ' ')
miss_count=$(grep -c "^MISS" "$LOG_FILE" 2>/dev/null)
miss_count=${miss_count:-0}
echo "  CSVs extrahiert: $raw_count"
echo "  Fehlend (Pre-Listing/404): $miss_count (Log: $LOG_FILE)"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: Pro Symbol+Interval: Monats-CSVs konkatenieren + Header schreiben
# Binance-Vision-Format (HEADERLESS):
#   col[0] open_time(ms), col[1] open, col[2] high, col[3] low, col[4] close,
#   col[5] volume_base, col[6] close_time, col[7] quote_volume, ...
# Bot erwartet (HistoricalData):
#   unix,date,symbol,open,high,low,close,Volume USDT
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "PHASE 2: Konvertierung zu HistoricalData-Format..."

for sym in "${SYMBOLS[@]}"; do
  for ivl in "${INTERVALS[@]}"; do
    pair="${sym}USDT"
    out_csv="${OUT_DIR}/Binance_${pair}_${ivl}.csv"
    tmp_csv="${out_csv}.tmp"

    raw_files=$(find "$RAW_DIR" -name "${pair}-${ivl}-*.csv" 2>/dev/null | sort)
    if [[ -z "$raw_files" ]]; then
      echo "  ${pair} ${ivl}: keine Daten → übersprungen"
      continue
    fi

    list_file=$(mktemp)
    echo "$raw_files" > "$list_file"
    python3 - "$pair" "$tmp_csv" "$list_file" <<'PYEOF' || { rm -f "$tmp_csv" "$list_file"; echo "  ${pair} ${ivl}: PYTHON-FAIL"; continue; }
import sys, os, datetime
pair = sys.argv[1]
out_path = sys.argv[2]
list_file = sys.argv[3]
with open(list_file) as lf:
    file_list = [ln.strip() for ln in lf if ln.strip()]
file_list.sort()
with open(out_path, 'w') as out:
    out.write("unix,date,symbol,open,high,low,close,Volume USDT\n")
    n = 0
    for fp in file_list:
        if not os.path.exists(fp):
            continue
        with open(fp) as f:
            for line in f:
                cols = line.rstrip("\r\n").split(",")
                if len(cols) < 6:
                    continue
                # Header-Skip (manche Binance-Vision-Files haben Header ab 2024)
                if not cols[0].lstrip("-").replace(".", "", 1).isdigit():
                    continue
                try:
                    ts = int(float(cols[0]))
                    # Binance-Vision: <2025 = milliseconds (13), >=2025 = microseconds (16). Auch sec (10) fallback.
                    if ts > 1_000_000_000_000_000:   # microseconds → ms
                        ts = ts // 1000
                    elif ts < 1_000_000_000_000:     # seconds → ms
                        ts *= 1000
                    dt = datetime.datetime.fromtimestamp(ts/1000, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    o, h, l, c = cols[1], cols[2], cols[3], cols[4]
                    # cols[7] = quote-volume (USDT). Fallback cols[5] (base volume).
                    qv = cols[7] if (len(cols) > 7 and cols[7]) else cols[5]
                    out.write(f"{ts},{dt},{pair},{o},{h},{l},{c},{qv}\n")
                    n += 1
                except (ValueError, IndexError):
                    continue
print(f"_PYROWS_{n}", file=sys.stderr)
PYEOF
    rm -f "$list_file"

    rows=$(wc -l < "$tmp_csv" | tr -d ' ')
    if (( rows > 1 )); then
      mv "$tmp_csv" "$out_csv"
      size=$(du -h "$out_csv" | awk '{print $1}')
      first_ts=$(awk -F',' 'NR==2 {print $2}' "$out_csv")
      last_ts=$(tail -1 "$out_csv" | awk -F',' '{print $2}')
      echo "  ${pair} ${ivl}: $((rows-1)) Kerzen, $size, $first_ts → $last_ts"
    else
      rm -f "$tmp_csv"
      echo "  ${pair} ${ivl}: 0 Kerzen → keine Datei"
    fi
  done
done

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "FERTIG $(date '+%Y-%m-%d %H:%M:%S')"
out_count=$(find "$OUT_DIR" -maxdepth 1 -name "Binance_*USDT_*.csv" | wc -l | tr -d ' ')
total_size=$(du -sh "$OUT_DIR" | awk '{print $1}')
echo "  Output-CSVs: $out_count Dateien"
echo "  Gesamtgröße: $total_size"
echo "  Cleanup-Hinweis: '${RAW_DIR}' kann nach Verifikation gelöscht werden"
echo "═══════════════════════════════════════════════════════════════════════"
