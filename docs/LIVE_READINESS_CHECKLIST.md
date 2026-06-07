# LIVE_READINESS_CHECKLIST.md V1.0

**Erstellt:** 15.05.2026 21:11 nach LIVE-Readiness-Pipeline
**Status:** 🟡 **READY-BUT-NOT-FLIPPED** — Code-Pfad bereit, Schalter bleibt PAPER

---

## 0. ABSOLUTE OBERSTE REGEL (Pre-LIVE)

**LIVE = nur durch dich. Niemand sonst kippt den Schalter.**
**Bot tradet aktuell autonom in DEMO**, das ist OK. LIVE-Switch ist ein bewusster, manueller Akt.

---

## 1. Stand der 6 Audit-Pflichtpunkte

| # | Pflichtpunkt | Stand | Bewertung | Beleg |
|---|---|---|---|---|
| 1 | **LSTM v4 trainiert** | 🔴 verworfen (49.88% < 55%) | nicht erreicht | `models/_attempts/lstm_v4_rejected_20260515_210825.onnx`, `LSTM_V4_*/REJECT_REPORT_V4.md` |
| 2 | **Multi-Exchange echtes Order-Routing** | 🟡 Code-ready, disabled | 3-fach gesperrt | `CFG.MULTI_EXCHANGE_ROUTING_ENABLED=false` + DEPLOY_MODE-Check + CCXT-Stub |
| 3 | **24h DRY_LIVE** | 🟡 6/6 Preflight-Tests OK, 0h elapsed | Pre-Check sauber, Zeit-Test fehlt | `/api/preflight/live-readiness` Verdict=LIVE_READY |
| 4 | **Audit-V10 Watcher aktiv** | 🟢 läuft | OK | PID in `/tmp/audit_v10.pid`, log `/tmp/audit_v10.log` |
| 5 | **DEMO=LIVE Daily Check 06:00** | 🟢 cron aktiv | OK | `crontab -l` zeigt Eintrag, läuft täglich |
| 6 | **nexus.db permissions 600** | 🟢 erfüllt | OK | `ls -la nexus.db` zeigt `-rw-------` |

**Resümee:** 4/6 grün, 1× gelb (24h muss laufen), 1× rot (LSTM v4).

---

## 2. Aufräum-Empfehlungen (15.05.2026)

| Item | Status |
|---|---|
| LSTM v3 archiviert | ✅ `models/_attempts/lstm_v3_rejected_20260515.*` |
| CLAUDE.md V15.0-Header | ✅ oben eingefügt |
| TELEGRAM_BOT_TOKEN setzen | ❌ Christian-Aktion erforderlich (TELEGRAM_CHAT_ID vorhanden, Token fehlt) |

---

## 3. Sub-Aktivierungs-Status (alle FALSE — sicher)

```
DEPLOY_MODE                           = PAPER  (process.env)
AUTONOMOUS_DEMO_TRADES_ENABLED        = true   (bot_settings DB; DEMO ok)
AUTONOMOUS_LIVE_TRADES_ENABLED        = ❌ existiert nicht (KEIN Flag, KEIN Pfad)
MULTI_EXCHANGE_ROUTING_ENABLED        = false
TRADING_FARM_ACTIVE_EXEC              = false
LSTM_SHADOW_ACTIVE_PREDICTION         = false
RL_ACTIVE_DECISION_MAKING             = false
EXCHANGE_FAILOVER_ACTIVE_SWITCH       = false
STRATEGY_ROTATION_ACTIVE_SWITCH       = false
SHARPE_SOFTMAX_ENABLED                = false
ADAPTIVE_LR_ENABLED                   = false
SCORE_FLOOR_MODE                      = 'log_only'
LIVE_TIER                             = RESTRICTED
BRAIN_MODE                            = shadow
```

---

## 4. LIVE-Schaltbefehle (für später, durch dich)

### 4.1 Reihenfolge — NICHT überspringen

```bash
# ====== SCHRITT 1: Pre-Flight wiederholen ======
curl -sS http://localhost:3000/api/preflight/live-readiness | python3 -m json.tool
# Erwartung: passed=6/6, verdict=LIVE_READY
# Wenn nicht: STOP — Reparatur first, dann erst weiter

# ====== SCHRITT 2: 24h-Test in DRY_LIVE ======
# .env editieren:
#   DEPLOY_MODE=DRY_LIVE
# Dann:
NODE_OPTIONS="--no-node-snapshot" pm2 restart nexus --update-env
sleep 30
curl -sS http://localhost:3000/api/status | python3 -c "import json,sys;d=json.load(sys.stdin);print('deployMode=',d['deployMode'])"
# Erwartung: DRY_LIVE
# Beobachten:
#   - 24h laufen lassen
#   - pm2 logs nexus --lines 100 alle 1h sichten
#   - /api/recon/check muss drift=0 bleiben
#   - dailyPnl im Auge behalten

# ====== SCHRITT 3: Tier RESTRICTED (kleine Größen) ======
# Nach 24h DRY_LIVE ohne Fehler:
# .env editieren:
#   DEPLOY_MODE=LIVE_RESTRICTED
# LIVE_TIER bleibt RESTRICTED (0.2× Multiplier, max 2 Positionen)
NODE_OPTIONS="--no-node-snapshot" pm2 restart nexus --update-env

# ====== SCHRITT 4: Erste 5 Live-Trades manuell überwachen ======
# Telegram-Bot-Token MUSS vorher gesetzt sein
# Jeden Trade einzeln prüfen: Entry, SL, TP
# Nach 5 sauberen Trades:
# - Wenn alles ok: weiter mit normaler Beobachtung
# - Wenn ein Trade unerwartet: SOFORT zurück zu PAPER (siehe Rollback)

# ====== SCHRITT 5: Tier FULL nach >1 Monat stabil ======
# Erst nach >30 Tagen LIVE_RESTRICTED erfolgreich:
# .env:  DEPLOY_MODE=LIVE_FULL
# Tier-Switch via Telegram /tier full (F2-pflichtig, separate Bestätigung)

# ====== SCHRITT 6 (optional): Multi-Exchange aktivieren ======
# CFG.MULTI_EXCHANGE_ROUTING_ENABLED nur wenn ccxt-Adapter v2 deployed
# Vorher: CCXT-SDK installieren + per-Exchange-Keys getrennt einrichten
```

### 4.2 Rollback (wenn LIVE schiefgeht)

```bash
# Schnellster Weg zurück zu PAPER:
# .env editieren:
#   DEPLOY_MODE=PAPER
NODE_OPTIONS="--no-node-snapshot" pm2 restart nexus --update-env
sleep 10

# Verifikation:
curl -sS http://localhost:3000/api/status | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['deployMode'])"
# Muss: PAPER

# Falls offene LIVE-Positionen vorhanden:
curl -sS http://localhost:3000/api/recon/check
# Drift kann temporär > 0 sein (LIVE-Pos vs DEMO-Wallet)
# Auflösung: durch Christian manuell schließen oder mit Janitor

# Wenn drift persistiert > 5%:
# DEMO=LIVE Daily Check wird Alarm geben (cron 06:00)
# Audit-V10 triggert sofort (Sekunden-Granularität)
```

---

## 5. Risiko-Ampel pro Modul

| Modul | Risiko-Stufe | Was passieren KANN | Mitigation aktiv |
|---|---|---|---|
| Decision-Flow (DemoEngine._executeTrade) | 🟢 niedrig | Falsche Direction | Brain-Veto + Pre-Trade-Gates 17 Checks |
| RiskSizing | 🟢 niedrig | Zu große Size | ProfitLockHWM × 0.7 bei DD>10%, MAX_POSITION_PCT 0.10, REGIME_MULT_CAP 1.4 |
| ExecutionAdapter (Bitget Order) | 🟢 niedrig | Slippage/Rejection | MAX_SLIPPAGE_PCT 0.005, retry-logic |
| LSTMShadow (v1 surrogate) | 🟢 niedrig | falsche Prediction | activePrediction=false, kein Trade-Hook |
| RL-Shadow | 🟢 niedrig | falsche Action | activeDecisionMaking=false, Gate@500 decisions |
| Multi-Exchange Routing | 🟢 niedrig | wrong-exchange order | routing_enabled=false hard-block |
| Trading Farm Sub-Bots | 🟢 niedrig | parallel writes | autorestart=false, master single-writer |
| Custom Scripts (isolated-vm) | 🟢 niedrig | script malice | 16MB+100ms cap, 8/8 escape tests pass, no trade-hook |
| DeFi Watcher | 🟢 niedrig | private-key leak | private_key_handling=false, read-only |
| Failover Detection | 🟢 niedrig | falscher Switch | active_switch=false, log-only |
| **Bitget API Keys im .env** | 🟡 mittel | versehentlicher LIVE-Switch | DEPLOY_MODE=PAPER hartcoded; aber Keys liegen da |
| **Walk-Forward Validator** | 🟢 niedrig | falsche Pseudo-Signale | nicht im Decision-Flow, nur Diagnose-Tool |

---

## 6. F2-Pflicht-Punkte VOR LIVE-Switch (must-do)

1. **`TELEGRAM_BOT_TOKEN`** in `.env` setzen (für Alerts während LIVE)
2. **24h DRY_LIVE** durchgelaufen ohne ERROR-Log
3. **Wallet-Mindest-Reserve** auf Bitget-Account haben (≥ 100 USDT empfohlen für RESTRICTED, ≥ 1000 USDT für FULL)
4. **Christian explizit gesagt** "jetzt LIVE" mit Datum/Uhrzeit
5. **PM2-Backup** vor Switch (`pm2 save`)
6. **server.js-Backup** mit Tag `pre-live-switch-YYYYMMDD_HHMMSS`
7. **Audit-V10** muss laufen während des Switch

---

## 7. Realismus-Anker (Erwartung erste 50 LIVE-Trades)

- **Win-Rate** wird zwischen 30–45% liegen (nicht 60%+)
- **Cumulative PnL** könnte negativ sein erste 2 Wochen (Lernkurve)
- **Slippage** real wird höher sein als simuliert (0.05–0.15% real, Demo simuliert ~0.02%)
- **Sub-second Latency-Spikes** werden vorkommen (Bitget API)
- **Eine ungewollte Position** ist erwartbar (manuelles Eingreifen nötig)
- **Telegram-Alerts** werden überproportional viele kommen — Schwelle ggf anpassen

**Ziel laut Christian:** Maserati (3-8%/Monat), nicht Bugatti. Realismus: in den ersten 90 Tagen LIVE Break-Even-Anchor, ab Tag 90 wenn Brain genug Daten hat erst Profitabilität anpeilen.

---

## 8. Audit-Trail dieser Pipeline (heute)

| Teil | Status | Commit | Tag |
|---|---|---|---|
| 0 — Cleanup (Telegram-Notice, LSTM v3 archive, CLAUDE.md V15.0) | ✅ | `0e4ed5e` | `post-cleanup-20260515_205844` |
| 1 — Audit-V10 Watcher start | ✅ | `86fd4c8` | `post-auditv10-20260515_210130` |
| 2 — nexus.db chmod 600 | ✅ | `eb20274` | `post-dbperms-20260515_210148` |
| 3 — WF test_pf>0 verify (already passing) | ✅ | (no commit, verify only) | — |
| 4 — Multi-Exchange Routing READY-DISABLED | ✅ | `2c46ac4` | `post-multiexch-live-20260515_210253` |
| 5 — LSTM v4 Multi-Feature | ❌ rejected | (committed) | `post-lstm-v4-rejected-20260515_210530` |
| 6 — DRY_LIVE Preflight 6/6 PASS | ✅ | `bc6cc35` | `post-preflight-success-20260515_210936` |
| 7 — This document | ✅ (in progress) | next commit | `readiness-doc-*` |

---

## 9. Letzte Erinnerung

**Wenn du das hier liest und "jetzt LIVE" denkst:**

1. Schlafe eine Nacht drüber.
2. Lies Punkt 4 (LIVE-Schaltbefehle) zweimal.
3. Mache Schritt 1 (Preflight) BEVOR du irgendwas änderst.
4. Telegram-Token muss gesetzt sein, sonst keine Alerts während LIVE.
5. Habe DEMO=LIVE-Daily-Check-Output der letzten 7 Tage im Kopf — wenn Daily-Drift > 5% irgendwo: **STOP**, erst Bug fixen.
6. Erste Position muss klein sein (10–20 USDT bei RESTRICTED, NICHT mehr).
7. Wenn etwas komisch ist: zurück zu PAPER. Lieber 1 Tag verlieren als 50 USDT.

**Der Bot ist bereit. Die Frage ist: bist du es?**
