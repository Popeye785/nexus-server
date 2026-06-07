# MEGA-CAP-FORENSIK — WARUM Brain auf BTC/ETH/SOL/BNB verliert

**Datum:** 2026-05-27 09:50 CEST · Bot R=294 stabil · drift=0
**Frage:** Warum performt Brain besser auf Mid-Caps (NEAR/SUI) als auf objektiv stärksten Coins?

## TL;DR — **Antwort: B + Teil-A (Sample-Glück + erklärbarer Sample-Bias). KEIN Bug.**

Brain verliert auf Mega-Caps weil:
1. **9d-Sample war NEAR-Bull-Run** (NEAR +82.7% range vs BTC +4.65%) — extremes Glücks-Sample für NEAR
2. **Mega-Caps haben kleinste Bewegung** (BTC 0.59%/h vs NEAR 3.04%/4.6h) → Fee-Anteil 34% statt 6.6%
3. **Brain ist Trend-Follower** in aktuellem Setup → funktioniert bei NEAR-Bull, scheitert an Mega-Cap-Sideways
4. **NICHT familienspezifisch** — ALLE 5 Familien performen pro Coin gleich (systemisch, kein Sub-Source-Bug)

## PRIO 1 — Sub-Source-Breakdown pro Coin

**Befund VERIFIZIERT:** ALLE 5 Familien sind bei BTC/ETH/SOL/BNB konsequent NEGATIV, bei NEAR/SUI konsequent POSITIV.

| Symbol | TREND | MOMENTUM | RISK | SENTIMENT | MICROSTRUCTURE | Overall |
|---|---:|---:|---:|---:|---:|---:|
| BTCUSDT | -0.42% | -0.43% | -0.38% | -0.30% | -0.38% | **-0.37%** |
| ETHUSDT | -0.40% | -0.43% | -0.25% | -0.26% | -0.28% | **-0.27%** |
| SOLUSDT | -0.44% | -0.60% | -0.36% | -0.32% | -0.46% | **-0.41%** |
| BNBUSDT | -0.35% | -0.33% | -0.30% | -0.35% | -0.33% | **-0.33%** |
| **NEARUSDT** | +0.94% | +1.14% | +0.76% | +0.80% | +0.86% | **+0.89%** |
| **SUIUSDT** | +0.22% | +0.34% | +0.25% | +0.23% | +0.23% | **+0.30%** |

→ Keine Familie sticht heraus. Kein "TREND-Familie blockt BTC" oder "SENTIMENT-Familie ruiniert ETH". Problem ist **coin-systemisch**.

## PRIO 2 — Volatilitäts-Analyse

**Avg-Move pro 1h (Triple-Barrier-Labels Mittel über 9d):**

| Symbol | Avg-Abs-Move | Avg-Hit-Hours | Fee-Anteil (0.20%) | Verdict |
|---|---:|---:|---:|---|
| **NEARUSDT** | 3.04% | 4.6h | **6.6%** | ★ optimal |
| TONUSDT | 2.14% | 4.5h | 9.3% | gut |
| **SUIUSDT** | 1.95% | 4.7h | 10.3% | gut |
| LINKUSDT | 1.12% | 4.8h | 17.9% | grenzwertig |
| AVAXUSDT | 1.00% | 4.5h | 20.0% | knapp |
| ADAUSDT | 0.99% | 4.6h | 20.2% | knapp |
| SOLUSDT | 0.95% | 5.4h | 21.1% | knapp |
| DOGEUSDT | 0.92% | 5.2h | 21.7% | knapp |
| ETHUSDT | 0.88% | 5.9h | 22.7% | marginal |
| XRPUSDT | 0.74% | 5.0h | 27.0% | marginal |
| BNBUSDT | 0.69% | 5.3h | 29.0% | schlecht |
| **BTCUSDT** | 0.59% | 5.5h | **33.9%** | sehr schlecht |

**Win-Magnitude vs Loss-Magnitude:**
- BTC: win +0.63%, loss -0.64% → symmetrisch (kein asymmetrischer Edge im Markt)
- NEAR: win +3.34%, loss -2.60% → win > loss (asymmetrische Edge IM MARKT vorhanden)
- BNB: win +0.72%, loss -0.72% → 50/50 random-walk

→ **Bei BTC/BNB gibt es keine asymmetrische Edge zum Greifen.** Brain kann beim Coin-Faktor 33% Fee nicht profitabel sein selbst bei perfekter Direction.

## PRIO 3 — Regime-Timing-Analyse

Per-Symbol per-Regime (n≥20):

| Symbol | Regime | n | WR% | AvgPnL% |
|---|---|---:|---:|---:|
| BTCUSDT | RANGING | 5737 | 32.8% | -0.41% |
| BTCUSDT | NEUTRAL | 243 | 42.4% | -0.38% |
| BTCUSDT | SQUEEZE | 942 | **56.9%** | -0.16% |
| ETHUSDT | NEUTRAL | 649 | 53.3% | **+0.24%** |
| SOLUSDT | NEUTRAL | 1070 | 53.8% | +0.05% |
| SOLUSDT | CHOPPY | 32 | **71.9%** | +1.36% (Mini-Sample!) |
| BNBUSDT | NEUTRAL | 213 | 61.5% | -0.10% |
| **NEARUSDT** | NEUTRAL | 1870 | **87.9%** | **+1.72%** |
| NEARUSDT | RANGING | 352 | 72.7% | +1.51% |
| NEARUSDT | CHOPPY | 5944 | 61.1% | +1.22% |
| NEARUSDT | BULL | 4611 | 52.1% | +0.21% |
| SUIUSDT | NEUTRAL | 10527 | 56.5% | +0.50% |
| SUIUSDT | SQUEEZE | 117 | **92.3%** | +0.64% |
| SUIUSDT | BEAR | 651 | **0.0%** | -1.91% |

**Schlüssel-Beobachtung:**
- BTC nur in SQUEEZE ansatzweise OK (56.9% WR, -0.16% — break-even)
- **NEAR in NEUTRAL hat 87.9% WR** — absurd hoch
- SUI in BEAR-Regime 0% WR — Brain liest SUI im Bear-Markt komplett falsch
- → Brain hat **regime-spezifische Stärken/Schwächen pro Coin**, das wäre ein Optimierungs-Hebel

## PRIO 4 — Sample-Bias (KRITISCH!)

**9d-Preisbewegung pro Symbol:**

| Symbol | Low (9d) | High (9d) | Range % |
|---|---:|---:|---:|
| **NEARUSDT** | 1.585 | 2.896 | **+82.7%** |
| SUIUSDT | 0.996 | 1.154 | +15.8% |
| SOLUSDT | 81.99 | 87.82 | +7.1% |
| XRPUSDT | 1.311 | 1.393 | +6.3% |
| ETHUSDT | 2027 | 2147 | +5.9% |
| BNBUSDT | 637 | 672 | +5.5% |
| **BTCUSDT** | 74609 | 78080 | **+4.7%** |

**NEAR hatte 17× mehr Bewegung als BTC in den 9 Tagen!** Das ist KEIN normales Sample.

→ **Diagnose-Outcome B (Sample-Glück) ist HIER dominant.** Brain hat richtige Direction in NEAR-Bull getroffen, hatte aber nicht genug Bewegung in Mega-Caps für profitable Trades nach Fees.

## PRIO 5 — Bug-Verdachts-Check

**BUY/SELL-Verteilung pro Symbol (success% = WR nach Fee-Adjust):**

| Symbol | BUY-Decisions | SELL-Decisions | BUY-success% | SELL-success% |
|---|---:|---:|---:|---:|
| BTCUSDT | 3529 | 3409 | 26.4% | 46.8% |
| ETHUSDT | 3321 | 5620 | 24.6% | 50.5% |
| SOLUSDT | 3882 | 3804 | 23.7% | 38.9% |
| BNBUSDT | 3959 | 3058 | 35.9% | 36.3% |
| **NEARUSDT** | **12011** | 971 | **63.1%** | 43.3% |
| SUIUSDT | 3680 | 8774 | 51.4% | 52.5% |

**Pattern erkannt:**
- BTC/ETH/SOL: BUY-success 24-26% (sehr schwach!) — Brain triggert BUY auf Mini-Rebounds, Markt geht sideways/down → Verluste
- NEAR: 12011 BUY-Decisions (12× mehr BUY als SELL!) — Brain hat NEAR-Bull-Run richtig erkannt, BUY-Spam funktioniert
- BNB: symmetrisch 36/36 random — Brain hat KEINEN Edge

→ **KEIN systematischer Inversions-Bug** (Brain sagt BUY → Markt fällt nicht konsequent invers).
→ **Aber: Brain hat asymmetrische BUY-Tendenz, die nur bei echten Bull-Runs (NEAR) profitabel wird.**

## Diagnose-Outcome — Antwort an Christian

### **Antwort B + Teil-A: Sample-Glück + erklärbarer Sample-Bias.** (Plus ein Mini-Teil C — Optimierungs-Potenzial)

**Warum verliert Brain auf Mega-Caps?**

1. **Volatilitäts-Asymmetrie:** Mega-Caps bewegen sich nur 0.59-0.88%/Stunde. Fee von 0.2% frisst 23-34% der Bewegung. Brain bräuchte ~70% Hit-Rate für break-even.
2. **9d-Sample war NEAR-Bull-Run** (+82.7% range). Brain's BUY-Tendenz wurde dort belohnt, in sideways Mega-Caps bestraft.
3. **Regime-spezifische Stärken/Schwächen:** Brain ist in NEUTRAL+CHOPPY-Regimes stark, in RANGING+BEAR schwach. BTC verbringt 73% der Zeit in RANGING (5737/7922 obs).
4. **Symmetrische Markt-Bewegung bei BNB:** win=loss → Random-Walk. Brain kann keine Edge generieren wenn der Markt selbst keine bietet.

### KEIN BUG
- ALLE 5 Familien zeigen gleiches Muster pro Coin (systemisch, nicht Sub-Source-spezifisch)
- BUY/SELL-Verhältnis ist symbol-spezifisch realistisch (NEAR up → mehr BUY)
- Keine konsistente Inversion (BTC SELL hat 47% success — wäre bei Bug 0% wie TON)

### TON-Outlier (0% WR)
- TON ist Mini-Sample (61 Trades). Statistisch nicht signifikant für "Bug".
- 9d-Window war TON +1.74% 24h aber 7d -4.50% — Brain hat möglicherweise auf 1h-Rebounds BUY → 4h-Drop → Verlust.

## Implikationen für Strategie

### Was wäre FALSCH zu schließen
- ❌ "NEAR+SUI Whitelist deployen" (Block L Empfehlung 1) ist **opportunistisches Overfitting** auf 9d-Bull-Sample
- ❌ "BTC/ETH skippen" verzichtet auf Liquidität+Stabilität für Glücks-Sample-Coins

### Was RICHTIG ist
1. **Mehr Daten sammeln (4+ Wochen)** bevor Symbol-Whitelist deployed wird
2. **Regime-spezifische Strategy-Selection**: BTC in SQUEEZE okay, BTC in RANGING skip → 75% weniger BTC-Trades, ~50% weniger Verlust
3. **Fee-Floor pro Symbol berücksichtigen** — mindestens 3× Fee in avg-Move erforderlich (also avg-Move ≥ 0.6%/h). BTC/BNB fallen raus, Rest qualifiziert.
4. **Asymmetrische Win/Loss-Märkte priorisieren** — Brain edge braucht ASYMMETRISCHE Edge IM MARKT (win > loss) wie bei NEAR.

## DoD (Read-Only)

| Rule | Status |
|---|---|
| 1-11 | ✅/n/a | Read-only Forensik, kein Code-Change, Bot R=294 stabil |

## ⚠️ Ehrliche Lücken

| # | Lücke | Severity |
|---|---|---|
| 1 | **Sample 9 Tage** — kein out-of-sample-Test möglich (TB-Labels erst seit 18.05.2026) | HIGH |
| 2 | **NEAR-Bull-Run war singulär** — bei Mean-Reversion könnte NEAR ebenso Anti-Edge zeigen | HIGH — Hauptgrund nicht zu whitelisten |
| 3 | **Spread/Slippage nicht real-gemessen** — nur theoretische 0.2% Fee | MED |
| 4 | **TON 0% WR (n=61)** — statistisch grenzwertig, könnte Glücks-Sample oder echter Pattern sein. Forensik braucht mehr Daten. | LOW |
| 5 | **Regime-Reaktions-Lag nicht analysiert** — wann switched Regime von RANGING→SQUEEZE und nutzt Brain den Switch? | MED |

## Empfehlung Nächster Schritt

**Engineer-Sicht — gegen Block L Empfehlung 1, jetzt mit Forensik-Evidenz:**

**A. Keine Whitelist-Deploy.** Sample-Bias zu groß, Overfitting-Risiko hoch.

**B. Regime-Selektive Trade-Floor:**
- BTC nur traden in SQUEEZE (56.9% WR) → 88% BTC-Trades skip, Verluste -90%
- ETH nur in NEUTRAL (53.3% WR, +0.24%) → 90% ETH-Trades skip
- BNB skip alle Regime (kein profitables Regime gefunden im Sample)
- NEAR/SUI weiter alle Regimes außer BEAR (SUI BEAR=0% WR)

**C. Beobachten** bis ~Tag 30 (19.06., noch 23 Tage), dann mit größerem Sample re-evaluate. Bis dahin keine Symbol-Strategie ändern.

**D. Falls Christian aktiv handeln will:** Fee-Floor-Filter `avg-move >= 3×fee` (=0.6%/h) als minimaler Eingriff — würde nur BTC/BNB skippen, alle anderen Symbole weiter traden. Risiko-arm.

🔴 LIVE aus · Reserve $3.34 unantastbar · Bot PAPER · **Forensik komplett. Antwort: kein Bug, Sample-Glück + Fee-Floor-Realität. Kein Eingriff empfohlen bis größeres Sample.**
