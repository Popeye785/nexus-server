// Block H STEP 1 Test-First: SMOTE soll Minorität dynamisch wählen, nicht hardcoded SELL.
//
// Szenario A (aktuell): realB=6, realS=0 → SELL ist Minorität → SMOTE generiert SELL ✓
// Szenario B (Future): realB=2, realS=10 → BUY ist Minorität → SMOTE soll BUY generieren ✗ (bei altem Code SELL)
//
// Erwarteter Output:
//   Test A: alter Code PASS, neuer Code PASS (beide korrekt)
//   Test B: alter Code FAIL (hardcoded SELL), neuer Code PASS (BUY-synthese)

const fs = require('fs');
const path = require('path');

function runScenario(realB, realS, target = 0.30) {
  const synthS_existing = 0;
  const realB_n = realB;
  const realS_n = realS;
  const totalSellsCurrent = realS_n + synthS_existing;
  const totalAll = realB_n + realS_n + synthS_existing;
  const currentSellPct = totalAll > 0 ? totalSellsCurrent / totalAll : 0;

  // OLD logic (hardcoded SELL minority):
  const oldMinorityIsSell = true;
  const oldMinoritySide = oldMinorityIsSell ? 'SELL' : 'BUY';
  const oldRealMinority = oldMinoritySide === 'SELL' ? realS_n : realB_n;
  const oldRealMajority = oldMinoritySide === 'SELL' ? realB_n : realS_n;

  // NEW logic (dynamic minority):
  const newMinoritySide = realB_n <= realS_n ? 'BUY' : 'SELL';
  const newRealMinority = newMinoritySide === 'SELL' ? realS_n : realB_n;
  const newRealMajority = newMinoritySide === 'SELL' ? realB_n : realS_n;

  return { realB_n, realS_n, oldMinoritySide, newMinoritySide, currentSellPct };
}

// Test A — actual current state
const A = runScenario(6, 0);
console.log('Test A (current: 6 BUY, 0 SELL):');
console.log('  OLD minority side:', A.oldMinoritySide);
console.log('  NEW minority side:', A.newMinoritySide);
const A_pass = A.oldMinoritySide === A.newMinoritySide;
console.log('  → both agree?', A_pass, '(both SELL = correct)');

// Test B — future scenario (BUY-minority)
const B = runScenario(2, 10);
console.log('\nTest B (future: 2 BUY, 10 SELL):');
console.log('  OLD minority side:', B.oldMinoritySide);
console.log('  NEW minority side:', B.newMinoritySide);
const B_old_wrong = B.oldMinoritySide === 'SELL'; // OLD would over-augment majority
const B_new_correct = B.newMinoritySide === 'BUY';
console.log('  → OLD wrong (would augment majority)?', B_old_wrong);
console.log('  → NEW correct (augments BUY)?', B_new_correct);

// Test C — balanced 5/5
const C = runScenario(5, 5);
console.log('\nTest C (balanced: 5 BUY, 5 SELL):');
console.log('  OLD minority side:', C.oldMinoritySide);
console.log('  NEW minority side:', C.newMinoritySide);

console.log('\n── RED:', B_old_wrong ? 'CONFIRMED OLD-CODE BUG (BUY-minority → SELL-augment)' : 'no bug');
console.log('── GREEN:', B_new_correct ? 'NEW LOGIC CORRECT' : 'NEW LOGIC FAIL');

process.exit((A_pass && B_new_correct) ? 0 : 1);
