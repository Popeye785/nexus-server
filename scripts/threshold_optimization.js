// Block L Walk-Forward Threshold-Optimization (Lopez de Prado Ch.6 Style)
// READ-ONLY: keine Bot-Änderung. Berechnet Sharpe/Sortino/PnL pro Config-Kandidat.
//
// Pfad: für jeden Konfigurations-Kandidaten:
//   1) Filter aladdin_decisions nach Config-spezifischen Schwellen
//   2) Join nächstes ml_tb_labels (within +1h Zukunft)
//   3) hit_return als Roh-Outcome
//   4) Aggregiere PnL, Sharpe, Sortino, Profit-Factor, Win-Rate
//
// Annahmen:
//   - Position-Size = 1 unit (Vergleich relativ)
//   - 0.1% Maker + 0.1% Taker = 0.2% Round-Trip-Fees
//   - hit_return ist signed return: +X% (TP-Hit) oder -X% (SL-Hit) oder 0 (Timeout)
//   - BUY-Decision: Outcome = +hit_return
//   - SELL-Decision: Outcome = -hit_return (short-side)

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const FEE_ROUNDTRIP = 0.002; // 0.1% × 2

const db = new Database(DB_PATH, { readonly: true });

// ── Sample-Window
const WINDOW_DAYS = 9; // 18.05 - 27.05 (alle TB-Labels-Coverage)
const SINCE = Date.now() - WINDOW_DAYS * 86400000;

console.log('═══ WALK-FORWARD THRESHOLD-OPTIMIZATION ═══');
console.log(`Sample-Window: letzte ${WINDOW_DAYS} Tage (${new Date(SINCE).toISOString()})`);

// ── 1. Lade alle Decisions + nearest TB-Label
const decisions = db.prepare(`
  SELECT ad.ts, ad.symbol, ad.decision, ad.confidence, ad.unified_conf, ad.regime,
         (SELECT tb.hit_return FROM ml_tb_labels tb
          WHERE tb.symbol = ad.symbol AND tb.t0_ts >= ad.ts AND tb.t0_ts < ad.ts + 3600000
          ORDER BY tb.t0_ts ASC LIMIT 1) as outcome_return,
         (SELECT tb.label FROM ml_tb_labels tb
          WHERE tb.symbol = ad.symbol AND tb.t0_ts >= ad.ts AND tb.t0_ts < ad.ts + 3600000
          ORDER BY tb.t0_ts ASC LIMIT 1) as outcome_label
  FROM aladdin_decisions ad
  WHERE ad.ts > ? AND ad.decision IN ('BUY','SELL') AND ad.confidence >= 0.05
`).all(SINCE);

const withOutcome = decisions.filter(d => d.outcome_return !== null);
console.log(`Decisions im Window: ${decisions.length}, mit Forward-Outcome: ${withOutcome.length}`);

// ── 2. Helper-Funktionen
function applyConfig(rows, cfg) {
  return rows.filter(r => {
    // Confidence-Floor
    if (r.confidence < cfg.minConf) return false;
    if (cfg.maxConf && r.confidence > cfg.maxConf) return false;
    // Regime-spezifischer Floor (adaptive)
    if (cfg.regimeFloor && cfg.regimeFloor[r.regime] !== undefined) {
      if (r.confidence < cfg.regimeFloor[r.regime]) return false;
    }
    // Symbol-Whitelist
    if (cfg.symbolWhitelist && !cfg.symbolWhitelist.includes(r.symbol)) return false;
    return true;
  });
}

function computeMetrics(filteredRows, cfg) {
  if (filteredRows.length === 0) return { trades: 0, reason: 'NO_TRADES' };
  const returns = filteredRows.map(r => {
    // Direction-aware: BUY = +outcome, SELL = -outcome
    const grossRet = r.decision === 'BUY' ? r.outcome_return : -r.outcome_return;
    // Optional Position-Sizing by Confidence (cfg.sizeByConf=true)
    const sizeFactor = cfg.sizeByConf ? Math.min(1.5, r.confidence / 0.20) : 1.0;
    const netRet = (grossRet * sizeFactor) - FEE_ROUNDTRIP;
    return netRet;
  });
  const n = returns.length;
  const sumPnl = returns.reduce((a,b)=>a+b, 0);
  const mean = sumPnl / n;
  const wins = returns.filter(r => r > 0).length;
  const losses = returns.filter(r => r <= 0).length;
  const winRate = wins / n;
  const totalWin = returns.filter(r => r > 0).reduce((a,b)=>a+b, 0);
  const totalLoss = Math.abs(returns.filter(r => r <= 0).reduce((a,b)=>a+b, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : null;
  // Stddev
  const variance = returns.reduce((a,b)=>a+(b-mean)**2, 0) / n;
  const stddev = Math.sqrt(variance);
  // Sharpe (no risk-free, daily-equivalent assuming each trade ~1h)
  const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252 * 24) : 0;
  // Sortino (downside-stddev only)
  const downsideRets = returns.filter(r => r < 0);
  const downsideStdDev = downsideRets.length > 0
    ? Math.sqrt(downsideRets.reduce((a,b)=>a+b*b, 0) / downsideRets.length)
    : 0.0001;
  const sortino = downsideStdDev > 0 ? (mean / downsideStdDev) * Math.sqrt(252 * 24) : 0;
  // Max-DD (cum-sum drawdown)
  let cum = 0, peak = 0, maxDD = 0;
  for (const r of returns) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  // Calmar (Annual-Mean / Max-DD)
  const annualMean = mean * 252 * 24;
  const calmar = maxDD > 0 ? annualMean / maxDD : 0;
  return {
    trades: n,
    wins, losses,
    winRate: +(winRate * 100).toFixed(1),
    totalPnl: +sumPnl.toFixed(4),
    avgPnl: +mean.toFixed(5),
    profitFactor: profitFactor ? +profitFactor.toFixed(2) : null,
    sharpe: +sharpe.toFixed(2),
    sortino: +sortino.toFixed(2),
    calmar: +calmar.toFixed(2),
    maxDD: +maxDD.toFixed(4),
    avgWinPct: wins > 0 ? +(totalWin / wins * 100).toFixed(3) : null,
    avgLossPct: losses > 0 ? +(totalLoss / losses * 100).toFixed(3) : null,
  };
}

// ── 3. Definiere Configs (15 Konfigurationen)
const configs = [
  // === A. Baseline + Schwellen-Variants ===
  { name: 'A0-Baseline-0.20', minConf: 0.20 },
  { name: 'A1-Floor-0.15', minConf: 0.15 },
  { name: 'A2-Floor-0.10', minConf: 0.10 },
  { name: 'A3-Floor-0.12', minConf: 0.12 },
  { name: 'A4-Floor-0.08', minConf: 0.08 }, // = SCORE_FLOOR
  { name: 'A5-VeryStrict-0.25', minConf: 0.25 },
  // === B. Confidence-Sized Position ===
  { name: 'B1-Conf-Size-0.10', minConf: 0.10, sizeByConf: true },
  { name: 'B2-Conf-Size-0.15', minConf: 0.15, sizeByConf: true },
  // === C. Regime-Adaptive (aus Sub-Agent Z.288-294) ===
  { name: 'C1-Regime-Adapt', minConf: 0.10, regimeFloor: {
    'BULL': 0.08, 'NEUTRAL': 0.10, 'RANGING': 0.12, 'CHOPPY': 0.15,
    'BEAR': 0.15, 'STRONG_BULL': 0.10, 'EXTREME': 0.20, 'SQUEEZE': 0.08
  } },
  { name: 'C2-Regime-Adapt-Loose', minConf: 0.08, regimeFloor: {
    'BULL': 0.06, 'NEUTRAL': 0.08, 'RANGING': 0.10, 'CHOPPY': 0.12,
    'BEAR': 0.12, 'STRONG_BULL': 0.08, 'EXTREME': 0.15, 'SQUEEZE': 0.06
  } },
  // === D. Symbol-Selective ===
  { name: 'D1-WinnerSymbols', minConf: 0.10, symbolWhitelist: ['NEARUSDT','ATOMUSDT','BTCUSDT','ETHUSDT'] },
  { name: 'D2-OldOnly', minConf: 0.10, symbolWhitelist: ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','NEARUSDT','SUIUSDT'] },
  // === E. Confidence-Range (sweet-spot mid-range) ===
  { name: 'E1-MidRange-0.12-0.18', minConf: 0.12, maxConf: 0.18 },
  { name: 'E2-HighOnly-0.18+', minConf: 0.18 },
  // === F. Combination ===
  { name: 'F1-Combined-BestOf', minConf: 0.10, sizeByConf: true, regimeFloor: {
    'BULL': 0.08, 'NEUTRAL': 0.10, 'RANGING': 0.12, 'CHOPPY': 0.15,
    'BEAR': 0.15, 'STRONG_BULL': 0.10, 'EXTREME': 0.20, 'SQUEEZE': 0.08
  }, symbolWhitelist: ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','NEARUSDT','SUIUSDT'] },
];

// ── 4. Run + Output
const results = configs.map(cfg => {
  const filtered = applyConfig(withOutcome, cfg);
  const m = computeMetrics(filtered, cfg);
  return { name: cfg.name, ...m };
});

console.log('\n─── RESULTS TABLE ───');
console.log('Name'.padEnd(28), 'Trades'.padEnd(7), 'WR%'.padEnd(6), 'PnL'.padEnd(8), 'Sharpe'.padEnd(7), 'Sortino'.padEnd(8), 'Calmar'.padEnd(7), 'PF'.padEnd(6), 'MaxDD');
console.log('-'.repeat(85));
results.forEach(r => {
  console.log(
    r.name.padEnd(28),
    String(r.trades).padEnd(7),
    String(r.winRate || '-').padEnd(6),
    String(r.totalPnl || '-').padEnd(8),
    String(r.sharpe || '-').padEnd(7),
    String(r.sortino || '-').padEnd(8),
    String(r.calmar || '-').padEnd(7),
    String(r.profitFactor || '-').padEnd(6),
    String(r.maxDD || '-')
  );
});

// ── 5. Top by Sharpe
console.log('\n─── TOP-5 by SHARPE ───');
results
  .filter(r => r.trades >= 20)
  .sort((a,b) => (b.sharpe||0) - (a.sharpe||0))
  .slice(0, 5)
  .forEach((r, i) => {
    console.log(`${i+1}. ${r.name} → Sharpe=${r.sharpe} Sortino=${r.sortino} PF=${r.profitFactor} trades=${r.trades} PnL=${r.totalPnl}`);
  });

console.log('\n─── TOP-5 by SORTINO ───');
results
  .filter(r => r.trades >= 20)
  .sort((a,b) => (b.sortino||0) - (a.sortino||0))
  .slice(0, 5)
  .forEach((r, i) => {
    console.log(`${i+1}. ${r.name} → Sortino=${r.sortino} Sharpe=${r.sharpe} PF=${r.profitFactor} trades=${r.trades} PnL=${r.totalPnl}`);
  });

db.close();
