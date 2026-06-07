# NEXUS V9 — MULTI-REGIME-ARCHITEKTUR-AUDIT
**Datum:** 2026-05-23 19:00
**Stufe:** G0 (read-only, KRITISCHE Vorab-Klärung)
**Auftrag:** Architektur-Klärung vor G1-G6 (Spot vs Futures, SHORT-Pfad, Routing-Matrix, Lücken)

---

## TL;DR — GUT NACHRICHT 🟢

**SHORT-Pfad IST komplett code-ready im DEMO-Modus.**
**Keine Futures-Integration nötig für G1-G6 PAPER-Mode-Tests.**
**Real-Bug ist MetaBrain-Routing-Matrix, NICHT SHORT-Fähigkeit.**

| Befund | Status |
|---|:-:|
| Bitget-Endpoint Spot | ✓ implementiert (`placeSportOrder`) |
| Bitget-Endpoint Futures | ✓ implementiert (`placeFuturesOrder` mit `holdSide`) |
| AdaptiveSLTP SHORT-aware | ✅ (`side==='buy'?1:-1`) |
| Trades.close SHORT-aware | ✅ (`trade.side==='buy'?1:-1`) |
| PnL-Berechnung SHORT-aware | ✅ Z.9976 |
| DemoEngine SHORT-Open | ✅ (`direction.toLowerCase()` → 'sell' in trades.side) |
| **MetaBrain BEAR → SHORT-Routing** | ❌ **FEHLT** — mapped BEAR auf CONSERVATIVE/DCA (LONG-only) |
| **HMM-States CRASH/RECOVERY** | ❌ **fehlt in MetaBrain-Mapping** |
| **G1-G6 PAPER-fähig ohne Futures** | ✅ **JA** |

→ **G1-G6 können sofort weiter** ohne Christian-Pause für Spot/Futures-Frage.
→ **Für LIVE-Switch** (Phase E.5+) wäre Christian-Entscheidung Spot/Futures nötig — aber das ist nicht jetzt.

---

## G0.1 — SPOT vs FUTURES

### Aktueller Stand
- **DEPLOY_MODE = PAPER** (env-default) → DemoEngine simuliert beide
- **API-Keys in .env:** BITGET_API_KEY/SECRET/PASSPHRASE — Bitget-Spot-Account vorhanden
- **Bitget-Endpoints BEIDE implementiert:**

| Methode | Endpoint | Verwendung |
|---|---|---|
| `placeSportOrder` | `/api/v2/spot/trade/place-order` | Aktiver Default (Z.10941) |
| `placeFuturesOrder` | `/api/v2/mix/order/place-order` | bereits mit `holdSide='long'/'short'` (Z.1883) |
| `closeFuturesPosition` | `/api/v2/mix/order/place-order` | Z.1907 mit `holdSide` |
| `setLeverage` | `/api/v2/mix/account/set-leverage` | Z.1875 |

### Live-Pfad (wenn DEPLOY_MODE='LIVE')
```
DemoEngine._executeTrade → ExecutionAdapter.placeOrder → _liveFill
                                                          ↓
                                              Bitget.placeSportOrder (aktuell)
                                              [oder placeFuturesOrder falls Code-Switch]
```

**Konsequenz:**
- **PAPER:** Bot kann SHORT (DemoEngine simuliert)
- **LIVE-Spot:** Bot kann NICHT SHORT (Spot hat keinen Short-Modus, nur 'buy'/'sell' = Coin-Tausch)
- **LIVE-Futures:** Bot kann SHORT (placeFuturesOrder mit `holdSide='short'`)

### Entscheidungsbedarf
🟡 **Für PAPER (jetzt):** keine Frage — alles funktioniert.
🟡 **Für LIVE:** Christian entscheidet später Spot vs Futures.

---

## G0.2 — SHORT-Fähigkeit Code-Verifikation

### Was schon SHORT-aware ist (DEMO-Pfad komplett)

| Code-Stelle | Status |
|---|---|
| `DemoEngine._executeTrade(symbol, direction, ...)` Z.24223 | direction-agnostisch, ruft `direction.toLowerCase()` |
| `Trades.create(symbol, side, ...)` Z.5548 | schreibt 'buy' oder 'sell' in side-column |
| `Trades.close` PnL Z.5585 | `dir = side==='buy'?1:-1` — korrekt |
| `AdaptiveSLTP.calculate(candles, entryPrice, side)` Z.22406 | `side==='buy'?1:-1`, BEAR-Profile mit weiterem SL |
| ExitEngine PnL-Berechnung | sideLC-aware (Z.5318/5356/9976) |
| `ExecutionAdapter._simulateFill` | direction-agnostisch (DEMO macht beide) |

### Was im DEMO nicht funktioniert (aber irrelevant da PAPER)
- Spot-LIVE-Trade `Bitget.placeSportOrder(symbol, 'sell', size)` würde "Coin verkaufen" = LONG-Close, NICHT Short-Open
- Aber: PAPER nutzt `_simulateFill`, also irrelevant für PAPER-Tests

**Verdict:** DEMO-Pfad SHORT-fähig ohne Code-Änderung. Für LIVE-Futures-Switch wäre `ExecutionAdapter._liveFill` Z.10880 anzupassen (placeSportOrder → placeFuturesOrder mit holdSide).

---

## G0.3 — MetaBrain-Routing-Matrix (IST-Zustand)

### REGIME_TO_BOTTYPE (server.js:8369)
| Klassisches Regime | botType | Strategy | Direction-Default |
|---|---|---|---|
| BULL_STRONG | SINGLE | BREAKOUT_HUNT | LONG |
| BULL_WEAK | INFGRID | TREND_FOLLOW | NEUTRAL |
| NEUTRAL | CONSERVATIVE | CONSERVATIVE | skip |
| RANGING | GRID | MEAN_REVERT | NEUTRAL |
| SQUEEZE | SINGLE | BREAKOUT_HUNT | LONG-bias |
| BEAR_WEAK | DCA | CONSERVATIVE | **LONG-ONLY** ❌ |
| BEAR_STRONG | CONSERVATIVE | CONSERVATIVE | skip |
| EXTREME_VOL | CONSERVATIVE | CONSERVATIVE | skip |
| **CRASH** | **— FEHLT** | — | — |
| **RECOVERY** | **— FEHLT** | — | — |

### Engine-Capability-Matrix
| BotType | LONG | SHORT | Direction-Mode |
|---|:-:|:-:|---|
| SINGLE | ✅ | ✅ technisch | nutzt Brain-direction (BUY=LONG, SELL=SHORT in DEMO) |
| GRID | range-bound | range-bound | market-neutral, kein direction-bias |
| INFGRID | trailing range | trailing range | market-neutral |
| DCA | ✅ | ❌ | **LONG-ONLY by design** (akkumulieren bei Preis-Fall) |

### KRITISCHE LÜCKE
- **MetaBrain mapped BEAR→DCA→LONG**, aber Brain entscheidet SELL im Bear
- → MetaBrain ruft `DCA.create(...)` was LONG-Buys macht **gegen** die Brain-Decision
- → Bot kauft LONG während Markt fällt → Verlust-Akkumulation
- **HMM-States (CRASH/RECOVERY) sind in MetaBrain-Mapping ABWESEND**

---

## G0.4 — LÜCKEN-ANALYSE pro Phase

### BULL-Mode
- **Status:** ✅ vorhanden (BULL_STRONG→SINGLE+BREAKOUT_HUNT)
- **Lücken:** Brain-Decision-BUY wird durch D5+D6 (15% Accuracy) gedämpft → SINGLE-Pool bleibt leer
- **Lösung G2:** HMM-BullForce-Spiegel + D5 nutzt jetzt 4h-Accuracy (51%) → Damping ist im Bull weniger streng

### SHORT-Mode (BEAR)
- **Status:** ⚠️ teil-implementiert (SINGLE kann SHORT, aber MetaBrain routet nicht hin)
- **Lücken:** REGIME_TO_BOTTYPE.BEAR_WEAK = DCA (LONG-only) statt SINGLE+SELL
- **Lösung G1:** Routing-Regel `BEAR_STRONG/BEAR_WEAK + Brain.direction='SELL' + conf>=0.12 → SINGLE+SELL` einbauen
- **KEIN Futures nötig im PAPER** — DemoEngine simuliert SHORT korrekt

### CRASH-Mode
- **Status:** ❌ nicht implementiert
- **Lücken:** REGIME_TO_BOTTYPE hat keinen CRASH-Eintrag; keine Auto-Close-LONG-Logik; kein Buy-Dip-Trigger
- **Lösung G3:** CRASH-Detection in HMM existiert → MetaBrain-Mapping erweitern + DemoEngine.crashAction-Pipeline

### RECOVERY-Mode
- **Status:** ❌ nicht implementiert
- **Lücken:** wie CRASH; keine aggressive DCA-Buy-Logik
- **Lösung G4:** spiegelbild G3 mit umgekehrtem Bias

### SQUEEZE-Mode
- **Status:** ⚠️ erkannt aber keine spezielle Logik
- **REGIME_TO_BOTTYPE.SQUEEZE=SINGLE+BREAKOUT_HUNT** — passend
- **Lücken:** Setup-Pending-Mechanismus (warten auf Breakout) fehlt; aktuell wird einfach SINGLE versucht
- **Lösung G5:** Bollinger-Squeeze-Watcher mit Breakout-Trigger

---

## G0.5 — EMPFEHLUNG FÜR G1-G6

### 🟢 SOFORT WEITER OHNE STOPP

Begründung:
1. **DEMO-Pfad SHORT-fähig** — keine Futures-Integration nötig für PAPER-Tests
2. **MetaBrain-Routing-Fix** ist Code-Änderung in 1 Datei (server.js:8369-8416)
3. **Wallet bleibt 1276.20 sicher** während aller Tests im PAPER
4. **LIVE-Switch ist separate Phase** (E.5/E.6+) — nicht jetzt

### Pipeline-Anpassung G1-G6

| Stufe | Originalplan | Audit-Anpassung |
|---|---|---|
| G1 SHORT-SINGLE im BEAR | "wenn Futures" | **MetaBrain.REGIME_TO_BOTTYPE.BEAR_WEAK/STRONG → SINGLE bei brainConf>=0.12** + DemoEngine-Direction-Pass-Through. KEINE Futures-Integration nötig. |
| G2 LONG-SINGLE im BULL | HMM-BullForce + Sub-Source-Bull | wie spec'd |
| G3 CRASH-Mode | komplett neu | MetaBrain.REGIME_TO_BOTTYPE.CRASH=SINGLE+SHORT, plus Auto-Close-LONG-Pipeline |
| G4 RECOVERY-Mode | komplett neu | MetaBrain.REGIME_TO_BOTTYPE.RECOVERY=SINGLE+LONG +aggressives DCA-Sizing |
| G5 SQUEEZE-Mode | spec'd | wie spec'd, plus Squeeze-Watcher-Modul |
| G6 RegimeOrchestrator | KRITISCH | wie spec'd, vereinheitlicht G1-G5 |

---

## OFFENE FRAGEN (für später, NICHT für jetzt)

1. **LIVE-Switch:** Spot oder Futures? (Christian-Entscheidung, Phase E.5+)
2. **Futures-Margin-Management:** wenn Futures gewählt, brauchen wir Margin-Reconciliation + Hebel-Konfig + Funding-Rate-Tracking
3. **API-Key-Trennung:** Spot/Futures-Keys können getrennt sein bei Bitget

→ Diese sind LIVE-spezifisch und nicht relevant für G1-G6 im PAPER.

---

## QUELLEN

| Befund | File:Line |
|---|---|
| placeSportOrder | server.js:1858 |
| placeFuturesOrder (mit holdSide) | server.js:1883 |
| ExecutionAdapter._simulateFill (DEMO) | server.js:10791 |
| ExecutionAdapter._liveFill (LIVE) | server.js:10880 |
| AdaptiveSLTP SHORT-aware | server.js:22406 |
| Trades.close SHORT-PnL | server.js:5585 |
| MetaBrain.REGIME_TO_BOTTYPE | server.js:8369 |
| MetaBrain.classifyRegime | server.js:8338 |
| DemoEngine._executeTrade direction | server.js:24223 |

---

*G0 Audit abgeschlossen: 2026-05-23 19:00*
*Verdict: Pipeline G1-G6 fortsetzen ohne Stopp. SHORT-Fähigkeit im DEMO ist code-ready. MetaBrain-Routing ist der zentrale Hebel.*
