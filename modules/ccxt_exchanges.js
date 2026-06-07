// modules/ccxt_exchanges.js — TIER2-F CCXT Multi-Exchange Read-Only
// Aggregiert Market-Data von 5 Exchanges (Binance, Kraken, Coinbase, OKX, Bybit)
// READ-ONLY: keine API-Keys nötig für public market data. Order-Routing bleibt Bitget.

'use strict';

let ccxt = null;
try { ccxt = require('ccxt'); } catch (e) { /* not installed */ }

const EXCHANGES = ['binance', 'kraken', 'coinbase', 'okx', 'bybit'];
const _clients = {};

function getClient(name) {
  if (!ccxt) throw new Error('ccxt not loaded');
  if (_clients[name]) return _clients[name];
  if (!ccxt[name]) throw new Error(`Exchange not supported: ${name}`);
  _clients[name] = new ccxt[name]({ enableRateLimit: true, timeout: 8000 });
  return _clients[name];
}

// Normalize symbol — Bitget uses BTCUSDT, CCXT uses BTC/USDT
function normalizeSymbol(sym) {
  if (sym.includes('/')) return sym;
  // Try common splits
  const stables = ['USDT', 'USDC', 'USD', 'BUSD', 'EUR'];
  for (const s of stables) {
    if (sym.endsWith(s)) return sym.slice(0, -s.length) + '/' + s;
  }
  return sym;
}

async function fetchPrice(exchangeName, symbol) {
  const ex = getClient(exchangeName);
  const sym = normalizeSymbol(symbol);
  try {
    const ticker = await ex.fetchTicker(sym);
    return {
      exchange: exchangeName,
      symbol: sym,
      last: ticker.last,
      bid: ticker.bid,
      ask: ticker.ask,
      volume24h: ticker.baseVolume,
      ts: ticker.timestamp || Date.now(),
    };
  } catch (e) {
    return { exchange: exchangeName, symbol: sym, error: e.message };
  }
}

async function fetchOrderBook(exchangeName, symbol, limit = 10) {
  const ex = getClient(exchangeName);
  const sym = normalizeSymbol(symbol);
  try {
    const ob = await ex.fetchOrderBook(sym, limit);
    return {
      exchange: exchangeName,
      symbol: sym,
      bids: ob.bids.slice(0, limit),
      asks: ob.asks.slice(0, limit),
      bestBid: ob.bids[0] && ob.bids[0][0],
      bestAsk: ob.asks[0] && ob.asks[0][0],
      spread: ob.asks[0] && ob.bids[0] ? +(((ob.asks[0][0] - ob.bids[0][0]) / ob.bids[0][0]) * 100).toFixed(4) : null,
      ts: ob.timestamp || Date.now(),
    };
  } catch (e) {
    return { exchange: exchangeName, symbol: sym, error: e.message };
  }
}

async function aggregatedPrice(symbol) {
  const prices = await Promise.allSettled(EXCHANGES.map(ex => fetchPrice(ex, symbol)));
  const results = prices.map(p => p.value || { error: p.reason });
  const valid = results.filter(r => r.last && !r.error);
  if (!valid.length) return { symbol, error: 'no_valid_prices', results };
  const lasts = valid.map(r => r.last);
  const avg = lasts.reduce((a, b) => a + b, 0) / lasts.length;
  const min = Math.min(...lasts), max = Math.max(...lasts);
  return {
    symbol,
    aggregatedAvg: +avg.toFixed(8),
    min: { price: min, exchange: valid.find(r => r.last === min).exchange },
    max: { price: max, exchange: valid.find(r => r.last === max).exchange },
    spreadPct: +(((max - min) / min) * 100).toFixed(4),
    sources: valid.length,
    perExchange: results,
    ts: Date.now(),
  };
}

async function detectArbitrage(symbol, minSpreadPct = 0.1) {
  const agg = await aggregatedPrice(symbol);
  if (agg.error) return agg;
  const opportunity = agg.spreadPct >= minSpreadPct;
  return {
    symbol,
    spreadPct: agg.spreadPct,
    minSpreadPct,
    opportunity,
    buyAt: agg.min,
    sellAt: agg.max,
    note: opportunity
      ? `Buy on ${agg.min.exchange}, sell on ${agg.max.exchange} (spread ${agg.spreadPct}%). Real arbitrage requires fees+withdrawals+latency analysis.`
      : `Spread ${agg.spreadPct}% below threshold ${minSpreadPct}%`,
    ts: Date.now(),
  };
}

function listExchanges() {
  return {
    available: EXCHANGES,
    ccxtLoaded: !!ccxt,
    ccxtVersion: ccxt ? ccxt.version : null,
    note: 'Read-only — no API-keys needed for public market data. Order-Routing bleibt Bitget.',
  };
}

module.exports = { listExchanges, fetchPrice, fetchOrderBook, aggregatedPrice, detectArbitrage, EXCHANGES };
