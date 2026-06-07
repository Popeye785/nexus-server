# Phase 6 — F2-Pflichtige Aufgaben (Roadmap Tier 3+)

**Verankert: 15.05.2026 16:30**

Phase 6 enthält 9 große Architektur-Themen. Aufwand laut Roadmap "lange Wege".
Pro Teil ist F2 separat erforderlich für entweder Architektur-Entscheidung oder
Sicherheits-Aktivierung. Aktueller Stand: **alle 9 deferred**.

## Pro Teil

### Teil 2 — Strategy Builder UI
**Status:** 🔴 F2 (Architektur-Entscheidung)
- Frontend: Drag-and-Drop Bedingungs-Blöcke + Eval-Engine
- Aufwand: 8-15h, eigene Pipeline
- **Trigger:** Christian explizit "Strategy Builder MVP" Direktive
- DEMO=LIVE: identisch (Eval-Engine ist deploy-agnostisch)

### Teil 5 — Trading Farm (Multi-Bot parallel)
**Status:** 🔴 F2 (Multi-Process-Architektur)
- BotManager-Erweiterung für mehrere Bot-Instanzen pro Symbol-Set
- PM2 cluster + SQLite-Locks
- **Trigger:** Christian + LIVE-Phase erfolgreich seit > 1 Monat
- Aufwand: 12-20h

### Teil 6 — Multi-Exchange-Routing (F4 aus Audit)
**Status:** 🔴 F2 (Architektur + ccxt-Integration)
- ccxt-Library Setup + ExchangeRegistry-Erweiterung
- Best-Execution: Preis-Vergleich + Liquiditäts-Check
- Aufwand: 15-25h
- **Trigger:** LIVE-Phase + 3+ Monate stabil + Volumen > 1000 USDT/Tag

### Teil 7 — Custom Scripting (HaasScript-like)
**Status:** 🔴🔴 F2 (Sicherheits-Implikation)
- User-Code-Sandbox via vm2/isolated-vm
- Code-Eval = Sicherheits-Risiko ohne perfekte Sandbox
- **Trigger:** Christian + dediziertes Security-Audit + 24h Test-Phase

### Teil 8 — DeFi/On-Chain Trading
**Status:** 🔴🔴 F2 (neue Asset-Klasse + neue Risk-Logik)
- ethers.js/web3 Integration
- Wallet-Management, Gas-Tracking, MEV-Schutz
- **Trigger:** Christian + LIVE-Phase Bitget stabil + dedizierter DeFi-Sprint
- Aufwand: 20-40h

### Teil X1 — LSTM/Transformer (echtes Deep Learning)
**Status:** 🔴 F2 (ML-Resource-Bedarf)
- tensorflow.js (Browser-Inferenz) vs Python-Training-Pipeline
- Training-Daten-Pflege, Validation, Re-Training-Loop
- **Trigger:** Christian + R3-Audit zeigt ML-Underfit + Training-Hardware verfügbar
- Aufwand: 15-30h

### Teil X2 — Strategy Rotation (Meta-Layer)
**Status:** 🟡 **machbar ohne F2** — read-only Meta-Selektion
- Rolling-Sharpe pro Strategy, Auto-Switch zu bester
- Hysterese gegen Switch-Flapping
- Aufwand: 5-8h
- **NICHT in dieser Pipeline** — separate Implementierung sinnvoll (eigene Sprint-Box)

### Teil X6 — Reinforcement Learning Agent
**Status:** 🔴 F2 (RL unvorhersehbar)
- RLAgent (Z.15817 existiert) als Decision-Modifier ausbauen
- Reward-Shaping, Exploration-vs-Exploitation
- **Trigger:** Christian + Shadow-Modus 30 Tage + R3-Audit
- Aufwand: 10-20h

### Teil Y1 — Multi-Exchange-Redundanz/Failover
**Status:** 🔴 F2 (setzt Teil 6 voraus)
- Failover-Logic bei primärem Exchange-Down
- Aufwand: 5-10h (nach Teil 6)
- **Trigger:** Teil 6 deployed + Christian

## Aktuelle Pipeline-Entscheidung (15.05.2026 16:30)

**Phase 6 wird NICHT in dieser Runde gebaut.** Gründe:
1. Aufwand > 4h pro Teil (Hard-Stopp-Kriterium aus Direktive)
2. F2-Pflicht für 7 von 9 Teilen
3. Architektur-Risiken bei großen Refactors während laufender Demo-Optimierung

**Empfehlung:** Phase 6 in eigenen Sprint-Boxen, jede mit eigener F2-Freigabe.
Strategy Rotation (X2) wäre der Kandidat für nächste F2-freigegebene Iteration.

## Status
✅ F2-Liste dokumentiert. Phase 6 deferred bis explizite Christian-F2 pro Teil.
