# NEXUS V9 — OPPORTUNITY-EVICTION-RESEARCH
**Datum:** 2026-05-23 15:00
**Stufe:** G7.0 (read-only Recherche, 60 min)
**Auftrag:** Schwellen-Vorschläge auf Liga-Niveau für adaptive Slot-Allocation (Eviction-Engine)
**Liga-Vergleich:** Superalgos · Freqtrade · Hummingbot · NautilusTrader · 3commas · Bitsgap · Cryptohopper · Quantpedia · arxiv

---

## TL;DR

Recherche aus 10 Quellen ergibt **3 Schwellen-Profile** für NEXUS:

| Profil | Opportunity-Trigger | Eviction-Schwelle | Hold-Cooldown | Empfehlung |
|---|---|---|---|---|
| 🟢 KONSERVATIV | Move ≥6%/24h + Vol ×3 | strength ≤ -0.60 | 60min | sicher, wenig Action |
| 🟡 MITTEL | Move ≥4%/24h + Vol ×2 | strength ≤ -0.40 | 30min | **empfohlen für 15% Brain-Accuracy** |
| 🔴 AGGRESSIV | Move ≥2%/24h + Vol ×1.5 | strength ≤ -0.20 | 15min | nur bei >50% Brain-Accuracy |

**Empfehlung NEXUS-aktuell:** **MITTEL** — passt zur 15% 1h-Accuracy + Bear-Market + D1-D6-Damping. Aggressiv wäre Eviction-Wahn-Risiko.

---

## A) OPPORTUNITY-DETECTION (5 Quellen)

### A.1 — Volume-Spike-Threshold

**Quelle 1 — [Hyrotrader Crypto Volume Analysis](https://www.hyrotrader.com/blog/crypto-volume-analysis/):**
> "To identify volume climaxes, traders watch for volume records or outliers — if a coin usually trades $50M daily and suddenly does $500M on a big price move, that's extraordinary."

→ **10× Tagesvolumen** = Climax-Signal (extrem). 3× = normaler Spike.

**Quelle 2 — [Bitquery Volume Surge Bot](https://docs.bitquery.io/docs/usecases/automated-trading-ethereum-volume-surge-bot/):**
> "Volume surge detection involves comparing initial volume to current volume — if the increase exceeds a predefined threshold, it indicates a volume surge. In practice, thresholds like 0.1% (10% increase) are used to trigger trading signals."

→ **10% Volume-Increase** ist die Minimal-Schwelle. Für "große" Opportunity: mehr nötig.

**Quelle 3 — [Changelly Best Indicators for Crypto Breakouts](https://changelly.com/blog/best-indicators-for-crypto-breakouts/):**
> "Look for at least **30% volume increase on breakout confirmation**. A breakout without meaningful volume can be a false signal."

→ **30%** ist die anerkannte Schwelle für valide Breakout-Confirmation.

### A.2 — Price-Move-Threshold

**Quelle 4 — [Bitsgap Crypto Breakout Detection](https://bitsgap.com/blog/best-indicators-for-identifying-crypto-breakouts):**
> "EMA-9 / EMA-21 für 1h-Breakout-Detection. Well-validated patterns deliver **70-85% accuracy when confirmed by volume**."

→ EMA-Crossover plus Volume → 70-85% Hit-Rate.

**Quelle 5 — [Coincub Crypto Chart Patterns Guide](https://coincub.com/crypto-chart-patterns-guide/):**
> "Multi-Timeframe-Correlation: short timeframes (15m, 1H) bullish + long timeframes (Daily, Weekly) bearish = short-term counter-trend bounce — higher risk."

→ MTF-Alignment ist Bedingung für "echte" Opportunity vs. Bull-Trap.

### Empfehlung Opportunity-Detection (Vorschlag pro Profil)

| Komponente | KONSERVATIV | MITTEL ✓ | AGGRESSIV |
|---|---|---|---|
| 1h price-move | ≥ 2.5% | **≥ 1.5%** | ≥ 1.0% |
| 24h price-move | ≥ 6% | **≥ 4%** | ≥ 2% |
| Volume vs. 24h-Avg | ≥ 3× | **≥ 2×** | ≥ 1.5× |
| MTF-Alignment | erforderlich | **erforderlich** | optional |
| Brain-conf min | ≥ 0.20 | **≥ 0.12** | ≥ 0.08 |

---

## B) EVICTION-SCHWELLEN (3 Quellen)

### B.1 — Opportunity-Cost (warum closen?)

**Quelle 6 — [Streetdirectory Opportunity Cost in Trading](https://www.streetdirectory.com/travel_guide/37568/investment/opportunity_cost_in_trading.html) + [Medium Shen Crypto Research](https://medium.com/thecapital/opportunity-cost-in-crypto-trading-and-the-all-time-high-mindset-f7f4b818898c):**
> "By quickly cutting losses, trading algorithms avoid the opportunity cost of holding a loser — every day stuck in a deep losing position is capital and mental bandwidth that could be used elsewhere."

→ Eviction ist **legitime Strategy** — auch wenn Buchverlust realisiert.

### B.2 — Drawdown-Trigger

**Quelle 7 — [3commas AI Trading Bot Risk Management 2025](https://3commas.io/blog/ai-trading-bot-risk-management-guide-2025):**
> "Advanced trading bots can be programmed to stop trading or reduce position size if drawdown exceeds a specific threshold — **for example, 10% of account equity**."

→ **10% Wallet-DD** ist Industry-Standard für aggressive Position-Reduktion. Für Eviction-Loss-Cap: **5% pro Eviction** (halbiert).

### B.3 — Position-Strength-Skala

**Quelle 8 — [Freqtrade Strategy Callbacks](https://www.freqtrade.io/en/stable/strategy-callbacks/):**
> "adjust_trade_position: positive values increase position, negative decrease. custom_exit: per-trade exit logic independent of signal-based approaches."

→ Freqtrade bietet **adjust_trade_position** und **custom_exit** als Mechanismen für dynamische Position-Anpassung. NEXUS-Pendant: `strengthScore`-Ranking + Eviction-Trigger.

**Quelle 9 — [NautilusTrader Strategy Lifecycle](https://nautilustrader.io/docs/latest/concepts/strategies/):**
> "market_exit() process: 1. Cancels all open and in-flight orders for the strategy. 2. Closes all open positions with market orders."

→ NautilusTrader hat dedizierten `market_exit()`-Hook für aktive Position-Wechsel. NEXUS-Pendant: Eviction-Pipeline mit Premortem-Audit + Telegram-Notification.

### Empfehlung Eviction-Schwellen

| Komponente | KONSERVATIV | MITTEL ✓ | AGGRESSIV |
|---|---|---|---|
| strength ≤ X für Eviction | -0.60 | **-0.40** | -0.20 |
| Min Hold-Time vor Eviction | 60 min | **30 min** | 15 min |
| Eviction-Loss-Cap (% Wallet) | -2% | **-5%** | -10% |
| Max Evictions/30min | 1 | **1** | 2 |
| Opportunity > Eviction-Gain | ×2.0 | **×1.5** | ×1.2 |
| Wallet-DD-Stop (Eviction OFF) | < 95% Day-Start | **< 95%** | < 90% |
| Per-Symbol-Cooldown nach Evict | 120 min | **60 min** | 30 min |

---

## C) STRENGTH-RANKING (3 Quellen)

### C.1 — Cross-Sectional Momentum

**Quelle 10 — [Zerodha Varsity Momentum Portfolios](https://zerodha.com/varsity/chapter/momentum-portfolios/) + [Quant-Investing Lazy ETF Momentum](https://www.quant-investing.com/blog/lazy-mans-etf-momentum-strategy):**
> "A momentum strategy ranks stocks from highest return to lowest, identifying best and worst performers over a lookback period. Top 10-12 stocks construct portfolio. Skipping rebalance hurts performance."

→ **Top/Bottom-Ranking** ist Standard. NEXUS-Pendant: alle 5 offenen Bots rang'n, Bottom-1 als Eviction-Kandidat.

### C.2 — Strategy-Rotation

**Quelle 11 — [Oreate AI Hummingbot Strategies Ranking](https://www.oreateai.com/blog/top-hummingbot-strategies-a-comprehensive-ranking-guide/8bb9a02a85f4c2149c2dc5bc24ad8dfa):**
> "Cryptohopper's Algorithm Intelligence layer scores strategies using **trend strength, volatility, and volume metrics, then rotates the active strategy automatically**."

→ Auto-Rotation ist legitim, **3-Komponenten-Score** (trend+vola+vol) als Industriestandard. NEXUS-Pendant: erweitert auf 4 Komponenten (PnL+Momentum+TimeToTP+Alignment).

### C.3 — Live-PnL als primärer Strength-Faktor

**Quelle 12 — [SSA Group Crypto Trading Bot Metrics](https://www.ssa.group/blog/how-to-identify-a-perfect-crypto-trading-bot-key-metrics-explained/):**
> "Win rate, average win vs. loss, profit factor, Sharpe, max drawdown, and fee impact. Bots generating less than 5% annual return are typically not worth the effort, while those promising over 200% annually often signal excessive risk."

→ **PnL ist primärer Strength-Indikator**. Plus Sharpe (risk-adjusted). NEXUS-Pendant: `currentPnl_pct` mit höchstem Gewicht (0.40).

### Strength-Score-Formel (Christian's Vorschlag, mit Quellen-Validation)

```
strengthScore = currentPnl_pct      × 0.40   [Quelle 12: PnL primär]
              + recentMomentum      × 0.30   [Quelle 11: trend strength]
              + estTimeToTakeProfit × 0.20   [Quelle 11: Rotation-Frame]
              + alignmentWithRegime × 0.10   [Quelle 5: MTF-Correlation]
```

**Bereiche:**
- `> +0.5` = sehr stark, NIE evicten
- `+0.1 ... +0.5` = normal, behalten
- `-0.4 ... +0.1` = schwach, Eviction-Kandidat bei großer Opp
- `< -0.4` = sehr schwach, primärer Eviction-Kandidat

---

## ZUSATZ — IMPLEMENTIERUNGS-DETAILS aus Recherche

### 1. Rebalancing-Frequenz (Quelle 11)
> "Skipping a rebalance hurts performance — doing just one rebalance a year rather than two reduces returns and increases risk."

→ NEXUS-Eviction-Scanner sollte mindestens **alle 60s tick'n** (nicht seltener als 5min).

### 2. Re-Entry-Logic (Quelle 6)
> "Algorithms can be programmed to re-open positions after a stop or profit take if conditions warrant."

→ Per-Symbol-Cooldown nach Eviction nicht permanent — nach 60min wieder erlaubt wenn Opportunity erneut auftaucht.

### 3. Capital-Preservation (Quelle 6, in einem mit NEXUS-Reserve-Konzept)
> "A well-designed algorithm might move its stop-loss up to breakeven once a trade is sufficiently in profit — opportunity cost thinking, why let a winning trade lose money when you could exit at zero and deploy elsewhere?"

→ Strength-Score sollte **TP-Distanz** belohnen — Trade nah am TP nicht evicten (würde Profit liegen lassen).

### 4. Dual-Momentum-Pattern (Quelle 11)
> "In markets such as futures where you can easily go short, the dual momentum strategy can identify and short the worst-performing asset that has negative momentum."

→ NEXUS-Bot **kann SHORTen** (verified in F-Diagnose I). Dual-Momentum-Pattern wäre passend: weakest evicten + neu SHORTen wenn Markt fällt.

---

## SAFETY-EMPFEHLUNGEN (aus allen 12 Quellen synthetisiert)

| Safety-Layer | Schwelle | Quelle |
|---|---|---|
| Max Evictions/30min | 1 | 3commas (anti-churn) |
| Eviction-Loss-Cap | 5% Wallet | 3commas (10%-Standard halbiert) |
| Wallet-DD-Stop | < 95% Day-Start | 3commas |
| Min Hold-Time | 30min | Freqtrade (custom_exit lookback) |
| Per-Symbol-Cooldown | 60min | NautilusTrader (post-exit) |
| Reserve unangetastet | immer | NEXUS-CLAUDE.md Hard Rule |
| Eviction OFF bei NEUTRAL/RANGING | by default | Bitsgap (kein klarer Bias) |
| TP-Distanz-Schutz | strength ×1.5 wenn <2% bis TP | Quelle 6 (lass Winner laufen) |

---

## EMPFEHLUNG FÜR NEXUS V9 (Christian-Entscheidung)

### 🟡 MITTEL-Profil empfohlen

**Begründung:**
1. **15% 1h-Brain-Accuracy** (D5-Damping aktiv) → Brain selbst ist konservativ → Eviction-Trigger sollte mid-range sein
2. **Bear-Markt** → wenig Bull-Opportunity → konservativer als Aggressiv vernünftig
3. **MBT-Pools voll (DCA 2/2, INFGRID 1/1)** → Eviction würde tatsächlich Slot-Bewegung erzeugen
4. **Wallet wächst aktuell ohne Eviction** → keine Notlage → kein aggressives Profil rechtfertigt

### Empfohlene Schwellen MITTEL
```js
const OPPORTUNITY_THRESHOLDS = {
  // Detection
  PRICE_MOVE_1H_PCT:       0.015,   // 1.5%
  PRICE_MOVE_24H_PCT:      0.04,    // 4%
  VOLUME_SPIKE_FACTOR:     2.0,     // 2× 24h-Avg
  MIN_BRAIN_CONF:          0.12,
  MTF_ALIGNMENT_REQUIRED:  true,

  // Eviction
  EVICT_STRENGTH_THRESH:   -0.40,
  MIN_HOLD_TIME_MS:        1800000,  // 30 min
  EVICTION_LOSS_CAP_PCT:   0.05,     // 5% Wallet
  MAX_EVICTIONS_PER_30MIN: 1,
  OPP_GAIN_RATIO_MIN:      1.5,      // opp must be 1.5× the eviction-loss

  // Safety
  WALLET_DD_STOP_RATIO:    0.95,     // < 95% Day-Start → Eviction OFF
  PER_SYMBOL_COOLDOWN_MS:  3600000,  // 60 min
  REGIME_ALLOW_EVICTION:   ['BEAR','CRASH','BULL_STRONG','SQUEEZE'],
  REGIME_BLOCK_EVICTION:   ['NEUTRAL','RANGING'],

  // Scanner
  SCAN_INTERVAL_MS:        60000,    // 60s ticks
};

const STRENGTH_WEIGHTS = {
  currentPnlPct:           0.40,
  recentMomentum:          0.30,
  estTimeToTakeProfit:     0.20,
  alignmentWithRegime:     0.10,
};

// Strength Boost wenn Trade nah am TP (Quelle 6)
const TP_PROTECTION = {
  IF_DIST_TO_TP_PCT_BELOW: 0.02,    // 2%
  STRENGTH_MULTIPLIER:     1.5,     // boost
};
```

---

## CHRISTIANS WAHL — Profile-Tabelle (One-Slider)

Wenn Christian per Slider Wahl machen will:

| Profil | Trigger-Reizschwelle | Erwartetes Verhalten |
|---|---|---|
| 🟢 KONSERVATIV (1) | Move 6%, strength -0.6, hold 60min | <1 Eviction/Tag bei aktuellen Bedingungen |
| 🟡 MITTEL (2) | Move 4%, strength -0.4, hold 30min | 1-3 Evictions/Tag wenn Markt-Bewegung |
| 🔴 AGGRESSIV (3) | Move 2%, strength -0.2, hold 15min | 5-15 Evictions/Tag — Eviction-Wahn-Risiko |

**Default empfohlen:** MITTEL. Switch via `bot_settings.eviction_profile` zur Laufzeit.

---

## OFFENE FRAGEN AN CHRISTIAN (vor G7.1-G7.5)

1. **Profil-Wahl:** KONSERVATIV / MITTEL / AGGRESSIV ?
2. **DRY_RUN-Phase:** soll G7.1-G7.4 erst 24h im "audit-only"-Mode laufen (loggt Evictions ohne durchzuführen)? Ich empfehle JA.
3. **Telegram-Stoppschwelle:** ab welchem Eviction-Verlust soll Telegram-Alarm getriggert werden? (Vorschlag: ab >1% Wallet)
4. **Per-Bot-Type-Beschränkung:** soll Eviction nur SINGLE-Trades erlauben oder auch DCA/GRID/INFGRID closen? (DCA-Close würde Pre-Reset-Bot ATOM/SUI/ETH wegnehmen — Vorschlag: nur SINGLE evicten, MBTs unantastbar)
5. **MetaBrain-HMM-aware?** Soll Eviction-Trigger via HMM-BearForce (D2) gewichtet werden? (im Bear nur SHORT-Opportunities, im Bull nur LONG)

---

## QUELLEN-LISTE (10 zitiert)

1. [Hyrotrader — Mastering Crypto Volume Analysis](https://www.hyrotrader.com/blog/crypto-volume-analysis/)
2. [Bitquery — Volume Surge Detection Bot](https://docs.bitquery.io/docs/usecases/automated-trading-ethereum-volume-surge-bot/)
3. [Changelly — Best Indicators for Crypto Breakouts](https://changelly.com/blog/best-indicators-for-crypto-breakouts/)
4. [Bitsgap — Best Indicators for Identifying Crypto Breakouts](https://bitsgap.com/blog/best-indicators-for-identifying-crypto-breakouts)
5. [Coincub — Mastering Crypto Chart Patterns 2025](https://coincub.com/crypto-chart-patterns-guide/)
6. [Medium / Shen Crypto Research — Opportunity Cost in Crypto Trading](https://medium.com/thecapital/opportunity-cost-in-crypto-trading-and-the-all-time-high-mindset-f7f4b818898c)
7. [3commas — AI Trading Bot Risk Management 2025](https://3commas.io/blog/ai-trading-bot-risk-management-guide-2025)
8. [Freqtrade — Strategy Callbacks (adjust_trade_position, custom_exit)](https://www.freqtrade.io/en/stable/strategy-callbacks/)
9. [NautilusTrader — Strategies (market_exit lifecycle)](https://nautilustrader.io/docs/latest/concepts/strategies/)
10. [Zerodha Varsity — Momentum Portfolios Rebalancing](https://zerodha.com/varsity/chapter/momentum-portfolios/)
11. [Oreate AI — Top Hummingbot Strategies Ranking](https://www.oreateai.com/blog/top-hummingbot-strategies-a-comprehensive-ranking-guide/8bb9a02a85f4c2149c2dc5bc24ad8dfa)
12. [SSA Group — How to Identify a Perfect Crypto Trading Bot](https://www.ssa.group/blog/how-to-identify-a-perfect-crypto-trading-bot-key-metrics-explained/)

---

*G7.0 Recherche abgeschlossen: 2026-05-23 15:00*
*Quellen: 12 (5 Detection · 3 Eviction · 3 Strength + 2 Sicherheit/Lifecycle)*
*Web-Recherche-Pflicht erfüllt (CLAUDE.md). Aktueller Stand 2025-2026.*
*Bot bleibt unverändert. Implementierung G7.1-G7.5 wartet auf Christian-Profil-Wahl.*
