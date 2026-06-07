#!/usr/bin/env python3
import sqlite3
import json
import math

DB_PATH = '/Users/christianheilig/NEXUS_CLEAN/nexus.db'
RANGE_START_MS = 1778670556517
RANGE_END_MS   = 1779116323504
TOTAL_RANGE = RANGE_END_MS - RANGE_START_MS

def load_data(start_ms, end_ms):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    decisions = conn.execute(f"""SELECT ts, decision, confidence FROM aladdin_decisions
        WHERE ts BETWEEN {start_ms} AND {end_ms} AND symbol='BTCUSDT' ORDER BY ts ASC""").fetchall()
    news = conn.execute(f"""SELECT ts, sentiment_score, source_weight FROM news_enriched
        WHERE is_spam=0 AND ts BETWEEN {start_ms} AND {end_ms}""").fetchall()
    fng = conn.execute(f"""SELECT ts, value FROM fear_greed_history
        WHERE ts BETWEEN {start_ms} AND {end_ms}""").fetchall()
    funding = conn.execute(f"""SELECT ts, funding FROM funding_oi_history
        WHERE ts BETWEEN {start_ms} AND {end_ms} AND symbol='BTCUSDT'""").fetchall()
    conn.close()
    return decisions, news, fng, funding

def evaluate(params, decisions, news, fng, funding):
    news_at = {}
    for n in news:
        h = n['ts'] // 3600000
        news_at.setdefault(h, []).append(n['sentiment_score'] * n['source_weight'])
    fng_at = {f['ts']//86400000: f['value'] for f in fng}
    fund_at = {f['ts']//3600000: f['funding'] for f in funding}
    returns, matches = [], 0
    for d in decisions:
        h = d['ts']//3600000
        ns_arr = news_at.get(h,[])
        ns = sum(ns_arr)/max(1, len(ns_arr))
        fs = (fng_at.get(d['ts']//86400000, 50)-50)/50
        fundv = fund_at.get(h, 0)
        fs2 = -fundv * 1000
        combined = ns*params['news_weight'] + fs*params['fng_weight'] + fs2*params['funding_weight']
        thr = params['threshold']
        sim = 'BUY' if combined>thr else ('SELL' if combined<-thr else 'HOLD')
        if sim == d['decision']:
            matches += 1
            returns.append(0.001*(d['confidence'] or 0.5))
        elif sim == 'HOLD':
            returns.append(0)
        else:
            returns.append(-0.001*(d['confidence'] or 0.5))
    if not returns: return {'sortino':0,'sharpe':0,'match_rate':0,'n':0}
    mean = sum(returns)/len(returns)
    sd = math.sqrt(sum((r-mean)**2 for r in returns)/len(returns)) if len(returns)>1 else 0.001
    downside = [r for r in returns if r<0]
    dsd = math.sqrt(sum(r*r for r in downside)/len(downside)) if downside else 0.0001
    sharpe = mean/sd*math.sqrt(252*24) if sd>0 else 0
    sortino = mean/dsd*math.sqrt(252*24) if dsd>0 else 0
    return {'sortino':round(sortino,3),'sharpe':round(sharpe,3),'match_rate':round(matches/len(decisions),3),'n':len(decisions)}

def main():
    with open('/Users/christianheilig/NEXUS_CLEAN/HYPEROPT_RESULTS.json') as f:
        hopt = json.load(f)
    
    # 4 Folds aus 5 Tagen Range (je 1 Tag Test, in train rein vorher)
    n_folds = 4
    fold_size = TOTAL_RANGE // n_folds
    folds = []
    for i in range(n_folds):
        test_s = RANGE_START_MS + i * fold_size
        test_e = test_s + fold_size
        folds.append((f'Fold{i+1}', test_s, test_e))
    
    results = []
    for rank, t in enumerate(hopt['top5'][:3]):
        print(f"\n═══ Top #{rank+1} Params: {t['params']}")
        fold_results = []
        for name, test_s, test_e in folds:
            d, n, fng, fund = load_data(test_s, test_e)
            ev = evaluate(t['params'], d, n, fng, fund)
            print(f"  {name}: sortino={ev['sortino']:>7}, sharpe={ev['sharpe']:>7}, match={ev['match_rate']*100:.1f}%, n={ev['n']}")
            fold_results.append({'fold':name, **ev})
        positive_sortinos = sum(1 for f in fold_results if f['sortino']>0)
        positive_sharpes = sum(1 for f in fold_results if f['sharpe']>0)
        robust = positive_sortinos >= 3
        results.append({'rank':rank+1, 'params':t['params'], 'folds':fold_results, 'positive_sortino_folds':positive_sortinos, 'robust':robust})
        print(f"  → Positive Sortino: {positive_sortinos}/4 | ROBUST: {robust}")
    
    with open('/Users/christianheilig/NEXUS_CLEAN/WALKFORWARD_RESULTS.json', 'w') as f:
        json.dump(results, f, indent=2)
    print("\nSaved WALKFORWARD_RESULTS.json")
