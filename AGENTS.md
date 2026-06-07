# 🔴🔴🔴 DEMO = LIVE — ABSOLUTE OBERSTE PRIORITÄT 🔴🔴🔴

**Verankert: 15.05.2026 09:45 — gilt VOR allem anderen.**

---

# 📜 NEXUS V9 — ARBEITSRAHMEN (verankert 26.05.2026, Tooling-Pass)

## ROLLEN

- **Christian** — Owner, Entscheider, hasst Multiple-Choice. Gibt klare Direktiven. Bei "voller Freigabe" erwartet er Durchziehen, kein Halbwerk.
- **Codex (du)** — Engineer mit Code-Zugriff. Reihenfolge der Direktive 1:1 abarbeiten. Backlog für unklare Befunde nutzen, NICHT mitten in einer Aufgabe abdriften.
- **Codex Web** — Übersetzer/Block-Bauer ohne Code-Zugriff. Hilft bei Spec-Refinement aber kann nicht deployen.

## PFLICHT-PROTOKOLL (HARD — verbindlich für jede Sequenz)

✅ **Claim-Status angeben** — jeder Befund muss klassifiziert werden:
- `VERIFIZIERT` (curl/sql output beigelegt)
- `PLAUSIBEL` (logische Inferenz aus verifiziertem)
- `UNSICHER` (Indizien, nicht bewiesen)
- `UNBEKANNT` (keine Aussage möglich)

✅ Backup vor jedem destruktiven Schritt (sqlite3 .backup, cp server.js .bak, etc.)
✅ Live-Log mit Bash-Timestamps in `/tmp/audit_log_*.txt`
✅ Direkte Quellen-Verifikation via curl raw — **NICHT WebFetch**
✅ Bei nicht-lesbaren Quellen (Cloudflare-Block, 404, arXiv leer): ehrlich **UNGEPRÜFT** markieren, niemals ungeprüfte Behauptung als verifiziert verkaufen
✅ Ehrliche Lücken-Sektion am Ende jedes Endberichts (was nicht geprüft wurde, was zeit-abhängig ist, was offen bleibt)
✅ KEINE Halluzinationen — keine erfundenen Tests, Papers, Endpoints, Ergebnisse
✅ Keine Zeit-Behauptungen ohne Timestamp (`$(date +%H:%M:%S)` im Log)
✅ Frontend-Verify bei UI-Patches obligatorisch — Backend allein zählt nicht als "deployed"

## VERBOTEN

❌ "Snapshot-Only" als "Deployed" verkaufen — Module ist erst deployed wenn aktiv im Trade-Loop
❌ Backend-Fix ohne UI-Frontend-Verify als "fertig" melden
❌ Drift künstlich wegbuchen ohne Root-Cause aufzuklären (siehe HISTORIC_GAP_CORRECTION nur nach Forensik)
❌ "ist nicht-trivial, eigener Pass nötig" als Stop-Grund ohne wenigstens EINEN Pass an EINEM der Sub-Tasks anzugehen
❌ Spec ohne Execution (Doku ist kein Deploy)
❌ "wartet auf organische Trades" als Fix für ML-Imbalance — das ist Hoffen, nicht Engineering. SMOTE/Upsampling ist die Lösung.
❌ Multiple-Choice-Buttons / Auswahl-Karten / "Soll ich Option A oder B?" — entscheide selbst, melde Vorgehen
❌ Eigenständige Hard-Integration ohne Tooling-Verify (UI-Effekt muss sichtbar sein)

## BACKLOG-SYSTEM

Bei entdeckten Fehlern AUSSERHALB des aktuellen Tag-Scope:
→ NICHT sofort fixen
→ NICHT die laufende Sequenz unterbrechen
→ Ins **FEHLER-BACKLOG** eintragen mit:
- Wo gesehen (Code-Stelle, Endpoint, UI-Box)
- Reproduzierbar (ja/nein, wie?)
- Schweregrad (LOW / MED / HIGH / CRITICAL)
- Vermutete Ursache
- Empfohlener Fix-Tag

Backlog wird systematisch nach Phase 4 abgearbeitet (oder früher wenn HIGH/CRITICAL).

## STOP-GATE

Sofort stoppen + Christian fragen bei:
- 🔴 Datenverlust-Risiko (DB-Korruption, wallet-overwrite-Risiko)
- 🔴 Crash der nicht selbst-behebbar ist (PM2 stuck, OOM-Loop)
- 🔴 Sicherheits-Risiko (.env exposed, key-leak, attack)
- 🔴 Widersprüchliche Logs vs Realität (drift wächst trotz "Fix")
- 🔴 Unklare Kausalität (etwas funktioniert nicht aber Ursache verborgen)
- 🔴 LIVE-Approval-Reife erreicht (7/7 Blocker grün → F2c Christian)
- 🔴 Token-Budget für sauberen nächsten Schritt nicht mehr ausreichend (Statusline beobachten!)

## ANTI-BRICK (unantastbar)

🔴 LIVE bleibt **AUS** bis F2c Christian-Approval
🔴 Reserve unantastbar — niemals manipulieren ohne explizite F2-Direktive
🔴 Bot bleibt **PAPER** bis ALLE 7 LIVE-Blocker grün
🔴 LIVE-Ready 4/4 muss erhalten bleiben
🔴 Drawdown-Schwellen NIEMALS überschreiten (MAX_DRAWDOWN_PCT 0.12)
🔴 Niemals Safeties deaktivieren (`--no-verify`, `--no-gpg-sign`, kill-switch off, etc.)
🔴 Niemals ohne Backup arbeiten

## QUELLEN-NIVEAU

✅ **Akzeptiert** (Quant-Grade):
- arXiv, SSRN
- Lopez de Prado ("Advances in Financial Machine Learning" 2018)
- LEAN/QuantConnect, NautilusTrader, FreqAI, Hummingbot
- Aladdin (BlackRock), Renaissance Technologies, Two Sigma, Citadel, Bridgewater (sofern Paper/Tech-Talks public)
- Bybit/BitMEX Research, Bitget API-docs (Tier-1 Exchange)
- PyPortfolioOpt (als Lopez-de-Prado-Code-reproduktion mit explizit erteilter Permission)

❌ **Nicht akzeptiert** (Consumer-Niveau):
- 3Commas, Pionex, Bitsgap, Cryptohopper
- TradingView "Strategy Ideas"-Community-Scripts
- YouTube-Tutorials, "Crypto Twitter"-Tipps
- Anonyme Reddit-Threads ohne peer review

## ARBEITSWEISE-DEFAULTS

- **Plan-Mode vor größeren Aktionen** — wenn mehr als 3-Stunden-Arbeit oder destruktive Aktionen: ExitPlanMode-tool nutzen, Plan vorlegen, warten auf Approval
- **TaskCreate** für Mehr-Schritt-Tasks — kein "ich behalte alles im Kopf"
- **Pro Pass:** Backup → Patch → Syntax-Check → Restart → Live-Verify → Status melden → nächster Pass
- **Bei "voller Freigabe":** sequenziell durchziehen bis ALLE PRIOs durch ODER echtes Stop-Gate erreicht
- **Beim Stop wegen Token-Budget:** sauberer Pause-Punkt mit klarem "nächster Pass macht X". Nicht mitten in Half-Implementation aufhören.
- **Definition-of-Done-Skill ist PFLICHT** vor jedem "fertig"/"deployed"/"complete"-Output. Skill liegt unter `.Codex/skills/definition-of-done/SKILL.md` und prüft 11 Rules incl. UI-Frontend-Verify mit Playwright + Cmd+Shift+R Cache-Bypass.
- **UI-Änderungen erfordern IMMER Rule 3** (UI/Frontend Verification) — Playwright headless + screenshot + console-errors=0 + DOM-Werte match Backend. Backend ≠ Frontend, beide separat verifizieren.

### ZEIT- UND MARKT-DATEN PFLICHT (27.5.2026 verankert)

- **session-context** Skill bei jeder Session-Aktion — PFLICHT vor jeder zeitbezogenen Aussage (heute/gestern/seit/uptime/etc.)
- **market-data-verify** Skill PFLICHT vor jeder Markt-Aussage (bullish/bearish/24h-change/BTC-price etc.)
- 3-Quellen-Cross-Reference Pflicht
- Candle-Ordnung explizit verifizieren (`print(candles[0].ts, candles[-1].ts)`)
- Anti-Pattern 27.5.2026: Vorzeichen-Bug "BTC +1.43%" statt -1.52% darf nie wieder passieren

## SKILL-PFLICHT (verankert 26.05.2026 Block E, erweitert 27.05.2026)

- **session-context** bei jeder Session-Aktion + zeitbezogenen Aussagen (PFLICHT)
- **market-data-verify** vor jeder Markt-Aussage (3-Quellen-Cross-Reference + Candle-Ordnung)
- **definition-of-done** vor jedem "fertig"-Output (11 Rules)
- **code-review** vor jedem Deploy (7 Punkte: Minimalität/Side-Effects/Naming/Error-Path/Architektur/Test/Docs)
- **test-first** bei jedem Bug-Fix (RED→FIX→GREEN, ohne test = kein fix)
- **nexus-handover** für Tages-Endberichte (Christian-Stil: kurz, claim-status, code-vor-theorie)

Skills liegen unter `.Codex/skills/<name>/SKILL.md` — werden beim nächsten Session-Start auto-loaded.

## GESTRICHEN aus Backlog (Christian-Klarstellung 26.05.2026)

- ❌ **Bitget-Keys-Rotation** — Solo-Setup, Bot PAPER, .env chmod 600, Keys haben keine Echtgeld-Befugnis. Wäre Sicherheits-Theater. Aus Backlog entfernt.

## TOOL-INFRASTRUKTUR (verfügbar ab 26.05.2026 Tooling-Pass)

- **Playwright MCP** — installed, aktiviert ab nächster Codex-Session (Tools: browser_navigate, browser_click, browser_snapshot, browser_take_screenshot)
- **Hooks** — Notification/Stop/PermissionRequest senden macOS-Notifications (Glass/Ping/Funk)
- **Statusline** — Codex-statusline (😺 pet-themed Token-Verbrauch + Bucket-Reset-Timer)
- **Poppler** — installed (PDF-Extraktion möglich, bisher arXiv nicht curlbar)
- **Playwright NPM-Package** — installed (`@playwright/test`, kann direkt via Bash genutzt werden)

---

## 📋 V15.1 STAND-HEADER (16.05.2026, 08:25 nach Aufräum-Pipeline)

**Bot:** PID 13856, R=62, läuft seit Welle 1+2a+2b+2c+Z+Z2+Z3+Phasen 1-6+Nachschlag+LIVE-Readiness+Aladdin-Restore+Aufräum-Pipeline.
**DEPLOY_MODE:** `PAPER` (KATEGORISCH unverändert — Christian-F2 nötig für LIVE-Switch)
**AUTONOMOUS_LIVE_TRADES_ENABLED:** `false` (kategorisch)
**AUTONOMOUS_DEMO_TRADES_ENABLED:** `true` (in `bot_settings`, intentional für Paper-Trading)
**LSTM-Modell aktiv:** `models/lstm_crypto_v1.onnx` (Surrogate, untrained — v3+v4 beide rejected, v5-Roadmap dokumentiert)
**ML-Ensemble:** RF 50% + GB 50% + PC 0% (PC-Perceptron acc=0.0 → Gewicht ausgeschaltet 16.05.)
**Wallet:** 718.52 USDT total / 10.45 reserve / 708.06 trading / dailyPnl heute +4.33 USDT
**Recon:** drift=0, consistent=true
**ProfitLockHWM:** HWM 718.52, DD 0.00%, inactive (sizeMult=1.0)
**Audit-V10:** läuft (log update kontinuierlich in /tmp/audit_v10.log)
**Telegram:** ✅ Token+ChatID SET, 6 Msg heute gesendet, 0 throttled
**Discord:** disabled (Telegram als primärer Alert-Kanal)

### 🆕 V15.1 Updates (16.05.2026)
1. **Aladdin-Restore Option D** deployed (Commit 5b27da6, 16.05. 07:59):
   - 4 Hard-Blocks **wiederhergestellt** aus Original-Aladdin-Spec:
     - `MONTE_CARLO_VaR_TOO_HIGH` (var95 > 0.25)
     - `SHARPE_NEGATIVE` (sharpe < -0.5)
     - `BAYESIAN_BEAR` (bear-Regime + conf>0.60 + BUY-Intent)
     - `BAYESIAN_BULL` (bull-Regime + conf>0.60 + SELL-Intent)
   - **Voter-Schwellen gelockert**:
     - `CONSENSUS_MIN` 3 → 2, `SELL_CONSENSUS_MIN` 3 → 2
     - `CONFIDENCE_FAMILY_MIN` 0.10 → 0.05 (BUY+SELL symmetrisch)
2. **Hold-Problem gelöst** (alte "min B=3/S=3"-Logs sind historisch vor Restore)
3. **PC-Modell-Gewicht 0** gesetzt (Commit 9318f64, 16.05. 08:25) — RF+GB tragen jetzt 50/50
4. **Total-Audit 16.05. 08:07** — siehe `~/Desktop/NEXUS_BACKUPS/TOTAL_AUDIT_20260516_080736/TOTAL_AUDIT_REPORT.md`
5. **6-Jahre-Kerzen verifiziert** in `historical_data/` (408 MB, 30+ Symbole, 2020-03 bis 2026-04)
6. **Telegram-Token jetzt SET** (war NICHT_PRESENT in V15.0)

### Was heute (15.05.2026) deployed wurde:
1. **Phase 1-6 Roadmap komplett** (60+ Patches, ~12 PM2-Restarts)
2. **Phase 6 Nachschlag**: isolated-vm Sandbox (8/8 Security-Tests), onnxruntime-node LSTM-Pipeline, PM2 Sub-Bot Cluster, Drag-Drop Strategy Builder UI
3. **LSTM v3 Training-Versuch**: rejected (dir_acc 49.88% < 52% Schwelle), archiviert in `models/_attempts/`
4. **WF test_pf>0 Bug-Fix**: 3-Teil — Endpoint-Defaults + Prefetch-Candles + trades-extraction; 5/10 windows test_pf>0
5. **Komplett-System-Audit**: Status 🟡 GELB, 0 kritisch, 3 Schein-Logik (LSTM/Multi-Exchange/Farm), 1 Security-Beobachtung (Bitget-Keys im .env aber inaktiv durch PAPER)
6. **LIVE-Readiness-Pipeline**: Aufräum + Audit-V10 Watcher + nexus.db chmod 600 + WF-Fix-Retry + Multi-Exchange Order-Routing Code-Ready + LSTM v4 (folgt) + DRY_LIVE Preflight + Final-Checklist

### Wichtige Pfade
- Code: `~/NEXUS_CLEAN/server.js` (~22500 Zeilen)
- Dashboard: `~/NEXUS_CLEAN/public/index.html` (~8500 Zeilen)
- DB: `~/NEXUS_CLEAN/nexus.db` (chmod 600 ab 15.05.21:00)
- .env: `~/NEXUS_CLEAN/.env` (chmod 600 ✓)
- Models: `~/NEXUS_CLEAN/models/lstm_crypto_v1.onnx` (active surrogate)
- Backup-Hub: `~/Desktop/NEXUS_BACKUPS/` (~22 Task-Ordner inkl. FULLAUDIT)
- LIVE-Schaltung-Anleitung: `~/NEXUS_CLEAN/docs/LIVE_READINESS_CHECKLIST.md` (wird in dieser Pipeline geschrieben)

### Pflicht-Lesen für nächste Session
1. `docs/LIVE_READINESS_CHECKLIST.md` — exakter Befehlspfad für LIVE-Schaltung
2. `~/Desktop/NEXUS_BACKUPS/FULLAUDIT_20260515_193441/AUDIT_REPORT.md` — Status-Snapshot
3. Diese AGENTS.md weiter unten — alle Welle/Phasen-Logs
4. `docs/PHASE6_F2_REQUIRED.md` — F2-Liste der 9 Teile

---


Wenn Demo und LIVE nicht 1:1 identisch arbeiten, ist der gesamte Bot **WERTLOS**.

## HARD RULES (kein Verhandeln)

### Regel 1 — EIN CODE-PFAD
- Trade-Decisions, Sizing, Risk-Checks, Indikatoren, Stops, Exits, Signal-Generierung MÜSSEN durch identische Funktionen laufen
- NIEMALS modus-spezifische if-Branches in Trade-Logik
- NIEMALS Demo-Wrapper oder LIVE-Wrapper um zentrale Funktionen
- Getrennte Pfade Demo vs LIVE → falsch

### Regel 2 — NUR DER ORDER-SEND UNTERSCHEIDET
- Einziger erlaubter Unterschied:
  - Demo → simuliert Order intern (`ExecutionAdapter._simulateFill`)
  - LIVE → schickt sie zu Bitget (`ExecutionAdapter._liveFill`)
- ALLES davor (Decision-Flow, Size, Stops, Cooldowns) IDENTISCH
- ALLES danach (Reconciliation, Wallet-Update, Logging) IDENTISCH

### Regel 3 — GLEICHE FEES, GLEICHE SLIPPAGE
- Demo MUSS Bitget-Fees realistisch abziehen (Taker 0.06%, Maker 0.02% Futures)
- Demo MUSS Slippage simulieren wie real (Orderbook-walk in `_simulateFill`)
- Demo MUSS API-Latency berücksichtigen (50-200ms in `_simulateFill`)
- Demo "perfekte" Trades simulieren → falsch

### Regel 4 — VERIFY VOR JEDEM PATCH
Bei JEDER Trade-Logik-Code-Änderung:
- Pflicht: Demo=Live-Audit (grep alle Aufrufer)
- Pflicht: Sim-Test gleicher Input PAPER + DRY_LIVE → Diff=0
- Bei Output-Drift > 0.01% → SOFORT STOP, kein Deploy
- Doku in `/tmp/{feature}_demolive_verified.md`

### Regel 5 — PROOF-PFAD IM CODE
- Trade-Logik-Funktionen kriegen Header:
  - `// DEMO=LIVE: identisch in beiden Modi`
- Modus-spezifische Funktionen (Order-Send):
  - `// LIVE-ONLY: echte Bitget-Order` oder
  - `// DEMO-ONLY: nur Simulation`

## Pflicht-Audit VOR jedem Patch

1. `grep -nB3 "funktionsname(" server.js` — alle Aufrufer
2. Markieren: wird der Aufrufer in PAPER aufgerufen? In LIVE_*? Modus-Branch drumherum?
3. Falls EIN Pfad fehlt → STOP, zentralisieren BEVOR Patch
4. Erst nach Zentralisierung: Patch deployen

## Pflicht-Verify NACH jedem Patch

1. Sim-Test PAPER: synthetischer Decision-Flow
2. Sim-Test DRY_LIVE: gleicher Input
3. Diff: 0 erwartet (außer Order-Send-Block)
4. Bei JEDER Abweichung in Decision/Size/Stops/Filter → STOP, Rollback, F2
5. Doku `/tmp/{feature}_demolive_verified_{HHMM}.md` + Telegram

## Konsequenzen bei Verstoß
- SOFORT STOP des Patches
- Rollback auf .bak
- `git reset --hard pre-{patch}-Tag`
- pm2 restart
- Telegram-Alarm + Forensik-Doc

Lieber 10 zusätzliche Audits als ein LIVE-Crash mit echtem Geld.

## Daily Demo=Live Check
- Cron 06:00: vergleicht 24h Demo+LIVE Trades (Win-Rate, Avg-PnL, Size, Hold-Time)
- Bei Abweichung > 5% → 🚨 Telegram
- Output: `~/NEXUS_CLEAN/.demolive_daily_{YYYYMMDD}.md`

## Tax-Export — EINZIGE Ausnahme
- Tax-Reporting (FIFO-Haltefrist DE) ist KEIN Trade-Logik-Tool
- Demo-Trades sind virtuelles Geld → KEINE Steuer
- LIVE-Trades sind echtes Geld → Steuer-relevant
- `// LIVE-ONLY: Tax-Reporting nur echtes Geld`

---

# 🔴 WEB-RECHERCHE-PFLICHT (UNIVERSELL)

**Verankert: 15.05.2026 11:00 — gilt für JEDE Aufgabe, auch zukünftige.**

Bei jedem Auftrag wo etwas unklar / blockiert / veraltet sein könnte:
**ZUERST Web-Recherche, dann implementieren.**

## Auslöser (NICHT skippen, sondern recherchieren)
- Demo-Daten-Lücke (Feature nicht voll testbar)
- Library/Framework-Wahl unklar
- "Geht so nicht" wäre die einfache Antwort
- Best-Practice-Unsicherheit (welcher Ansatz aktuell?)
- Wissensstand älter als 6 Monate könnte veraltet sein
- 2026-Stand-Check nötig
- Bug-Ursache unklar nach 1 Versuch
- Strategie/Pattern unklar
- API/Service-Format/Verhalten unklar

## Workflow
1. **3-5 relevante Quellen** lesen (WebSearch + WebFetch)
2. **Aktueller Stand 2026** prüfen — nicht 2023!
3. Lösung implementieren mit recherchierten Patterns
4. Doku im Output:
   - "Web-Recherche genutzt: ja/nein"
   - Quellen-Liste
   - Gewählter Ansatz mit Begründung

## Skip nur wenn
Recherche zeigt: Feature braucht zwingend externe Resource die nicht verfügbar
(echte LIVE-Daten, kostenpflichtige API, etc.).
Doku-Pflicht: "Skip mit Grund X — Recherche zeigt: erst möglich wenn Y"

## Nicht-skippen-Kultur
**Niemals**: "Demo-Daten fehlen → skip"
**Immer**: "Demo-Daten fehlen → wie löst man das laut Web-Stand 2026 → implementieren"

---

# 📋 NEXUS V9 ULTIMATE — MASTER-HANDOVER V14.6

> **Diese eine Datei enthält ALLES** — Vision, Setup, Roadmap, Arbeitsanweisung, Bug-Status, Code-Stellen, Architektur-Entscheidungen.
>
> **Stand:** 12.05.2026 Mittag — nach Welle 1, 2a, 2c+2b, Tier-Z + Tier-Z2 Build, Reset-Spec final.

---

## 🎯 STAND 12.05.2026 MITTAG (nach Welle 1, 2a, 2c+2b live, Tier-Z+Z2 build, Reset spec)

**Bot:** PID 60284, läuft stabil, mem 91.6mb, Counter 0 (frischer Start via pm2 delete in F2c)
**Modus:** DEMO/PAPER (echte Bitget-Wallet ~57 USDT unberührt)
**Offene Positionen:** **5** (SEI/SUI/UNI von 11.05. + SOL/OP von 12.05. Nacht)
**StatsCore:** 138 Strategy-Trades (+5 vs. Vortag durch Nacht-SL-Quartett) / WR-Update aus DB einsehbar
**News-Pipeline:** 5 RSS-Feeds aktiv, **271 Posts** in `news_feed`, Brain noch blind (`NewsSentiment.enabled=false`, Tier 1.4b später)
**Janitor:** 18 ARCHIVED_PHANTOM (Welle 1 Patch C abgeschlossen)
**FG:** 49 (Neutral)

**Heute (12.05.) deployed (live):**
- Welle 1 Patch A: Mute-Befehl ✅
- Welle 1 Patch C: Janitor-Cleanup 18 Phantoms ✅
- Welle 1 Patch B: PM2-Hardening **aufgegeben** (System-Setup übernimmt)
- 5 neue Grundregeln (GR1-GR5) in `~/.Codex/.../memory/`
- **Welle 2a:** Brain-Veto (5 Bedingungen) + SCORE_FLOOR log_only + blocked_trades-Mess-Infra + /blocks + Dashboard
- **Welle 2c:** RSS-Pipeline 5→12 Quellen + qualityScore + Polling 15→10 Min + MIN_POSTS_HEALTHY
- **Welle 2b:** NewsSentiment.enabled=true + Mapping halbiert + Article-Count-Filter ≥10 + NEWS_EXTREME-Schwelle 80→85
- **Tier-Z Z.1:** wartung.sh-LaunchAgent disabled (kein Restart nötig)
- **Tier-Z3 Security-Hardening (10:15):** `.env` chmod 600 (war 755 world-readable), `.gitignore` erstellt (`.env, node_modules/, *.bak.*, nexus.db, .pm2/, data/demo_*.json`), `.env.example` als Template. Christian's User-Preferences "Secrets sicher, niemals Klartext" erfüllt.

**Auf Disk (warten auf F2-Approval):**
- Tier-Z Z.2: PROFIT_SPLIT_RESERVE-Audit-Op
- Tier-Z Z.3: Slider-Tooltip präzisiert
- Tier-Z Z.4: Janitor-Mute Set-basiert + /janitor-Command
- Tier-Z2 (6 Patches): 5-Jahre-Backtest-Erweiterung + Resume-Mechanismus
- Reset Day Zero (Spec final, ~/NEXUS_CLEAN/.reset_day_zero_spec.txt)

**Gestern (11.05.) deployed (kumuliert):**
- 60+ Code-Patches in 17 Restarts
- 9 neue DB-Spalten + 3 neue Tabellen + 5 neue Indices
- 8 Tier-Module live + 7 neue API-Endpoints + 4 neue Telegram-Commands (jetzt mit `/mute`)
- Demo=Live 1:1 erfüllt (alle 11 Tabellenpunkte grün)
- Audit-Erfolgskriterien (alle 7 grün)

---

## 🔄 WAS V14.5 VON V14.4 UNTERSCHEIDET

V14.4 dokumentierte Audit-Tag + 5 Feature-Module. V14.5 dokumentiert zusätzlich die **2 Sentiment-Sprints** vom Nachmittag:

| Modul | Zweck | Status |
|---|---|---|
| **Tier 1.1** Risk-Based Position Sizing | Confidence-Schwellen + SL-Floor | ✅ live (V14.4) |
| **Tier 1.3** Regime-adaptive Sizing | RegimeStrength + Hysterese + Stack-Cap | ✅ live (V14.4) |
| **Tier 1.1b'** Brain-Reparatur | Rate-Limit raus + empirische Familien-Gewichte | ✅ live (V14.4) |
| **Bug-Bündel** | SQUEEZE-Mapping + /api/regime/snapshot Route | ✅ live (V14.4) |
| **Tier 1b.1** Dynamic Slots (Backend) | MAX_OPEN_TRADES konfigurierbar + Telegram | ✅ live (V14.4) |
| **Tier 1b.2** Dynamic Slots (UI) | Slider im KAPITAL-Tab | ✅ live (V14.4) |
| **Tier 1.4a-mini** Market-Sentiment-Persistenz | FG-Daten in DB, neue Endpoints | ✅ live (V14.5) |
| **Tier 1.4a-bis** RSS-Aggregator | 5 RSS-Quellen, news_feed-DB, First-Run-Alert | ✅ live (V14.5) |
| **Tier-Y (teil-deployed)** House-Keeping | Patch 1 Snapshot-Warning ✅ / Patch 2 PM2-Hardening ❌ aufgegeben (System löst es) | ⚠️ teil-live (V14.5) |
| **Welle 1** Mute + Janitor + PM2-Hardening | A Mute ✅ / B PM2-Flags ❌ unnötig / C Janitor ✅ | 2/3 live (V14.5) |
| **Welle 2a** Brain-Veto + Floor-Logging + Mess-Infra | SCORE_FLOOR log_only, VETO scharf, 22 Live-Blocks | ✅ live (V14.6) |
| **Welle 2c** RSS-Pipeline-Ausbau (5→12 Quellen) | qualityScore + Polling 10min, 112 Posts/35min | ✅ live (V14.6) |
| **Welle 2b** News-Aktivierung + halbiertes Mapping | enabled=true, Filter ≥10, NEWS_EXTREME ≥85 | ✅ live (V14.6) |
| **Tier-Z** Sammelpatch (Z.1-Z.4) | Z.1-Z.4 alle live | ✅ live (V14.6, F2 10:49) |
| **Tier-Z2** 5-Jahre-Backtest + Resume | 6 Patches, 26/26 Tests, dormant bis Backtest-Start | ✅ live (V14.6, Co-Deploy + Approval 11:00) |
| **Tier-Z3** Security-Hardening (chmod + .gitignore) | 3 Mini-Patches ohne Restart | ✅ live (V14.6, 10:15) |
| **Reset Day Zero** Spec final (Demo→1000, Brain bleibt) | 8 Schritte, A/B-Kategorisierung | ⏸️ Spec only |

Plus: Position-Persistence-Bug #13 + Guardian-Hardening Bug #14 sorgen dafür dass PM2-Restarts keine Positionen mehr töten.

---

## ⚡ WENN DU EIN NEUER Codex BIST — LIES DAS ZUERST

1. **Diese Datei vollständig lesen** (~12 Min)
2. **Health-Check ausführen** (siehe Befehle-Cheat-Sheet weiter unten)
3. **Bot-Status verstehen** vor jeder Aktion
4. **Demo=Live ist Kernprinzip** — neue Features die das verletzen → nicht bauen
5. **Kritische Aktionen brauchen Christian-Approval:**
   - PM2-Restart
   - DB-Schreibvorgänge (außer Backups)
   - LIVE-Modus-Switch
   - Hebel-Änderungen
   - Architektur-Entscheidungen die nicht im Plan stehen
6. **Backup vor jeder Code-Änderung** mit Timestamp

---

## 🛠️ SYSTEM-ÜBERSICHT

### Plattform
- Mac mini M1 (8 GB), macOS Sequoia, Tailscale VPN
- Node v20.20.2, SQLite (WAL-Mode), PM2
- Bitget Exchange (Spot + Futures)
- Browser: ausschließlich Safari

### Pfade
- **Bot-Code:** `~/NEXUS_CLEAN/server.js` (~17.000+ Zeilen)
- **Dashboard:** `~/NEXUS_CLEAN/public/index.html` (~7.300 Zeilen)
- **Wallet-Persistence:** `~/NEXUS_CLEAN/data/demo_wallet.json`
- **Position-Persistence:** `~/NEXUS_CLEAN/data/demo_positions.json`
- **DB:** `~/NEXUS_CLEAN/nexus.db` (~53 MB)
- **Backups:** `~/NEXUS_CLEAN/*.bak.*` und `~/NEXUS_CLEAN/public/*.bak.*`

### PM2
- Prozess: `nexus`
- Restart: `pm2 restart nexus --update-env`
- Logs: `pm2 logs nexus --lines 50 --nostream`
- Status: `pm2 list`

### Architektur (Datenfluss V14.5)

```
Bitget API → Candles/OB/Ticker/Funding
     ↓
UnifiedScore (21 Quellen, inkl. FearGreed + NewsSentiment) → direction + confidence
     ↓
AladdinBrain.decide() → consensus + 5 Familien (TREND/MOMENTUM/RISK/SENTIMENT/MICROSTRUCTURE)
     ↓
RegimeStrength.stableClassify(symbol, ...) → regimeMult (Hysterese 2-aus-3)
     ↓
RiskSizing.calculate({confidence, slPct, regimeMult, volatilityMult})
     stackedMult capped at 1.4
     ↓
DemoEngine._executeTrade → DB (mit entry_*-Audit-Spalten) + Wallet
     ↓
Trades.close mit Fees (beide Seiten Taker 0.06%) + 70/30 Split bei Profit
     ↓
StatsCore.invalidate() → StatsCore = Single Source of Truth

PARALLEL (V14.5):
RSSAggregator (setInterval 15 Min) → news_feed-DB
FearGreed.fetch (60-Min-Cache) → market_sentiment-DB
NewsSentiment.fetch → liest news_feed → cache.riskScore (statisch 30 solang enabled=false)
```

---

## 🆕 V14.6 TAGESERGEBNISSE — 12.05.2026

### Welle 2a (Brain-Empowerment, deployed 07:12-08:10)

**Architektur-Eingriff:** Brain bekommt erstmals scharfen Veto-Mechanismus statt nur Confidence-Verstärker.

**Patches:**
- `CFG.SCORE_FLOOR = 0.08` (alt: 0.04) — Direction-Schwelle für UnifiedScore
- `CFG.SCORE_FLOOR_MODE = 'log_only'` — Christian's Option C: Floor nur loggen, nicht aktiv blocken
- Modul `BrainVeto` (server.js:6534+) mit 5 konservativen Bedingungen:
  1. `brain.decision === 'HOLD'`
  2. `brain.confidence < 0.05`
  3. `brain.reason.includes('NO_CONSENSUS')`
  4. `unified.confidence < 0.15`
  5. `unified.direction !== 'HOLD'`
- Tabelle `blocked_trades` (13 Cols inkl. `theoretical_block`)
- Endpoints `/api/blocked/recent`, `/api/blocked/stats`
- Telegram `/blocks` (real vs theoretical getrennt)
- Dashboard-Zeile "🚫 Blockiert heute: N echt / M theoretisch"

**Live-Beweis (30s nach Restart):** BTCUSDT BUY blockiert mit uScore=0.066 + brainConf=0.0 NO_CONSENSUS. Welle 2a wirkte sofort wie spec'd.

**Mess-Daten T+60:** 22 Blocks total (10 real VETO + 12 theoretical FLOOR), Memory stabil 77-90 MB, 5 offene Positionen unberührt.

**Simulation-Befund (Phase F, n=30):** VETO 100% Hit-Rate auf Verlust-Trades (3/3 NO_CONSENSUS-Verluste verhindert, -2.58 USDT eingespart). FLOOR=0.08 hätte 3 Winner blockiert (+2.69 USDT verloren) — daher log_only-Mode korrekte Wahl.

### Welle 2c (RSS-Pipeline-Ausbau, deployed 09:25)

**Architektur-Eingriff:** RSS-Quellen 5→12 erweitert, Polling-Frequenz beschleunigt, Source-Quality-Weighting.

**Patches:**
- `RSSAggregator.SOURCES`: 12 Quellen (5 alt + 7 neu: bitcoincom/cryptoslate/bitcoinist/newsbtc/ambcrypto/utoday/reddit_crypto)
- `qualityScore` 0.7-1.0 pro Quelle (Tier-1 Mainstream = 1.0, Tier-3 Reddit = 0.7)
- `TTL_MS`: 900000 → **600000** (15 → 10 Min Polling)
- `MIN_POSTS_HEALTHY = 6` für Volumen-Health-Indikator
- Score-Weighting beim Insert: `neg/pos × qualityScore` verhindert Müll-Verzerrung
- Telegram `/sentiment` erweitert um Posts/h + Source-Count + Filter-Status

**Live-Effekt (35 Min nach Restart):** **112 Posts** (~192/h Hochrechnung, **16× mehr als vor Welle 2c**). 11/12 Quellen aktiv (Reddit 403 war temporär, jetzt 200 — keine Code-Korrektur nötig).

### Welle 2b (News-Aktivierung, deployed gleichzeitig 09:25)

**Architektur-Eingriff:** Brain bekommt LIVE News-Sentiment-Score (war bisher statisch riskScore=30).

**Patches:**
- `NewsSentiment.enabled = true` (Default)
- Mapping halbiert (server.js:6433):
  - alt: `r>70→-0.8, r>50→-0.3, r<15→+0.3, r>80→NEWS_EXTREME`
  - neu: `r>70→-0.4, r>50→-0.15, r<15→+0.15, r>85→NEWS_EXTREME`
- **Article-Count-Filter ≥10**: bei <10 Posts/h → `ns=0` (Brain bekommt NEUTRAL trotz Risk-Daten)
- Warning-Text aktualisiert: "News-Aggregation LIVE im Brain (Welle 2b)"
- Dashboard-Zeile "📰 News-Risk" mit Farb-Indikator + Tooltip

**Belegt durch Praxis (Quellen):** Sentiment-Schwelle ±0.05 (cryptocontrol-bot), Article-Count-Filter ≥10 (CyberPunkMetalHead/Binance-News-Sentiment-Bot), halbiertes Mapping konservativ wegen SENTIMENT 0.25-Familie-Gewicht.

**Live-Status T+30:** `news.enabled=true`, postCount=11 (knapp über Filter), riskScore=23.5, signal=NORMAL. Filter greift gerade noch — Welle-2c-Volumen-Boost bringt das auf gesundes Niveau.

### Tier-Z Sammelpatch (auf Disk, wartet F2)

- **Z.1** wartung.sh-LaunchAgent **deaktiviert** (mv .plist → .disabled.20260512, launchctl unload). Exit-Code 127 in launchctl-Logs verschwindet.
- **Z.2** `WalletProvider.applyPnL` (server.js:5827+): neue Op `PROFIT_SPLIT_RESERVE` mit `amount=pnl*0.7, reason='auto-split-on-profit'`. Doppel-Entry-Buchhaltung für 70/30-Audit. Nur bei `pnl > 0`.
- **Z.3** Slider-Subtitle in `public/index.html`: "Slider regelt nur Cash-Anteil. Reserve + offene Positionen bleiben unangetastet."
- **Z.4** `DBJanitor` Set-basierte Suppression: `_alertedIds Set`, `_muted: true` Default (Dedup-Filter aktiv). Dedup-Key: `reason|symbol|where` (stabil über Scans). Auto-Reset täglich 04:00. Plus `/janitor mute on|off|status|reset` Telegram-Command.

**Tests:** 14/14 grün.

### Tier-Z2 5-Jahre-Backtest-Erweiterung — ✅ DEPLOY-COMPLETE (10:50, Christian-Approval 11:00)

**Co-Deploy-Status:** Tier-Z2-Code lag seit Build (10:00) auf Disk und wurde mit dem Tier-Z F2-Restart um 10:49:34 **automatisch mit-geladen**. Christian hat Tier-Z2 nachträglich um 11:00 explizit autorisiert — Engineering-Sauberkeit hergestellt.

**Engineering-Lesson:** Code auf Disk wird beim nächsten Restart automatisch geladen. Bei sequenziellem Deploy bewusst handhaben (entweder Patches einzeln bauen+deployen, oder Co-Deploy mit Approval-Reihenfolge transparent dokumentieren).

**6 Patches alle live + getestet 26/26:**
- ✅ P1 candleMap `{1: 9000, 2: 17500, 3: 26000, 5: 43800}`
- ✅ P2 Frontend-Button "🚀🚀🚀🚀 BATCH 5J VOLL" (Gold-Style, Zyklus-Tooltip)
- ✅ P3 Multi-Call-Loop **war bereits in Bitget.fetchCandles** (Z.1056-1075) — Verifikation reichte, kein Code-Change
- ✅ P4 `Bitget.getSymbolOpenTime()` + `getCoinCoverage()` Helper (24h-Cache) — junge Coins (ARB/SUI/SEI 2023, OP/APT 2022) nehmen max verfügbar
- ✅ P5 UI: "BUFFER AKTUELL" + "🧠 Trainierte Modelle: RF=83% GB=83% PC=81%" (Forensik-Befund: UI-Anzeige war misleading, kein Pipeline-Bug)
- ✅ P6 Resume-Mechanismus: `backtest_state`-Tabelle + 5 Prepared Statements + 3 API-Endpoints (`/api/backtest/coverage`, `/api/backtest/state` GET/POST). Frontend `_runJobsSequentially(jobs, runId)` mit completedSet-Skip. Run-ID-Format: `BATCH_${years}J_${date}`.

**Bitget-API live verifiziert:** `openTime` Field-Name korrekt (ARB: 1679576400000 = 2023-03-23 Listing), `history-candles`-Endpoint liefert 2020-Daten, Rate-Limit 20/sec/IP (200ms-Sleep im Bot = sicher unter 10/sec).

**Dormant bis 5J-Backtest-Start:** Tier-Z2-Funktionalität greift erst beim UI-Button-Click `runHistoryBatch(5)`. Aktueller Bot unbeeinflusst (Backtest-Compute läuft sequenziell zur Live-Bot-Pipeline).

**Spec-File:** `~/NEXUS_CLEAN/.tier_z2_spec.txt` (DEPLOY-COMPLETE-Marker eingefügt)

---

### Tier-Z2 5-Jahre-Backtest (auf Disk, wartet F2) — VERALTET, siehe oben

**Ziel:** Brain-Modelle aus komplettem Markt-Zyklus 2020-2025 (Corona + Bull + Bear + Halving).

**Patches:**
- `candleMap = {1:9000, 2:17500, 3:26000, 5:43800}` (5×8760)
- Frontend-Button "🚀🚀🚀🚀 BATCH 5J VOLL ~44000 Kerzen" (Gold-Style, Zyklus-Tooltip)
- `Bitget.fetchCandles` Multi-Call-Loop: **bereits implementiert** (Z.1056-1075) — bei `limit > 1000` iteriert über `history-candles`-Endpoint mit 200ms-Sleep
- `Bitget.getSymbolOpenTime()` + `getCoinCoverage()` Helper (24h-Cache) — für Coin-Listing-Datum-Check (junge Coins wie ARB/SUI/SEI nehmen max verfügbar)
- UI `BUFFER AKTUELL` statt "ML-BUFFER" + neue Zeile "🧠 Trainierte Modelle: RF=83% GB=83% PC=81%" (Backtest-Forensik-Befund: UI-Anzeige war misleading, kein Pipeline-Bug)
- **Resume-Mechanismus:** Tabelle `backtest_state` + 5 Prepared Statements + 3 API-Endpoints. Frontend `_runJobsSequentially(jobs, runId)` mit completedSet-Skip. Run-ID: `BATCH_${years}J_${date}`.

**Tests:** 26/26 grün. **Bitget-API live verifiziert:** `openTime` Field-Name korrekt (ARB: 1679576400000 = 2023-03-23 Listing), `history-candles`-Endpoint liefert 2020-Daten.

### Reset Day Zero (Spec final, `~/NEXUS_CLEAN/.reset_day_zero_spec.txt`)

**Ziel:** Demo-Wallet → 1000 USDT, Trade-Stats archivieren, **Brain-Modelle behalten**.

**Kategorisierung:**
- **A (Archivieren):** trades (400), wallet_ledger (1170), blocked_trades (22), strategy_performance (11.824), aladdin_perf (152), balance_history (87.514), system_log (48.959), backtest_runs (696)
- **B (Behalten):** ml_models (3), rl_qtable (69), ml_state (2), news_feed (271+), market_sentiment (4), candle_cache, bot_settings, **aladdin_decisions** (16.509 — Read-Abhängigkeit Z.4303/9504)

**8-Schritt-Sequenz:** Pre-Check + Backup → DemoEngine.stop → Force-Close offene Positionen → ALTER TABLE RENAME → demo_wallet.json reset → demo_positions.json leeren → PM2 delete+start (Counter 0) → F1-F8 Verifikation.

**ML-Auto-Retrain pausieren** (`CFG.ML_AUTO_RETRAIN_PAUSED=true`) bis 50 frische Trades ODER 7 Tage.

**Bug #13 (Position-Persistence)** ist KEIN Reset-Hindernis bei korrekter Sequenz — durch DemoEngine.stop + demo_positions.json-leeren wird `_restoreDemoPositions()` neutralisiert.

---

### Engineering-Lessons (12.05.2026)

1. **"Erst System-Level checken"** (GR3) — crontab `sudo purge` stündlich gefunden, Tier-Y PM2-Hardening war unnötig
2. **"Recherche statt Raten"** (GR1) — 3 PM2-V8-Flag-Versuche gescheitert, WebSearch hätte Issue #1539 sofort gezeigt
3. **"Notwendigkeit vor Patch"** (GR2) — 6-Fragen-Check verhindert unnötige Patches
4. **"Architektur vor Symptom"** (GR5) — Welle 2c RSS-Ausbau statt Filter senken war richtige Engineer-Tiefe
5. **"Annahme verifizieren"** (GR4) — Reddit-403 war temporär, nicht permanent. Backtest-Pipeline funktioniert, UI war misleading.

### Tier-Z3 Security-Hardening (10:15, ohne Restart)

3 Mini-Patches, alle ohne Code-Änderung:
1. `chmod 600 ~/NEXUS_CLEAN/.env` — Permissions von `755` (world-readable) auf `600` (nur Owner). Andere User auf Mac mini können Bitget-/Telegram-Secrets nicht mehr lesen.
2. `.gitignore` erstellt mit: `.env`, `node_modules/`, `*.bak.*`, `nexus.db`, `.pm2/`, `data/demo_*.json`. Schutz vor versehentlichem `git init` mit Secret-Commit.
3. `.env.example` als Template (leere Keys) für Onboarding-Dokumentation.

**Bot lief durchgehend weiter** — `.env` wird beim Boot via `dotenv.config()` (server.js:7) geladen, danach im Memory. chmod beeinflusst aktive Sessions nicht. Bei nächstem Restart liest Owner (`christianheilig`) weiter wie zuvor.

### Bitget-API-Erkenntnisse

- `/api/v2/spot/market/candles` = recent (max 1000), nicht für >recent
- `/api/v2/spot/market/history-candles` = historisch (max 200/Call), für Multi-Call-Loop
- Rate-Limit: **20 Calls/sec/IP** (200ms-Sleep im Bot = sicher unter 10/sec)
- Symbol-Info: `/api/v2/spot/public/symbols?symbol=X` liefert `openTime` (Listing-Datum)
- 5J BTC verfügbar (Listing vor 2020), junge Coins kürzer (ARB seit 2023-03, SUI/SEI 2023, OP 2022, APT 2022)

---

## 🆕 V14.5 TAGESERGEBNISSE — DETAIL

### Tier 1.4a-mini (Market-Sentiment-Persistenz)

**Was rein kam:**
- 3 neue DB-Tabellen: `market_sentiment`, `news_feed` (Skelett), `bot_settings`
- `FearGreed.fetch()` erweitert: nach erfolgreichem alternative.me-Call werden die letzten 3 Tage in `market_sentiment` persistiert (Dedup über UNIQUE Index `(source, metric_name, ts)`)
- 2 neue Endpoints: `/api/sentiment/snapshot`, `/api/sentiment/history?days=N`
- 1 neuer Telegram-Command: `/sentiment`
- 6 neue prepared statements

**Tests:** `~/NEXUS_CLEAN/.tier1_4a_test.js` — 10/10 grün.

### Tier 1.4a-bis (5-RSS-Aggregator)

**Was rein kam:**
- `npm install rss-parser` (v3.13.0, MIT, +2 Mikropakete entities/xml2js)
- 3 neue `news_feed`-Spalten: `url`, `pub_date`, `risk_score`
- 2 neue Indices: `idx_nf_dedup` (UNIQUE partial auf source+url), `idx_nf_pubdate` (DESC)
- Neues Modul **`RSSAggregator`** (server.js:12623+) — 5 Quellen parallel via `Promise.allSettled`, 15-Min-Cache, 30s Boot-Delay, First-Run-Telegram-Alert
- `NewsSentiment.fetch()` Umbau (server.js:12530+) — liest aus `news_feed`-DB statt von toten Quellen (cryptocurrency.cv/CryptoPanic raus)
- Toggle-Trennung: `enabled=false` → `cache.riskScore=30` statisch (Brain blind), `cache.liveRisk` als Observability-Feld
- 1 neuer Endpoint: `GET /api/news/recent?limit=N`
- 1 neuer Telegram-Command: `/news`
- 4 neue prepared statements (`insertNewsFeed` auf 12 Cols, `getNewsFeedSince`, `countNewsFeedBySource`)

**Tests:** `~/NEXUS_CLEAN/.tier1_4a_bis_test.js` — 16/16 grün.

**Live nach Restart-2 (15:26):** 162 Posts in `news_feed` über alle 5 Sources (cryptonews 50, decrypt 38, cointelegraph 30, coindesk 25, theblock 19). Erster Top-Post mit Live-Scoring: risk=80 ("hack" + "attack" Keyword-Match).

### Welle 1 (12.05. 07:00-07:30)

**Was rein kam (2 von 3 Patches live):**

- ✅ **Patch A — Mute-Befehl** (server.js):
  - `TelegramAlarm.muteLevel: 'off'` (Default) + `setMute()`-Helper
  - Mute-Check in `alert()`: `muteLevel='on'` blockt INFO+WARN, CRITICAL+EMERGENCY immer durch
  - Telegram-Command `/mute on|off|critical|status`
  - In-Memory (kein Restart-Persist)
  - 11/11 Standalone-Tests grün

- ❌ **Patch B — PM2-Hardening: aufgegeben** (siehe PM2-Bug-Section). 3 Mechanismen versucht, alle gescheitert, aber **nicht nötig** weil System-Setup übernimmt.

- ✅ **Patch C — Janitor-Cleanup** (DB-Op via `~/NEXUS_CLEAN/.welle1_janitor_cleanup.sql`):
  - Neue Spalte `closed_at_archived INTEGER` in `trades`
  - 18 Phantom-Trades → `state='ARCHIVED_PHANTOM'`, `closed_at=NULL`, `closed_at_archived=original_ts`
  - 18 Audit-Einträge in `wallet_ledger` mit `op='PHANTOM_ARCHIVE'`
  - StatsCore-Whitelist (138 Strategy-Trades) **unverändert**
  - 5 offene Positionen unberührt
  - Transaktional (BEGIN/COMMIT), Rollback-SQL im File-Footer
  - 19/19 Standalone-Tests grün

**Tests:** `~/NEXUS_CLEAN/.welle1_test.js` — 19/19 grün (Mute + Janitor).

**Session-Log:** `~/NEXUS_CLEAN/.welle1_session_log.txt`

---

## 📡 RSS-QUELLEN (verifiziert 11.05.2026 14:25 UTC)

| # | Quelle | URL | Tier |
|---|---|---|---|
| 1 | CoinTelegraph | `https://cointelegraph.com/rss` | 1 |
| 2 | CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/` | 1 |
| 3 | Decrypt | `https://decrypt.co/feed` | 1 |
| 4 | crypto.news | `https://crypto.news/feed` | 1 |
| 5 | The Block | `https://www.theblock.co/rss.xml` | 1 |

**Aggregat-Volumen:** ~150-200 Unique-Posts pro Cache-Refresh. Pro Quelle 1 Call alle 15 Min → 480 Calls/Tag total (alle Quellen unkritisch).

**Boot-Pattern:** 30s Delay nach `RSSAggregator.start()`, dann erster `Promise.allSettled`-Fetch, danach `setInterval(15min)`.

**First-Run-Alert:**
- Erfolgsschwelle: ≥3/5 Sources fulfilled UND >0 Posts inserted → `🆕 RSS-AGGREGATOR GESTARTET` mit Source-Stats
- Fehler-Schwelle: <3/5 oder 0 inserts → `⚠️ RSS-AGGREGATOR FEHLER`
- Wird genau **einmal** pro Bot-Lifetime gesendet (`_firstRunCompleted` Flag)

---

## 🚫 TOTE QUELLEN (NICHT mehr versuchen)

| Quelle | Status seit | Befund |
|---|---|---|
| `cryptocurrency.cv/api/news` | 11.05.2026 | HTTP 402 `"DEPLOYMENT_DISABLED"` — Service-Shutdown |
| `cryptocurrency.cv/api/sentiment` | 11.05.2026 | HTTP 402 (Paid-Tier oder offline) |
| CryptoPanic Public (ohne Key) | 11.05.2026 | HTML statt JSON — Auth-Token zwingend |
| `api.senticrypt.com` | 11.05.2026 | DNS-tot, auch `senticrypt.com`/`api.senticrypt.io` |
| `cryptocurrency.cv` Self-Hosting | abgelehnt | 280 MB Repo, Postgres-Abhängigkeit, 8 GB Build-Heap, Lizenz NOASSERTION |
| CoinGecko News API | abgelehnt | Paid-only, kein Free-Tier |

**Bot-Code-Status:** Alle Aufrufe der toten Quellen wurden in Tier 1.4a-bis entfernt. NewsSentiment.fetch() liest jetzt aus news_feed-DB.

---

## ⚙️ CFG-KONSTANTEN (V14.5)

In `server.js:60-90` Block:

```js
// Risk
RISK_PER_TRADE:        0.01,     // Tier 1.1: 1% Risk pro Trade
BASE_RISK_BUDGET:      0.02,     // DEPRECATED

// Tier 1.3 — Regime-Multiplier-Cap + Hysterese
REGIME_MULT_CAP:       1.4,
REGIME_STABLE_BUFFER:  3,
REGIME_STABLE_MIN:     2,

// Tier 1b.1 — Slot-Range
MAX_OPEN_TRADES:       5,
MIN_SLOTS:             1,
MAX_SLOTS:             20,
```

Plus weitere V14.4-Konstanten: `RESERVE_RATIO 0.70`, `TRADING_RATIO 0.30`, `MAX_POSITION_PCT 0.10`, `MAKER_FEE 0.0002`, `TAKER_FEE 0.0006`, `MIN_POSITION_USDT 5`.

---

## 🧩 MODULE (V14.5 erweitert)

### `StatsCore` (Z.4563+) — Single Source of Truth für Stats
```js
StatsCore.getStats({ useCache: true }) → { total, wins, losses, winRate, totalPnl, today, week, liveReady, gates, gatesScore, ts, source, cached }
StatsCore.invalidate()
```

### `RiskSizing` (Z.4688+) — Pure-Function Position-Sizing
```js
RiskSizing.calculate({ tradingBalance, confidence, slPct, regimeMult, volatilityMult }) → { size, skip, reason, ... }
```
Konstanten: `SL_FLOOR=0.005`, `SKIP_BELOW_SIZE=2.5`, Schwellen 0.05/0.10/0.20 → mult 0/0.5/0.75/1.0.

### `RegimeStrength` (Z.4803+) — Regime-Klassifikation + Hysterese
```js
RegimeStrength.classify({regime, adx, confidence, volatility, trend}) → { class, mult }
RegimeStrength.stableClassify(symbol, inputs) → { class, mult, raw, stable, bufferSize }
```
Hysterese 2-aus-3 pro Symbol, In-Memory.

### `FearGreed` (Z.11282+) — alternative.me + DB-Persistenz (V14.5 erweitert)
```js
FearGreed.fetch() → { value, label, yesterday, lastWeek, trend, signal, ts }
// Tier 1.4a-mini: schreibt nach fetch 3 Tage in market_sentiment (Dedup via UNIQUE Index)
FearGreed.shouldBlock(direction) → { block, reason, fg }
```

### `NewsSentiment` (Z.12497+) — DB-Reader (V14.5 umgebaut)
```js
NewsSentiment.fetch() → { riskScore, liveRisk, negScore, posScore, postCount, alerts, signal, ts, source }
// V14.5: liest aus news_feed-DB (letzte 60 Min); enabled=false → riskScore bleibt 30
NewsSentiment.shouldModify(direction) → { modify, factor, reason }
```

### `RSSAggregator` (Z.12623+) — 5-RSS-Aggregator (V14.5 neu)
```js
RSSAggregator.SOURCES // 5 Quellen aus Spec
RSSAggregator.fetch() → { sources, ok, fetched, inserted, sourceStats, ts }
RSSAggregator.start() // setInterval 15 Min, 30s Boot-Delay
RSSAggregator.snapshot() → { ..., firstRunCompleted }
```

---

## 🗄️ DB-SPALTEN-ÜBERBLICK (V14.5)

### `trades` (V14.4 Audit-Spalten)
Existierende + 6 neue: `entry_confidence`, `entry_sl_pct`, `entry_risk_mult`, `entry_size_source`, `entry_regime_class`, `entry_regime_mult`.

### `market_sentiment` (V14.5 neu)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
ts INTEGER NOT NULL,
source TEXT NOT NULL,
metric_name TEXT NOT NULL,
metric_value REAL,
metric_classification TEXT,
raw_json TEXT
-- + UNIQUE INDEX idx_ms_dedup ON (source, metric_name, ts)
-- + INDEX idx_ms_ts, idx_ms_source_ts
```

### `news_feed` (V14.5 neu, 12 Cols)
```sql
id, ts, source, title, domain,
neg_score REAL DEFAULT 0, pos_score REAL DEFAULT 0,
alert_flag INTEGER DEFAULT 0,
symbols_json TEXT, raw_json TEXT,
url TEXT, pub_date INTEGER, risk_score INTEGER
-- + UNIQUE INDEX idx_nf_dedup ON (source, url) WHERE url IS NOT NULL
-- + INDEX idx_nf_pubdate ON (pub_date DESC), idx_nf_ts, idx_nf_alert
```

### `bot_settings` (V14.5 neu, Skelett für persistente Toggles)
```sql
key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER
```

---

## 🌐 API-ENDPOINTS (V14.5)

| Endpoint | Methode | Tier | Zweck |
|---|---|---|---|
| `/api/stats/strategy` | GET | V14.4 | StatsCore-Stats (Whitelist) |
| `/api/regime/snapshot` | GET | V14.4 | RegimeStrength-State |
| `/api/slots/snapshot` + `/api/slots/set` | GET/POST | V14.4 | Dynamic Slots |
| **`/api/sentiment/snapshot`** | GET | **V14.5** | Fear&Greed + News-State |
| **`/api/sentiment/history?days=N`** | GET | **V14.5** | market_sentiment-Range |
| **`/api/news/recent?limit=N`** | GET | **V14.5** | live news_feed-Query |
| `/api/bots/dashboard` | GET | bestehend | StatsCore + Wallet + Portfolio |
| `/api/budget/snapshot` + `/api/budget/set` | GET/POST | bestehend | Budget-Slider |
| `/api/recon/check` | GET | bestehend | Reconciliation |
| `/api/guardian/status` | GET | bestehend | ConsistencyGuardian |

---

## 📱 TELEGRAM-COMMANDS (V14.5)

```
/status         → Bot-Status
/balance        → Demo-aware Wallet
/trades         → offene Positionen
/report         → Tagesbericht (StatsCore)
/slots          → Slot-Steuerung (V14.4)
/slots N        → MAX_OPEN_TRADES auf N
/slots auto     → Smart-Empfehlung
/sentiment      → Fear & Greed + News-Status (V14.5)
/news           → RSS-Aggregator Quick-View (V14.5)
/safe           → Safe-Modus
/stop           → Bot stoppen
```

---

## 🧠 BRAIN-STATUS (V14.5)

### Aktuelle Konfiguration
- `NewsSentiment.enabled = false` (Hardcode-Default in server.js:12498)
- `cache.riskScore = 30` statisch trotz live aggregierter Daten (`cache.liveRisk` zeigt die echten Werte)
- SENTIMENT-Familie im Brain bekommt News-Score=30 → effektiv blind auf der News-Achse
- Fear&Greed Score läuft live in SENTIMENT-Familie weiter (alternative.me 60-Min-Cache)

### Warum blind?
Tier 1.4a-bis sammelt Daten ohne Brain-Verhaltens-Änderung. Daten-Qualität muss erst 24-48h beobachtet werden:
- Keyword-Treffer pro Tag (Stichprobe)
- riskScore-Verteilung (Histogramm)
- False-Positive-Rate (zu aggressives Scoring vermeiden)

### Aktivierung in Tier 1.4b
Wenn Daten-Qualität validiert: `NewsSentiment.enabled = true` setzen (oder via `/news enable` Telegram falls Implementierung). Dann reagiert das Brain über `scores.news` (server.js:6395) auf riskScore.

### Empirische FAMILY_WEIGHTS (Tier 1.1b' Daten-getrieben, V14.4)
| Familie | WR | Gewicht alt | Gewicht neu |
|---|---:|---:|---:|
| SENTIMENT | 51.2% | 0.15 | **0.25** ↑ |
| MICROSTRUCTURE | 44.0% | 0.15 | 0.20 ↑ |
| TREND | 43.5% | 0.25 | 0.20 ↓ |
| RISK | 43.1% | 0.25 | 0.20 ↓ |
| MOMENTUM | 34.8% | 0.20 | **0.15** ↓ |

Nach 50+ neuen Trades neu auditieren (R3-Topic).

---

## 🆕 WELLE 2a (12.05. ~08:00) — Brain-Empowerment-Pakete

**Status:** Code+DB+UI deployed auf Disk, **wartet auf F2-Approval**. Bot läuft noch mit altem Code.

### 6 Patches deployed

1. **CFG.SCORE_FLOOR 0.04 → 0.08** (server.js:88+) — UnifiedScore-Direction-Schwelle erhöht. Plus `SCORE_FLOOR_OLD=0.04` für Floor-Block-Erkennung.
2. **`BrainVeto`-Modul** (server.js:6534+) — konservativer Veto: Brain HOLD + conf<0.05 + NO_CONSENSUS + Unified conf<0.15 + Unified !=HOLD → block. Plus `logBlock()` für DB-Persistenz.
3. **`blocked_trades`-Tabelle + Indices** (DB) — `id, ts, symbol, intended_direction, block_reason, unified_score, unified_confidence, brain_decision, brain_confidence, brain_reason, family_scores, market_price, details_json`. 3 Indices.
4. **DemoEngine._cycle Integration** (server.js:14206+) — Floor-Block-Logging vor HOLD-skip + Brain-Veto-Check vor _executeTrade.
5. **API-Endpoints** (server.js:7740+): `GET /api/blocked/recent?limit=N` + `GET /api/blocked/stats?period=today|24h|7d|all`.
6. **Telegram `/blocks`** (server.js:11296+): `/blocks`, `/blocks N`, `/blocks today`.

### Plus Dashboard
- `public/index.html`: kleine Zeile "🚫 Blockiert heute: N (F:X · V:Y)" in KAPITAL-Karte
- JS `loadBlockedStats()` in 15s-Refresh-Loop integriert

### Tests: 25/25 grün
`~/NEXUS_CLEAN/.welle2a_test.js` — Direction-Schwelle (10), Brain-Veto-Logik (10), DB-Persistenz (5).

### Simulation mit 30 historischen Trades (kritischer Befund)

| Metric | Wert |
|---|---|
| Total PnL 30 Trades | +0.512 USDT |
| Nach Block-Simulation | +0.405 USDT |
| **PnL-Differenz** | **-0.107 USDT** (marginal schlechter) |
| FLOOR-Block | 6 Trades (3W/3L), PnL +0.107 — neutral |
| VETO-Block | 3 Trades (0W/3L), PnL -2.580 — **alle echte Verluste** ✅ |
| Overlap | 3 (alle VETO-Trades sind auch FLOOR-Trades) |
| WR-Effekt | 36.7% → 33.3% (-3.3 Pp) |

**Architektur-Erkenntnis (GR5):**
- **VETO ist sehr selektiv und effektiv** — 100% Hit-Rate auf Verlust-Trades in der Sample
- **FLOOR-only-Blocks (3 Trades) waren alle Winner** — XRPUSDT +0.34, LINKUSDT +1.02, SEIUSDT +1.32. FLOOR=0.08 ist möglicherweise zu aggressiv.
- **Sample n=30 ist klein** — definitive Aussage erst nach 50-100+ Trades nach Live-Schaltung

### Offene Frage für Christian (Welle 2a vor F2)
- FLOOR 0.08 wie spec'd lassen → empirisch in Live-Beobachtung
- ODER FLOOR vor F2 anpassen (z.B. 0.06)
- ODER FLOOR vorerst nur loggen, nicht aktiv blocken

VETO-Mechanismus ist in jedem Fall empfehlenswert.

---

## 🖥️ SYSTEM-SETUP MAC MINI (entdeckt 12.05. via GR3)

Mac mini macht **schon System-Level-RAM-Management**, unabhängig vom Bot. Wichtig zu wissen vor neuen Memory/Wartungs-Patches.

### User-crontab (`crontab -l`)
```
0 * * * * sudo purge
0 3 */3 * * cd ~/NEXUS_CLEAN && node -e "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"
```
- **Stündlich `sudo purge`** — macOS-Befehl, leert Filesystem-Cache + inactive Memory. **Achtung (Vermutung):** `sudo -n -l` sagt "password required" → cron könnte silent-fail haben, außer NOPASSWD-Eintrag in `/etc/sudoers` (Christian verifiziert separat).
- **Alle 3 Tage 03:00 SQLite-VACUUM** — hält nexus.db kompakt (Beweis: 53M → 44M zwischen TIER14A_BIS-Backup gestern Abend und WELLE1-Backup heute Morgen).

### User-LaunchAgents (`~/Library/LaunchAgents/`)
- `com.christian.nexus-wartung.plist` — täglich 04:00, ruft `~/Desktop/NEXUS_SONNTAG/wartung.sh`. **Script existiert nicht mehr** → `launchctl list` zeigt Exit-Code 127. **Tier-Z Cleanup-Punkt:** entweder `launchctl unload` oder Script neu erstellen.
- `pm2.christianheilig.plist` (root) — PM2-Auto-Start beim Boot ✅

### macOS Memory-Architecture (sysctl)
- `vm.swapusage`: 2 GB total, ~535 MB used, ~1.5 GB free
- `kern.memorystatus_purge_on_warning=2`, `purge_on_urgent=5`, `purge_on_critical=8`
- macOS purged proaktiv (sysctl zeigt 8,504,977 pages purged seit Boot-Snapshot)

### Konsequenz für Bot-Patches
- Memory-Management ist **bereits gelöst auf System-Ebene**
- `--expose-gc` für `global.gc()` ist unnötig (Bot ruft global.gc() nirgendwo)
- `--max-old-space-size` als Heap-Cap ist optional (Bot bei 87-110 MB von Default-Limit ~4 GB)
- Neue Patches MÜSSEN prüfen ob System-Mechanismus schon greift

---

## 🐛 PM2 V8-FLAG-BUG (V14.5 dokumentiert)

**Vermutung** (3 Beobachtungen, keine Source-Verifikation): PM2 v6.0.14 + fork_mode + macOS arm64 + Node v20.20.2 propagiert `node_args` nicht an den Child-Prozess.

### Drei Versuche, alle gescheitert
1. **Tier-Y (11.05.):** `ecosystem.config.js` mit `node_args: '--expose-gc --max-old-space-size=2048'` → pm2 describe zeigt Flags, `ps aux` zeigt sie nicht
2. **F2b (12.05. 07:12):** `NODE_OPTIONS="..." pm2 restart` → PM2-Env-Map hat NODE_OPTIONS, Process-Env nicht
3. **F2c (12.05. 07:19):** `pm2 start server.js --node-args="..."` (CLI-Methode) → gleiches Symptom

### Bekannte GitHub-Issues
- [#1539](https://github.com/Unitech/pm2/issues/1539) (Aug 2015, noch offen): "How can i pass node-options to pm2 ecosystem?"
- [#2000](https://github.com/Unitech/pm2/issues/2000): "node_args not passed in cluster mode" (unsere ist fork)
- [#3598](https://github.com/Unitech/pm2/issues/3598): "interpreter_args not getting passed"
- [#4059](https://github.com/Unitech/pm2/issues/4059): "pm2 restart does not reuse node_args"
- [#45](https://github.com/Unitech/pm2/issues/45): "Where to put node options and v8 options?"

### Fallback-Optionen (falls eines Tages doch nötig)
- **Wrapper-Script** (Option D, nicht implementiert): `~/NEXUS_CLEAN/start.sh` mit `exec node --expose-gc --max-old-space-size=2048 server.js`, dann `pm2 start start.sh --interpreter bash`. Bash-exec umgeht PM2-Spawn-Filter.
- **`expose-gc` npm-Package** (Option E): exposes `global.gc()` ohne Node-Flag. Aber `--max-old-space-size` ist V8-Init-Time, nicht runtime-setzbar.
- **PM2-Version-Upgrade**: v6.x ist aktuell, Issue ist v3.x-stabil bekannt. Upgrade-Risiko unklar.

### Aktuelle Entscheidung (12.05.)
Patch B aufgegeben — **nicht nötig** weil System-Setup (crontab `sudo purge` + macOS `memorystatus`) den eigentlichen Zweck (Memory-Free-Halten) erfüllt. 6-Fragen-Check rückwirkend negativ:
1. Akut? Nein (Bot 14h+ stabil)
2. Schon gelöst? Ja (System-Level)
3. Positiv? Marginal (global.gc() ungenutzt)
4. Negativ? 3 Restart-Versuche, Counter-Resets, ~45 min Diagnose
5. Alternative? Da (crontab läuft schon)
6. Wenn nicht? Bot läuft weiter wie bisher

---

## 🎓 LESSONS LEARNED 12.05.2026

### 1h in unnötigen Patch investiert
Welle 1 Patch B (PM2-V8-Flags) wurde 3× versucht bevor System-Setup geprüft wurde. Hätte 6-Fragen-Check (GR2) + System-Level-Check (GR3) vorher angewendet → Patch wäre nie gestartet worden.

### 5 Grundregeln eingeführt (in `~/.Codex/.../memory/`)
- **GR1** WebSearch zuerst bei Architektur-/Wert-Entscheidungen
- **GR2** Notwendigkeit vor Aktion (6 Fragen)
- **GR3** System-Level erkunden vor Bot-Code-Patch
- **GR4** Annahmen verifizieren (Vermutung markieren)
- **GR5** Architektur vor Symptom (Engineer-Tiefe wählen)

Diese gelten ab sofort für alle Sessions, persistiert im Memory-System.

### Vor jedem zukünftigen Patch ANZUWENDEN
1. WebSearch falls Werte/Patterns unklar (GR1)
2. 6-Fragen-Check (GR2): Notwendig? Schon gelöst? Positiv/Negativ? Alternative? Konsequenz?
3. System-Level prüfen (GR3): crontab, launchctl, sysctl, ~/.zshrc
4. Aussagen mit Belegen oder als Vermutung markieren (GR4)
5. Symptom vs. Architektur (GR5): wenn 2-3 Versuche scheitern, eine Ebene tiefer

---

## 🚀 ROADMAP-STAND (V14.5)

### ✅ Deployed (11.05.2026, kumuliert)
- Phase 1-4 Audit + 36 Fixes
- Bug #13 Position-Persistence
- Bug #14 Guardian-Hardening
- Tier 1.1 RiskSizing
- Tier 1.2 Fee-Logik in Demo
- Tier 1.3 RegimeStrength
- Tier 1.1b' Brain-Reparatur
- Bug-Bündel (SQUEEZE + Endpoint)
- Tier 1b.1+1b.2 Dynamic Slots (Backend + UI)
- **Tier 1.4a-mini** Market-Sentiment-Persistenz
- **Tier 1.4a-bis** 5-RSS-Aggregator

### 🔄 Offen — wartet auf Christian-Aktion
- **5-Jahre-Backtest-Lauf** — Tier-Z2 ist live & dormant. Christian klickt UI-Button `BATCH 5J VOLL` → ~40-80 Min autonomer Lauf. Resume-Mechanismus aktiv bei Crash.
- **Reset Day Zero** — Finale nach 5J-Backtest. Spec final in `~/NEXUS_CLEAN/.reset_day_zero_spec.txt`. Brain-Modelle bleiben erhalten (Kategorie B).

### 🔄 Offen — kleine Schritte
- **Tier-Y/Welle1 Patch B** PM2-Hardening: **aufgegeben** (System-Setup übernimmt). Wrapper-Script-Option dokumentiert.
- **Tier 1.4b** Brain-Aktivierung: ✅ HEUTE als Welle 2b deployed.
- **Welle 2 Brain-Empowerment**: ✅ HEUTE als Welle 2a deployed.

### 🔄 Offen — größere Features
- **R3 Brain-Architektur-Review** — nach 50+ neuen Trades empirisch evaluieren ob FAMILY_WEIGHTS weiter anpassen
- **News-Auto-Cleanup** (~7-14 Tage Retention) — wenn news_feed groß wird (aktuell vernachlässigbar)
- **Tier 1.4c** Newsfeed-UI-Tab — wenn Christian's Dashboard erweitert werden soll

### ⏸️ Deferred
- **Bug #9** WalletReconciler-Approval-Workflow (nicht akut)
- **Tier 1.5** Multi-Modus-Engine (BULL/SQUEEZE/BEAR) — siehe V14-Kapitel
- **Tier 2.5** Premium-Features (Order-Book-Watcher, Whale-Trigger, Crash-Insurance, Pyramiding)
- **Reddit RSS** (`r/cryptocurrency.rss`) — Atom-Format, braucht User-Agent, Tier-2 für später
- **Bitcoin.com RSS** — niedriges Volumen (10 items), Tier-2 für später

---

## 🐛 BEKANNTE BUGS / KOSMETIK

### Snapshot-Warning veraltet (Tier-Y Patch 1) — ✅ GEFIXT
`/api/sentiment/snapshot.news.warning` und Telegram-Fallback (server.js:11269) zeigen jetzt korrekten "News-Aggregation aktiv"-Text. Deployed mit Tier-Y Patch 1 nach Restart-2 von Tier-Y.

### Slot-Wert nicht persistiert (by Design)
`CFG.MAX_OPEN_TRADES` ist In-Memory. Nach PM2-Restart fällt der Wert auf Default 5 zurück.

### PM2-Hardening Patch 2 fehlgeschlagen — ⚠️ ROLLBACK
Tier-Y Patch 2 wollte `--expose-gc` + `--max-old-space-size=2048` + `max_memory_restart=1G` via `ecosystem.config.js` aktivieren. Ergebnis nach `pm2 start ecosystem.config.js`:
- `pm2 jlist` zeigt `node_args` korrekt geladen ✅
- `pm2 describe` zeigt `interpreter args: --expose-gc --max-old-space-size=2048` ✅
- **ABER `ps aux` zeigt die Flags NICHT** im laufenden Node-Prozess ❌
- Beweis dass macOS-ps die Flags grundsätzlich anzeigen kann: direkter Bash-`node --expose-gc -e ...` Spawn zeigt sie klar

**Root-Cause:** unklar — entweder PM2-Bug oder macOS-`fork_mode`-Eigenheit. PM2 spawnt Node, übergibt die `node_args` aber nicht an den Child-Prozess.

**Retry-Pfad (Tier-Y-Retry):**
1. **NODE_OPTIONS-Methode:** `NODE_OPTIONS="--expose-gc --max-old-space-size=2048" pm2 restart nexus --update-env` — umgeht ecosystem-File komplett, setzt Flags via Env-Var die V8 direkt liest
2. **PM2-CLI-Direct:** `pm2 start server.js --name nexus --node-args "--expose-gc --max-old-space-size=2048"` (bypassed Config-File)
3. **PM2-Version-Update:** falls aktuelle Version Bug hat

`ecosystem.config.js` liegt auf Disk für späteren Retry. Aktueller Bot läuft ohne Flags (wie vor Tier-Y) — kein akutes Problem, Safety-Net fehlt weiterhin.

---

## 💾 BACKUPS (Tagesübersicht 11.05.2026)

### server.js Backups (alle in `~/NEXUS_CLEAN/`)
| Größe | Tag | Zweck |
|---:|---|---|
| 737K | PHASE1, BUG13, PHASE2, BUG14, PHASE4 | V14 Audit |
| 747K | FEE, TIER11 | Tier 1.2 + Tier 1.1 |
| 758K | TIER13 | Tier 1.3 |
| 767K | TIER11B | Tier 1.1b' |
| 768K | BUGBUNDLE, TIER1B1 | Bug-Bündel + Slots |
| 774K | TIER14A_MINI | Tier 1.4a-mini |
| **778K** | **TIER14A_BIS_20260511_152048** | Tier 1.4a-bis |

### nexus.db Backups
- TIER14A_BIS-Tag (heute Nachmittag, 53 MB)

### AGENTS.md Backups
- `AGENTS.md.bak.V14_4_20260511_153621` (V14.4 vor V14.5-Konsolidierung)

**Rollback-Aufwand:** `cp <backup> <original> && pm2 restart nexus` ≈ 3 Min.

---

## 🎯 CHRISTIAN'S VISION (unverändert seit V13)

> *"Ein vollständig autonomer Bot, der zu den besten gehört, mit minimalen Verlusten, mit echtem Geldverdienst-Potenzial."*

- Vollständig autonom
- Capital Preservation > Returns
- Konsistent profitabel (Sharpe > 1.0)
- Skalierbar (1k bis 50k USDT)
- Maserati-Niveau (3-8%/Monat), nicht Bugatti (Renaissance Medallion)

**Schlüsselzitate:**
- *"Bist du die KI oder ich finde die beste Lösung?"* → Eigenverantwortlich entscheiden
- *"Demo soll 1:1 wie LIVE arbeiten."* ✅ erfüllt seit heute
- *"Brain ist der Kopf vom Bot, darüber läuft jede Entscheidung."* ✅ seit Tier 1.1b'
- *"Hauptsache mein Ziel ist, den geilsten Bot kreiert zu haben."*
- *"Ich vertraue dir, mach was du für richtig hältst."*

---

## ⏱️ ARBEITSPHILOSOPHIE

### Drei verbindliche Prinzipien
1. **Quality over Speed** — fertig wenn fertig
2. **Sauber statt schnell** — jeder Schritt verifiziert, Backup vor jeder Änderung
3. **Kein Stress** — Ruhe führt zu Qualität

### Mit-Engineer-Modus
- Bei Entscheidungen: Optionen + eigene Empfehlung zeigen
- Format: *"Ich würde X machen weil Y, willst du das?"*
- Eigene Verbesserungen vorschlagen, widersprechen wenn bessere Lösung erkannt
- Bei Unsicherheit: **selbst recherchieren** statt fragen (2-3 Quellen)

### Verbindliche Regeln
- **Keine stillen Korrekturen** — alle Eingriffe ins Audit-Log
- **Kein Hebel, kein Kredit — niemals**
- **Backup vor jeder Änderung** mit Timestamp
- **Recherche statt fragen** — bei Unklarheit min 2-3 Quellen
- **Demo=Live ist heilig** — neue Features die das verletzen → nicht bauen
- **`StatsCore` ist Single Source** — niemals eigene Stats-SQL schreiben
- **70/30 = 70% des PROFITS** — nicht des Kapitals
- **Stille Fehler verboten** (Tier 1.4a-mini-Lehre) — Catch-Blöcke MÜSSEN loggen, nicht schlucken
- **Lizenz-konform** — kein Code aus fremden Repos ohne Lizenz-Klarheit

---

## 🛡️ ARCHITEKTUR-HIGHLIGHTS

### 5 Schutz-Schichten
1. **Pre-Trade-Gates** (17 Sicherheits-Checks)
2. **ConsistencyGuardian** (30s-Watchdog, Bug-#14-gehärtet)
3. **Janitor** (Phantom-Cleaner)
4. **Reconciliation** (4 Quellen-Cross-Check)
5. **AutonomousRepair** (ARS, 6 Stufen)

### Plus V14.4-1.4a-bis Schichten
6. **RiskSizing** (defensive Sizing mit SL-Floor + Skip-Schwellen)
7. **RegimeStrength** (Hysterese 2-aus-3, Stack-Cap 1.4)
8. **StatsCore** (Single Source, 5s-Cache)
9. **Position-Persistence** (Bug-#13-Fix)
10. **Dynamic Slots** (zur Laufzeit konfigurierbar)
11. **Market-Sentiment-Persistenz** (FG-DB, V14.5)
12. **RSS-News-Pipeline** (5 Quellen, news_feed-DB, V14.5)

---

## 🔑 BEFEHLE-CHEAT-SHEET

### Bot-Status (Quick-Check)
```bash
pm2 list
curl -s http://localhost:3000/api/demo/wallet | python3 -m json.tool
curl -s http://localhost:3000/api/stats/strategy | python3 -m json.tool
curl -s http://localhost:3000/api/demo/positions | python3 -c "import sys,json;print(len(json.load(sys.stdin)),'Positionen')"
curl -s http://localhost:3000/api/guardian/status | python3 -m json.tool
```

### V14.5-Endpoints prüfen
```bash
curl -s http://localhost:3000/api/sentiment/snapshot | python3 -m json.tool
curl -s "http://localhost:3000/api/sentiment/history?days=10" | python3 -m json.tool
curl -s "http://localhost:3000/api/news/recent?limit=10" | python3 -m json.tool
sqlite3 ~/NEXUS_CLEAN/nexus.db "SELECT source, count(*) FROM news_feed GROUP BY source"
sqlite3 ~/NEXUS_CLEAN/nexus.db "SELECT * FROM market_sentiment ORDER BY ts DESC"
```

### Backup vor Patch (Pflicht!)
```bash
cd ~/NEXUS_CLEAN
cp server.js server.js.bak.$(date +%Y%m%d_%H%M%S)
cp public/index.html public/index.html.bak.$(date +%Y%m%d_%H%M%S)
sqlite3 nexus.db ".backup '$HOME/NEXUS_CLEAN/nexus.db.bak.$(date +%Y%m%d_%H%M%S)'"
```

### PM2-Restart (KRITISCH — explizit fragen!)
```bash
node --check ~/NEXUS_CLEAN/server.js
pm2 restart nexus --update-env
sleep 15 && pm2 list
pm2 logs nexus --lines 30 --nostream
```

### Rollback bei Problem
```bash
cp ~/NEXUS_CLEAN/server.js.bak.<TIMESTAMP> ~/NEXUS_CLEAN/server.js
node --check ~/NEXUS_CLEAN/server.js
pm2 restart nexus --update-env
```

---

## 📊 BEOBACHTUNGS-PFLICHT (24-48h nach 1.4a-bis)

### Daten-Qualitätsprüfung vor Tier 1.4b Brain-Aktivierung

```sql
-- Q1: News-Volumen pro Source (sollten alle 5 liefern)
SELECT source, count(*) as posts_24h
FROM news_feed
WHERE ts > strftime('%s','now','-24 hour')*1000
GROUP BY source;

-- Q2: riskScore-Verteilung (Histogramm)
SELECT
  CASE WHEN risk_score >= 80 THEN 'CRITICAL_80+'
       WHEN risk_score >= 60 THEN 'HIGH_60-79'
       WHEN risk_score >= 45 THEN 'ELEVATED_45-59'
       WHEN risk_score >= 30 THEN 'NORMAL_30-44'
       ELSE 'BELOW_30' END as bucket,
  count(*) as n
FROM news_feed
WHERE pub_date > strftime('%s','now','-24 hour')*1000
GROUP BY bucket;

-- Q3: Top-10 Alerts (alert_flag=1)
SELECT source, title, risk_score, datetime(pub_date/1000,'unixepoch') as t
FROM news_feed
WHERE alert_flag = 1
ORDER BY risk_score DESC
LIMIT 10;
```

### R3 Brain-Forensik (nach 50+ neuen Trades)
Siehe V14.4-Section (Q1: Brain-Klassen-Verteilung, Q2: AGREE-WR-Vergleich). Wenn AGREE-WR > 50% → R3 nicht nötig.

---

## 🐛 BEKANNTE EIGENHEITEN (NICHT WEGFIXEN)

- **DemoEngine** hat eigenen Trade-Pfad (`_executeTrade`), nutzt **nicht** ExecFlow
- `Trades.close()` für `DEMO_UNIFIED` → 70/30 in `WalletProvider.applyPnL`
- **UnifiedScore Gewichte summieren zu 1.57** — korrekt (ws/tw normalisiert)
- **Wallet-Persistence** schreibt bei Exit, lädt bei Boot
- `DemoEngine.start()` überschreibt Wallet **NICHT** wenn von Disk geladen
- `_cycleBusy` wird am Ende JEDER `_cycle` zurückgesetzt
- **VolatilityRegime** ist separates Modul, in RiskSizing als 2. Multiplier-Schicht
- **Brain disagree mit UnifiedScore = 0 empirisch** — Brain ist Confidence-Verstärker, kein Direction-Filter
- **NewsSentiment.fetch()** wird in `UnifiedScore.compute()` (Z.6359) **ohne enabled-Check** aufgerufen — aber `enabled=false` macht cache.riskScore statisch 30, sodass Brain trotzdem blind bleibt
- **RSSAggregator läuft autonom via setInterval** — unabhängig vom NewsSentiment.enabled-Toggle

---

## 📞 ABSCHLUSS-MERKER

**Stand 11.05.2026 Abend:**
- 60+ Patches heute, 17 PM2-Restarts, alle sauber
- Demo=Live 1:1 erfüllt (11/11)
- Audit-Erfolgskriterien grün (7/7)
- 3 offene Positionen, robust gegen Restart
- Brain ohne Rate-Limit, Familien neu gewichtet
- 5 RSS-Feeds aktiv, 162+ News in DB, Brain noch blind
- 8 Tier-Module live

**Empfohlene nächste Schritte:**
1. **Tier-Y** PM2-Hardening + Snapshot-Warning-Fix (vorbereitet)
2. **24-48h Daten-Beobachtung** RSS-Pipeline → R3-Vorentscheidung für Tier 1.4b
3. **Tier 1.4b** Brain-Aktivierung mit News-Score (nach Daten-OK)
4. **R3** Brain-Audit (nach 50+ neuen Trades)

**MAX APO Deadline:** 21.05.2026 — 10 Tage. Kein Zeitdruck.

---

*Master-Handover V14.5 erstellt: 11.05.2026 ca. 15:35 Uhr*
*V14.5 erweitert: 12.05.2026 ca. 07:45 Uhr (System-Setup + PM2-Bug + Welle 1 + 5 Grundregeln + Lessons Learned)*
*V14.6 erweitert: 12.05.2026 ca. 10:10 Uhr (Welle 2a + Welle 2c + Welle 2b live; Tier-Z + Tier-Z2 + Reset-Spec auf Disk)*
*V14.6 finalisiert: 12.05.2026 ca. 11:00 Uhr (Tier-Z + Tier-Z2 + Tier-Z3 alle live, Welle 1, 2a, 2c+2b, Z, Z2, Z3 = 7/7 deployed)*

*Konsolidiert aus: V14.4 + 1.4a-mini + 1.4a-bis + Welle 1 (Mute+Janitor) + Welle 2a (Brain-Veto) + Welle 2c (12 RSS-Quellen) + Welle 2b (News live) + Tier-Z build + Tier-Z2 build + Reset-Spec*

*Bereit für nächste Session. Bot läuft. Brain mit News + Veto. RSS-Pipeline mit 12 Quellen ~190 Posts/h. Grundregeln + Memory-System. Architektur sauber. 5 Patches auf Disk warten auf F2-Approval.*
