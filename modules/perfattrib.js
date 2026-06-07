// modules/perfattrib.js — TIER2-C Performance-Attribution
// Sharpe / Sortino / Calmar / WinRate / Profit-Factor pro Strategy, Symbol, Regime, Hour-of-Day.
// PLUS: AladdinBrain-Veto-Value (avg PnL pro vetoed signal — hypothetisch vermiedener Verlust).
// READ-ONLY: liest aus DB, KEINE Writes.

'use strict';

let _Database; // injected

function getDB() {
  if (_Database) return _Database;
  throw new Error('DB not injected — call init(dbModule)');
}
function init(db) { _Database = db; }

// Helper: compute metrics from a list of pnl-values
function computeMetrics(pnls) {
  const n = pnls.length;
  if (n === 0) return { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0,
                       sharpe: null, sortino: null, calmar: null, profitFactor: null, maxDD: 0 };
  let wins = 0, losses = 0, sumPnl = 0;
  let grossWin = 0, grossLoss = 0;
  for (const p of pnls) {
    sumPnl += p;
    if (p > 0) { wins++; grossWin += p; }
    else if (p < 0) { losses++; grossLoss += Math.abs(p); }
  }
  const avgPnl = sumPnl / n;
  const variance = pnls.reduce((a, p) => a + (p - avgPnl) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const downside = pnls.filter(p => p < 0);
  const downsideStd = downside.length
    ? Math.sqrt(downside.reduce((a, p) => a + p ** 2, 0) / downside.length)
    : 0;
  // Sharpe annualisiert (assuming trade frequency = 252/year)
  const sharpe = std > 0 ? (avgPnl / std) * Math.sqrt(252) : null;
  const sortino = downsideStd > 0 ? (avgPnl / downsideStd) * Math.sqrt(252) : null;
  // Equity curve for maxDD
  let equity = 0, peak = 0, maxDD = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  const calmar = maxDD > 0 ? (sumPnl / maxDD) : null;
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? Infinity : null);

  return {
    trades: n, wins, losses,
    winRate: +(wins / n * 100).toFixed(2),
    totalPnl: +sumPnl.toFixed(4),
    avgPnl: +avgPnl.toFixed(4),
    sharpe: sharpe !== null ? +sharpe.toFixed(4) : null,
    sortino: sortino !== null ? +sortino.toFixed(4) : null,
    calmar: calmar !== null ? +calmar.toFixed(4) : null,
    profitFactor: profitFactor !== null && profitFactor !== Infinity ? +profitFactor.toFixed(4)
                  : (profitFactor === Infinity ? 'inf' : null),
    maxDD: +maxDD.toFixed(4),
  };
}

function perStrategy(opts) {
  opts = opts || {};
  const sinceMs = opts.sinceMs || 0;
  const db = getDB();
  const rows = db.prepare(`
    SELECT COALESCE(strategy,'UNKNOWN') as strategy, realized_pnl
    FROM trades
    WHERE state='CLOSED' AND realized_pnl IS NOT NULL AND closed_at >= ?
  `).all(sinceMs);
  const groups = {};
  for (const r of rows) {
    const key = r.strategy;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r.realized_pnl);
  }
  const out = {};
  for (const [k, pnls] of Object.entries(groups)) {
    out[k] = computeMetrics(pnls);
  }
  return out;
}

function perSymbol(opts) {
  opts = opts || {};
  const sinceMs = opts.sinceMs || 0;
  const db = getDB();
  const rows = db.prepare(`
    SELECT symbol, realized_pnl
    FROM trades WHERE state='CLOSED' AND realized_pnl IS NOT NULL AND closed_at >= ?
  `).all(sinceMs);
  const groups = {};
  for (const r of rows) {
    if (!groups[r.symbol]) groups[r.symbol] = [];
    groups[r.symbol].push(r.realized_pnl);
  }
  const out = {};
  for (const [k, pnls] of Object.entries(groups)) {
    out[k] = computeMetrics(pnls);
  }
  return out;
}

function perRegime(opts) {
  opts = opts || {};
  const sinceMs = opts.sinceMs || 0;
  const db = getDB();
  const rows = db.prepare(`
    SELECT COALESCE(entry_regime_class,'UNKNOWN') as regime, realized_pnl
    FROM trades WHERE state='CLOSED' AND realized_pnl IS NOT NULL AND closed_at >= ?
  `).all(sinceMs);
  const groups = {};
  for (const r of rows) {
    if (!groups[r.regime]) groups[r.regime] = [];
    groups[r.regime].push(r.realized_pnl);
  }
  const out = {};
  for (const [k, pnls] of Object.entries(groups)) {
    out[k] = computeMetrics(pnls);
  }
  return out;
}

function perHourOfDay(opts) {
  opts = opts || {};
  const sinceMs = opts.sinceMs || 0;
  const db = getDB();
  const rows = db.prepare(`
    SELECT created_at, realized_pnl
    FROM trades WHERE state='CLOSED' AND realized_pnl IS NOT NULL AND closed_at >= ?
  `).all(sinceMs);
  const groups = {};
  for (let h = 0; h < 24; h++) groups[String(h).padStart(2, '0')] = [];
  for (const r of rows) {
    const h = new Date(r.created_at).getUTCHours();
    groups[String(h).padStart(2, '0')].push(r.realized_pnl);
  }
  const out = {};
  for (const [k, pnls] of Object.entries(groups)) {
    out[k] = computeMetrics(pnls);
  }
  return out;
}

// AladdinBrain-Veto-Value: für jede vetoed Decision würde sich eine Position öffnen,
// schätze hypothetisch was passiert wäre (Heuristik: avg real-PnL aller ähnlichen Setups).
function aladdinVetoValue(opts) {
  opts = opts || {};
  const sinceMs = opts.sinceMs || (Date.now() - 7 * 86400000); // letzte 7 Tage default
  const db = getDB();
  const vetoedRows = db.prepare(`
    SELECT decision, regime, vetos FROM aladdin_decisions
    WHERE ts >= ? AND vetos != '[]' AND vetos IS NOT NULL
  `).all(sinceMs);
  // Avg PnL of realized trades in same window — used as proxy for "what would have happened"
  const realized = db.prepare(`
    SELECT realized_pnl FROM trades
    WHERE state='CLOSED' AND realized_pnl IS NOT NULL AND closed_at >= ?
  `).all(sinceMs);
  const avgRealizedPnl = realized.length
    ? realized.reduce((a, r) => a + r.realized_pnl, 0) / realized.length
    : 0;
  // Decompose vetos by type (top-N)
  const vetoTypes = {};
  for (const v of vetoedRows) {
    let parsed;
    try { parsed = JSON.parse(v.vetos || '[]'); } catch(_) { parsed = []; }
    for (const veto of parsed) {
      const type = String(veto).split(':')[0] || 'OTHER';
      vetoTypes[type] = (vetoTypes[type] || 0) + 1;
    }
  }
  return {
    sinceMs,
    totalVetos: vetoedRows.length,
    avgRealizedPnlBaseline: +avgRealizedPnl.toFixed(4),
    hypotheticalLossAvoided: +(vetoedRows.length * Math.abs(Math.min(0, avgRealizedPnl))).toFixed(2),
    vetoTypeDistribution: vetoTypes,
    note: 'Heuristic: assumes each veto would have lost avg(realized_pnl<0). Real impact requires counterfactual backtest.',
  };
}

function full(opts) {
  return {
    ts: Date.now(),
    sinceMs: (opts && opts.sinceMs) || 0,
    strategies: perStrategy(opts),
    symbols: perSymbol(opts),
    regimes: perRegime(opts),
    hourOfDay: perHourOfDay(opts),
    aladdinVetoValue: aladdinVetoValue(opts),
  };
}

module.exports = { init, perStrategy, perSymbol, perRegime, perHourOfDay, aladdinVetoValue, full, computeMetrics };
