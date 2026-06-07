// modules/stresstest.js — TIER2-B Stress-Test Framework
// 7 Black-Swan-Szenarien gegen synthetisches Portfolio (1000 USDT, 5 Positionen)
// READ-ONLY: simuliert Bot-Reaktion ohne echte Trades zu triggern.
// Misst: max DD, KillSwitch-Trigger, Recovery-Time, Bot-Survival.

'use strict';

const jobs = {};
let _counter = 0;
function newJobId() { return `ST-${Date.now()}-${++_counter}`; }

// Vereinfachte Portfolio-Engine für Stress-Sim
function simulatePortfolio(scenario, opts) {
  const capital = opts.capital || 1000;
  const duration = opts.duration || '24h';
  // Hours: parse "24h" / "1h" / "168h"
  const hours = (() => {
    const m = String(duration).match(/^(\d+)h$/);
    return m ? parseInt(m[1], 10) : 24;
  })();
  const ticks = hours * 60; // 1-min ticks
  // Start: 5 Positionen, je 60 USDT = 300 USDT committed, 700 USDT cash
  let equity = capital;
  let positions = [
    { sym: 'BTCUSDT', size: 60, price: 50000, entry: 50000 },
    { sym: 'ETHUSDT', size: 60, price: 3000, entry: 3000 },
    { sym: 'SOLUSDT', size: 60, price: 150, entry: 150 },
    { sym: 'LINKUSDT', size: 60, price: 10, entry: 10 },
    { sym: 'AVAXUSDT', size: 60, price: 9, entry: 9 },
  ];
  const startEquity = capital;
  let peak = capital;
  let maxDD = 0;
  let killSwitchTriggered = false;
  let recoveryTime = null;
  let dailyLossTriggered = false;
  const equityHistory = [];

  // Szenario-spezifische Preis-Schock-Funktion
  function priceShock(t, basePrice, baseScenario) {
    switch (baseScenario) {
      case 'flashCrash50pct': {
        // -50% in 5 Min (ab t=10), recovery linear bis t=120
        if (t < 10) return basePrice;
        if (t < 15) return basePrice * (1 - 0.5 * (t - 10) / 5);
        if (t < 120) return basePrice * 0.5 * (1 + 0.8 * (t - 15) / 105);
        return basePrice * 0.90; // 10% bleibt down
      }
      case 'blackSwanReplay2020': {
        // März 2020: -38% in 3 Tagen, dann V-Recovery
        // Wir simulieren in komprimierter Zeit
        if (t < 30) return basePrice;
        if (t < 90) return basePrice * (1 - 0.38 * (t - 30) / 60);
        return basePrice * 0.62 * (1 + 0.5 * Math.min(1, (t - 90) / 90));
      }
      case 'blackSwanReplay2022': {
        // FTX Kollaps: -25% über 7 Tage, kein Recovery
        const dropPct = Math.min(0.25, 0.25 * t / ticks);
        return basePrice * (1 - dropPct);
      }
      case 'liquidityDrought': {
        // Bid-Ask spread explodiert: simuliert als 10% Random-Walk-Vola, kein Trend
        const noise = Math.sin(t * 0.1) * 0.05 + (Math.random() - 0.5) * 0.05;
        return basePrice * (1 + noise);
      }
      case 'correlationBreakdown': {
        // Alle Coins fallen synchron -15%
        if (t < 60) return basePrice;
        const drop = Math.min(0.15, 0.15 * (t - 60) / 60);
        return basePrice * (1 - drop);
      }
      case 'exchangeOutage': {
        // 6h Bitget offline: Preise frozen, kein Update
        if (t < 60) return basePrice;
        if (t < 60 + 360) return basePrice; // frozen
        return basePrice * (1 + (Math.random() - 0.5) * 0.1); // catch-up
      }
      case 'slippage10pct': {
        // Normaler Preis, aber jede Order 10% Slippage (siehe unten)
        return basePrice;
      }
      default:
        return basePrice;
    }
  }

  for (let t = 1; t <= ticks; t++) {
    let unrealized = 0;
    let cashFlow = 0;
    for (const p of positions) {
      p.price = priceShock(t, p.entry, scenario);
      unrealized += (p.price - p.entry) / p.entry * p.size;
    }
    if (scenario === 'slippage10pct') {
      // Simuliere 10% slippage cost per tick × 1% turnover
      cashFlow -= 0.01 * 0.10 * 300;
    }
    equity = startEquity + unrealized + cashFlow;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
    equityHistory.push({ t, equity: +equity.toFixed(2), dd: +dd.toFixed(4) });

    // KillSwitch: DD >= 12% (CFG.MAX_DRAWDOWN_PCT)
    if (!killSwitchTriggered && dd >= 0.12) {
      killSwitchTriggered = true;
      // Simulate emergency close: 0.5% slippage exit cost
      equity *= 0.995;
    }
    // DailyLoss: realized < -15 (we use unrealized*0.7 as proxy)
    const realProxy = unrealized * 0.5;
    if (!dailyLossTriggered && realProxy < -15) {
      dailyLossTriggered = true;
    }
    // Recovery: equity zurück über 95% des Peaks
    if (recoveryTime === null && killSwitchTriggered && equity >= peak * 0.95) {
      recoveryTime = t;
    }
  }

  const finalEquity = equityHistory.length ? equityHistory[equityHistory.length - 1].equity : startEquity;
  const finalDD = (peak - finalEquity) / peak;
  const survived = finalEquity > startEquity * 0.5; // 50% capital remains

  return {
    scenario,
    startEquity,
    finalEquity: +finalEquity.toFixed(2),
    peak: +peak.toFixed(2),
    maxDrawdown: +(maxDD * 100).toFixed(2), // in %
    finalDrawdown: +(finalDD * 100).toFixed(2),
    killSwitchTriggered,
    dailyLossTriggered,
    botSurvived: survived,
    recoveryTimeMin: recoveryTime,
    ticks,
    sampleEquityCurve: equityHistory.filter((_, i) => i % Math.max(1, Math.floor(ticks / 50)) === 0),
  };
}

async function runScenario(jobId, opts) {
  const job = jobs[jobId];
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const scenarios = [
      'flashCrash50pct', 'blackSwanReplay2020', 'blackSwanReplay2022',
      'liquidityDrought', 'correlationBreakdown', 'exchangeOutage', 'slippage10pct',
    ];
    const results = {};
    if (opts.scenario && scenarios.includes(opts.scenario)) {
      results[opts.scenario] = simulatePortfolio(opts.scenario, opts);
    } else {
      for (const s of scenarios) {
        results[s] = simulatePortfolio(s, opts);
      }
    }
    const summary = {
      totalScenarios: Object.keys(results).length,
      survivedAll: Object.values(results).every(r => r.botSurvived),
      ksTriggeredScenarios: Object.values(results).filter(r => r.killSwitchTriggered).map(r => r.scenario),
      worstScenario: Object.values(results).reduce((a, b) => a.maxDrawdown > b.maxDrawdown ? a : b),
    };
    job.status = 'complete';
    job.completedAt = Date.now();
    job.result = { summary, scenarios: results };
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
}

function startJob(opts) {
  const jobId = newJobId();
  jobs[jobId] = { jobId, status: 'queued', opts };
  setImmediate(() => runScenario(jobId, opts));
  return { jobId, status: 'queued' };
}
function getStatus(jobId) {
  const j = jobs[jobId];
  return j ? { jobId, status: j.status, error: j.error } : { error: 'JOB_NOT_FOUND' };
}
function getResult(jobId) {
  const j = jobs[jobId];
  if (!j) return { error: 'JOB_NOT_FOUND' };
  return { jobId, status: j.status, ...j.result };
}
function listJobs() {
  return Object.values(jobs).map(j => ({ jobId: j.jobId, status: j.status }));
}
const SCENARIOS = [
  'flashCrash50pct', 'blackSwanReplay2020', 'blackSwanReplay2022',
  'liquidityDrought', 'correlationBreakdown', 'exchangeOutage', 'slippage10pct',
];
module.exports = { startJob, getStatus, getResult, listJobs, SCENARIOS };
