#!/usr/bin/env python3
"""
Phase 5a — BTCUSDT-Markt-Charakterisierung 2020-2026.
Liest historical_data/Binance_BTCUSDT_1h.csv und erstellt:
  - Gesamt Min/Max/Aktuell
  - Pro Jahr Low/High/Avg
  - Top-10 Tages-Spikes (absolute %)
  - Markt-Events-Cross-Check
"""
import csv, datetime, os, statistics, collections, sys

CSV_PATH = os.path.expanduser("~/NEXUS_CLEAN/historical_data/Binance_BTCUSDT_1h.csv")

rows = []
with open(CSV_PATH) as f:
    r = csv.reader(f)
    next(r)  # header
    for cols in r:
        if len(cols) < 8:
            continue
        try:
            ts = int(cols[0])
            o = float(cols[3]); h = float(cols[4]); l = float(cols[5]); c = float(cols[6])
        except (ValueError, IndexError):
            continue
        rows.append((ts, o, h, l, c))

print(f"=== BTCUSDT 1h-Kerzen geladen: {len(rows):,} ===")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 1) Gesamt Min/Max/Aktuell
# ─────────────────────────────────────────────────────────────────────────────
min_row = min(rows, key=lambda x: x[3])  # tiefste Low
max_row = max(rows, key=lambda x: x[2])  # höchste High
last_row = rows[-1]

def dt(ts):
    return datetime.datetime.fromtimestamp(ts/1000, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")

print("=== GESAMT 2020-03-01 → 2026-04-30 ===")
print(f"  Tiefster Low:    ${min_row[3]:>10,.2f}  @ {dt(min_row[0])}")
print(f"  Höchster High:   ${max_row[2]:>10,.2f}  @ {dt(max_row[0])}")
print(f"  Aktueller Close: ${last_row[4]:>10,.2f}  @ {dt(last_row[0])}")
print(f"  Spannweite:      {max_row[2]/min_row[3]:>10.1f}× (Min→Max)")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 2) Pro Jahr Stats
# ─────────────────────────────────────────────────────────────────────────────
print("=== PRO JAHR ===")
print(f"  {'Jahr':<6} {'Low':>12} {'High':>12} {'Avg-Close':>12} {'Kerzen':>8}")
by_year = collections.defaultdict(list)
for ts, o, h, l, c in rows:
    year = datetime.datetime.fromtimestamp(ts/1000, tz=datetime.timezone.utc).year
    by_year[year].append((o, h, l, c))
for year in sorted(by_year):
    arr = by_year[year]
    yr_low = min(x[2] for x in arr)
    yr_high = max(x[1] for x in arr)
    yr_avg = statistics.mean(x[3] for x in arr)
    print(f"  {year:<6} ${yr_low:>11,.2f} ${yr_high:>11,.2f} ${yr_avg:>11,.2f} {len(arr):>8,}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 3) Markt-Events Cross-Check
# ─────────────────────────────────────────────────────────────────────────────
print("=== MARKT-EVENTS CROSS-CHECK ===")
events = [
    ("COVID-Crash-Tief",   "2020-03-12", "2020-03-13", "min_low"),
    ("2021-Bull-Top",      "2021-11-01", "2021-11-30", "max_high"),
    ("2022-Bear-Bottom",   "2022-11-01", "2022-12-31", "min_low"),
    ("Pre-Halving-Range",  "2023-06-01", "2023-08-31", "avg_close"),
    ("Halving-2024-Top",   "2024-03-01", "2024-05-31", "max_high"),
    ("2025-Bull-Top",      "2025-01-01", "2025-12-31", "max_high"),
    ("2026-Aktuell",       "2026-04-01", "2026-04-30", "avg_close"),
]
for name, start, end, kind in events:
    s_dt = datetime.datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    e_dt = datetime.datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc) + datetime.timedelta(days=1)
    s_ms = int(s_dt.timestamp() * 1000)
    e_ms = int(e_dt.timestamp() * 1000)
    window = [(ts, o, h, l, c) for ts, o, h, l, c in rows if s_ms <= ts < e_ms]
    if not window:
        print(f"  {name:<22} {start}-{end}: KEIN_DATA")
        continue
    if kind == "min_low":
        row = min(window, key=lambda x: x[3])
        print(f"  {name:<22} {start}-{end}: ${row[3]:>10,.2f} (Low) @ {dt(row[0])}")
    elif kind == "max_high":
        row = max(window, key=lambda x: x[2])
        print(f"  {name:<22} {start}-{end}: ${row[2]:>10,.2f} (High) @ {dt(row[0])}")
    elif kind == "avg_close":
        avg = statistics.mean(x[4] for x in window)
        print(f"  {name:<22} {start}-{end}: ${avg:>10,.2f} (Avg)")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 4) Top-10 Tages-Spikes (24h-Move in %)
# ─────────────────────────────────────────────────────────────────────────────
# Tages-Aggregation: open des ersten 1h-Bars, close des letzten
print("=== TOP-10 TAGES-SPIKES (24h Open→Close %) ===")
daily = collections.defaultdict(list)
for ts, o, h, l, c in rows:
    day = datetime.datetime.fromtimestamp(ts/1000, tz=datetime.timezone.utc).strftime("%Y-%m-%d")
    daily[day].append((ts, o, c))

day_moves = []
for day, bars in daily.items():
    bars.sort()
    first_open = bars[0][1]
    last_close = bars[-1][2]
    if first_open > 0:
        pct = (last_close - first_open) / first_open * 100
        day_moves.append((day, first_open, last_close, pct))
day_moves.sort(key=lambda x: abs(x[3]), reverse=True)
print(f"  {'Datum':<12} {'Open':>10} {'Close':>10} {'Move':>8}")
for day, o, c, pct in day_moves[:10]:
    print(f"  {day:<12} ${o:>9,.2f} ${c:>9,.2f} {pct:>+7.2f}%")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 5) Durchschnitt-tägliche Bewegung
# ─────────────────────────────────────────────────────────────────────────────
abs_moves = [abs(m[3]) for m in day_moves]
print("=== VOLATILITÄT ===")
print(f"  Durchschnittliche tägliche Bewegung: {statistics.mean(abs_moves):.2f}%")
print(f"  Median:                              {statistics.median(abs_moves):.2f}%")
print(f"  Max:                                 {max(abs_moves):.2f}%")
print(f"  Tage mit >5% Move:                   {sum(1 for m in abs_moves if m > 5)}/{len(abs_moves)}")
print(f"  Tage mit >10% Move:                  {sum(1 for m in abs_moves if m > 10)}/{len(abs_moves)}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# 6) Sanity-Check-Ranges für Phase 5b
# ─────────────────────────────────────────────────────────────────────────────
print("=== SANITY-CHECK-RANGES (für Phase 5b Trade-Entries) ===")
for year in sorted(by_year):
    arr = by_year[year]
    yr_low = min(x[2] for x in arr)
    yr_high = max(x[1] for x in arr)
    pad_low = yr_low * 0.95
    pad_high = yr_high * 1.05
    print(f"  {year}: erwarte Entry-Prices zwischen ${pad_low:>10,.0f} und ${pad_high:>10,.0f}")
