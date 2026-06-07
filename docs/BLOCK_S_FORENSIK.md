# Block S Abschnitt 1 — Symbol-Listen-Forensik
**27.05.2026 14:30 CEST · Bot R=309 · PAPER · Daten verifiziert via grep + sqlite + curl**

## 8 Symbol-Listen identifiziert

| # | Liste | Datei:Zeile | Größe | Primär für | Status |
|---|---|---|---|---|---|
| 1 | **CoinScanner.WATCHLIST** | server.js:27130 | 20 coins (BTC ETH SOL XRP BNB ADA AVAX DOGE POL LINK DOT LTC UNI ATOM NEAR ARB OP SUI APT SEI) | scoreCoin + activeCoins-Ranking | 🔴 SEI/POL/DOT/LTC/UNI/ARB/OP/APT NICHT in SymbolUniverse |
| 2 | CFG.AUTO_SYMBOLS (fallback) | server.js:5869+ | 12 coins (passt SymbolUniverse) | DemoEngine fallback wenn CoinScanner leer | 🟢 konsistent |
| 3 | ShadowCycle.symbols | server.js:29093 | 12 coins (identisch SymbolUniverse) | ShadowCycle._tick alle 8s | 🟢 konsistent |
| 4 | CFG.DEFAULT_SYMBOLS | server.js:376 | 4 coins (BTC ETH SOL XRP) | Bitget.connectWS | 🟡 Subset, OK |
| 5 | `_altsHC` Set | server.js:25984 | 12 coins (inkl. SEI) | Alt-Exposure-Cap MAX_ALT_EXPOSURE_PCT 0.45 | 🟡 enthält SEI/UNI/ARB/OP/APT |
| 6 | `L1_GROUP` Set | server.js:13004 | 9 coins (SOL AVAX NEAR ADA DOT ATOM APT SUI SEI) | Layer-1-correlation-Cluster | 🟡 enthält SEI/DOT/ATOM/APT |
| 7 | DemoEngine.symbols | server.js:25351 | dynamisch CoinScanner.activeCoins.slice(0,10) | _cycle Brain.decide-Loop | 🔴 Quelle = CoinScanner = enthält SEI |
| 8 | AutoEngine.symbols | server.js:27223 | dynamisch = CoinScanner top-3 | _decideBot (Regime-Bot-Mgmt) | 🔴 enthält SEI wenn ranked top-3 |

## SEI-Forensik

- ❌ NICHT in SymbolUniverse.TRADING_SYMBOLS
- ✅ IST in CoinScanner.WATCHLIST (Z.27134)
- ✅ IST in `_altsHC` Z.25984
- ✅ IST in `L1_GROUP` Z.13004
- **979 aladdin_decisions total** (764 BUY / 109 HOLD / 106 SELL)
- **5 SEI-decisions in den letzten 10 Minuten** (alle BUY, conf ~0.09, score ~0.155)
- **0 Trades** (Pre-Trade-Gates blocken erfolgreich — Floor/CUSUM/_altsHC/etc.)
- SEI taucht in last-1h-Brain-Loop auf weil CoinScanner es in top-N selektiert hat

**Verdict:** SEI ist "phantom decision-only" — Brain bewertet, aber kein Trade. Trotzdem **falsch** weil UI/History es als BUY zeigt → User-Verwirrung + Compute-Verschwendung.

## SUI-Pair-Guard-Forensik

- NEAR-Decisions last 1h: **28** (mit conf≥0.05) → Pair-Guard würde SUI **erlauben** (n≥3)
- SUI-Decisions last 1h: **29** (alle SELL)
- 0 aktive Trades (also SUI-only nicht über Trade-Layer relevant)
- 0 `[PAIR_VETO]` in pm2 logs (last 200 lines)

**Verdict:** Pair-Guard greift NUR in `effectiveFloor()` (für Trade-Routing, Block Q A3). Greift NICHT in Brain.decide oder in finalDecision-Datenstruktur. Brain "denkt" über SUI nach unabhängig vom Pair-Kontext.

## allowed_strategies-Status

- 10 Treffer in `modules/symbol_universe.js` (Definition only)
- **0 Treffer in server.js** (keine Konsumenten!)
- → **Block-R-Lücke #4 bestätigt:** `getAllowedStrategies(symbol)` ist deklariert aber nirgendwo erzwungen.

## Datenfluss-Diagramm

```
┌────────────────────────────────────────────────────────────┐
│ CoinScanner.WATCHLIST (20 coins, inkl. SEI/POL/DOT/etc)    │
│   ↓ jede 5min: scoreCoin per WATCHLIST                     │
│   ↓ rankings.top(maxActive=3)                              │
│   ↓                                                         │
│ CoinScanner.activeCoins = top-N                            │
│   ↓ sync                                                    │
│ AutoEngine.symbols ← activeCoins                           │
│ DemoEngine.symbols ← activeCoins.slice(0, 10)              │
└────────────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│ DemoEngine._cycle() — every CFG.SCAN_INTERVAL_MS           │
│   for symbol in DemoEngine.symbols:                        │
│     - UnifiedScore.compute(symbol, candles, ob)            │
│     - AladdinBrain.decide(symbol, ...) ← schreibt aladdin  │
│         ❌ KEIN getAllowedStrategies-check                 │
│         ❌ KEIN pair-guard check                           │
│         ❌ KEIN tradable-check (SymbolUniverse.isKnown)    │
│     - HardStops/CUSUM/Floor/_altsHC → blocken Trade        │
│     - _executeTrade only if all gates passed               │
└────────────────────────────────────────────────────────────┘
            │
            ▼ (parallel)
┌────────────────────────────────────────────────────────────┐
│ ShadowCycle._tick() — every 8s (Z.29111)                   │
│   for symbol in ShadowCycle.symbols (12 SymbolUniverse-OK):│
│     - Brain.decide → aladdin_decisions + shadow_inputs     │
│     - Read-only, kein Trade-Effect                         │
└────────────────────────────────────────────────────────────┘
```

## Block-S-Patch-Strategie (für Abschnitte 2-6)

| Abschnitt | Was patchen | Wo | Wie |
|---|---|---|---|
| 2 | SymbolUniverse als Source | server.js:25380 + 25770 + 25813 + 29139 | `getFloor`/`getCoinConfig` Hooks |
| 3 | allowed_strategies enforce | NEW: `modules/strategy_veto.js` + Hook im Trade-Routing | Pre-Trade veto |
| 4 | SUI-Pair in finalDecision | `WhitelistPairGuard.checkFinalDecision()` + Hook in Brain output | Nicht nur effectiveFloor |
| 5 | SEI klären | CoinScanner.WATCHLIST → SymbolUniverse.TRADING_SYMBOLS-konsistent + ANALYSIS_SYMBOLS-Liste | Source-Migration |
| 6 | rawSignal vs finalDecision | aladdin_decisions-Schema erweitern + API-Layer | DB-Spalten + JSON-Output |

## Code-Stellen für Block-S-Abschnitte

| Operation | Stelle |
|---|---|
| Brain.decide call (DemoEngine) | server.js:25380 |
| Brain.decide call (Rotation) | server.js:25770 |
| Brain.decide call (PairCandidate) | server.js:25813 |
| Brain.decide call (ShadowCycle) | server.js:29139 |
| Brain.decide call (MetaBrain wrapper) | server.js:25557 |
| _executeTrade entry | server.js:25939 |
| Strategy-Selection (Bot-Typen) | DCABot/GridBot/ComboBot (Z.~13900+) |
| CoinScanner.WATCHLIST | server.js:27130 |
| _altsHC | server.js:25984 |
| L1_GROUP | server.js:13004 |
| `aladdin_decisions` schema | server.js:598 |
| insertAladdin prepared statement | server.js:1061 |

## DoD 11/11 — Abschnitt 1 Forensik

| # | Rule | Status |
|---|---|---|
| 1 | Backup vor | ✅ BLOCKS_PRE_20260527_142411 (1.9G tar + 1.1G db + 1.4M srv) |
| 2 | Syntax-Check | ⏸️ N/A (read-only Forensik) |
| 3 | UI-Verify | ⏸️ N/A |
| 4 | Tests vorhanden | ⏸️ N/A (Forensik) |
| 5 | Tests grün | ⏸️ N/A |
| 6 | Live-Verify | ✅ DB-Queries + curl + pm2 logs |
| 7 | Anti-Monster | ✅ 0 Code-Änderungen |
| 8 | Code-Reviewed | ✅ 8 Listen + 5 Brain-Call-Sites + 3 SEI-Vorkommen identifiziert |
| 9 | Doku | ✅ Dieses Dokument |
| 10 | Rollback | ⏸️ N/A (Forensik) |
| 11 | No-Regression | ✅ Bot R=309 stabil während Forensik |
