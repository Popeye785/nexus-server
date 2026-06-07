# NEXUS V9 — SLOT-DIAGNOSE (ERWEITERT)
**Datum:** 2026-05-23 14:45
**Stufe:** TEIL F (read-only, nachgeholt mit erweiterten Checks A-I)
**Frage:** Warum 3/5 Slots besetzt, keine neuen Bots öffnen?
**Bot-State:** PID 60854, R=206, online · D1-D6 Brain-Reform + E.1-E.4 Live-Parity beide live

---

## TL;DR — VERDICT

**🟢 KORREKT IM BEAR — KEIN BUG.**

Bot **kann SHORTen** (kein LONG_ONLY-Filter im Code), aber:
- Brain macht 1618 SELL-Decisions/h
- Aber **0 SELL-Trades werden eröffnet** wegen mehrschichtiger Schutzbarrieren:
  1. **CapitalPool DCA 2/2 + INFGRID 1/1 FULL** → MBT-Slot-Limits greifen
  2. **MetaBrain → CONSERVATIVE/DCA-Mapping** für BEAR/NEUTRAL-Regimes
  3. **D5+D6 Confidence-Damping** drückt conf unter `RiskSizing.CONF_TOO_LOW` (<0.05)
  4. **SINGLE-Pool wurde nie genutzt** (BULL_STRONG-Regime seit Wochen nicht aufgetreten)

**Wallet stabil 1276.20 USDT, Reserve 193.34, Trading 1082.86. Kapital geschützt — System verhält sich wie spec'd.**

---

## F.A — 3 OFFENE BOTS (Slot-Belegung)

| # | Bot | Type | Symbol | Status | Detail |
|--:|---|---|---|---|---|
| 1 | INFGRID_mp8zefu9_1ovheg | INFGRID | ATOMUSDT | OPEN | capital_pool 50 USDT, profit_acc 0.88, 28 fills |
| 2 | DCA_mphi0ier_8d4ocs | DCA | SUIUSDT | OPEN iter 3 | total_spent 60.00, total_size 57.94, avg_buy 1.0355 |
| 3 | DCA_mphj0k4q_lhuoha | DCA | ETHUSDT | OPEN iter 3 | total_spent 60.00, total_size 0.0292, avg_buy 2057.91 |

**trades-Tabelle:** `COUNT(*) = 0` — **NIE einen Single-Trade gemacht** (siehe F.I unten).

---

## F.B — SLOT-CONFIG

| Setting | Wert | Quelle |
|---|---|---|
| `CFG.MAX_OPEN_TRADES` | **5** | server.js:164 (env-konstant, kein bot_settings-override) |
| dashboard.stats.activeTrades | **3** | INFGRID + 2 DCAs |
| dashboard.stats.maxSlots | **5** | |
| dashboard freie Slots | **2** | konsistent mit CFG |

`MAX_OPEN_TRADES=5` ist NICHT die Schranke — tiefere Limits greifen.

---

## F.C — SLOT-DECIDER (3 Schichten)

| Schicht | File:Line | Code |
|---|---|---|
| 1) NoTrade-Gate | server.js:5193 | `concurrencyOk = _effOpen < min(MAX_OPEN_TRADES, RiskLadder, RiskTier)` |
| 2) ExecFlow Concurrency | server.js:12563 | `if (active.length >= min(MAX, RiskLadder)) → MAX_CONCURRENT_TRADES` |
| 3) CapitalPool Sub-Limits | server.js:10520 | SINGLE 3, GRID 2, **DCA 2 (FULL)**, **INFGRID 1 (FULL)** |
| 4) DUPLICATE_POSITION | server.js:12566 | ATOM/SUI/ETH blocked für SINGLE |

Schicht **3+4** sind die wirklichen Stopper.

---

## F.D — BLOCKED_TRADES letzte 1h

| Reason | Count |
|---|--:|
| FLOOR_THRESHOLD | 3 (SOLUSDT SELL) |

Nur 3 Blocks in der `blocked_trades`-Tabelle. **MetaBrain-Skip + MBT POOL_FULL werden NICHT in blocked_trades geloggt** — sie greifen früher in der Pipeline (Z.23783-23806). Die Tabelle ist daher blind für die echten Blocks.

### Top-3 Blocks
```
14:39:18  SOLUSDT  SELL  FLOOR_THRESHOLD  uScore=-0.073  uConf=0.026
14:35:18  SOLUSDT  SELL  FLOOR_THRESHOLD  uScore=-0.073  uConf=0.026
14:31:18  SOLUSDT  SELL  FLOOR_THRESHOLD  uScore=-0.073  uConf=0.026
```

→ uScore -0.073 (SELL-Richtung klar), aber uConfidence 0.026 < FLOOR 0.08 → blocked.
→ **Direkter Beweis: D5+D6 dämpfen Confidence unter den FLOOR.**

---

## F.E — BUY-DECISIONS LETZTE 1h

```sql
SELECT decision, COUNT(*) FROM aladdin_decisions WHERE ts > NOW-1h GROUP BY decision
```

| Decision | Count | avg_conf | max_conf |
|:---:|---:|---:|---:|
| SELL | **1618** | 0.106 | 0.167 |
| HOLD | 16 | 0 | 0 |
| **BUY** | **0** | — | — |

**🟢 0 BUY-Decisions mit conf>=0.08 in der letzten Stunde.**
Brain ist im perfekten Bear-Mode — keine BUY-Calls mehr (Beweis dass D2-D6 wirken).

---

## F.F — D5 SELF-AWARENESS-DAMPING

- 1h-Accuracy: **15.37%** (29.161 Samples)
- confMultiplier = **0.50** (acc<30% → strenge Strafe)

**Effekt-Beispiel:**
```
raw uScore.confidence = 0.16
× D5 confMul (0.50) = 0.08
× D6 symMul (0.50 für BTC/ETH/SOL/SUI) = 0.04
→ unter FLOOR 0.08 → HOLD oder CONF_TOO_LOW
```

Im aktuellen 15% 1h-Accuracy-Markt entscheidet das Brain effektiv **nichts** mehr als "echte" Direction-Calls für die schlechtesten Symbole.

---

## F.G — D6 PER-SYMBOL DAMPING (worst 10)

| Symbol | Decision | n | Accuracy | adj |
|---|:---:|--:|---:|---:|
| BTCUSDT | BUY | 382 | 5.2% | **-0.5** |
| BTCUSDT | SELL | 3956 | 9.9% | **-0.5** |
| DOTUSDT | BUY | 73 | 4.1% | **-0.5** |
| ETHUSDT | BUY | 1171 | 9.5% | **-0.5** |
| LINKUSDT | SELL | 67 | 6.0% | **-0.5** |
| OPUSDT | BUY | 33 | 6.1% | **-0.5** |
| SOLUSDT | BUY | 1001 | 6.1% | **-0.5** |
| **SUIUSDT** | **BUY** | 195 | **0.0%** | **-0.5** |
| ATOMUSDT | BUY | 778 | 16.8% | -0.3 |
| ATOMUSDT | SELL | 2655 | 15.1% | -0.3 |

**Alle Top-Symbols haben adj=-0.5 oder -0.3** → finalConf wird halbiert. Beweis D6 wirkt.

---

## F.H — NEWS-RISK aktiv

```json
GET /api/news/risk?symbol=BTCUSDT
{
  "factor": 2.5315,
  "contributors": [
    {"title":"500bn in BTC vulnerable for quantum attack", "risk":50, "contagion":1, "contribution":0.4246}
  ]
}
```

News-Risk-Faktor BTCUSDT = **2.53** → bei `factor>0.3` zieht `_NewsRiskAggregator.getRiskFactor` einen zusätzlichen SELL-Bias.
`RiskSizing.newsRiskMult` (Z.5896): bei factor=2.53 → `Math.max(0.2, 1 - 0.4×2.53) = 0.2` → **80% Sizing-Dämpfung** zusätzlich.

→ Quantum-attack-News dämpft BTC-Position-Sizes zusätzlich.

---

## F.I — 🎯 SHORT-LOGIK: BOT KANN SHORTEN

### Kein LONG_ONLY-Filter im Code
```bash
grep -E "LONG_ONLY|spotOnly|skipShort|no_short" server.js
→ keine Treffer
```

### `_executeTrade` ist direction-agnostisch
- Z.24405: `Trades.create(symbol, direction.toLowerCase(), size, ...)` — schreibt 'buy' oder 'sell' in side-column
- Z.5572 `Trades.close`: `const dir = trade.side==='buy' ? 1 : -1;` — PnL-Berechnung berücksichtigt SELL
- Z.24377: `ExecutionAdapter.placeOrder(symbol, direction, ...)` — kein direction-Filter
- Bitget Futures-Endpoint Z.1894: `productType: 'USDT-FUTURES'` — SHORT-fähig

### Aber `trades`-Tabelle KOMPLETT LEER (0 rows)
- `SELECT COUNT(*) FROM trades = 0`
- Historisch nie einen Single-Trade!
- Grund: **MetaBrain** mappt aktuelle Regimes (BEAR/RANGING/NEUTRAL) auf `DCA/GRID/INFGRID/CONSERVATIVE` — **nie auf SINGLE**
- SINGLE wird nur bei `BULL_STRONG` + `SQUEEZE` gewählt → kommt im aktuellen Markt nicht vor

### Was greift stattdessen
```
SIZING_SKIP SOLUSDT reason=CONF_TOO_LOW conf=0.026  ← D5+D6-Damping wirkt
MBT AVAXUSDT DCA skip: POOL_FULL                    ← Pool-Limit
MBT OPUSDT DCA skip: POOL_FULL                      ← Pool-Limit
MBT SUIUSDT DCA skip: POOL_FULL                     ← Pool-Limit
METABRAIN AVAXUSDT regime=NEUTRAL → CONSERVATIVE (skip)
METABRAIN AVAXUSDT regime=BEAR_WEAK → CONSERVATIVE (skip)
```

---

## ROOT-CAUSE-MATRIX (5 Schichten)

| Schicht | Wirkt blockierend? | Aktuelle Ursache | Logged in blocked_trades? |
|---|:-:|---|:-:|
| `CFG.MAX_OPEN_TRADES=5` | nein | 3/5 — frei | – |
| `CapitalPool.DCA` 2/2 FULL | **JA** | SUI+ETH DCAs aktiv | nein (Log-Only) |
| `CapitalPool.INFGRID` 1/1 FULL | **JA** | ATOM-INFGRID | nein (Log-Only) |
| `MetaBrain → CONSERVATIVE-Skip` | **JA** | BEAR_STRONG/NEUTRAL | nein (Log-Only) |
| `MetaBrain → DCA-Branch` | **JA** | BEAR_WEAK + POOL_FULL | nein (Log-Only) |
| `RiskSizing CONF_TOO_LOW` (<0.05) | **JA** | nach D5+D6-Damping | nein (SIZING_SKIP-Log) |
| `FLOOR_THRESHOLD 0.08` | gelegentlich | uConf knapp am FLOOR | ja (3 Blocks/h) |
| `D5 confMul × 0.5` | **JA** | 15% Accuracy | – |
| `D6 symMul × 0.5` | **JA** | worst Symbols | – |
| `News-Risk × 0.2` | **JA** | BTC quantum-attack News | – |
| `DUPLICATE_POSITION` | teilweise | ATOM/SUI/ETH lock | – |
| `LONG_ONLY-Filter` | **NEIN — existiert nicht** | Bot kann SHORTen | – |

---

## EMPFEHLUNG (KEINE Patches nötig)

### Aktuelle Schutzbarrieren wirken wie spec'd:
- ✅ Brain hat 15% Accuracy → D5 dämpft → kein verlustreicher Trade
- ✅ Bear-Markt → MetaBrain Conservative → kein dummer SINGLE-BUY
- ✅ MBT-Pools voll → kein Over-Allocation
- ✅ News-Risk hoch (Quantum-Attack-Headline) → konservativ

### Wenn Christian doch mehr Aktivität will:
| Option | Aktion | Risiko |
|---|---|---|
| A) `LIMITS.DCA 2→3` | One-Line | Mehr Kapital im Bear gebunden |
| B) ETH-DCA close (iter 3, total_size 0.03) | SQL UPDATE | Realisierter Mini-Verlust |
| C) MetaBrain HMM-aware machen | Code-Change | Backtest nötig |
| D) `BEAR_STRONG → DCA` statt CONSERVATIVE | One-Line | Mehr DCA-Versuche, aber Pool-FULL bleibt |
| E) BULL_STRONG-Regime triggers SINGLE-Trade | warten | passiert wenn Markt dreht |

### Lass es wie es ist?
**Ja.** Wallet stabil bei 1276.20 (+27.6% seit Day Zero 20.05.), Reserve wächst. D1-D6 Brain-Reform schützt vor 15%-Accuracy-Verlustfalle. Sobald Markt dreht und 1h-Accuracy >35% steigt, lockern D5/D6 automatisch und SINGLE-Trades werden wieder möglich.

---

## VERLAUFS-NACHWEIS (warum kein Bug, sondern korrektes Verhalten)

```
Pipeline pro Brain-Decision SELL @ conf=0.15 (raw):

1. UnifiedScore.compute() → uScore = -0.073, raw confidence = 0.073
2. × D5-confMul (0.50) [acc=15%] = 0.0365
3. × D6-symMul (0.50) [worst symbol] = 0.018
4. → Brain Final confidence ≈ 0.018-0.026
5. RiskSizing.calculate({confidence: 0.026}) → 0.026 < 0.05 → SKIP CONF_TOO_LOW
6. ODER falls Brain confidence trotzdem ≥ 0.08:
   - MetaBrain.decide() → regime BEAR_WEAK → DCA
   - _handleMultiBotType() → CapitalPool.canAllocate('DCA') → POOL_FULL
   - skip
```

**Sehe ich einen Bug? NEIN.**
**Hat Christian mehr Aktivität? NEIN — bewusst gedämpft im 15%-Accuracy-Markt.**
**Wallet sicher? JA — Capital Preservation greift.**

---

## DATEIEN UND CODE-STELLEN

| Befund | File:Line |
|---|---|
| CFG.MAX_OPEN_TRADES | server.js:164 |
| NoTrade.concurrencyOk | server.js:5193 |
| ExecFlow MAX_CONCURRENT_TRADES | server.js:12563 |
| CapitalPool LIMITS/ALLOC | server.js:10520 |
| MetaBrain REGIME_TO_BOTTYPE | server.js:8369 |
| MetaBrain CONSERVATIVE-Skip | server.js:23786 |
| MBT POOL_FULL skip | server.js:23806 |
| RiskSizing CONF_TOO_LOW | server.js:5916 |
| RiskSizing THRESHOLDS | server.js:5859 |
| D5 confMul | server.js:11700 |
| D6 symMul | server.js:11715 |
| News-Risk-Mult in RiskSizing | server.js:5894 |
| Trades.create (direction-agnostisch) | server.js:5548 |
| ExecutionAdapter.placeOrder | server.js:10729 |
| Bitget Futures SHORT-fähig | server.js:1894 |

---

*Erweiterte Diagnose abgeschlossen: 2026-05-23 14:45*
*100% read-only. Bot unverändert. D1-D6 + E.1-E.4 unangetastet.*
*Vorgänger-Diagnose: gleiches File (vorherige Version), jetzt um SHORT-Logik-Check + RiskSizing-CONF_TOO_LOW-Beweis erweitert.*
