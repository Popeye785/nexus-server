// modules/aladdin_intent_shadow.js
// P2.1 [2026-06-03]: Aladdin als Shadow-Chef.
//
// Aladdin leitet pro Symbol/Cycle einen botTypeIntent ab (SINGLE/GRID/INFGRID/DCA/MR/
// NONE/REDUCE_RISK/CLOSE_WORST) + selectedStrategy (TREND/MR/GRID/DCA/MOMENTUM/...).
// Output ist SHADOW-ONLY: wird in CSV geloggt und in In-Memory-Ring gehalten.
// Reale Ausführung bleibt unverändert.
//
// Christian-Regeln (P2.0 Befunde):
// - UNIFIED ist Signalquelle, nicht Strategy.
// - NONE ist gleichwertiger Intent (Brain HOLD oder unsicher).
// - BEAR darf kein blindes DCA auslösen.
// - ANALYSIS bleibt forbidden.
// - Confidence ist nicht das Haupt-Gate (kaputt kalibriert per P2.0).
// - Regime+Symbol-Class+Edge-History sind die Haupt-Inputs.
//
// Persistenz: CSV unter data/shadow_intent/YYYY-MM-DD.csv, 30d retention.
// KEIN DB-Write — DB-Korruptions-Risiko nach P3 zu hoch für Hochfrequenz-Writes.

'use strict';

const fs = require('fs');
const path = require('path');

let _SU = null;
let _Router = null;
let _Veto = null;
try { _SU = require('./symbol_universe'); } catch(_) {}
try { _Router = require('./final_decision_router'); } catch(_) {}
try { _Veto = require('./strategy_veto'); } catch(_) {}

const SHADOW_DIR = path.join(__dirname, '..', 'data', 'shadow_intent');
const RETENTION_DAYS = 30;
const RING_SIZE = 500;

// CSV-Header (stabil, neue Felder nur hinten anhängen)
// P3 [2026-06-03]: routerVerdictCurrent + p3RouterVerdictShadow + Diff + Explain.
// "Current" = derselbe Wert wie routerVerdictShadow (Alias für Klarheit im CSV).
// P3-Felder sind PARALLEL berechnet. Reale Ausführung nutzt sie NICHT.
const HEADER = [
  'ts','symbol','decision','confidence',
  'botTypeIntent','selectedStrategy','signalSource',
  'regime','regimeConfidence','symbolClass',
  'intentReason',
  'routerVerdictShadow','routerReasonShadow',
  'actualAction','wouldOpen','wouldClose','wouldSkip',
  'priceNow','edgeEstimateBps',
  // P3-Felder
  'routerVerdictCurrent','routerReasonCurrent',
  'p3RouterVerdictShadow','p3RouterReasonShadow',
  'routerDiff','p3WouldOpen','p3WouldClose','p3RiskFlag','p3Explain'
].join(',');

const IntentShadow = {
  enabled: true,
  _ringBuffer: [],         // in-memory ring, neueste zuerst
  _todayFile: null,
  _todayHeaderWritten: false,
  _writeErrors: 0,
  _writeOK: 0,
  _initDone: false,

  init() {
    if (this._initDone) return;
    try {
      if (!fs.existsSync(SHADOW_DIR)) fs.mkdirSync(SHADOW_DIR, { recursive: true });
      this._cleanupOldFiles();
      this._initDone = true;
    } catch(e) {
      try { console.warn('[INTENT_SHADOW] init err: ' + e.message); } catch(_){}
    }
  },

  _cleanupOldFiles() {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 86400000;
      const files = fs.readdirSync(SHADOW_DIR);
      for (const f of files) {
        if (!/^\d{4}-\d{2}-\d{2}\.csv$/.test(f)) continue;
        const p = path.join(SHADOW_DIR, f);
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs < cutoff) fs.unlinkSync(p);
        } catch(_){}
      }
    } catch(_){}
  },

  _dailyFilePath() {
    // P3-CSV-FIX [2026-06-03]: neue Datei `<YYYY-MM-DD>-p3.csv` mit 28-Spalten-Header.
    // Alte 2026-06-03.csv (vor P3) bleibt unverändert. Migration der Post-P3-Rows in die
    // neue Datei ist out-of-band passiert. Logger schreibt ab jetzt in -p3.csv.
    const d = new Date();
    const ymd = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(d.getUTCDate()).padStart(2,'0');
    return path.join(SHADOW_DIR, ymd + '-p3.csv');
  },

  /**
   * Hauptfunktion: Aladdin-Shadow-Intent aus aktuellem Brain/Regime/Symbol ableiten.
   *
   * @param {Object} ctx
   *   symbol, brainResult, uScore, regime, regimeConfidence, openSymbols (Set), slotsAvailable
   *   priceNow, hasOpenPositionThis (boolean), actualAction (was passierte real)
   * @returns {Object} intent
   */
  deriveIntent(ctx) {
    const {
      symbol,
      brainResult,
      uScore,
      regime,
      regimeConfidence,
      hasOpenPositionThis,
      slotsAvailable,
      priceNow,
      actualAction,
    } = ctx;

    // signalSource ermitteln
    const brainDir = (brainResult && brainResult.decision) || null;
    const brainConf = (brainResult && typeof brainResult.confidence === 'number') ? brainResult.confidence : 0;
    const uniDir = (uScore && uScore.direction) || null;
    const uniConf = (uScore && typeof uScore.confidence === 'number') ? uScore.confidence : 0;

    let signalSource = 'NONE';
    if (brainDir && uniDir) {
      signalSource = (brainDir === uniDir) ? 'BRAIN+UNIFIED' : 'BRAIN';
    } else if (brainDir) signalSource = 'BRAIN';
    else if (uniDir) signalSource = 'UNIFIED';

    // Decision (Brain bevorzugt; ohne Brain: Unified)
    const decision = brainDir || uniDir || 'HOLD';
    const confidence = brainConf || uniConf || 0;

    // Symbol-Klasse + erlaubte Strategien
    let symbolClass = 'UNKNOWN';
    let allowed = [];
    let forbidden = [];
    try {
      if (_SU) {
        const cfg = _SU.getCoinConfig(symbol);
        symbolClass = cfg.class || 'UNKNOWN';
        allowed = (cfg.allowed_strategies || []).slice();
        forbidden = (cfg.forbidden_strategies || []).slice();
      }
    } catch(_){}

    // Intent-Logik (regelbasiert, regime-aware, P2.0-Befunde respektiert)
    let botTypeIntent = 'NONE';
    let selectedStrategy = 'NONE';
    let intentReason = 'DEFAULT_HOLD';

    // 1) Hartes NONE für ANALYSIS — niemals handeln
    if (symbolClass === 'ANALYSIS') {
      botTypeIntent = 'NONE';
      selectedStrategy = 'NONE';
      intentReason = 'ANALYSIS_NO_TRADE';
    }
    // 2) Decision HOLD → NONE
    else if (decision === 'HOLD') {
      botTypeIntent = 'NONE';
      selectedStrategy = 'NONE';
      intentReason = 'BRAIN_HOLD';
    }
    // 3) BEAR / EXTREME_BEAR Regime — blockt nur LONG-Entries (BUY).
    //    SELL fällt zur Priorität 7 durch (dort Spot-only-konform behandelt).
    //    P2.1.1 [2026-06-03]: SELL nicht mehr hier abfangen — vorher wurde SELL+!open
    //    fälschlich als BEAR_REDUCE_ONLY = REDUCE_RISK gelabelt, was REDUCE_RISK ohne
    //    bestehende Position bedeutet (semantisch falsch in Spot-only).
    else if ((regime === 'BEAR' || regime === 'EXTREME_BEAR' || regime === 'FLASH_CRASH')
             && decision === 'BUY') {
      botTypeIntent = 'NONE';
      selectedStrategy = 'NONE';
      intentReason = 'BEAR_NO_LONG';
    }
    // 4) Symbol bereits offen → Maintenance, kein neuer Entry.
    //    P2.1.1: GILT NUR FÜR BUY. SELL+offene-Position muss zu Priorität 7 durchfallen
    //    (dort REDUCE_RISK / SELL_CLOSE_LONG — ehrlicher Exit-Intent statt ALREADY_OPEN).
    else if (decision === 'BUY' && hasOpenPositionThis) {
      botTypeIntent = 'NONE';
      selectedStrategy = 'NONE';
      intentReason = 'ALREADY_OPEN';
    }
    // 5) Slots voll → CLOSE_WORST-Intent (Rotation-Vorschlag).
    //    P2.1.1: GILT NUR FÜR BUY. SELL bei vollen Slots ist kein Rotation-Hint,
    //    sondern fällt zu Priorität 7 durch.
    else if (decision === 'BUY' && slotsAvailable !== undefined && slotsAvailable <= 0) {
      botTypeIntent = 'CLOSE_WORST';
      selectedStrategy = 'NONE';
      intentReason = 'SLOTS_FULL';
    }
    // 6) BUY-Intent
    else if (decision === 'BUY') {
      if (regime === 'BULL') {
        // BULL: P2.0 zeigt +61 bps edge bei MID-Klasse
        if (symbolClass === 'MID' || symbolClass === 'SMALL') {
          botTypeIntent = 'SINGLE';
          selectedStrategy = 'TREND';
          intentReason = 'BULL_TREND_LONG';
        } else if (symbolClass === 'MEGA') {
          // MEGA-Universe erlaubt nur MR — SINGLE+MR im BULL
          botTypeIntent = 'SINGLE';
          selectedStrategy = 'MR';
          intentReason = 'BULL_MEGA_MR_LONG';
        } else {
          botTypeIntent = 'NONE';
          intentReason = 'BULL_UNKNOWN_CLASS';
        }
      } else if (regime === 'CHOPPY') {
        // CHOPPY: P2.0 +18 bps — Range/Grid passt
        botTypeIntent = 'GRID';
        selectedStrategy = 'GRID';
        intentReason = 'CHOPPY_RANGE_GRID';
      } else if (regime === 'RANGING') {
        // RANGING: -6 bps historisch; vorsichtig — INFGRID statt Single
        botTypeIntent = 'INFGRID';
        selectedStrategy = 'GRID';
        intentReason = 'RANGING_INFGRID';
      } else if (regime === 'SQUEEZE') {
        // SQUEEZE: -13.5 bps — abwarten
        botTypeIntent = 'NONE';
        intentReason = 'SQUEEZE_WAIT';
      } else {
        // NEUTRAL und andere — neutrale Klasse-spezifische Wahl
        if (symbolClass === 'MEGA') {
          botTypeIntent = 'SINGLE';
          selectedStrategy = 'MR';
          intentReason = 'NEUTRAL_MEGA_MR';
        } else if (symbolClass === 'MID' || symbolClass === 'SMALL') {
          botTypeIntent = 'SINGLE';
          selectedStrategy = 'TREND';
          intentReason = 'NEUTRAL_TREND';
        } else {
          botTypeIntent = 'NONE';
          intentReason = 'NEUTRAL_UNKNOWN';
        }
      }
    }
    // 7) SELL-Intent — P2.1.1 [2026-06-03]: Spot-only-konform.
    //    PAPER simulierte SELL als synthetischen Short. LIVE-Pfad ist Bitget Spot
    //    (`/api/v2/spot/trade/place-order`) — Spot kann NICHT shorten. Daher:
    //    - SELL ohne offene Position → NONE (in LIVE wäre das Spot-Sell ohne Holding = kaputt/no-op)
    //    - SELL mit offener Position  → REDUCE_RISK (ehrlicher Long-Exit, Spot-konform)
    //    Bis Short-Support Demo=Live identisch ist (bspw. via placeFuturesOrder
    //    mit holdSide='short' im DemoEngine-Pfad), darf Shadow keine SINGLE/MR/TREND
    //    "SELL_*_SHORT"-Intents mehr loggen — das wäre PAPER-Fantasy.
    else if (decision === 'SELL') {
      if (!hasOpenPositionThis) {
        botTypeIntent = 'NONE';
        selectedStrategy = 'NONE';
        intentReason = 'SELL_NO_POSITION_NO_SHORT';
      } else {
        botTypeIntent = 'REDUCE_RISK';
        selectedStrategy = 'NONE';
        intentReason = 'SELL_CLOSE_LONG';
      }
    }

    // 8) Strategy-Veto Cross-Check (selectedStrategy gegen Symbol-Universe)
    let stratValid = true;
    if (selectedStrategy !== 'NONE' && _Veto && typeof _Veto.validateStrategy === 'function') {
      try {
        const v = _Veto.validateStrategy(symbol, selectedStrategy);
        stratValid = v.ok;
        if (!v.ok && botTypeIntent !== 'NONE' && botTypeIntent !== 'CLOSE_WORST' && botTypeIntent !== 'REDUCE_RISK') {
          // Strategy ist forbidden — Intent fällt auf NONE, Reason wird festgehalten
          intentReason = intentReason + '+STRAT_VETO:' + v.reason;
        }
      } catch(_){}
    }

    // 9) Shadow Router-Verdict (ALLOW/BLOCK + Reason)
    let routerVerdictShadow = 'N/A';
    let routerReasonShadow = '';
    if (_Router && typeof _Router.gateExecution === 'function' &&
        (botTypeIntent === 'SINGLE' || botTypeIntent === 'GRID' || botTypeIntent === 'INFGRID' || botTypeIntent === 'DCA' || botTypeIntent === 'MR')) {
      try {
        const verdict = _Router.gateExecution({
          sourceBot: 'SHADOW_INTENT',
          symbol,
          direction: decision,
          confidence,
          selectedStrategy,
          operation: 'CREATE_NEW',
        });
        routerVerdictShadow = verdict.ok ? 'ALLOW' : 'BLOCK';
        routerReasonShadow = verdict.vetoReason || (verdict.ok ? 'OK' : '?');
      } catch(e) {
        routerVerdictShadow = 'ERR';
        routerReasonShadow = e.message;
      }
    } else if (botTypeIntent === 'NONE' || botTypeIntent === 'CLOSE_WORST' || botTypeIntent === 'REDUCE_RISK') {
      routerVerdictShadow = 'N/A';
      routerReasonShadow = 'NO_ENTRY_INTENT';
    }

    // 10) wouldOpen/wouldClose/wouldSkip
    const isEntryBot = ['SINGLE','GRID','INFGRID','DCA','MR'].includes(botTypeIntent);
    const wouldOpen = isEntryBot && routerVerdictShadow === 'ALLOW';
    const wouldClose = (botTypeIntent === 'CLOSE_WORST' || botTypeIntent === 'REDUCE_RISK');
    const wouldSkip = (botTypeIntent === 'NONE');

    return {
      ts: Date.now(),
      symbol,
      decision,
      confidence: Number(confidence.toFixed(4)),
      botTypeIntent,
      selectedStrategy,
      signalSource,
      regime: regime || 'UNKNOWN',
      regimeConfidence: Number((regimeConfidence || 0).toFixed(3)),
      symbolClass,
      intentReason,
      routerVerdictShadow,
      routerReasonShadow,
      actualAction: actualAction || '',
      wouldOpen,
      wouldClose,
      wouldSkip,
      priceNow: Number(priceNow || 0),
      edgeEstimateBps: 0,  // Reserved für künftige Edge-History-Lookups
    };
  },

  /**
   * Intent-Row in CSV + Ring loggen. Sicher und fehler-tolerant.
   */
  log(intent) {
    if (!this.enabled || !intent) return;
    if (!this._initDone) this.init();

    // Ring-Buffer (newest first)
    this._ringBuffer.unshift(intent);
    if (this._ringBuffer.length > RING_SIZE) this._ringBuffer.length = RING_SIZE;

    // CSV append
    try {
      const fpath = this._dailyFilePath();
      if (fpath !== this._todayFile) {
        this._todayFile = fpath;
        this._todayHeaderWritten = fs.existsSync(fpath);
      }
      if (!this._todayHeaderWritten) {
        fs.writeFileSync(fpath, HEADER + '\n', { flag: 'a' });
        this._todayHeaderWritten = true;
      }
      const row = [
        intent.ts,
        intent.symbol,
        intent.decision,
        intent.confidence,
        intent.botTypeIntent,
        intent.selectedStrategy,
        intent.signalSource,
        intent.regime,
        intent.regimeConfidence,
        intent.symbolClass,
        intent.intentReason.replace(/[,\n]/g, ' '),
        intent.routerVerdictShadow,
        intent.routerReasonShadow.replace(/[,\n]/g, ' '),
        intent.actualAction,
        intent.wouldOpen ? 1 : 0,
        intent.wouldClose ? 1 : 0,
        intent.wouldSkip ? 1 : 0,
        intent.priceNow,
        intent.edgeEstimateBps,
        // P3-Felder
        intent.routerVerdictCurrent || intent.routerVerdictShadow,
        (intent.routerReasonCurrent || intent.routerReasonShadow || '').replace(/[,\n]/g, ' '),
        intent.p3RouterVerdictShadow || 'N/A',
        (intent.p3RouterReasonShadow || '').replace(/[,\n]/g, ' '),
        intent.routerDiff || 'N/A',
        intent.p3WouldOpen ? 1 : 0,
        intent.p3WouldClose ? 1 : 0,
        intent.p3RiskFlag ? 1 : 0,
        (intent.p3Explain || '').replace(/[,\n]/g, ' '),
      ].join(',');
      fs.appendFileSync(fpath, row + '\n');
      this._writeOK++;
    } catch(e) {
      this._writeErrors++;
      if (this._writeErrors < 5) {
        try { console.warn('[INTENT_SHADOW] write err: ' + e.message); } catch(_){}
      }
    }
  },

  /**
   * P3 [2026-06-03]: Shadow-Router-Vertrag — Intent-aware.
   *
   * Parallel-Berechnung neben dem Current-Router. Reale Ausführung nutzt NICHTS daraus.
   * Hard-Safeties müssen IMMER zu BLOCK/N/A führen, auch im P3-Pfad (Christian-Pflicht):
   *   - ANALYSIS-Klasse → NIE ALLOW
   *   - BEAR-Regime + BUY → NIE ALLOW
   *   - SELL ohne offene Position → NIE ALLOW (Spot-Short-Fantasy)
   *   - HOLD-Decision → NIE ALLOW
   *   - botTypeIntent in {NONE, REDUCE_RISK, CLOSE_WORST} → N/A (kein Entry)
   *   - kein priceNow → BLOCK (stale/missing data)
   *   - Symbol nicht in symbol_universe → BLOCK (NOT_IN_TRADING_UNIVERSE)
   *
   * P3 LOCKERT nur die Strategy-Klassen-Matrix (Christian-Beispiele):
   *   - GRID    + CHOPPY   auf non-ANALYSIS → CONDITIONAL_ALLOW
   *   - INFGRID + RANGING  auf non-ANALYSIS → CONDITIONAL_ALLOW
   *   - SINGLE  + universe-allowed strategy → ALLOW (gleich Current)
   *   - SINGLE  + universe-FORBIDDEN strategy → CONDITIONAL_ALLOW NUR wenn Regime-passend (zb BULL+TREND auf MEGA)
   *
   * @param {Object} intent - Output aus deriveIntent()
   * @returns {Object} { verdict, reason, wouldOpen, wouldClose, riskFlag, explain }
   */
  p3Evaluate(intent) {
    if (!intent) return { verdict:'N/A', reason:'NO_INTENT', wouldOpen:false, wouldClose:false, riskFlag:false, explain:'no intent provided' };

    const {
      symbol, decision, confidence,
      botTypeIntent, selectedStrategy,
      regime, symbolClass,
      priceNow,
    } = intent;

    // ── HARD-SAFETIES (müssen genauso wie Current-Router blocken) ──

    // H1: ANALYSIS-Klasse → NIE ALLOW
    if (symbolClass === 'ANALYSIS') {
      return { verdict:'N/A', reason:'ANALYSIS_HARD_SAFETY', wouldOpen:false, wouldClose:false, riskFlag:true, explain:'ANALYSIS class is hard-forbidden regardless of intent' };
    }

    // H2: Kein priceNow → stale/missing data
    if (!priceNow || priceNow <= 0) {
      return { verdict:'BLOCK', reason:'STALE_PRICE', wouldOpen:false, wouldClose:false, riskFlag:true, explain:'no valid price → block' };
    }

    // H3: Symbol nicht im Universe → BLOCK
    if (_SU && typeof _SU.getCoinConfig === 'function') {
      try {
        const cfg = _SU.getCoinConfig(symbol);
        if (!cfg || cfg.class === 'UNKNOWN') {
          return { verdict:'BLOCK', reason:'NOT_IN_TRADING_UNIVERSE', wouldOpen:false, wouldClose:false, riskFlag:true, explain:'symbol not in trading universe' };
        }
      } catch(_){}
    }

    // H4: Non-Entry-Intents bleiben N/A (Exit/Reduction wird vom Exit-Pfad behandelt)
    if (botTypeIntent === 'NONE') {
      return { verdict:'N/A', reason:'NO_ENTRY_INTENT', wouldOpen:false, wouldClose:false, riskFlag:false, explain:'intent is NONE — no entry candidate' };
    }
    if (botTypeIntent === 'REDUCE_RISK' || botTypeIntent === 'CLOSE_WORST') {
      // Exit-Intents werden im P3-Router nicht entry-evaluiert
      return { verdict:'N/A', reason:'EXIT_INTENT_'+botTypeIntent, wouldOpen:false, wouldClose:true, riskFlag:false, explain:'exit/reduction intent — not an entry' };
    }

    // H5: HOLD-Decision → kein Entry
    if (decision === 'HOLD') {
      return { verdict:'N/A', reason:'BRAIN_HOLD', wouldOpen:false, wouldClose:false, riskFlag:false, explain:'brain HOLD → no entry' };
    }

    // H6: BEAR + BUY → NIE ALLOW (Hard-Safety)
    if ((regime === 'BEAR' || regime === 'EXTREME_BEAR' || regime === 'FLASH_CRASH') && decision === 'BUY') {
      return { verdict:'BLOCK', reason:'BEAR_NO_LONG_HARD', wouldOpen:false, wouldClose:false, riskFlag:true, explain:'BEAR regime forbids LONG entries (hard-safety)' };
    }

    // H7: SELL → P2.1.1-Spot-Only-Konformität. SELL-Entries gibt es im Shadow nicht
    //     (deriveIntent mapped SELL→NONE/REDUCE_RISK), aber zur Sicherheit:
    if (decision === 'SELL') {
      return { verdict:'N/A', reason:'SELL_NOT_ENTRY', wouldOpen:false, wouldClose:false, riskFlag:true, explain:'SELL is not a valid entry in Spot-only — hard-safety mirrors P2.1.1' };
    }

    // ── STRATEGY-MATRIX RELAXATIONS (nur hier wird P3 weicher als Current) ──

    let allowed = [], forbidden = [];
    try {
      if (_SU) {
        const cfg = _SU.getCoinConfig(symbol);
        allowed = (cfg.allowed_strategies || []).slice();
        forbidden = (cfg.forbidden_strategies || []).slice();
      }
    } catch(_){}

    // R1: SINGLE mit universe-erlaubter Strategy → ALLOW (gleich wie Current)
    if (botTypeIntent === 'SINGLE' && allowed.includes(selectedStrategy)) {
      return {
        verdict: 'ALLOW',
        reason: 'SINGLE_UNIVERSE_OK',
        wouldOpen: true,
        wouldClose: false,
        riskFlag: false,
        explain: 'SINGLE with universe-allowed strategy ('+selectedStrategy+' for '+symbolClass+')'
      };
    }

    // R2: GRID + CHOPPY auf non-ANALYSIS → CONDITIONAL_ALLOW
    //     Aladdin sieht CHOPPY (Range-Markt), Grid würde aus Oszillation verdienen.
    //     Current blockt (MID/MEGA+GRID forbidden), P3 lockert KONDITIONIERT.
    if (botTypeIntent === 'GRID' && regime === 'CHOPPY') {
      return {
        verdict: 'CONDITIONAL_ALLOW',
        reason: 'GRID_IN_CHOPPY',
        wouldOpen: true,
        wouldClose: false,
        riskFlag: false,
        explain: 'GRID in CHOPPY regime — range-trading hypothesis ('+symbolClass+'). Needs grid-sim outcome validation, not directional.'
      };
    }

    // R3: INFGRID + RANGING auf non-ANALYSIS → CONDITIONAL_ALLOW
    if (botTypeIntent === 'INFGRID' && regime === 'RANGING') {
      return {
        verdict: 'CONDITIONAL_ALLOW',
        reason: 'INFGRID_IN_RANGING',
        wouldOpen: true,
        wouldClose: false,
        riskFlag: false,
        explain: 'INFGRID in RANGING regime — infinite-grid hypothesis ('+symbolClass+'). Needs grid-sim outcome validation.'
      };
    }

    // R4: SINGLE mit forbidden Strategy, ABER Regime passt zur Strategy → CONDITIONAL_ALLOW
    //     Beispiel: MEGA+TREND in BULL — Current blockt (MEGA forbids TREND), P3 hypothetisiert.
    //     Nur wenn Regime und Strategy semantisch passen.
    if (botTypeIntent === 'SINGLE' && forbidden.includes(selectedStrategy)) {
      const regimeStrategyMatch = (
        (selectedStrategy === 'TREND' && (regime === 'BULL' || regime === 'BEAR_WEAK')) ||
        (selectedStrategy === 'MR' && (regime === 'NEUTRAL' || regime === 'CHOPPY')) ||
        (selectedStrategy === 'GRID' && (regime === 'CHOPPY' || regime === 'RANGING'))
      );
      if (regimeStrategyMatch) {
        return {
          verdict: 'CONDITIONAL_ALLOW',
          reason: 'SINGLE_FORBIDDEN_BUT_REGIME_MATCHES',
          wouldOpen: true,
          wouldClose: false,
          riskFlag: true,
          explain: 'SINGLE+'+selectedStrategy+' is forbidden for '+symbolClass+' but regime '+regime+' favors it — hypothesis only'
        };
      }
      return {
        verdict: 'BLOCK',
        reason: 'STRATEGY_FORBIDDEN_REGIME_NO_MATCH',
        wouldOpen: false,
        wouldClose: false,
        riskFlag: false,
        explain: 'SINGLE+'+selectedStrategy+' forbidden for '+symbolClass+' and regime '+regime+' does not favor it'
      };
    }

    // R5: GRID/INFGRID außerhalb CHOPPY/RANGING → mirror Current (likely BLOCK)
    if (botTypeIntent === 'GRID' || botTypeIntent === 'INFGRID') {
      return {
        verdict: 'BLOCK',
        reason: botTypeIntent + '_REGIME_NO_MATCH',
        wouldOpen: false,
        wouldClose: false,
        riskFlag: false,
        explain: botTypeIntent+' outside its preferred regime ('+regime+') — no relax'
      };
    }

    // R6: DCA / MR / unbekannte botType
    if (botTypeIntent === 'DCA' || botTypeIntent === 'MR') {
      // Hard-safety: kein DCA in BEAR (falling knife)
      if (regime === 'BEAR' || regime === 'EXTREME_BEAR' || regime === 'FLASH_CRASH') {
        return { verdict:'BLOCK', reason:botTypeIntent+'_IN_BEAR', wouldOpen:false, wouldClose:false, riskFlag:true, explain:'DCA/MR in BEAR = falling-knife. Hard-block.' };
      }
      // Sonst spiegelt Current
      if (allowed.includes(selectedStrategy)) {
        return { verdict:'ALLOW', reason:botTypeIntent+'_UNIVERSE_OK', wouldOpen:true, wouldClose:false, riskFlag:false, explain:botTypeIntent+' with universe-allowed strategy' };
      }
      return { verdict:'BLOCK', reason:'STRATEGY_NOT_ALLOWED', wouldOpen:false, wouldClose:false, riskFlag:false, explain:botTypeIntent+' strategy not in universe' };
    }

    // Default: unknown intent → BLOCK
    return {
      verdict: 'BLOCK',
      reason: 'UNKNOWN_INTENT',
      wouldOpen: false,
      wouldClose: false,
      riskFlag: true,
      explain: 'unhandled intent type '+botTypeIntent
    };
  },

  /**
   * Diff-Klassifizierung Current vs P3.
   */
  _routerDiff(currentVerdict, p3Verdict) {
    const c = currentVerdict || 'N/A';
    const p = p3Verdict || 'N/A';
    if (c === p) return 'SAME_' + c;
    if (c === 'BLOCK' && (p === 'ALLOW' || p === 'CONDITIONAL_ALLOW')) return 'CURRENT_BLOCK_P3_'+p;
    if ((c === 'ALLOW' || c === 'CONDITIONAL_ALLOW') && p === 'BLOCK') return 'CURRENT_ALLOW_P3_BLOCK';
    return 'CURRENT_'+c+'_P3_'+p;
  },

  /**
   * Convenience: deriveIntent + log in einem Call.
   */
  observe(ctx) {
    if (!this.enabled) return null;
    try {
      const intent = this.deriveIntent(ctx);
      // P3 [2026-06-03]: Parallel Shadow-Router-Vertrag. Fire-and-forget, fehler-tolerant.
      // Hinweis: intent.routerVerdictShadow ist der Output des CURRENT FinalDecisionRouter
      // (unverändert). p3RouterVerdictShadow ist der NEUE parallele Vertrag.
      try {
        intent.routerVerdictCurrent = intent.routerVerdictShadow;
        intent.routerReasonCurrent = intent.routerReasonShadow;
        const p3 = this.p3Evaluate(intent);
        intent.p3RouterVerdictShadow = p3.verdict;
        intent.p3RouterReasonShadow = p3.reason;
        intent.p3WouldOpen = !!p3.wouldOpen;
        intent.p3WouldClose = !!p3.wouldClose;
        intent.p3RiskFlag = !!p3.riskFlag;
        intent.p3Explain = p3.explain || '';
        intent.routerDiff = this._routerDiff(intent.routerVerdictCurrent, intent.p3RouterVerdictShadow);
      } catch(e) {
        intent.p3RouterVerdictShadow = 'ERR';
        intent.p3RouterReasonShadow = e.message;
        intent.routerDiff = 'P3_ERR';
        try { console.warn('[INTENT_SHADOW] p3Evaluate err: ' + e.message); } catch(_){}
      }
      this.log(intent);
      return intent;
    } catch(e) {
      try { console.warn('[INTENT_SHADOW] observe err: ' + e.message); } catch(_){}
      return null;
    }
  },

  /**
   * Snapshot der letzten N Intents (für API/Dashboard).
   */
  recent(limit = 50, symbol = null) {
    let r = this._ringBuffer;
    if (symbol) r = r.filter(i => i.symbol === symbol);
    return r.slice(0, Math.min(limit, RING_SIZE));
  },

  /**
   * Aggregat-Stats über das aktuelle In-Memory-Ring.
   */
  stats() {
    const r = this._ringBuffer;
    const n = r.length;
    if (!n) return { n: 0, writeOK: this._writeOK, writeErrors: this._writeErrors };
    const counts = { decisions: {}, intents: {}, regimes: {}, sources: {}, routerVerdicts: {}, p3Verdicts: {}, routerDiffs: {} };
    let wOpen=0, wClose=0, wSkip=0;
    let p3Open=0, p3Close=0, p3Risk=0;
    let safetyViolations = 0;  // P3 darf bei ANALYSIS/BEAR/SELL niemals (CONDITIONAL_)ALLOW
    for (const i of r) {
      counts.decisions[i.decision] = (counts.decisions[i.decision]||0)+1;
      counts.intents[i.botTypeIntent] = (counts.intents[i.botTypeIntent]||0)+1;
      counts.regimes[i.regime] = (counts.regimes[i.regime]||0)+1;
      counts.sources[i.signalSource] = (counts.sources[i.signalSource]||0)+1;
      counts.routerVerdicts[i.routerVerdictShadow] = (counts.routerVerdicts[i.routerVerdictShadow]||0)+1;
      if (i.p3RouterVerdictShadow) counts.p3Verdicts[i.p3RouterVerdictShadow] = (counts.p3Verdicts[i.p3RouterVerdictShadow]||0)+1;
      if (i.routerDiff) counts.routerDiffs[i.routerDiff] = (counts.routerDiffs[i.routerDiff]||0)+1;
      if (i.wouldOpen) wOpen++;
      if (i.wouldClose) wClose++;
      if (i.wouldSkip) wSkip++;
      if (i.p3WouldOpen) p3Open++;
      if (i.p3WouldClose) p3Close++;
      if (i.p3RiskFlag) p3Risk++;
      // Hard-Safety-Violation-Check: P3 darf NIE ALLOW/CONDITIONAL_ALLOW bei diesen Bedingungen
      const p3v = i.p3RouterVerdictShadow;
      const isAllow = (p3v === 'ALLOW' || p3v === 'CONDITIONAL_ALLOW');
      const hardForbid = (
        i.symbolClass === 'ANALYSIS' ||
        ((i.regime === 'BEAR' || i.regime === 'EXTREME_BEAR' || i.regime === 'FLASH_CRASH') && i.decision === 'BUY') ||
        i.decision === 'SELL' ||
        i.decision === 'HOLD' ||
        !i.priceNow
      );
      if (isAllow && hardForbid) safetyViolations++;
    }
    return {
      n,
      wouldOpen: wOpen, wouldClose: wClose, wouldSkip: wSkip,
      p3WouldOpen: p3Open, p3WouldClose: p3Close, p3RiskFlagged: p3Risk,
      p3SafetyViolations: safetyViolations,
      decisions: counts.decisions,
      intents: counts.intents,
      regimes: counts.regimes,
      sources: counts.sources,
      p3Verdicts: counts.p3Verdicts,
      routerDiffs: counts.routerDiffs,
      routerVerdicts: counts.routerVerdicts,
      writeOK: this._writeOK,
      writeErrors: this._writeErrors,
    };
  },
};

module.exports = IntentShadow;
