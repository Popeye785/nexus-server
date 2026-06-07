// modules/kelly_criterion.js — Kelly-Criterion + Half-Kelly Position-Sizing
// Verankert 2026-05-26 (Phase 3 Quant-Grade — Tag 14)
//
// Quellen (curl-verifiziert):
//   - Thorp E. "The Mathematics of Gambling" (1984) — Original Kelly-Formulierung
//   - Lopez de Prado M. "Advances in Financial Machine Learning" (2018), Ch. 3
//     → Half-Kelly als robuste Default (Schätzfehler-tolerant + Drawdown-friendlich)
//   - Practical Cap: f_used = min(0.5 * f_kelly, MAX_KELLY_FRACTION)
//
// Kelly-Formel:
//   f* = (p * b - q) / b
//     p = win probability
//     q = 1 - p (loss probability)
//     b = avg_win / avg_loss (positive ratio)
//
// Special Cases:
//   - b <= 0 oder undefined → skip (kein Kelly möglich)
//   - p * b <= q → f* < 0 → skip (negative Edge)
//   - sample size N < 20 → return 1.0 (kein verlässlicher Schätzer, default-multiplier)
//
// API:
//   KellyCriterion.compute({ wins, losses, totalWinUsdt, totalLossUsdt }) → { kelly, halfKelly, used, reason, n }
//   KellyCriterion.fromTrades(trades[]) → ausgewertete Stats + Kelly
//
// Integration:
//   RiskSizing.calculate({ ..., kellyMult }) — multiplier 0..1 angewandt nach allen anderen mults.

'use strict';

const KellyCriterion = {
  MAX_KELLY_FRACTION: 0.40,    // Cap: never bet > 40% of capital (regardless Kelly)
  MIN_SAMPLE_SIZE:    20,      // unter 20 trades: kein Kelly, default 1.0
  DEFAULT_FRACTION:   0.5,     // Half-Kelly (vs Full-Kelly)

  /**
   * Compute Kelly-Fraction aus aggregierten Win/Loss-Stats.
   * @param {Object} stats - { wins, losses, totalWinUsdt, totalLossUsdt }
   * @returns {Object} { kelly, halfKelly, used, reason, n, p, b }
   */
  compute(stats) {
    const wins = Number(stats?.wins || 0);
    const losses = Number(stats?.losses || 0);
    const totalWinUsdt = Math.abs(Number(stats?.totalWinUsdt || 0));
    const totalLossUsdt = Math.abs(Number(stats?.totalLossUsdt || 0));
    const n = wins + losses;

    // Sample size guard
    if (n < this.MIN_SAMPLE_SIZE) {
      return { kelly: null, halfKelly: null, used: 1.0, reason: 'SAMPLE_TOO_SMALL', n, p: null, b: null };
    }

    const p = wins / n;
    const q = 1 - p;
    const avgWin = wins > 0 ? totalWinUsdt / wins : 0;
    const avgLoss = losses > 0 ? totalLossUsdt / losses : 0;

    if (avgLoss <= 0) {
      // Kein Loss → Edge ist unendlich. Defensive: cap auf MAX_KELLY_FRACTION.
      return { kelly: this.MAX_KELLY_FRACTION, halfKelly: this.MAX_KELLY_FRACTION * this.DEFAULT_FRACTION, used: this.MAX_KELLY_FRACTION * this.DEFAULT_FRACTION, reason: 'NO_LOSSES_CAP', n, p, b: Infinity };
    }

    const b = avgWin / avgLoss;
    const kelly = (p * b - q) / b;

    if (kelly <= 0) {
      // Negative Edge → skip trade
      return { kelly, halfKelly: 0, used: 0, reason: 'NEGATIVE_EDGE', n, p, b };
    }

    const halfKelly = kelly * this.DEFAULT_FRACTION;
    const used = Math.min(halfKelly, this.MAX_KELLY_FRACTION);
    return { kelly, halfKelly, used, reason: 'OK', n, p, b };
  },

  /**
   * Compute Kelly aus closed-trade array (für UI/API).
   * @param {Array} trades - [{realized_pnl}, ...]
   * @returns {Object} aggregierte stats + kelly
   */
  fromTrades(trades) {
    let wins = 0, losses = 0, totalWinUsdt = 0, totalLossUsdt = 0;
    for (const t of (trades || [])) {
      const pnl = Number(t?.realized_pnl);
      if (!Number.isFinite(pnl)) continue;
      if (pnl > 0) { wins++; totalWinUsdt += pnl; }
      else if (pnl < 0) { losses++; totalLossUsdt += Math.abs(pnl); }
    }
    return { wins, losses, totalWinUsdt, totalLossUsdt, ...this.compute({ wins, losses, totalWinUsdt, totalLossUsdt }) };
  },

  /**
   * Snapshot für UI/API/debug.
   */
  snapshot(db) {
    if (!db) return { error: 'no db' };
    try {
      const rows = db.prepare("SELECT realized_pnl FROM trades WHERE state='CLOSED' AND realized_pnl IS NOT NULL").all();
      const out = this.fromTrades(rows);
      out.timestamp = Date.now();
      return out;
    } catch(e) {
      return { error: e.message };
    }
  },
};

module.exports = KellyCriterion;
