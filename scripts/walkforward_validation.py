#!/usr/bin/env python3
import sqlite3
import json
import math

DB_PATH = '/Users/christianheilig/NEXUS_CLEAN/nexus.db'

def load_data(start_ts, end_ts):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    decisions = conn.execute(f"""SELECT ts, symbol, decision, confidence FROM aladdin_decisions
        WHERE ts BETWEEN {start_ts} AND {end_ts} AND symbol='BTCUSDT' ORDER BY ts ASC""").fetchall()
    news = conn.execute(f"""SELECT ts, sentiment_score, source_weight FROM news_enriched
        WHERE is_spam=0 AND ts BETWEEN {start_ts} AND {end_ts}""").fetchall()
    fng = conn.execute(f"""SELECT ts, value FROM fear_greed_history
        WHERE ts BETWEEN {start_ts} AND {end_ts}""").fetchall()
    funding = conn.execute(f"""SELECT ts, symbol, funding FROM funding_oi_history
        WHERE ts BETWEEN {start_ts} AND {end_ts} AND symbol='BTCUSDT'""").fetchall()
    conn.close()
    return decisions, news, fng, funding

def evaluate(params, decisions, news, fng, funding):
    news_at = {}
    for n in news:
        h = n['ts'] // 3600000
        news_at.setdefault(h, []).append(n['sentiment_score'] * n['source_weight'])
    fng_at = {f['ts']//86400000: f['value'] for f in fng}
    fund_at = {f['ts']//3600000: f['funding'] for f in funding}
    
    returns = []
    matches = 0
    for d in decisions:
        h = d['ts']//3600000
        ns = sum(news_at.get(h,[]))/max(1, len(news_at.get(h,[])))
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
    
    if not returns: return {'sortino': 0, 'sharpe': 0, 'match_rate': 0, 'n': 0}
    mean = sum(returns)/len(returns)
    sd = math.sqrt(sum((r-mean)**2 for r in returns)/len(returns)) if len(returns)>1 else 0
    downside = [r for r in returns if r<0]
    dsd = math.sqrt(sum(r*r for r in downside)/len(downside)) if downside else 0
    sharpe = mean/sd*math.sqrt(252*24) if sd>0 else 0
    sortino = mean/dsd*math.sqrt(252*24) if dsd>0 else 0
    return {'sortino': round(sortino,3), 'sharpe': round(sharpe,3), 'match_rate': round(matches/len(decisions),3) if decisions else 0, 'n': len(decisions)}

def main():
    with open('/Users/christianheilig/NEXUS_CLEAN/HYPEROPT_RESULTS.json') as f:
        hopt = json.load(f)
    
    # Definieren 4 Folds aus den letzten 24 Tagen (limited data)
    # Folds basieren auf aladdin_decisions Verfügbarkeit (2026-04-15 bis 2026-05-18)
    # Fold 1: 2026-04-15 → 2026-04-25 train, 2026-04-26 → 2026-04-30 test
    # Fold 2: 2026-04-20 → 2026-05-04 train, 2026-05-05 → 2026-05-09 test
    # Fold 3: 2026-04-25 → 2026-05-09 train, 2026-05-10 → 2026-05-14 test
    # Fold 4: 2026-04-30 → 2026-05-14 train, 2026-05-15 → 2026-05-18 test
    
    folds = [
        ('Fold1', 1745740800, 1746576000, 1746576000, 1746576000+5*86400),
        ('Fold2', 1746172800, 1747008000, 1747008000, 1747008000+5*86400),
        ('Fold3', 1746604800, 1747440000, 1747440000, 1747440000+5*86400),
        ('Fold4', 1747036800, 1747872000, 1747872000, 1747872000+4*86400),
    ]
    
    # Top 3 Parameter-Sets validieren
    results = []
    for rank, t in enumerate(hopt['top5'][:3]):
        print(f"\n═══ Top #{rank+1} Params: {t['params']}")
        fold_results = []
        for name, train_s, train_e, test_s, test_e in folds:
            d_test, n_test, fng_test, fund_test = load_data(test_s*1000, test_e*1000)
            ev = evaluate(t['params'], d_test, n_test, fng_test, fund_test)
            print(f"  {name}: sortino={ev['sortino']}, sharpe={ev['sharpe']}, match={ev['match_rate']*100:.1f}%, n={ev['n']}")
            fold_results.append({'fold': name, **ev})
        # Robustheits-Bewertung
        positive_sortinos = sum(1 for f in fold_results if f['sortino']>0)
        robust = positive_sortinos >= 3
        results.append({'rank': rank+1, 'params': t['params'], 'folds': fold_results, 'positive_folds': positive_sortinos, 'robust': robust})
    
    with open('/Users/christianheilig/NEXUS_CLEAN/WALKFORWARD_RESULTS.json', 'w') as f:
        json.dump(results, f, indent=2)
    print("\nSaved WALKFORWARD_RESULTS.json")

if __name__ == '__main__':
    main()
