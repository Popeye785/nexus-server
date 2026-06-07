// modules/cpcv_validation.js
// Combinatorial Purged Cross-Validation (CPCV)
// Quelle: Lopez de Prado "Advances in Financial ML" (2018) Ch.12
//
// Konzept:
//   N Gruppen, k Test-Gruppen → C(N,k) Splits → φ[N,k]=k·C(N,k)/N Backtest-Pfade
//   Purging: entferne Train-Samples deren Label-Horizon mit Test-Range überlappt
//   Embargo: Buffer h nach jedem Test-Block gegen serielle Autokorrelation
//
// Mit dieser Methode bekommt man eine VERTEILUNG von Sharpe-Werten statt single-path.
// Dadurch wird Sample-Bias / Glücks-Sample-Risiko sichtbar.

'use strict';

const CPCV = {
  /**
   * Generiere alle C(N, k) Combinatorial-Splits.
   * @param {number} N - Anzahl Gruppen total
   * @param {number} k - Anzahl Test-Gruppen pro Split
   * @returns {Array<Array<number>>} - Array von Test-Group-Index-Arrays
   */
  combinations(N, k) {
    const result = [];
    const combo = [];
    function recurse(start, depth) {
      if (depth === k) { result.push(combo.slice()); return; }
      for (let i = start; i < N; i++) {
        combo.push(i);
        recurse(i + 1, depth + 1);
        combo.pop();
      }
    }
    recurse(0, 0);
    return result;
  },

  /**
   * Anzahl Backtest-Pfade nach LdP: φ[N,k] = k * C(N,k) / N
   */
  numPaths(N, k) {
    const cnk = this.combinations(N, k).length;
    return (k * cnk) / N;
  },

  /**
   * Splitte Sample in N gleichgroße Gruppen (sortiert nach Timestamp).
   * @param {Array<Object>} samples - Array mit {ts, ...}
   * @param {number} N - Anzahl Gruppen
   * @returns {Array<{start:number,end:number}>} - Index-Ranges pro Gruppe
   */
  splitGroups(samples, N) {
    const sorted = samples.slice().sort((a,b) => a.ts - b.ts);
    const groupSize = Math.floor(sorted.length / N);
    const groups = [];
    for (let i = 0; i < N; i++) {
      const start = i * groupSize;
      const end = (i === N - 1) ? sorted.length : (i + 1) * groupSize;
      groups.push({ start, end });
    }
    return { sorted, groups };
  },

  /**
   * Purge + Embargo: entferne Train-Indices die mit Test-Range überlappen.
   * @param {Array<number>} trainIndices
   * @param {Array<number>} testIndices
   * @param {number} embargoFrac - Embargo as fraction of total (LdP empfiehlt 0.01)
   * @returns {Array<number>} - bereinigte Train-Indices
   */
  applyPurging(trainIndices, testIndices, totalLen, embargoFrac = 0.01) {
    if (!testIndices.length) return trainIndices;
    const testMin = Math.min(...testIndices);
    const testMax = Math.max(...testIndices);
    const embargo = Math.ceil(totalLen * embargoFrac);
    // Purge: train-indices die in Test-Range fallen
    // Embargo: train-indices die nach testMax + embargo liegen, sind erlaubt
    return trainIndices.filter(idx => {
      if (idx >= testMin - embargo && idx <= testMax + embargo) return false;
      return true;
    });
  },

  /**
   * Erzeuge Combinatorial Train/Test-Splits.
   * @param {Array<Object>} samples
   * @param {number} N
   * @param {number} k
   * @param {number} embargoFrac
   * @returns {Array<{train, test, testGroups}>}
   */
  generateSplits(samples, N = 6, k = 2, embargoFrac = 0.01) {
    const { sorted, groups } = this.splitGroups(samples, N);
    const allCombos = this.combinations(N, k);
    const splits = [];
    for (const testGroupIds of allCombos) {
      const testIndices = [];
      const trainIndices = [];
      for (let g = 0; g < N; g++) {
        const range = groups[g];
        for (let i = range.start; i < range.end; i++) {
          if (testGroupIds.includes(g)) testIndices.push(i);
          else trainIndices.push(i);
        }
      }
      const trainPurged = this.applyPurging(trainIndices, testIndices, sorted.length, embargoFrac);
      splits.push({
        testGroups: testGroupIds,
        train: trainPurged.map(i => sorted[i]),
        test: testIndices.map(i => sorted[i]),
      });
    }
    return { splits, sorted, groups };
  },

  /**
   * Run Strategy auf jedem Split, aggregiere Out-of-Sample Returns.
   * @param {Array<Object>} samples
   * @param {Function} strategyFn - (trainSet, testSet) → array of returns
   * @param {Object} opts {N, k, embargoFrac}
   * @returns {Object} - {pathReturns: Array<Array<number>>, splits, meta}
   */
  runCPCV(samples, strategyFn, opts = {}) {
    const N = opts.N || 6;
    const k = opts.k || 2;
    const embargoFrac = opts.embargoFrac || 0.01;
    const { splits, groups } = this.generateSplits(samples, N, k, embargoFrac);
    const splitReturns = [];
    for (const split of splits) {
      try {
        const rets = strategyFn(split.train, split.test);
        splitReturns.push({ testGroups: split.testGroups, returns: rets || [] });
      } catch (e) {
        splitReturns.push({ testGroups: split.testGroups, returns: [], error: e.message });
      }
    }
    // Path-Reconstruction (LdP): jede Test-Group ist in (k * C(N,k) / N) Splits enthalten
    // → für jede Group: avg der returns aus den Splits wo sie test war
    // → Path = Konkatenation der Group-avg-returns in zeitlicher Reihenfolge
    const pathCount = Math.round((k * splits.length) / N);
    const groupReturnsByGroup = new Array(N).fill(null).map(() => []);
    for (const sr of splitReturns) {
      // Verteile testReturns auf Groups
      const groupSize = sr.returns.length / sr.testGroups.length;
      for (let gi = 0; gi < sr.testGroups.length; gi++) {
        const g = sr.testGroups[gi];
        const start = Math.floor(gi * groupSize);
        const end = Math.floor((gi + 1) * groupSize);
        groupReturnsByGroup[g].push(sr.returns.slice(start, end));
      }
    }
    // Per-Group-Pathes: jede Group hat pathCount paths
    const pathReturns = [];
    for (let p = 0; p < pathCount; p++) {
      const path = [];
      for (let g = 0; g < N; g++) {
        const pathsForG = groupReturnsByGroup[g];
        if (pathsForG && pathsForG[p]) path.push(...pathsForG[p]);
      }
      pathReturns.push(path);
    }
    return {
      pathReturns,
      splits: splitReturns,
      meta: { N, k, embargoFrac, splitCount: splits.length, pathCount },
    };
  },
};

module.exports = CPCV;
