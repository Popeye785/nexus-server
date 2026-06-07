# Quant-Benchmarking → NEXUS-Brain Übersetzung

**Datum:** 2026-05-27 10:00 CEST · Bot R=294 stabil · Tag 7
**Zweck:** Quant-Industrie-Praxis konkret auf NEXUS V9 mappen, Fokus Mega-Cap-Edge.

## Format pro Methode

```
╔════════════════════════════════════════════════════╗
║ METHODE: [Name] · Quelle: [Primärquelle]           ║
╠════════════════════════════════════════════════════╣
║ WAS · WIE · NEXUS-ÜBERSETZUNG                      ║
║ (Schicht / Modul / Code-Stelle / Aufwand / Wirkung)║
╚════════════════════════════════════════════════════╝
```

---

## 🥇 METHODEN MIT HÖCHSTEM MEGA-CAP-IMPACT

### M1 — Fractional Differentiation
**Quelle:** Lopez de Prado (2018) Ch.5; Hosking (1981) Biometrika 68(1)

**WAS:** Macht Time-Series stationär bei maximaler Memory-Erhaltung. Klassisches Differencing (d=1) zerstört Memory; fractional d∈(0,1) bewahrt sie.

**WIE:** `(1−B)^d = Σ ω_k · B^k` mit `ω_k = ω_{k-1}·(−1)·(d−k+1)/k`. Smallest d sodass ADF-Test p<0.05 — typisch d=0.1-0.4 mit >90% Korrelation zur Original-Series.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 1 (Daten/Signal) — Feature-Engineering vor Sub-Sources
- **Modul:** Neues `modules/fractional_diff.js` + Konsum in `freqai_features.js` (modules/freqai_features.js)
- **Code-Stelle:** Bot ruft Indikatoren (RSI/MACD/EMA) **auf raw-prices** (server.js:UnifiedScore Z.11760 via Bitget candles). Diese sind nicht-stationär bei trending Markets → Indikatoren überreagieren auf level vs change.
- **Was neu:** 50-Zeilen `fracDiff(prices, d=0.2, thresh=1e-3)` Funktion
- **Was umbauen:** UnifiedScore-Aufrufe — vor TREND-Familie raw-prices durch fracDiff-prices ersetzen
- **Was bleibt:** ALLE Indikator-Logiken, Brain-Decide-Pipeline, Sizing
- **Aufwand:** 4-8h (Modul + 2 Test-Symbole)
- **Erwartete Wirkung Mega-Cap:** **HOCH** — BTC/ETH trenden langsam, Bot's Indikatoren reagieren auf absolute Levels. Fractional Diff macht **Trend-Stärke** lesbarer, nicht **Trend-Existenz**. Sollte BTC-BUY-success 26% → ~40% bringen (geschätzt aus LdP-Empirik).
- **Risiko:** d-Parameter braucht Tuning pro Symbol. Falls falsch → Information-Verlust.

---

### M2 — CUSUM Event-Driven Sampling
**Quelle:** Lopez de Prado (2018) Ch.2/4; Page (1954) Biometrika 41

**WAS:** Trigger Bar/Decision-Events nur wenn cumulative-deviation > Schwelle. Vermeidet Time-Bar-Artefakte; konzentriert Brain auf "Events".

**WIE:** `S_t^+ = max(0, S_{t-1}^+ + y_t − E[y_t])`, Trigger bei `S_t^+ ≥ h` mit `h = 2·σ_daily`. Reset auf 0 nach Trigger.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 3 (Entscheidung) — VOR AladdinBrain.decide als Gate
- **Modul:** Neues `modules/cusum_filter.js` (~80 LOC)
- **Code-Stelle:** ShadowCycle._tick (server.js:28735+) — aktuell tickert alle 8s für alle 12 Symbole. Bot generiert pro Symbol ~10500 Decisions/24h, 99.8% mit conf<0.20.
- **Was neu:** CUSUM-State pro Symbol, persistiert in DB-Tabelle `cusum_state`. Bei Trigger → Brain-decide ausführen, sonst skip.
- **Was umbauen:** ShadowCycle-Loop → CUSUM-Check vor Brain-Call
- **Was bleibt:** Brain, UnifiedScore, RiskSizing
- **Aufwand:** 1-2 Tage (Modul + State-Mgmt + integration)
- **Erwartete Wirkung Mega-Cap:** **MITTEL** — bei BTC (langsam-bewegend) würden ~80% der Time-Bar-Decisions wegfallen. Brain trifft nur bei echten Bewegungen Entscheidung → reduziert "BUY auf 0.05% Rebound" Anti-Edge. Schätzung: BTC-Trade-Rate von "alle 8s" auf "alle 30-60min" — passt zu Mega-Cap Hold-Times.
- **Risiko:** Bei zu hoher Schwelle keine Trades. Schwellen-Tuning nötig.

---

### M3 — Avellaneda-Lee Statistical Arbitrage / Mean-Reversion
**Quelle:** Avellaneda & Lee (2010) SSRN 1153505

**WAS:** Trade residual-returns nach Markt/Sektor-Entfernung als Mean-Reverting OU-Prozess. Contrarian gegen kurzfristige Abweichungen.

**WIE:**
1. Residual: `ε_i = r_i − Σ β_ij · F_j` (PCA oder Sector-ETF-Regression)
2. Cumulative: `X_t = Σ ε_s` als OU: `dX = κ(m − X)dt + σdW`
3. **s-score** = `(X − m) / σ_eq`
4. Short bei `s > +1.25`, Long bei `s < −1.25`, Exit bei `|s| < 0.5`
5. Sharpe ~1.44 in Equities (1997-2007)

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 1+3 — neuer Sub-Source in RISK-Familie + Strategy-Variante
- **Modul:** Neues `modules/mean_reversion_stat_arb.js` (~200 LOC)
- **Code-Stelle:** Aktuell hat Brain **NUR Trend-Following-Logic** (TREND-Familie 35% Gewicht). Keine echte Mean-Reversion. Bot triggert BUY auf Up-Moves (NEAR-Bull funktioniert, BTC-Mini-Rebounds verlieren).
- **Was neu:**
  - PCA über 12 Symbole für 30d → Residuen pro Symbol
  - OU-Fit pro Symbol (κ, m, σ_eq mit MLE)
  - s-score als neue Sub-Source mit FAMILY=RISK_REVERSION
  - StrategySelector: bei s>2 → MR-Trade (BTC short), bei s<−2 → MR-Trade (BTC long)
- **Was umbauen:** AladdinBrain.decide → 6. Familie hinzufügen ODER RISK-Familie erweitern um MR-Score
- **Was bleibt:** Trend-Following-Path bleibt für NEAR/SUI; MR-Path neu für BTC/ETH/BNB
- **Aufwand:** 3-5 Tage (PCA + OU-Fit + Integration + Test)
- **Erwartete Wirkung Mega-Cap:** **SEHR HOCH** — Mega-Caps oszillieren mehr als trenden (BTC 0.59%/1h-Bewegung ist symmetrisch). MR-Strategie ist STRUKTURELL die richtige Wahl für Mega-Caps.
- **Risiko:** MR-Trades sind catch-falling-knife wenn echter Trend-Break. Brauchst Stop-Loss-Mechanik.

---

### M4 — Funding-Rate-Capture (Cash-and-Carry)
**Quelle:** arXiv 2212.06888 "Fundamentals of Perpetual Futures"; BitMEX Q3 2025

**WAS:** Delta-Neutral-Trade: long spot + short perp → kassiert funding-payments bei positiver Rate. Annualisiert oft 5-30% APY auf Mega-Caps.

**WIE:** `F = P + clamp(I − P, ±0.05%)` mit P=Premium-Index, I=0.01%/8h. Annualized = `F · 3 · 365`. Bei BTC F=0.01% → ~11% APY.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 3 + Execution — neue Strategy-Klasse parallel zu SINGLE/DCA/GRID
- **Modul:** Neues `modules/funding_carry.js` + Bitget-Perpetual-API-Integration (zusätzliche Datei `modules/bitget_perpetual.js`)
- **Code-Stelle:** Bot hat aktuell `_FundingOI` (modules/datasource_funding_oi.js) als RISK-Familie-INPUT, aber **keine Funding-Rate-CAPTURE-Strategie**. CFG hat `DEPLOY_MODE='PAPER'` ohne Perpetual-Support.
- **Was neu:**
  - Bitget-Perpetual-API-Client (separat von Spot)
  - FundingCarryEngine: prüft Funding-Rate stündlich, opens Position wenn >0.005%/8h (~5.5% APY)
  - DemoEngine-Erweiterung: simuliert Funding-Payments im PAPER-mode
- **Was umbauen:** ExecutionAdapter (PAPER+LIVE) braucht Perpetual-Order-Routing
- **Was bleibt:** Spot-Trading-Logic komplett
- **Aufwand:** 1-2 Wochen (vor allem Bitget-Perpetual-API + PAPER-Simulation)
- **Erwartete Wirkung Mega-Cap:** **HÖCHST** — Funding-Rate-Capture liefert auf BTC/ETH systematisch 5-15% APY, ist marktneutral, ohne Direction-Prediction. **Würde Mega-Cap-Problem direkt umgehen** (nicht Direction predicten, sondern Funding kassieren).
- **Risiko:** Funding kann flippen (negative Rates in Bear), short-squeeze-Risk auf Spot-Borrow-Side, Exchange-Risk. Christians Anti-Brick "Reserve unantastbar" muss erhalten bleiben.

---

### M5 — Asset-Class-spezifische Models (Mega-Cap-Klasse)
**Quelle:** Liu/Tsyvinski/Wu (2022) J. of Finance 77(2); Industry-Standard Citadel/Two-Sigma

**WAS:** Verschiedene Coin-Klassen brauchen separate Models. Mega-Cap-Crypto hat tieferes Order-Book (linear Market-Impact), Mid-Cap non-linear. Liu et al. zeigen: Size-Faktor in Crypto **negativ** (Mega-Cap underperformt long-term), Momentum **positiv**.

**WIE:** Klassen-Tagging + separate Family-Weights + separate Confidence-Schwellen pro Klasse.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 3 (Entscheidung) — Brain-Konfiguration pro Klasse
- **Modul:** Erweiterung `AladdinBrain` (server.js:28002) + neues `modules/symbol_classifier.js`
- **Code-Stelle:** Aktuell `FAMILY_WEIGHTS` (server.js:28041-28046) ist **GLOBAL**: TREND 0.35 / RISK 0.30 / MICRO 0.25 / MOM+SENT 0.05. Block-L-Befund: BTC braucht andere Gewichte.
- **Was neu:**
  - SymbolClassifier: BTC/ETH → "Mega" · NEAR/SUI/SOL → "Mid" · DOGE/AVAX → "Small"
  - FAMILY_WEIGHTS_PER_CLASS:
    - Mega: TREND 0.15 / RISK 0.30 / MICRO 0.30 / MR 0.25 (neue Sub-Source aus M3)
    - Mid: TREND 0.35 / RISK 0.30 / MICRO 0.25 / MOM+SENT 0.10 (aktuell)
    - Small: TREND 0.40 / SENT 0.20 / RISK 0.25 / MICRO 0.15
- **Was umbauen:** `_aggregateScores()` in AladdinBrain liest dynamisch class-spezifische Weights
- **Was bleibt:** Sub-Source-Berechnung, VETO-Logik, Sizing
- **Aufwand:** 2-3 Tage (SymbolClassifier + per-Class-Weights + Integration)
- **Erwartete Wirkung Mega-Cap:** **HOCH** — adressiert Block-L-Befund direkt. BTC bekommt MR-Lean (s.M3), Mid-Caps bleiben Trend-Following.
- **Risiko:** Mehr Konfiguration = mehr Tuning-Aufwand. Klassen-Tagging ist Hard-Coded am Start (kein automatischer Klassifizier).

---

## 🥈 METHODEN MIT ALLGEMEINER BRAIN-VERBESSERUNG

### M6 — Volume Bars statt Time Bars
**Quelle:** Lopez de Prado (2018) Ch.2

**WAS:** Sample-Bars nicht nach Zeit sondern nach kumulativem Volume — produziert i.i.d.-nähere Returns, bessere Normality-Property.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 1 (Daten/Signal)
- **Modul:** Erweiterung `Bitget.fetchCandles` (server.js:1641) — neue Methode `Bitget.fetchVolumeBars(symbol, dollarVolume)`
- **Was neu:** Volume-Bar-Builder aus Tick-Data oder 1m-Candles aggregiert. Bitget bietet keine Volume-Bars direkt → muss aus 1m-Candles re-aggregiert werden.
- **Was umbauen:** ShadowCycle.fetchCandles-Aufrufe optional auf Volume-Bars
- **Aufwand:** 1 Tag
- **Wirkung:** mittel (verbessert Statistik aller Sub-Sources, kein direkter Mega-Cap-Fix)
- **Risiko:** mehr DB-Speicher (Volume-Bars sind irregulär).

---

### M7 — Purged K-Fold Cross-Validation
**Quelle:** Lopez de Prado (2018) Ch.7

**WAS:** CV-Variante die look-ahead-leakage in Time-Series-ML-Labels verhindert.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** ML-Training-Pipeline (MLOptimizer + MetaLabelClassifier)
- **Modul:** Neues `modules/purged_cv.js` + Integration in `scripts/train_meta_label_classifier.js`
- **Was neu:** PurgedKFold-Implementation für Walk-Forward-CV mit Embargo
- **Was umbauen:** MLOptimizer.train (server.js:~3700) + Meta-Label-Training-Skript
- **Was bleibt:** RandomForest-Konfig, Feature-Engineering
- **Aufwand:** 2 Tage
- **Wirkung:** mittel — verbessert ML-Generalisierung, reduziert Backtest-Overfit. Direkter Mega-Cap-Effekt unklar.
- **Risiko:** niedrig.

---

### M8 — Combinatorial Purged CV + Deflated Sharpe
**Quelle:** Lopez de Prado (2018) Ch.12; Bailey/Lopez de Prado (2014) JPM

**WAS:** Statt single-path Sharpe → Sharpe-Distribution. Deflated Sharpe = adjusted für multiple-trial-bias.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** Backtest-Framework (Block L hat Walk-Forward, aber single-path)
- **Modul:** Erweiterung `scripts/threshold_optimization.js`
- **Was neu:** CPCV-Splits-Generator + DSR-Berechnung als Selection-Metric statt nakedem Sharpe
- **Aufwand:** 2-3 Tage
- **Wirkung:** **WICHTIG** — Block-L NEAR+SUI-Whitelist mit Sharpe 16.5 ist mit single-path-9d-Sample wahrscheinlich Overfit. CPCV+DSR würde **echte Edge** vs **Backtest-Overfit** trennen.
- **Risiko:** niedrig.

**→ Engineer-Empfehlung: M8 sollte BEFORE Block-L-Whitelist-Deploy ausgeführt werden.**

---

### M9 — Multi-Faktor-Modeling (Fama-French + Crypto)
**Quelle:** Fama/French (2015) JFE; Liu/Tsyvinski/Wu (2022) JF

**WAS:** Decomposition Returns in Faktor-Exposures (Market/Size/Momentum für Crypto).

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 2 (Analyse/Risk) — neue Risk-Engine-Komponente
- **Modul:** Neues `modules/factor_decomp.js`
- **Was neu:**
  - Daily-OLS-Regression: r_i = β_M·BTC_return + β_S·SmallCap_proxy + β_Mom·Momentum_factor + ε
  - Pro Symbol: β-Exposures als zusätzliche Features
- **Was umbauen:** UnifiedScore könnte Faktor-Exposures als Sub-Source haben
- **Aufwand:** 3-4 Tage
- **Wirkung:** mittel — bessere Risk-Decomposition, könnte Portfolio-Heat-Map verbessern. Direkter Trade-Edge unklar.
- **Risiko:** mittel — Crypto-Faktoren weniger stabil als Equity-Faktoren.

---

### M10 — Hash Ribbon / On-Chain Signal (BTC-spezifisch)
**Quelle:** Edwards (2019) Capriole; Glassnode Metric Catalog

**WAS:** BTC-Bottom-Indikator über Hash-Rate-MA-Cross + price-momentum-flip. Historisch starker Bottom-Signal.

**WIE:** Signal = `30d-MA(HashRate) crosses above 60d-MA(HashRate)` + price > 10d-MA. Miner-Capitulation-End-Pattern.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 1 (Daten/Signal) — neue On-Chain-Sub-Source für RISK-Familie
- **Modul:** Erweiterung `modules/datasource_onchain.js` (existiert schon!) — füge Hash-Ribbon-Calc hinzu
- **Was neu:** Glassnode/CoinMetrics-API-Call für Hash-Rate (Free-Tier limited, oder Mempool.space als Proxy)
- **Was umbauen:** RISK-Familie bekommt neue Sub-Source `hashRibbon` mit BTC-spezifischem Output
- **Aufwand:** 1-2 Tage (API-Integration + Backfill)
- **Wirkung:** **NUR FÜR BTC** — On-chain-Signals sind BTC-spezifisch (ETH hat eigene Metriken via Beacon-Chain). Würde BTC-Decision-Quality verbessern für Bottom/Top-Calls.
- **Risiko:** niedrig (read-only-API, additive Sub-Source).

---

### M11 — Cross-Exchange Statistical Arbitrage
**Quelle:** Makarov/Schoar (2020) JFE 135(2)

**WAS:** Spread zwischen gleichem Asset auf 2 Exchanges → mean-reverting, exploit wenn Spread > Fee+Latency-Threshold.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 3 + Execution
- **Modul:** Komplexer — braucht multi-exchange-execution-adapter (Bitget + 2. Exchange)
- **Code-Stelle:** Bot ist single-exchange (Bitget). Cross-Exchange wäre Architektur-Erweiterung.
- **Aufwand:** **3-4 Wochen** (zwei-Exchange-Inventory-Management, Latency-Monitor, Settlement-Time-Mgmt)
- **Wirkung:** Mega-Cap-Edge VORHANDEN aber in 2024+ Spreads für BTC/ETH konvergiert. Nur in Mid-Caps + Korea-Premium-ähnlichen Cases noch profitabel.
- **Risiko:** hoch — exchange-Risk × 2, withdrawal-times, neue Architektur-Komplexität.
- **Empfehlung:** NICHT priorisieren.

---

### M12 — LEAN / Nautilus-Pattern: Strategy-Composition
**Quelle:** github.com/QuantConnect/Lean; github.com/nautechsystems/nautilus_trader

**WAS:** Klare Trennung AlphaModel → PortfolioConstruction → RiskManagement → Execution als pluggable Modules.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** Architektur-Refactor — alle 3 Schichten betroffen
- **Modul:** Großer Refactor — würde NEXUS-Module modularisieren
- **Code-Stelle:** Aktuell Brain+Sizing+Execution sind eng-gekoppelt in DemoEngine._executeTrade (server.js:~25000+)
- **Was neu:** AlphaModel-Interface, PortfolioConstruction-Interface, etc.
- **Was umbauen:** **mehrere kritische Pfade** — DemoEngine, AladdinBrain, RiskSizing
- **Aufwand:** **4-8 Wochen** (Refactor)
- **Wirkung:** mittel — bessere Code-Wartbarkeit, leichter neue Strategien einbauen
- **Risiko:** sehr hoch (touched CLAUDE.md Hard-Rules "DEMO=LIVE 1 Code-Pfad")
- **Empfehlung:** NICHT JETZT, vielleicht nach LIVE-Phase.

---

### M13 — FreqAI Adaptive Retraining
**Quelle:** freqtrade.io FreqAI docs

**WAS:** Per-Symbol ML-Models, kontinuierliche Retraining in Sliding-Window (z.B. alle 7 Tage rolling).

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** ML-Training-Pipeline
- **Modul:** Erweiterung `MLAutoRetrain` (server.js:23568+)
- **Was neu:** Per-Symbol-Modelle (statt single ensemble), rolling-window retrain alle 7 Tage
- **Was umbauen:** MLOptimizer-State-Mgmt (per-symbol statt global)
- **Aufwand:** 1 Woche
- **Wirkung:** **gut für Mega-Cap-Edge** — BTC braucht anderes Modell als NEAR. Per-Symbol-Models würden Block-L-Befund "Brain liest Symbole unterschiedlich" adressieren.
- **Risiko:** mittel — N×mehr Modelle = N×Trainings-Compute.

---

### M14 — Almgren-Chriss Optimal Execution
**Quelle:** Almgren & Chriss (2001) J. of Risk

**WAS:** Optimal trade-schedule für large orders → minimiert market-impact + variance.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** Execution
- **Modul:** Erweiterung ExecutionAdapter
- **Aufwand:** 2-3 Tage
- **Wirkung:** NUR relevant für **LIVE+großes Capital**. Bei aktuellen Position-Sizes (5-50 USDT) irrelevant.
- **Risiko:** niedrig
- **Empfehlung:** NUR wenn LIVE deployed + AUM > ~$10k.

---

### M15 — Bayesian Faktor-Learning (Posterior-Update)
**Quelle:** Pflug/Pichler in Cont. Risk Management

**WAS:** Bayesian update von Faktor-Exposures aus realisierten Trades — adaptive learning.

**NEXUS-ÜBERSETZUNG:**
- **Schicht:** 2 (Analyse) — Brain hat schon `RiskEngine.bayesian` (server.js:13460) aber `learnPriors=false`!
- **Code-Stelle:** server.js:13460 (Bayesian Update)
- **Was neu:** `learnPriors=true` aktivieren + Trade-Outcome-Feedback-Loop
- **Was umbauen:** Bayesian-Modul-Konfig + neue persistente Tabelle `bayesian_priors_per_symbol`
- **Aufwand:** **2-3 Tage** (kleine Change in existing code!)
- **Wirkung:** **HOCH für Mega-Cap-Edge** — aktuell statische Priors. Aktivierung würde BTC-spezifische Posteriors lernen über echte Outcomes.
- **Risiko:** niedrig — Bayesian-Modul existiert schon, nur Toggle.
- **Empfehlung: ⭐ QUICK-WIN — eines der einfachsten Hebel mit hohem Impact.**

---

## 📋 TOP-3 EMPFEHLUNGEN — Mega-Cap-Edge

### 🥇 #1 — M3 Avellaneda-Lee Mean-Reversion (3-5 Tage)
**Begründung:** Mega-Caps oszillieren statt zu trenden. Block-L bewies: BTC/ETH BUY-success 24-26%, SELL-success 47-50% — pures Random-Walk-Pattern. Mean-Reversion ist mathematisch korrekte Antwort.

**Konkrete Implementation-Skizze:**
```js
// modules/mean_reversion_stat_arb.js (NEW)
const MRStatArb = {
  // PCA über 12 Symbole für 30d daily returns
  computeResiduals(symbols, returns30d) {
    const factors = PCA(returns30d, n_components=3);
    return symbols.map(s => returns30d[s] - factors.dot(betas[s]));
  },
  // OU-Fit pro Symbol
  fitOU(residualsCumsum) {
    // MLE: dX = κ(m - X)dt + σdW
    return { kappa, m, sigma_eq };
  },
  // s-score Signal
  signal(symbol) {
    const X = this.cumulativeResidual(symbol);
    const { kappa, m, sigma_eq } = this.params[symbol];
    const s = (X - m) / sigma_eq;
    if (s > 1.25) return { dir: 'SELL', conf: Math.min(s/3, 1.0) };
    if (s < -1.25) return { dir: 'BUY', conf: Math.min(-s/3, 1.0) };
    if (Math.abs(s) < 0.5) return { dir: 'EXIT', conf: 0.7 };
    return null;
  }
};
```
Integration: neue Sub-Source `mrStatArb` in MICROSTRUCTURE-Familie (höchster aktueller Weight bei Mega-Caps falls M5 deployed).

### 🥈 #2 — M15 Bayesian Priors-Learning aktivieren (2-3 Tage)
**Begründung:** Bayesian-Engine EXISTIERT bereits (server.js:13460) mit `learnPriors=false`. Aktivierung = QUICK-WIN. Würde pro Symbol adaptive Priors lernen aus Trade-Outcomes statt globaler statischer Priors {bull:0.33, bear:0.33, sideways:0.34}.

**Konkrete Implementation-Skizze:**
```js
// server.js: erweitere RiskEngine.bayesian
priors_per_symbol: {},  // NEW: per-symbol state
updatePriors(symbol, observation, actualOutcome) {
  // Smoothed update: η=0.05
  const eta = 0.05;
  if (!this.priors_per_symbol[symbol]) this.priors_per_symbol[symbol] = {...DEFAULT_PRIOR};
  // Move prior toward observed outcome
  this.priors_per_symbol[symbol][actualOutcome] += eta;
  // Renormalize
  const sum = Object.values(this.priors_per_symbol[symbol]).reduce((a,b)=>a+b,0);
  for (const k in this.priors_per_symbol[symbol]) this.priors_per_symbol[symbol][k] /= sum;
  // Persist
  DB.upsertBayesianPriors.run(symbol, JSON.stringify(this.priors_per_symbol[symbol]));
}
```
Trigger nach jedem `trades.closed`-Event.

### 🥉 #3 — M1 Fractional Differentiation (4-8h)
**Begründung:** Kleinster Aufwand, höchste Theorie-Basis. BTC/ETH-Indikatoren überreagieren auf level vs change. fracDiff(d=0.2) macht stationär bei Memory-Erhaltung.

**Konkrete Implementation-Skizze:**
```js
// modules/fractional_diff.js (NEW, ~50 LOC)
function getWeights(d, size) {
  const w = [1.0];
  for (let k = 1; k < size; k++) {
    w.push(w[k-1] * -(d - k + 1) / k);
  }
  return w;
}
function fracDiff(series, d=0.2, thresh=1e-3) {
  const w = getWeights(d, series.length);
  // Cutoff: drop weights below threshold
  const w_cut = w.filter(x => Math.abs(x) > thresh);
  const width = w_cut.length;
  const result = new Array(series.length).fill(NaN);
  for (let i = width; i < series.length; i++) {
    result[i] = w_cut.reduce((sum, wk, k) => sum + wk * series[i-k], 0);
  }
  return result;
}
```
Konsum: vor TREND-Familie raw-prices durch fracDiff-prices ersetzen.

---

## 📋 TOP-3 EMPFEHLUNGEN — Allgemeine Brain-Verbesserung

### 🥇 #1 — M8 CPCV + Deflated Sharpe (2-3 Tage)
**Begründung:** Verhindert dass Block-L NEAR-Whitelist als "Sharpe 16.5"-Backtest-Overfit deployed wird. Liefert echte vs Glücks-Edge-Trennung.

### 🥈 #2 — M5 Asset-Class-spezifische Family-Weights (2-3 Tage)
**Begründung:** Adressiert Block-L-Befund direkt. BTC bekommt MR-Lean, Mid-Caps bleiben Trend-Following. Klein-Refactor.

### 🥉 #3 — M2 CUSUM Event-Driven Sampling (1-2 Tage)
**Begründung:** Reduziert Brain-Compute drastisch (~80% weniger BTC-Decisions) und konzentriert Brain auf echte Events. Verbessert ALLE Symbole, nicht nur Mega-Caps.

---

## Implementation-Roadmap (Impact/Aufwand-Ratio)

| Phase | Methode | Aufwand | Wirkung |
|---|---|---|---|
| **Woche 1 (Quick-Wins)** | M15 Bayesian-Learning | 2-3 Tage | Mega-Cap HOCH |
| | M1 Fractional Diff | 4-8h | Mega-Cap HOCH |
| | M8 CPCV+DSR | 2-3 Tage | Backtest-Sicherheit HOCH |
| **Woche 2-3 (Strukturell)** | M2 CUSUM Sampling | 1-2 Tage | Brain-Compute HOCH |
| | M5 Per-Class Weights | 2-3 Tage | Mega-Cap HOCH |
| | M3 Mean-Reversion StatArb | 3-5 Tage | Mega-Cap SEHR HOCH |
| **Woche 4-6 (Vertiefung)** | M13 FreqAI Per-Symbol-Models | 1 Woche | Mega-Cap+General HOCH |
| | M10 Hash Ribbon On-Chain | 1-2 Tage | BTC-spezifisch |
| | M9 Multi-Faktor-Modeling | 3-4 Tage | Risk-Decomp MITTEL |
| **Monat 2+ (Groß)** | M4 Funding-Rate-Capture | 1-2 Wochen | Mega-Cap HÖCHST (markt-neutral) |
| **NICHT empfohlen jetzt** | M11 Cross-Exchange-Arb | 3-4 Wochen | Komplexität zu hoch |
| | M12 LEAN-Refactor | 4-8 Wochen | Refactor-Risiko |
| | M14 Almgren-Chriss | nur LIVE+AUM | Premature |

## ⚠️ Ehrliche Lücken

| # | Lücke | Severity |
|---|---|---|
| 1 | **Renaissance/Citadel-Algos NICHT public** — Aussagen sind Industry-Best-Practice-Proxy (Avellaneda/Lee, Grinold/Kahn), nicht Renaissance-spezifisch | UNVERMEIDLICH |
| 2 | **Crypto-Faktor-Modell Performance ex-2022** unklar — Liu/Tsyvinski/Wu Datenstand 2018-19. Aktuelle Crypto-Faktor-Stabilität braucht eigene Verifikation | MED |
| 3 | **Mean-Reversion-Edge in Crypto-Mega-Caps** ist nicht garantiert — Equity-Empirik (Sharpe 1.44) bestätigt nicht 1:1 für Crypto. Backtest auf NEXUS-Daten erforderlich | MED |
| 4 | **Funding-Rate-Capture** braucht Bitget-Perpetual-API-Integration, die NEXUS aktuell nicht hat — Aufwand-Schätzung "1-2 Wochen" könnte unterschätzt sein | MED |
| 5 | **Aladdin-internes Setup** komplett UNGEPRÜFT (kein public Whitepaper) — Übersetzungen basieren auf Multi-Faktor-Standard | UNVERMEIDLICH |

## Christian-Entscheidungs-Optionen

**A) Quick-Wins-Sprint (1 Woche):** M15 + M1 + M8 deployen — minimaler Aufwand, hoher Test-Lessons.
**B) Mega-Cap-Fix (2-3 Wochen):** A + M5 + M3 — strukturelle Lösung für Mega-Cap-Anti-Edge.
**C) Markt-Neutral-Pivot (1-2 Monate):** B + M4 — Funding-Capture als neue Strategy-Klasse, drastische Diversifikation weg von Direction-Prediction.
**D) Forschungsphase (passiv):** Beobachten 4-6 Wochen mehr Daten, dann re-evaluieren mit größerem Sample.

**Engineer-Verdikt:** Option A → dann nach 1-2 Wochen Validation Option B.

🔴 LIVE aus · Reserve $3.34 unantastbar · Bot PAPER · **Quant-Research mit Primärquellen + 15 NEXUS-Übersetzungen + 3-Phasen-Roadmap. KEINE Live-Änderung.**
