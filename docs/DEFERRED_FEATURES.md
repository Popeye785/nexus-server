# NEXUS — Deferred Features

**Stand:** 15.05.2026

Features die aus Architektur-Audit (V1.0/1.1/1.2) als wertvoll markiert
aber bewusst deferred sind. Pro Feature: Status, Aufwand, was vorhanden,
was fehlt, sinnvoller Aktivierungszeitpunkt.

---

## F4 — MULTI-EXCHANGE-ROUTING

**Status:** 🔵 DEFERRED
**Aufwand:** SEHR GROSS (~2-3 Wochen)

### Was vorhanden
- Symbol-Listen in CFG für `binance`, `kraken` (Z.580+, Z.616+)
- `enabled: false` in Config (vorbereitet aber inaktiv)
- Architektur (`Bitget.placeOrder`, `Bitget.fetchOrderbook`) ist Exchange-spezifisch

### Was fehlt
- **API-Adapter pro Exchange** (Auth, Endpoints, Rate-Limits)
  - Binance: REST + WebSocket
  - Kraken: REST + WebSocket
  - Bitget bleibt primär
- **Order-Routing-Engine**: welcher Exchange für welchen Trade?
  - Best-Price-Routing (lookup spread per exchange)
  - Liquidity-Routing (größere Orders → tieferes Book)
- **Multi-Wallet-Reconciliation**: 3 Exchange-Balances konsolidieren
- **Risk-Splitting**: max X% pro Exchange (Exchange-Risk)
- **Failover-Logik**: Exchange A down → Exchange B
- **Latency-Awareness**: Order auf schnellstem Exchange

### DEMO=LIVE-Implikation
- BLEIBT compatible: jeder Exchange-Adapter ist eigener `_simulateFill` + `_liveFill`
- Demo simuliert pro Exchange, LIVE schickt zu echtem
- Trade-Logik bleibt **vor** Order-Send identisch (1 Code-Pfad)

### Wann sinnvoll
**Erst nach** erfolgreicher LIVE-Phase auf Bitget (~3 Monate LIVE, dann Skalierung).
Vorher: KEINE Multi-Exchange-Komplexität.

---

## F6 — FUNDING-RATE-ARBITRAGE

**Status:** 🔵 DEFERRED
**Aufwand:** GROSS (~1-2 Wochen)

### Was vorhanden
- `Bitget.fetchFundingRate(symbol)` (Z.2276)
- `FundingEngine.getSignal()` (Z.7883) — liefert Signal als Decision-Input
- `funding_arb`-Strategy-Branch (Z.2707) — Backtest-Path

### Was fehlt
- **Spot-Adapter** (aktuell nur Futures)
  - Bitget hat separates Spot + Perp Account
  - Spot-Order-Send für Long-Leg
- **Delta-neutraler Trade-Pair**:
  - Long Spot + Short Perp (oder umgekehrt)
  - Position-Tracking als verknüpftes Paar
- **Funding-Calculator** (8h-Auszahlung)
  - Auto-Berechnung Funding-Cashflows
  - Position-Hold-Time vs Funding-Cycles
- **Auto-Close bei Sign-Wechsel**:
  - Wenn Funding-Rate < 0 (war > 0 vorher) → Position schließen
  - Realisierter Profit aus Funding-Carry
- **Position-Tracking für Arb-Pairs**:
  - 1 Trade = 2 Legs (Spot+Perp)
  - PnL-Aggregation
  - SL/TP-Logik pair-aware

### DEMO=LIVE-Implikation
- Simuliert Funding-Cashflows (deterministisch aus historical funding rates)
- Spot+Perp-Adapter beide brauchen `_simulateFill` + `_liveFill`
- Komplexere Position-Datenstruktur (2-Leg)

### Wann sinnvoll
**Erst wenn** Multi-Strategy-Engine fertig (separate Engine für Arb vs Trend).
Vorher: Risk-Komplexität zu hoch.

---

## Andere F#-Items (aus Audit 09:40)

### Sofort umgesetzt (Top 1-3 + F20)
- ✅ F17 Sentiment-Scaler → Top 1 (Buffett-inverse)
- ✅ F1 Walk-Forward Rolling-Window → Top 2
- ✅ F10 Tax-Export FIFO LIVE-only → Top 3
- ✅ F20 Slippage-Cap → DEMO+LIVE konsistent deployed

### Deferred + dokumentiert (diese Datei)
- 🔵 F4 Multi-Exchange (oben)
- 🔵 F6 Funding-Rate-Arbitrage (oben)

### Komplett fehlend (deferred, kein Doc-Bedarf jetzt)
- F7 LSTM/Transformer — RL-Agent + RF/GB reicht aktuell
- F8 Multi-Exchange-Redundanz — Sub-Feature von F4
- F9 Grafana/Prometheus — externe Tooling
- F11 Visual Trade-Debugger — Frontend-UX, Nice-to-Have
- F12 Strategy-Builder-UI — sehr groß
- F14 Strategy-Switch-Visualizer — Frontend-UX
- F21 Discord-Webhook — Telegram reicht aktuell
- F23 Onchain-Whale-Tracking — externe APIs (Etherscan/Dune)

## Reaktivierungs-Trigger

Items oben können re-evaluiert werden wenn:
- **LIVE-Phase** beginnt → F4 Multi-Exchange priorisieren
- **Multi-Strategy** fertig → F6 Funding-Arb
- **Volumen wächst** > 100k USDT → Slippage-/Routing-Themen kritisch
- **R3-Audit** zeigt ML-Underfit → F7 Deep Learning

## Status
✅ F4 + F6 dokumentiert mit Aufwand/Trigger/DEMO=LIVE-Konformität.
