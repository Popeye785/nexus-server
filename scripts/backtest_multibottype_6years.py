#!/usr/bin/env python3
"""
Multi-BotType Backtest auf 6 Jahre Historical-Data.
Vergleicht GRID / DCA / INFGRID (zusätzlich zu SINGLE-Strategien aus backtest_vision_full).

Pro Symbol × BotType × Regime: trades, WR, sharpe, DD, total_pnl.
Output: multibottype_results.csv.

Aufruf (Background):
  nohup python3 scripts/backtest_multibottype_6years.py > /tmp/backtest_mbt.log 2>&1 &
"""
import os, csv, math, time
from datetime import datetime, timedelta

HIST_DIR = 'historical_data'
SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
OUT_CSV = 'multibottype_results.csv'

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

# ── Load 1h candles ──
def load_candles(symbol):
    path = os.path.join(HIST_DIR, f'Binance_{symbol}_1h.csv')
    if not os.path.exists(path):
        log(f'MISS: {path}')
        return []
    rows = []
    with open(path) as f:
        rd = csv.reader(f)
        try: next(rd)  # header
        except StopIteration: return []
        for r in rd:
            try:
                if len(r) >= 7:
                    ts = int(float(r[0]))
                    rows.append({
                        'ts': ts, 'open': float(r[3]), 'high': float(r[4]),
                        'low': float(r[5]), 'close': float(r[6]),
                        'volume': float(r[7]) if len(r) > 7 and r[7] else 0
                    })
            except (ValueError, IndexError):
                continue
    rows.sort(key=lambda x: x['ts'])
    return rows

# ── Regime-Approx (light) ──
def classify_regime(candles, idx, window=100):
    if idx < window: return 'NEUTRAL'
    block = candles[idx-window:idx]
    closes = [c['close'] for c in block]
    rets = [(closes[i+1]-closes[i])/closes[i] for i in range(len(closes)-1)]
    if not rets: return 'NEUTRAL'
    mean_ret = sum(rets) / len(rets)
    vol = math.sqrt(sum((r-mean_ret)**2 for r in rets) / max(1, len(rets)-1))
    trend = (closes[-1] - closes[0]) / closes[0]
    if vol > 0.05: return 'EXTREME_VOL'
    if trend > 0.05: return 'BULL_STRONG'
    if trend > 0.02: return 'BULL_WEAK'
    if trend < -0.05: return 'BEAR_STRONG'
    if trend < -0.02: return 'BEAR_WEAK'
    if vol < 0.015: return 'RANGING'
    return 'NEUTRAL'

# ── Backtest GRID ──
# Range = ±5% around mean(close last 100 bars), 10 levels, capital 100
def backtest_grid(candles, regime_filter=None):
    fills = 0; profit = 0; range_breaks = 0
    NUM_LEVELS = 10; CAP = 100; PROFIT_PER_FILL = 0.005  # ~0.5% pro Fill grob
    i = 100
    while i < len(candles):
        regime = classify_regime(candles, i)
        if regime_filter and regime != regime_filter:
            i += 1; continue
        # Setup grid around mid
        mid = sum(c['close'] for c in candles[i-100:i]) / 100
        low = mid * 0.95; high = mid * 1.05
        # Simulate next 168h (1 week) of fills
        active = True
        for j in range(i, min(i+168, len(candles))):
            p = candles[j]['close']
            if p < low * 0.95 or p > high * 1.05:
                range_breaks += 1
                active = False
                break
            # If in range and oscillates, count fills (grobe Schätzung)
            if i+1 < j:
                prev = candles[j-1]['close']
                step = (high - low) / NUM_LEVELS
                # crossing a level threshold → fill
                if abs(p - prev) > step:
                    fills += 1
                    profit += (CAP / NUM_LEVELS) * PROFIT_PER_FILL
        i += 168
    trades = fills
    sharpe = (profit / max(1, trades * 0.1)) if trades > 0 else 0
    return {
        'bot_type': 'GRID',
        'trades': trades,
        'wr': 1.0 if profit > 0 else 0.0,  # grid hat keine "Verluste pro Trade", entweder Profit oder Range-Break
        'total_pnl': round(profit, 4),
        'avg_pnl': round(profit / max(1, trades), 6),
        'sharpe': round(sharpe, 3),
        'range_breaks': range_breaks,
    }

# ── Backtest DCA ──
# Kaufe alle 6h (24-bar) 10 USDT, TP bei +6% auf avg, max 8 Iter, max_dd 20%
def backtest_dca(candles, regime_filter=None):
    total_pnl = 0; cycles = 0; tp_hits = 0; dd_stops = 0
    INTERVAL_BARS = 6; CAP_PER_BUY = 10; MAX_ITER = 8; TP_PCT = 0.06; MAX_DD = 0.20
    i = 0
    while i < len(candles) - 200:
        regime = classify_regime(candles, i+100)
        if regime_filter and regime != regime_filter:
            i += 24; continue
        # Start DCA at i
        avg_price = 0; total_size = 0; iteration = 0
        j = i; closed = False
        while j < len(candles) and iteration < MAX_ITER:
            price = candles[j]['close']
            # DD-Check
            if avg_price > 0:
                dd = max(0, (avg_price - price) / avg_price)
                if dd > MAX_DD:
                    dd_stops += 1
                    break  # weiter halten, kein Sell
            # Buy
            buy_size = CAP_PER_BUY / price
            total_size += buy_size
            total_spent = (avg_price * (total_size - buy_size)) + CAP_PER_BUY
            avg_price = total_spent / total_size
            iteration += 1
            j += INTERVAL_BARS
        # Nach max_iter oder dd_stop: check TP über next 720h
        if total_size > 0:
            tp_price = avg_price * (1 + TP_PCT)
            for k in range(j, min(j+720, len(candles))):
                if candles[k]['close'] >= tp_price:
                    realized = (candles[k]['close'] - avg_price) * total_size
                    total_pnl += realized
                    tp_hits += 1
                    closed = True
                    break
            if not closed:
                # close at end at market
                last = candles[min(j+720, len(candles)-1)]['close']
                total_pnl += (last - avg_price) * total_size
            cycles += 1
        i = j + 720  # next cycle 30d later
    wr = tp_hits / max(1, cycles)
    sharpe = (total_pnl / max(1, cycles * 5)) if cycles > 0 else 0
    return {
        'bot_type': 'DCA',
        'trades': cycles,
        'wr': round(wr, 4),
        'total_pnl': round(total_pnl, 4),
        'avg_pnl': round(total_pnl / max(1, cycles), 6),
        'sharpe': round(sharpe, 3),
        'tp_hits': tp_hits,
        'dd_stops': dd_stops,
    }

# ── Backtest INFGRID (vereinfacht: Grid mit Extension nach oben) ──
def backtest_infgrid(candles, regime_filter=None):
    fills = 0; profit = 0; extensions = 0
    NUM_LEVELS = 10; CAP = 100; PROFIT_PER_FILL = 0.006
    i = 100
    while i < len(candles):
        regime = classify_regime(candles, i)
        if regime_filter and regime != regime_filter:
            i += 1; continue
        mid = sum(c['close'] for c in candles[i-100:i]) / 100
        low = mid * 0.95; high = mid * 1.05
        for j in range(i, min(i+168, len(candles))):
            p = candles[j]['close']
            if p < low * 0.95:
                break  # down-break
            if p >= high:
                extensions += 1
                high = high * 1.05
                continue
            prev = candles[j-1]['close']
            step = (high - low) / NUM_LEVELS
            if abs(p - prev) > step:
                fills += 1
                profit += (CAP / NUM_LEVELS) * PROFIT_PER_FILL
        i += 168
    trades = fills
    sharpe = (profit / max(1, trades * 0.1)) if trades > 0 else 0
    return {
        'bot_type': 'INFGRID',
        'trades': trades,
        'wr': 1.0 if profit > 0 else 0.0,
        'total_pnl': round(profit, 4),
        'avg_pnl': round(profit / max(1, trades), 6),
        'sharpe': round(sharpe, 3),
        'extensions': extensions,
    }

REGIMES = ['BULL_STRONG','BULL_WEAK','NEUTRAL','RANGING','SQUEEZE','BEAR_WEAK','BEAR_STRONG','EXTREME_VOL']

def main():
    log('Multi-BotType Backtest START')
    t0 = time.time()
    rows = []
    for sym in SYMBOLS:
        log(f'Loading {sym}...')
        candles = load_candles(sym)
        if not candles:
            log(f'  EMPTY {sym}, skip')
            continue
        log(f'  {len(candles)} candles {sym}')
        # Overall (no regime filter)
        for bt_fn, name in [(backtest_grid,'GRID'), (backtest_dca,'DCA'), (backtest_infgrid,'INFGRID')]:
            r = bt_fn(candles, None)
            rows.append({'symbol': sym, 'regime': 'ALL', **r})
            log(f'  {sym} {r["bot_type"]} ALL: trades={r["trades"]} pnl={r["total_pnl"]} sharpe={r["sharpe"]}')
        # Per Regime
        for reg in REGIMES:
            for bt_fn in [backtest_grid, backtest_dca, backtest_infgrid]:
                r = bt_fn(candles, reg)
                if r['trades'] > 0:
                    rows.append({'symbol': sym, 'regime': reg, **r})
    # Write CSV
    log(f'Writing {OUT_CSV} ({len(rows)} rows)')
    with open(OUT_CSV, 'w', newline='') as f:
        if not rows: return
        keys = ['symbol','regime','bot_type','trades','wr','total_pnl','avg_pnl','sharpe','range_breaks','tp_hits','dd_stops','extensions']
        wr = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
        wr.writeheader()
        for r in rows: wr.writerow(r)
    log(f'DONE in {time.time()-t0:.1f}s — {len(rows)} rows')

if __name__ == '__main__':
    main()
