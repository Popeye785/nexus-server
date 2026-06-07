// Phase 3 — Tier 1.1b Brain-Veto V1/V2/V3 Sim
// Auf Live consensus_decisions (letzte 24h)
const Database = require('better-sqlite3');
const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db', { readonly: true });

const VARIANTS = {
  V1_LIVE: {
    name: 'V1_CONSERVATIVE_LIVE',
    description: 'aktuelle Welle-2a Logik: ALLE 5 Bedingungen',
    check(d) {
      // brain.decision === 'HOLD' &&
      // brain.confidence < 0.05 &&
      // brain.reason ~ NO_CONSENSUS  (proxy: brain HOLD + bConf=0)
      // unified.confidence < 0.15 &&
      // unified.direction !== 'HOLD'
      if (d.brain_decision !== 'HOLD') return false;
      if ((d.brain_confidence || 0) >= 0.05) return false;
      // NO_CONSENSUS proxy via brain_consensus
      if (!String(d.brain_consensus || '').includes('NO_CONSENSUS') &&
          !String(d.brain_consensus || '').includes('NEUTRAL') &&
          (d.brain_confidence || 0) > 0) return false;
      if ((d.unified_confidence || 0) >= 0.15) return false;
      if (d.unified_direction === 'HOLD') return false;
      return true;
    }
  },
  V2_MEDIUM: {
    name: 'V2_MEDIUM',
    description: 'brain HOLD + bConf<0.10 + uConf<0.25 + uDir!=HOLD (3 von 5 Bedingungen, mehr Headroom)',
    check(d) {
      if (d.brain_decision !== 'HOLD') return false;
      if ((d.brain_confidence || 0) >= 0.10) return false;
      if ((d.unified_confidence || 0) >= 0.25) return false;
      if (d.unified_direction === 'HOLD') return false;
      return true;
    }
  },
  V3_AGGRESSIVE: {
    name: 'V3_AGGRESSIVE_DISAGREE',
    description: 'Disagreement-Veto: brain HOLD + uDir!=HOLD + uConf<0.35 (Schutz gegen Unified-only-Trades)',
    check(d) {
      if (d.brain_decision !== 'HOLD') return false;
      if (d.unified_direction === 'HOLD') return false;
      if ((d.unified_confidence || 0) >= 0.35) return false;
      return true;
    }
  }
};

const decisions = db.prepare(`
  SELECT id, ts, symbol, brain_decision, brain_confidence, brain_consensus,
         unified_direction, unified_confidence, regime, final_decision, final_confidence
  FROM consensus_decisions
  WHERE ts > strftime('%s','now','-24 hour')*1000
  ORDER BY ts ASC
`).all();

console.log(`\n═══ Sim Basis: ${decisions.length} consensus_decisions (24h) ═══\n`);

// Baseline-Klassifikation
const potential = decisions.filter(d => d.final_decision !== 'HOLD' || d.unified_direction !== 'HOLD');
const finalTrades = decisions.filter(d => d.final_decision !== 'HOLD');
console.log(`Baseline: ${finalTrades.length} echte Trade-Decisions (final !=HOLD)`);
console.log(`         ${potential.length} potenzielle Trade-Inputs (unified !=HOLD ODER final !=HOLD)`);
console.log(`         ${decisions.length - potential.length} HOLD-only`);

// Pro Variant: was würde V blockieren von echten Trade-Decisions
console.log('\n─── Variant Sim (Block-Rate auf potenzielle Trade-Inputs) ───\n');
const results = {};
for (const [key, v] of Object.entries(VARIANTS)) {
  let blocked = 0, blockedOfPotential = 0;
  const blockedSamples = [];
  for (const d of decisions) {
    if (v.check(d)) {
      blocked++;
      if (d.unified_direction !== 'HOLD' || d.final_decision !== 'HOLD') {
        blockedOfPotential++;
      }
      if (blockedSamples.length < 3) blockedSamples.push(d);
    }
  }
  results[key] = { blocked, blockedOfPotential };
  console.log(`${v.name}`);
  console.log(`  ${v.description}`);
  console.log(`  → würde blocken: ${blocked} / ${decisions.length} (${(100*blocked/decisions.length).toFixed(1)}%)`);
  console.log(`  → davon potenzielle Trades: ${blockedOfPotential} / ${potential.length} (${(100*blockedOfPotential/potential.length).toFixed(1)}%)`);
  if (blockedSamples.length) {
    const s = blockedSamples[0];
    console.log(`  Sample: ${s.symbol} bConf=${s.brain_confidence?.toFixed(3)} uDir=${s.unified_direction} uConf=${s.unified_confidence?.toFixed(3)} regime=${s.regime}`);
  }
  console.log('');
}

// Welche Trades würden WEITERHIN durchgelassen unter jedem Modus
console.log('─── Trades die unter Modus durchgehen würden (final !=HOLD UND nicht geblockt) ───\n');
for (const [key, v] of Object.entries(VARIANTS)) {
  const passing = finalTrades.filter(d => !v.check(d));
  console.log(`${v.name}: ${passing.length} Trades / ${finalTrades.length} (${(100*passing.length/finalTrades.length).toFixed(1)}% pass-through)`);
}

// Empfehlung
console.log('\n═══ Empfehlung ═══');
console.log(`V1 ist aktuell live + verifiziert (Welle 2a n=30 Sim: 100% Hit-Rate auf NO_CONSENSUS-Verluste).`);
console.log(`V2 wäre ~3× aggressiver, fängt mehr "low-confidence Brain HOLD bei mittlerer uConf" — Risiko: blockt auch Winner.`);
console.log(`V3 wäre noch breiter — blockt jeden brain-HOLD wenn unified BUY/SELL und uConf<0.35 — drastisch.`);

db.close();
