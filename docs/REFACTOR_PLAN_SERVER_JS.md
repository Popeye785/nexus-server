# Refactor-Plan server.js (Block C, 1.3)

**Erstellt:** 2026-05-26
**Aktuelle Größe:** ~29 100 Zeilen
**Ziel:** Modul-Trennung, kein Verhaltens-Change

## Status Quo

`server.js` ist ein god-file mit allen Modulen (Bitget, Trades, DemoEngine, AladdinBrain, etc.) plus Express-Endpoints. Code-Audit-Tools flaggen es konstant als "Large File" / "Architecture-Issue".

## Refactor-Strategie: SCHRITTWEISE Module-Extraction

### Phase A — niedrig-Risiko Module-Files (1-2 Tage)

#### A1: `modules/wallet_provider.js`
- Extract: `WalletProvider`, `getEffectiveDemoEquity`, `computeUnrealizedPnLMBT`, `_computeDrawdown` (Z. ~5800-5900 + ~10395-10645)
- Schon Helper-Module-Pattern existiert. Wenig Side-Effects.
- ~250 Zeilen aus server.js
- Test: WalletProvider.applyPnL noch korrekt, ledger entries kommen

#### A2: `modules/wallet_reconciler.js`
- Extract: `WalletReconciler` + dependencies (Z. ~18980-19050)
- ~70 Zeilen
- Test: /api/recon/check unverändert

#### A3: `modules/killswitch.js`
- Extract: `KillSwitch` + `_computeDrawdown` (Z. ~4730-4940)
- ~210 Zeilen
- Test: /api/killswitch/status, PRE-KILL warnings unverändert

### Phase B — mittel-Risiko Engines (2-3 Tage)

#### B1: `modules/aladdin_brain.js`
- Extract: `AladdinBrain` (Z. ~27300-28400)
- ~1100 Zeilen — größtes Modul
- Test: Brain-Decisions identisch, ML-Augmentation arbeitet

#### B2: `modules/risk_sizing.js`
- Extract: `RiskSizing` mit allen Mults (Z. ~5944-6210)
- ~270 Zeilen
- Test: stackedMult-Calc unverändert

### Phase C — hoch-Risiko Engines (3-5 Tage)

#### C1: `modules/demo_engine.js`
- Extract: `DemoEngine` (Z. ~25380-25800)
- ~430 Zeilen
- Test: Trade-Decision-Pfad, Reset, persistence

#### C2: `modules/grid_bot_mbt.js` + `dca_bot_mbt.js`
- Extract: `GridBotMBT`, `InfinityGridBotMBT`, `DCABotMBT` (Z. ~8800-9500)
- ~700 Zeilen kombiniert
- Test: GRID/INFGRID/DCA fill-cycle + 70/30 splits

### Phase D — Endpoints separation (1-2 Tage)

#### D1: `routes/api_wallet.js`
- `/api/recon/*`, `/api/demo/*`, `/api/balance`, etc.

#### D2: `routes/api_quant.js`
- `/api/kelly/*`, `/api/sortino/*`, `/api/hrp/*`, `/api/triple-barrier/*`, `/api/walk-forward/*`, `/api/meta-label/*`, `/api/black-swan/*`

#### D3: `routes/api_admin.js`
- `/api/deploy`, `/api/scripts/*`, `/api/killswitch/*`

## Total Aufwand

- **Phase A:** 1-2 Tage (low-risk, klare Boundaries)
- **Phase B:** 2-3 Tage (medium, AladdinBrain has many deps)
- **Phase C:** 3-5 Tage (high, DemoEngine touches everything)
- **Phase D:** 1-2 Tage (mechanical, routes auslagern)

**Sum: 7-12 Tage Engineering** — das ist Wochen-Arbeit wie spec'd.

## Risk Mitigation

- Jede Phase Pull-Request mit Diff
- Pre/Post smoke-test (alle endpoints 200)
- Bot bleibt PAPER während Refactor
- Plan-Mode für jeden größeren Schritt
- Backup pro Phase: ENTIRE git tree

## Acceptance Criteria pro Modul

1. server.js reduziert sich um die extrahierten Zeilen
2. require('./modules/X.js') am file-top
3. Alle bestehenden Endpoints liefern unveränderten Output (HTTP-Code + JSON-Schema)
4. DB-Schema unverändert (kein Migration nötig)
5. Tests: smoke-test + LIVE-Ready 4/4 audit unverändert

## Empfehlung

**Heute KEIN refactor** (out-of-scope für Block C). Plan dient als Roadmap nach LIVE-Switch oder als separater "Refactor-Sprint".

LIVE-Switch ist priorisiert (30-Tage-Window läuft) — refactor-Sprint kann post-LIVE laufen ohne Service-Unterbrechung.

## Status

🟡 **PLAN ERSTELLT — KEIN CODE-CHANGE** (per Direktive "KEIN Code-Refactor heute — nur Plan")
