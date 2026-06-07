// modules/backtest_engine.js — Backtest-Engine (separat vom Live-Bot)
// AUDFIX_BACKTEST_ENGINE [2026-05-18]
//
// Liest CSVs aus historical_data/, simuliert Brain-Decision-Pfad offline.
// Brain-Logik NICHT importiert (Schutzzone) — eigene Decision-Approximation
// die das gleiche Konzept (5-Familie-Konsens) nutzt aber separat ist.
// Turbo-Modus aktiviert SHARPE_SOFTMAX + ADAPTIVE_LR Schalter sandbox-only.

'use strict';

const fs = require('fs');
const path = require('path');

// CSV-Loader für Format: unix,date,symbol,open,high,low,close,Volume USDT
function loadCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const header = lines[0].split(',');
  const idxUnix = header.indexOf('unix');
  const idxDate = header.indexOf('date');
  const idxOpen = header.indexOf('open');
  const idxHigh = header.indexOf('high');
  const idxLow = header.indexOf('low');
  const idxClose = header.indexOf('close');
  const idxVol = header.findIndex(h => h.toLowerCase().includes('volume'));
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 7) continue;
    candles.push({
      ts: parseInt(cols[idxUnix]),
      date: cols[idxDate],
      open: parseFloat(cols[idxOpen]),
      high: parseFloat(cols[idxHigh]),
      low: parseFloat(cols[idxLow]),
      close: parseFloat(cols[idxClose]),
      volume: parseFloat(cols[idxVol]) || 0,
    });
  }
  return candles;
}

// Indikatoren
function sma(arr, period) {
  if (arr.length < period) return null;
  let sum = 0;
  for (let i = arr.length - period; i < arr.length; i++) sum += arr[i];
  return sum / period;
}

function ema(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let ema = arr[arr.length - period];
  for (let i = arr.length - period + 1; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
  }
  return ema;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length);
}

// 5-Familie-Konsens-Approximation (BRAIN-LIKE, eigene Sandbox-Implementation)
// Schutzzone: ähnliches Konzept, aber separate Implementation für offline-Tests.
function consensusDecide(candles, idx, options = {}) {
  if (idx < 50) return { action: 'HOLD', confidence: 0, votes: {} };
  const window = candles.slice(Math.max(0, idx - 50), idx + 1);
  const closes = window.map(c => c.close);
  const highs = window.map(c => c.high);
  const lows = window.map(c => c.low);

  const lastClose = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const rsi14 = rsi(closes, 14);
  const recentVol = stdDev(closes.slice(-20));
  const longerVol = stdDev(closes.slice(-50));
  const volRatio = longerVol > 0 ? recentVol / longerVol : 1;

  // 5 Family Votes (Skala -1 SELL, 0 HOLD, +1 BUY)
  const votes = {};

  // TREND: SMA-Crossover + EMA-Trend
  votes.TREND = (sma20 && sma50 && sma20 > sma50 ? 1 : sma20 < sma50 ? -1 : 0);

  // MOMENTUM: RSI
  votes.MOMENTUM = (rsi14 > 60 ? 1 : rsi14 < 40 ? -1 : 0);

  // RISK: Volatility regime (high vol → cautious)
  votes.RISK = (volRatio > 1.5 ? -0.5 : volRatio < 0.7 ? 0.5 : 0);

  // SENTIMENT: Price-momentum (close vs sma20)
  votes.SENTIMENT = (sma20 && lastClose > sma20 * 1.005 ? 1 : sma20 && lastClose < sma20 * 0.995 ? -1 : 0);

  // MICROSTRUCTURE: High-Low-Spread (proxy for liquidity)
  const recentRange = (highs[highs.length - 1] - lows[lows.length - 1]) / lastClose;
  votes.MICRO = (recentRange < 0.005 ? 0.5 : recentRange > 0.02 ? -0.5 : 0);

  // FAMILY-WEIGHTS (V14.4 empirisch)
  const weights = {
    TREND: 0.20, MOMENTUM: 0.15, RISK: 0.20, SENTIMENT: 0.25, MICRO: 0.20,
  };

  let score = 0;
  for (const fam in votes) score += votes[fam] * weights[fam];

  // SHARPE-SOFTMAX (Turbo-Schalter)
  if (options.sharpeSoftmax && options.voterSharpes) {
    const fams = Object.keys(votes);
    const sharpes = fams.map(f => options.voterSharpes[f] || 0);
    const expVals = sharpes.map(s => Math.exp(s));
    const sumExp = expVals.reduce((a, b) => a + b, 0) || 1;
    const winnerIdx = sharpes.indexOf(Math.max(...sharpes));
    const winnerWeight = expVals[winnerIdx] / sumExp;
    const adjustment = 1 + 0.2 * (winnerWeight - 1 / fams.length);
    score *= adjustment;
  }

  const SCORE_FLOOR = options.scoreFloor || 0.04;
  const SCORE_FLOOR_STRICT = options.scoreFloorStrict || 0.08;
  // Im Turbo-EIN (BRAIN_MODE='authority') wird strenger Floor angewandt
  const floor = options.brainAuthority ? SCORE_FLOOR_STRICT : SCORE_FLOOR;

  const action = score > floor ? 'BUY' : score < -floor ? 'SELL' : 'HOLD';
  return {
    action,
    confidence: Math.min(1, Math.abs(score) / 0.5),
    score,
    votes,
    indicators: { sma20, sma50, ema12, ema26, rsi14, volRatio, recentRange },
  };
}

// Backtest-Lauf
function runBacktest(candles, options = {}) {
  const startEquity = options.startEquity || 1000;
  const positionSize = options.positionSize || 0.05; // 5% per trade
  const takerFee = 0.0006;
  const slippage = 0.0002;
  const slPct = options.slPct || 0.02;
  const tpPct = options.tpPct || 0.04;

  let cash = startEquity;
  let position = null; // { side, entryPrice, size, entryIdx, sl, tp }
  const trades = [];
  const equityCurve = [];

  // Sharpe-Tracking pro Family für Turbo
  const familyPnL = { TREND: [], MOMENTUM: [], RISK: [], SENTIMENT: [], MICRO: [] };
  let voterSharpes = null;

  for (let i = 60; i < candles.length; i++) {
    const candle = candles[i];

    // Exit-Check (SL/TP)
    if (position) {
      let exitReason = null;
      let exitPrice = null;
      if (position.side === 'BUY') {
        if (candle.low <= position.sl) { exitReason = 'SL'; exitPrice = position.sl; }
        else if (candle.high >= position.tp) { exitReason = 'TP'; exitPrice = position.tp; }
      } else {
        if (candle.high >= position.sl) { exitReason = 'SL'; exitPrice = position.sl; }
        else if (candle.low <= position.tp) { exitReason = 'TP'; exitPrice = position.tp; }
      }
      if (exitReason) {
        const sideMult = position.side === 'BUY' ? 1 : -1;
        const grossPnl = sideMult * (exitPrice - position.entryPrice) * position.size / position.entryPrice;
        const fees = position.size * takerFee * 2;
        const netPnl = grossPnl - fees;
        cash += position.size + netPnl;
        trades.push({
          symbol: candle.symbol || 'BTCUSDT',
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          size: position.size,
          netPnl,
          exitReason,
          entryIdx: position.entryIdx,
          exitIdx: i,
          holdHours: i - position.entryIdx,
          family: position.votedFamily,
        });
        // Family-Sharpe update
        if (position.votedFamily && familyPnL[position.votedFamily]) {
          familyPnL[position.votedFamily].push(netPnl);
        }
        position = null;
      }
    }

    // Entry-Check
    if (!position && cash > 50) {
      // Update voterSharpes für Turbo (rolling 50)
      if (options.sharpeSoftmax) {
        voterSharpes = {};
        for (const fam in familyPnL) {
          const recent = familyPnL[fam].slice(-50);
          if (recent.length > 5) {
            const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
            const sd = stdDev(recent);
            voterSharpes[fam] = sd > 0 ? mean / sd : 0;
          } else voterSharpes[fam] = 0;
        }
      }

      const decision = consensusDecide(candles, i, { ...options, voterSharpes });
      if (decision.action !== 'HOLD' && decision.confidence > 0.2) {
        const size = cash * positionSize;
        if (size > 5) {
          const entryPrice = candle.close * (decision.action === 'BUY' ? (1 + slippage) : (1 - slippage));
          const sl = decision.action === 'BUY' ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
          const tp = decision.action === 'BUY' ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);
          // Welche Family hat hier am stärksten gevotet?
          let winner = 'TREND'; let winnerVal = 0;
          for (const f in decision.votes) {
            if (Math.abs(decision.votes[f]) > Math.abs(winnerVal)) { winnerVal = decision.votes[f]; winner = f; }
          }
          position = {
            side: decision.action,
            entryPrice,
            size,
            entryIdx: i,
            sl, tp,
            votedFamily: winner,
            score: decision.score,
          };
          cash -= size;
        }
      }
    }

    // Equity tracking jede 100 Kerzen
    if (i % 100 === 0) {
      const equity = cash + (position ? position.size : 0);
      equityCurve.push({ idx: i, ts: candle.ts, equity });
    }
  }

  // Force-close offene Position am Ende
  if (position && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const sideMult = position.side === 'BUY' ? 1 : -1;
    const grossPnl = sideMult * (lastCandle.close - position.entryPrice) * position.size / position.entryPrice;
    const fees = position.size * takerFee * 2;
    const netPnl = grossPnl - fees;
    cash += position.size + netPnl;
    trades.push({
      symbol: 'BTCUSDT', side: position.side,
      entryPrice: position.entryPrice, exitPrice: lastCandle.close,
      size: position.size, netPnl, exitReason: 'END',
      entryIdx: position.entryIdx, exitIdx: candles.length - 1,
      holdHours: candles.length - 1 - position.entryIdx,
      family: position.votedFamily,
    });
  }

  // Metriken
  const finalEquity = cash;
  const totalReturn = (finalEquity - startEquity) / startEquity;
  const wins = trades.filter(t => t.netPnl > 0).length;
  const losses = trades.filter(t => t.netPnl < 0).length;
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  const grossWin = trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  // Sharpe (per-trade returns)
  const returns = trades.map(t => t.netPnl / t.size);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const sdReturn = returns.length > 1 ? stdDev(returns) : 0;
  const sharpe = sdReturn > 0 ? (avgReturn / sdReturn) * Math.sqrt(252 * 24) : 0; // hourly → annual

  // Max-DD
  let peak = startEquity;
  let maxDD = 0;
  for (const e of equityCurve) {
    if (e.equity > peak) peak = e.equity;
    const dd = (peak - e.equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    startEquity, finalEquity, totalReturn, totalReturnPct: totalReturn * 100,
    trades: trades.length, wins, losses, winRate, winRatePct: winRate * 100,
    profitFactor, sharpe, maxDD, maxDDPct: maxDD * 100,
    avgPnL: trades.length > 0 ? trades.reduce((s, t) => s + t.netPnl, 0) / trades.length : 0,
    grossWin, grossLoss,
    tradesList: trades.slice(0, 10), // erste 10 für Diagnose
    equityCurveLast: equityCurve.slice(-5),
    options: {
      brainAuthority: !!options.brainAuthority,
      sharpeSoftmax: !!options.sharpeSoftmax,
      adaptiveLR: !!options.adaptiveLR,
      scoreFloor: options.scoreFloor || 0.04,
      slPct, tpPct, positionSize,
    },
  };
}

// Walk-Forward Wrapper: rolling 70/30 windows
function runWalkForward(candles, options = {}) {
  const windowSize = options.windowSize || 8760; // 1 year
  const trainPct = options.trainPct || 0.7;
  const stepSize = options.stepSize || 720; // 30 days
  const results = [];
  let windowIdx = 0;
  for (let start = 0; start + windowSize < candles.length; start += stepSize) {
    const window = candles.slice(start, start + windowSize);
    const trainEnd = Math.floor(window.length * trainPct);
    const trainSet = window.slice(0, trainEnd);
    const testSet = window.slice(trainEnd);
    // Training: nothing to train in this simple engine — wir simulieren in-sample für Vergleich
    const trainResult = runBacktest(trainSet, options);
    const testResult = runBacktest(testSet, options);
    results.push({
      window: windowIdx,
      startIdx: start, trainEndIdx: start + trainEnd, endIdx: start + windowSize,
      startDate: candles[start].date,
      endDate: candles[start + windowSize - 1].date,
      train: {
        sharpe: trainResult.sharpe, maxDD: trainResult.maxDD,
        winRate: trainResult.winRate, profitFactor: trainResult.profitFactor,
        trades: trainResult.trades, totalReturn: trainResult.totalReturn,
      },
      test: {
        sharpe: testResult.sharpe, maxDD: testResult.maxDD,
        winRate: testResult.winRate, profitFactor: testResult.profitFactor,
        trades: testResult.trades, totalReturn: testResult.totalReturn,
      },
      wfe: trainResult.sharpe > 0 ? testResult.sharpe / trainResult.sharpe : 0, // Walk-Forward Efficiency
    });
    windowIdx++;
    if (windowIdx > 100) break; // safety
  }
  return { windows: results.length, results };
}

module.exports = { loadCSV, runBacktest, runWalkForward, consensusDecide };
