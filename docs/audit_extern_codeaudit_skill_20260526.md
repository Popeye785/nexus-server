# Code Audit Report

> Automated analysis of **531** files | **63.527** lines of code | **121** findings | 10.5s

## Table of Contents

- [Project Overview](#project-overview)
- [Summary](#summary)
- [Tools Used](#tools-used)
- [Secrets & Credentials](#secrets-credentials)
- [Security](#security)
- [Dependencies](#dependencies)
- [Code Structure](#code-structure)
- [Testing](#testing)
- [Import Graph & Coupling](#import-graph-coupling)
- [AI-Generated Code Patterns](#ai-generated-code-patterns)
- [What This Audit Doesn't Cover](#what-this-audit-doesnt-cover)

## Project Overview

| Metric | Value |
|--------|-------|
| Primary Language | Markdown |
| Frameworks | Express |
| Package Manager | npm |
| Lockfile Present | Yes |
| Total Files Scanned | 531 |
| Code Files | 92 |
| Total Lines of Code | 63.527 |
| Avg File Size | 691 lines |
| Test Frameworks | Playwright |

### Language Breakdown

| Language | Files |
|----------|-------|
| Markdown | 140 |
| JavaScript | 81 |
| JSON | 34 |
| Shell | 20 |
| Python | 11 |
| HTML | 3 |
| SQL | 1 |

### Largest Files

| File | Lines |
|------|-------|
| `server.js` | 29301 |
| `backups/full_safety_20260513_125221/server.js` | 18307 |
| `public/translations.js` | 531 |
| `modules/hmm_regime.js` | 438 |
| `modules/eviction_engine.js` | 402 |

## Summary

**Total findings: 121**

| Severity | Count |
|----------|-------|
| 🔴 Critical | 1 |
| 🟠 High | 13 |
| 🟡 Medium | 44 |
| 🔵 Low | 63 |

### Findings by Category

| Category | Critical | High | Medium | Low | Info |
|----------|----------|------|--------|-----|------|
| Secrets & Credentials | 1 | - | - | - | - |
| Security | - | 11 | 10 | - | - |
| Dependencies | - | 1 | 3 | 1 | - |
| AI-Generated Code | - | 1 | 26 | - | - |
| Code Structure | - | - | 3 | 62 | - |
| Testing | - | - | 2 | - | - |

## Tools Used

### External Tools

| Tool | Version | Findings | Time |
|------|---------|----------|------|
| npm audit | 10.8.2 | 4 | 1.1s |
| Madge | 8.0.0 | 0 | 1.5s |

**Tool issues:** ESLint (no-output)

All analyzers also run built-in regex/heuristic analysis as a baseline. When external tools are available, their findings take priority and regex duplicates are removed.

### Install for Better Results

The following tools would enhance this audit:

| Tool | Enhances | Install | Benefit |
|------|----------|---------|--------|
| Semgrep | secrets, security | `brew install semgrep  OR  pip install semgrep` | Deep semantic analysis with 2000+ security rules. Finds issues regex cannot. |
| TruffleHog | secrets | `brew install trufflehog  OR  pip install trufflehog` | High-accuracy secret detection with verification. Checks if secrets are actually active. |
| Gitleaks | secrets | `brew install gitleaks` | Fast secret scanning with 150+ built-in rules. Catches common credential patterns. |
| Trivy | dependencies | `brew install trivy` | Comprehensive vulnerability scanner for dependencies, containers, and IaC. Covers all ecosystems. |
| OSV-Scanner | dependencies | `go install github.com/google/osv-scanner/cmd/osv-scanner@latest` | Google-backed vulnerability database. Cross-ecosystem coverage using OSV.dev. |

## Secrets & Credentials

Scan for hardcoded secrets, API keys, tokens, and credentials. Any finding here should be treated as urgent — rotate exposed credentials immediately.

#### 1. .env file in repository: .env

**Severity:** 🔴 Critical

A .env file is present in the repository. This file typically contains secrets and should be in .gitignore.

**File:** `.env`

**Remediation:** Add .env to .gitignore, remove the file from git history using `git filter-branch` or BFG Repo Cleaner, and rotate all secrets.

## Security

Detection of security anti-patterns including injection risks, XSS vectors, weak cryptography, and misconfigured security controls.

#### 1. eval() usage in backups/full_safety_20260513_125221/server.js

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `backups/full_safety_20260513_125221/server.js` (line 812)

```
const forbidden = ['require(', 'process.', 'fs.', '__dirname', 'eval(', 'Function(', 'child_process', 'exec(', 'spawn(', 'import('];
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 2. new Function() constructor in backups/full_safety_20260513_125221/server.js

**Severity:** 🟠 High

new Function() is similar to eval() — it compiles and executes arbitrary code.

**File:** `backups/full_safety_20260513_125221/server.js` (line 871)

```
const fn = new Function(
```

**Remediation:** Refactor to avoid dynamic code generation. Use configuration objects or strategy patterns.

---

#### 3. eval() usage in scripts/train_lstm.py

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `scripts/train_lstm.py` (line 152)

```
model.eval()
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 4. eval() usage in scripts/train_lstm.py

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `scripts/train_lstm.py` (line 186)

```
model.eval()
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 5. eval() usage in scripts/train_lstm.py

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `scripts/train_lstm.py` (line 215)

```
model.cpu().eval()
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 6. eval() usage in scripts/train_lstm_v4.py

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `scripts/train_lstm_v4.py` (line 238)

```
model.eval()
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 7. eval() usage in scripts/train_lstm_v4.py

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `scripts/train_lstm_v4.py` (line 273)

```
model.eval()
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 8. eval() usage in scripts/train_lstm_v4.py

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `scripts/train_lstm_v4.py` (line 318)

```
model.cpu().eval()
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 9. eval() usage in server.js

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `server.js` (line 1555)

```
const forbidden = ['require(', 'process.', 'fs.', '__dirname', 'eval(', 'Function(', 'child_process', 'exec(', 'spawn(', 'import('];
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 10. new Function() constructor in server.js

**Severity:** 🟠 High

new Function() is similar to eval() — it compiles and executes arbitrary code.

**File:** `server.js` (line 1614)

```
const fn = new Function(
```

**Remediation:** Refactor to avoid dynamic code generation. Use configuration objects or strategy patterns.

---

#### 11. eval() usage in server.js

**Severity:** 🟠 High

Use of eval() can execute arbitrary code. This is a common injection vector.

**File:** `server.js` (line 7781)

```
{ id: 8, name: 'eval-process',           code: 'eval("process.exit()")', expectKindAny: ['REFERENCE_ERROR','EVAL_ERROR'] },
```

**Remediation:** Replace eval() with a safer alternative. Parse JSON with JSON.parse(), use AST-based approaches for code generation.

---

#### 12. Prototype pollution risk in backups/full_safety_20260513_125221/server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `backups/full_safety_20260513_125221/server.js` (line 4823)

```
this._cache = Object.assign({}, result, { cached: true });
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 13. Prototype pollution risk in backups/full_safety_20260513_125221/server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `backups/full_safety_20260513_125221/server.js` (line 6290)

```
this.pending[cl.id] = Object.assign({}, cl, { detectedAt: Date.now() });
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 14. Prototype pollution risk in backups/full_safety_20260513_125221/server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `backups/full_safety_20260513_125221/server.js` (line 6298)

```
this.history.unshift(Object.assign({}, this.pending[id], { result:'EXPIRED', ts:now }));
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 15. Prototype pollution risk in backups/full_safety_20260513_125221/server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `backups/full_safety_20260513_125221/server.js` (line 6314)

```
this.history.unshift(Object.assign({}, cl, { result:'APPROVED', deleted: res.changes, ts: Date.now() }));
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 16. Prototype pollution risk in backups/full_safety_20260513_125221/server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `backups/full_safety_20260513_125221/server.js` (line 6328)

```
this.history.unshift(Object.assign({}, cl, { result:'REJECTED', ts: Date.now() }));
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 17. Prototype pollution risk in server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `server.js` (line 5918)

```
this._cache = Object.assign({}, result, { cached: true });
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 18. Prototype pollution risk in server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `server.js` (line 11464)

```
this.pending[cl.id] = Object.assign({}, cl, { detectedAt: Date.now() });
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 19. Prototype pollution risk in server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `server.js` (line 11472)

```
this.history.unshift(Object.assign({}, this.pending[id], { result:'EXPIRED', ts:now }));
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 20. Prototype pollution risk in server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `server.js` (line 11488)

```
this.history.unshift(Object.assign({}, cl, { result:'APPROVED', deleted: res.changes, ts: Date.now() }));
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

---

#### 21. Prototype pollution risk in server.js

**Severity:** 🟡 Medium

Potential prototype pollution vector. Merging untrusted objects can modify Object.prototype.

**File:** `server.js` (line 11502)

```
this.history.unshift(Object.assign({}, cl, { result:'REJECTED', ts: Date.now() }));
```

**Remediation:** Validate and sanitize object keys. Use Object.create(null) for dictionaries.

## Dependencies

Evaluation of dependency health, including version pinning, known vulnerabilities, lockfile presence, and problematic packages.

#### 1. Vulnerable dependency: axios (high)

**Severity:** 🟠 High

Known vulnerability in axios.

**Remediation:** Run `npm audit fix` or update axios to a patched version.

---

#### 2. Vulnerable dependency: follow-redirects (moderate)

**Severity:** 🟡 Medium

Known vulnerability in follow-redirects.

**Remediation:** Run `npm audit fix` or update follow-redirects to a patched version.

---

#### 3. Vulnerable dependency: qs (moderate)

**Severity:** 🟡 Medium

Known vulnerability in qs.

**Remediation:** Run `npm audit fix` or update qs to a patched version.

---

#### 4. Vulnerable dependency: ws (moderate)

**Severity:** 🟡 Medium

Known vulnerability in ws.

**Remediation:** Run `npm audit fix` or update ws to a patched version.

---

#### 5. No engines field in package.json

**Severity:** 🔵 Low

The package.json does not specify required Node.js version. Different Node versions may behave differently.

**File:** `package.json`

**Remediation:** Add an "engines" field: `"engines": { "node": ">=18" }`

## Code Structure

Analysis of file sizes, nesting depth, import counts, and function length. Identifies complexity hotspots that increase maintenance cost.

#### 1. God file: backups/full_safety_20260513_125221/server.js (18307 lines)

**Severity:** 🟡 Medium

This file has 18307 lines, well above the 500-line threshold. Large files are harder to test, review, and maintain. Consider splitting into focused modules.

**File:** `backups/full_safety_20260513_125221/server.js`

**Remediation:** Break this file into smaller, focused modules with single responsibilities.

---

#### 2. God file: public/translations.js (531 lines)

**Severity:** 🟡 Medium

This file has 531 lines, well above the 500-line threshold. Large files are harder to test, review, and maintain. Consider splitting into focused modules.

**File:** `public/translations.js`

**Remediation:** Break this file into smaller, focused modules with single responsibilities.

---

#### 3. God file: server.js (29301 lines)

**Severity:** 🟡 Medium

This file has 29301 lines, well above the 500-line threshold. Large files are harder to test, review, and maintain. Consider splitting into focused modules.

**File:** `server.js`

**Remediation:** Break this file into smaller, focused modules with single responsibilities.

---

#### 4. Deep nesting in .phase3_brain_veto_sim.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `.phase3_brain_veto_sim.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 5. Deep nesting in backups/full_safety_20260513_125221/server.js (18 levels)

**Severity:** 🔵 Low

Code is nested 18 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `backups/full_safety_20260513_125221/server.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 6. High import count in backups/full_safety_20260513_125221/server.js (28 imports)

**Severity:** 🔵 Low

This file imports from 28 different modules, suggesting it may have too many responsibilities.

**File:** `backups/full_safety_20260513_125221/server.js`

**Remediation:** Consider if this file is doing too much. Split into smaller modules with fewer dependencies.

---

#### 7. Long function in backups/full_safety_20260513_125221/server.js (~284 lines at line 167)

**Severity:** 🔵 Low

A function starting at line 167 spans approximately 284 lines. Long functions are harder to understand and test.

**File:** `backups/full_safety_20260513_125221/server.js` (line 167)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 8. Long function in backups/full_safety_20260513_125221/server.js (~256 lines at line 16991)

**Severity:** 🔵 Low

A function starting at line 16991 spans approximately 256 lines. Long functions are harder to understand and test.

**File:** `backups/full_safety_20260513_125221/server.js` (line 16991)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 9. Large file: modules/backtest_engine.js (362 lines)

**Severity:** 🔵 Low

This file has 362 lines. Not critical, but worth watching as it grows.

**File:** `modules/backtest_engine.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 10. Deep nesting in modules/backtest_engine.js (6 levels)

**Severity:** 🔵 Low

Code is nested 6 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/backtest_engine.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 11. Long function in modules/backtest_engine.js (~166 lines at line 157)

**Severity:** 🔵 Low

A function starting at line 157 spans approximately 166 lines. Long functions are harder to understand and test.

**File:** `modules/backtest_engine.js` (line 157)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 12. Deep nesting in modules/blackswan_replay.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/blackswan_replay.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 13. Deep nesting in modules/brain_input_shadow.js (7 levels)

**Severity:** 🔵 Low

Code is nested 7 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/brain_input_shadow.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 14. Deep nesting in modules/crash_recovery_handler.js (8 levels)

**Severity:** 🔵 Low

Code is nested 8 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/crash_recovery_handler.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 15. Deep nesting in modules/datasource_etf_flows.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/datasource_etf_flows.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 16. Deep nesting in modules/datasource_funding_oi.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/datasource_funding_oi.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 17. Deep nesting in modules/datasource_liquidations.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/datasource_liquidations.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 18. Deep nesting in modules/datasource_macro.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/datasource_macro.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 19. Deep nesting in modules/datasource_macro_calendar.js (8 levels)

**Severity:** 🔵 Low

Code is nested 8 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/datasource_macro_calendar.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 20. Deep nesting in modules/datasource_onchain.js (8 levels)

**Severity:** 🔵 Low

Code is nested 8 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/datasource_onchain.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 21. Deep nesting in modules/decision_outcome_tracker.js (6 levels)

**Severity:** 🔵 Low

Code is nested 6 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/decision_outcome_tracker.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 22. Large file: modules/eviction_engine.js (402 lines)

**Severity:** 🔵 Low

This file has 402 lines. Not critical, but worth watching as it grows.

**File:** `modules/eviction_engine.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 23. Deep nesting in modules/eviction_engine.js (9 levels)

**Severity:** 🔵 Low

Code is nested 9 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/eviction_engine.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 24. Deep nesting in modules/family_weights_adaptive.js (10 levels)

**Severity:** 🔵 Low

Code is nested 10 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/family_weights_adaptive.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 25. Large file: modules/feature_engineering.js (313 lines)

**Severity:** 🔵 Low

This file has 313 lines. Not critical, but worth watching as it grows.

**File:** `modules/feature_engineering.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 26. Long function in modules/feature_engineering.js (~123 lines at line 142)

**Severity:** 🔵 Low

A function starting at line 142 spans approximately 123 lines. Long functions are harder to understand and test.

**File:** `modules/feature_engineering.js` (line 142)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 27. Large file: modules/freqai_features.js (334 lines)

**Severity:** 🔵 Low

This file has 334 lines. Not critical, but worth watching as it grows.

**File:** `modules/freqai_features.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 28. Large file: modules/hmm_regime.js (438 lines)

**Severity:** 🔵 Low

This file has 438 lines. Not critical, but worth watching as it grows.

**File:** `modules/hmm_regime.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 29. Deep nesting in modules/hmm_regime.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/hmm_regime.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 30. Large file: modules/hrp.js (327 lines)

**Severity:** 🔵 Low

This file has 327 lines. Not critical, but worth watching as it grows.

**File:** `modules/hrp.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 31. Deep nesting in modules/hrp.js (7 levels)

**Severity:** 🔵 Low

Code is nested 7 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/hrp.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 32. Large file: modules/hrp_allocator.js (305 lines)

**Severity:** 🔵 Low

This file has 305 lines. Not critical, but worth watching as it grows.

**File:** `modules/hrp_allocator.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 33. Deep nesting in modules/hrp_allocator.js (7 levels)

**Severity:** 🔵 Low

Code is nested 7 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/hrp_allocator.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 34. Large file: modules/incident_waechter.js (338 lines)

**Severity:** 🔵 Low

This file has 338 lines. Not critical, but worth watching as it grows.

**File:** `modules/incident_waechter.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 35. Deep nesting in modules/incident_waechter.js (6 levels)

**Severity:** 🔵 Low

Code is nested 6 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/incident_waechter.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 36. Large file: modules/lstm_engine.js (332 lines)

**Severity:** 🔵 Low

This file has 332 lines. Not critical, but worth watching as it grows.

**File:** `modules/lstm_engine.js`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 37. Deep nesting in modules/mbt_profit_realizer.js (6 levels)

**Severity:** 🔵 Low

Code is nested 6 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/mbt_profit_realizer.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 38. Deep nesting in modules/meta_labeling.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/meta_labeling.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 39. Deep nesting in modules/multi_exchange_router.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/multi_exchange_router.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 40. Deep nesting in modules/news_intelligence.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/news_intelligence.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 41. Deep nesting in modules/opportunity_scanner.js (13 levels)

**Severity:** 🔵 Low

Code is nested 13 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/opportunity_scanner.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 42. Deep nesting in modules/orderbook_snapshots.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/orderbook_snapshots.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 43. Deep nesting in modules/perfattrib.js (11 levels)

**Severity:** 🔵 Low

Code is nested 11 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/perfattrib.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 44. Deep nesting in modules/regime_orchestrator.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/regime_orchestrator.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 45. Deep nesting in modules/shadow_inference.js (7 levels)

**Severity:** 🔵 Low

Code is nested 7 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/shadow_inference.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 46. Deep nesting in modules/slot_strength_ranker.js (8 levels)

**Severity:** 🔵 Low

Code is nested 8 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/slot_strength_ranker.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 47. Deep nesting in modules/sortino_router.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/sortino_router.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 48. Deep nesting in modules/squeeze_watcher.js (8 levels)

**Severity:** 🔵 Low

Code is nested 8 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/squeeze_watcher.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 49. Long function in modules/stresstest.js (~127 lines at line 13)

**Severity:** 🔵 Low

A function starting at line 13 spans approximately 127 lines. Long functions are harder to understand and test.

**File:** `modules/stresstest.js` (line 13)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 50. Deep nesting in modules/symbol_brain_performance.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/symbol_brain_performance.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 51. Deep nesting in modules/tft_forecaster.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/tft_forecaster.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 52. Deep nesting in modules/walk_forward.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `modules/walk_forward.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 53. Long function in modules/walkforward.js (~91 lines at line 79)

**Severity:** 🔵 Low

A function starting at line 79 spans approximately 91 lines. Long functions are harder to understand and test.

**File:** `modules/walkforward.js` (line 79)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 54. Deep nesting in scripts/backtest_multibottype_6years.py (6 levels)

**Severity:** 🔵 Low

Code is nested 6 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `scripts/backtest_multibottype_6years.py`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 55. Large file: scripts/backtest_vision_full.py (319 lines)

**Severity:** 🔵 Low

This file has 319 lines. Not critical, but worth watching as it grows.

**File:** `scripts/backtest_vision_full.py`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 56. Deep nesting in scripts/backtest_vision_full.py (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `scripts/backtest_vision_full.py`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 57. Deep nesting in scripts/dca_stranded_cleanup.js (5 levels)

**Severity:** 🔵 Low

Code is nested 5 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `scripts/dca_stranded_cleanup.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 58. Deep nesting in scripts/train_lstm.py (7 levels)

**Severity:** 🔵 Low

Code is nested 7 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `scripts/train_lstm.py`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 59. Large file: scripts/train_lstm_v4.py (372 lines)

**Severity:** 🔵 Low

This file has 372 lines. Not critical, but worth watching as it grows.

**File:** `scripts/train_lstm_v4.py`

**Remediation:** Consider splitting if this file continues to grow.

---

#### 60. Deep nesting in scripts/train_lstm_v4.py (7 levels)

**Severity:** 🔵 Low

Code is nested 7 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `scripts/train_lstm_v4.py`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 61. Deep nesting in scripts/verify_all_endpoints.py (10 levels)

**Severity:** 🔵 Low

Code is nested 10 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `scripts/verify_all_endpoints.py`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 62. Deep nesting in server.js (18 levels)

**Severity:** 🔵 Low

Code is nested 18 levels deep. Deep nesting reduces readability. Consider early returns, guard clauses, or extracting functions.

**File:** `server.js`

**Remediation:** Use early returns, guard clauses, or extract nested logic into helper functions.

---

#### 63. High import count in server.js (44 imports)

**Severity:** 🔵 Low

This file imports from 44 different modules, suggesting it may have too many responsibilities.

**File:** `server.js`

**Remediation:** Consider if this file is doing too much. Split into smaller modules with fewer dependencies.

---

#### 64. Long function in server.js (~710 lines at line 433)

**Severity:** 🔵 Low

A function starting at line 433 spans approximately 710 lines. Long functions are harder to understand and test.

**File:** `server.js` (line 433)

**Remediation:** Extract sub-operations into well-named helper functions.

---

#### 65. Long function in server.js (~278 lines at line 27272)

**Severity:** 🔵 Low

A function starting at line 27272 spans approximately 278 lines. Long functions are harder to understand and test.

**File:** `server.js` (line 27272)

**Remediation:** Extract sub-operations into well-named helper functions.

## Testing

Assessment of test coverage, framework configuration, assertion quality, and CI integration.

#### 1. Low test ratio (17.9%)

**Severity:** 🟡 Medium

Only 14 test files for 78 source files (17.9% ratio). Aim for at least one test file per module.

**Remediation:** Prioritize tests for business-critical code paths and complex logic.

---

#### 2. No CI/CD configuration found

**Severity:** 🟡 Medium

Tests exist but no CI/CD pipeline was detected. Tests should run automatically.

**Remediation:** Set up GitHub Actions, GitLab CI, or another CI service to run tests on push.

### Test Coverage Summary

| Metric | Value |
|--------|-------|
| Source Files | 78 |
| Test Files | 14 |
| Test Ratio | 17.9% |
| Frameworks | Playwright |

## Import Graph & Coupling

Analysis of the dependency graph between source files. Identifies circular imports, hub files, and coupling hotspots.

> No issues found. ✅

### Dependency Graph Summary

| Metric | Value |
|--------|-------|
| Files Analyzed | 92 |
| Total Import Edges | 49 |
| Avg Imports/File | 0.5 |
| Circular Dependencies | 0 |

## AI-Generated Code Patterns

Detection of patterns commonly associated with AI-generated code, including tool fingerprints, silent error handling, and structural inconsistencies.

#### 1. 987 silent catch blocks across the codebase

**Severity:** 🟠 High

Found 987 empty catch blocks total. This level of silent error handling suggests large portions of the codebase were AI-generated without proper review.

**Remediation:** Conduct a systematic review of all error handling. Add at minimum error logging to every catch block.

---

#### 2. 7 silent catch blocks in .c1.1_sim_test.js

**Severity:** 🟡 Medium

This file has 7 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `.c1.1_sim_test.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 3. 243 silent catch blocks in backups/full_safety_20260513_125221/server.js

**Severity:** 🟡 Medium

This file has 243 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `backups/full_safety_20260513_125221/server.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 4. 3 silent catch blocks in modules/brain_input_shadow.js

**Severity:** 🟡 Medium

This file has 3 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/brain_input_shadow.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 5. 19 silent catch blocks in modules/crash_recovery_handler.js

**Severity:** 🟡 Medium

This file has 19 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/crash_recovery_handler.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 6. 6 silent catch blocks in modules/datasource_liquidations.js

**Severity:** 🟡 Medium

This file has 6 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/datasource_liquidations.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 7. 6 silent catch blocks in modules/datasource_macro.js

**Severity:** 🟡 Medium

This file has 6 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/datasource_macro.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 8. 4 silent catch blocks in modules/datasource_macro_calendar.js

**Severity:** 🟡 Medium

This file has 4 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/datasource_macro_calendar.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 9. 10 silent catch blocks in modules/datasource_onchain.js

**Severity:** 🟡 Medium

This file has 10 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/datasource_onchain.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 10. 6 silent catch blocks in modules/decision_outcome_tracker.js

**Severity:** 🟡 Medium

This file has 6 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/decision_outcome_tracker.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 11. 16 silent catch blocks in modules/eviction_engine.js

**Severity:** 🟡 Medium

This file has 16 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/eviction_engine.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 12. 3 silent catch blocks in modules/hmm_regime.js

**Severity:** 🟡 Medium

This file has 3 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/hmm_regime.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 13. 4 silent catch blocks in modules/hrp_allocator.js

**Severity:** 🟡 Medium

This file has 4 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/hrp_allocator.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 14. 5 silent catch blocks in modules/incident_waechter.js

**Severity:** 🟡 Medium

This file has 5 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/incident_waechter.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 15. 5 silent catch blocks in modules/live_wallet.js

**Severity:** 🟡 Medium

This file has 5 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/live_wallet.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 16. 12 silent catch blocks in modules/mbt_profit_realizer.js

**Severity:** 🟡 Medium

This file has 12 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/mbt_profit_realizer.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 17. 3 silent catch blocks in modules/multi_exchange_router.js

**Severity:** 🟡 Medium

This file has 3 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/multi_exchange_router.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 18. 5 silent catch blocks in modules/opportunity_scanner.js

**Severity:** 🟡 Medium

This file has 5 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/opportunity_scanner.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 19. 4 silent catch blocks in modules/orderbook_snapshots.js

**Severity:** 🟡 Medium

This file has 4 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/orderbook_snapshots.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 20. 9 silent catch blocks in modules/regime_orchestrator.js

**Severity:** 🟡 Medium

This file has 9 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/regime_orchestrator.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 21. 3 silent catch blocks in modules/shadow_inference.js

**Severity:** 🟡 Medium

This file has 3 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/shadow_inference.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 22. 6 silent catch blocks in modules/slot_strength_ranker.js

**Severity:** 🟡 Medium

This file has 6 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/slot_strength_ranker.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 23. 6 silent catch blocks in modules/sortino_router.js

**Severity:** 🟡 Medium

This file has 6 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/sortino_router.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 24. 7 silent catch blocks in modules/squeeze_watcher.js

**Severity:** 🟡 Medium

This file has 7 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/squeeze_watcher.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 25. 6 silent catch blocks in modules/symbol_brain_performance.js

**Severity:** 🟡 Medium

This file has 6 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `modules/symbol_brain_performance.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 26. 5 silent catch blocks in public/translations.js

**Severity:** 🟡 Medium

This file has 5 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `public/translations.js`

**Remediation:** Add error logging or proper error handling to each catch block.

---

#### 27. 576 silent catch blocks in server.js

**Severity:** 🟡 Medium

This file has 576 empty catch blocks that silently swallow errors. This is a common AI-generated code pattern that makes debugging very difficult.

**File:** `server.js`

**Remediation:** Add error logging or proper error handling to each catch block.

## What This Audit Doesn't Cover

Automated analysis catches patterns and known anti-patterns. The following areas require human judgment — understanding your business, your team, and your trajectory.

### Architecture Fitness

Whether your architecture fits your growth trajectory requires business context that no automated tool can assess. Questions like "should we break this monolith into services?" or "will this database choice scale to 10x users?" depend on your roadmap, team size, and funding stage.

**What a senior engineer would evaluate:**
- Alignment between technical architecture and business goals
- Scaling bottlenecks relative to your growth projections
- Build vs. buy decisions for your specific context
- Technical debt prioritization based on your roadmap

### Business-Context Prioritization

This audit assigns severity by *technical risk*. But technical risk and *business risk* aren't the same thing. A "medium" security finding in your payment flow is more urgent than a "high" complexity issue in an internal tool. Prioritization requires understanding what matters most to *your* business right now.

### Remediation Cost Estimates

Converting findings into engineering-weeks requires understanding your team's velocity, familiarity with the codebase, and current sprint commitments. A finding that takes a senior engineer 2 hours might take a junior engineer 2 days. Accurate estimates need context about *your* team.

### Executive Summary

Translating technical findings into language for founders, investors, or non-technical stakeholders requires understanding both the technology and the business conversation. What does this audit mean for your next fundraise? Your hiring plan? Your launch timeline?

---

**Need the full picture?** [Variant Systems](https://variantsystems.io/get-audit) provides comprehensive code audits that combine automated analysis with senior engineering judgment. We've reviewed codebases for startups from pre-seed to Series B — and we'll tell you honestly what needs fixing now, what can wait, and what's actually fine.

---

*Generated on 2026-05-26 by [code-audit](https://github.com/variant-systems/skills) — an open-source automated code audit tool by [Variant Systems](https://variantsystems.io).*

*This report covers automated analysis only. For architecture review, business-context prioritization, and remediation planning, [get a full audit](https://variantsystems.io/get-audit).*
