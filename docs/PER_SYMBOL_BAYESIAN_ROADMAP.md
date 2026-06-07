# Per-Symbol Bayesian — Implementation-Roadmap

**Status:** SKELETON (Block R A2, 27.05.2026)
**Aktivierung:** Block S nach Christian-OK

## Motivation

Aktuell ist `RiskEngine.bayesian.priors` GLOBAL — d.h. für alle 12 Symbole gilt derselbe Posterior (z.B. bull=0.26 / bear=0.44 / sideways=0.31, Stand Block M Abschnitt 3).

Strategy-Router braucht aber symbol-spezifisches Wissen:
- NEAR könnte aktuell BULL-Posterior 0.65 haben
- BTC dagegen BEAR-Posterior 0.55
- Globaler Mix verwässert diese Information

## Phasen

### Phase 1 — SKELETON (Block R A2 — **DONE**)
- ✅ `modules/bayesian_per_symbol.js` mit Klassen-Skeleton
- ✅ DB-Migration-Script (`scripts/migrate_bayesian_per_symbol.sql`)
- ✅ KEINE Brain-Integration (Brain läuft weiter global)
- ✅ Tests stehen

### Phase 2 — DB-Aktivierung (Block S, Christian-OK)
- Migration ausführen: `sqlite3 nexus.db < scripts/migrate_bayesian_per_symbol.sql`
- `_PerSymBay.loadAll(DB.db)` im Boot-Hook
- Trade-Close-Hook erweitern (zusätzlich zu globalem Bayesian-Feedback)
- Toggle `CFG.BAYESIAN_PER_SYMBOL_ENABLED = false` initial

### Phase 3 — Brain-Integration (Block S+1)
- In `AladdinBrain._aggregate` oder UnifiedScore.compute:
  - `getPosterior(symbol, globalPrior)` statt `globalPrior`
  - Bei `source='global'` (Cold-Start): unverändertes Verhalten
  - Bei `source='symbol'` (n≥30): symbol-spezifischer Posterior
- Test-First: bull-Symbol mit BUY-Signal-Bias bekommt höheren BUY-Score

### Phase 4 — Beobachtung + Konvergenz
- 1 Woche live-Monitoring
- Konvergenz pro Symbol: stabilisieren sich Posteriors?
- Verbesserung der per-Symbol-WR messen
- Bei Symptom-Regression: Rollback via Toggle

## Trigger für Aktivierung

| Bedingung | Status |
|---|---|
| Skeleton + Migration sauber | ✅ Block R A2 |
| Globaler Bayesian zeigt Lernfortschritt | ✅ bull→0.26, bear→0.44 (Block M) |
| 1 Woche Beobachtung globaler Posteriors | ⏳ 27.05.→03.06. |
| Mindest-Sample pro Symbol erreichbar | ⏳ aktuell nur 6 trades CLOSED |
| Christian-OK für Phase 2 | ⏳ wartet |

## Risiken + Mitigations

| Risiko | Mitigation |
|---|---|
| Cold-Start: pro Symbol braucht ~30 Observations | Fallback auf globalen Posterior bei n<30 (`MIN_OBS_FOR_SYMBOL`) |
| Falsche Konvergenz bei wenig Trades | Decay-Factor 0.95 verhindert Verkrampfung an alte Obs |
| Brain-Verhalten überraschend variabel | Toggle `BAYESIAN_PER_SYMBOL_ENABLED` für schnellen Rollback |
| DB-Write-Latency im hot-path | Async-Persist möglich (Phase 2 entscheidet) |
| Inkonsistenz globaler vs symbol-Posterior | Beide laufen parallel — Brain priorisiert symbol wenn verfügbar |

## Code-Pfade die in Phase 3 berührt werden

| Datei | Stelle | Was |
|---|---|---|
| `server.js` | UnifiedScore.compute (~12101) | Bayesian-Aufruf um symbol-context erweitern |
| `server.js` | Trade-close-hook (~5664) | Per-Symbol-Update zusätzlich zu globalem Update |
| `server.js` | Boot-Sequenz | `_PerSymBay.loadAll(DB.db)` |
| `modules/bayesian_per_symbol.js` | (bereits da) | aktiviert |

## Was passiert NICHT in Block R

- ❌ Brain liest aktuelle Posteriors (das ist Phase 3)
- ❌ DB-Migration läuft (das ist Phase 2)
- ❌ Trade-Close-Hook erweitert (das ist Phase 2)
- ❌ Module-Boot-Auto-Load (das ist Phase 2)

Module liegt einsatzbereit, wartet auf Phase-2-Approval.

## Reaktivierungs-Trigger falls nach Phase 2 schief

Falls Aktivierung Probleme zeigt:
1. Toggle false → globaler Bayesian wieder aktiv
2. Skeleton-Modul bleibt erhalten (keine Code-Löschung)
3. DB-Tabelle bleibt (Daten gehen nicht verloren)
4. Bei kompletter Rückkehr: `DROP TABLE bayesian_symbol_posteriors`

## Verantwortlich

- Christian: Entscheidung über Phase 2 + Phase 3
- Claude Code: Implementation, Tests, Beobachtung
