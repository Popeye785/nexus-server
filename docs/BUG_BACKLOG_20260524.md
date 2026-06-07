# NEXUS V9 — BUG-BACKLOG
**Datum angelegt:** 2026-05-24 11:45
**Zweck:** Bekannte Bugs / UX-Issues die JETZT NICHT gefixt werden, sondern später-Pipeline

---

## OFFEN — Priorität niedrig

### BUG-BACKLOG-001 — Sternchen (*) in V9 Balance Engine unklar
**Datum entdeckt:** 2026-05-24
**Schwere:** UX (kein Funktions-Bug)
**Christian-Entscheidung:** später fixen, jetzt nicht prioritär

**Aktuell:**
```
RESERVE (SAFE)    196.62 (*)
CASH (TRADING)   1003.05 (*)
```

**Problem:** Sternchen ohne sichtbare Erklärung. Tooltip vorhanden im Code, aber nicht selbstevident:
> "Virtuell — Reserve füllt sich, sobald Daily-Realize-Cron läuft (geplant Stufe C)"

**Bedeutung tatsächlich:** SOLL-Wert nach Daily-Cron 23:55 inkl. ausstehendem 70/30-Split.

**Fix-Optionen (Christian-Wahl später):**

| Option | Beschreibung | Aufwand |
|---|---|---|
| A | Tooltip beim Hover prominenter (z.B. mit `*` als clickable Icon → Modal mit Erklärung) | 10 min |
| B | Klarere Beschriftung statt Sternchen: zwei Zeilen "RESERVE IST: 193.34 / RESERVE SOLL 23:55: 196.62 (+3.28)" | 30 min (Layout-Change) |
| C | Pfeil-Symbol ↗ statt * mit Tooltip "+X.XX bis 23:55" | 15 min |

**Code-Stelle:** `public/index.html:4127-4129` (capSafe/capRe Sternchen-Logik)

**Status:** Backlog — Christian entscheidet bei nächster UI-Pipeline.

---

### BUG-BACKLOG-002 — LIVE-Ready 0/4 Metrik basiert auf leerer trades-Tabelle
**Datum entdeckt:** 2026-05-23 (T0_T5)
**Schwere:** UX (Anzeige misleading)
**Christian-Entscheidung:** noch nicht gefixt

**Problem:** LIVE-Ready zeigt 0/4 weil:
- Gates basieren auf `trades`-Tabelle (CLOSED+Whitelist)
- trades-Tabelle ist seit Day Zero leer (MetaBrain mapped nie auf SINGLE im aktuellen Markt-Regime)
- Aber: 7000+ MBT-Trades laufen erfolgreich (strategy_regime_performance)

**Vorschlag:** Gates auf `strategy_regime_performance` umstellen → würde realistisches Bild zeigen (>50 Trades ✓, WR>52% ✓, Pos.PnL ✓, 7d profitabel ✓).

**Status:** Backlog — Architektur-Entscheidung nötig.

---

## DRAWDOWN-BEOBACHTUNG (kein Bug, Status-Monitoring)

**Verankert:** 2026-05-24 (Christian-Direktive: nur beobachten)

### Aktueller Stand (24.05.2026 11:45)
- Peak-Wallet: $1327.55
- Aktuell-Wallet: $1194.98
- **Drawdown: 9.99%** (0.01% Puffer zum KillSwitch-Limit 10%)

### Beobachtungs-Regeln
**KEIN aktives Eingreifen.** KillSwitch greift autonom bei 10%-Schwelle.

**Bot-Schutz-Kette bei DD≥10%:**
1. KillSwitch löst automatisch aus (vorhandene Logik)
2. AutoEngine.stop() greift
3. Alle SINGLE-Trades werden NICHT mehr geöffnet
4. Bestehende Trades laufen weiter (SL/TP greift wie spec'd)
5. Telegram-Alarm "Kill Switch AKTIV"

### Was Christian informiert wird (manuell, kein Auto-Alert nötig)
- **Wenn DD > 10%:** KillSwitch ist ausgelöst → Bot inaktiv → Christian-Aktion nötig (`/unkill`)
- **Wenn Peak resettet:** nach BULL-Recovery wenn neuer Höchststand → "Peak neu: $XXXX"
- **Wenn Wallet > alten Peak:** "Drawdown geheilt"

### Manuelle Status-Abfrage jederzeit via Telegram
- `/diagnose` → zeigt aktuelle Wallet + DD + Slots
- `/balance` → Wallet-Detail
- `/status` → KillSwitch-Status

---

## GESCHLOSSEN — Heute behoben (24.05.2026)

| Datum | Bug | Fix-Doc |
|---|---|---|
| 24.05. | V9 Balance Engine Win-Rate 0.0% (BUG-A) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | V9 Balance Engine PnL +0.00 (BUG-B) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | Spot Balance in DEMO sichtbar (BUG-C) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | "Blockiert heute 0/70" unklar (BUG-D) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | "News-Risk 100 (48/h)" unklar (BUG-E) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | /status veraltete Engine (BUG-1) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | /balance Realized-Σ + Positions (BUG-2/3/4) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | /report LIVE-Ready falsche Metrik (BUG-5) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | DCA-TP-Profit nicht in Wallet (BUG-6) | `T0_T5_COMPLETE_20260524.md` |
| 24.05. | T0.6 Deploy-Token-Toggle nicht funktional | `T06_BUGFIX_20260524.md` |
| 24.05. | Multi-KI orphan-feature → REMOVE | `MULTI_KI_REMOVED_20260524.md` |

---

*Backlog gepflegt: 2026-05-24 11:45*
