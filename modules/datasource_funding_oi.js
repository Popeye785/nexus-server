// modules/datasource_funding_oi.js — Funding-Rate + Open-Interest Brain-Adapter
// AUDFIX_DATA_P2 [2026-05-18]
//
// Liest Bitget Mix-Ticker (Funding-Rate, OI = holdingAmount) und liefert
// 2 separate Score-Strukturen (funding + oi) für UnifiedScore.
//
// Daten existieren bereits in Bot (ARB-Modul Z.2877+), aber NICHT im
// Brain-Decision-Pfad. Hier wird der Adapter ins Brain eingehängt.

'use strict';

const axios = require('axios');

const DataSourceFundingOI = {
  _cache: new Map(),
  TTL_MS: 5 * 60 * 1000,
  _oiPrev: new Map(),    // symbol → { ts, oi, price }
  _db: null,

  init(db) { this._db = db; },

  async _fetch(symbol) {
    try {
      const url = `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`;
      const r = await axios.get(url, { timeout: 5000 });
      const d = r.data?.data?.[0];
      if (!d) return null;
      return {
        ts: parseInt(d.ts) || Date.now(),
        price: parseFloat(d.lastPr),
        funding: parseFloat(d.fundingRate || 0),
        oi: parseFloat(d.holdingAmount || 0),
      };
    } catch(e) { return null; }
  },

  // Funding-Score:
  //   Funding-Rate ist pro 8h auf Bitget USDT-Futures
  //   > +0.05% pro 8h = Long-Overheat → SELL
  //   < -0.05% = Short-Overheat → BUY
  //   Extrem +/-0.1% → starkes Signal
  _scoreFunding(funding) {
    // AUDFIX_MEGA_TAG3 [2026-05-19]: Schärfere Funding-Schwellen (TOP 1 aus Web-Research)
    // Symmetrisch positive/negative Funding, neue Stufe 0.01% für sanftes Frühwarn
    if (Math.abs(funding) < 0.0001) return { direction: 'NEUTRAL', score: 0, confidence: 0.3, reason: 'NEAR_ZERO' };
    if (funding > 0.001)   return { direction: 'SELL', score: -0.90, confidence: 0.85, reason: 'LONG_EXTREME_HEAT' };
    if (funding > 0.0005)  return { direction: 'SELL', score: -0.60, confidence: 0.75, reason: 'LONG_HEAT' };
    if (funding > 0.0002)  return { direction: 'SELL', score: -0.40, confidence: 0.65, reason: 'LONG_ELEVATED' };
    if (funding > 0.0001)  return { direction: 'SELL', score: -0.20, confidence: 0.50, reason: 'LONG_MILD' };
    if (funding < -0.001)  return { direction: 'BUY',  score:  0.90, confidence: 0.85, reason: 'SHORT_EXTREME_HEAT' };
    if (funding < -0.0005) return { direction: 'BUY',  score:  0.60, confidence: 0.75, reason: 'SHORT_HEAT' };
    if (funding < -0.0002) return { direction: 'BUY',  score:  0.40, confidence: 0.65, reason: 'SHORT_ELEVATED' };
    if (funding < -0.0001) return { direction: 'BUY',  score:  0.20, confidence: 0.50, reason: 'SHORT_MILD' };
    return { direction: 'NEUTRAL', score: 0, confidence: 0.4, reason: 'NORMAL' };
  },

  // OI-Score:
  //   OI Δ vs vorherigem fetch (5min):
  //   OI ↑ + Preis ↑ → Long-Buildup (overheat-Warnung)
  //   OI ↓ + Preis ↓ → Long-Liquidations
  //   OI ↑ + Preis ↓ → Short-Buildup (BULL-SETUP)
  //   OI ↓ + Preis ↑ → Short-Cover (BULLISH)
  _scoreOI(currentData, prev) {
    if (!prev) return { direction: 'NEUTRAL', score: 0, confidence: 0.2, reason: 'NO_PREV' };
    const oiDelta = (currentData.oi - prev.oi) / Math.max(1, prev.oi);
    const priceDelta = (currentData.price - prev.price) / Math.max(1, prev.price);
    let direction = 'NEUTRAL', score = 0, confidence = 0.4, reason = '';

    // STUFE2_oi [20.05.2026]: Schwellen feinkörniger (vorher nur |oi|>1% UND |price|>0.5% → meistens NEUTRAL)
    // Neu: 4-Stufen-Skala + leichte Bias-Stufen bei moderaten Bewegungen
    const oiAbs = Math.abs(oiDelta);
    const prAbs = Math.abs(priceDelta);
    if (oiAbs < 0.002 && prAbs < 0.001) {
      return { direction: 'NEUTRAL', score: 0, confidence: 0.3, reason: 'STABLE' };
    }
    // STRONG-Setups (große OI+Price-Bewegung)
    if (oiDelta > 0.01 && priceDelta > 0.005) {
      direction = 'SELL'; score = -0.3; confidence = 0.6; reason = 'LONG_BUILDUP_OVERHEAT_STRONG';
    } else if (oiDelta < -0.01 && priceDelta < -0.005) {
      direction = 'SELL'; score = -0.4; confidence = 0.7; reason = 'LONG_LIQUIDATIONS_STRONG';
    } else if (oiDelta > 0.01 && priceDelta < -0.005) {
      direction = 'BUY'; score = 0.3; confidence = 0.65; reason = 'SHORT_BUILDUP_STRONG';
    } else if (oiDelta < -0.01 && priceDelta > 0.005) {
      direction = 'BUY'; score = 0.35; confidence = 0.7; reason = 'SHORT_COVER_BULLISH_STRONG';
    }
    // MODERATE-Setups (kleinere Bewegungen)
    else if (oiDelta > 0.003 && priceDelta > 0.002) {
      direction = 'SELL'; score = -0.15; confidence = 0.45; reason = 'LONG_BUILDUP_MILD';
    } else if (oiDelta < -0.003 && priceDelta < -0.002) {
      direction = 'SELL'; score = -0.2; confidence = 0.5; reason = 'LONG_LIQ_MILD';
    } else if (oiDelta > 0.003 && priceDelta < -0.002) {
      direction = 'BUY'; score = 0.15; confidence = 0.45; reason = 'SHORT_BUILDUP_MILD';
    } else if (oiDelta < -0.003 && priceDelta > 0.002) {
      direction = 'BUY'; score = 0.2; confidence = 0.5; reason = 'SHORT_COVER_MILD';
    }
    return { direction, score, confidence, reason, oiDelta, priceDelta };
  },

  async getSignal(symbol) {
    symbol = symbol || 'BTCUSDT';
    const cached = this._cache.get(symbol);
    if (cached && Date.now() - cached.ts < this.TTL_MS) return cached.payload;

    const cur = await this._fetch(symbol);
    if (!cur) return {
      funding: { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'API_FAIL' },
      oi: { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'API_FAIL' },
    };

    const prev = this._oiPrev.get(symbol);
    const fundingPayload = this._scoreFunding(cur.funding);
    const oiPayload = this._scoreOI(cur, prev);
    this._oiPrev.set(symbol, cur);

    const payload = { funding: fundingPayload, oi: oiPayload, raw: cur };
    this._cache.set(symbol, { ts: Date.now(), payload });

    try {
      if (this._db) {
        this._db.prepare(`INSERT INTO funding_oi_history (ts, symbol, funding, oi, price, funding_signal, oi_signal)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          Date.now(), symbol, cur.funding, cur.oi, cur.price,
          fundingPayload.reason, oiPayload.reason);
      }
    } catch(_) {}
    return payload;
  },

  snapshot() {
    const out = {};
    for (const [s, p] of this._oiPrev.entries()) out[s] = p;
    return { cached: this._cache.size, latest: out };
  },
};

module.exports = DataSourceFundingOI;
