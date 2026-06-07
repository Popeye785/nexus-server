---
name: test-first
description: Use this skill when fixing a bug or implementing a new feature. Enforces writing a failing test FIRST that reproduces the bug, then fixing, then verifying the test passes. Trigger when about to "fix", "patch", "repair", "implement".
---

# Test-First

## Workflow

1. **REPRODUCE** — schreibe Test der den Bug zeigt
2. **RUN (RED)** — verify Test ist rot (zeigt Bug)
3. **FIX** — minimale Änderung damit Test grün wird
4. **RUN (GREEN)** — verify Test ist grün
5. **REGRESSION** — alle anderen Tests laufen lassen
6. **EVIDENCE** — Test-Output ins Audit-Log

## Hard Rules

- **Ohne Test = kein Fix.**
- **Test der nicht rot war = kein echter Beweis dass Bug existierte.**
- Test muss reproduzierbar sein (idempotent, kein hidden state).
- Test-Output muss im Live-Log archiviert sein (nicht nur "ja passed").

## Test-Typen bei NEXUS

| Bug-Typ | Test-Tool |
|---|---|
| UI-Bug | Playwright headless mit @playwright/test |
| Backend-Bug | curl + grep im SQL/Output |
| Math-Bug | assert-Script mit known inputs/outputs |
| Race-Condition | parallel-stress-Script (siehe scripts/race_condition_stress.js) |
| ML/Brain-Bug | trainings-batch + SQL-Check der Distribution |
| Wallet/Drift | curl /api/recon/check + diff vs erwarteter Wert |

## Beispiel-Templates

### UI-Bug Reproduction
```js
// tests/repro_ui32.test.js
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(3000);
  const val = await page.evaluate(() => document.getElementById('cap-safe')?.textContent);
  console.log('cap-safe:', val);
  // EXPECT: not "—" or "0.00"; FAIL = bug present
  process.exit(val === '—' || val === '0.00' ? 1 : 0);
})();
```

### Backend-Bug Reproduction
```bash
# tests/repro_drift.sh
DRIFT=$(curl -s http://localhost:3000/api/recon/check | python3 -c "import sys,json;print(json.load(sys.stdin)['drift'])")
EXPECTED=0
if [ "$(echo "$DRIFT == $EXPECTED" | bc -l)" -eq 0 ]; then
  echo "FAIL: drift=$DRIFT (expected=$EXPECTED)"
  exit 1
fi
echo "PASS"
```

### Math-Bug Reproduction
```js
// tests/repro_kelly.test.js
const Kelly = require('./modules/kelly_criterion.js');
const result = Kelly.compute({ wins: 30, losses: 20, totalWinUsdt: 60, totalLossUsdt: 30 });
// Expected: p=0.6, b=1.0, kelly=0.2, halfKelly=0.1
console.assert(result.used >= 0.09 && result.used <= 0.11, `FAIL: used=${result.used}`);
```

## Output Format

```
### Test-First Status: REPRODUCED / FIXED / FAIL-TO-REPRODUCE

### Step 1 — Reproduce
(Test-Script-Path + Output zeigt RED)

### Step 2 — Fix
(Code-Change in Datei + Zeilen-Range)

### Step 3 — Verify GREEN
(Test-Script Re-Run + Output zeigt GREEN)

### Regression
(welche anderen Tests gelaufen + alle GREEN)
```

## NEXUS-Anti-Patterns (REJECT)

- "Bug ist klar, brauche keinen Test" → NEIN. Test schreiben, RED zeigen, dann fix.
- "Test-Run ist zeitaufwendig" → kurzes Snippet reicht, muss nicht voller suite sein
- Tests die bug nie zeigten → REJECT als Beweis
