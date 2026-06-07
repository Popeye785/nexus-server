// modules/news_classifier.js — News-Type-Classifier + Asset-Contagion-Map
// Verankert 2026-05-20 (NEWS_RISK Phase 1).
//
// Klassifiziert News-Artikel in Typen + bestimmt betroffene Symbole.
// Output: { type, contagion: {symbol → weight}, half_life_hours }

'use strict';

// Symbol-Liste (was der Bot trackt — gleich wie CoinScanner.WATCHLIST)
const KNOWN_SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT',
  'DOTUSDT','DOGEUSDT','LINKUSDT','ATOMUSDT','UNIUSDT','LTCUSDT','NEARUSDT',
  'ARBUSDT','OPUSDT','SUIUSDT','APTUSDT','SEIUSDT','MATICUSDT','POLUSDT',
];

// Token-Aliase (im Titel oft Coin-Name statt USDT-Pair-Symbol)
const SYMBOL_ALIAS = {
  'bitcoin': 'BTCUSDT', 'btc': 'BTCUSDT',
  'ethereum': 'ETHUSDT', 'eth': 'ETHUSDT', 'ether': 'ETHUSDT',
  'solana': 'SOLUSDT', 'sol': 'SOLUSDT',
  'binance coin': 'BNBUSDT', 'bnb': 'BNBUSDT',
  'ripple': 'XRPUSDT', 'xrp': 'XRPUSDT',
  'cardano': 'ADAUSDT', 'ada': 'ADAUSDT',
  'avalanche': 'AVAXUSDT', 'avax': 'AVAXUSDT',
  'polkadot': 'DOTUSDT', 'dot': 'DOTUSDT',
  'dogecoin': 'DOGEUSDT', 'doge': 'DOGEUSDT',
  'chainlink': 'LINKUSDT', 'link': 'LINKUSDT',
  'cosmos': 'ATOMUSDT', 'atom': 'ATOMUSDT',
  'uniswap': 'UNIUSDT', 'uni': 'UNIUSDT',
  'litecoin': 'LTCUSDT', 'ltc': 'LTCUSDT',
  'near protocol': 'NEARUSDT', 'near': 'NEARUSDT',
  'arbitrum': 'ARBUSDT', 'arb': 'ARBUSDT',
  'optimism': 'OPUSDT', 'op token': 'OPUSDT',
  'sui': 'SUIUSDT',
  'aptos': 'APTUSDT', 'apt': 'APTUSDT',
  'sei': 'SEIUSDT',
  'polygon': 'POLUSDT', 'matic': 'POLUSDT',
};

// Type-Detection-Patterns (Regex mit Wortgrenzen — REGEX_FIX 2026-05-22)
// Bug-Fix: vorher 'includes()' → "cuban" matchte "ban ", falsch als REGULATORY klassifiziert.
// Jetzt: jedes Pattern als Regex mit \b-Wortgrenze wo nötig (Vollwort), oder \b-Prefix (Wortstamm).
const TYPE_RULES = [
  { type: 'HACK', half_life: 2, patterns: [
      /\bhack/i, /\bdrain/i, /\bexploit/i, /\bstolen\b/i, /\battack/i,
      /\bbreach/i, /\bphishing/i, /\brug pull/i, /\bsmart contract bug/i, /\bvulnerabilit/i
  ]},
  { type: 'REGULATORY', half_life: 6, patterns: [
      /\bsec\b/i, /\bcftc\b/i, /\bregulat/i, /\bban\b/i, /\bbanned\b/i, /\bbans\b/i,
      /\benforcement/i, /\blawsuit/i, /\bcourt/i, /\bsued\b/i, /\bsanction/i,
      /\baml\b/i, /\bkyc\b/i
  ]},
  { type: 'MACRO', half_life: 8, patterns: [
      /\bfed\b/i, /\bfomc\b/i, /\bcpi\b/i, /\binflation/i, /\brate hike/i, /\brate cut/i,
      /\binterest rate/i, /\bjobless/i, /\bnfp\b/i, /\bgdp\b/i, /\brecession/i, /\btariff/i
  ]},
  { type: 'EXCHANGE', half_life: 4, patterns: [
      /\bbinance/i, /\bcoinbase/i, /\bkraken/i, /\bbitget/i, /\bokx\b/i,
      /\bexchange listing/i, /\bdelisting/i, /\bwithdrawal halt/i, /\bexchange suspend/i
  ]},
  { type: 'PROTOCOL', half_life: 12, patterns: [
      /\bupgrade/i, /\bhard fork/i, /\bmainnet/i, /\btestnet/i, /\bsmart contract/i,
      /\bbridge\b/i, /\bairdrop/i, /\btoken launch/i
  ]},
  // ROUTINE catches all else
];

function lower(s) { return (s || '').toLowerCase(); }

function detectType(title) {
  const t = title || '';
  for (const rule of TYPE_RULES) {
    for (const re of rule.patterns) {
      if (re.test(t)) return { type: rule.type, half_life: rule.half_life };
    }
  }
  return { type: 'ROUTINE', half_life: 1 };
}

// Asset-Detection: welche Symbole im Titel erwähnt
function detectAffectedSymbols(title) {
  const t = lower(title);
  const found = new Set();
  // 1. Direct symbol mention (BTC, ETH etc. in upper case context)
  for (const sym of KNOWN_SYMBOLS) {
    const base = sym.replace('USDT', '').toLowerCase();
    // Wort-Grenzen
    const re = new RegExp('\\b' + base + '\\b', 'i');
    if (re.test(t)) found.add(sym);
  }
  // 2. Alias-Detection
  for (const [alias, sym] of Object.entries(SYMBOL_ALIAS)) {
    if (t.includes(alias)) found.add(sym);
  }
  return Array.from(found);
}

// Contagion-Map: pro News-Typ wie betreffen Symbole
function buildContagionMap(type, affectedSymbols) {
  const contagion = {};
  switch (type) {
    case 'HACK': {
      // Affected: 1.0, BTC+ETH (Market-Leader): 0.1, andere: 0
      affectedSymbols.forEach(s => { contagion[s] = 1.0; });
      if (!contagion['BTCUSDT']) contagion['BTCUSDT'] = 0.1;
      if (!contagion['ETHUSDT']) contagion['ETHUSDT'] = 0.1;
      break;
    }
    case 'REGULATORY': {
      // Affected: 0.8, alle anderen: 0.3 (Markt-Stimmung)
      KNOWN_SYMBOLS.forEach(s => { contagion[s] = 0.3; });
      affectedSymbols.forEach(s => { contagion[s] = 0.8; });
      break;
    }
    case 'MACRO': {
      // Global: 0.6 für alle (Fed/CPI betrifft komplett)
      KNOWN_SYMBOLS.forEach(s => { contagion[s] = 0.6; });
      break;
    }
    case 'EXCHANGE': {
      // Affected: 0.7, andere: 0.2
      KNOWN_SYMBOLS.forEach(s => { contagion[s] = 0.2; });
      affectedSymbols.forEach(s => { contagion[s] = 0.7; });
      break;
    }
    case 'PROTOCOL': {
      // Nur explizit erwähnte
      affectedSymbols.forEach(s => { contagion[s] = 0.5; });
      break;
    }
    case 'ROUTINE':
    default: {
      affectedSymbols.forEach(s => { contagion[s] = 0.2; });
      break;
    }
  }
  return contagion;
}

// STUFE 3 [20.05.2026]: FinBERT-inspired sentiment overlay
let _FinBertLex = null;
try { _FinBertLex = require('./finbert_lexicon.js'); } catch(_) { _FinBertLex = null; }

function classify(title) {
  if (!title) return { type: 'ROUTINE', contagion: {}, half_life_hours: 1, affected: [], sentiment: { polarity: 0, confidence: 0 } };
  const { type, half_life } = detectType(title);
  const affected = detectAffectedSymbols(title);
  const contagion = buildContagionMap(type, affected);

  // STUFE 3: Sentiment-Polarity berechnen (FinBERT-Lexicon)
  let sentiment = { polarity: 0, confidence: 0 };
  if (_FinBertLex && _FinBertLex.score) {
    try {
      const s = _FinBertLex.score(title);
      sentiment = { polarity: s.polarity, confidence: s.confidence, pos_score: s.pos_score, neg_score: s.neg_score };
    } catch(_) {}
  }

  return { type, contagion, half_life_hours: half_life, affected, sentiment };
}

module.exports = { classify, KNOWN_SYMBOLS, detectType, detectAffectedSymbols };
