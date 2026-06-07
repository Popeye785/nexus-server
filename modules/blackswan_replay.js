// modules/blackswan_replay.js — Historische Black-Swan-Event-Replay-Engine
// Verankert 2026-05-20 (STUFE 5 — Boutique-Quant-A).
//
// READ-ONLY: nutzt echte 1h-Candles aus candle_cache, klassifiziert mit HMM-Regime,
// simuliert Brain-Reaktion (vereinfachter ConsensusEngine-Pfad) auf historische
// Black-Swan-Events. Misst: maxDD, KillSwitch-Hits, PnL, win-rate, HMM-state-curve.
//
// Events (alle in candle_cache verifiziert):
//   COVID_2020   → 2020-03-10 bis 2020-03-25 (BTC -50% in 2 Wochen)
//   3AC_2022     → 2022-06-11 bis 2022-06-22 (Liquidation-Cascade -30%)
//   LUNA_2022    → 2022-05-07 bis 2022-05-16 (UST/LUNA collapse, BTC -35%)
//   FTX_2022     → 2022-11-04 bis 2022-11-15 (Exchange-Kollaps, BTC -25%)
//   BANANA_PEEL  → 2024-08-04 bis 2024-08-08 (Yen-Carry-Unwind, BTC -15% Tag)
//
// Brain-Sim: pro Candle bauen wir Observations für HMM, FW-Adaptive resolved weights,
// simulieren Position-Reaktion (hold/exit/scale-down bei CRASH-State).

'use strict';

const EVENTS = {
  COVID_2020: {
    label: 'COVID-Crash März 2020',
    symbol: 'BTCUSDT',
    granularity: '1h',
    start: Date.UTC(2020, 2, 10) - 86400000 * 5,   // 5 days before
    end:   Date.UTC(2020, 2, 25) + 86400000 * 5,   // 5 days after
    description: 'BTC -50% in 2 Wochen, global market panic',
  },
  LUNA_2022: {
    label: 'LUNA/UST Collapse Mai 2022',
    symbol: 'BTCUSDT',
    granularity: '1h',
    start: Date.UTC(2022, 4, 7) - 86400000 * 5,
    end:   Date.UTC(2022, 4, 16) + 86400000 * 5,
    description: 'UST de-peg, LUNA → 0, BTC -35% Kontagion',
  },
  THREE_AC_2022: {
    label: '3AC Liquidation Cascade Juni 2022',
    symbol: 'BTCUSDT',
    granularity: '1h',
    start: Date.UTC(2022, 5, 11) - 86400000 * 5,
    end:   Date.UTC(2022, 5, 22) + 86400000 * 5,
    description: '3AC Insolvenz, Cascade-Liquidationen, BTC -30%',
  },
  FTX_2022: {
    label: 'FTX Exchange Kollaps November 2022',
    symbol: 'BTCUSDT',
    granularity: '1h',
    start: Date.UTC(2022, 10, 4) - 86400000 * 5,
    end:   Date.UTC(2022, 10, 15) + 86400000 * 5,
    description: 'FTX/Alameda Insolvenz, BTC -25%, contagion',
  },
  BANANA_PEEL_2024: {
    label: 'Yen-Carry-Unwind August 2024',
    symbol: 'BTCUSDT',
    granularity: '1h',
    start: Date.UTC(2024, 7, 4) - 86400000 * 3,
    end:   Date.UTC(2024, 7, 8) + 86400000 * 5,
    description: 'Yen-Carry-Trade Unwind, BTC -15% Single-Tag',
  },
};

const BlackSwanReplay = {
  _db: null,
  _HMM: null,
  _FWA: null,
  _lastResults: {},

  init(db, hmmModule, fwaModule) {
    this._db = db;
    this._HMM = hmmModule;
    this._FWA = fwaModule;
  },

  // ─── Helper: Candles aus DB für Event-Range laden ──────────────────
  _loadCandles(eventName) {
    const ev = EVENTS[eventName];
    if (!ev) throw new Error('Unknown event: ' + eventName);
    const rows = this._db.prepare(`
      SELECT ts, open, high, low, close, vol FROM candle_cache
      WHERE symbol = ? AND granularity = ? AND ts BETWEEN ? AND ?
      ORDER BY ts ASC
    `).all(ev.symbol, ev.granularity, ev.start, ev.end);
    return rows.map(r => ({ ts: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, vol: r.vol }));
  },

  // ─── HMM Observations aus rolling-Candles ──────────────────────────
  _buildObservations(candles, idx) {
    const lookback = 24;  // 24h für return-calc
    if (idx < lookback) return null;
    const closes = candles.slice(Math.max(0, idx - lookback + 1), idx + 1).map(c => c.close);
    const highs  = candles.slice(Math.max(0, idx - lookback + 1), idx + 1).map(c => c.high);
    const lows   = candles.slice(Math.max(0, idx - lookback + 1), idx + 1).map(c => c.low);
    const last = closes[closes.length - 1];
    const prev = closes[0];
    if (!isFinite(last) || !isFinite(prev) || prev <= 0) return null;
    const log_return_24h = Math.log(last / prev);
    let trSum = 0;
    for (let i = 1; i < closes.length; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
      trSum += tr;
    }
    const atr = trSum / (closes.length - 1);
    const volatility_atr_pct = atr / last;
    const maxHigh = Math.max(...highs);
    const drawdown_pct = (maxHigh - last) / maxHigh;
    const n = closes.length;
    let sumX=0,sumY=0,sumXY=0,sumX2=0;
    for (let i=0;i<n;i++){ sumX+=i; sumY+=closes[i]; sumXY+=i*closes[i]; sumX2+=i*i; }
    const denom = (n * sumX2 - sumX * sumX);
    const slope = denom > 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const trend_slope = slope / last;
    return { log_return_24h, volatility_atr_pct, drawdown_pct, trend_slope, btcd_change_pct: 0 };
  },

  // ─── Simplified Brain-Reaction-Sim ─────────────────────────────────
  // Strategie: long-only mit Position-Sizing-Adaption via HMM-Posterior.
  // Bei CRASH-Posterior > 0.4 → 50% Position-Reduktion.
  // Bei CRASH-Posterior > 0.6 → vollständiger Exit (KillSwitch-Sim).
  // Bei DD > 12% → Emergency-Exit (echter KillSwitch-Mechanismus).
  // SimEinheit: 1000 USDT Capital.
  _simulate(candles, replayHMM) {
    const startCapital = 1000;
    let cash = startCapital;
    let position = { size: 0, entry: 0 };  // size in USDT-value at entry
    const trades = [];
    const stateCurve = [];
    const equityCurve = [];
    let peak = startCapital;
    let maxDD = 0;
    let killSwitchTriggered = false;
    let crashStateExitTriggered = false;
    let entryAdvance = 0;
    let positionScaleDown = false;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const obs = this._buildObservations(candles, i);

      // HMM-Detect: nutze frische Modul-Instanz (replayHMM) damit Live-Bot-State unberührt
      let state = 'RANGING', posterior = null, conf = 0;
      if (obs && replayHMM) {
        const reg = replayHMM.detect(obs);
        state = reg.state; posterior = reg.posterior; conf = reg.confidence;
      }

      // Position-Value
      const posValue = position.size > 0 ? position.size * (c.close / position.entry) : 0;
      const equity = cash + posValue;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
      stateCurve.push({ ts: c.ts, state, conf: +conf.toFixed(3), crashP: posterior ? +posterior.CRASH.toFixed(3) : 0 });
      equityCurve.push({ ts: c.ts, equity: +equity.toFixed(2), dd: +(dd*100).toFixed(2) });

      // ─── Strategy-Logik ─────────────────────────────────────────
      // 1. Hard KillSwitch bei DD>12%
      if (!killSwitchTriggered && dd >= 0.12 && position.size > 0) {
        cash += posValue * 0.997;  // 0.3% slippage exit
        trades.push({ ts: c.ts, action: 'KS_EXIT', price: c.close, pnl: posValue * 0.997 - position.size });
        position = { size: 0, entry: 0 };
        killSwitchTriggered = true;
        continue;
      }
      // 2. CRASH-State-Exit (Adaptive Risk)
      if (posterior && posterior.CRASH > 0.60 && position.size > 0) {
        cash += posValue * 0.998;  // 0.2% slippage
        trades.push({ ts: c.ts, action: 'CRASH_EXIT', price: c.close, pnl: posValue * 0.998 - position.size, state, crashP: posterior.CRASH });
        position = { size: 0, entry: 0 };
        crashStateExitTriggered = true;
        continue;
      }
      // 3. Position-Scale-Down bei mittlerem CRASH (0.4-0.6)
      if (posterior && posterior.CRASH > 0.40 && posterior.CRASH <= 0.60 && position.size > 0 && !positionScaleDown) {
        const halfValue = posValue * 0.50;
        cash += halfValue * 0.998;
        position.size = position.size * 0.50;  // entry stays
        positionScaleDown = true;
        trades.push({ ts: c.ts, action: 'SCALE_DOWN_50', price: c.close, pnl_partial: halfValue * 0.998 - position.size * 0.50 });
        continue;
      }
      // 4. Entry: long-only, bei state BULL+RECOVERY+RANGING und kein crash-exit aktiv
      const entryStates = ['BULL', 'RECOVERY', 'RANGING'];
      if (position.size === 0 && entryStates.includes(state) && !crashStateExitTriggered && i > 50) {
        // Sizing: 30% bei BULL/RECOVERY, 15% bei RANGING
        const sizingPct = (state === 'BULL' || state === 'RECOVERY') ? 0.30 : 0.15;
        const allocation = cash * sizingPct;
        cash -= allocation;
        position = { size: allocation, entry: c.close };
        entryAdvance++;
        positionScaleDown = false;
      }
    }

    // Force close at end
    if (position.size > 0) {
      const finalC = candles[candles.length - 1];
      const finalValue = position.size * (finalC.close / position.entry);
      cash += finalValue * 0.998;
      trades.push({ ts: finalC.ts, action: 'FINAL_EXIT', price: finalC.close, pnl: finalValue * 0.998 - position.size });
    }

    const finalEquity = cash;
    const totalReturn = (finalEquity - startCapital) / startCapital;
    const wins = trades.filter(t => (t.pnl||t.pnl_partial||0) > 0).length;
    const losses = trades.filter(t => (t.pnl||t.pnl_partial||0) < 0).length;
    const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;

    return {
      startEquity: startCapital,
      finalEquity: +finalEquity.toFixed(2),
      totalReturn: +(totalReturn * 100).toFixed(2),
      maxDrawdown: +(maxDD * 100).toFixed(2),
      killSwitchTriggered,
      crashStateExitTriggered,
      tradesCount: trades.length,
      entries: entryAdvance,
      wins, losses,
      winRate: +winRate.toFixed(3),
      stateCurveSample: stateCurve.filter((_, i) => i % Math.max(1, Math.floor(stateCurve.length / 40)) === 0),
      equityCurveSample: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 40)) === 0),
      trades: trades.slice(0, 20),
    };
  },

  // ─── Public: replay einer Event ─────────────────────────────────
  async replay(eventName) {
    const ev = EVENTS[eventName];
    if (!ev) throw new Error('Unknown event: ' + eventName);
    if (!this._HMM || !this._FWA) throw new Error('HMM/FWA modules not initialized');

    const candles = this._loadCandles(eventName);
    if (!candles || candles.length < 50) throw new Error(`insufficient candles for ${eventName} (${candles ? candles.length : 0})`);

    // Replay-HMM: nutze proxy-Instanz die isoliert vom Live-Bot ist
    // Dazu erzeugen wir eine neue _smoothedPosterior-state und detect-State pro Replay
    const ReplayHMM = Object.create(this._HMM);
    ReplayHMM._smoothedPosterior = null;
    ReplayHMM._lastState = null;
    ReplayHMM._db = null;  // kein DB-Schreiben während Replay
    ReplayHMM.detect = function(obs) {
      // Same as HMM.detect aber ohne DB-Persist
      const rawPost = this._computePosterior(this._buildObservations(obs));
      const smoothed = this._smooth(rawPost);
      let bestState = 'RANGING', bestP = 0;
      for (const s of this.STATES) { if ((smoothed[s] || 0) > bestP) { bestP = smoothed[s]; bestState = s; } }
      this._lastState = bestState;
      return { state: bestState, posterior: smoothed, confidence: bestP };
    };

    const result = this._simulate(candles, ReplayHMM);
    result.event = eventName;
    result.eventMeta = ev;
    result.candleCount = candles.length;
    result.tsStart = candles[0].ts;
    result.tsEnd = candles[candles.length - 1].ts;
    this._lastResults[eventName] = result;
    return result;
  },

  async replayAll() {
    const out = {};
    for (const ev of Object.keys(EVENTS)) {
      try { out[ev] = await this.replay(ev); }
      catch(e) { out[ev] = { error: e.message }; }
    }
    return out;
  },

  snapshot() {
    return {
      events: Object.keys(EVENTS),
      lastResults: Object.fromEntries(
        Object.entries(this._lastResults).map(([k, v]) => [k, {
          totalReturn: v.totalReturn, maxDrawdown: v.maxDrawdown,
          killSwitchTriggered: v.killSwitchTriggered,
          crashStateExitTriggered: v.crashStateExitTriggered,
          tradesCount: v.tradesCount, winRate: v.winRate,
        }])
      ),
    };
  },

  EVENTS,
};

module.exports = BlackSwanReplay;
