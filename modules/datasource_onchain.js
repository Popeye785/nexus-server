// modules/datasource_onchain.js — On-Chain-Daten-Aggregator (STUFE 7)
// Verankert 2026-05-20 (Boutique-Quant-A).
//
// Free-Tier-Only Quellen:
//   1. mempool.space: Bitcoin Mempool Fees + Block-Stats (kein Key)
//   2. blockchain.info: BTC Daily Stats (kein Key, public)
//   3. Etherscan: ETH gas-tracker (kein Key für basic-tier)
//
// Signal-Logic:
//   - HIGH Mempool fees + spike TPS → demand pressure (BULLISH)
//   - Plummeting fees + low TPS → low activity (NEUTRAL/BEARISH)
//   - Network-Hashrate drop → miner-capitulation (BEARISH)
//
// Output Format kompatibel zu existing OnChainAnalysis:
//   getSignal(symbol) → { signal: 'BULLISH'|'BEARISH'|'NEUTRAL', netFlow, ts }
//
// Cron 15min, Cache 10min. Persistierung in on_chain_state Tabelle.

'use strict';

const axios = require('axios');

const DataSourceOnChain = {
  _db: null,
  _logFn: null,
  _cronTimer: null,
  _cache: {
    btc_fees: null,        // { fastest, halfHour, hour, ts }
    btc_marketcap: null,
    btc_stats: null,       // tps, hashrate, difficulty
    eth_gas: null,         // { fast, std, slow, ts }
  },
  TTL: {
    fees: 10 * 60 * 1000,
    market: 30 * 60 * 1000,
    stats: 60 * 60 * 1000,
    gas: 10 * 60 * 1000,
  },

  // Historische-Schwellen aus 2024-2026 BTC mempool fees
  FEE_THRESHOLDS: {
    LOW: 5,          // < 5 sat/vB = ruhig
    NORMAL: 20,
    HIGH: 50,        // > 50 = activity-spike
    EXTREME: 150,
  },
  ETH_GAS_THRESHOLDS: {
    LOW: 10,         // gwei
    NORMAL: 30,
    HIGH: 80,
    EXTREME: 200,
  },

  init(db) {
    this._db = db;
    this._logFn = (typeof Log !== 'undefined' && Log.info) ? Log : { info: console.log, warn: console.warn };
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS on_chain_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          source TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL,
          meta TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_onchain_ts ON on_chain_state(ts);
        CREATE INDEX IF NOT EXISTS idx_onchain_metric ON on_chain_state(metric, ts);
      `);
    } catch(_) {}
  },

  _persist(source, metric, value, meta) {
    if (!this._db) return;
    try {
      this._db.prepare(`INSERT INTO on_chain_state (ts, source, metric, value, meta) VALUES (?,?,?,?,?)`).run(
        Date.now(), source, metric, value, meta ? JSON.stringify(meta).slice(0, 400) : null
      );
    } catch(_) {}
  },

  // ─── Fetcher: mempool.space ──────────────────────────────────────
  async _fetchBtcFees() {
    const now = Date.now();
    if (this._cache.btc_fees && (now - this._cache.btc_fees.ts) < this.TTL.fees) return this._cache.btc_fees;
    try {
      const r = await axios.get('https://mempool.space/api/v1/fees/recommended', { timeout: 8000 });
      const d = r.data;
      if (d && typeof d.fastestFee === 'number') {
        const out = {
          fastest: d.fastestFee, halfHour: d.halfHourFee, hour: d.hourFee,
          economy: d.economyFee, minimum: d.minimumFee, ts: now,
        };
        this._cache.btc_fees = out;
        this._persist('mempool.space', 'btc_fees_fastest', out.fastest, { halfHour: out.halfHour, hour: out.hour });
        return out;
      }
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('ONCHAIN', 'btc_fees fail: '+e.message); } catch(_){}
    }
    return this._cache.btc_fees;
  },

  // ─── Fetcher: blockchain.info ────────────────────────────────────
  async _fetchBtcStats() {
    const now = Date.now();
    if (this._cache.btc_stats && (now - this._cache.btc_stats.ts) < this.TTL.stats) return this._cache.btc_stats;
    try {
      const [tpsRes, hashRes] = await Promise.all([
        axios.get('https://blockchain.info/q/24hrtransactioncount', { timeout: 8000 }),
        axios.get('https://blockchain.info/q/hashrate', { timeout: 8000 }),
      ]);
      const tx24h = parseFloat(tpsRes.data);
      const hashrate = parseFloat(hashRes.data);
      if (isFinite(tx24h) && isFinite(hashrate)) {
        const out = { tx_24h: tx24h, hashrate_THs: hashrate, ts: now };
        this._cache.btc_stats = out;
        this._persist('blockchain.info', 'btc_tx_24h', tx24h, { hashrate });
        return out;
      }
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('ONCHAIN', 'btc_stats fail: '+e.message); } catch(_){}
    }
    return this._cache.btc_stats;
  },

  // ─── Fetcher: ETH Gas (Etherscan) ────────────────────────────────
  async _fetchEthGas() {
    const now = Date.now();
    // P6.1 [2026-06-04]: TTL respektiert auch negativ-Cache (unavailable=true).
    if (this._cache.eth_gas && (now - this._cache.eth_gas.ts) < this.TTL.gas) return this._cache.eth_gas;
    try {
      // MEGA5_P1 [20.05.2026]: Etherscan-API-Key via ENV (no-key tier hat 2026 strikte Limits)
      const _key = (process.env.ETHERSCAN_API_KEY || '').trim();
      const _url = 'https://api.etherscan.io/api?module=gastracker&action=gasoracle'
                 + (_key ? ('&apikey=' + _key) : '');
      const r = await axios.get(_url, { timeout: 8000 });
      const d = r.data?.result;
      if (d && d.ProposeGasPrice) {
        const out = {
          fast: parseFloat(d.FastGasPrice),
          standard: parseFloat(d.ProposeGasPrice),
          slow: parseFloat(d.SafeGasPrice),
          ts: now,
        };
        this._cache.eth_gas = out;
        this._persist('etherscan', 'eth_gas_standard', out.standard, { fast: out.fast, slow: out.slow, has_key: !!_key });
        return out;
      } else if (r.data?.status === '0' || r.data?.message?.includes('rate')) {
        // P6.1 [2026-06-04]: Negativ-Cache mit TTL → keine erneuten HTTP-Calls bis TTL.gas.
        // Log nur 1x pro TTL-Fenster (Spam-Schutz: pro Symbol-Scan war es vorher 1 Log).
        this._cache.eth_gas = { fast: 0, standard: 0, slow: 0, ts: now, unavailable: true, reason: 'RATE_LIMIT' };
        try { this._logFn.warn && this._logFn.warn('ONCHAIN', 'eth_gas rate-limit: ' + (r.data?.message||'unknown') + ' — negative cache aktiv bis TTL'); } catch(_) {}
      }
    } catch(e) {
      // P6.1: auch bei HTTP-Fehler Negativ-Cache setzen, sonst Retry-Storm.
      this._cache.eth_gas = { fast: 0, standard: 0, slow: 0, ts: now, unavailable: true, reason: 'FETCH_FAIL' };
      try { this._logFn.warn && this._logFn.warn('ONCHAIN', 'eth_gas fail: '+e.message+' — negative cache aktiv bis TTL'); } catch(_){}
    }
    return this._cache.eth_gas;
  },

  // ─── Public: getSignal pro Symbol ────────────────────────────────
  // Symbol → BTC/ETH-Mapping. Andere Coins → derive aus BTC-state als proxy
  async getSignal(symbol) {
    const coin = (symbol || 'BTCUSDT').replace('USDT', '').toUpperCase();
    let signal = 'NEUTRAL', score = 0, conf = 0, netFlow = 0;
    const factors = [];

    // BTC primary
    const btcFees = await this._fetchBtcFees();
    if (btcFees) {
      const f = btcFees.fastest;
      if (f >= this.FEE_THRESHOLDS.EXTREME) { score += 0.4; factors.push(`BTC_FEES_EXTREME_${f}sat`); }
      else if (f >= this.FEE_THRESHOLDS.HIGH) { score += 0.2; factors.push(`BTC_FEES_HIGH_${f}sat`); }
      else if (f >= this.FEE_THRESHOLDS.NORMAL) { factors.push(`BTC_FEES_NORMAL_${f}sat`); }
      else if (f < this.FEE_THRESHOLDS.LOW) { score -= 0.1; factors.push(`BTC_FEES_LOW_${f}sat`); }
      conf = Math.max(conf, 0.4);
    }

    // ETH gas (für ETHUSDT primär, sonst supplementary)
    if (coin === 'ETH' || coin === 'BTC') {
      const ethG = await this._fetchEthGas();
      // P6.1 [2026-06-04]: Negativ-Cache (unavailable=true) → NEUTRAL, kein Score-Beitrag.
      if (ethG && !ethG.unavailable) {
        const g = ethG.standard;
        if (g >= this.ETH_GAS_THRESHOLDS.EXTREME) { score += 0.3; factors.push(`ETH_GAS_EXTREME_${g}gwei`); }
        else if (g >= this.ETH_GAS_THRESHOLDS.HIGH) { score += 0.15; factors.push(`ETH_GAS_HIGH_${g}gwei`); }
        else if (g < this.ETH_GAS_THRESHOLDS.LOW) { score -= 0.05; factors.push(`ETH_GAS_LOW_${g}gwei`); }
        conf = Math.max(conf, 0.5);
      }
    }

    // BTC Stats (TPS) als momentum-Indikator
    const btcStats = await this._fetchBtcStats();
    if (btcStats && btcStats.tx_24h) {
      // 350-500k tx/24h ist baseline 2024-2026. > 600k = aktivitäts-spike
      if (btcStats.tx_24h > 600000) { score += 0.15; factors.push('BTC_TX_SPIKE'); }
      else if (btcStats.tx_24h < 250000) { score -= 0.1; factors.push('BTC_TX_LOW'); }
      conf = Math.max(conf, 0.55);
    }

    score = Math.max(-1, Math.min(1, score));
    if (score > 0.15) signal = 'BULLISH';
    else if (score < -0.15) signal = 'BEARISH';

    return { signal, score: +score.toFixed(3), confidence: +conf.toFixed(2), factors, netFlow, ts: Date.now() };
  },

  // ─── MEGA5_P1 [20.05.2026]: ETH Whale-Transfers >100 ETH letzte 10 Blöcke ────
  // Etherscan account/txlistinternal mit min-value-filter via key
  async _fetchEthWhales() {
    const _key = (process.env.ETHERSCAN_API_KEY || '').trim();
    if (!_key) return null;  // ohne key kein whale-detection
    try {
      // Letzten Block holen
      const bRes = await axios.get(`https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${_key}`, { timeout: 8000 });
      const blockHex = bRes.data?.result;
      if (!blockHex) return null;
      const block = parseInt(blockHex, 16);
      const fromBlock = '0x' + (block - 5).toString(16);
      // Suche grosse Internal-Txs in den letzten 5 Blöcken
      // Vereinfacht: liest die letzten 100 normalen Transactions vom Etherscan-API
      // Whale-Threshold: > 100 ETH (= ~$200-400k 2026)
      const tRes = await axios.get(
        `https://api.etherscan.io/api?module=proxy&action=eth_getBlockByNumber&tag=${blockHex}&boolean=true&apikey=${_key}`,
        { timeout: 8000 }
      );
      const txs = tRes.data?.result?.transactions || [];
      const whales = [];
      for (const tx of txs) {
        const valWei = BigInt(tx.value || '0x0');
        const valEth = Number(valWei) / 1e18;
        if (valEth >= 100) {
          whales.push({ from: tx.from, to: tx.to, eth: valEth });
        }
      }
      if (whales.length > 0) {
        this._persist('etherscan', 'eth_whales_count', whales.length, { block, sample: whales.slice(0,3) });
        try { this._logFn.info && this._logFn.info('ONCHAIN', `ETH whales latest block: ${whales.length} txs ≥100 ETH`); } catch(_) {}
      }
      return { whales_count: whales.length, block, ts: Date.now() };
    } catch(e) {
      try { this._logFn.warn && this._logFn.warn('ONCHAIN', 'eth_whales fail: '+e.message); } catch(_) {}
      return null;
    }
  },

  // ─── Cron 15min ───────────────────────────────────────────────────
  startCron() {
    if (this._cronTimer) return;
    const tick = async () => {
      try {
        await Promise.all([this._fetchBtcFees(), this._fetchBtcStats(), this._fetchEthGas()]);
        // MEGA5_P1: Whales-Check nur alle 30min (5-call rate-limit-Schutz)
        if (!this._lastWhaleCheck || (Date.now() - this._lastWhaleCheck) > 30 * 60 * 1000) {
          await this._fetchEthWhales().catch(()=>{});
          this._lastWhaleCheck = Date.now();
        }
      } catch(_) {}
    };
    setTimeout(tick, 25000);
    this._cronTimer = setInterval(tick, 15 * 60 * 1000);
    try { this._logFn.info && this._logFn.info('ONCHAIN', 'cron started (15min, mempool+blockchain+etherscan+whales)'); } catch(_) {}
  },

  snapshot() {
    return {
      cache: this._cache,
      ttl: this.TTL,
      thresholds_btc: this.FEE_THRESHOLDS,
      thresholds_eth: this.ETH_GAS_THRESHOLDS,
    };
  },
};

module.exports = DataSourceOnChain;
