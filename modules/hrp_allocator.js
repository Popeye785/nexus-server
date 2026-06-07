// modules/hrp_allocator.js — Hierarchical Risk Parity (López de Prado 2016)
// Verankert 2026-05-20 (STUFE 6 — Boutique-Quant-A).
//
// HRP-Algorithmus (3 Phasen):
//   1. TREE CLUSTERING: hierarchisches single-linkage Clustering auf Correlation-Distance-Matrix
//   2. QUASI-DIAGONALISATION: reorder Symbols so dass ähnliche assets nebeneinander stehen
//   3. RECURSIVE BISECTION: top-down allocation, jede Aufspaltung gewichtet nach inverse-variance
//
// Vorteile gegenüber Markowitz/Mean-Variance:
//   - Keine Inversion der Covariance-Matrix nötig (robust bei singulärem Cov)
//   - Concentration-Risk strukturell vermieden
//   - Diversifiziert auch bei korrelierten Assets
//
// SHADOW-MODE default (Compute + Log, kein Capital-Eingriff).
// PRODUCTIVE-Mode: über `HRP_PRODUCTIVE=true` ENV-Flag wenn 20+ closed-trades pro symbol.

'use strict';

const HRP_DEFAULTS = {
  MIN_TRADES_PER_SYMBOL: 5,
  LOOKBACK_DAYS: 30,
  MIN_ALLOC_PCT: 0.02,
  MAX_ALLOC_PCT: 0.40,
  RECOMPUTE_INTERVAL_MS: 6 * 3600 * 1000,
};

const HRPAllocator = {
  _db: null,
  _logFn: null,
  _cronTimer: null,
  _opts: { ...HRP_DEFAULTS },
  _stats: { compute_runs: 0, last_compute_ts: 0, last_mode: 'SHADOW', last_allocation: null },
  _productiveFlag: false,

  init(db, opts = {}) {
    this._db = db;
    this._opts = { ...HRP_DEFAULTS, ...opts };
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hrp_allocations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          mode TEXT NOT NULL,
          symbols_json TEXT,
          allocation_json TEXT NOT NULL,
          correlation_json TEXT,
          variances_json TEXT,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_hrp_ts ON hrp_allocations(ts);
      `);
      try { this._logFn.info && this._logFn.info('HRP', 'initialized (SHADOW default, lookback=30d)'); } catch(_) {}
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('HRP', 'init fail: ' + e.message); } catch(_) {}
    }
  },

  setProductive(v) { this._productiveFlag = !!v; },

  // ─── Correlation/Variance/Returns aus closed-trades ──────────────
  _gatherReturns() {
    if (!this._db) return null;
    const now = Date.now();
    const since = now - this._opts.LOOKBACK_DAYS * 86400000;
    let rows = [];
    try {
      rows = this._db.prepare(`
        SELECT symbol, pnl, opened_at, closed_at
        FROM trades
        WHERE state='CLOSED' AND closed_at IS NOT NULL AND closed_at > ?
      `).all(since);
    } catch(_) { return null; }
    const bySymbol = {};
    for (const t of rows) {
      const ret = (typeof t.pnl === 'number') ? t.pnl : 0;
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
      bySymbol[t.symbol].push(ret);
    }
    // Filter Symbole mit min Trades
    const validSyms = Object.keys(bySymbol).filter(s => bySymbol[s].length >= this._opts.MIN_TRADES_PER_SYMBOL);
    if (validSyms.length < 2) return null;  // HRP braucht mind 2 Symbole
    const out = {};
    for (const s of validSyms) out[s] = bySymbol[s];
    return out;
  },

  _mean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0) / arr.length : 0; },

  _variance(arr) {
    if (arr.length < 2) return 0;
    const m = this._mean(arr);
    return arr.reduce((s,v) => s + (v-m)**2, 0) / arr.length;
  },

  _covariance(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return 0;
    const ma = this._mean(a.slice(0,n)), mb = this._mean(b.slice(0,n));
    let cov = 0;
    for (let i = 0; i < n; i++) cov += (a[i] - ma) * (b[i] - mb);
    return cov / n;
  },

  _correlation(a, b) {
    const va = Math.sqrt(this._variance(a)), vb = Math.sqrt(this._variance(b));
    if (va === 0 || vb === 0) return 0;
    return this._covariance(a, b) / (va * vb);
  },

  _buildCorrMatrix(returnsMap) {
    const symbols = Object.keys(returnsMap);
    const n = symbols.length;
    const matrix = {};
    for (const s of symbols) matrix[s] = {};
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) matrix[symbols[i]][symbols[j]] = 1.0;
        else if (i < j) {
          const c = this._correlation(returnsMap[symbols[i]], returnsMap[symbols[j]]);
          matrix[symbols[i]][symbols[j]] = c;
          matrix[symbols[j]][symbols[i]] = c;
        }
      }
    }
    return { symbols, matrix };
  },

  // ─── HRP Phase 1: Single-Linkage Clustering auf Distance-Matrix ──
  // distance(i,j) = sqrt(0.5 * (1 - corr(i,j)))
  _hierarchicalCluster(symbols, corrMatrix) {
    // Build initial distance matrix
    const dist = {};
    for (const s of symbols) dist[s] = {};
    for (let i = 0; i < symbols.length; i++) {
      for (let j = 0; j < symbols.length; j++) {
        const c = corrMatrix[symbols[i]][symbols[j]];
        dist[symbols[i]][symbols[j]] = Math.sqrt(Math.max(0, 0.5 * (1 - c)));
      }
    }

    // Single-Linkage: iterativ Cluster mergen
    let clusters = symbols.map(s => [s]);
    const mergeOrder = [];

    while (clusters.length > 1) {
      let bestI = 0, bestJ = 1, bestD = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          // single linkage = MIN distance between any pair from cluster_i and cluster_j
          let d = Infinity;
          for (const a of clusters[i]) {
            for (const b of clusters[j]) {
              if (dist[a][b] < d) d = dist[a][b];
            }
          }
          if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
        }
      }
      const merged = clusters[bestI].concat(clusters[bestJ]);
      mergeOrder.push({ items: merged.slice(), distance: bestD });
      const remaining = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ);
      clusters = [...remaining, merged];
    }
    return { mergeOrder, finalOrder: clusters[0] };
  },

  // ─── HRP Phase 2: Quasi-Diagonalisation (Order from clustering tree) ──
  _quasiDiag(clusterResult) {
    return clusterResult.finalOrder;
  },

  // ─── HRP Phase 3: Recursive Bisection ──────────────────────────────
  _recursiveBisection(symbols, variances) {
    // Initial: 1.0 weight on full set
    const weights = {};
    for (const s of symbols) weights[s] = 1.0;

    // Stack-basierte Bisektion
    const stack = [symbols.slice()];
    while (stack.length > 0) {
      const cluster = stack.pop();
      if (cluster.length < 2) continue;
      const half = Math.floor(cluster.length / 2);
      const left = cluster.slice(0, half);
      const right = cluster.slice(half);
      // Inverse-Variance-Weighting für jedes Sub-Cluster
      const varLeft  = this._clusterVariance(left, variances);
      const varRight = this._clusterVariance(right, variances);
      const sumInv = (1/varLeft) + (1/varRight);
      const alpha = (1/varLeft) / sumInv;  // left-weight
      for (const s of left)  weights[s] *= alpha;
      for (const s of right) weights[s] *= (1 - alpha);
      stack.push(left);
      stack.push(right);
    }
    return weights;
  },

  _clusterVariance(symbols, variances) {
    // Inverse-Variance-Portfolio innerhalb des Clusters: w_i = (1/var_i) / sum(1/var_j)
    if (symbols.length === 0) return 1e-9;
    let invSum = 0;
    for (const s of symbols) invSum += 1 / Math.max(variances[s] || 1, 1e-9);
    if (invSum === 0) return 1e-9;
    let portfolioVar = 0;
    for (const s of symbols) {
      const w = (1 / Math.max(variances[s] || 1, 1e-9)) / invSum;
      portfolioVar += w * w * (variances[s] || 1);
    }
    return Math.max(portfolioVar, 1e-9);
  },

  // ─── Public: Compute & Persist ───────────────────────────────────
  recompute() {
    if (!this._db) return null;
    const returnsMap = this._gatherReturns();
    if (!returnsMap) {
      const fallback = {
        mode: 'SHADOW', reason: 'insufficient_trade_history',
        allocation: null, symbols: [], productive_flag: this._productiveFlag,
      };
      this._persist(fallback);
      return fallback;
    }

    const { symbols, matrix } = this._buildCorrMatrix(returnsMap);
    const variances = {};
    for (const s of symbols) variances[s] = this._variance(returnsMap[s]);

    const clusterRes = this._hierarchicalCluster(symbols, matrix);
    const ordered = this._quasiDiag(clusterRes);
    let weights = this._recursiveBisection(ordered, variances);

    // Normalize + Constraint
    let sum = 0;
    for (const s of ordered) sum += weights[s];
    if (sum > 0) for (const s of ordered) weights[s] /= sum;

    // Bandbreite anwenden (iterativ)
    for (let iter = 0; iter < 8; iter++) {
      let changed = false;
      for (const s of ordered) {
        if (weights[s] < this._opts.MIN_ALLOC_PCT) { weights[s] = this._opts.MIN_ALLOC_PCT; changed = true; }
        if (weights[s] > this._opts.MAX_ALLOC_PCT) { weights[s] = this._opts.MAX_ALLOC_PCT; changed = true; }
      }
      const newSum = ordered.reduce((a, s) => a + weights[s], 0);
      if (Math.abs(newSum - 1.0) > 0.001) for (const s of ordered) weights[s] /= newSum;
      if (!changed) break;
    }

    // Mode-Decision
    const productive = this._productiveFlag && symbols.length >= 3;
    const mode = productive ? 'PRODUCTIVE' : 'SHADOW';

    // For SHADOW: persist computed weights, but applied=0
    const result = {
      mode,
      reason: productive ? 'hrp_computed' : 'shadow_default',
      symbols: ordered,
      allocation: weights,
      correlation_matrix: matrix,
      variances,
      productive_flag: this._productiveFlag,
      trades_used: Object.values(returnsMap).reduce((s, arr) => s + arr.length, 0),
    };
    this._persist(result);
    this._stats.compute_runs++;
    this._stats.last_compute_ts = Date.now();
    this._stats.last_mode = mode;
    this._stats.last_allocation = weights;
    try { this._logFn.info && this._logFn.info('HRP',
      `recompute mode=${mode} symbols=${symbols.length} trades=${result.trades_used} weights=${JSON.stringify(weights)}`); } catch(_) {}
    return result;
  },

  _persist(result) {
    if (!this._db) return;
    try {
      this._db.prepare(`INSERT INTO hrp_allocations (ts, mode, symbols_json, allocation_json, correlation_json, variances_json, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        Date.now(), result.mode,
        JSON.stringify(result.symbols || []),
        JSON.stringify(result.allocation || {}),
        result.correlation_matrix ? JSON.stringify(result.correlation_matrix).slice(0, 4000) : null,
        result.variances ? JSON.stringify(result.variances).slice(0, 1000) : null,
        JSON.stringify({ reason: result.reason, productive_flag: result.productive_flag, trades_used: result.trades_used }).slice(0, 500)
      );
    } catch(_) {}
  },

  getAllocation() { return this._stats.last_allocation ? { ...this._stats.last_allocation } : null; },

  startCron() {
    if (this._cronTimer) return;
    setTimeout(() => this.recompute(), 50000);
    this._cronTimer = setInterval(() => this.recompute(), this._opts.RECOMPUTE_INTERVAL_MS);
  },

  snapshot() {
    return { ...this._stats, productive_flag: this._productiveFlag, options: this._opts };
  },
};

module.exports = HRPAllocator;
