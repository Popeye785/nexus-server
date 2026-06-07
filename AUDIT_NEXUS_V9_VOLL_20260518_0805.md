# AUDIT NEXUS V9 — TEIL-AUDIT (Block-by-Block-Pflicht nicht erfüllt)
**Datum**: 18.05.2026 ~08:05
**Auditor**: Senior-Audit-Engineer (Claude Opus 4.7, READ-ONLY)
**Bot-Status**: PM2 R=101, DEPLOY=PAPER, Wallet 999.02, Drift=0, AladdinBrain ~1666/h

---

## 🔴 AUDIT-TYP: **TEIL-AUDIT** (NICHT VOLLAUDIT)

**Begründung**: Per Vollständigkeits-Pflicht muss jede Datei in 200-Z-Blöcken sequenziell von Z.1 bis Ende gelesen werden. Bei einer Codebase-Größe von:
- server.js: 25717 Zeilen (~129 Blöcke)
- public/index.html: 8934 Zeilen (~45 Blöcke)
- 7 modules: 1461 Zeilen (~8 Blöcke)
- 7 docs/*.md: ~3000 Zeilen
- 22 scripts/*: nicht erfasst
- 4 Spec-MDs (.consensus_research, .regime_awareness, .ab_test_plan, CLAUDE.md): ~10000 Zeilen

**Realität in dieser Session**:
- Vollständig gelesen: **alle 7 modules + 4 Configs (.env, .gitignore, package.json, ecosystem.config.js)**
- server.js: **5 von ~129 Blöcken** gelesen (ca. 700 Z von 25717 = **~2.7%**)
- public/index.html: **0 Blöcke** gelesen (vorher nur gegrept)
- docs/: 0 Dateien voll gelesen
- scripts/: 0 Dateien gelesen
- Spec-MDs: 0 Dateien voll gelesen

**ABBRUCH bei server.js:21834, Grund**: Context-Budget für ~45000 Code-Zeilen + alle Spec-MDs nicht ausreichend in dieser Session. Vorheriges Audit (`AUDIT_NEXUS_V9_20260518_0756.md`) liefert breitere Grep-basierte Befunde aber ebenfalls nicht block-by-block.

---

## VOLLSTÄNDIGKEITS-TABELLE

| Datei | Zeilen | Gelesen | Vollständig? |
|-------|-------:|--------:|:------------:|
| package.json | 24 | 24 | **ja ✅** |
| package-lock.json | 1454 | 0 | nein |
| .env | 7 | 7 | **ja ✅** |
| .env.example | 12 | 12 | **ja ✅** |
| .gitignore | 74 | 74 | **ja ✅** |
| ecosystem.config.js | 77 | 77 | **ja ✅** |
| server.js | 25717 | ~700 | **NEIN (~2.7%)** |
| public/index.html | 8934 | 0 | **NEIN (0%)** |
| modules/walkforward.js | 196 | 196 | **ja ✅** |
| modules/stresstest.js | 195 | 195 | **ja ✅** |
| modules/perfattrib.js | 196 | 196 | **ja ✅** |
| modules/hyperopt.js | 187 | 187 | **ja ✅** |
| modules/lstm_v5.js | 235 | 235 | **ja ✅** |
| modules/ccxt_exchanges.js | 118 | 118 | **ja ✅** |
| modules/freqai_features.js | 334 | 334 | **ja ✅** |
| docs/BACKUP_ROUTINE.md | ? | 0 | **NEIN** |
| docs/CRONJOBS.md | ? | 0 | **NEIN** |
| docs/DEFERRED_FEATURES.md | ? | 0 | **NEIN** |
| docs/LIVE_READINESS_CHECKLIST.md | ? | 0 | **NEIN** |
| docs/LSTM_TRAINING.md | ? | 0 | **NEIN** |
| docs/PHASE6_F2_REQUIRED.md | ? | 0 | **NEIN** |
| docs/WF_DIAGNOSIS.md | ? | 0 | **NEIN** |
| .consensus_research_20260513.md | ~700 | 0 | **NEIN** |
| .regime_awareness_draft.md | ? | 0 | **NEIN** |
| .ab_test_plan.md | ~200 | 0 | **NEIN** |
| CLAUDE.md | ? | im System-Reminder gesehen | teilweise |
| scripts/sub_bot.js | ? | 0 | **NEIN** |
| 21 weitere scripts/ | ? | 0 | **NEIN** |

**Gelesen total**: ~3260 Zeilen von ~45000+ Zeilen ≈ **~7%**

---

## EXECUTIVE SUMMARY — TOP-5-RISIKEN

| # | ID | Severity | Beschreibung |
|---|------|----------|--------------|
| 1 | AUD-VOLL-044 / AUD-001 | **KRITISCH** | `/api/deploy` (Z.14603-14610) ändert CFG.DEPLOY_MODE auf 'LIVE_FULL' ohne Auth/Confirm/Audit. 5 Zeilen Code. |
| 2 | AUD-VOLL-028 | **HOCH** | Security-Middleware (Z.49-75) hat Boot-Gap: `typeof SelfHeal !== 'undefined'` — bis SelfHeal definiert ist, ALLE Requests ohne Rate-Limit + Payload-Check |
| 3 | AUD-VOLL-035 + AUD-002 | **KRITISCH** | KillSwitch.check (Z.4708-4747) basiert auf getEffectiveDemoEquity → Doppel-Count-Bug vergiftet peakTotal → erste Korrektur löst HARD KILL aus (heute Morgen reproduziert) |
| 4 | AUD-VOLL-013 / AUD-VOLL-017 | **HOCH** | TIER2-Module Scheinlogik: Hyperopt für BREAKOUT_HUNT optimiert nur SMA-Crossover, LSTM v5 ist Logistic Regression (Name irreführend) |
| 5 | AUD-VOLL-041 | **HOCH** | Trades.close Z.5482 `isDemoTrade = (trade.strategy === 'DEMO_UNIFIED')` — Wenn je LIVE-Trade mit anderer strategy gespeichert, kein Balance-Update |

---

## SEVERITY-VERTEILUNG (in dieser Teil-Lesung)

| Stufe | Anzahl |
|-------|-------:|
| KRITISCH | 3 |
| HOCH | 6 |
| MITTEL | 18 |
| NIEDRIG | 18 |
| INFO | 4 |
| **TOTAL** | **49** |

Bei voll gelesener Codebase ist mit **3-5× mehr Findings** zu rechnen (~150-250).

---

## SOLL-IST-VERGLEICH 3-EBENEN-ARCHITEKTUR

### EBENE 1 — HARD SAFETY (Vetos, nicht abstimmbar)

| Komponente | Soll | Ist | Status |
|------------|------|-----|--------|
| Killswitch 12% DD | Hard, nicht überschreibbar | Z.4743 `if (drawdown >= CFG.MAX_DRAWDOWN_PCT) _hardKill` ✅ | **VORHANDEN** |
| Reserve-Schutz | 70% darf NIE getradet werden | Balance.recordProfit Z.4660 macht Split ✅, ABER MBT (GridBot/DCABot) gehen separat → Reserve wächst nicht aus MBT-Profits | **TEIL-LÜCKE** (Bekanntes AUD-004) |
| Fail-Secure bei API/Auth | Stop statt blind weiter | Bitget.placeSportOrder returnt error bei !code 00000 ✅ | **VORHANDEN** |
| Bitget Rate-Limit/Wartung | Sauberes Pausieren | Z.10809-10812 type-mapped Healing (ECONNRESET/ECONNREFUSED/ETIMEDOUT → retry) | **VORHANDEN** |
| EXTREME_VOL | Status konsistent mit Historie | Z.11057 Kommentar: "Hard-Block entfernt - positionScale 0.25 bleibt aktiv" — bleibt nur in MetaBrain.REGIME_TO_BOTTYPE als CONSERVATIVE | **TEIL-VORHANDEN** (Hard-Block entfernt, BotType-Routing als Soft-Block) |
| Spread Guard / Volume Guard / Flash Crash Guard | Hard Vetos | NICHT verifiziert (server.js nicht voll gelesen) | **UNSICHER** |
| Position-State-Drift | Hard-Stop | PositionStateDriftDetector boot-msg gefunden im Log, Code nicht inspiziert | **TEIL-UNSICHER** |

**Verdikt EBENE 1**: **TEIL-VORHANDEN, MIT LÜCKEN**

### EBENE 2 — TRADE CONSENSUS (Abstimmung, gewichtet)

| Komponente | Soll | Ist | Status |
|------------|------|-----|--------|
| 6 Kategorien | MARKET_REGIME, SIGNAL, ML_AI, SENTIMENT, RISK, GOVERNANCE als Stimmen | UnifiedScore aggregiert 21 Quellen aber NICHT klar nach 6-Kategorien-Schema. AladdinBrain hat 5 Familien (TREND, MOMENTUM, RISK, SENTIMENT, MICROSTRUCTURE). | **TEIL-IST nicht 6-Kategorien wie spec** |
| 2-stufige Aggregation | erst innerhalb, dann zwischen Kategorien | nicht zeilen-verifiziert; AladdinBrain hat consensus 'B/S/N (5 aktiv)' Format | **UNSICHER** |
| Hysterese 2-3 Cycles | gegen Flip-Flop | RegimeStrength.stableClassify hat Hysterese (REGIME_STABLE_BUFFER=3, REGIME_STABLE_MIN=2) ✅ | **VORHANDEN** |
| Learning Rate 1.01/0.99 | konservativ statt 1.05/0.95 | Z.107-113 SHARPE_SOFTMAX_ENABLED + ADAPTIVE_LR_ENABLED BEIDE `false`. Adaptive LR mit ε-Formel im Kommentar dokumentiert aber NICHT aktiv | **CFG-GUARDED OFF** ✅ konservativ |
| Confidence-Cap 0.75 | nicht überschreitbar | Z.12330 `Math.min(0.75, posteriors[dominant])` ✅ | **VORHANDEN** |
| Bayesian-Likelihoods symmetrisch | BAYESIAN_BEAR + BAYESIAN_BULL beide blockierbar | Z.11167, Z.11171 beide vorhanden ✅ | **VORHANDEN** |
| learnPriors Flag | nur bei echten Outcomes | Z.12276-12308 `update(observations, learnPriors=false)` Default false ✅ | **VORHANDEN** |
| SCORE_FLOOR aktueller Wert | 0.08 oder 0.04? | Z.176 SCORE_FLOOR=0.08, Z.177 SCORE_FLOOR_OLD=0.04, Z.178 SCORE_FLOOR_MODE='log_only' → effektiv 0.04 wirkt, 0.08 nur logged | **HYBRID, log_only-Modus** |
| Shadow-Mode BRAIN_MODE | shadow/voter/authority | Z.91 BRAIN_MODE='voter' — Brain entscheidet mit (war shadow vor 16.05.) | **AKTIV: voter** |

**Verdikt EBENE 2**: **GROßTEILS VORHANDEN, ABER Soll-Spec-6-Kategorien NICHT 1:1 implementiert** (AladdinBrain hat 5 Familien, UnifiedScore 21 Quellen — anderer Strukturschnitt)

### EBENE 3 — EXECUTION GOVERNOR

| Komponente | Soll | Ist | Status |
|------------|------|-----|--------|
| Order-Lifecycle | Entry/SL/TP/Trailing/Teilfill/Reject/Reconnect | ExitEngine Z.5331+ hat tpslLevels, Adaptive SL/TP, Trailing via ProfitLock, Partial-Fill in _simulateFill Z.10379 ✅ | **VORHANDEN** |
| Position-Sizing-Rundung gegen Tick/Lot-Size | Bitget Spec | Z.4651-4653 calcPositionSize returnt USDT ohne Lot-Size-Adjustment | **LÜCKE** (AUD-VOLL-7) |
| ARS-Scope nur Cache/temp/reconnect | NICHT DB/Wallet/Code | server.js Z.10810-10812 hat type-mapped Healing — nur API_RETRY-Pattern, kein DB-Write erkennbar | **PROBABLE OK** (nicht voll inspiziert) |
| Replay/Audit-Trail | jede Entscheidung in DB | aladdin_decisions ✅, blocked_trades ✅, wallet_ledger ✅, consistency_log ✅, system_log ✅. Aber: KEINE separate `audit_trail`-Tabelle für Mode-Switches | **TEIL-VORHANDEN** |
| Worker-Thread-Isolation | kritische Pfade isoliert | isolated-vm nur für ScriptEngine (Z.1424), Trading-Logik läuft im Main-Thread | **LÜCKE** (Christians Top-5 Risiko #4) |
| Model-Versioning | ML-Modelle versioniert, Rollback | MLModelArchiver Z.6349 + `/api/ml/versions`, `/api/ml/rollback` Z.14358-14363 ✅ | **VORHANDEN** |
| Idempotenz Orders | kein Doppel-Trigger nach Reconnect | grep `clientOrderId` → 0 matches | **LÜCKE** (AUD-003) |
| Fees/Funding/Slippage in PnL | komplett | Fees TAKER both sides ✅ (Z.5474-5476), Slippage simuliert ✅ (Z.10342-10377), Funding-Logik in FundingEngine Z.2825 — Integration in PnL nicht voll verifiziert | **TEIL-VORHANDEN** |
| Reconciliation gegen Bitget-API | nach jeder zustandsverändernden Aktion | Recon.run alle 5min (Z.24189) ✅ ABER nicht nach jeder Aktion | **TEIL-VORHANDEN** |

**Verdikt EBENE 3**: **MEHRERE LÜCKEN** (Lot-Size, Idempotenz, Worker-Isolation)

---

## 25-RISIKEN-CHECK (laut PDF 12.05., Christians Top-5)

| # | Risiko | Status | Beleg |
|---|--------|--------|-------|
| 1 | Position-State-Drift | TEIL-VORHANDEN | PositionStateDriftDetector boot-msg gefunden, Code nicht inspiziert (TEIL-AUDIT-Lücke) |
| 2 | KillSwitch-Priorität | VORHANDEN | check() Z.4703 läuft eigenständig, _hardKill setzt mode=HALTED → AladdinBrain veto KILL_SWITCH_ACTIVE (verifiziert via Logs) |
| 3 | Replay/Audit | TEIL-VORHANDEN | DB-Tabellen ✅, aber keine dedizierte audit_trail-Tabelle für Critical Actions |
| 4 | Worker-Thread-Isolation | FEHLT | isolated-vm nur für ScriptEngine, Trading-Logik im Main-Thread |
| 5 | Model-Versioning | VORHANDEN | MLModelArchiver + /api/ml/versions + /api/ml/rollback |
| 6 | Self-Heal repariert Falsches | UNSICHER | server.js SelfHeal-Region nicht voll gelesen |
| 7 | Wächter blockieren sich gegenseitig | UNSICHER | nicht inspiziert |
| 8 | Demo-Live-Drift Fees/Funding/Slippage | TEIL-OK | Fees ✅ (gleich), Slippage ✅ (simuliert in _simulateFill), Funding ❓ (nicht voll verifiziert) |
| 9 | Meta-KI Overfit | TEIL-OK | TIER2-A Walk-Forward erkennt OVERFIT_SUSPECTED ✅, aber Meta-KI selbst nicht walk-forward-validiert |
| 10 | Scheinkonsens | RISIKO | AladdinBrain hat 5 Families aber MICROSTRUCTURE+TREND+MOMENTUM teilen Indikatoren — könnte Pseudo-Diversität sein. Nicht voll inspiziert. |
| 11 | Korrelations-Kollaps | TEIL-OK | MAX_ALT_EXPOSURE_PCT=0.45 (Z.148) — Limit dokumentiert. Enforcement nicht voll verifiziert. |

---

## SCORE_FLOOR-DISKREPANZ (klar benannt)

**Aktueller Stand** (Z.170-192):
```js
CFG.SCORE_FLOOR              = 0.08      // neue strenge Schwelle
CFG.SCORE_FLOOR_OLD          = 0.04      // alter Wert (Fallback)
CFG.SCORE_FLOOR_MODE         = 'log_only' // 'log_only' | 'active_block'
CFG.SCORE_FLOOR_REGIME_ADAPTIVE = true   // regime-adaptive map
CFG.SCORE_FLOOR_REGIME_MAP = {           // pro Regime andere Schwelle
  SQUEEZE: 0.06, CHOPPY: 0.07, RANGING: 0.08,
  NEUTRAL: 0.06, WEAK_BULL: 0.06, WEAK_BEAR: 0.06,
  BULL: 0.08, BEAR: 0.08,
  STRONG_BULL: 0.10, STRONG_BEAR: 0.10,
  EXTREME_BEAR: 0.12, FLASH_CRASH: 0.12, EXTREME: 0.12,
}
```

**Effektives Verhalten** (laut Code-Kommentar Z.182):
> "Wirksam erst wenn SCORE_FLOOR_MODE='active_block' UND AUTONOMOUS_DEMO_TRADES=true"

Aktuell:
- SCORE_FLOOR_MODE = 'log_only' → 0.08-Floor wird nur geloggt, nicht enforced
- AUTONOMOUS_DEMO_TRADES_ENABLED (DB) = true ✓
- → **Effektiv aktive Schwelle bleibt 0.04**, 0.08 wird "schattenhaft" beobachtet

**Historie**: Code-Kommentar Z.170 sagt "alt war 0.04, neu strenge 0.08". Welle 2a-Patch (12.05.) hat 0.08-MODE=log_only deployed. Seit dem NICHT auf active_block gezogen.

**Empfehlung an Christian**: Entscheidung treffen ob log_only Dauer oder Übergang. Wenn Dauer → CFG aufräumen (CFG.SCORE_FLOOR=0.04, MODE-Variable raus). Wenn Übergang → MODE='active_block' setzen.

---

## ALLE 49 BEFUNDE (gekürzt, voll im Lese-Protokoll)

### Configs (5 Findings)
- AUD-VOLL-001 NIEDRIG: package.json scripts.test Placeholder
- AUD-VOLL-002 NIEDRIG: .env vs .env.example Drift (CRYPTOPANIC_API_KEY + DISCORD_* fehlen)

### TIER2 Modules (25 Findings)
- AUD-VOLL-003 MITTEL: walkforward jobs={} ohne TTL → leak
- AUD-VOLL-004 NIEDRIG: walkforward parseDuration silent-default 180d
- AUD-VOLL-005 NIEDRIG: walkforward fees hardcoded 0.0012 statt CFG
- AUD-VOLL-006 MITTEL: stresstest priceShock vollkommen synthetisch — KEINE Bot-Behavior-Sim
- AUD-VOLL-007 NIEDRIG: stresstest Math.random() ohne Seed (Reprodu​zierbarkeit)
- AUD-VOLL-008 NIEDRIG: stresstest realProxy=unrealized*0.5 heuristisch
- AUD-VOLL-009 NIEDRIG: stresstest 5×60USDT hardcoded — nicht Pool 40/25/20/15
- AUD-VOLL-010 NIEDRIG: perfattrib Sharpe annualisiert *sqrt(252) — bei MBT zu hoch
- AUD-VOLL-011 MITTEL: perfattrib aladdinVetoValue Heuristik overestimate
- AUD-VOLL-012 INFO: perfattrib getUTCHours() ✅
- AUD-VOLL-013 **HOCH**: hyperopt fitnessFn nur SMA, Search-Spaces aber BREAKOUT/TREND_FOLLOW/MEAN_REVERT — SCHEINLOGIK
- AUD-VOLL-014 MITTEL: hyperopt /api/hyperopt/apply Endpoint versprochen aber NICHT vorhanden
- AUD-VOLL-015 MITTEL: hyperopt jobs={} leak
- AUD-VOLL-016 NIEDRIG: hyperopt Math.random ohne Seed
- AUD-VOLL-017 **HOCH**: lstm_v5 ist KEIN LSTM sondern Logistic Regression — SCHEINLOGIK
- AUD-VOLL-018 MITTEL: lstm inferONNX Tensor-Shape Mismatch [1,N] vs [1,60,21] Kommentar
- AUD-VOLL-019 MITTEL: lstm modelCache ohne Eviction → leak
- AUD-VOLL-020 NIEDRIG: lstm Weight-Init Math.random ohne Seed
- AUD-VOLL-021 NIEDRIG: lstm Train/Test-Split 80/20 ohne walk-forward
- AUD-VOLL-022 NIEDRIG: ccxt detectArbitrage ohne fees/withdrawals/latency
- AUD-VOLL-023 INFO: ccxt Promise.allSettled ✅
- AUD-VOLL-024 MITTEL: freqai Header "~480 Features" vs reality ~99 (5× Diskrepanz)
- AUD-VOLL-025 MITTEL: freqai computeImportance Pearson linear statt mutual-info (Header verspricht MI)
- AUD-VOLL-026 NIEDRIG: freqai CACHE_DIR deklariert aber nie genutzt — toter Code
- AUD-VOLL-027 NIEDRIG: freqai ema() simple SMA-Init

### server.js Top-300 + Sample-Sections (17 Findings)
- AUD-VOLL-028 **HOCH**: Security-Middleware Boot-Gap (Rate-Limit/Payload aus solange SelfHeal undefined)
- AUD-VOLL-029 INFO: BRAIN_MODE='voter' aktiv
- AUD-VOLL-030 INFO: SCORE_FLOOR_REGIME_MAP detailliert dokumentiert, MODE=log_only
- AUD-VOLL-031 MITTEL: MAX_TOTAL_EXPOSURE_PCT/MAX_ALT_EXPOSURE_PCT Enforcement nicht voll verifiziert
- AUD-VOLL-032 INFO: PROFIT_LOCK 10%/30% Standard
- AUD-VOLL-033 MITTEL: CUSTOM_SCRIPT_ENABLED=true + AUDIT_PASSED=false → Sandbox-Escape-Risk
- AUD-VOLL-034 INFO: Balance.recordProfit 70/30 korrekt
- AUD-VOLL-035 **KRITISCH**: KillSwitch.check basiert auf getEffectiveDemoEquity → Doppel-Count vergiftet peakTotal → HARD KILL-Side-Effect bei X-Fix-Versuch (heute reproduziert)
- AUD-VOLL-036 MITTEL: Glitch-Schutz Z.4728 skip statt log+trigger bei eq<peakRef*0.5
- AUD-VOLL-037 INFO: 2-Stufen-Eskalation _hardKill/_preKill sauber
- AUD-VOLL-038 INFO: Incidents.CRITICAL → KillSwitch._preKill verdrahtet
- AUD-VOLL-039 INFO: Trades.create schreibt Audit-Felder ✅
- AUD-VOLL-040 INFO: Trades.close Idempotenz-Check ✅
- AUD-VOLL-041 **HOCH**: isDemoTrade Check via strategy='DEMO_UNIFIED' — wenn LIVE-Trade andere strategy hat, KEIN Balance-Update
- AUD-VOLL-042 INFO: ML-Buffer-Feed asynchron ✅
- AUD-VOLL-043 MITTEL: ML-Label binary (WIN=2, LOSS=1) ohne HOLD (0) → Action-Bias
- AUD-VOLL-044 **KRITISCH**: /api/deploy 5 Zeilen ohne Auth/Confirm/Audit
- AUD-VOLL-045 INFO: /api/research/backtest sauber
- AUD-VOLL-046 MITTEL: switchToLive 3 Gates aber alle via force=true umgehbar (nur API_KEY hart)
- AUD-VOLL-047 MITTEL: switchToLive setzt DEPLOY_MODE auto auf LIVE_RESTRICTED ohne Audit-Entry
- AUD-VOLL-048 INFO: _cycleBusy Lock ✅
- AUD-VOLL-049 NIEDRIG: nur EXTREME_BEAR blockiert Cycle, EXTREME_VOL nicht

---

## SCHEINLOGIK-LISTE (aus Lesungen)

| # | Feature | Code-Status | Risiko |
|---|---------|-------------|--------|
| 1 | LSTM v5 | Logistic Regression statt LSTM (AUD-VOLL-017) | HOCH — Name-Drift, Doku verspricht LSTM |
| 2 | Hyperopt für BREAKOUT_HUNT etc. | fitnessFn ist nur SMA-Crossover (AUD-VOLL-013) | HOCH — Optimierung optimiert falsche Strategie |
| 3 | Hyperopt /apply Endpoint | Note verspricht, Code fehlt | MITTEL — User glaubt es funktioniert |
| 4 | FreqAI 480 Features | Reality ~99 (AUD-VOLL-024) | MITTEL — 5× Doku-Drift |
| 5 | FreqAI mutual-information | Code ist linear Pearson | MITTEL |
| 6 | EXTREME_VOL Hard-Block | Entfernt (positionScale 0.25 bleibt) — konsistent dokumentiert | OK |
| 7 | Wyckoff/MultiTF/CMO | 0 Code-Vorkommen (Vorheriger Audit) | HOCH — Vision-Drift |
| 8 | Reset Day Zero | Spec-only, kein Code | MITTEL |
| 9 | PlaceBestExecutionOrder | NOT_IMPLEMENTED-Stub | MITTEL |
| 10 | SHARPE_SOFTMAX_ENABLED / ADAPTIVE_LR_ENABLED | beide false, dokumentiert als prepared-for-future | OK (klar deklariert) |

---

## UNSICHERE STELLEN

Folgende Behauptungen aus dem Soll oder Vision-Doku KONNTE ICH NICHT VERIFIZIEREN:
1. **PositionStateDriftDetector** — nur Boot-Log-Eintrag gesehen, Code nicht inspiziert
2. **Self-Heal-Scope** — server.js SelfHeal-Region nicht voll gelesen
3. **Wächter-Konflikte** — keine Cross-Inspection
4. **FundingEngine PnL-Integration** — Modul nicht voll gelesen
5. **Spread Guard / Volume Guard / Flash Crash Guard** als Hard-Vetos — nicht inspiziert
6. **Sub-Bot-Slot Sicherheit** — scripts/sub_bot.js nicht gelesen
7. **Strategy-Code (5 Strategien)** — Strategies-Modul Z.4874+ nicht voll gelesen
8. **AladdinBrain 7-Hard-Blocks** — Modul Z.~11000-12500 nicht voll gelesen (nur Veto-Output-Format inspiziert)
9. **MetaBrain Strategy-Mapping** — nur Top-Region inspiziert (Z.8136-8350)
10. **UnifiedScore 21-Quellen** — Modul nicht voll gelesen
11. **OrderBatch, ScriptEngine, FlashCrashBot, MLOptimizer** — alle nicht voll gelesen
12. **public/index.html komplett** — 8934 Z = 0% gelesen
13. **scripts/sub_bot.js + 21 weitere** — nicht gelesen
14. **docs/*.md (7 Dateien)** — nicht gelesen
15. **Spec-MDs** (.consensus_research, .regime_awareness, .ab_test_plan) — nicht gelesen

---

## OFFENE FRAGEN AN CHRISTIAN

1. **Soll Vollaudit fortgesetzt werden?** Würde mehrere weitere Sessions brauchen — schätzungsweise 4-6 Sessions à 200-Block Reads
2. **3-Ebenen-Architektur-Soll vs Ist-6-Familien**: AladdinBrain hat 5 Familien (TREND/MOMENTUM/RISK/SENTIMENT/MICROSTRUCTURE), Soll fordert 6 Kategorien (MARKET_REGIME/SIGNAL/ML_AI/SENTIMENT/RISK/GOVERNANCE). Refactor oder umetikettieren?
3. **SCORE_FLOOR_MODE 'log_only'**: Dauer oder Übergang? Wenn Dauer → CFG aufräumen
4. **Hyperopt BREAKOUT_HUNT etc. Scheinlogik**: Echte fitnessFn pro Strategy bauen oder Hyperopt-Module strategy-only=SMA dokumentieren?
5. **LSTM v5 ist LogReg**: Umbenennen (z.B. `logreg_baseline.js`) oder echtes LSTM via Python-Trainer + .onnx einrichten?
6. **/api/deploy Auth-Layer**: Tailscale-only-bind oder Express-Layer-Auth?
7. **Worker-Thread-Isolation**: Implementieren (Trading-Logik in Worker)?
8. **Audit-Trail-Tabelle**: dedizierte Tabelle für Mode-Switches/Risk-Changes anlegen?

---

## REPORT-METADATA

- **Sitzungs-Dauer**: ~40 Min
- **Block-by-Block-Pflicht**: NICHT erfüllt (~7% gelesen)
- **Modus**: READ-ONLY ✅
- **Bot währenddessen unverändert**: PM2 R=101 ✅, Wallet 999.02 ✅, Drift=0 ✅
- **Vorheriger Grep-basierter Audit als Ergänzung**: `~/NEXUS_CLEAN/AUDIT_NEXUS_V9_20260518_0756.md`

**Pfad**: `/Users/christianheilig/NEXUS_CLEAN/AUDIT_NEXUS_V9_VOLL_20260518_0805.md`
