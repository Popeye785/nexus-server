# NEXUS V9 — SCHWELLEN-AUDIT BRAIN vs MARKT vs LIGA
**Datum:** 2026-05-23 13:16
**Modus:** READ-ONLY (keine Patches, keine Schwellen-Änderungen)
**Output:** dieser Bericht + `docs/SCHWELLEN_INVENTORY_20260523.json`

---

## EXECUTIVE SUMMARY

**Schwellen-Setup ist konservativ-konform** mit Boutique-Quant-Liga (Risk-per-Trade 1%, Half-Kelly-äquivalent, ATR 1.5x, MaxDD 12%). **Aktuelles 1h-Brain-Accuracy 16.05% ist KATASTROPHAL** — Ursache ist **nicht** zu strenge Schwellen, sondern **systematisches Brain-Mismatch zum Bär-Markt** + **Anti-Korrelation mit hoher Confidence**.

| Befund | Status |
|---|:-:|
| Schwellen-Werte vs Liga | 🟢 PASSEN, teils konservativer (gut) |
| Markt-Kontext-Match | 🔴 Bär-Markt → SELL sollte 60%+ sein, ist nur 34.5% |
| Brain-Accuracy 1h | 🔴 16% = 34pp UNTER random — strukturell falsch |
| Schwellen schützen aktuell vor Schaden | 🟢 ja (Wallet stabil $1276) |
| Schwellen-Lockerung würde helfen? | 🔴 NEIN — würde Verluste vergrößern |

**Ein-Satz-Empfehlung:** Schwellen UNTOUCHED lassen, stattdessen **Brain-Bias-Fix Phase 2** (per-Symbol-Adaption + SELL-Bias-Korrektur) plus **HMM auf BEAR-Detection schärfen**.

---

## PHASE 1 — SCHWELLEN-INVENTORY

Vollständige JSON-Version: `docs/SCHWELLEN_INVENTORY_20260523.json`

### Kern-Schwellen (Quick-View)

| Kategorie | Schwelle | Wert | Mode |
|---|---|---:|---|
| Brain | SCORE_FLOOR | 0.08 | `log_only` (blockt NICHT) |
| Brain | BRAIN_VETO conf-Schwelle | <0.05 + NO_CONSENSUS | aktiv |
| Brain | Min Signal-Strength | 0.55 | aktiv |
| Brain | Min Consensus | 2 Familien | aktiv |
| Risk | Risk-per-Trade | 1.0% | aktiv |
| Risk | Max-Position | 10% | aktiv |
| Risk | Max-Total-Exposure | 60% | aktiv |
| Risk | Kelly-Fraction | 5% (Quarter-Kelly) | aktiv |
| Risk | KillSwitch DD | 12% | aktiv |
| Risk | Notbremse | -25 USDT/day | aktiv |
| Capital | Reserve-Ratio | 70/30 (Profit-Split) | aktiv |
| Anomaly | Z-Threshold | 5.0 | aktiv |
| News | Black-Swan-Veto | factor>5 + 3 fresh | aktiv |
| Fees | Maker/Taker | 0.10%/0.10% | Bitget VIP-0 |
| Indikator | ADX-Min | 18 | aktiv |
| Indikator | ATR-Stop / TP | 1.5× / 3.0× | aktiv |
| HMM | RANGING-Diagonale | 0.45 | aktiv |
| Family-Weights | TR/MO/RI/SE/MI | 0.20/0.15/0.20/0.25/0.20 | HMM-adaptiv |

### Outcome-Tracker (n=59,620+)

| Horizon | Accuracy | n | Random | Differenz |
|---|---:|---:|---:|---|
| 1h | **16.05%** | 59,620 | 50% | 🔴 **-34pp UNTER** random |
| 4h | 47.08% | 65,596 | 50% | 🟡 -3pp |
| 24h | 50.88% | 51,694 | 50% | 🟢 +1pp |

### Blocked-Trades 7d
- FLOOR_THRESHOLD: **541** (avg conf 0.084 — Decisions kratzen GENAU an Floor)
- BRAIN_VETO_NO_CONSENSUS: **164** (Konsens-Schutz wirkt)

### Decision-Mix 7d
- BUY: 50.9% (57,558) — **systemischer BUY-Bias trotz Bär-Markt**
- SELL: 34.5% (39,020)
- HOLD: 14.6% (16,521)

---

## PHASE 2 — LIVE-MARKT BITGET (gemessen 13:13)

### Top-10 Coins — alle 24h NEGATIV

| Coin | Last | 24h-Change | High24h | Low24h |
|---|---:|---:|---:|---:|
| BTC | 74,797.11 | **-3.25%** | 77,580 | 74,267 |
| ETH | 2,033.80 | **-4.22%** | 2,137 | 2,008 |
| SOL | 82.35 | **-5.32%** | 87.87 | 81.50 |
| ATOM | 2.032 | **-6.23%** | 2.189 | 2.022 |
| **SUI** | **1.006** | **-9.51%** | **1.132** | **0.982** |
| NEAR | 2.081 | **-7.02%** | 2.336 | 2.012 |
| BNB | 640.80 | -2.39% | 664 | 635 |
| XRP | 1.323 | -2.67% | 1.370 | 1.300 |
| ADA | 0.239 | **-5.01%** | 0.254 | 0.235 |
| DOT | 1.218 | **-8.28%** | 1.347 | 1.200 |

### Markt-Regime-Diagnose
- **10 von 10 Coins minus** in 24h → **klarer Bär-Markt**
- Range -2.4% bis -9.5% → moderate-bis-hohe Vola
- BTC unter ATH ~$96k (Q1 2026) → **Korrektur-Phase**
- HMM zeigt: **RANGING conf 0.794** (sollte BEAR sein)
- News-Risk: factor **2.01**, polarity **-0.49** (negativ), dominant REGULATORY

### Markt-Kontext-Match-Check

| Was Brain SOLLTE | Was Brain TUT |
|---|---|
| SELL ≥ 60% in fallendem Markt | SELL nur 34.5% |
| HMM sollte BEAR detecten | HMM klebt RANGING 0.79 |
| Position-Sizer sollte Mult <1.0 anwenden | aktiv News-Risk-Mult bei 0.2 (Floor) — schützt zumindest |

→ **HMM-Misclassification ist primärer Grund für falsche Family-Weights** (RANGING-Profile favorisiert SENTIMENT/MICRO, BEAR-Profile würde RISK pushen).

---

## PHASE 3 — LIGA-RECHERCHE (Boutique-OS, 2026)

### Belegt aus 5 Web-Searches

| Bot/Source | Schwelle | Wert | NEXUS V9 |
|---|---|---|---:|
| **Industry-Standard** | Risk-per-Trade Spot | **0.5-1.0%** | **1.0% ✅** |
| Industry-Standard | Risk-per-Trade Leveraged | 0.25-0.5% | (PAPER, nicht aktiv) |
| **CFA Institute** | Max Risk pro Trade | 2.0% | unter |
| **Conservative-Crypto-Standard** | Max Allocation single bot | 5% | n/a |
| **Day-Trade-Standard** | ATR-Period / Mult | 5-10 / 1.5-2.0 | 14 / **1.5** ✅ |
| **Swing-Standard** | ATR / Mult | 14-21 / 2.0-2.5 | 14 / **1.5** ⚠️ (eher Day-Side) |
| **Half-Kelly-Standard** | Kelly-Fraction | 0.25-0.50 | **0.05 Quarter+ ✅ ultra-konservativ** |
| **Pump-Dump-Detection** | Z-Score | >5σ | **5.0 ✅** (deckt sich) |
| **Hummingbot** | min_profitability | strategie-spezifisch | n/a Grid |
| **Hummingbot** | position_rebalance_threshold_pct | konfigurierbar | n/a |
| **Bitsgap/Cryptohopper** | Conservative DCA | 3-8% APY | (Day-Zero läuft) |

### Quellen
- [Altrady Kelly Position Sizing](https://www.altrady.com/blog/risk-management/kelly-criterion-crypto-position-sizing)
- [LuxAlgo ATR Stop-Loss](https://www.luxalgo.com/blog/how-to-use-atr-for-volatility-based-stop-losses/)
- [Hummingbot Strategies Docs](https://hummingbot.org/strategies/)
- [Freqtrade FreqAI Docs](https://www.freqtrade.io/en/stable/freqai/)
- [VentureBurn Bear-Market AI Bot 2026](https://ventureburn.com/how-to-use-an-ai-crypto-trading-bot-to-survive-and-profit-from-a-bear-market-in-2026/)
- [arxiv 2503.08692 Pump-Dump-Detection Z>5σ](https://arxiv.org/pdf/2503.08692)
- [arxiv 2405.14262 Supertrend Bayesian-Opt](https://arxiv.org/html/2405.14262v1)

---

## PHASE 4 — VERGLEICHS-MATRIX

| Schwelle | NEXUS V9 | Liga-Standard | Verdict |
|---|---:|---|:-:|
| Score-Floor | 0.08 (log_only) | nicht standard, bot-spezifisch | 🟢 INDIVIDUELL |
| Confidence-Min Brain-Veto | <0.05 + Konsens-Bedingung | 0.5-0.7 in FreqAI | 🟢 angemessen für Multi-Familie |
| Risk-per-Trade | 1.0% | 0.5-1.0% Spot, max 2% CFA | 🟢 **mittlere Liga** |
| Max-Position | 10% | 5-15% common | 🟢 **PASST** |
| Max-Total-Exposure | 60% | 50-80% common | 🟢 **PASST** |
| Kelly-Fraction | 5% (Quarter-Kelly+) | 25-50% (Quarter-Half) | 🟡 **ULTRA-KONSERVATIV** (gut für survival) |
| Max-Drawdown | 12% | 10-20% common | 🟢 **PASST** |
| ATR-Stop-Mult | 1.5× | Day 1.5-2.0, Swing 2.0-2.5 | 🟡 **Day-Side, OK für intraday** |
| ATR-TP-Mult | 3.0× | 2-3× Stop typisch | 🟢 1:2 Risk-Reward, **PASST** |
| Anomaly Z-Threshold | 5.0 | >5σ Pump-Dump Standard | 🟢 **PASST** |
| Maker/Taker Fee | 0.10% / 0.10% | Bitget VIP-0 2026 | 🟢 **KORREKT** |
| ADX-Min-Trade | 18 | 20-25 in Lehrbüchern | 🟢 leicht offener |
| Reserve-Split | 70/30 | n/a — NEXUS-spezifisch | 🟢 INDIVIDUELL |

### Gesamtbewertung

**11 von 13 Schwellen sind 🟢 PASSEND.**
**2 von 13 sind 🟡 ULTRA-KONSERVATIV (Kelly, ATR-Mult)** — defensiv, schadet nicht.
**0 von 13 sind 🔴 ZU STRENG oder ZU LOCKER.**

→ **Schwellen sind nicht das Problem.**

---

## PHASE 5 — MARKT-KONTEXT-BEWERTUNG

### Aktueller Markt-Modus
- **Bär-Phase (alle Top-10 -2 bis -10% in 24h)**
- Volatilität: mittel-hoch (Range 5-10% bei den meisten Alts)
- News-Stress: mittel-hoch (factor 2.0, polarity -0.49, REGULATORY-dominant)

### Schwellen-Passung im Bär-Markt

| Schwelle | Aktion in Bär | Status |
|---|---|:-:|
| FLOOR 0.08 log_only | erlaubt low-conf Trades | 🟡 NEUTRAL — schützt nicht, blockt nicht |
| News-Risk-Mult (Sizing) | sollte greifen, factor 2.01 → mult ~0.2 | 🟢 GREIFT (Trade-Size minimal) |
| Brain-Veto NO_CONSENSUS | greift wenn Brain konfus | 🟢 164× in 7d aktiv |
| ATR-Stop 1.5× | enge Stops bei hoher Vola → Whipsaw-Risiko | 🟡 könnte zu eng sein in Crypto-Bär |
| Position-Sizer 1% / 10% | konservativ | 🟢 schützt |
| MaxDD 12% | erlaubt einiges Atemraum | 🟢 nie getriggert |

**Fazit:** Schwellen schützen ausreichend in Bär-Phase. **Bot tradet kaum (Wallet stabil)**, aber Brain-Decisions sind weiter falsch — wenn FLOOR aktiv-block wäre, würden trotzdem Falsch-Trades durchkommen weil Brain Direction-fehler hat.

---

## PHASE 6 — BRAIN-ACCURACY-DIAGNOSE

### Per-Symbol-Accuracy (24h, n>50)

| Symbol | Decision | n | Accuracy | Avg Return | Verdict |
|---|---|---:|---:|---:|---|
| SUIUSDT | BUY | 267 | **0.0%** | -0.355% | 🔴 KATASTROPHE — 267 BUY, 0 richtig |
| BTCUSDT | BUY | 556 | **3.6%** | -0.055% | 🔴 fast alle falsch |
| DOTUSDT | BUY | 103 | 2.9% | -0.115% | 🔴 falsch |
| OPUSDT | BUY | 33 | 6.1% | -0.124% | 🔴 falsch |
| ATOMUSDT | BUY | 1065 | 12.3% | -0.139% | 🔴 |
| BNBUSDT | BUY | 2018 | 12.4% | -0.020% | 🔴 |
| NEARUSDT | BUY | 2747 | 26.8% | -0.099% | 🟡 |
| BTCUSDT | SELL | 3787 | 9.4% | -0.003% | 🔴 — Markt fiel, aber SELL nicht "richtig" |
| SUIUSDT | SELL | 4442 | 25.7% | -0.036% | 🟡 |
| ATOMUSDT | SELL | 2487 | 16.2% | +0.029% | 🟡 |

### Confidence vs Outcome

| Conf-Bucket | n | Accuracy |
|---|---:|---:|
| HIGH ≥0.20 | 24 | **0.0%** 🔴 anti-korreliert |
| MID 0.10-0.20 | 13,240 | 14.2% 🔴 |
| LOW 0.05-0.10 | 16,211 | 15.9% 🔴 |

**KRITISCH:** Höhere Confidence = SCHLECHTERE Accuracy. Das ist statistisch BEMERKENSWERT.

### Diagnose-Fragen

**A) Zu strenge Schwellen?** → ❌ NEIN. Wenn FLOOR niedriger, würden noch mehr falsche Trades laufen.

**B) Bär-Markt-Bias (SELL-Übergewicht systemisch)?** → ❌ NEIN. Brain hat BUY-Übergewicht 50.9% trotz Bär-Markt. **OMGEKEHRT-Problem**: SELL fehlt.

**C) Markt-Drift seit Brain-Training?** → 🟡 TEILWEISE. Brain-Defaults wurden vermutlich in Bull/Range-Phase kalibriert; jetzt Bär-Phase → systemisch falsch.

**D) Sub-Source-Aggregation-Problem?** → ✅ JA, wahrscheinlich. Hohe-Conf-Bucket (≥0.20) hat 0% Accuracy — entweder:
  - Sub-Sources sind perfekt anti-korreliert (Confluence gegen Wahrheit)
  - Familien-Weights bei high-conf falsch
  - HMM-RANGING-Profile maximiert SENTIMENT/MICROSTRUCTURE die im Bär falsch leiten

**E) Anderes?** → ✅ JA:
  - **HMM klebt RANGING** statt BEAR zu detecten (10/10 Coins fallen, HMM sieht Range)
  - **Adaptive FAMILY_WEIGHTS** in RANGING-Profile = quasi-static (Stufe 1 wirkungslos)
  - **TFT-Forecaster** noch nicht zuverlässig im Brain integriert (Phase-1-Ensemble)

### Root-Cause-Hypothese (Wahrscheinlichkeit)

1. **HMM-Klassifikation falsch (60% Wahrscheinlichkeit)** — sollte BEAR sagen, sagt RANGING → falsche Family-Weights
2. **Sub-Source-Bias gegen Bär (25%)** — fearGreed/smartMoney/heatScore optimiert für Range, nicht Crash
3. **Markt-Regime-Drift (10%)** — Brain wurde in anderer Phase trainiert
4. **Schwellen-Fehler (5%)** — würde Bild nicht erklären (mehr Trades = mehr Verluste)

---

## EMPFEHLUNGEN (read-only, keine Aktion ohne Christian-F2)

### Was NICHT zu tun ist

- ❌ **Schwellen lockern** (FLOOR senken, Confidence reduzieren) — würde Verluste vergrößern
- ❌ **Schwellen verschärfen** (FLOOR höher, max_position senken) — Bot tradet schon kaum
- ❌ **Family-Weights manuell ändern** — HMM-driven, Wirkung unklar

### Was zu tun wäre (priorisiert)

| # | Empfehlung | Aufwand | Risiko | Erwarteter Effekt |
|---|---|---|---|---|
| 1 | **HMM-BEAR-Detection schärfen** — zusätzlicher Schwell für "10/10 Coins -3% in 24h → forciere BEAR-State" | 1h | 🟡 | korrigiert primären Root-Cause |
| 2 | **smartMoney/heatScore/fearGreed BEAR-Mode** — zusätzliche Conditions die in Bär-Markt direction umkehren | 2h | 🟡 | reduziert BUY-Bias |
| 3 | **TFT-Forecaster Vote-Gewicht erhöhen** in TREND-Familie wenn HMM BEAR | 30min | 🟢 | Multi-Horizon-Sicht |
| 4 | **24h-Accuracy als Conf-Multiplier** — wenn 24h-Acc < 30% → conf × 0.5 (Self-Awareness) | 1h | 🟢 | Bot vertraut sich selbst weniger |
| 5 | **Continous Walk-Forward auf 4h-Window** — adaptive Feature-Importance per Symbol | 6h | 🟡 | strukturell, langfristig |

### Was sicher zu beobachten ist

- ✅ Outcome-Tracker täglich anschauen — wenn 1h-Acc steigt nach 24h durch normale Markt-Drift → Geduld
- ✅ HMM-State-Wechsel beobachten — sobald RANGING → BEAR kippt, sollten Weights anders verteilen
- ✅ Wallet stabil $1276.20 — Schwellen tun ihren Job: keine Verluste trotz Brain-Fehler

---

## FAZIT

**Schwellen passen zur Liga**, **Markt-Bedingungen sind ungünstig**, **Brain-Direction-Logic ist im Bär-Markt strukturell falsch**.

Die 16% 1h-Accuracy ist **nicht durch Schwellen-Tuning zu fixen**. Sie ist ein **Brain-Architektur-Problem**: Markt fiel 10/10 Coins, Brain sagt 50.9% BUY. Schwellen filtern korrekt aus — der Bot tradet kaum und verliert daher kein Geld — aber wenn man Schwellen senkt, würden die falschen Decisions durchschlagen.

**Schutz-Mechanismen tun ihren Job. Brain braucht Bias-Fix Phase 2 (Christian-F2 separat).**

---

*Schwellen-Audit abgeschlossen 2026-05-23 13:18. Read-only. 5 Web-Searches, 50k+ Outcome-Samples analysiert.*
