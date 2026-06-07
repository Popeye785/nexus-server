// modules/datasource_etf_flows.js — ETF-Flows
// AUDFIX_DATA_P3 [2026-05-18]
//
// Farside.co.uk hat Cloudflare-Schutz, ECHTE ETF-Flow-APIs sind paywalled.
// Pragmatik:
//   - Manueller DB-Insert via /api/etf/flow möglich
//   - Default: NEUTRAL bis Daten manuell gepflegt werden
//   - Stub-Modus klar markiert in reason="STUB"

'use strict';

const DataSourceETFFlows = {
  _cache: { ts: 0, payload: null },
  TTL_MS: 6 * 60 * 60 * 1000,  // 6h Refresh
  _db: null,

  init(db) { this._db = db; },

  _scoreFromFlow(netFlowUSD) {
    if (Math.abs(netFlowUSD) < 100e6) return { direction: 'NEUTRAL', score: 0, confidence: 0.4, reason: 'NEUTRAL_<100M' };
    if (netFlowUSD > 500e6) return { direction: 'BUY', score: 0.3, confidence: 0.7, reason: 'STRONG_INFLOW' };
    if (netFlowUSD > 200e6) return { direction: 'BUY', score: 0.15, confidence: 0.5, reason: 'MODERATE_INFLOW' };
    if (netFlowUSD < -500e6) return { direction: 'SELL', score: -0.3, confidence: 0.7, reason: 'STRONG_OUTFLOW' };
    if (netFlowUSD < -200e6) return { direction: 'SELL', score: -0.15, confidence: 0.5, reason: 'MODERATE_OUTFLOW' };
    return { direction: 'NEUTRAL', score: 0, confidence: 0.4, reason: 'NEUTRAL' };
  },

  async getSignal(symbol) {
    if (this._cache.payload && Date.now() - this._cache.ts < this.TTL_MS) return this._cache.payload;

    // AUDFIX_ETF_CSV [2026-05-18]: Bevorzuge letzte 24h-Daten, dann 48h, dann 7d-Avg
    let netFlow = null, ageH = 999, source = 'db';
    try {
      if (this._db) {
        const row = this._db.prepare(`SELECT net_flow_usd, ts FROM etf_flows
          WHERE ts > strftime('%s','now','-7 day')*1000
          ORDER BY ts DESC LIMIT 1`).get();
        if (row && Number.isFinite(row.net_flow_usd)) {
          netFlow = row.net_flow_usd;
          ageH = (Date.now() - row.ts) / 3600000;
        }
      }
    } catch(_) {}

    if (netFlow === null) {
      const payload = { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'STUB_NO_DATA', source: 'manual_input_needed' };
      this._cache = { ts: Date.now(), payload };
      return payload;
    }
    // AUDIT_FIX_P1.4 [20.05.2026]: Bei Daten älter als 48h → NEUTRAL statt veraltetem SELL/BUY.
    // Vorher: Daten 61h alt → SELL -0.3 conf 0.10 (Scheinlogik 100% in 24h Audit-Befund).
    if (ageH >= 48) {
      const payload = { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'STALE_DATA_'+ageH.toFixed(0)+'h', source: 'db_stale', ageH: ageH.toFixed(1) };
      this._cache = { ts: Date.now(), payload };
      return payload;
    }
    const sig = this._scoreFromFlow(netFlow);
    let conf = sig.confidence;
    if (ageH < 24) conf = 0.75;
    else conf = 0.40;
    const payload = { ...sig, confidence: conf, netFlowUSD: netFlow, ageH: ageH.toFixed(1), source };
    this._cache = { ts: Date.now(), payload };
    return payload;
  },

  // Manueller Insert (z.B. via Endpoint)
  insertFlow(netFlowUSD, source = 'manual') {
    try {
      if (this._db) {
        this._db.prepare(`INSERT INTO etf_flows (ts, net_flow_usd, source) VALUES (?, ?, ?)`).run(
          Date.now(), netFlowUSD, source);
        this._cache = { ts: 0, payload: null }; // cache invalidate
        return { ok: true };
      }
    } catch(e) { return { ok: false, error: e.message }; }
    return { ok: false, error: 'NO_DB' };
  },

  snapshot() { return this._cache.payload; },
};

module.exports = DataSourceETFFlows;
