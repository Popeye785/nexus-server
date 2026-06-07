# BRAIN-TURBO DIAGNOSE — TEIL D (READ-ONLY)
**Datum**: 2026-05-18 12:16

## A) BRAIN_MODE='authority'

- **Default**: `voter` (server.js Z.118)
- **Optionen**: `shadow | voter | authority` (validiert in Z.13468)
- **Set-Endpoint**: `POST /api/cfg/set {key:'BRAIN_MODE', value:'authority'}` (Z.13468-13470, persistiert in `bot_settings`)
- **Implementation**: Brain.decide() liefert HOLD-Veto im authority-Mode (server.js Z.11537+ Aggregator)

**Daten-Lage**:
- CLOSED trades total: 27
- CLOSED trades seit BRAIN_MODE=voter (16.05.): **5**
- Aktivierungs-Bedingung der Recherche: **≥50 saubere Trades NACH Reset Day Zero**

**Verdikt**: ⚠️ BEDINGUNG OFFEN — nur 5 Trades seit voter-Mode. Aktivierung in Live empfohlen NACH 50+ Trades. Backtest-Sandbox kann jederzeit aktivieren.

## B) SHARPE_SOFTMAX_ENABLED

- **Default**: `false` (server.js Z.139)
- **Code-Pfad**: `computeSharpeSoftmax(voterNames)` Z.11804+
- **Algorithmus**: `weights[v] = exp(Sharpe_v) / Σexp(Sharpe_i)`, winner = argmax(Sharpe), adjustment = `1 + 0.2 × (winnerWeight - 1/K)`
- **Quelle**: Recherche-Empfehlung 1 (HACN + FinRL + emergentmind)
- **Effekt bei aktiv**: final_size = base_size × adjustment-Faktor (1.0 bis 1.16 typisch)
- **Aktivierung**: `CFG.SHARPE_SOFTMAX_ENABLED=true` oder `bot_settings`

**Verdikt**: ✅ CODE FERTIG, AKTIVIERBAR aber **deferred bis 50+ Trades**. Backtest-Sandbox kann aktivieren.

## C) ADAPTIVE_LR_ENABLED

- **Default**: `false` (server.js Z.140)
- **Code-Pfad**: `computeAdaptiveLR(nTrades)` Z.11824+
- **Algorithmus**: `ε = max(0.01, √(ln K / max(n_trades, 50)))`, K=5 Familien. `lr_winner = 1+ε`, `lr_loser = 1-ε`
- **Quelle**: Recherche-Empfehlung 3 (Arora-Hazan-Kale + Littlestone-Warmuth)
- **Skalierung**: ε≈0.18 (n=50) bis ε≈0.02 (n=4000)
- **Aktivierung**: `CFG.ADAPTIVE_LR_ENABLED=true` oder `bot_settings`

**Verdikt**: ✅ CODE FERTIG, AKTIVIERBAR. Validation-Marker existiert nicht; per Aktivierung erst nach 50+ Trades empfohlen.

## Gesamt-Aktivierbarkeit Live

| Schalter | Code da? | Bedingung erfüllt? | Empfehlung Live |
|---|:-:|:-:|---|
| BRAIN_MODE='authority' | ✅ | ❌ (5/50 trades) | warten |
| SHARPE_SOFTMAX_ENABLED | ✅ | ❌ (5/50 trades) | warten |
| ADAPTIVE_LR_ENABLED | ✅ | ❌ (5/50 trades) | warten |

**Aber:** Für **Backtest auf 6-Jahre-CSV** sind alle 3 Schalter sofort verwendbar (offline-Sandbox).
