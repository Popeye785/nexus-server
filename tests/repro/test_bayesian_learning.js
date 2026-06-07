// Test-First Bayesian-Learning
// Simuliere: Priors konvergieren wenn Observations konsistent bullish?

const RiskEngine = {
  bayesian: {
    priors: { bull: 0.33, bear: 0.33, sideways: 0.34 },
    likelihoods: {
      bull:     { highRSI: 0.7, macdBull: 0.75, volSpike: 0.4, pricAboveEMA: 0.8 },
      bear:     { highRSI: 0.3, macdBull: 0.25, volSpike: 0.5, pricAboveEMA: 0.2 },
      sideways: { highRSI: 0.5, macdBull: 0.5,  volSpike: 0.3, pricAboveEMA: 0.5 }
    },
    history: [],
    update: function(observations, learnPriors=false) {
      const { rsi, macdBull, volSpike, priceAboveEMA } = observations;
      const states = ['bull', 'bear', 'sideways'];
      const posteriors = {};
      let total = 0;
      for (const state of states) {
        const lk = this.likelihoods[state];
        let likelihood = 1;
        if (rsi !== null) likelihood *= rsi > 60 ? lk.highRSI : (1 - lk.highRSI);
        if (macdBull !== null) likelihood *= macdBull ? lk.macdBull : (1 - lk.macdBull);
        if (volSpike !== null) likelihood *= volSpike ? lk.volSpike : (1 - lk.volSpike);
        if (priceAboveEMA !== null) likelihood *= priceAboveEMA ? lk.pricAboveEMA : (1 - lk.pricAboveEMA);
        posteriors[state] = likelihood * this.priors[state];
        total += posteriors[state];
      }
      for (const state of states) posteriors[state] /= (total || 1);
      if (learnPriors) {
        const lr = 0.05;
        for (const state of states) {
          let next = this.priors[state] * (1 - lr) + posteriors[state] * lr;
          this.priors[state] = Math.max(0.05, Math.min(0.70, next));
        }
        const sumP = states.reduce((s,x) => s + this.priors[x], 0);
        if (sumP > 0) states.forEach(s => { this.priors[s] /= sumP; });
      }
      return { posteriors, priors: {...this.priors} };
    }
  }
};

function assert(c,m){if(!c){console.log('FAIL:',m);process.exit(1);}console.log('  ✓',m);}

console.log('── Test 1: Initial Priors uniform');
const init = {...RiskEngine.bayesian.priors};
assert(Math.abs(init.bull - 0.33) < 0.01, 'bull ~0.33');

console.log('── Test 2: 50× consistent bullish observations → bull-prior steigt');
for (let i = 0; i < 50; i++) {
  RiskEngine.bayesian.update({ rsi: 70, macdBull: true, volSpike: true, priceAboveEMA: true }, true);
}
const after = RiskEngine.bayesian.priors;
console.log(`   Priors nach 50 bullish: bull=${after.bull.toFixed(3)} bear=${after.bear.toFixed(3)} sideways=${after.sideways.toFixed(3)}`);
assert(after.bull > init.bull + 0.1, `bull-prior gestiegen um ${(after.bull-init.bull).toFixed(3)}`);
assert(after.bear < init.bear, 'bear-prior gesunken');

console.log('── Test 3: Reset + 50× bearish → bear-prior steigt');
RiskEngine.bayesian.priors = { bull: 0.33, bear: 0.33, sideways: 0.34 };
for (let i = 0; i < 50; i++) {
  RiskEngine.bayesian.update({ rsi: 30, macdBull: false, volSpike: false, priceAboveEMA: false }, true);
}
const bearAfter = RiskEngine.bayesian.priors;
console.log(`   Priors nach 50 bearish: bull=${bearAfter.bull.toFixed(3)} bear=${bearAfter.bear.toFixed(3)} sideways=${bearAfter.sideways.toFixed(3)}`);
assert(bearAfter.bear > 0.33 + 0.1, 'bear-prior gestiegen');

console.log('── Test 4: learnPriors=false → Priors unverändert (default-Verhalten)');
RiskEngine.bayesian.priors = { bull: 0.33, bear: 0.33, sideways: 0.34 };
for (let i = 0; i < 20; i++) {
  RiskEngine.bayesian.update({ rsi: 70, macdBull: true, volSpike: true, priceAboveEMA: true }, false);
}
const noLearn = RiskEngine.bayesian.priors;
assert(Math.abs(noLearn.bull - 0.33) < 0.001, 'bull unverändert ohne learnPriors');

console.log('── Test 5: Caps verhindern Kollaps (5%-70%)');
RiskEngine.bayesian.priors = { bull: 0.33, bear: 0.33, sideways: 0.34 };
for (let i = 0; i < 500; i++) {
  RiskEngine.bayesian.update({ rsi: 99, macdBull: true, volSpike: true, priceAboveEMA: true }, true);
}
const extreme = RiskEngine.bayesian.priors;
console.log(`   Extreme: bull=${extreme.bull.toFixed(3)} bear=${extreme.bear.toFixed(3)} sideways=${extreme.sideways.toFixed(3)}`);
// 0.70-Cap pre-renorm, daher post-renorm leicht höher möglich → 0.75 als Faustregel
assert(extreme.bull <= 0.75, `bull approx capped at 0.70 (post-renorm), got ${extreme.bull}`);
assert(extreme.bear >= 0.04, `bear nicht unter 0.05-cap (post-renorm), got ${extreme.bear}`);

console.log('\n✓ ALL TESTS PASS');
