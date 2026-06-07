#!/usr/bin/env python3
"""
Vision Stufe 4 — 6-Jahre-Backtest auf 5 Strategien × 3 Symbole

Liest historical_data/Binance_{SYMBOL}_1h.csv (2020-03 bis 2026-04, 54k Zeilen).
Wendet jede der 5 Strategien (TREND_FOLLOW, MEAN_REVERT, BOTTOM_PICK, BREAKOUT_HUNT,
CONSERVATIVE) Walk-Forward an: 12M train (computed, no fit-overlap) / 1M test.

Output: backtest_vision_results.csv mit per-Strategy + per-Symbol + per-Window Stats.

Aufruf (Background empfohlen):
  nohup python3 scripts/backtest_vision_full.py > /tmp/backtest_vision.log 2>&1 &
  echo $! > /tmp/backtest_vision.pid

Erwartete Laufzeit: ~10-30 Minuten je nach CPU.
"""
import os, sys, csv, math, time
from datetime import datetime, timedelta

HIST_DIR = 'historical_data'
SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
GRANULARITY = '1h'

# Walk-Forward Parameter
TRAIN_DAYS = 365   # 12 Monate (für Indikator-Stabilisierung, kein echtes "Fit")
TEST_DAYS = 30     # 1 Monat Test
STEP_DAYS = 30     # Window-Vorschub

OUT_CSV = 'backtest_vision_results.csv'
LOG_PATH = '/tmp/backtest_vision.log'

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)

# ---------- Indikatoren (vereinfacht für Backtest) ----------
def ema(values, period):
    if len(values) < period: return None
    alpha = 2 / (period + 1)
    e = values[0]
    for v in values[1:]:
        e = v * alpha + e * (1 - alpha)
    return e

def rsi(values, period=14):
    if len(values) <= period: return 50
    gains, losses = [], []
    for i in range(1, period+1):
        d = values[i] - values[i-1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    for i in range(period+1, len(values)):
        d = values[i] - values[i-1]
        avg_g = (avg_g * (period-1) + max(d, 0)) / period
        avg_l = (avg_l * (period-1) + max(-d, 0)) / period
    if avg_l == 0: return 100
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))

def adx(highs, lows, closes, period=14):
    if len(closes) < period * 2: return 0
    tr_list, plus_dm, minus_dm = [], [], []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        tr_list.append(tr)
        h_diff = highs[i] - highs[i-1]
        l_diff = lows[i-1] - lows[i]
        plus_dm.append(h_diff if (h_diff > l_diff and h_diff > 0) else 0)
        minus_dm.append(l_diff if (l_diff > h_diff and l_diff > 0) else 0)
    if len(tr_list) < period: return 0
    atr = sum(tr_list[-period:]) / period
    plus = sum(plus_dm[-period:]) / period
    minus = sum(minus_dm[-period:]) / period
    if atr == 0: return 0
    plus_di = 100 * plus / atr
    minus_di = 100 * minus / atr
    if (plus_di + minus_di) == 0: return 0
    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    return dx

def bb(values, period=20, mult=2):
    if len(values) < period: return None
    slice_v = values[-period:]
    m = sum(slice_v) / period
    var = sum((v - m) ** 2 for v in slice_v) / period
    sd = math.sqrt(var)
    return {'middle': m, 'upper': m + mult*sd, 'lower': m - mult*sd}

# ---------- Strategien (analog zu Strategies5 in server.js) ----------
def strat_trend_follow(closes, highs, lows, vols):
    if len(closes) < 60: return None
    e20 = ema(closes[-60:], 20)
    e50 = ema(closes[-60:], 50)
    r = rsi(closes[-30:], 14)
    a = adx(highs[-30:], lows[-30:], closes[-30:], 14)
    last = closes[-1]
    if a < 25: return None
    if e20 > e50 and last > e20*0.995 and last < e20*1.005 and r > 50 and r < 70:
        return ('BUY', 0.5)
    if e20 < e50 and last > e20*0.995 and last < e20*1.005 and r < 50 and r > 30:
        return ('SELL', 0.5)
    return None

def strat_mean_revert(closes, highs, lows, vols):
    if len(closes) < 30: return None
    b = bb(closes, 20)
    r = rsi(closes[-30:], 14)
    a = adx(highs[-30:], lows[-30:], closes[-30:], 14)
    last = closes[-1]
    if a > 25 or not b: return None
    bw = (b['upper'] - b['lower']) / b['middle'] if b['middle'] else 0
    if bw > 0.06: return None
    if last <= b['lower']*1.005 and r < 40: return ('BUY', 0.65)
    if last >= b['upper']*0.995 and r > 60: return ('SELL', 0.65)
    return None

def strat_bottom_pick(closes, highs, lows, vols):
    if len(closes) < 30: return None
    r = rsi(closes[-30:], 14)
    if r > 30: return None
    avg_v = sum(vols[-20:-1]) / 19
    z = (vols[-1] - avg_v) / avg_v if avg_v > 0 else 0
    if z < 1.0: return None
    body = abs(closes[-1] - (lows[-1] + highs[-1] - closes[-1]))  # approx open=high+low-close
    lower_shadow = min(closes[-1], lows[-1]) - lows[-1]
    if (highs[-1] - lows[-1]) == 0: return None
    is_doji = body / (highs[-1] - lows[-1] + 1e-9) < 0.1
    is_hammer = lower_shadow > 2 * body
    if not (is_doji or is_hammer): return None
    return ('BUY', 0.6)

def strat_breakout_hunt(closes, highs, lows, vols):
    if len(closes) < 30: return None
    range_high = max(highs[-20:-1])
    range_low = min(lows[-20:-1])
    avg_v = sum(vols[-20:]) / 20
    vol_ratio = vols[-1] / avg_v if avg_v > 0 else 0
    if vol_ratio < 2.0: return None
    b = bb(closes, 20)
    bw = (b['upper'] - b['lower']) / b['middle'] if (b and b['middle']) else 0
    if bw < 0.04: return None
    if closes[-1] > range_high * 1.002: return ('BUY', 0.7)
    if closes[-1] < range_low * 0.998: return ('SELL', 0.7)
    return None

def strat_conservative(closes, highs, lows, vols):
    return None  # always HOLD

STRATEGIES = {
    'TREND_FOLLOW':   strat_trend_follow,
    'MEAN_REVERT':    strat_mean_revert,
    'BOTTOM_PICK':    strat_bottom_pick,
    'BREAKOUT_HUNT':  strat_breakout_hunt,
    'CONSERVATIVE':   strat_conservative,
}

# ---------- Backtest-Engine ----------
def backtest_strategy_on_window(symbol, candles, strat_name):
    """Simuliert Trades mit fixem TP/SL und return Trade-List."""
    fn = STRATEGIES[strat_name]
    closes = [c['close'] for c in candles]
    highs = [c['high'] for c in candles]
    lows = [c['low'] for c in candles]
    vols = [c['volume'] for c in candles]
    trades = []
    in_trade = False
    entry_price = 0
    entry_idx = 0
    side = None
    SL_PCT = 0.015
    TP_PCT = 0.030
    MAX_HOLD = 48  # 2 Tage
    for i in range(60, len(candles)):
        if not in_trade:
            sig = fn(closes[:i+1], highs[:i+1], lows[:i+1], vols[:i+1])
            if sig:
                side, _ = sig
                entry_price = closes[i]
                entry_idx = i
                in_trade = True
        else:
            cur = closes[i]
            change = (cur - entry_price) / entry_price if side == 'BUY' else (entry_price - cur) / entry_price
            hit_tp = change >= TP_PCT
            hit_sl = change <= -SL_PCT
            timeout = (i - entry_idx) >= MAX_HOLD
            if hit_tp or hit_sl or timeout:
                pnl_pct = change
                trades.append({
                    'symbol': symbol,
                    'strategy': strat_name,
                    'side': side,
                    'entry_idx': entry_idx,
                    'exit_idx': i,
                    'entry': entry_price,
                    'exit': cur,
                    'pnl_pct': pnl_pct,
                    'reason': 'TP' if hit_tp else 'SL' if hit_sl else 'TIMEOUT',
                })
                in_trade = False
    return trades

def aggregate_stats(trades):
    if not trades: return {'count': 0, 'wins': 0, 'losses': 0, 'wr': 0, 'avg_pnl': 0, 'total_pnl': 0, 'sharpe': 0, 'max_dd': 0}
    pnls = [t['pnl_pct'] for t in trades]
    wins = sum(1 for p in pnls if p > 0)
    losses = sum(1 for p in pnls if p <= 0)
    total = sum(pnls)
    avg = total / len(pnls)
    mean = avg
    var = sum((p - mean)**2 for p in pnls) / len(pnls)
    sd = math.sqrt(var)
    sharpe = mean / sd if sd > 0 else 0
    # Max-DD
    eq = 0
    peak = 0
    max_dd = 0
    for p in pnls:
        eq += p
        peak = max(peak, eq)
        dd = (peak - eq)
        max_dd = max(max_dd, dd)
    return {'count': len(trades), 'wins': wins, 'losses': losses, 'wr': wins/len(trades), 'avg_pnl': avg, 'total_pnl': total, 'sharpe': sharpe, 'max_dd': max_dd}

# ---------- Main ----------
def load_csv(symbol):
    path = os.path.join(HIST_DIR, f'Binance_{symbol}_1h.csv')
    if not os.path.exists(path):
        log(f'MISSING: {path}'); return []
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                rows.append({
                    'ts': int(row['unix']),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': float(row['Volume USDT']),
                })
            except (ValueError, KeyError): continue
    rows.sort(key=lambda r: r['ts'])
    return rows

def main():
    log('═══ Vision Stufe 4 — 6-Jahre-Backtest START ═══')
    log(f'Symbols: {SYMBOLS}, Strategies: {list(STRATEGIES.keys())}')
    log(f'Walk-Forward: train={TRAIN_DAYS}d test={TEST_DAYS}d step={STEP_DAYS}d')

    all_trades = []
    summary_rows = []
    t0 = time.time()
    for sym in SYMBOLS:
        log(f'Loading {sym}...')
        candles = load_csv(sym)
        if not candles:
            log(f'  SKIP {sym} (no data)'); continue
        log(f'  {len(candles)} candles loaded ({datetime.fromtimestamp(candles[0]["ts"]/1000).date()} → {datetime.fromtimestamp(candles[-1]["ts"]/1000).date()})')

        # Window-Loop: jeder Step = TEST_DAYS Tage
        candles_per_day = 24
        test_size = TEST_DAYS * candles_per_day
        train_size = TRAIN_DAYS * candles_per_day
        step_size = STEP_DAYS * candles_per_day
        n = len(candles)
        for w_start in range(train_size, n - test_size, step_size):
            test_window = candles[w_start:w_start + test_size]
            # Strategien brauchen Indikator-Lookback — übergebe Test-Window + Lookback-Tail
            lookback = candles[max(0, w_start - 100):w_start]
            slice_with_lookback = lookback + test_window
            for sname in STRATEGIES:
                trades = backtest_strategy_on_window(sym, slice_with_lookback, sname)
                # Filter Trades die innerhalb des Test-Windows starten
                start_offset_idx = len(lookback)
                trades = [t for t in trades if t['entry_idx'] >= start_offset_idx]
                all_trades.extend(trades)
                stats = aggregate_stats(trades)
                window_label = datetime.fromtimestamp(test_window[0]['ts']/1000).date().isoformat()
                summary_rows.append({
                    'symbol': sym, 'strategy': sname, 'window_start': window_label,
                    **stats,
                })
        log(f'  {sym} done')

    # Output CSV
    log(f'Writing {OUT_CSV} with {len(summary_rows)} window-rows...')
    with open(OUT_CSV, 'w', newline='') as f:
        if summary_rows:
            writer = csv.DictWriter(f, fieldnames=list(summary_rows[0].keys()))
            writer.writeheader()
            writer.writerows(summary_rows)

    # Aggregate per (strategy, symbol)
    log('\n═══ AGGREGATE per (strategy, symbol) ═══')
    by_strat_sym = {}
    for r in summary_rows:
        k = (r['strategy'], r['symbol'])
        if k not in by_strat_sym: by_strat_sym[k] = []
        by_strat_sym[k].append(r)

    print(f'\n{"Strategy":<18s} {"Symbol":<9s} {"Trades":>6s} {"WR":>7s} {"Avg%":>8s} {"Total%":>9s} {"Sharpe":>7s}')
    for (s, sym), rows in sorted(by_strat_sym.items()):
        t_count = sum(r['count'] for r in rows)
        wins = sum(r['wins'] for r in rows)
        total_pnl = sum(r['total_pnl'] for r in rows)
        avg_pnl = total_pnl / t_count if t_count > 0 else 0
        wr = wins / t_count if t_count > 0 else 0
        sharpes = [r['sharpe'] for r in rows if r['count'] > 0]
        avg_sharpe = sum(sharpes) / len(sharpes) if sharpes else 0
        print(f'{s:<18s} {sym:<9s} {t_count:>6d} {wr:>7.3f} {avg_pnl*100:>7.2f}% {total_pnl*100:>8.2f}% {avg_sharpe:>7.3f}')

    log(f'\n═══ DONE in {time.time()-t0:.1f}s ═══')

if __name__ == '__main__':
    main()
