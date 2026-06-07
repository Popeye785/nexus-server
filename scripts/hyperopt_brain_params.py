#!/usr/bin/env python3
# Hyperopt-Script — Brain-Parameter-Tuning auf historischen Daten
# AUDFIX_HYPEROPT [2026-05-18]
#
# Verwendet: optuna TPESampler
# Loss: SortinoHyperOptLoss (Downside-Risk-Fokus)
# Daten: news_enriched, fear_greed_history, funding_oi_history, etf_flows, binance_metrics_history, macro_events

import sqlite3
import json
import sys
import optuna
from optuna.samplers import TPESampler
import math
from datetime import datetime, timezone

DB_PATH = '/Users/christianheilig/NEXUS_CLEAN/nexus.db'

# Daten laden (cached)
def load_data():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Brain-Decisions als Ground-Truth (24 Tage)
    decisions = conn.execute("""
        SELECT ts, symbol, decision, confidence FROM aladdin_decisions
        WHERE ts > strftime('%s','2026-04-15')*1000 AND symbol='BTCUSDT'
        ORDER BY ts ASC
    """).fetchall()
    
    # News-Scores
    news = conn.execute("""
        SELECT ts, sentiment_score, source_weight, decayed_weight, is_spam FROM news_enriched
        WHERE is_spam=0
    """).fetchall()
    
    # F&G
    fng = conn.execute("""
        SELECT ts, value FROM fear_greed_history ORDER BY ts DESC LIMIT 90
    """).fetchall()
    
    # Funding
    funding = conn.execute("""
        SELECT ts, symbol, funding FROM funding_oi_history WHERE funding IS NOT NULL
    """).fetchall()
    
    # Macro Events
    macro = conn.execute("""SELECT event_date, title FROM macro_events""").fetchall()
    
    conn.close()
    return decisions, news, fng, funding, macro

# Simuliere Brain-Decisions mit verschiedenen Parametern und berechne Sortino
def simulate_with_params(decisions, news, fng, funding, params):
    # Vereinfacht: für jeden Decision-Zeitpunkt aggregate Score aus News/F&G/Funding mit Parametern
    # Score → simulated trade outcome (Heuristik: BTC-return über 4h nach Decision)
    # Return-Series für Sortino
    
    # News-Score-Aggregation
    news_score_at = {}  # ts → score
    for n in news:
        ts_h = n['ts'] // 3600000  # hour bucket
        if ts_h not in news_score_at:
            news_score_at[ts_h] = []
        news_score_at[ts_h].append(n['sentiment_score'] * n['source_weight'])
    
    # F&G-Score-Aggregation
    fng_at = {f['ts'] // 86400000: f['value'] for f in fng}
    
    # Funding-Score
    funding_at = {}
    for f in funding:
        if f['symbol'] != 'BTCUSDT': continue
        ts_h = f['ts'] // 3600000
        funding_at[ts_h] = f['funding']
    
    # Simulate trades (toy heuristic):
    # if news_score + fng_score + funding_score > threshold → BUY
    # else if < -threshold → SELL
    # else HOLD
    # Returns (synthetic, based on next-decision direction)
    returns = []
    for i, d in enumerate(decisions[:-1]):
        next_d = decisions[i+1]
        # actual: did BTC go up between decisions? (use brain confidence as proxy)
        ts_h = d['ts'] // 3600000
        news_s = sum(news_score_at.get(ts_h, [])) / max(1, len(news_score_at.get(ts_h, [])))
        fng_v = fng_at.get(d['ts'] // 86400000, 50)
        fng_s = (fng_v - 50) / 50  # -1 to 1
        fund_v = funding_at.get(ts_h, 0)
        fund_s = -fund_v * 1000  # high funding → bearish
        
        # Combined score with params
        combined = (
            news_s * params['news_weight'] +
            fng_s * params['fng_weight'] +
            fund_s * params['funding_weight']
        )
        
        threshold = params['threshold']
        if combined > threshold:
            sim_direction = 'BUY'
        elif combined < -threshold:
            sim_direction = 'SELL'
        else:
            sim_direction = 'HOLD'
        
        # Synthetic return: +0.001 if sim_direction matches actual brain decision, else -0.001
        actual = d['decision']
        if sim_direction == actual:
            ret = 0.001 * (d['confidence'] or 0.5)
        elif sim_direction == 'HOLD':
            ret = 0
        else:
            ret = -0.001 * (d['confidence'] or 0.5)
        returns.append(ret)
    
    return returns

def sortino_loss(returns):
    if not returns: return 1.0
    mean = sum(returns) / len(returns)
    if mean <= 0: return 1.0 - mean * 100  # penalty for negative mean
    downside = [r for r in returns if r < 0]
    if not downside: return -mean * 1000  # all positive = good
    downside_std = math.sqrt(sum(r*r for r in downside) / len(downside))
    if downside_std == 0: return -mean * 100
    sortino = mean / downside_std
    return -sortino  # minimize

# Optuna Objective
data_cache = None

def objective(trial):
    global data_cache
    if data_cache is None:
        data_cache = load_data()
    decisions, news, fng, funding, macro = data_cache
    
    params = {
        'news_weight': trial.suggest_float('news_weight', 0.0, 1.0),
        'fng_weight': trial.suggest_float('fng_weight', 0.0, 1.0),
        'funding_weight': trial.suggest_float('funding_weight', 0.0, 1.0),
        'threshold': trial.suggest_float('threshold', 0.05, 0.5),
    }
    returns = simulate_with_params(decisions, news, fng, funding, params)
    return sortino_loss(returns)

def main():
    print("Loading data...")
    decisions, news, fng, funding, macro = load_data()
    global data_cache
    data_cache = (decisions, news, fng, funding, macro)
    print(f"Decisions: {len(decisions)}, News: {len(news)}, F&G: {len(fng)}, Funding: {len(funding)}, Macro: {len(macro)}")
    
    print("\nStarting Optuna TPE hyperopt (300 trials, max 60s)...")
    sampler = TPESampler(seed=42)
    study = optuna.create_study(sampler=sampler, direction='minimize')
    study.optimize(objective, n_trials=300, timeout=60, show_progress_bar=False)
    
    print(f"\nBest trial value: {study.best_value:.6f}")
    print(f"Best params: {study.best_params}")
    
    # Top 5
    trials_sorted = sorted(study.trials, key=lambda t: t.value if t.value else 999)
    print("\nTop 5:")
    top5 = []
    for i, t in enumerate(trials_sorted[:5]):
        print(f"  #{i+1}: value={t.value:.6f} params={t.params}")
        top5.append({'rank': i+1, 'value': t.value, 'params': t.params})
    
    # Save
    out = {
        'best_value': study.best_value,
        'best_params': study.best_params,
        'top5': top5,
        'total_trials': len(study.trials),
    }
    with open('/Users/christianheilig/NEXUS_CLEAN/HYPEROPT_RESULTS.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nSaved HYPEROPT_RESULTS.json")

if __name__ == '__main__':
    main()
