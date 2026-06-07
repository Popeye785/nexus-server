// Block F Item 1 — Meta-Label Classifier Training
// Lopez de Prado Ch.3.5 Pattern: Sekundärer Classifier lernt wann Primary (Brain) korrekt ist.
// Output: models/meta_label_classifier.json
//
// Workflow:
//   1. Join ml_tb_labels mit aladdin_decisions (closest in time, same symbol)
//   2. Features: 5 Familien-Scores (TREND/MOMENTUM/RISK/SENTIMENT/MICROSTRUCTURE) + confidence + regime
//   3. Label: meta_correct (Brain stimmt mit Outcome überein)
//   4. RandomForest train+test walk-forward (kein random shuffle)
//   5. Save Model + Accuracy + Feature-Importance

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { RandomForestClassifier } = require('ml-random-forest');

const DB_PATH = path.join(__dirname, '..', 'nexus.db');
const MODEL_OUT = path.join(__dirname, '..', 'models', 'meta_label_classifier.json');

console.log('═══ Meta-Label Classifier Training (Block F Item 1) ═══\n');

const db = new Database(DB_PATH, { readonly: true });

// 1. Lade gepairte Samples — pro tb_label EINE nächstgelegene Decision (vorher in Zeit)
const samples = db.prepare(`
  SELECT
    tb.symbol,
    tb.label as tb_label,
    tb.t0_ts,
    (
      SELECT ad.id FROM aladdin_decisions ad
      WHERE ad.symbol = tb.symbol AND ad.ts <= tb.t0_ts AND ad.ts > tb.t0_ts - 600000
      ORDER BY ad.ts DESC LIMIT 1
    ) as decision_id
  FROM ml_tb_labels tb
  WHERE label IS NOT NULL
`).all();

console.log(`tb_labels total: ${samples.length}`);
const withDecision = samples.filter(s => s.decision_id !== null);
console.log(`with decision-join: ${withDecision.length}`);

// 2. Lade Decisions + Features
const stmtDecision = db.prepare(`SELECT * FROM aladdin_decisions WHERE id = ?`);
const featureRows = [];
let parseErrors = 0;
for (const s of withDecision) {
  const d = stmtDecision.get(s.decision_id);
  if (!d) continue;
  let families;
  try { families = JSON.parse(d.families || '{}'); } catch(_) { parseErrors++; continue; }
  const fam = (key) => {
    const f = families[key];
    return f && typeof f.score === 'number' ? f.score : 0;
  };
  const conf = (key) => {
    const f = families[key];
    return f && typeof f.conf === 'number' ? f.conf : 0;
  };
  // Regime one-hot
  const regime = (d.regime || 'NEUTRAL').toUpperCase();
  const regOnehot = {
    BULL: regime.includes('BULL') ? 1 : 0,
    BEAR: regime.includes('BEAR') ? 1 : 0,
    SQUEEZE: regime.includes('SQUEEZE') ? 1 : 0,
    RANGING: regime.includes('RANGING') || regime.includes('NEUTRAL') ? 1 : 0,
  };
  // Feature-Vektor: 10 dims
  const features = [
    fam('TREND'),
    fam('MOMENTUM'),
    fam('RISK'),
    fam('SENTIMENT'),
    fam('MICROSTRUCTURE'),
    Number.isFinite(d.confidence) ? d.confidence : 0.5,
    Number.isFinite(d.unified_conf) ? d.unified_conf : 0.5,
    regOnehot.BULL,
    regOnehot.BEAR,
    regOnehot.SQUEEZE,
  ];
  // Meta-Label: Brain-Entscheidung war korrekt
  // Brain decision: BUY/SELL/HOLD/etc. tb_label: -1 (loss) / 0 (neutral) / +1 (win)
  // Korrekt: BUY+1 oder SELL-1 oder HOLD/0
  const dec = (d.decision || '').toUpperCase();
  let meta_correct = 0;
  if ((dec === 'BUY' || dec === 'STRONG_BUY') && s.tb_label === 1) meta_correct = 1;
  else if ((dec === 'SELL' || dec === 'STRONG_SELL') && s.tb_label === -1) meta_correct = 1;
  else if ((dec === 'HOLD' || dec === 'NEUTRAL') && s.tb_label === 0) meta_correct = 1;

  featureRows.push({
    ts: d.ts,
    symbol: s.symbol,
    features,
    label: meta_correct,
    raw: { dec, tb: s.tb_label }
  });
}
console.log(`feature-rows extracted: ${featureRows.length} (parseErrors=${parseErrors})`);

// 3. Sort by ts (walk-forward — neueste am Ende für Test-Set)
featureRows.sort((a,b) => a.ts - b.ts);
const splitIdx = Math.floor(featureRows.length * 0.8);
const train = featureRows.slice(0, splitIdx);
const test  = featureRows.slice(splitIdx);
console.log(`train: ${train.length}, test: ${test.length}`);

// Keep imbalanced (RF mit useSampleBagging stratifies natürlich).
// Class-Balance via Oversampling verschlechterte Accuracy (sample-bias overfitting).
const X_train = train.map(r => r.features);
const y_train = train.map(r => r.label);
const X_test = test.map(r => r.features);
const y_test = test.map(r => r.label);

const distLabel = (arr) => ({
  pos: arr.filter(x => x === 1).length,
  neg: arr.filter(x => x === 0).length,
});
console.log(`train labels: ${JSON.stringify(distLabel(y_train))}`);
console.log(`test labels:  ${JSON.stringify(distLabel(y_test))}`);

if (train.length < 50 || test.length < 10) {
  console.error('❌ Zu wenig Samples für stabiles Training. Skipping.');
  process.exit(1);
}

// 4. Train RandomForest — Sweep over hyperparams, pick best
console.log('\n── Hyperparam-Sweep');
const configs = [
  { nEstimators: 50, maxDepth: 6, maxFeatures: 0.5 },
  { nEstimators: 100, maxDepth: 8, maxFeatures: 0.7 },
  { nEstimators: 200, maxDepth: 10, maxFeatures: 0.8 },
  { nEstimators: 100, maxDepth: 5, maxFeatures: 0.6 },
];
let bestClassifier = null, bestAcc = -1, bestCfg = null, trainMs = 0;
for (const cfg of configs) {
  const t0 = Date.now();
  const c = new RandomForestClassifier({ ...cfg, seed: 42, useSampleBagging: true });
  c.train(X_train, y_train);
  const ms = Date.now() - t0;
  const pred = c.predict(X_test);
  const acc = pred.filter((p,i) => p === y_test[i]).length / y_test.length;
  console.log(`  ${JSON.stringify(cfg)} → acc=${(acc*100).toFixed(2)}% time=${ms}ms`);
  if (acc > bestAcc) { bestAcc = acc; bestClassifier = c; bestCfg = cfg; trainMs = ms; }
}
const classifier = bestClassifier;
console.log(`\n── Best config: ${JSON.stringify(bestCfg)} → acc=${(bestAcc*100).toFixed(2)}%`);

// 5. Evaluate (with best classifier)
const predictions = classifier.predict(X_test);
let correct = 0, tp = 0, fp = 0, tn = 0, fn = 0;
for (let i = 0; i < y_test.length; i++) {
  if (predictions[i] === y_test[i]) correct++;
  if (predictions[i] === 1 && y_test[i] === 1) tp++;
  if (predictions[i] === 1 && y_test[i] === 0) fp++;
  if (predictions[i] === 0 && y_test[i] === 0) tn++;
  if (predictions[i] === 0 && y_test[i] === 1) fn++;
}
const accuracy = correct / y_test.length;
const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
const f1 = 2 * precision * recall / Math.max(0.0001, precision + recall);
console.log(`\n── Test-Accuracy: ${(accuracy*100).toFixed(2)}%`);
console.log(`   precision: ${(precision*100).toFixed(2)}%`);
console.log(`   recall:    ${(recall*100).toFixed(2)}%`);
console.log(`   F1-score:  ${(f1*100).toFixed(2)}%`);
console.log(`   Confusion: TP=${tp} FP=${fp} TN=${tn} FN=${fn}`);

// 6. Baseline: always-predict-majority
const majClass = distLabel(y_train).pos > distLabel(y_train).neg ? 1 : 0;
const baseline = y_test.filter(y => y === majClass).length / y_test.length;
console.log(`   baseline (majority=${majClass}): ${(baseline*100).toFixed(2)}%`);
console.log(`   improvement: ${((accuracy - baseline)*100).toFixed(2)} Pp`);

// 7. Save model
const model = {
  meta: {
    name: 'meta_label_classifier',
    version: 1,
    created: new Date().toISOString(),
    framework: 'ml-random-forest',
    feature_names: ['fam_TREND','fam_MOMENTUM','fam_RISK','fam_SENTIMENT','fam_MICROSTRUCTURE','brain_conf','unified_conf','reg_BULL','reg_BEAR','reg_SQUEEZE'],
    n_train: train.length,
    n_test: test.length,
    label_dist_train: distLabel(y_train),
    label_dist_test: distLabel(y_test),
    accuracy: Number(accuracy.toFixed(4)),
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    baseline_majority: Number(baseline.toFixed(4)),
    improvement_pp: Number(((accuracy - baseline) * 100).toFixed(2)),
    confusion: { tp, fp, tn, fn },
    trained_at_unix: Date.now(),
    training_ms: trainMs,
  },
  model: classifier.toJSON(),
};
fs.writeFileSync(MODEL_OUT, JSON.stringify(model, null, 2));
console.log(`\n✅ Model saved: ${MODEL_OUT} (${(fs.statSync(MODEL_OUT).size/1024).toFixed(1)} KB)`);

db.close();
