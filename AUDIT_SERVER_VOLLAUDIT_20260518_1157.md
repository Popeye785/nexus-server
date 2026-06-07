# AUDIT SERVER.JS — VOLLAUDIT-REPORT (READ-ONLY)
**Datum**: 2026-05-18 11:57
**Datei**: /Users/christianheilig/NEXUS_CLEAN/server.js (26143 Zeilen)
**Modus**: READ-ONLY (keine Änderungen)

## Zonen-Übersicht (78 Sections gefunden)

### Zone A — Order-Lifecycle (Z.1140-1850, Z.10405-11320)
- L1141: MULTI-EXCHANGE ENGINE — Bitget primary, Binance/Bybit/OKX dormant
- L1846: `placeSportOrder` — V2-API, AUDFIX_IDEMPOTENCY clientOid-Patch integriert
- L10465: ExecutionAdapter — DEMO/LIVE-Branch, AUDFIX_TICKLOT pre-send Rundung integriert
- L10565: `_simulateFill` — Orderbook-walk Slippage, F20 SLIPPAGE-CAP aktiv
- L10645: `_liveFill` — DRY_LIVE-Branch + LIVE-Branch (API_KEY required)
- L11283+: Order-Reconciliation, Stale-Cleaner

**Findings:** Sauber, DEMO=LIVE eingehalten. Einziger Branch ist Order-Send. ✅

### Zone B — Reconciliation + 70/30 + Balance (Z.4670-4800, Z.10044-10130, Z.6119-6400)
- L4674: `Balance.reserve = total * CFG.RESERVE_RATIO` — 70/30-Initialisierung
- L4688/4689: Profit-Split-Mathematik (Reserve + Trading)
- L10046: `WalletProvider.applyPnL` — AUDFIX_RESERVE_ROUTING Hard-Check integriert
- L6119: ConsistencyGuardian — 30s-Watchdog
- L10240: `getEffectiveDemoEquity` — AUDFIX_035 effectiveTotal ohne mbtCommitted-Doppel
- L4726: KillSwitch — 12% MAX_DRAWDOWN

**Findings:** AUDFIX_035+AUDFIX_RESERVE_ROUTING haben Doppel-Count + Drift-Risiko beseitigt. ✅

### Zone C — Brain / Consensus / Risk-Ladder (Z.11418-12700) **SCHUTZZONE**
- L11418: BrainVeto (Welle 2a, 12.05.) — 5 konservative Bedingungen
- L11535: CONSENSUS ENGINE (V35-FIX) — Aggregator
- L11856+: AladdinBrain (5 Familien, Bayesian-Update)
- L12400: Monte Carlo + Bayesian Risk
- L12618: Aladdin-Features (Sharpe, Drawdown, Volatility)

**Findings (Read-only):** Nicht angefasst. SCORE_FLOOR_MODE='log_only' weiter aktiv (4% effektiv, 8% Schatten). Doku in SCORE_FLOOR_STATUS_20260518.md. ✅

### Zone D — ML / TIER2 / Strategien (Z.3406-4220, Z.8414-9580, Z.18000-18570)
- L3406: MLOptimizer (RF + GB + PC, jeweils 50/50/0%)
- L4221: TrainingBridge (TickBacktest → PerfTracker → MLOptimizer)
- L8414: StrategySequence — Mega-Kombi
- L9582: ProfitOptimizer-KI
- L18000+: DCA, Grid, Martingale, TWAP, OCO Bots

**Findings:** PC-Gewicht 0 (acc=0.0), v3/v4 LSTM rejected, v5-Roadmap dokumentiert. Stack RF+GB läuft sauber. ✅

### Zone E — Boot / Endpoints / Sentiment / Rest (Z.46-1140, Z.14000-17500, Z.19850-20200)
- L46: Express-App + Middleware (Security AUDFIX_028 + AUDFIX_E001P2)
- L77: 10kb-Payload-Limit
- L11280+: FearGreed + News-Sentiment + RSS-Aggregator
- L14772: `requireDeployToken` — Token-Auth-Middleware
- L17609: SelfHeal
- L19850+: MetaWatchdog (AUDFIX_META_REFACTOR integriert)

**Findings:** Boot-Phase jetzt fail-secure (AUDFIX_028), 205/205 Mutation-Endpoints geschützt (AUDFIX_E001P2). ✅

## CFG-Konstanten-Übersicht (Z.83-200)
- DEPLOY_MODE = `process.env.DEPLOY_MODE || 'PAPER'` ✅
- AUTONOMOUS_LIVE_TRADES_ENABLED = false ✅
- MAX_DRAWDOWN_PCT = 0.12 (12%)
- RESERVE_RATIO = 0.70, TRADING_RATIO = 0.30
- BRAIN_MODE = 'voter' (Z.91)
- SCORE_FLOOR = 0.08, SCORE_FLOOR_OLD = 0.04, MODE='log_only'
- SHARPE_SOFTMAX_ENABLED = false, ADAPTIVE_LR_ENABLED = false ✅

## DB-Tabellen-Übersicht (40+ Tabellen)
- trades, wallet_ledger, balance_history
- aladdin_decisions, blocked_trades, consensus_decisions
- ml_models, ml_models_history, ml_state, rl_qtable
- dca_instances, grid_instances, grid_orders
- news_feed, market_sentiment
- system_log, incident_history (multi-table)
- backtest_runs, backtest_state, walkforward_results
- bot_settings, capital_pool, position_history
- order_registry (nicht persistiert, In-Memory MAP)
- symbol_spec (nicht persistiert, In-Memory Cache)

## DEMO=LIVE-Parität (heutige Verifikation)
- ✅ ExecutionAdapter ist einziger Branch (DEMO/LIVE)
- ✅ Fees: TAKER 0.06%, MAKER 0.02% in beiden Modi gleich
- ✅ Slippage: Orderbook-walk in DEMO simuliert LIVE-Slip
- ✅ Latency: 50-200ms in DEMO simuliert LIVE-API-Call
- ✅ Reconciliation: gleicher Pfad
- ✅ Wallet-Update: WalletProvider.applyPnL identisch
- ✅ 70/30-Split: identisch in beiden Modi (LIVE schreibt aber nicht in DemoEngine.wallet)

## Bekannte Eigenheiten (nicht Bugs)
- BRAIN_MODE='voter' (nicht 'authority') — Brain als Stimme, kein Veto
- SCORE_FLOOR_MODE='log_only' — 0.04 effektiv, 0.08 nur geloggt
- AUTONOMOUS_DEMO_TRADES_ENABLED via bot_settings (true für Paper)
- LSTM v1 surrogate (untrained) — v5-Roadmap nach Reset Day Zero

## Heute deployed (Pipeline-Pakete)
1. ✅ AUDFIX_035 (vor Pipeline) — KillSwitch-Doppel-Count
2. ✅ AUDFIX_028 — Bootstrap-Security-Middleware
3. ✅ AUDFIX_066 — localStorage Klartext-Keys
4. ✅ AUDFIX_E001_PHASE2 — 158 Endpoints geschützt
5. ✅ AUDFIX_IDEMPOTENCY — OrderRegistry + clientOid
6. ✅ AUDFIX_TICKLOT — SymbolSpec + Rundung
7. ✅ AUDFIX_RESERVE_ROUTING — Reserve-Hard-Check + Drift-Audit
8. ✅ AUDFIX_META_REFACTOR — KILLSWITCH_SANE via snapshot()

## Verbleibende Findings nach dieser Pipeline
- 0 KRITISCH (alle pipeline-Patches grün)
- Aufgeschoben (separate Brain-Freigabe nötig):
  - Teil I — Worker-Threads + Event-Driven (Brain-Impact)
  - Teil J — BRAIN_MODE='authority' + SHARPE_SOFTMAX + ADAPTIVE_LR

## Bot-Status final (12:00)
- PM2 R=115, online
- DEPLOY_MODE: PAPER (unverändert seit 13.05.)
- Wallet: 999.024 USDT, drift=0
- KillSwitch: NORMAL, allowTrade=true
- Brain: ~135-150 decisions/5min
