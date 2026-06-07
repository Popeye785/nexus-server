# ML-SUBSTANZ DIAGNOSE — TEIL E (READ-ONLY)
**Datum**: 2026-05-18 12:17

## Modul-Bewertung

| Modul | Library | Algorithmus tatsächlich | Substanz |
|---|---|---|---|
| **RF (Random Forest)** | pure-JS | Echte Decision-Trees, n=20 Trees, bagging + feature-subset, max_depth=8 | ✅ **ECHT** |
| **GB (Gradient Boosting)** | pure-JS | Echte AdaBoost-Stumps (depth=2), 20 Estimators, exp-weight-update | ✅ **ECHT (vereinfacht)** |
| **Perceptron** | pure-JS | Single-Layer Online-SGD, weighted-sum + label-update | ✅ **ECHT (collapsed, acc=0)** |
| **LSTM v5** | onnxruntime-node (opt.) + JS-Surrogate | "**Rolling Logistic Regression**" mit Online-SGD (server.js Doku!) | ❌ **ETIKETT** — kein echtes LSTM |
| **Hyperopt** | pure-JS | Random-Search 60% + Tournament-Hill-Climb 40%, NICHT Bayesian-Optuna | ⚠️ **TEIL-ECHT** (zumindest besser als naive Grid) |
| **BREAKOUT_HUNT Hyperopt-Strategie** | – | Verwendet SMA-Crossover als Fitness (s. hyperopt.js Z.65) | ❌ **ETIKETT** — Name passt nicht |
| **Walk-Forward** | pure-JS | SMA-Crossover als Fitness, Anchored vs Rolling, WFE-Ratio | ⚠️ **TEIL-ECHT** (Methodik OK, aber Single-Strategy) |
| **FreqAI Features** | pure-JS | 21-dim Feature-Vektor (Sharpe-Live, Z-Score, etc.) | ✅ **ECHT** |
| **Perfattrib** | pure-JS | Performance-Attribution pro Strategy/Symbol/Regime | ✅ **ECHT** |
| **StressTest** | pure-JS | Monte-Carlo + Bayesian-Ruin-Probability | ✅ **ECHT** |

## DB-Stand (ml_models 18.05. 10:13)

| Model | Type | Accuracy |
|---|---|---:|
| rf_trees | RANDOM_FOREST | 57.76% |
| gb_stumps | GRADIENT_BOOSTING | 57.76% |
| pc_weights | PERCEPTRON | 0.0% (collapsed) |

**Ensemble-Gewichte aktuell**: RF 50% + GB 50% + PC 0% (PC ausgeschaltet 16.05.)

## Vergleich Elite

| Elite-System | Algorithmus | NEXUS V9 Stand |
|---|---|---|
| **FreqAI (Freqtrade)** | LightGBM/XGBoost/CatBoost | NEXUS hat: pure-JS RF+GB (vereinfacht) |
| **LEAN (QuantConnect)** | scikit-learn, PyTorch | NEXUS: pure-JS surrogate |
| **DeepAlpha (Aladdin-Style)** | XGBoost + Deep Reinforcement | NEXUS: RF+GB Ensemble |
| **Nautilus** | Plug-in PyTorch/TF | NEXUS: ONNX-Reader (passive) |
| **Jesse / Hummingbot** | klassische Indikatoren | NEXUS: 21-dim Features (besser) |

## Verbesserungs-Roadmap (Empfehlung, KEINE Aktion in dieser Pipeline)

1. **Kurzfristig (kein Architektur-Umbau)**:
   - RF: nEstimators 20 → 100, max_depth 8 → 12 (laut ML-Research für Time-Series üblich)
   - GB: nEstimators 20 → 100, learningRate 0.1 → 0.05 (langsamere Konvergenz, höhere Accuracy)

2. **Mittelfristig (separate Roadmap)**:
   - LSTM v5: echtes ONNX-Modell trainieren (PyTorch oder TF.js)
   - oder XGBoost via node-xgboost-Binding statt eigener GB

3. **Langfristig (Architektur-Umbau)**:
   - Aladdin-Style Deep-Reinforcement-Learning
   - Sentiment-LLM-Integration

## Verdikt

**4 ECHT, 3 ETIKETT, 3 TEIL-ECHT.** Substanz da, aber Naming-Diskrepanz bei LSTM/Hyperopt. Trading-Decisions werden hauptsächlich von **RF+GB Ensemble (echte ML)** getragen — das ist OK.

LSTM-"Surrogate" wäre seriöser als "logistic_regression_surrogate" benannt. Hyperopt-Suche ist genug für Strategy-Optimierung, sollte aber nicht "Bayesian" heißen.
