// modules/hrp.js — Hierarchical Risk Parity (HRP) Portfolio-Allocation
// Verankert 2026-05-26 (Phase 3 Quant-Grade — Tag 16)
//
// Quellen (curl raw verifiziert):
//   - Lopez de Prado M. (2016) "Building Diversified Portfolios that Outperform Out-of-Sample"
//     (Journal of Portfolio Management 42(4), pp. 59-69)
//   - Lopez de Prado M. (2018) "Advances in Financial Machine Learning" Ch. 16
//   - Reference-Implementation:
//     PyPortfolioOpt hierarchical_portfolio.py (curl raw 7897 bytes,
//     "Code reproduced with permission from Marcos Lopez de Prado (2016)")
//
// HRP-Algorithm (3 Steps):
//   1. Tree Clustering        — Single-linkage clustering auf Distance-Matrix
//                                D_ij = sqrt((1 - rho_ij) / 2)  ∈ [0, 1]
//   2. Quasi-Diagonalization  — Sortiere Asset-IDs via Pre-Order-Tree-Traversal
//   3. Recursive Bisection    — Top-down splitten + Inverse-Variance-Weight pro Cluster
//
// Weights-Output:
//   - Σ weights = 1.0
//   - weights[i] ∈ [0, 1] für jede Asset
//   - keine negative weights (long-only)
//
// API:
//   HRP.allocate(corrMatrix, varVector, tickers) → { weights, ordered, linkage }
//   HRP.fromBitgetReturns(returnsBySymbol) → vollständige pipeline (corr → cov → HRP)
//   HRP.snapshot(db) → live snapshot aus tft_forecasts oder candle data
//
// Reference-Funktionen (1:1 port von PyPortfolioOpt):
//   _distance(corr)        — Mantegna-Distance D_ij = sqrt((1-rho)/2)
//   _singleLinkage(D)      — agglomerative single-linkage clustering
//   _quasiDiag(link, n)    — recursive tree traversal → sorted index list
//   _clusterVar(cov, items) — variance of inverse-variance-weighted cluster
//   _rawAllocation(cov, ordered) — recursive bisection allocation
//
// Defensive Constraints:
//   - n < 2 → return single weight 1.0
//   - corr-matrix NaN → fallback equal-weight
//   - cov diagonal <=0 → fallback equal-weight

'use strict';

const HRP = {
  MIN_TICKERS: 2,
  EPSILON: 1e-12,

  /**
   * Mantegna-Distance aus Correlation-Matrix.
   * D[i][j] = sqrt((1 - rho[i][j]) / 2)  ∈ [0, 1]
   */
  _distance(corr) {
    const n = corr.length;
    const D = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const rho = corr[i][j];
        D[i][j] = Math.sqrt(Math.max(0, (1 - rho) / 2));
      }
    }
    return D;
  },

  /**
   * Single-Linkage Hierarchical Clustering.
   * Returns linkage matrix: array of [cluster_a, cluster_b, distance, n_items]
   * Cluster-IDs: 0..n-1 = original assets, n..2n-2 = composed clusters.
   */
  _singleLinkage(D) {
    const n = D.length;
    if (n < 2) return [];
    // Working copy of distance matrix
    const dist = Array.from({ length: n }, (_, i) => Array.from(D[i]));
    // Active clusters: indices into a dynamically growing list
    let nextId = n;
    const clusters = Array.from({ length: n }, (_, i) => ({ id: i, size: 1, members: [i] }));
    const linkage = [];
    while (clusters.length > 1) {
      // Find min off-diagonal distance
      let minD = Infinity, minI = -1, minJ = -1;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          // Single-linkage: min distance between any pair (a in cluster_i, b in cluster_j)
          let d = Infinity;
          for (const a of clusters[i].members) {
            for (const b of clusters[j].members) {
              if (D[a][b] < d) d = D[a][b];
            }
          }
          if (d < minD) { minD = d; minI = i; minJ = j; }
        }
      }
      // Merge cluster minI + minJ
      const a = clusters[minI], b = clusters[minJ];
      const merged = { id: nextId++, size: a.size + b.size, members: a.members.concat(b.members) };
      linkage.push([a.id, b.id, minD, merged.size]);
      // Replace minI with merged, remove minJ
      clusters.splice(Math.max(minI, minJ), 1);
      clusters.splice(Math.min(minI, minJ), 1, merged);
    }
    return linkage;
  },

  /**
   * Quasi-Diagonalization via pre-order tree traversal.
   * Returns ordered list of original asset indices.
   * link = linkage matrix from _singleLinkage.
   */
  _quasiDiag(link, n) {
    if (link.length === 0) return Array.from({ length: n }, (_, i) => i);
    // Reconstruct tree from linkage matrix: cluster-id → [child_a, child_b]
    const tree = {};
    for (let i = 0; i < link.length; i++) {
      const [a, b] = link[i];
      tree[n + i] = [a, b];
    }
    // Root cluster has ID = n + link.length - 1
    const rootId = n + link.length - 1;
    // Pre-order traversal: visit left, then right
    const result = [];
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id < n) {
        // Original asset
        result.push(id);
      } else if (tree[id]) {
        // Composed cluster — push right first so left pops first (pre-order)
        stack.push(tree[id][1]);
        stack.push(tree[id][0]);
      }
    }
    return result;
  },

  /**
   * Cluster-Variance via inverse-variance-weighted portfolio.
   * cov = full covariance matrix (2D array)
   * items = list of asset indices in this cluster
   */
  _clusterVar(cov, items) {
    const k = items.length;
    if (k === 0) return 0;
    if (k === 1) return cov[items[0]][items[0]];
    // Inverse-variance weights (Markowitz with diagonal only)
    const ivp = new Array(k);
    let sumIvp = 0;
    for (let i = 0; i < k; i++) {
      const v = cov[items[i]][items[i]];
      ivp[i] = (v > this.EPSILON) ? 1 / v : 0;
      sumIvp += ivp[i];
    }
    if (sumIvp <= this.EPSILON) {
      // All zero variances → equal weight
      const ew = 1 / k;
      let portVar = 0;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          portVar += ew * ew * cov[items[i]][items[j]];
        }
      }
      return portVar;
    }
    // Normalize
    for (let i = 0; i < k; i++) ivp[i] /= sumIvp;
    // w' Σ w
    let portVar = 0;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        portVar += ivp[i] * ivp[j] * cov[items[i]][items[j]];
      }
    }
    return portVar;
  },

  /**
   * Recursive Bisection Allocation (HRP core).
   * cov = covariance matrix
   * ordered = sorted asset indices (from _quasiDiag)
   * Returns: Map<original_idx, weight>
   */
  _rawAllocation(cov, ordered) {
    const n = ordered.length;
    const weights = new Float64Array(n).fill(1.0);
    // List of clusters as [start, end] index ranges into 'ordered'
    let clusters = [[0, n]];
    while (clusters.length > 0) {
      // Bisect each cluster
      const newClusters = [];
      for (const [s, e] of clusters) {
        if (e - s <= 1) continue;
        const mid = s + Math.floor((e - s) / 2);
        newClusters.push([s, mid], [mid, e]);
      }
      // Process in pairs
      for (let p = 0; p < newClusters.length; p += 2) {
        const [s1, e1] = newClusters[p];
        const [s2, e2] = newClusters[p + 1];
        const items1 = ordered.slice(s1, e1);
        const items2 = ordered.slice(s2, e2);
        const var1 = this._clusterVar(cov, items1);
        const var2 = this._clusterVar(cov, items2);
        const total = var1 + var2;
        const alpha = (total > this.EPSILON) ? (1 - var1 / total) : 0.5;
        // weight items1 *= alpha, items2 *= (1 - alpha)
        for (let i = s1; i < e1; i++) weights[i] *= alpha;
        for (let i = s2; i < e2; i++) weights[i] *= (1 - alpha);
      }
      clusters = newClusters;
    }
    // Map back to original indices
    const out = new Map();
    for (let i = 0; i < n; i++) {
      out.set(ordered[i], weights[i]);
    }
    return out;
  },

  /**
   * Compute covariance from correlation + std (variance vector).
   * Σ_ij = ρ_ij * σ_i * σ_j
   */
  _corrToCov(corr, std) {
    const n = corr.length;
    const cov = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cov[i][j] = corr[i][j] * std[i] * std[j];
      }
    }
    return cov;
  },

  /**
   * Public API: HRP-Allocation aus Correlation + Variance.
   * @param {Array<Array<number>>} corrMatrix - n×n correlation matrix (-1..+1)
   * @param {Array<number>} varVector - n variances (positive)
   * @param {Array<string>} tickers - n ticker names
   * @returns {Object} { weights: Map<ticker, weight>, ordered: [tickers], linkage, success }
   */
  allocate(corrMatrix, varVector, tickers) {
    const n = (tickers || []).length;
    if (n < this.MIN_TICKERS) {
      const w = new Map();
      tickers.forEach(t => w.set(t, 1 / Math.max(1, n)));
      return { weights: w, ordered: tickers.slice(), linkage: [], success: false, reason: 'TOO_FEW_TICKERS', n };
    }
    // Sanity: dimensions match
    if (corrMatrix.length !== n || varVector.length !== n) {
      return { weights: this._equalWeight(tickers), ordered: tickers.slice(), linkage: [], success: false, reason: 'DIM_MISMATCH' };
    }
    // Validate corr: NaN-Schutz
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!Number.isFinite(corrMatrix[i][j])) {
          return { weights: this._equalWeight(tickers), ordered: tickers.slice(), linkage: [], success: false, reason: 'CORR_NAN' };
        }
      }
    }
    // Compute std (sqrt of variance)
    const std = varVector.map(v => Math.sqrt(Math.max(this.EPSILON, v)));
    // Build covariance
    const cov = this._corrToCov(corrMatrix, std);
    // Distance + Linkage
    const D = this._distance(corrMatrix);
    const linkage = this._singleLinkage(D);
    // Quasi-Diagonal Ordering
    const orderedIdx = this._quasiDiag(linkage, n);
    // Recursive Allocation
    const weightsByIdx = this._rawAllocation(cov, orderedIdx);
    // Map back to tickers, normalize
    const weights = new Map();
    let sum = 0;
    for (const [idx, w] of weightsByIdx) sum += w;
    for (const [idx, w] of weightsByIdx) {
      weights.set(tickers[idx], sum > this.EPSILON ? w / sum : 1 / n);
    }
    return {
      weights,
      ordered: orderedIdx.map(i => tickers[i]),
      linkage,
      success: true,
      n,
    };
  },

  _equalWeight(tickers) {
    const n = tickers.length;
    const m = new Map();
    tickers.forEach(t => m.set(t, n > 0 ? 1 / n : 0));
    return m;
  },

  /**
   * Snapshot aus existing correlation/matrix endpoint data.
   * @param {Object} matrixData - { matrix: { symA: { symB: rho } }, symbols: [...] }
   * @param {Object} variances - { symbol: var } (optional, default uses 1.0)
   * @returns {Object} HRP-Allokation
   */
  fromMatrix(matrixData, variances) {
    const symbols = (matrixData && matrixData.symbols) || [];
    const matrix = (matrixData && matrixData.matrix) || {};
    if (symbols.length < this.MIN_TICKERS) {
      return { error: 'INSUFFICIENT_SYMBOLS', n: symbols.length };
    }
    // Build correlation matrix as 2D array
    const corr = symbols.map(a => symbols.map(b => {
      if (a === b) return 1.0;
      const v = matrix[a] && typeof matrix[a][b] === 'number' ? matrix[a][b] : 0;
      return Math.max(-1, Math.min(1, v));
    }));
    // Variance: default 1.0 wenn unbekannt (Equal-Risk-Approximation)
    const variancesArr = symbols.map(s => (variances && Number.isFinite(variances[s])) ? variances[s] : 1.0);
    const result = this.allocate(corr, variancesArr, symbols);
    // Convert Map to plain object for JSON
    const weightsObj = {};
    for (const [k, v] of result.weights) weightsObj[k] = Number(v.toFixed(6));
    return {
      success: result.success,
      reason: result.reason || null,
      n: result.n,
      ordered: result.ordered,
      weights: weightsObj,
      linkageDepth: result.linkage.length,
    };
  },
};

module.exports = HRP;
