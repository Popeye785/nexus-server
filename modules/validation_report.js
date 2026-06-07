// modules/validation_report.js
// Block Q A4 [27.05.2026]: Validation-Reporting für ML-Tab.
// Liefert ein konsolidiertes Snapshot der letzten Walk-Forward-Validation:
//   - pro Config: Sharpe-Phase-Vergleich + CPCV-PBO + DSR + Verdict
//   - Warn-Badges bei extremem Sharpe oder zu wenig Samples
//
// Quelle der Daten: konstanter Block-P-Snapshot (read-only, ohne Re-Run).
// Bei Bedarf neu generieren via scripts/walk_forward_holdout.js.

'use strict';

const ValidationReport = {
  // Letzter Block-P-Snapshot (eingefroren 27.05.2026)
  LAST_SNAPSHOT: {
    generated_at: '2026-05-27T11:01:00Z',
    sample_window: { train: '20.05.-23.05.', validation: '24.05.-25.05.', holdout: '26.05.-27.05.' },
    sample_size: { train: 76645, validation: 42462, holdout: 39513 },
    configs: [
      {
        name: 'NEAR-only-0.10', symbol_scope: 'NEARUSDT',
        train: { trades: 8002, wr: 63.9, sharpe: 20.75, pnl: 65.30 },
        validation: { trades: 2644, sharpe: 37.06, cpcv_sr: 38.94, pbo: 0, dsr: 82.54, prob: 1.0 },
        holdout: { trades: 788, wr: 96.1, sharpe: 133.63, pnl: 28.63 },
        sharpe_corrected: 47.72, // mit n_eff-Korrektur AC lag-1=0.821
        n_effective: 79,         // statt 808
        verdict: 'ROBUST',
        warnings: ['EXTREME_SHARPE_VS_NEFF', 'NEFF_BELOW_100'],
      },
      {
        name: 'NEAR+SUI-0.10', symbol_scope: 'NEARUSDT,SUIUSDT',
        train: { trades: 14529, wr: 66.0, sharpe: 25.99, pnl: 136.50 },
        validation: { trades: 6426, sharpe: 9.14, cpcv_sr: 9.63, pbo: 0, dsr: 123.84, prob: 1.0 },
        holdout: { trades: 2251, wr: 58.9, sharpe: 25.24, pnl: 19.09 },
        verdict: 'ROBUST',
        warnings: [],
      },
      {
        name: 'MID-Class-0.10', symbol_scope: 'NEAR,SUI,XRP,ADA,LINK',
        train: { trades: 14592, wr: 65.9, sharpe: 25.82, pnl: 136.13 },
        validation: { trades: 6459, sharpe: 8.99, cpcv_sr: 9.48, pbo: 0, dsr: 123.49, prob: 1.0 },
        holdout: { trades: 2277, wr: 58.2, sharpe: 24.93, pnl: 18.99 },
        verdict: 'ROBUST',
        warnings: [],
      },
      {
        name: 'D1-WinnerSymbols-0.10', symbol_scope: 'NEAR,ATOM,BTC,ETH',
        train: { trades: 17183, wr: 55.7, sharpe: 11.50, pnl: 58.82 },
        validation: { trades: 7354, sharpe: 7.29, cpcv_sr: 7.85, pbo: 0, dsr: 94.53, prob: 1.0 },
        holdout: { trades: 2207, wr: 40.0, sharpe: 15.87, pnl: 12.03 },
        verdict: 'ROBUST',
        warnings: [],
      },
      {
        name: 'SUI-only-0.10', symbol_scope: 'SUIUSDT',
        train: { trades: 6527, wr: 68.6, sharpe: 34.38, pnl: 71.24 },
        validation: { trades: 3782, sharpe: -28.34, cpcv_sr: -28.71, pbo: 1, dsr: -115.73, prob: 0 },
        holdout: null,
        verdict: 'OVERFIT_IN_VAL',
        warnings: ['SAMPLE_DEPENDENT_EDGE', 'BLOCKED_BY_PAIR_GUARD'],
      },
      {
        name: 'A0-Baseline-0.20', symbol_scope: 'ALL',
        train: { trades: 164, wr: 61.0, sharpe: 38.47, pnl: 1.82 },
        validation: { trades: 110, sharpe: -52.18, cpcv_sr: -56.31, pbo: 1, dsr: -7.77, prob: 0 },
        holdout: null,
        verdict: 'OVERFIT_IN_VAL',
        warnings: ['LOW_TRADE_COUNT'],
      },
      {
        name: 'MEGA-Class-0.10', symbol_scope: 'BTC,ETH,SOL,BNB',
        train: { trades: 16457, wr: 48.1, sharpe: -5.22, pnl: -13.74 },
        validation: { trades: 8469, sharpe: -50.35, cpcv_sr: -49.86, pbo: 1, dsr: -148.49, prob: 0 },
        holdout: null,
        verdict: 'ANTI_EDGE_CONFIRMED',
        warnings: ['CONSISTENT_NEGATIVE_ACROSS_WINDOWS'],
      },
      {
        name: 'BTC-only-0.10', symbol_scope: 'BTCUSDT',
        train: { trades: 3990, wr: 49.8, sharpe: -17.17, pnl: -7.32 },
        validation: { trades: 2218, sharpe: -93.04, cpcv_sr: -96.51, pbo: 1, dsr: -62.95, prob: 0 },
        holdout: null,
        verdict: 'ANTI_EDGE_CONFIRMED',
        warnings: ['CONSISTENT_NEGATIVE_ACROSS_WINDOWS'],
      },
    ],
  },

  /**
   * Holt aktuelles Snapshot + computes display-flags.
   */
  getSnapshot() {
    const snap = JSON.parse(JSON.stringify(this.LAST_SNAPSHOT));
    // Add display-flags pro Config
    for (const cfg of snap.configs) {
      cfg.color = cfg.verdict === 'ROBUST' ? 'green'
                : cfg.verdict === 'OVERFIT_IN_VAL' ? 'yellow'
                : cfg.verdict === 'ANTI_EDGE_CONFIRMED' ? 'red'
                : 'grey';
      cfg.holdout_ratio = (cfg.holdout && cfg.validation && cfg.validation.sharpe > 0)
        ? Number((cfg.holdout.sharpe / cfg.validation.sharpe).toFixed(2)) : null;
    }
    snap.summary = {
      total_configs: snap.configs.length,
      robust: snap.configs.filter(c => c.verdict === 'ROBUST').length,
      overfit_or_anti: snap.configs.filter(c => c.verdict !== 'ROBUST').length,
      warnings_total: snap.configs.reduce((s,c) => s + (c.warnings || []).length, 0),
    };
    return snap;
  },
};

module.exports = ValidationReport;
