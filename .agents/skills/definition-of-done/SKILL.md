---
name: definition-of-done
description: Use this skill BEFORE declaring any task, fix, deployment, or milestone as complete. Validates production readiness across architecture consistency, regressions, UI/frontend verification, restart persistence, error handling, rollback safety, performance impact, edge cases, logs, build stability, and deployment readiness. Always trigger this skill before output like "✅ done", "deployed", "fixed", "complete", "ready" — and also before any LIVE-Ready audit. Never declare success without running through these checks.
---

# Definition of Done Skill

You are responsible for validating whether work is actually production ready.

## When to use this skill

Trigger before declaring:
- a fix as "deployed"
- a feature as "complete"
- a module as "integrated"
- a backlog item as "done"
- a LIVE-Ready gate as "green"
- a milestone as "achieved"

If you would emit "✅", "deployed", "done", "fixed", "ready", "complete", "passing" — first run this skill.

## Validation Rules

Before declaring completion, verify EACH of these 11 rules:

1. **Architecture consistency** — does the change fit the existing module boundaries and data flow? No orphan code, no module bypassed.

2. **No hidden regressions** — old behavior still works. Snapshot-only modules confirmed actually consumed.

3. **UI / Frontend verification (HARD REQUIREMENT)** — if the change affects anything user-visible:
   - Browser-test with Playwright (or @playwright/test)
   - Cmd+Shift+R simulated to bypass cache
   - All affected tabs/boxes/buttons render correctly
   - No JS errors in console
   - Values match backend response (not just "API returns 200")
   - Mobile viewport tested if UI-relevant
   - Tag 22 anti-pattern: backend ✓ but UI shows "—" = FAIL

4. **Restart persistence** — survives bot restart. State, cache, locks, in-memory data — all rebuild correctly.

5. **Error handling** — every new code path has explicit error handling. No silent catches. Errors logged at ERROR level.

6. **Rollback safety** — backup exists. Rollback procedure tested mentally. Reversal works without data loss.

7. **Performance impact** — no new bottleneck. Memory stable. No N+1 queries. No blocking calls in hot path.

8. **Edge cases** — null/undefined inputs, empty arrays, first-run state, concurrent access. Each enumerated and handled.

9. **Logs** — logs prove the change is active in production. Not just code-presence, but execution-presence.

10. **Build stability** — bot restarts clean. No require() errors. No port conflicts. PID stable, R counter doesn't spike. 5min observation post-deploy.

11. **Deployment readiness** — change works in PAPER mode AND would work in LIVE mode. No DEMO-only paths. Reserve untouched.

## Hard rules

- Never fake certainty.
- Never assume success without validation.
- Mark uncertainties explicitly with claim-status: VERIFIZIERT / PLAUSIBEL / UNSICHER / UNBEKANNT.
- A fix is NOT done if it's only at code-level. It's done when verified at runtime.
- A backend fix is NOT done if UI still shows the old behavior — that's exactly what happened with FIX 32 (Tag 22).
- A module is NOT integrated if it only has a snapshot endpoint but isn't called in the trade loop.
- A test that wasn't run cannot be cited as "passing".
- **Backend ≠ Frontend.** Both must be verified separately.

## Output Format

Whenever this skill is triggered, produce:

### Done Status
PASS / FAIL / PARTIAL

### Validation Summary
| #  | Rule                          | Status | Evidence |
|----|-------------------------------|--------|----------|
| 1  | Architecture consistency      | ✓/✗/? | ... |
| 2  | No hidden regressions         | ✓/✗/? | ... |
| 3  | UI / Frontend verification    | ✓/✗/? | Browser-test result, screenshot, JS-errors |
| 4  | Restart persistence           | ✓/✗/? | ... |
| 5  | Error handling                | ✓/✗/? | ... |
| 6  | Rollback safety               | ✓/✗/? | ... |
| 7  | Performance impact            | ✓/✗/? | ... |
| 8  | Edge cases                    | ✓/✗/? | ... |
| 9  | Logs                          | ✓/✗/? | ... |
| 10 | Build stability               | ✓/✗/? | ... |
| 11 | Deployment readiness          | ✓/✗/? | ... |

### Risks
- (concrete things that could break)

### Missing Validation
- (what was NOT verified — be explicit)

### Recommended Next Step
- (continue, fix gap, or stop)

## Special case: NEXUS V9 specific anti-patterns

These have ALL happened before. Block them explicitly:

- "Module installed via require() but not called in decide-loop" → NOT done.
- "Endpoint returns 200 with engine.* fields but UI still shows '—'" → NOT done. Browser-verify via Playwright.
- "FIX deployed in public/index.html" without Playwright Cmd+Shift+R test → NOT done.
- "Drift fixed via CORRECTION-Ledger-Entry" → NOT done, that's cosmetic. Root cause must be addressed or explicitly documented as legacy debt.
- "ml_synthetic_samples table populated" → NOT done unless MLOptimizer.train() actually consumes it AND class distribution proves it.
- "Win-Rate now shows 99.5% because GRID-Mikro-Fills" → NOT done. Aggregation must reflect actual closed trades.
- "FIX deployed" without Playwright/curl/SQL proof → NOT done.

## UI-Verification specific checklist

When Rule 3 (UI/Frontend) applies, ALL of these must pass:

  □ public/index.html mtime confirmed updated (or whatever file changed)
  □ Playwright headless test executed
  □ Cmd+Shift+R simulated (cache-bypass)
  □ Affected DOM elements queried, values match expectation
  □ Console-Errors = 0
  □ Network-Tab: relevant API-calls return expected payload
  □ All affected boxes/kachels/tabs rendered without "—" or "0.00" where data should be
  □ Mobile-viewport tested if UI is responsive
  □ Screenshot taken and stored as evidence

If any box shows "—" where backend has data: FAIL.

## Workflow

1. Run all 11 validations.
2. For Rule 3 (UI): run the UI-Verification checklist if change affects anything visible.
3. If ANY rule is FAIL or UNKNOWN → status = FAIL or PARTIAL, list missing validations explicitly.
4. If ALL PASS with hard evidence → status = PASS.
5. Output the table + risks + missing + next step.
6. Only AFTER this output may you write "✅ done" or equivalent.
