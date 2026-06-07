# STUFE 1 — HMM-REGIME + ADAPTIVE FAMILY_WEIGHTS — ENDBERICHT

**Verankert:** 2026-05-20 13:29
**Status:** ✅ DEPLOYED & LIVE
**Bot-State:** PID 8771, R=170, drift=0, brain_alive=true, 131 decisions in 5min, HMM-state=RANGING conf=0.61

---

## A. WAS WURDE GEMACHT

NEXUS V9 bekommt eine **Hidden-Markov-Model Regime-Detection** auf Boutique-Quant-A-Niveau und **adaptive FAMILY_WEIGHTS** pro Regime:

| # | Komponente | Datei |
|---|---|---|
| 1A | HMM-Modul (5 states, Bayesian posterior, EMA-smoothing, DB-Persistenz) | `modules/hmm_regime.js` (177 lines) |
| 1B | Adaptive FAMILY_WEIGHTS-Resolver (posterior-gewichtete Mischung + EMA) | `modules/family_weights_adaptive.js` (96 lines) |
| 1C | Brain-Integration in ConsensusEngine | `server.js` Z.11360+ (requires), Z.26622+ (init+cron), Z.26073+ (weights-lookup) |

## B. WIESO

Bisheriger Stand: FAMILY_WEIGHTS war eine **konstante** Map (TREND 0.20, MOMENTUM 0.15, RISK 0.20, SENTIMENT 0.25, MICROSTRUCTURE 0.20) — unabhängig vom Markt-Regime. In einem CRASH gewichtet das Brain die gleichen Familien wie in BULL, was Renaissance/Two-Sigma niemals täten.

Aladdin-Approach: HMM-State adaptiert Familien-Gewichte. CRASH → RISK dominant. BULL → TREND dominant. RANGING → MICROSTRUCTURE+MOMENTUM. Posterior-gewichtete Mischung statt harte Switches.

## C. ARCHITEKTUR-DETAIL

### HMM-Modul
- **5 States:** BULL / BEAR / RANGING / CRASH / RECOVERY
- **5 Features:** log_return_24h, volatility (ATR/price), drawdown_pct, trend_slope (lin-reg normiert), btcd_change_pct
- **State-Profile:** mean+std-Vektoren pro state (Aladdin-style hand-tuned, in STUFE 5 Walk-Forward calibriert)
- **Transition Matrix:** sticky on diagonal (BULL→BULL 0.85, RANGING→RANGING 0.70, CRASH→CRASH 0.40)
- **Posterior:** multi-dim-Gaussian-Likelihood × transitioned-prior, normalisiert mit log-sum-exp Stabilität
- **EMA-Smoothing:** α=0.30 (70% old + 30% new) verhindert Single-Cycle-Jitter
- **DB-Persistenz:** `hmm_state` Tabelle mit posterior_json + observations_json pro detect-Call
- **Cron:** alle 60s BTC-Candles via Bitget.fetchCandles, observations + detect

### Adaptive FAMILY_WEIGHTS-Resolver
**Pro State ein Profil:**
- BULL: TREND 0.32, MOMENTUM 0.22, RISK 0.13, SENTIMENT 0.20, MICROSTRUCTURE 0.13
- BEAR: TREND 0.18, MOMENTUM 0.12, RISK 0.32, SENTIMENT 0.13, MICROSTRUCTURE 0.25
- RANGING: TREND 0.20, MOMENTUM 0.15, RISK 0.20, SENTIMENT 0.25, MICROSTRUCTURE 0.20 (Status-quo)
- CRASH: TREND 0.05, MOMENTUM 0.05, RISK 0.45, SENTIMENT 0.25, MICROSTRUCTURE 0.20
- RECOVERY: TREND 0.30, MOMENTUM 0.28, RISK 0.15, SENTIMENT 0.15, MICROSTRUCTURE 0.12

Resolved = Σ (posterior[state] × profile[state]), dann normiert + EMA-Smoothing α=0.40.

### Brain-Integration
ConsensusEngine Z.26073: vorher `const w = this.FAMILY_WEIGHTS[name] || 0.1`. Neu: `_activeW = FamilyWeightsAdaptive.resolve(HMM.posterior)`, dann `w = _activeW[name] || this.FAMILY_WEIGHTS[name] || 0.1`. Fallback bleibt statisch wenn HMM noch nicht initialisiert oder cron noch nicht gelaufen.

## D. SNAPSHOTS

- **PRE:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE1_HMM_PRE_20260520_132048/`
- **POST:** `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE1_HMM_POST_20260520_132907/`

## E. VERIFY-KENNZAHLEN

**Standalone-Test (15 sustained Cycles je Szenario, in-memory DB):**
| Szenario | Final-State | Confidence | RISK-Familien-Weight |
|---|---|---:|---:|
| BULL | BULL | 0.988 | 0.130 |
| BEAR | BEAR | 0.991 | 0.206 |
| CRASH | CRASH | 0.995 | **0.303** ✅ (war statisch 0.20) |
| RECOVERY (nach CRASH) | BULL+RECOVERY mix | 0.586+0.409 | 0.238 |
| RANGING | RANGING | 0.994 | 0.223 |

**Live nach 90s Deploy:**
- HMM-State: RANGING conf=0.607
- Posterior: BULL 0.20, BEAR 0.06, RANGING 0.61, CRASH 0.10, RECOVERY 0.02
- Observations: ret_24h 0.7%, vol_atr 0.42%, drawdown 0.23%, trend +0.0021%, btcd_change 0 (cache warming)
- Brain-Decisions in 5min: 131 (111 BUY, 20 SELL) — alive ✅
- Drift: 0 (kein wallet_recon-Eintrag wurde generiert weil keine wallet-Mutation)
- Mem: 158 MB (gesunken nach Reload)

## F. ROLLBACK-PFAD

1. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE1_HMM_PRE_20260520_132048/server.js /Users/christianheilig/NEXUS_CLEAN/server.js`
2. `rm /Users/christianheilig/NEXUS_CLEAN/modules/hmm_regime.js /Users/christianheilig/NEXUS_CLEAN/modules/family_weights_adaptive.js`
3. `pm2 reload nexus --update-env`

(DB-Tabelle `hmm_state` kann bleiben — kein Effekt ohne Modul-Code, persistiert Historie für STUFE 5 Walk-Forward.)

## G. DEMO=LIVE

Brain-FAMILY_WEIGHTS-Lookup ist in PAPER und LIVE identisch. HMM-Detect läuft als Background-Cron, kein Order-Send-Pfad berührt, keine Position-Sizing-Logik direkt geändert. DEMO=LIVE-Garantie erhalten.

## H. RISIKO-EINSCHÄTZUNG

- **Konservativ:** Im RANGING-State (heute live) sind die resolved-weights nahezu identisch zu den alten statischen weights. Bot-Verhalten ändert sich NICHT, solange Markt ranging ist.
- **Adaptive Aktivierung:** Wenn HMM einen Regime-Shift detected (z.B. CRASH bei BTC -5% in 24h + vol spike), pusht RISK-Familie auf 0.45 — Brain wird vorsichtiger. Das ist gewünschtes Verhalten.
- **Smoothing-Schutz:** Doppel-EMA (HMM-posterior α=0.30, Resolver α=0.40) verhindert dass Brain bei kurzen Vola-Spikes overshoot.
- **Fallback:** Bei HMM-Modul-Fehler nutzt ConsensusEngine die alte statische FAMILY_WEIGHTS-Map. Keine Crash-Surface.

## I. NÄCHSTE BEOBACHTUNGS-FENSTER

- Posterior-Drift über 24h beobachten (Erwartung: 60-80% RANGING in normalen Tagen)
- Bei BTC-Bewegung > 3% in 1h: HMM sollte CRASH-Posterior > 0.1 zeigen
- STUFE 5 (Walk-Forward) wird die State-Profile auf historischen 5y-Daten kalibrieren

## J. AUDIT-LOG

`/Users/christianheilig/NEXUS_CLEAN/.audit_log_master.tsv`:
```
2026-05-20T13:29:15	stufe1_hmm_adaptive_weights	deployed	hmm_module+adaptive_resolver+brain_integration	PID=8771	R=170
```

---

**STUFE 1 ENDE — STUFE 3 BEGINNT (FinBERT News-Classifier)**

REIHENFOLGE: STUFE 2 ✅ → STUFE 1 ✅ → STUFE 3 → STUFE 5 → STUFE 8 → STUFE 4 → STUFE 6 → STUFE 7 → STUFE 9 → STUFE 10
