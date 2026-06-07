## ENGINEERING-PHASE REPORT — 25.05.2026

**Phase:** Engineering nach TOTAL-AUDIT + NACHHOL-AUDIT
**Pipeline:** poppler+playwright Tools → Fix 1-6 sequenziell
**Dauer:** ~3h Engineering (Tool-Install + 6 Code-Fixes + Verifikation)
**Bot:** PID 15693, R=246, mem 251 MB, uptime 108s nach FIX-6-Restart
**Mode:** DEPLOY_MODE=PAPER (LIVE kategorisch AUS, unverändert)

---

### FIX 1 — HIGH B1-1.A: profitabilityGreen-Doppelfix (PAPER-aware)

**Befund:** zwei Stellen setzen `profitabilityGreen`; Z.5274 war PAPER-aware (richtig), Z.13284 überschrieb mit LIVE-Sicht.
**Patch:** Z.13284 analog Z.5274 PAPER-aware.
**Verify:**
```
5274:    this.gates.profitabilityGreen = (CFG.DEPLOY_MODE === 'PAPER')
13284:    NoTrade.gates.profitabilityGreen = (CFG.DEPLOY_MODE === 'PAPER')
```
**Status:** ✅ DEPLOYED + VERIFIED

---

### FIX 2 — CRITICAL B14: FALSE_MATH-Filter in /api/bots/dashboard

**Befund:** 7822 strp-Einträge tragen `notes='FALSE_MATH%'` (Punkt-2 Size-Unit-Bug-Forensik). Dashboard summierte sie → realizedAllSinceReset $2148.97 (Phantasie).
**Patch:** 5 SQL-Queries in /api/bots/dashboard mit `AND (notes IS NULL OR notes NOT LIKE 'FALSE_MATH%')`.
**Live-Verify (jetzt):**
```
realizedAllSinceReset: 12.57   (vorher 2148.97 → −99.4%)
totalEquity:           1259.86 (vorher 3120)
displayReserve:        8.8     (vorher 1310.94)
displayTrading:        1033.06 (vorher 1669.11)
pendingRealize:        12.57
```
**Status:** ✅ DEPLOYED + VERIFIED

---

### FIX 3 — HIGH B1-1.B: 70/30-Split für GRID/INFGRID Fill-Cycle

**Befund:** GridBotMBT (Z.9105) und InfinityGridBotMBT (Z.9466) akkumulierten `profit_acc` per Fill, aber riefen NIE `WalletProvider.applyPnL()` → Reserve wuchs nie aus GRID-Profit. Spec-Vorgabe: 70% Profit → reserve, 30% → trading.
**Architektur-Entscheidung (per-fill statt per-close):**
- Quelle 1: Nautilus `_realized_pnls` per-instrument bei Fill (curl raw .pyx, Z.156-157)
- Quelle 2: LEAN `UnsettledCashBook` settled bei Fill (curl raw .cs)
- Risiko vermieden: Force-Killed Grid hätte sonst Profit liegen lassen
**Patch:** beide Fill-Cycle-Blöcke um `WalletProvider.applyPnL(profitDelta, grid_id)` erweitert (guarded `Math.abs(profitDelta) > 0.01`, identisch zum REGIME_HOOK-Filter).
**Verify Static:** Hooks an Z.9111 + Z.9481 plat­ziert, beide innerhalb `if (fillCount > 0)`, syntax-clean.
**Verify Live:** wartet auf nächste organische GRID-Fill-Cycle (BNB/NEAR-Grid inaktiv seit Restart — Markt-Bewegung nötig).
**Status:** ✅ DEPLOYED, ✅ STATIC-VERIFIED, ⏳ LIVE-VERIFY pending Markt-Bewegung

---

### FIX 4 — MEDIUM B1-2: DD-Formel zentralisiert

**Befund:** 4 DD-Berechnungen mit unterschiedlichen Equity-Quellen:
- KillSwitch.check (Z.4899): `(peakRef-eq)/peakRef` — eq = `getEffectiveDemoEquity().effectiveTotal` (mit unrealized) ✓
- DemoEngine._report (Z.25341): `(peakTotal-wallet.total)/peakTotal` — OHNE unrealized ✗
- DemoEngine.dashboard (Z.25376): `(peakTotal-wallet.total)/peakTotal` — OHNE unrealized ✗
- PerfTracker.maxDrawdown (Z.4247): Equity-Curve-Iteration, Formel ok
**Drift gemessen:** vor Fix 0.45pp (Audit B1-2 V2), jetzt 0.70pp (höhere unrealized).
**Quelle:** LEAN `SecurityPortfolioManager.TotalPortfolioValue` Z.430-475 (curl raw .cs) — eine Berechnungsstelle für TotalEquity = CashBook + UnsettledCash + Holdings + UnrealizedProfit. Eine Wahrheit, keine Drift.
**Patch:**
- Neues `_computeDrawdown(equity, peak)` Helper bei Z.10599 (vor `getEffectiveDemoEquity`).
- 4 Call-Sites umgestellt, UI/Report nutzt jetzt `effectiveTotal`.
**Live-Verify:**
```
KillSwitch DD: 0.09918630442423072
Dashboard DD:  0.09918630442423072
→ MATCHEND (0.00pp Drift)
```
**Status:** ✅ DEPLOYED + LIVE-VERIFIED

---

### FIX 5 — MEDIUM B16-1: Etherscan V1 → V2 Migration

**Befund:** WhaleTracker checkWallet (Z.22876) nutzte V1-Endpoint. curl direct probe:
```
V1: {"status":"0","message":"NOTOK","result":"You are using a deprecated V1 endpoint, switch to Etherscan API V2"}
V2: {"status":"0","message":"NOTOK","result":"Missing/Invalid API Key"} (mit Key → Erfolg)
```
**Wichtige Konsequenz:** V2 erfordert API-Key (V1 hatte Free-Tier). Fallback `etherscanKey=''` wäre tot — return null bei fehlendem Key.
**Patch (Z.22881):** `https://api.etherscan.io/v2/api?chainid=1&...&apikey=KEY` + Early-Return wenn kein Key.
**Verify:** .env hat `ETHERSCAN_API_KEY=<SET>`, curl direct mit Key liefert `status:0 result:[]` (gültige Leer-Antwort, kein NOTOK).
**Status:** ✅ DEPLOYED + VERIFIED

---

### FIX 6 — HIGH L2-1: Sub-Sources NEUTRAL Root-Fix

**Befund:** brain_input_log 24h zeigt 10/13 active Sources voten 100% NEUTRAL. Brain bekommt fast keine direction-Info → Brain-Acc 3.8% (B5).
**Tiefen-Trace cvd-Source (höchst-frequentiert, 4127 Ticks/24h):**
- CVDEngine.calculate() klassifiziert 4 Zustände: BULLISH_DIV (46), BEARISH_DIV (1160), BULLISH_CONFIRM (1712), BEARISH_CONFIRM (1209)
- CVDEngine.signal() mappte nur DIV → BUY/SELL, CONFIRM → `null` → AladdinBrain `scores.cvd = NEUTRAL`
- **2921/4127 = 70.8% der CVD-Ticks landeten als NEUTRAL trotz directional Information**
**Quellen:** TradingView CVD-Doku, Investopedia Volume-Price-Trend — CONFIRM ist legitime, schwächere Direction (DIV stärker als Contrarian-Signal, strength 0.72 vs 0.60).
**Patch (Z.23241-3244):** signal() mappt jetzt CONFIRM → BUY/SELL mit divergence:false-Marker (für divergence-bonus in scores.cvd).
**Live-Verify nach Restart (60s warten):**
- brain_input_log zeigt BULLISH_CONFIRM + BEARISH_DIV beide gespeichert
- UNIFIED-Confidence-Sample: NEARUSDT score=0.278 conf=0.14 (vorher ~0.20/0.10), ATOMUSDT 0.133/0.07 (vorher ~0.07/0.02), BNBUSDT 0.094/0.05 (vorher 0.066/0.02)
- → ~50-100% Confidence-Boost auf MOMENTUM-relevanten Symbolen
**Restliche 9 NEUTRAL-Sources (funding_api/var/anomaly_global/etc.):** noch Phase-2-TODO — jede braucht eigenen Threshold-Audit. CVD-Fix ist der größte Single-Win (4127/24h Vote-Volumen).
**Status:** ✅ DEPLOYED + LIVE-VERIFIED (CVD), ⏳ FIX 6b-j für restliche 9 Sub-Sources offen

---

## RE-AUDIT-MATRIX

| Fix | Bereich | Vorher | Nachher | Status |
|---|---|---|---|---|
| 1 | B1-1.A profitabilityGreen | doppelt-überschreibt LIVE-Sicht | beide PAPER-aware | ✅ |
| 2 | B14 FALSE_MATH-Filter | $2148.97 phantasie realized | $12.57 ehrlich | ✅ |
| 3 | B1-1.B 70/30 GRID/INFGRID | profit_acc stranded | per-Fill split | ✅ Code, ⏳ Live |
| 4 | B1-2 DD-Formel | 0.70pp Drift | 0.00pp Konsistenz | ✅ |
| 5 | B16-1 Etherscan V1 | deprecated | V2 + chainid | ✅ |
| 6 | L2-1 CVD NEUTRAL | 70.8% Ticks blind | conf +50-100% | ✅ CVD |

---

## OFFENE LÜCKEN (für nächste Iteration)

1. **FIX 3 Live-Verify** — wartet auf organische GRID-Fill mit profitDelta>0.01. ScheduleWakeup gesetzt.
2. **FIX 6b-j** — 9 weitere NEUTRAL-Sub-Sources (funding_api, var, anomaly_global, rl_agent, aladdin_sent, regime_snap, heatmap, correlation, feargreed 100% SELL). Jede 30min-2h Forensik.
3. **70/30 für DCA MANUAL/MAX_ITER** — `_close` triggert kein applyPnL bei nicht-TP. Inventar liegt held → kein realized PnL. Liquidations-Logik wäre zusätzlicher Fix (außerhalb FIX-3-Scope, dokumentiert).
4. **B15-2 OB-Snapshot 3 → 20 Symbole** — MICROSTRUCTURE limited, MEDIUM, 2-4h.
5. **B5 Re-Audit Brain-Acc nach FIX 6** — abwarten 50+ neue Trades, Hit-Rate-Vergleich.

---

## BOT-STATE NACH ALLEN FIXES

- PID: 15693, R=246
- Uptime: 108s nach FIX-6-Restart
- Mem: 251 MB RSS / 62 MB Heap
- WS ready, Brain alive
- DEPLOY_MODE: PAPER (kategorisch)
- Wallet: $1033.06 trading / $8.80 reserve / $1259.86 totalEquity
- 2 OPEN Grids (NEAR/BNB)
- KillSwitch mode: RISK_COMPRESSION (DD 9.9% prekill, MAX 12%)
- Realized seit Reset: $12.57 (ehrlich, FALSE_MATH gefiltert)
- Pending: 9 Sub-Sources mit NEUTRAL-Voting (Phase 2)

---

## QUELLEN (alle curl direct, kein WebFetch)

- LEAN SecurityPortfolioManager.cs (42802 bytes, Z.430-475) — TotalPortfolioValue zentral
- Nautilus portfolio.pyx (118303 bytes, Z.156-157) — realized_pnls per-fill
- Hummingbot client/performance.py (Welle 2 Quelle, Decimal-PnL)
- Etherscan V2 deprecation message (curl direct), V2 Live-Probe mit Key (status:0 result:[])
- CVD calculate() Code Z.23200-23210 (Strength-Werte sind schon im Original)

---

*Erstellt: 25.05.2026 ca. 20:38, FIX 1-6 alle DEPLOYED, Re-Audit MATRIX dokumentiert*
*Live-Log: /tmp/fix3_20260525_*.txt (cat /tmp/audit_log_current.txt für Pfad)*
