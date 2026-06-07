// modules/news_intelligence.js — News-Intelligence-Layer
// AUDFIX_NEWS_INTEL [2026-05-18]
//
// Verbessert die Score-Berechnung für SENTIMENT.news ohne
// Aggregations-Logik im Brain anzufassen.
//
// Funktionen:
//   - Asset-Tagging (BTC/ETH/SOL/...)
//   - Spam-Filter
//   - Keyword-Impact-Score (CRITICAL_NEG, CRITICAL_POS, MEDIUM)
//   - Velocity (News-Geschwindigkeit)
//   - Time-Decay
//   - Source-Weight
//   - Cluster-Detection

'use strict';

// ──────────────────────────────────────────────────────────────────
// ASSET-TAGGING
// ──────────────────────────────────────────────────────────────────
const ASSET_REGEX = /\b(BTC|Bitcoin|XRP|Ripple|ETH|Ethereum|SOL|Solana|ADA|Cardano|DOGE|Dogecoin|SHIB|Shiba|AVAX|Avalanche|DOT|Polkadot|LINK|Chainlink|UNI|Uniswap|ATOM|Cosmos|LTC|Litecoin|BCH|BNB|Binance|MATIC|Polygon|TRX|Tron|TON|Toncoin|APT|Aptos|ARB|Arbitrum|OP|Optimism|NEAR|SUI|SEI)\b/gi;

function tagAssets(text) {
  if (!text) return ['BTC']; // Default: Markt-News
  const matches = String(text).match(ASSET_REGEX) || [];
  const map = {
    bitcoin: 'BTC', ripple: 'XRP', ethereum: 'ETH', solana: 'SOL',
    cardano: 'ADA', dogecoin: 'DOGE', shiba: 'SHIB', avalanche: 'AVAX',
    polkadot: 'DOT', chainlink: 'LINK', uniswap: 'UNI', cosmos: 'ATOM',
    litecoin: 'LTC', binance: 'BNB', polygon: 'MATIC', tron: 'TRX',
    toncoin: 'TON', aptos: 'APT', arbitrum: 'ARB', optimism: 'OP',
  };
  const tags = new Set();
  for (const m of matches) {
    const upper = m.toUpperCase();
    if (upper.length <= 4) tags.add(upper);
    else if (map[m.toLowerCase()]) tags.add(map[m.toLowerCase()]);
  }
  if (tags.size === 0) tags.add('BTC');
  return Array.from(tags);
}

// ──────────────────────────────────────────────────────────────────
// KEYWORD-IMPACT-SCORE
// ──────────────────────────────────────────────────────────────────
const CRITICAL_NEG = [
  { pattern: /\b(hack|hacked|exploit|drain|drained|stolen|breach|rug pull|rugpull)\b/i, impact: -0.45 },
  { pattern: /\b(Trump|Iran|war|geopolit|Hormuz|sanctions|tariff)\b/i, impact: -0.40 },
  { pattern: /\b(bankrupt|Chapter 11|shutdown|FTX|insolvent|collapse)\b/i, impact: -0.50 },
  { pattern: /\b(ETF outflow|billion outflow|massive outflow)\b/i, impact: -0.35 },
  { pattern: /\b(SEC lawsuit|regulator crackdown|enforcement)\b/i, impact: -0.30 },
  { pattern: /\b(phishing|scam|fraud|attack)\b/i, impact: -0.25 },
  { pattern: /\b(crash|plunge|tumble|slide)\b/i, impact: -0.20 },
];
const CRITICAL_POS = [
  { pattern: /\b(Strategy buys|Saylor buys|MicroStrategy)\b/i, impact: 0.45 },
  { pattern: /\b(ETF inflow|billion inflow|massive inflow)\b/i, impact: 0.40 },
  { pattern: /\b(ETF approved|ETF approval|ETF launch)\b/i, impact: 0.50 },
  { pattern: /\b(institutional adoption|institutional buyer)\b/i, impact: 0.35 },
  { pattern: /\b(halving|all.?time high|new ATH)\b/i, impact: 0.30 },
  { pattern: /\b(breakout|rally|surge|bullish)\b/i, impact: 0.20 },
];
const MEDIUM_NEG = [
  { pattern: /\b(bear|bearish|decline|drop|fall|loss)\b/i, impact: -0.10 },
  { pattern: /\b(risk|concern|worry|warning|caution)\b/i, impact: -0.08 },
  { pattern: /\b(volatility|uncertain)\b/i, impact: -0.05 },
];
const MEDIUM_POS = [
  { pattern: /\b(bull|bullish|gain|rise|profit|growth)\b/i, impact: 0.10 },
  { pattern: /\b(partnership|launch|integration|upgrade)\b/i, impact: 0.08 },
  { pattern: /\b(adoption|listing|expansion)\b/i, impact: 0.05 },
];

function keywordImpact(text) {
  if (!text) return 0;
  let impact = 0;
  for (const r of CRITICAL_NEG) if (r.pattern.test(text)) { impact += r.impact; break; }
  for (const r of CRITICAL_POS) if (r.pattern.test(text)) { impact += r.impact; break; }
  if (impact === 0) {
    for (const r of MEDIUM_NEG) if (r.pattern.test(text)) { impact += r.impact; break; }
    for (const r of MEDIUM_POS) if (r.pattern.test(text)) { impact += r.impact; break; }
  }
  return Math.max(-1, Math.min(1, impact));
}

// ──────────────────────────────────────────────────────────────────
// SPAM-FILTER (vor Score!)
// ──────────────────────────────────────────────────────────────────
// AUDFIX_HYPEROPT_P1: erweiterte Spam-Patterns
const SPAM_PATTERNS = [
  /\b(best free|top \d+ (best )?)/i,
  /\b(cloud mining|free (?:dogecoin|bitcoin|crypto) mining)\b/i,
  /\b(daily rewards|beginner.?friendly|earn passive)\b/i,
  /\b(5 leading platforms|leading exchanges of \d{4})\b/i,
  /\b(affiliate|sponsored content|paid promotion|promo|promotion)\b/i,
  /\b(airdrop|presale|won't last|don't miss)\b/i,
  /\b(giveaway|claim now|limited offer)\b/i,
  /\b(1000x potential|100x potential|moon|to the moon)\b/i,
];

function isSpam(title) {
  if (!title) return false;
  for (const p of SPAM_PATTERNS) if (p.test(title)) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────
// SOURCE-WEIGHT
// ──────────────────────────────────────────────────────────────────
// AUDFIX_HYPEROPT_P1: Reddit 0.3 → 0.4 (Retail-Signal stärker)
const SOURCE_WEIGHTS = {
  coindesk: 1.0, theblock: 1.0, decrypt: 1.0, cointelegraph: 1.0,
  cryptonews: 0.7, ambcrypto: 0.7, bitcoincom: 0.7, utoday: 0.7,
  newsbtc: 0.6, bitcoinist: 0.6, cryptoslate: 0.6,
  reddit_crypto: 0.4,
};

function sourceWeight(source) {
  if (!source) return 0.5;
  return SOURCE_WEIGHTS[source] !== undefined ? SOURCE_WEIGHTS[source] : 0.5;
}

// ──────────────────────────────────────────────────────────────────
// TIME-DECAY
// ──────────────────────────────────────────────────────────────────
function timeDecay(ageMs) {
  const ageH = ageMs / 3600000;
  if (ageH < 1) return 1.0;
  if (ageH < 3) return 0.70;
  if (ageH < 6) return 0.40;
  if (ageH < 24) return 0.15;
  return 0;
}

// ──────────────────────────────────────────────────────────────────
// VELOCITY (Markt-weit, nicht Asset-spezifisch)
// ──────────────────────────────────────────────────────────────────
function computeVelocity(db) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM news_feed WHERE COALESCE(pub_date, ts) > strftime('%s','now','-15 minute')*1000`).get();
    const count = row?.c || 0;
    if (count < 5) return { count, score: 0, level: 'NORMAL' };
    if (count < 10) return { count, score: 0.05, level: 'ELEVATED' };
    if (count < 15) return { count, score: 0.10, level: 'HIGH' };
    return { count, score: 0.20, level: 'EXTREME' };
  } catch(e) { return { count: 0, score: 0, level: 'UNKNOWN' }; }
}

// ──────────────────────────────────────────────────────────────────
// CLUSTER-DETECTION (Trigram-Keywords)
// ──────────────────────────────────────────────────────────────────
function detectClusters(rows, minSize = 3) {
  // Sehr einfacher Cluster: gemeinsame Bi/Trigramm aus Titles
  const ngramCount = {};
  for (const r of rows) {
    if (r.is_spam || !r.title) continue;
    const words = String(r.title).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    for (let i = 0; i < words.length - 1; i++) {
      const bg = words[i] + ' ' + words[i+1];
      // Stop-word filter
      if (/^(this|that|with|from|have|been|said|says|will|year|news)/.test(words[i])) continue;
      ngramCount[bg] = (ngramCount[bg] || 0) + 1;
    }
  }
  const sorted = Object.entries(ngramCount).sort((a,b) => b[1]-a[1]).filter(([_,c]) => c >= minSize);
  return sorted.slice(0, 10).map(([kw, count]) => ({ keywords: kw, count }));
}

// ──────────────────────────────────────────────────────────────────
// HAUPT-API: enrichAll + aggregate
// ──────────────────────────────────────────────────────────────────
function enrichOne(row) {
  const text = String(row.title || '');
  const spam = isSpam(text);
  if (spam) {
    return {
      ...row, sentiment_score: 0, assets_tagged: [],
      keyword_impact: 0, is_spam: 1,
      source_weight: 0, decayed_weight: 0,
    };
  }
  const assets = tagAssets(text);
  const kImpact = keywordImpact(text);
  const sWeight = sourceWeight(row.source);
  const age = Date.now() - (row.pub_date || row.ts);
  const decay = timeDecay(age);
  return {
    ...row,
    sentiment_score: kImpact,
    assets_tagged: assets,
    keyword_impact: kImpact,
    is_spam: 0,
    source_weight: sWeight,
    decayed_weight: decay,
  };
}

function aggregate(enrichedRows, options = {}) {
  // Score-Aggregation: SUM(sentiment_score × decayed_weight × source_weight) / sum_weights
  let weightedScoreSum = 0;
  let weightSum = 0;
  let nonSpamCount = 0;
  const tagScores = {};
  for (const r of enrichedRows) {
    if (r.is_spam) continue;
    nonSpamCount++;
    const w = r.decayed_weight * r.source_weight;
    weightedScoreSum += r.sentiment_score * w;
    weightSum += w;
    for (const tag of r.assets_tagged) {
      if (!tagScores[tag]) tagScores[tag] = { sum: 0, w: 0 };
      tagScores[tag].sum += r.sentiment_score * w;
      tagScores[tag].w += w;
    }
  }
  const avgScore = weightSum > 0 ? weightedScoreSum / weightSum : 0;
  const clampedScore = Math.max(-1, Math.min(1, avgScore));
  const confidence = nonSpamCount === 0 ? 0 : Math.min(0.8, nonSpamCount / 25);
  const perAsset = {};
  for (const [tag, ts] of Object.entries(tagScores)) {
    perAsset[tag] = { score: Math.max(-1, Math.min(1, ts.sum / Math.max(0.01, ts.w))), w: ts.w };
  }
  return {
    score: Number(clampedScore.toFixed(3)),
    confidence: Number(confidence.toFixed(2)),
    perAsset,
    nonSpamCount,
    totalCount: enrichedRows.length,
  };
}

function persistEnriched(db, enrichedRows) {
  try {
    const stmt = db.prepare(`INSERT OR REPLACE INTO news_enriched
      (id, ts, source, title, url, sentiment_score, assets_tagged, keyword_impact, is_spam, source_weight, decayed_weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        stmt.run(
          r.id, r.ts, r.source, r.title, r.url || null,
          r.sentiment_score, JSON.stringify(r.assets_tagged),
          r.keyword_impact, r.is_spam, r.source_weight, r.decayed_weight
        );
      }
    });
    tx(enrichedRows);
    return enrichedRows.length;
  } catch(e) { return 0; }
}

module.exports = {
  tagAssets, keywordImpact, isSpam, sourceWeight, timeDecay,
  computeVelocity, detectClusters,
  enrichOne, aggregate, persistEnriched,
  SOURCE_WEIGHTS,
};
