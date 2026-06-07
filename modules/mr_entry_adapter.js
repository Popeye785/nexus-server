// modules/mr_entry_adapter.js
// MEGA-MR-Entry-Adapter [2026-06-05] — wandelt das Avellaneda-MR-s-score-Signal
// in eine Entry-RICHTUNG fuer MEGA-Symbole um.
//
// DEMO=LIVE: identisch in beiden Modi. Reine Funktion, modus-blind
// (liest NICHT DEPLOY_MODE / DRY_LIVE / Order-Send — nur Markt-Closes + uScore + Regime).
//
// Kontrarian-Design (Block O / symbol_universe Anti-Trend-Edge): MR DARF das
// trend-/aggregat-getriebene uScore.direction fuer MEGA UEBERSTIMMEN. Es gibt
// bewusst KEINEN "No-Fight"-Vergleich gegen das Aggregat — nur harte Safety-Gates.
//
// deriveEntry(symbol, closes, uScore, context) -> entry | null
//   entry = { direction:'BUY'|'SELL', strategy:'MR', source:'MR_AVELLANEDA',
//             confidence, sScore, halfLife, reason }
//   null  = kein Entry (kein MEGA / nicht MR-allowed / b>=0 / |s|<=1.25 /
//           |s|>3.0 Hard-Stop / Half-life zu gross / extremes Regime)

'use strict';

const MR = require('./mean_reversion_avellaneda.js');
const SU = require('./symbol_universe.js');
const SV = require('./strategy_veto.js');

const S_HARD_STOP = 3.0;              // |s| > 3.0 => Regime-Bruch, kein MR-Entry
const HALFLIFE_MAX_DEFAULT = 72;      // Stunden — zu traege MR ueberspringen
const EXTREME_REGIMES = new Set(['EXTREME_BEAR', 'FLASH_CRASH']); // Falling-Knife-Schutz

function deriveEntry(symbol, closes, uScore, context = {}) {
  // 1) MEGA-only
  if (!symbol || SU.getClass(symbol) !== 'MEGA') return null;
  // 2) MR muss die abgeleitete Strategy fuer dieses Symbol sein
  if (SV.deriveRealStrategyForSymbol(symbol) !== 'MR') return null;
  // 3) Regime-Hard-Block (kein fallendes Messer)
  const regime = context && context.regime;
  if (regime && EXTREME_REGIMES.has(String(regime))) return null;
  // 4) Genug Daten
  if (!Array.isArray(closes) || closes.length < MR.WINDOW_MIN) return null;
  // 5) OU-Fit (fit.ok ist nur true wenn b<0 => mean-revertierend)
  const r = MR.fromCloses(closes);
  if (!r || !r.fit || !r.fit.ok || r.sScore === null) return null;
  const s = r.sScore;
  // 6) Hard-Stop-Zone
  if (Math.abs(s) > S_HARD_STOP) return null;
  // 7) Entry-Schwelle (|s| > 1.25 => BUY/SELL; HOLD/EXIT => kein Entry)
  const dir = r.signal && r.signal.direction;
  if (dir !== 'BUY' && dir !== 'SELL') return null;
  // 8) Half-life-Filter
  const hlMax = Number(context && context.halfLifeMaxH) || HALFLIFE_MAX_DEFAULT;
  const hl = r.fit.halfLife;
  if (Number.isFinite(hl) && hl > hlMax) return null;

  return {
    direction: dir,
    strategy: 'MR',
    source: 'MR_AVELLANEDA',
    confidence: Number(r.signal.confidence) || 0,
    sScore: s,
    halfLife: hl,
    reason: r.signal.reason || (dir === 'BUY' ? 'MR_OVEREXTENDED_DOWN' : 'MR_OVEREXTENDED_UP'),
  };
}

module.exports = { deriveEntry, S_HARD_STOP, HALFLIFE_MAX_DEFAULT };
