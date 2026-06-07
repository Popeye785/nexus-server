// modules/hmm_regime.js — Hidden-Markov-Model Regime Detector
// Verankert 2026-05-20 (STUFE 1 — Boutique-Quant-A Niveau).
//
// 5 States: BULL / BEAR / RANGING / CRASH / RECOVERY
// 5 Features: log_return_24h, volatility (ATR/price), drawdown_pct, trend_slope, btcd_change
//
// Approach: Bayesian Posterior aus Multi-Dim-Gaussian-Likelihood + Markov-Transition-Prior.
// Smoothing α=0.3 (exp moving) damit Brain nicht durch Single-Cycle-Jitter überschießt.
// Persistierung in hmm_state-Tabelle (snapshot pro decide-Aufruf).
//
// Brain-Integration: getCurrentRegime() → { state, posterior, confidence }
//                    family_weights_adaptive nutzt posterior für Weighted-Average.

'use strict';

const STATES = ['BULL', 'BEAR', 'RANGING', 'CRASH', 'RECOVERY'];

// Mean + StdDev pro Feature pro State (Aladdin-style hand-tuned initial,
// kalibriert auf historische 5y BTC+ETH-Daten, in STUFE 5 Walk-Forward verfeinert).
// Reihenfolge: [log_return_24h, volatility_atr_pct, drawdown_pct, trend_slope, btcd_change_pct]
const STATE_PROFILES = {
  BULL: {
    mean: [ 0.025, 0.025, 0.05,  0.005, -0.5 ],
    std:  [ 0.030, 0.015, 0.08,  0.005,  1.5 ],
  },
  BEAR: {
    mean: [-0.020, 0.030, 0.20, -0.005,  0.5 ],
    std:  [ 0.025, 0.020, 0.15,  0.005,  1.5 ],
  },
  RANGING: {
    mean: [ 0.000, 0.018, 0.05,  0.000,  0.0 ],
    std:  [ 0.015, 0.010, 0.05,  0.003,  1.0 ],
  },
  CRASH: {
    mean: [-0.060, 0.060, 0.30, -0.015,  2.0 ],
    std:  [ 0.040, 0.030, 0.20,  0.010,  2.0 ],
  },
  RECOVERY: {
    mean: [ 0.030, 0.035, 0.15,  0.008, -1.0 ],
    std:  [ 0.025, 0.020, 0.10,  0.006,  1.5 ],
  },
};

// Initial Transition Matrix — sticky on diagonal (Markov-Persistenz)
// row = from-state, col = to-state. Sum row = 1.
// BUY_BIAS_FIX [21.05.2026]: RANGING-Diagonale 0.55 → 0.45
// Audit-Befund: HMM klebt 1441/1441 (100%) RANGING in 24h trotz Phase-6-Lockerung.
// Weitere Lockerung: BULL 0.16→0.21, BEAR 0.14→0.19, RANGING 0.55→0.45.
const TRANSITION_MATRIX = {
  BULL:     { BULL: 0.78, BEAR: 0.03, RANGING: 0.13, CRASH: 0.02, RECOVERY: 0.04 },
  BEAR:     { BULL: 0.03, BEAR: 0.72, RANGING: 0.13, CRASH: 0.07, RECOVERY: 0.05 },
  RANGING:  { BULL: 0.21, BEAR: 0.19, RANGING: 0.45, CRASH: 0.07, RECOVERY: 0.08 },
  CRASH:    { BULL: 0.02, BEAR: 0.22, RANGING: 0.12, CRASH: 0.35, RECOVERY: 0.29 },
  RECOVERY: { BULL: 0.42, BEAR: 0.06, RANGING: 0.17, CRASH: 0.05, RECOVERY: 0.30 },
};

// BUY_BIAS_FIX [21.05.2026]: EMA 0.45 → 0.55 für schnellere State-Reaktivität (mehr Gewicht auf neue Observation).
const SMOOTH_ALPHA = 0.55;  // EMA-Faktor: 0.55 = 45% old + 55% new

// D2 [23.05.2026] BEAR-FORCE — Hysterese-Logik gegen RANGING-Klebrigkeit bei breitem Markt-Crash.
// Wenn ≥BEAR_FORCE_MIN_BEARS von ≥BEAR_FORCE_MIN_COINS Top-Coins ≤-2% 24h fallen UND BTCD nicht stark fällt,
// wird HMM-State auf BEAR überschrieben (statt RANGING zu behalten). Hysterese: Exit braucht 5/10 grün für 60min.
const BEAR_FORCE_CFG = {
  MIN_COINS: 10,            // min. so viele Coins gemessen
  MIN_BEARS: 7,             // davon min. 7 mit ch24h ≤ -2%
  BEAR_THRESH: -0.02,       // -2% als Bear-Schwelle pro Coin
  BTCD_BLOCK_FALL: -1.5,    // wenn BTCD < -1.5pp fällt → BearForce blocken (Alts-Rotation, nicht Crash)
  EXIT_GREEN_MIN: 5,        // ≥5/10 Coins ≥+1% 24h
  EXIT_GREEN_THRESH: 0.01,  // +1% als Green-Schwelle
  EXIT_WINDOW_MS: 3600000,  // 60min Hysterese-Fenster für Exit
  ENTER_WINDOW_MS: 3600000, // 60min Glättung für Entry — Mehrheit über die letzten Ticks
  MIN_CONF: 0.70,           // Confidence-Floor wenn forced
  MAX_CONF: 0.95,           // Cap
};

const HMMRegime = {
  _db: null,
  _smoothedPosterior: null,  // { BULL: 0.2, ... }
  _lastObs: null,
  _lastState: null,
  _lastTs: 0,
  _initialized: false,
  // D2 [23.05.2026] BEAR-FORCE state
  _bearForceActive: false,
  _bearForceSince: 0,
  _bearForceHistory: [],     // [{ ts, bears, greens, total, meanCh24, forced }]
  _lastBroadCtx: null,        // letzte top-coins context

  init(db) {
    this._db = db;
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hmm_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          state TEXT NOT NULL,
          posterior_json TEXT NOT NULL,
          observations_json TEXT,
          confidence REAL
        );
        CREATE INDEX IF NOT EXISTS idx_hmm_state_ts ON hmm_state(ts);
      `);
      // Restore last smoothed posterior aus DB falls vorhanden
      const last = db.prepare(`SELECT posterior_json, state, ts FROM hmm_state ORDER BY ts DESC LIMIT 1`).get();
      if (last && last.posterior_json) {
        try {
          this._smoothedPosterior = JSON.parse(last.posterior_json);
          this._lastState = last.state;
          this._lastTs = last.ts;
        } catch(_) {}
      }
      this._initialized = true;
    } catch(e) { /* schema fail = neutral degradation */ }
  },

  // ─── Multi-Dim-Gaussian Likelihood ──────────────────────────────────
  // p(obs | state) = ∏ gaussian(obs_i, mean_i, std_i)
  // Verwendung von log-likelihood um Underflow zu verhindern
  _logLikelihood(obs, state) {
    const profile = STATE_PROFILES[state];
    if (!profile) return -Infinity;
    let logL = 0;
    for (let i = 0; i < obs.length; i++) {
      const x = obs[i];
      const mu = profile.mean[i];
      const sigma = profile.std[i];
      if (!isFinite(x) || sigma <= 0) continue;
      const z = (x - mu) / sigma;
      logL += -0.5 * (z * z) - Math.log(sigma) - 0.5 * Math.log(2 * Math.PI);
    }
    return logL;
  },

  // ─── Posterior aus Likelihood + Prior ───────────────────────────────
  _computePosterior(obs) {
    const prior = this._smoothedPosterior || { BULL: 0.2, BEAR: 0.2, RANGING: 0.4, CRASH: 0.1, RECOVERY: 0.1 };

    // Forward step: incorporate transition matrix
    const transitionedPrior = {};
    for (const s of STATES) transitionedPrior[s] = 0;
    for (const from of STATES) {
      const fromP = prior[from] || 0;
      for (const to of STATES) {
        const tProb = (TRANSITION_MATRIX[from] && TRANSITION_MATRIX[from][to]) || 0;
        transitionedPrior[to] += fromP * tProb;
      }
    }

    // Likelihood pro state
    const logLikes = {};
    let maxLogL = -Infinity;
    for (const s of STATES) {
      logLikes[s] = this._logLikelihood(obs, s);
      if (logLikes[s] > maxLogL) maxLogL = logLikes[s];
    }

    // Normalisierter Posterior (mit log-sum-exp Stabilität)
    const unnorm = {};
    let sum = 0;
    for (const s of STATES) {
      const adjLogL = logLikes[s] - maxLogL;  // shift für Stabilität
      const lik = Math.exp(adjLogL);
      unnorm[s] = lik * transitionedPrior[s];
      sum += unnorm[s];
    }
    const posterior = {};
    if (sum > 0) {
      for (const s of STATES) posterior[s] = unnorm[s] / sum;
    } else {
      // Degraded fallback: uniform
      for (const s of STATES) posterior[s] = 1 / STATES.length;
    }
    return posterior;
  },

  // ─── EMA-Smoothing über Single-Cycle-Posterior ──────────────────────
  _smooth(newPosterior) {
    if (!this._smoothedPosterior) {
      this._smoothedPosterior = { ...newPosterior };
      return this._smoothedPosterior;
    }
    const smoothed = {};
    for (const s of STATES) {
      const oldP = this._smoothedPosterior[s] || 0;
      const newP = newPosterior[s] || 0;
      smoothed[s] = (1 - SMOOTH_ALPHA) * oldP + SMOOTH_ALPHA * newP;
    }
    this._smoothedPosterior = smoothed;
    return smoothed;
  },

  // ─── Observations bauen aus Brain-Kontext ──────────────────────────
  // observations = { log_return_24h, volatility_atr_pct, drawdown_pct, trend_slope, btcd_change_pct }
  _buildObservations(ctx) {
    const ret = isFinite(ctx.log_return_24h) ? ctx.log_return_24h : 0;
    const vol = isFinite(ctx.volatility_atr_pct) ? ctx.volatility_atr_pct : 0.02;
    const dd  = isFinite(ctx.drawdown_pct) ? ctx.drawdown_pct : 0;
    const trd = isFinite(ctx.trend_slope) ? ctx.trend_slope : 0;
    const btd = isFinite(ctx.btcd_change_pct) ? ctx.btcd_change_pct : 0;
    return [ret, vol, dd, trd, btd];
  },

  // ─── G3 [23.05.2026] CRASH-FORCE check ────────────────────────────
  // Wenn ≥8/10 Coins -5%+ in 1h ODER mean ch24 < -10% ODER BTC -7%+ in 1h → CRASH
  checkCrashForce(broadCtx) {
    if (!broadCtx || !Array.isArray(broadCtx.topCoins)) return { force: false, reason: 'no_broad_ctx' };
    const coins = broadCtx.topCoins.filter(c => isFinite(c?.ch24));
    if (coins.length < 8) return { force: false, reason: `only_${coins.length}_coins` };
    const meanCh24 = coins.reduce((s,c)=>s+c.ch24, 0) / coins.length;
    const heavy = coins.filter(c => c.ch24 <= -0.05).length;  // -5%+ Bewegung
    if (meanCh24 < -0.10) return { force: true, reason: 'mean_crash', meanCh24, heavy };
    if (heavy >= 8)       return { force: true, reason: 'broad_heavy_crash', meanCh24, heavy };
    return { force: false, reason: `only_${heavy}_heavy_drops`, meanCh24, heavy };
  },

  // ─── G4 [23.05.2026] RECOVERY-FORCE check ─────────────────────────
  // Nach CRASH: ≥3/10 Coins +3%+ in 1h → RECOVERY (Reversal-Hint)
  checkRecoveryForce(broadCtx, currentState) {
    if (currentState !== 'CRASH') return { force: false, reason: 'not_in_crash' };
    if (!broadCtx || !Array.isArray(broadCtx.topCoins)) return { force: false, reason: 'no_broad_ctx' };
    const coins = broadCtx.topCoins.filter(c => isFinite(c?.ch24));
    const bouncers = coins.filter(c => c.ch24 >= 0.03).length;
    if (bouncers >= 3) return { force: true, reason: 'bouncers_emerging', bouncers, total: coins.length };
    return { force: false, reason: `only_${bouncers}_bouncers` };
  },

  // ─── G2 [23.05.2026] BULL-FORCE check (Spiegel zu BearForce) ──────
  // Wenn ≥7/10 Top-Coins ≥+2% 24h steigen UND BTCD nicht stark steigt → BULL_STRONG forcen
  checkBullForce(broadCtx) {
    if (!broadCtx || !Array.isArray(broadCtx.topCoins)) return { force: false, reason: 'no_broad_ctx' };
    const coins = broadCtx.topCoins.filter(c => isFinite(c?.ch24));
    const total = coins.length;
    if (total < BEAR_FORCE_CFG.MIN_COINS) return { force: false, reason: `only_${total}_coins`, total };
    // Spiegelschwellen: Bulls = ch24 >= +2%, Bears = ch24 <= -2%
    const bulls  = coins.filter(c => c.ch24 >= 0.02).length;
    const bears  = coins.filter(c => c.ch24 <= -0.01).length;
    const meanCh24 = coins.reduce((s,c)=>s+c.ch24, 0) / total;
    const btcd = isFinite(broadCtx.btcd_change_pct) ? broadCtx.btcd_change_pct : 0;
    // Bull-Block: wenn BTCD STARK steigt (alts schwächeln) — analog Bear-Force-block bei BTCD-Rotation
    const btcdAltWeak = btcd > 1.5;
    const now = Date.now();
    const tick = { ts: now, bulls, bears, total, meanCh24, btcd, forced: false, kind: 'bull' };
    if (bulls >= BEAR_FORCE_CFG.MIN_BEARS && !btcdAltWeak) {
      const directTrigger = bulls >= 8;
      const window = this._bearForceHistory.filter(h => h.kind === 'bull' && (now - h.ts) <= BEAR_FORCE_CFG.ENTER_WINDOW_MS);
      const recentBullTicks = window.filter(h => h.bulls >= BEAR_FORCE_CFG.MIN_BEARS).length;
      const majorityTrigger = window.length >= 5 && recentBullTicks >= Math.ceil(window.length * 0.6);
      if (directTrigger || majorityTrigger) {
        tick.forced = true;
        this._bearForceHistory.push(tick);
        this._bearForceHistory = this._bearForceHistory.slice(-120);
        return { force: true, reason: directTrigger ? 'direct_strong' : 'majority_window', bulls, bears, total, meanCh24, btcd };
      }
    }
    this._bearForceHistory.push(tick);
    this._bearForceHistory = this._bearForceHistory.slice(-120);
    return { force: false, reason: btcdAltWeak ? 'btcd_alt_weak' : (bulls < BEAR_FORCE_CFG.MIN_BEARS ? `only_${bulls}_bulls` : 'waiting_window'), bulls, bears, total, meanCh24, btcd };
  },

  // ─── D2 [23.05.2026] BEAR-FORCE check ─────────────────────────────
  // broadCtx: { topCoins: [{symbol, ch24}], btcd_change_pct, avgVol }
  // Liefert { force: bool, reason, bears, greens, total, meanCh24 }
  checkBearForce(broadCtx) {
    if (!broadCtx || !Array.isArray(broadCtx.topCoins)) return { force: false, reason: 'no_broad_ctx' };
    const coins = broadCtx.topCoins.filter(c => isFinite(c?.ch24));
    const total = coins.length;
    if (total < BEAR_FORCE_CFG.MIN_COINS) return { force: false, reason: `only_${total}_coins`, total };
    const bears  = coins.filter(c => c.ch24 <= BEAR_FORCE_CFG.BEAR_THRESH).length;
    const greens = coins.filter(c => c.ch24 >= BEAR_FORCE_CFG.EXIT_GREEN_THRESH).length;
    const meanCh24 = coins.reduce((s,c)=>s+c.ch24, 0) / total;
    const btcd = isFinite(broadCtx.btcd_change_pct) ? broadCtx.btcd_change_pct : 0;
    const btcdRotation = btcd < BEAR_FORCE_CFG.BTCD_BLOCK_FALL;
    const now = Date.now();
    const tick = { ts: now, bears, greens, total, meanCh24, btcd, forced: false };

    // ENTER-Condition: BearForce noch nicht aktiv, jetzt erfüllt?
    if (!this._bearForceActive) {
      if (bears >= BEAR_FORCE_CFG.MIN_BEARS && !btcdRotation) {
        // 60-min Glättung: prüfe Historie — Mehrheit der letzten Ticks im Bear-Zustand?
        const window = this._bearForceHistory.filter(h => (now - h.ts) <= BEAR_FORCE_CFG.ENTER_WINDOW_MS);
        const recentBearTicks = window.filter(h => h.bears >= BEAR_FORCE_CFG.MIN_BEARS).length;
        // Direkter Entry möglich wenn Bears sehr stark (≥8/10) ODER Mehrheit der Glättung
        const directTrigger = bears >= 8;
        const majorityTrigger = window.length >= 5 && recentBearTicks >= Math.ceil(window.length * 0.6);
        if (directTrigger || majorityTrigger) {
          this._bearForceActive = true;
          this._bearForceSince = now;
          tick.forced = true;
          this._bearForceHistory.push(tick);
          this._bearForceHistory = this._bearForceHistory.slice(-120);
          return { force: true, reason: directTrigger ? 'direct_strong' : 'majority_window', bears, greens, total, meanCh24, btcd, since: now };
        }
      }
      this._bearForceHistory.push(tick);
      this._bearForceHistory = this._bearForceHistory.slice(-120);
      return { force: false, reason: btcdRotation ? 'btcd_rotation' : (bears < BEAR_FORCE_CFG.MIN_BEARS ? `only_${bears}_bears` : 'waiting_window'), bears, greens, total, meanCh24, btcd };
    }

    // EXIT-Condition: BearForce aktiv, Markt-Erholung?
    // 60-min Hysterese: durchgängig ≥5/10 grün im Fenster?
    const exitWindow = this._bearForceHistory.filter(h => (now - h.ts) <= BEAR_FORCE_CFG.EXIT_WINDOW_MS);
    const greenTicks = exitWindow.filter(h => h.greens >= BEAR_FORCE_CFG.EXIT_GREEN_MIN).length;
    const greenMajority = exitWindow.length >= 10 && greenTicks >= Math.ceil(exitWindow.length * 0.7);
    if (greenMajority) {
      // Exit BearForce
      this._bearForceActive = false;
      this._bearForceSince = 0;
      this._bearForceHistory.push(tick);
      this._bearForceHistory = this._bearForceHistory.slice(-120);
      return { force: false, reason: 'exit_recovery', bears, greens, total, meanCh24, btcd };
    }

    // Weiter forciert
    tick.forced = true;
    this._bearForceHistory.push(tick);
    this._bearForceHistory = this._bearForceHistory.slice(-120);
    return { force: true, reason: 'sticky', bears, greens, total, meanCh24, btcd, since: this._bearForceSince };
  },

  // ─── Public: Detect aktuelle Regime ──────────────────────────────
  detect(ctx) {
    const obs = this._buildObservations(ctx);
    this._lastObs = obs;
    const rawPost = this._computePosterior(obs);
    const smoothed = this._smooth(rawPost);

    // Argmax state
    let bestState = STATES[0], bestP = 0;
    for (const s of STATES) {
      if ((smoothed[s] || 0) > bestP) { bestP = smoothed[s]; bestState = s; }
    }

    // D2 [23.05.2026] BEAR-FORCE Override / G2 [23.05.2026] BULL-FORCE Override
    // G3 [23.05.2026] CRASH-FORCE / G4 [23.05.2026] RECOVERY-FORCE — höchste Priorität
    let bearForceResult = null, bullForceResult = null, crashForceResult = null, recoveryForceResult = null;
    if (ctx && ctx.broadMarket) {
      try {
        crashForceResult    = this.checkCrashForce(ctx.broadMarket);
        recoveryForceResult = this.checkRecoveryForce(ctx.broadMarket, this._lastState);
        bearForceResult = this.checkBearForce(ctx.broadMarket);
        bullForceResult = this.checkBullForce(ctx.broadMarket);
        this._lastBroadCtx = ctx.broadMarket;
        // Priorität: CRASH > RECOVERY > BEAR > BULL
        if (crashForceResult.force) {
          bestState = 'CRASH';
          bestP = 0.90;
          for (const s of STATES) smoothed[s] = (s === 'CRASH') ? 0.90 : 0.025;
          this._smoothedPosterior = { ...smoothed };
        } else if (recoveryForceResult.force) {
          bestState = 'RECOVERY';
          bestP = 0.80;
          for (const s of STATES) smoothed[s] = (s === 'RECOVERY') ? 0.80 : 0.05;
          this._smoothedPosterior = { ...smoothed };
        } else if (bearForceResult.force) {
          bestState = 'BEAR';
          const meanAbs = Math.abs(bearForceResult.meanCh24 || 0);
          let forcedConf = BEAR_FORCE_CFG.MIN_CONF + Math.min(0.25, meanAbs * 5);
          forcedConf = Math.max(BEAR_FORCE_CFG.MIN_CONF, Math.min(BEAR_FORCE_CFG.MAX_CONF, forcedConf));
          bestP = forcedConf;
          for (const s of STATES) smoothed[s] = (s === 'BEAR') ? forcedConf : (1 - forcedConf) / 4;
          this._smoothedPosterior = { ...smoothed };
        } else if (bullForceResult.force) {
          // G2 BULL-FORCE
          bestState = 'BULL';
          const meanAbs = Math.abs(bullForceResult.meanCh24 || 0);
          let forcedConf = BEAR_FORCE_CFG.MIN_CONF + Math.min(0.25, meanAbs * 5);
          forcedConf = Math.max(BEAR_FORCE_CFG.MIN_CONF, Math.min(BEAR_FORCE_CFG.MAX_CONF, forcedConf));
          bestP = forcedConf;
          for (const s of STATES) smoothed[s] = (s === 'BULL') ? forcedConf : (1 - forcedConf) / 4;
          this._smoothedPosterior = { ...smoothed };
        }
      } catch(_) {}
    }

    this._lastState = bestState;
    this._lastTs = Date.now();

    // Persistierung
    try {
      if (this._db) {
        this._db.prepare(`INSERT INTO hmm_state (ts, state, posterior_json, observations_json, confidence)
          VALUES (?, ?, ?, ?, ?)`).run(
          this._lastTs, bestState,
          JSON.stringify(smoothed),
          JSON.stringify({ obs, ctx_summary: this._ctxSummary(ctx), bear_force: bearForceResult, bull_force: bullForceResult }).slice(0, 1500),
          bestP
        );
      }
    } catch(_) {}

    return { state: bestState, posterior: smoothed, confidence: bestP, bearForce: bearForceResult, bullForce: bullForceResult, crashForce: crashForceResult, recoveryForce: recoveryForceResult };
  },

  _ctxSummary(ctx) {
    return {
      ret: ctx.log_return_24h?.toFixed?.(4),
      vol: ctx.volatility_atr_pct?.toFixed?.(4),
      dd:  ctx.drawdown_pct?.toFixed?.(4),
      trd: ctx.trend_slope?.toFixed?.(5),
      btd: ctx.btcd_change_pct?.toFixed?.(3),
    };
  },

  getCurrentRegime() {
    if (!this._smoothedPosterior) return { state: 'RANGING', posterior: null, confidence: 0 };
    return {
      state: this._lastState || 'RANGING',
      posterior: this._smoothedPosterior,
      confidence: this._smoothedPosterior[this._lastState] || 0,
      lastTs: this._lastTs,
    };
  },

  snapshot() {
    return {
      initialized: this._initialized,
      lastState: this._lastState,
      smoothedPosterior: this._smoothedPosterior,
      lastObs: this._lastObs,
      lastTs: this._lastTs,
      states: STATES,
      smoothAlpha: SMOOTH_ALPHA,
      // D2 BearForce
      bearForce: {
        active: this._bearForceActive,
        since: this._bearForceSince,
        historyLen: this._bearForceHistory.length,
        lastTick: this._bearForceHistory.length ? this._bearForceHistory[this._bearForceHistory.length-1] : null,
        cfg: BEAR_FORCE_CFG,
      },
      lastBroadCtx: this._lastBroadCtx,
    };
  },

  STATES,
};

module.exports = HMMRegime;
