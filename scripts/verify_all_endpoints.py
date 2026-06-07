#!/usr/bin/env python3
"""Read-only sanity check of all Phase 2-6+Nachschlag endpoints."""
import json, time, urllib.request, sys

BASE = 'http://localhost:3000'

# (endpoint, method, expected_status, plausibility_check)
def has(d, *keys):
    if not isinstance(d, dict): return False
    return all(k in d for k in keys)

def is_array(d): return isinstance(d, list) or (isinstance(d, dict) and any(isinstance(v, list) for v in d.values()))

def plaus_profitlock(d): return has(d, 'hwm') or has(d, 'enabled')
def plaus_paperperf(d):  return isinstance(d, dict)  # may be empty if no trades
def plaus_news(d):       return is_array(d) or has(d, 'items') or has(d, 'feed') or has(d, 'ok')
def plaus_blacklist(d):  return is_array(d) or has(d, 'ok') or has(d, 'blocked') or isinstance(d, dict)
def plaus_session(d):    return has(d, 'enabled') or has(d, 'currentSession') or has(d, 'session')
def plaus_recovery(d):   return isinstance(d, dict)
def plaus_correlation(d): return has(d, 'matrix') or has(d, 'correlations') or isinstance(d, dict)
def plaus_btport(d):     return isinstance(d, dict)
def plaus_mc(d):         return has(d, 'n') or has(d, 'paths') or has(d, 'mean') or isinstance(d, dict)
def plaus_livetier(d):   return has(d, 'currentTier') or has(d, 'tier') or has(d, 'enabled')
def plaus_dbsplit(d):    return has(d, 'activeMode') or has(d, 'mode') or has(d, 'demoDBPath') or has(d, 'enabled')
def plaus_walkforward(d): return isinstance(d, dict)
def plaus_stratrot(d):   return has(d, 'enabled') and has(d, 'cfg')
def plaus_strats(d):     return d.get('ok') is True and 'strategies' in d
def plaus_farm(d):       return has(d, 'enabled') and has(d, 'bots')
def plaus_exchanges(d):  return 'bitget' in (d.get('exchanges') or []) and 'binance' in (d.get('exchanges') or [])
def plaus_failover(d):   return has(d, 'states') and len(d.get('states') or {}) >= 4
def plaus_scripts_list(d): return d.get('ok') is True and 'scripts' in d
def plaus_scripts_audit(d): return has(d, 'verdict') or has(d, 'eval_enabled')
def plaus_defi(d):       return has(d, 'enabled') and 'rpc_url' in d
def plaus_lstm(d):       return has(d, 'enabled', 'ort_loaded', 'model_path')
def plaus_rl(d):         return has(d, 'enabled', 'shadowCount', 'autoActivateThreshold')
def plaus_wallet(d):     return has(d, 'total') or has(d, 'reserve') or has(d, 'trading')
def plaus_recon(d):      return d.get('consistent') is True and d.get('drift') == 0
def plaus_status(d):     return isinstance(d, dict)
def plaus_metrics_text(t): return isinstance(t, str) and ('# HELP' in t or 'nexus_' in t or len(t) > 100)
def plaus_html(t):       return isinstance(t, str) and '<html' in t.lower()

ENDPOINTS = [
    # Phase 2
    ('/api/profitlock/status',         'GET',  200, plaus_profitlock, 'json'),
    ('/api/paper/performance?period=7','GET',  200, plaus_paperperf,  'json'),
    ('/api/news/feed?limit=5',         'GET',  200, plaus_news,       'json'),
    ('/api/blacklist/list',            'GET',  200, plaus_blacklist,  'json'),

    # Phase 3
    ('/api/session/status',            'GET',  200, plaus_session,    'json'),
    ('/api/recovery/status',           'GET',  200, plaus_recovery,   'json'),
    ('/api/correlation/matrix',        'GET',  200, plaus_correlation,'json'),
    ('/api/montecarlo/run?n=100',      'GET',  200, plaus_mc,         'json'),
    ('/metrics',                       'GET',  200, plaus_metrics_text,'text'),
    ('/api/livetier/status',           'GET',  200, plaus_livetier,   'json'),
    ('/api/dbsplit/status',            'GET',  200, plaus_dbsplit,    'json'),

    # Phase 5
    ('/api/debug/trade/test',          'GET',  None, lambda d: True,  'json'),    # status flexible
    ('/api/backtest/walkforward12m',   'POST', 200, plaus_walkforward,'json'),    # POST endpoint
    ('/api/backtest/portfolio',        'POST', 200, plaus_btport,     'json'),    # POST endpoint (moved here)
    ('/api/report/html?period=1d',     'GET',  200, plaus_html,       'text'),

    # Phase 6 + Nachschlag
    ('/api/stratrot/status',           'GET',  200, plaus_stratrot,   'json'),
    ('/api/strategybuilder',           'GET',  200, plaus_strats,     'json'),  # list endpoint
    ('/api/farm/status',               'GET',  200, plaus_farm,       'json'),
    ('/api/exchanges/list',            'GET',  200, plaus_exchanges,  'json'),
    ('/api/failover/status',           'GET',  200, plaus_failover,   'json'),
    ('/api/scripts/list',              'GET',  200, plaus_scripts_list,'json'),
    ('/api/scripts/audit',             'GET',  200, plaus_scripts_audit,'json'),
    ('/api/defi/status',               'GET',  200, plaus_defi,       'json'),
    ('/api/lstm/status',               'GET',  200, plaus_lstm,       'json'),
    ('/api/rl/shadow_status',          'GET',  200, plaus_rl,         'json'),

    # Sanity
    ('/api/wallet/snapshot',           'GET',  200, plaus_wallet,     'json'),
    ('/api/recon/check',               'GET',  200, plaus_recon,      'json'),
    ('/api/status',                    'GET',  200, plaus_status,     'json'),
]

results = []
for endpoint, method, expected, plaus, kind in ENDPOINTS:
    t0 = time.time()
    try:
        if method == 'POST':
            req = urllib.request.Request(BASE + endpoint, method='POST',
                                         data=b'{}',
                                         headers={'Content-Type': 'application/json'})
        else:
            req = urllib.request.Request(BASE + endpoint, method=method)
        with urllib.request.urlopen(req, timeout=60) as r:
            code = r.status
            body = r.read().decode('utf-8', errors='replace')
        dt_ms = int((time.time() - t0) * 1000)
        if kind == 'json':
            try:
                d = json.loads(body)
                json_ok = True
            except Exception:
                d = body; json_ok = False
            plaus_ok = bool(plaus(d)) if json_ok else False
        else:
            json_ok = None
            plaus_ok = bool(plaus(body))
        status_ok = (expected is None) or (code == expected)
        results.append({
            'endpoint': endpoint, 'http': code, 'time_ms': dt_ms,
            'json_ok': json_ok, 'plausible': plaus_ok,
            'pass': status_ok and (plaus_ok),
            'size': len(body),
        })
    except urllib.error.HTTPError as e:
        dt_ms = int((time.time() - t0) * 1000)
        # 404/403/etc could be legitimate (e.g. debug/trade/test)
        status_ok = (expected is None) or (e.code == expected)
        results.append({
            'endpoint': endpoint, 'http': e.code, 'time_ms': dt_ms,
            'json_ok': None, 'plausible': status_ok,
            'pass': status_ok,
            'size': 0,
        })
    except Exception as e:
        results.append({
            'endpoint': endpoint, 'http': 'ERR', 'time_ms': 0,
            'json_ok': False, 'plausible': False,
            'pass': False, 'error': str(e), 'size': 0,
        })

# Print table
print(f'{"#":>3} {"Endpoint":<40} {"HTTP":>5} {"ms":>6} {"JSON":>5} {"Plaus":>5} {"Pass":>5}')
print('-' * 80)
passed = 0
fails = []
for i, r in enumerate(results, 1):
    jsn = 'YES' if r['json_ok'] else ('-' if r['json_ok'] is None else 'NO')
    pl = 'YES' if r['plausible'] else 'NO'
    p = '✅' if r['pass'] else '❌'
    print(f'{i:>3} {r["endpoint"]:<40} {str(r["http"]):>5} {r["time_ms"]:>6} {jsn:>5} {pl:>5}  {p}')
    if r['pass']: passed += 1
    else: fails.append(r)

print(f'\nPASS: {passed}/{len(results)}')
if fails:
    print('FAILS:')
    for f in fails:
        msg = f.get('error') or f'http={f["http"]} json_ok={f["json_ok"]} plausible={f["plausible"]}'
        print(f'  {f["endpoint"]}: {msg}')

# Persist
out = {'ts': int(time.time()*1000), 'passed': passed, 'total': len(results), 'fails': fails, 'results': results}
print('\n--- JSON BEGIN ---')
print(json.dumps(out, indent=2))
print('--- JSON END ---')
