// modules/news_risk_aggregator.js — Exponential-Decay News-Risk-Aggregator
// Verankert 2026-05-20 (NEWS_RISK Phase 2).
//
// Pro Symbol: aggregated_risk = SUM_over_news(risk_score × decay(age) × contagion[symbol])
// decay(age_hours) = exp(-ln(2) / half_life * age_hours)  → Halbwertszeit
//
// Output:
//   getRiskFactor(symbol) → {
//     factor: Number,                 // aggregierter Score
//     contributors: [{title, risk, decay, contagion, contribution}, ...],
//     dominant_type: 'HACK'|'MACRO'|...,
//     max_single_risk: Number,        // höchster Einzelartikel-Beitrag
//     fresh_critical_count: Number    // Artikel <1h alt mit risk>=95 + contagion≥0.5
//   }
//
// Cache: 60s TTL pro Symbol (verhindert DB-Storm)

'use strict';

const Classifier = require('./news_classifier.js');

const NewsRiskAggregator = {
  _db: null,
  _cache: new Map(),    // symbol → { value, ts }
  CACHE_TTL_MS: 60 * 1000,
  LOOKBACK_HOURS: 24,
  FRESH_HOURS: 1,
  CRITICAL_RISK: 95,
  CRITICAL_CONTAGION: 0.5,

  init(db) {
    this._db = db;
  },

  // Decay-Funktion: Halbwertszeit-basiert
  _decay(ageHours, halfLifeHours) {
    if (halfLifeHours <= 0 || ageHours < 0) return 1;
    const lambda = Math.LN2 / halfLifeHours;
    return Math.exp(-lambda * ageHours);
  },

  // Mit cache
  getRiskFactor(symbol) {
    if (!symbol) return this._empty();
    const cached = this._cache.get(symbol);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) return cached.value;
    const value = this._compute(symbol);
    this._cache.set(symbol, { value, ts: Date.now() });
    return value;
  },

  _empty() {
    return { factor: 0, contributors: [], dominant_type: null, max_single_risk: 0, fresh_critical_count: 0 };
  },

  _compute(symbol) {
    if (!this._db) return this._empty();
    const now = Date.now();
    const since = now - this.LOOKBACK_HOURS * 3600 * 1000;
    let rows = [];
    try {
      rows = this._db.prepare(`
        SELECT id, title, risk_score, pub_date, news_type, contagion_json, half_life_hours
        FROM news_feed
        WHERE pub_date > ? AND risk_score IS NOT NULL AND risk_score > 0
      `).all(since);
    } catch(e) { return this._empty(); }

    if (!rows.length) return this._empty();

    let totalFactor = 0;
    let maxSingle = 0;
    let freshCritical = 0;
    // STUFE 3 [20.05.2026]: Sentiment-Polarity-Aggregation
    let polaritySum = 0;
    let polarityWeight = 0;
    const contributors = [];
    const typeWeights = {};

    // PRIO5_FIX #5 [23.05.2026]: Source-Dedup via Title-Fingerprint.
    // Vorher: "Mark Cuban sells Bitcoin" wurde 3× von 3 Sources gezählt → factor 3× überschätzt.
    // Neu: identisch klassifizierte Stories werden 1× voll, dann mit 0.3-Faktor gedämpft.
    const _fingerprint = (t) => {
      if (!t) return '';
      // Erste 6 Tokens > 3 Zeichen (Stop-Word-Filter), lowercase, alphabetisch sortiert
      const toks = String(t).toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x => x.length > 3);
      return toks.slice(0, 6).sort().join('-');
    };
    const _seenFp = new Map();  // fp → count

    for (const r of rows) {
      // Klassifikation falls noch nicht persistiert
      let type = r.news_type, halfLife = r.half_life_hours, contagion = null;
      let sentiment = null;
      if (!type || !halfLife) {
        const c = Classifier.classify(r.title);
        type = c.type; halfLife = c.half_life_hours;
        contagion = c.contagion;
        sentiment = c.sentiment || null;
      } else {
        try { contagion = JSON.parse(r.contagion_json || '{}'); } catch(_) { contagion = {}; }
        // Auch persistierte Rows neu sentimenten (lexikon ist schnell)
        try { const c2 = Classifier.classify(r.title); sentiment = c2.sentiment || null; } catch(_) {}
      }

      const symContag = contagion[symbol] || 0;
      if (symContag <= 0) continue;

      const ageH = (now - r.pub_date) / 3600000;
      const decay = this._decay(ageH, halfLife || 1);
      // PRIO5_FIX #5: Source-Dedup-Faktor
      const fp = _fingerprint(r.title);
      const dupCount = _seenFp.get(fp) || 0;
      _seenFp.set(fp, dupCount + 1);
      const dedupFactor = dupCount === 0 ? 1.0 : 0.3;  // 1. Story voll, 2.-N. mit 0.3
      const contribution = (r.risk_score / 100) * decay * symContag * dedupFactor;

      totalFactor += contribution;
      if (contribution > maxSingle) maxSingle = contribution;
      typeWeights[type] = (typeWeights[type] || 0) + contribution;

      // STUFE 3: Polarity gewichtet mit decay × contagion × confidence
      if (sentiment && typeof sentiment.polarity === 'number') {
        const sWeight = decay * symContag * (sentiment.confidence || 0.5);
        polaritySum += sentiment.polarity * sWeight;
        polarityWeight += sWeight;
      }

      if (ageH < this.FRESH_HOURS && r.risk_score >= this.CRITICAL_RISK && symContag >= this.CRITICAL_CONTAGION) {
        freshCritical++;
      }

      contributors.push({
        id: r.id,
        title: (r.title || '').slice(0, 80),
        type, risk: r.risk_score, age_h: +ageH.toFixed(2),
        decay: +decay.toFixed(4), contagion: +symContag.toFixed(2),
        contribution: +contribution.toFixed(4),
        polarity: sentiment ? sentiment.polarity : null,
      });
    }

    // Dominant type = höchster aggregierter Beitrag
    let dominantType = null;
    let maxTypeWeight = 0;
    for (const [t, w] of Object.entries(typeWeights)) {
      if (w > maxTypeWeight) { maxTypeWeight = w; dominantType = t; }
    }

    // Top-10 contributors only
    contributors.sort((a, b) => b.contribution - a.contribution);
    const top = contributors.slice(0, 10);

    // STUFE 3: Aggregated polarity (durchschnitt gewichtet)
    const aggPolarity = polarityWeight > 0 ? polaritySum / polarityWeight : 0;

    return {
      factor: +totalFactor.toFixed(4),
      contributors: top,
      dominant_type: dominantType,
      max_single_risk: +maxSingle.toFixed(4),
      fresh_critical_count: freshCritical,
      sentiment_polarity: +aggPolarity.toFixed(4),
      sentiment_weight: +polarityWeight.toFixed(4),
    };
  },

  snapshot() {
    return {
      cached_symbols: this._cache.size,
      lookback_hours: this.LOOKBACK_HOURS,
      cache_ttl_s: this.CACHE_TTL_MS / 1000,
      critical_risk: this.CRITICAL_RISK,
      critical_contagion: this.CRITICAL_CONTAGION,
    };
  },
};

module.exports = NewsRiskAggregator;
