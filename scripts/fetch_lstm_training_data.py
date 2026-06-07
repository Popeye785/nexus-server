"""
Fetch historical 1h candles from Bitget public API for LSTM training.
No API key needed (public endpoint).
"""
import os, sys, json, time, urllib.request, urllib.parse, ssl
# macOS Python.org 3.13 has no system CA store; public read-only endpoint, so allow unverified.
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
GRANULARITY = '1h'
GRAN_MS = 60 * 60 * 1000
DAYS = 365
PAGE_LIMIT = 200  # history-candles max per call
OUT_DIR = 'data/lstm_training'
os.makedirs(OUT_DIR, exist_ok=True)

now_ms = int(time.time() * 1000)
start_ms = now_ms - DAYS * 24 * 3600 * 1000

def fetch_window(symbol, end_ms):
    """Fetch up to PAGE_LIMIT candles ending at end_ms."""
    url = (
        f'https://api.bitget.com/api/v2/spot/market/history-candles'
        f'?symbol={symbol}&granularity={GRANULARITY}&endTime={end_ms}&limit={PAGE_LIMIT}'
    )
    try:
        r = urllib.request.urlopen(url, timeout=15, context=_ssl_ctx)
        body = json.loads(r.read())
        if body.get('code') != '00000':
            print(f'  ERR code={body.get("code")} msg={body.get("msg")}', file=sys.stderr)
            return []
        # Each candle: [ts, open, high, low, close, baseVol, quoteVol, usdtVol]
        candles = body.get('data', [])
        return [(int(c[0]), float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5])) for c in candles]
    except Exception as e:
        print(f'  fetch err: {e}', file=sys.stderr)
        return []

for sym in SYMBOLS:
    print(f'Fetching {sym} 1h candles for ~{DAYS} days...')
    all_candles = {}
    cursor_ms = now_ms
    while cursor_ms > start_ms:
        batch = fetch_window(sym, cursor_ms)
        if not batch:
            print(f'  empty batch, stopping at cursor={cursor_ms}', file=sys.stderr)
            break
        for c in batch:
            all_candles[c[0]] = c
        oldest = min(c[0] for c in batch)
        if oldest >= cursor_ms:
            print(f'  cursor not advancing, stopping', file=sys.stderr)
            break
        cursor_ms = oldest - 1
        time.sleep(0.15)  # rate-limit polite
        print(f'  {sym}: {len(all_candles)} unique candles, oldest={oldest}', file=sys.stderr)

    rows = sorted(all_candles.values(), key=lambda x: x[0])
    out_path = os.path.join(OUT_DIR, f'{sym}_1h.csv')
    with open(out_path, 'w') as f:
        f.write('ts,open,high,low,close,volume\n')
        for r in rows:
            f.write(','.join(str(v) for v in r) + '\n')
    print(f'  Saved {out_path}: {len(rows)} rows')

print('DONE')
