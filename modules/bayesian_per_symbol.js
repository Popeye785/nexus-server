// modules/bayesian_per_symbol.js
// Block R A2 [27.05.2026]: SKELETON für Per-Symbol Bayesian-Posteriors.
//
// STATUS: SKELETON — NICHT in Brain integriert.
// Brain läuft weiter mit globalem RiskEngine.bayesian.priors.
// Aktivierung: erst nach Christian-OK in Block S (siehe Roadmap).
//
// Zweck:
//   Aktueller Bayesian-Posterior ist GLOBAL → Strategy-Router braucht
//   pro-Symbol-Markt-Regime-Wahrscheinlichkeiten.
//   z.B. NEAR könnte BULL-Posterior 0.65 haben, BTC nur 0.30.
//
// Design:
//   - 3-State (bull/bear/sideways) wie globaler Bayesian
//   - DB-Persistence in bayesian_symbol_posteriors
//   - Cold-Start-Fallback: bei n<MIN_OBS_FOR_SYMBOL → globaler Prior
//   - Decay: alte Observations verlieren Gewicht
//   - Toggle: CFG.BAYESIAN_PER_SYMBOL_ENABLED (default false)

'use strict';

const PerSymbolBayesian = {
  // Konfig
  MIN_OBS_FOR_SYMBOL: 30,   // unter dem auf global zurückfallen
  DECAY_FACTOR: 0.95,       // pro Update werden alte Obs etwas vergessen
  LEARNING_RATE: 0.05,      // wie schnell Posterior auf neue Obs reagiert
  CAP_MIN: 0.05,            // Prior darf nie unter 5% fallen
  CAP_MAX: 0.70,            // und nie über 70%

  // In-Memory-Cache (DB-State synchronisiert via loadAll/persist)
  _state: new Map(),        // symbol → {bull, bear, sideways, n_observations, last_updated}
  _loaded: false,

  /**
   * Wird beim Bot-Boot aufgerufen (sobald aktiviert).
   * Lädt persistierte Posteriors aus DB.
   */
  loadAll(db) {
    if (!db) return { ok: false, error: 'NO_DB' };
    try {
      const rows = db.prepare(`SELECT * FROM bayesian_symbol_posteriors`).all();
      for (const r of rows) {
        this._state.set(r.symbol, {
          bull: r.prior_bull,
          bear: r.prior_bear,
          sideways: r.prior_sideways,
          n_observations: r.n_observations,
          last_updated: r.last_updated,
        });
      }
      this._loaded = true;
      return { ok: true, loaded: rows.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /**
   * Liefert Posterior für Symbol. Fallback auf globalen Prior bei n<MIN_OBS.
   * @param {string} symbol
   * @param {Object} globalPrior - z.B. {bull:0.33, bear:0.33, sideways:0.34}
   * @returns {Object} {posterior, source: 'symbol'|'global', n_observations}
   */
  getPosterior(symbol, globalPrior) {
    const st = this._state.get(symbol);
    if (!st || st.n_observations < this.MIN_OBS_FOR_SYMBOL) {
      return {
        posterior: { ...globalPrior },
        source: 'global',
        n_observations: st ? st.n_observations : 0,
        reason: st ? 'INSUFFICIENT_OBSERVATIONS' : 'NO_DATA',
      };
    }
    return {
      posterior: { bull: st.bull, bear: st.bear, sideways: st.sideways },
      source: 'symbol',
      n_observations: st.n_observations,
      reason: 'OK',
    };
  },

  /**
   * Update Posterior nach Trade-Outcome.
   * @param {string} symbol
   * @param {string} regime - 'bull'|'bear'|'sideways' (welches Regime hat sich bestätigt)
   * @param {Object} db
   */
  updatePosterior(symbol, regime, db) {
    if (!['bull','bear','sideways'].includes(regime)) return { ok: false, error: 'INVALID_REGIME' };
    let st = this._state.get(symbol);
    if (!st) {
      st = { bull: 0.33, bear: 0.33, sideways: 0.34, n_observations: 0, last_updated: 0 };
      this._state.set(symbol, st);
    }
    // Decay alte priors leicht
    st.bull *= this.DECAY_FACTOR;
    st.bear *= this.DECAY_FACTOR;
    st.sideways *= this.DECAY_FACTOR;
    // Nudge zum beobachteten regime
    st[regime] += this.LEARNING_RATE;
    // Caps
    st.bull = Math.max(this.CAP_MIN, Math.min(this.CAP_MAX, st.bull));
    st.bear = Math.max(this.CAP_MIN, Math.min(this.CAP_MAX, st.bear));
    st.sideways = Math.max(this.CAP_MIN, Math.min(this.CAP_MAX, st.sideways));
    // Renormalize
    const sum = st.bull + st.bear + st.sideways;
    if (sum > 0) {
      st.bull /= sum; st.bear /= sum; st.sideways /= sum;
    }
    st.n_observations++;
    st.last_updated = Date.now();
    // DB-Persist
    if (db) {
      try {
        db.prepare(`
          INSERT INTO bayesian_symbol_posteriors (symbol, prior_bull, prior_bear, prior_sideways, n_observations, last_updated)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(symbol) DO UPDATE SET
            prior_bull = excluded.prior_bull,
            prior_bear = excluded.prior_bear,
            prior_sideways = excluded.prior_sideways,
            n_observations = excluded.n_observations,
            last_updated = excluded.last_updated
        `).run(symbol, st.bull, st.bear, st.sideways, st.n_observations, st.last_updated);
      } catch (e) {
        return { ok: false, error: 'DB_WRITE_FAIL_' + e.message };
      }
    }
    return { ok: true, posterior: { ...st } };
  },

  /**
   * Snapshot für API/Debug.
   */
  snapshot() {
    const all = {};
    for (const [sym, st] of this._state.entries()) {
      all[sym] = { ...st };
    }
    return {
      loaded: this._loaded,
      total_symbols: this._state.size,
      min_obs_for_symbol: this.MIN_OBS_FOR_SYMBOL,
      per_symbol: all,
    };
  },
};

module.exports = PerSymbolBayesian;
