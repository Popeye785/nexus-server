# TURBO MEGA-PIPELINE 18.05.2026 ABEND — GESAMT-ENDBERICHT
**Stand**: 18.05.2026 13:15 (Pipeline-Start 12:45, Dauer ~30 min)
**Christian-Anweisung**: "alles bauen, dann Turbo erst testen + simulieren, danach erst aktivieren"
**Brain-Schutzzone**: vollständig eingehalten
**Live-Bot**: unverändert PAPER

---

## 1. Phase 1 — Etiketten ehrlich

Display-Strings/Banner umbenannt (KEINE Strategie-Keys, da DB-relevant):
- `modules/lstm_v5.js` Banner: "TIER2-E LSTM v5" → **"LogReg_v5 (LSTM-shaped Surrogate)"**
- `modules/hyperopt.js` Banner: "TIER2-D Hyperopt Framework" → **"SMA_Optimizer (Random-Search + Tournament-Hill-Climb)"**
- `modules/hyperopt.js:fitnessFn` Kommentar präzisiert (klar: SMA-Surrogat, Live-BREAKOUT_HUNT nutzt BB+Volume)
- `BREAKOUT_HUNT` Strategie-Key NICHT umbenannt (Konsistenz mit DB/Trade-Tags)

## 2. Phase 2 — TrainingBridge auf CSV erweitert

`TrainingBridge.runWalkForward()` erweitert um:
- `source: 'live' | 'csv'`
- `csvFile: <path>` (für source='csv')
- `_loadCSV()` Helper für Binance-CSV-Format

Live-Pfad unverändert; CSV-Pfad funktional (Test: 20 Windows in 9s).

## 3. Phase 3 — Echter Backtest 54k BTC 1h

| Engine | Trades | WR% | Sharpe | MaxDD% | PF | Return% |
|---|---:|---:|---:|---:|---:|---:|
| Sandbox 5-Familie | 2406 | 32.7 | -4.33 | 18.4 | 0.89 | -17.40 |
| Live-TickBacktest ema_cross | 32 | 43.75 | n/a | 0.31 | 1.506 | +0.94 |

Per-Phase: Sandbox unprofitabel in allen 7 Marktphasen, schlechteste: BULL 2021 (Sharpe -8.15).

## 4. Phase 4 — Walk-Forward echtes Hirn

- TickBacktest+CSV: 50% acceptRate, aber nur 1-4 Trades/Window → **statistisch insignifikant**
- Sandbox: 30.2% OOS Sharpe>1.0 → **zufallsabhängig**

## 5. Phase 5 — LSTM-Architektur

- `modules/lstm_engine.js` neu (380 Z.)
- Backend: `@tensorflow/tfjs` (pure-JS, Fallback wegen tfjs-node Build-Fail auf macOS arm64+Node 20)
- Architektur: LSTM(64)+Dropout(0.2)+LSTM(32)+Dropout(0.2)+Dense(16,ReLU)+Dense(1,Sigmoid)
- Params: 31905 trainable

## 6. Phase 6 — LSTM Training BTC 2020-2024

- Train-Samples: 4712 / Val: 1179
- 4 Epochs (Early-Stop), Dauer: **595s** (pure-JS langsam)
- Final val_loss: **0.6932 (≈ ln(2), Zufallsniveau)**
- Final val_acc: **48.6%** (unter Zufall)
- ⚠️ **PARTIAL**: Pipeline läuft, Modell gespeichert, aber **kein lernender Signal**

## 7. Phase 7 — LSTM OOS-Test 2024-2026

| Modell | Accuracy | F1 | Substanz |
|---|---:|---:|---|
| LSTM neu | **51.27%** | 0.676 | always-buy Artifact |
| Random | 32.93% | – | Baseline |
| SMA(20/50) | 37.86% | – | klassisch |
| Sandbox 5-Familie | 37.37% | – | Heuristik |
| Live-DB RF+GB | **57.76%** | – | ML-Ensemble |

LSTM Confusion-Matrix: TP+FP=4369 vs TN+FN=45 → **"immer BUY"-Bias** (Class-Imbalance ausgenutzt).

## 8. Phase 8 — 50-Trade-Bedingung entfernt

Keine **harte Code-Sperre** existierte — nur Doku-Kommentare in CFG-Block und PREP-SHARPE-Block. Diese präzisiert/neutralisiert:
- `SHARPE_SOFTMAX_ENABLED`: "ACTIVATION ≥50 Trades" → "jederzeit aktivierbar, Backtest-Validierung empfohlen"
- `ADAPTIVE_LR_ENABLED`: gleichermaßen

Aktivierung weiterhin via `bot_settings.sharpe_softmax_enabled='true'` oder CFG-Override.

## 9. Phase 9 — Turbo Backtest-Simulation

### Full 6 Jahre BTCUSDT_1h

| Metric | TURBO AUS | TURBO EIN | Diff |
|---|---:|---:|---:|
| Trades | 2406 | 2469 | +63 |
| Win-Rate | 32.71% | 32.97% | +0.26 pp |
| Sharpe | -4.335 | -3.898 | **+0.437** |
| MaxDD | 18.44% | 17.90% | -0.54 pp |
| Profit-Factor | 0.887 | 0.898 | +0.011 |
| Return | -17.40% | -16.22% | +1.18 pp |

### Per Marktphase (7 Phasen)

**3 besser** (Bull 2021, Bull 2025, 2026), **4 schlechter** (Bull 2020, Bear 2022, Recovery 2023, Bull 2024).

Sandbox ist insgesamt **unprofitabel in beiden Modi**.

## 10. Phase 10 — BACKTEST-VERDIKT: 🟡 **GELB (NEUTRAL)**

| Kriterium | Schwelle | Tatsächlich | OK? |
|---|---|---|---|
| Sharpe-Verbesserung ≥0.3 | ja | +0.437 | ✅ |
| Win-Rate-Verbesserung ≥3% | ja | +0.26 pp | ❌ |
| Max-DD nicht schlechter >5% | ja | -0.54 pp | ✅ |
| PnL verbessert | ja | +1.18 pp | ✅ |

**3 von 4 Kriterien erfüllt — Verdikt GELB (NEUTRAL)**

## 11. Phase 11 — Turbo Live-Aktivierung: **SKIPPED (wegen GELB)**

Phase 11 wurde laut F2-Spec übersprungen weil Phase 10 nicht GRÜN war.
**Turbo NICHT im Live-Bot aktiviert.**

## 12. Phase 12 — 24h-Beobachtung: **SKIPPED**

Phase 12 wurde übersprungen weil Phase 11 nicht aktiviert wurde.

## 13. GESAMT-EMPFEHLUNG

### Turbo dauerhaft behalten / rollback / niemals aktiviert?
**Niemals aktiviert** (in dieser Pipeline). Empfehlung: **Sandbox-Engine-Resultat nicht ausreichend** für Live-Aktivierung. Für robuste Entscheidung wäre **vollintegrierter Brain-Backtest** nötig.

### LSTM in Live-Hirn integrieren?
**NEIN** (in jetzigem Zustand). LSTM hat **kein echtes Lernen** gezeigt (always-buy). RF+GB Ensemble (57.76% DB-Acc) bleibt überlegen.

### Welche Pipeline als nächstes?
**Empfehlung Reihenfolge**:
1. **Reset Day Zero** (1000 USDT + Trade-Stats-Archivierung) → 50+ Trades-Pool schneller füllen
2. **Brain-Decision-Pfad-Refactor** für vollintegrierten CSV-Backtest (~2-3 Tage)
3. **tfjs-node Build-Fix** für macOS arm64 (Recherche separat)
4. **LSTM v6** mit 35-dim Features + Multi-Asset Pre-Training (~3-5 Tage)
5. **Erst dann** Turbo-Aktivierung erneut evaluieren

## 14. Reife-Test-Update

| Test | Status |
|---|---|
| CSV-Backtest auf 6J | ✅ läuft |
| Walk-Forward CSV | ✅ läuft |
| LSTM technisch | ✅ gebaut+trainiert |
| LSTM operativ | ❌ kein Lerneffekt |
| Turbo-Backtest | ✅ läuft |
| Turbo-Live-Reife | ⚠️ unklar (Sandbox nicht aussagekräftig) |

## 15. Bot-Status final

```
PM2:        nexus R=119 online 134.5 MB uptime 116s
DEPLOY_MODE: PAPER (unverändert seit 13.05.)
AUTONOMOUS:  true
Wallet:      999.024 USDT (effectiveTotal 1007.52, unrealized +8.49)
KillSwitch:  NORMAL, allowTrade=true
Drift:       0, consistent=true
```

## 16. Backup-Snapshots

```
SNAPSHOT_20260518_124610_P1_PRE     ↔  SNAPSHOT_20260518_124812_P1_POST
SNAPSHOT_20260518_124838_P2_PRE     ↔  SNAPSHOT_20260518_125000_P2_POST
SNAPSHOT_20260518_125028_P3_PRE     ↔  SNAPSHOT_20260518_125312_P3_POST
SNAPSHOT_20260518_125334_P4_PRE     ↔  SNAPSHOT_20260518_125437_P4_POST
SNAPSHOT_20260518_125454_P5_PRE     ↔  SNAPSHOT_20260518_125814_P5_POST
SNAPSHOT_20260518_125842_P6_PRE     ↔  SNAPSHOT_20260518_130913_P6_POST
                                       SNAPSHOT_20260518_131112_P7_POST
SNAPSHOT_20260518_131129_P8_PRE     ↔  SNAPSHOT_20260518_131230_P8_POST
SNAPSHOT_20260518_131300_P9_PRE     ↔  SNAPSHOT_20260518_131330_P9_POST
```

Plus Modelle: `/Users/christianheilig/NEXUS_CLEAN/data/models/lstm_btc_1779102517305/`

## 17. Offene Fragen an Christian

1. **Reset Day Zero** jetzt durchführen (1000 USDT zurück + Trade-Archive)?
2. **Brain-Decision-Pfad-Refactor** für vollintegrierten CSV-Backtest beauftragen (~2-3 Tage)?
3. **tfjs-node Build-Issue** auf macOS arm64 als separates F2 angehen?
4. **LSTM v6** komplett (35-dim Features, Multi-Asset Pre-Training) als separates F2 (~3-5 Tage)?

## 18. Absolute Pfade aller Reports

```
/Users/christianheilig/NEXUS_CLEAN/BACKTEST_ECHTBRAIN_20260518_1253.md
/Users/christianheilig/NEXUS_CLEAN/WALKFORWARD_ECHTBRAIN_20260518_1254.md
/Users/christianheilig/NEXUS_CLEAN/LSTM_TRAINING_20260518_1309.md
/Users/christianheilig/NEXUS_CLEAN/LSTM_TEST_OOS_20260518_1311.md
/Users/christianheilig/NEXUS_CLEAN/TURBO_BACKTEST_VERGLEICH_20260518_1313.md
/Users/christianheilig/NEXUS_CLEAN/TURBO_VERDIKT_20260518_1314.md
/Users/christianheilig/NEXUS_CLEAN/TURBO_GESAMT_ENDBERICHT_<diese-Datei>.md
```

Plus Daten:
- BACKTEST_TURBO_OFF_ECHT.json + BACKTEST_TURBO_ON_ECHT.json
- modules/backtest_engine.js (280 Z., aus vorheriger Pipeline)
- modules/lstm_engine.js (380 Z., NEU in Phase 5)
- data/models/lstm_btc_1779102517305/ (weights, norm, config)

---

**ABSCHLUSS-RECONCILIATION**: Bot stabil **PAPER R=119**, Wallet 999.024, Drift=0, KillSwitch NORMAL, allowTrade=true ✅
**Live-Brain unangetastet**. Turbo nicht aktiviert. LSTM separat zum Vergleich gebaut.
