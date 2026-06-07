// modules/ml_imbalance_smote.js — SMOTE/Upsampling für ML-Class-Balance
// Verankert 2026-05-26 (PRIO 3 — Final-Push)
//
// Quelle:
//   Chawla N.V. et al. (2002) "SMOTE: Synthetic Minority Over-sampling Technique"
//   Journal of Artificial Intelligence Research 16
//
// Problem in NEXUS:
//   trades-Tabelle hat 3-4 closed SINGLE-trades, alle side='BUY' (LONG-only since Day-Zero).
//   ML-Ensemble würde nur LONG-Patterns lernen → bei BEAR-Markt blind.
//
// SMOTE-Konzept (simplified):
//   Für jede Minority-class-Instance:
//     - Wähle k-nearest-neighbors in Feature-Space
//     - Generiere synthetic samples via linear interpolation
//
// NEXUS-Adaptation:
//   - Minority = SELL-trades (= 0 derzeit)
//   - Synthese-Strategie: spiegelbildlich aus BUY-trades
//     → side='SELL', pnl_inverted = -pnl (gleichen Markt rückwärts gehen)
//     → Plus Feature-Inversion (price-direction, momentum-sign)
//
// API:
//   MLImbalanceSmote.generate(realTrades, opts) → { synthetic: [...], stats }
//   MLImbalanceSmote.snapshot(db) → status
//   MLImbalanceSmote.balance(db) → führt insert in ml_synthetic_samples-Tabelle aus

'use strict';

const MLImbalanceSmote = {
  TARGET_MINORITY_PCT: 0.30,   // mindestens 30% SELL im Buffer
  MAX_SYNTHETIC_PER_REAL: 3,   // max 3 synthetic per real BUY-trade (LdP-warnung)
  EPSILON: 1e-12,

  /**
   * Ensure target table exists.
   */
  ensureTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ml_synthetic_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_trade_id TEXT NOT NULL,
        side TEXT NOT NULL,
        synthetic_pnl REAL NOT NULL,
        synthetic_features TEXT,
        generated_at INTEGER NOT NULL,
        notes TEXT
      );
    `);
  },

  /**
   * Generate synthetic samples mirrored from real majority-side trades.
   * Block H STEP 1 [26.05.2026]: generisiert für beide Direktionen.
   * @param {Array} majorityTrades - real trades of majority side
   * @param {string} targetSide - 'BUY' or 'SELL' = which side to GENERATE (the minority)
   * @param {number} count
   * @returns {Array} synthetic samples with side=targetSide
   */
  generate(majorityTrades, count, opts = {}) {
    if (!Array.isArray(majorityTrades) || majorityTrades.length === 0) return [];
    // Backward-compat: wenn opts ist eine number, war alter Code (count, opts) — diese Form wird nicht mehr genutzt.
    const targetSide = (opts && opts.targetSide) ? String(opts.targetSide).toUpperCase() : 'SELL';
    const sourceSide = targetSide === 'SELL' ? 'BUY' : 'SELL';
    const out = [];
    let generated = 0;
    let attempts = 0;
    const maxAttempts = count * 10;
    while (generated < count && attempts < maxAttempts) {
      attempts++;
      const real = majorityTrades[Math.floor(Math.random() * majorityTrades.length)];
      const realPnl = Number(real.realized_pnl);
      if (!Number.isFinite(realPnl)) continue;
      const jitter = 0.85 + Math.random() * 0.30;
      // Mirror: invert PnL (majority-side win → minority-side loss in same market move).
      const syntheticPnl = -realPnl * jitter;
      const features = {
        side: targetSide,
        original_source_side: sourceSide,
        original_source_id: real.id,
        original_source_pnl: realPnl,
        jitter_factor: Number(jitter.toFixed(4)),
        method: 'SMOTE_MIRROR_v2',
      };
      out.push({
        source_trade_id: String(real.id || 'unknown'),
        side: targetSide,
        synthetic_pnl: Number(syntheticPnl.toFixed(4)),
        synthetic_features: JSON.stringify(features),
        notes: `SMOTE-mirror ${sourceSide}→${targetSide} from trade ${real.id || 'n/a'}, jitter=${jitter.toFixed(3)}`,
      });
      generated++;
    }
    return out;
  },

  /**
   * Balance ML-buffer: ensure SELL-samples meet TARGET_MINORITY_PCT.
   * @returns {Object} { realBuys, realSells, syntheticGenerated, totalAfter, balancePct, ok }
   */
  balance(db, opts = {}) {
    this.ensureTable(db);
    const target = opts.targetPct || this.TARGET_MINORITY_PCT;
    // Real trades
    const realBuys  = db.prepare("SELECT id, realized_pnl, side FROM trades WHERE state='CLOSED' AND UPPER(side)='BUY' AND realized_pnl IS NOT NULL").all();
    const realSells = db.prepare("SELECT id, realized_pnl, side FROM trades WHERE state='CLOSED' AND UPPER(side)='SELL' AND realized_pnl IS NOT NULL").all();
    const realB = realBuys.length;
    const realS = realSells.length;
    // Block H STEP 1 [26.05.2026]: dynamische Minoritäts-Erkennung.
    // Vorher: hardcoded SELL als Minorität → bei BUY-Minority würde Majorität augmentiert (Bug bei umgekehrtem Verhältnis).
    const minoritySide = realB <= realS ? 'BUY' : 'SELL';
    const majoritySide = minoritySide === 'BUY' ? 'SELL' : 'BUY';
    const realMinority = minoritySide === 'BUY' ? realB : realS;
    const realMajority = minoritySide === 'BUY' ? realS : realB;
    const majorityTrades = minoritySide === 'BUY' ? realSells : realBuys;

    const existingSynthMinority = db.prepare(`SELECT COUNT(*) n FROM ml_synthetic_samples WHERE UPPER(side)=?`).get(minoritySide);
    const synthMinority_existing = existingSynthMinority.n || 0;
    const totalMinorityCurrent = realMinority + synthMinority_existing;
    const totalAll = realB + realS + synthMinority_existing;
    const currentMinorityPct = totalAll > 0 ? totalMinorityCurrent / totalAll : 0;
    if (currentMinorityPct >= target) {
      return { realBuys: realB, realSells: realS, minoritySide, majoritySide, syntheticExisting: synthMinority_existing, syntheticGenerated: 0, totalAfter: totalAll, sellPct: minoritySide === 'SELL' ? Number((currentMinorityPct * 100).toFixed(2)) : Number(((realS + (db.prepare("SELECT COUNT(*) n FROM ml_synthetic_samples WHERE UPPER(side)='SELL'").get().n || 0)) / totalAll * 100).toFixed(2)), minorityPct: Number((currentMinorityPct * 100).toFixed(2)), ok: true, reason: 'ALREADY_BALANCED' };
    }
    // Formel: target = (minority + N) / (total + N)
    // → N = (target*total - minority) / (1 - target)
    const needed = Math.ceil((target * totalAll - totalMinorityCurrent) / (1 - target));
    if (needed <= 0) return { realBuys: realB, realSells: realS, minoritySide, majoritySide, syntheticExisting: synthMinority_existing, syntheticGenerated: 0, totalAfter: totalAll, ok: true, reason: 'NO_GENERATION_NEEDED' };
    // Cap by max-per-real (max 3 synth pro real-Majority-trade)
    const maxAllowed = realMajority * this.MAX_SYNTHETIC_PER_REAL - synthMinority_existing;
    const toGenerate = Math.min(needed, Math.max(0, maxAllowed));
    if (toGenerate === 0) {
      return { realBuys: realB, realSells: realS, minoritySide, majoritySide, syntheticExisting: synthMinority_existing, syntheticGenerated: 0, totalAfter: totalAll, minorityPct: Number((currentMinorityPct * 100).toFixed(2)), ok: false, reason: 'INSUFFICIENT_REAL_MAJORITY_FOR_TARGET' };
    }
    const synthetic = this.generate(majorityTrades, toGenerate, { targetSide: minoritySide });
    // Persist
    const insertStmt = db.prepare("INSERT INTO ml_synthetic_samples (source_trade_id, side, synthetic_pnl, synthetic_features, generated_at, notes) VALUES (?, ?, ?, ?, ?, ?)");
    const now = Date.now();
    const txn = db.transaction(() => {
      for (const s of synthetic) {
        insertStmt.run(s.source_trade_id, s.side, s.synthetic_pnl, s.synthetic_features, now, s.notes);
      }
    });
    txn();
    const totalAfter = totalAll + synthetic.length;
    const newMinorityPct = (totalMinorityCurrent + synthetic.length) / totalAfter;
    // sellPct backward-compat: für /api/smote/snapshot
    const totalSellsAfter = (minoritySide === 'SELL') ? (totalMinorityCurrent + synthetic.length) : (realS + (db.prepare("SELECT COUNT(*) n FROM ml_synthetic_samples WHERE UPPER(side)='SELL'").get().n || 0));
    return {
      realBuys: realB,
      realSells: realS,
      minoritySide,
      majoritySide,
      syntheticExisting: synthMinority_existing,
      syntheticGenerated: synthetic.length,
      totalAfter,
      minorityPct: Number((newMinorityPct * 100).toFixed(2)),
      sellPct: Number((totalSellsAfter / totalAfter * 100).toFixed(2)),
      ok: true,
      reason: 'BALANCED',
    };
  },

  /**
   * Snapshot für UI/API/audit.
   */
  snapshot(db) {
    try {
      this.ensureTable(db);
      const realBuys  = db.prepare("SELECT COUNT(*) n FROM trades WHERE state='CLOSED' AND UPPER(side)='BUY' AND realized_pnl IS NOT NULL").get();
      const realSells = db.prepare("SELECT COUNT(*) n FROM trades WHERE state='CLOSED' AND UPPER(side)='SELL' AND realized_pnl IS NOT NULL").get();
      const synthBuys  = db.prepare("SELECT COUNT(*) n FROM ml_synthetic_samples WHERE UPPER(side)='BUY'").get();
      const synthSells = db.prepare("SELECT COUNT(*) n FROM ml_synthetic_samples WHERE UPPER(side)='SELL'").get();
      const realB = realBuys.n || 0;
      const realS = realSells.n || 0;
      const synthB = synthBuys.n || 0;
      const synthS = synthSells.n || 0;
      const total = realB + realS + synthB + synthS;
      // Block H STEP 1 [26.05.2026]: minoritySide dynamisch
      const minoritySide = realB <= realS ? 'BUY' : 'SELL';
      const minorityCount = minoritySide === 'BUY' ? (realB + synthB) : (realS + synthS);
      const minorityPct = total > 0 ? minorityCount / total : 0;
      // sellPct bleibt als backward-compat
      const sellPct = total > 0 ? (realS + synthS) / total : 0;
      return {
        realBuys: realB,
        realSells: realS,
        syntheticBuys: synthB,
        syntheticSells: synthS,
        minoritySide,
        minorityPct: Number((minorityPct * 100).toFixed(2)),
        total,
        sellPct: Number((sellPct * 100).toFixed(2)),
        balanced: minorityPct >= this.TARGET_MINORITY_PCT,
        target_pct: this.TARGET_MINORITY_PCT * 100,
      };
    } catch(e) {
      return { error: e.message };
    }
  },
};

module.exports = MLImbalanceSmote;
