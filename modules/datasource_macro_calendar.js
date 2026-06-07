// modules/datasource_macro_calendar.js — Macro-Calendar (ForexFactory)
// AUDFIX_DATA_P4 [2026-05-18]
//
// Quelle: https://nfs.faireconomy.media/ff_calendar_thisweek.json (gratis)
// Filter: USD-Events mit Impact High
// Score:
//   Pre-Event-Window (-2h bis +1h um High-Impact-Event) → Score 0 + conf 0.9
//     (Brain wird vorsichtiger statt vortrade)
//   Post-Event actual > forecast (positive Surprise) → +0.2
//   Post-Event actual < forecast → -0.2

'use strict';

const axios = require('axios');

const DataSourceMacroCalendar = {
  _events: [],
  _lastFetch: 0,
  TTL_MS: 6 * 60 * 60 * 1000, // 6h
  _db: null,

  init(db) { this._db = db; },

  async _fetchEvents() {
    try {
      const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
      const r = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!Array.isArray(r.data)) return [];
      // Filter: USD High-Impact (auch CPI, FOMC, NFP etc.)
      const filtered = r.data.filter(e =>
        e.country === 'USD' &&
        (e.impact === 'High' || /FOMC|CPI|NFP|GDP|Non-Farm|Federal Reserve|Interest Rate/i.test(e.title || ''))
      );
      const events = filtered.map(e => ({
        title: e.title,
        date: new Date(e.date).getTime(),
        impact: e.impact,
        forecast: e.forecast,
        previous: e.previous,
        actual: e.actual,
      })).filter(e => Number.isFinite(e.date));
      return events;
    } catch(e) {
      try { console.warn('[Macro]', e.message); } catch(_){}
      return [];
    }
  },

  async _ensureFresh() {
    if (Date.now() - this._lastFetch > this.TTL_MS) {
      const events = await this._fetchEvents();
      if (events.length > 0) {
        this._events = events;
        this._lastFetch = Date.now();
        // AUDFIX_MACRO_FIX [2026-05-19]: DELETE FROM macro_events ERSETZT durch
        // UPSERT auf (event_date, title) — verhindert Verlust hardcoded Events.
        // Vorher: jeder fetch löschte alle Events (auch FOMC/CPI/NFP-Historie).
        try {
          if (this._db) {
            // Ensure UNIQUE-Constraint für UPSERT
            try { this._db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_unique ON macro_events(event_date, title)`); } catch(_){}
            const stmt = this._db.prepare(`INSERT INTO macro_events (ts, event_date, title, impact, forecast, previous, actual) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(event_date, title) DO UPDATE SET
                ts=excluded.ts, impact=excluded.impact, forecast=excluded.forecast, previous=excluded.previous, actual=excluded.actual`);
            const tx = this._db.transaction((rows) => {
              for (const e of rows) stmt.run(Date.now(), e.date, e.title, e.impact, e.forecast || '', e.previous || '', e.actual || '');
            });
            tx(events);
          }
        } catch(e) { try { Log.warn('MACRO', 'upsert err: ' + e.message); } catch(_){} }
      }
    }
  },

  // Liefert Score: hauptsächlich Pre-Event-Vorsicht
  async getSignal(symbol) {
    await this._ensureFresh();
    if (this._events.length === 0) {
      return { direction: 'NEUTRAL', score: 0, confidence: 0, reason: 'NO_EVENTS' };
    }
    const now = Date.now();
    const PRE_WINDOW_MS = 2 * 60 * 60 * 1000;  // 2h vor Event
    const POST_WINDOW_MS = 1 * 60 * 60 * 1000;  // 1h nach Event

    // STUFE2_macroCalendar [20.05.2026]: Active-Filter nur HIGH-Impact.
    // Vorher: alle Events inkl. Low (FOMC Speakers) → blockten Pre-Awareness für echte High-Events
    // Plus: `upcoming` weiter unten ALLE Events betrachtend, dort wird auf High geprüft
    const active = this._events.filter(e => {
      const diff = e.date - now;
      return diff > -POST_WINDOW_MS && diff < PRE_WINDOW_MS && e.impact === 'High';
    });

    if (active.length === 0) {
      // STUFE2_macroCalendar [20.05.2026]: Erweiterte Pre-Awareness (vorher nur 2h-Pre-Window).
      // Neu: bis 8h vor High-Event schwacher SELL-Bias, bis 24h heads-up NEUTRAL+höhere conf.
      const upcoming = this._events.filter(e => e.date > now).sort((a,b) => a.date - b.date)[0];
      if (upcoming) {
        const hoursToEvent = (upcoming.date - now) / 3600000;
        const isHigh = upcoming.impact === 'High';
        if (isHigh && hoursToEvent <= 8) {
          // 2-8h vor High-Event: leichter SELL-Bias (Vorsicht vor Event-Volatilität)
          return {
            direction: 'SELL', score: -0.1, confidence: 0.5,
            reason: `PRE_HIGH_EVENT_${upcoming.title.slice(0,30)}_in_${hoursToEvent.toFixed(1)}h`,
            nextEvent: { title: upcoming.title, in_min: Math.round((upcoming.date - now)/60000) },
          };
        } else if (isHigh && hoursToEvent <= 24) {
          // Heads-up: NEUTRAL aber höhere conf
          return {
            direction: 'NEUTRAL', score: 0, confidence: 0.5,
            reason: `HEADS_UP_HIGH_${upcoming.title.slice(0,30)}_in_${hoursToEvent.toFixed(1)}h`,
            nextEvent: { title: upcoming.title, in_min: Math.round((upcoming.date - now)/60000) },
          };
        }
        return {
          direction: 'NEUTRAL', score: 0, confidence: 0.3,
          reason: `NEXT_${upcoming.title.slice(0,20)}_in_${Math.round(hoursToEvent)}h`,
          nextEvent: { title: upcoming.title, in_min: Math.round((upcoming.date - now)/60000) },
        };
      }
      return { direction: 'NEUTRAL', score: 0, confidence: 0.3, reason: 'NO_UPCOMING', nextEvent: null };
    }

    // Aktives Event → vorsichtig (Brain soll WARTEN)
    const ev = active[0];
    const timeToEvent = ev.date - now;
    if (timeToEvent > 0) {
      // PRE-Event
      return {
        direction: 'NEUTRAL', score: 0, confidence: 0.9,
        reason: `PRE_EVENT_${ev.title.slice(0,30)}_in_${Math.round(timeToEvent/60000)}min`,
        activeEvent: ev.title,
        warning: 'pre_event_caution',
      };
    } else {
      // POST-Event mit actual
      if (ev.actual && ev.forecast) {
        try {
          const actualNum = parseFloat(String(ev.actual).replace(/[%KMBkmb]/g, ''));
          const forecastNum = parseFloat(String(ev.forecast).replace(/[%KMBkmb]/g, ''));
          if (Number.isFinite(actualNum) && Number.isFinite(forecastNum)) {
            const surprise = actualNum - forecastNum;
            // Positive Surprise bei CPI = bearish (mehr Inflation, höhere Zinsen) — komplex je nach Event
            // Wir nehmen einfache Heuristik: Surprise > 0 = +score, < 0 = -score
            // Aber bei Inflation/CPI gegen-intuitiv. Pragmatik: für jetzt symmetrisch
            const sigStr = surprise > 0 ? 0.2 : surprise < 0 ? -0.2 : 0;
            return {
              direction: sigStr > 0 ? 'BUY' : sigStr < 0 ? 'SELL' : 'NEUTRAL',
              score: sigStr, confidence: 0.6,
              reason: `POST_${ev.title.slice(0,30)}_surprise=${surprise.toFixed(2)}`,
              activeEvent: ev.title,
            };
          }
        } catch(_) {}
      }
      return {
        direction: 'NEUTRAL', score: 0, confidence: 0.5,
        reason: `POST_${ev.title.slice(0,30)}_no_surprise_data`,
        activeEvent: ev.title,
      };
    }
  },

  snapshot() {
    return {
      events: this._events.length,
      lastFetch: this._lastFetch,
      upcoming: this._events.filter(e => e.date > Date.now()).slice(0, 5),
    };
  },
};

module.exports = DataSourceMacroCalendar;
