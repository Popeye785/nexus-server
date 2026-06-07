#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# import_cryptodatadownload_2020.sh
# Lädt CryptoDataDownload-1h-CSVs und merget die 2020-03-01 → 2021-04-30 Range
# in die bestehenden Binance_<SYMBOL>USDT_1h.csv-Dateien.
#
# CDD hat KEIN 15m-Format (nur 1h, _minute, _d). 15m bleibt 5J Binance-Vision.
# Format: Comment-Zeile + Unix,Date,Symbol,Open,High,Low,Close,Volume <BASE>,Volume USDT,tradecount
#  - DESC sortiert, gemischtes ms/μs-Format
# Output-Format wie Binance-Vision: unix,date,symbol,open,high,low,close,Volume USDT (ms only)
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail

BASE_DIR="${HOME}/NEXUS_CLEAN"
OUT_DIR="${BASE_DIR}/historical_data"
CDD_RAW="${OUT_DIR}/_cdd_raw"
LOG_FILE="${BASE_DIR}/.import_cdd_2020.log"

COINS=(BTC ETH BNB XRP ADA DOGE LINK LTC ATOM MATIC SOL AVAX DOT UNI NEAR)
RANGE_START="2020-03-01"
RANGE_END="2021-04-30"

mkdir -p "$CDD_RAW"
echo "" > "$LOG_FILE"

echo "═══════════════════════════════════════════════════════════════════════"
echo "CDD-Ergänzung $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Coins:  ${#COINS[@]} (${COINS[*]})"
echo "  Range:  ${RANGE_START} → ${RANGE_END}"
echo "  Source: cryptodatadownload.com"
echo "═══════════════════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 4b.1: Parallel Download
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "PHASE 4b.1: Download 1h-CSVs..."
for sym in "${COINS[@]}"; do
  url="https://www.cryptodatadownload.com/cdd/Binance_${sym}USDT_1h.csv"
  out="${CDD_RAW}/${sym}_1h_cdd.csv"
  (curl -sS --max-time 120 -A "Mozilla/5.0" "$url" -o "$out" 2>/dev/null && \
   echo "  ${sym}USDT: $(du -h "$out" | awk '{print $1}') $(wc -l < "$out" | tr -d ' ') Zeilen") &
done
wait
echo "  Download fertig."

# ─────────────────────────────────────────────────────────────────────────────
# Phase 4b.2: Pro Coin: Filter + Merge mit existierender Binance_*_1h.csv
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "PHASE 4b.2: Filter + Merge..."

for sym in "${COINS[@]}"; do
  pair="${sym}USDT"
  cdd_csv="${CDD_RAW}/${sym}_1h_cdd.csv"
  bv_csv="${OUT_DIR}/Binance_${pair}_1h.csv"
  merged_tmp="${OUT_DIR}/Binance_${pair}_1h.csv.merged"

  if [[ ! -s "$cdd_csv" ]]; then
    echo "  ${pair}: KEIN CDD-File"
    continue
  fi
  if [[ ! -s "$bv_csv" ]]; then
    echo "  ${pair}: KEIN Binance-Vision-File (übersprungen)"
    continue
  fi

  python3 - "$pair" "$cdd_csv" "$bv_csv" "$merged_tmp" "$RANGE_START" "$RANGE_END" <<'PYEOF' || { echo "  ${pair}: PYTHON-FAIL"; continue; }
import sys, datetime
pair, cdd_path, bv_path, out_path, range_start, range_end = sys.argv[1:7]

# Range als ms-Boundary
def to_ms(date_str):
    dt = datetime.datetime.strptime(date_str, "%Y-%m-%d")
    return int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)

start_ms = to_ms(range_start)
end_ms   = to_ms(range_end) + 86399000  # bis 23:59:59 dieses Tags

def normalize_ts(raw):
    """Mischformat: ms(13)/μs(16)/s(10) → ms(13)"""
    try:
        ts = int(float(raw))
    except (ValueError, TypeError):
        return None
    if ts > 1_000_000_000_000_000:   # μs
        return ts // 1000
    if ts < 1_000_000_000_000:        # s
        return ts * 1000
    return ts  # ms

# 1) CDD-File parsen
cdd_rows = {}  # ts -> (open, high, low, close, vol_usdt)
with open(cdd_path) as f:
    for ln, line in enumerate(f, 1):
        cols = line.rstrip("\r\n").split(",")
        if len(cols) < 7:
            continue
        ts = normalize_ts(cols[0])
        if ts is None:
            continue
        if ts < start_ms or ts > end_ms:
            continue
        # CDD-Format: Unix,Date,Symbol,Open,High,Low,Close,Volume BTC,Volume USDT,tradecount
        # Volume USDT = cols[8] (Index)
        try:
            o, h, l, c = cols[3], cols[4], cols[5], cols[6]
            vol_usdt = cols[8] if len(cols) > 8 else cols[7]
            cdd_rows[ts] = (o, h, l, c, vol_usdt)
        except IndexError:
            continue

# 2) Binance-Vision-File parsen (alle behalten, header skip)
bv_rows = {}
header_line = None
with open(bv_path) as f:
    for ln, line in enumerate(f, 1):
        line = line.rstrip("\r\n")
        if ln == 1:
            header_line = line
            continue
        cols = line.split(",")
        if len(cols) < 8:
            continue
        ts = normalize_ts(cols[0])
        if ts is None:
            continue
        # BV-Format: unix,date,symbol,open,high,low,close,Volume USDT
        bv_rows[ts] = (cols[3], cols[4], cols[5], cols[6], cols[7])

# 3) Merge — CDD-Rows haben Priorität für Overlap (sollte aber keinen geben)
combined = {**cdd_rows, **bv_rows}

# 4) Sort + Write
sorted_ts = sorted(combined.keys())
with open(out_path, 'w') as out:
    out.write(header_line + "\n" if header_line else "unix,date,symbol,open,high,low,close,Volume USDT\n")
    for ts in sorted_ts:
        o, h, l, c, v = combined[ts]
        dt = datetime.datetime.fromtimestamp(ts/1000, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        out.write(f"{ts},{dt},{pair},{o},{h},{l},{c},{v}\n")

print(f"_RESULT_ cdd={len(cdd_rows)} bv={len(bv_rows)} merged={len(combined)} added={len(combined)-len(bv_rows)}", file=sys.stderr)
PYEOF

  # Atomic move
  if [[ -s "$merged_tmp" ]]; then
    mv "$merged_tmp" "$bv_csv"
    new_rows=$(wc -l < "$bv_csv" | tr -d ' ')
    first=$(awk -F',' 'NR==2 {print $2}' "$bv_csv")
    last=$(tail -1 "$bv_csv" | awk -F',' '{print $2}')
    echo "  ${pair}: rows=$((new_rows-1)) range=${first} → ${last}"
  else
    echo "  ${pair}: Merge-Result leer, original belassen"
    rm -f "$merged_tmp"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# Phase 4b.4: Cleanup
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "PHASE 4b.4: Cleanup..."
size_raw=$(du -sh "$CDD_RAW" 2>/dev/null | awk '{print $1}')
rm -rf "$CDD_RAW"
echo "  CDD_RAW gelöscht ($size_raw frei)"

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "FERTIG $(date '+%Y-%m-%d %H:%M:%S')"
total_size=$(du -sh "$OUT_DIR" | awk '{print $1}')
echo "  Gesamtgröße historical_data/: $total_size"
echo "═══════════════════════════════════════════════════════════════════════"
