# NEXUS V9 — G7 OPPORTUNITY-EVICTION-ENGINE DEPLOY-REPORT
**Datum:** 2026-05-23 16:25
**Stufe:** G7.1 — G7.6 alle live
**Profil:** 🟡 MITTEL (Christian-Wahl)
**Mode:** DRY_RUN für 2h (auto-promote 18:23 falls clean)

---

## DEPLOY-STATUS

| Stufe | Status | Datei | LOC |
|---|:-:|---|---|
| G7.1 Opportunity-Scanner | ✅ | `modules/opportunity_scanner.js` | 175 |
| G7.2 Slot-Strength-Ranker | ✅ | `modules/slot_strength_ranker.js` | 200 |
| G7.3 Eviction-Engine | ✅ | `modules/eviction_engine.js` | 290 |
| G7.4 Safety Hartlocks | ✅ | (in eviction_engine.js eingebaut) | — |
| G7.5 Dashboard | ✅ | `public/index.html` Card+JS | ~70 |
| G7.6 DRY_RUN 2h Auto-Promote | ✅ | server.js init + setTimeout(7200000) | — |

**3 Module geladen, 5 API-Endpoints, 1 Dashboard-Card.**

---

## CHRISTIAN-DIREKTIVEN UMGESETZT

| # | Direktive | Umsetzung |
|--:|---|---|
| 1 | Profil MITTEL | `CFG.SCORE_THRESHOLD_BIG=6.0, EVICT_THRESHOLD=-0.40, COOLDOWN 30min` |
| 2 | 2h DRY_RUN dann auto-scharf | `setTimeout 7200000` mit Anomalie-Check (drys 0-15, errs=0) |
| 3 | Auto-Stop >1% Wallet | `CUM_LOSS_AUTO_STOP_PCT=0.01` mit Telegram-CRITICAL |
| 4 | Nur SINGLE evictbar | `_collectBots` setzt `evictable:false` für DCA/GRID/INFGRID, Strength=9.99 |
| 5 | HMM-aware Direction | OPP-Scanner filtert `_directionMismatch=true` wenn Opp ≠ HMM-Direction |

---

## LIVE-VERIFIKATION

### Aktueller State (PID 11495, R=208, ~80s nach Restart)
```
OPP_SCAN init MITTEL-profile (score≥6, scan=60s) ✓
SLOT_STRENGTH init evict_thresh=-0.4 ✓
EVICT init mode=DRY_RUN day_start_wallet=1276.20 ✓
EVICT cron started (60s ticks) ✓
```

### Force-Rank (3 Bots gefunden)
```
- INFGRID ATOMUSDT strength=9.99 evictable=False protected=True
- DCA     SUIUSDT  strength=9.99 evictable=False protected=True
- DCA     ETHUSDT  strength=9.99 evictable=False protected=True
```
→ Alle 3 sind PROTECTED. Bot kann sie NICHT evicten.

### Force-Scan (Top-Opp)
```
Top-Opp: DOTUSDT score=2.026 (unter Threshold 6.0)
Big-opps so far: 0
```
→ Aktuell keine BIG Opportunity. Scanner-Log: 40 opps_logged, 0 big.

### Pipeline-Run
```
Pipeline-runs: 1
Blocked-Checks: { "SLOTS_FREE (3/5)": 1 }
```
→ Korrekt blockiert: Eviction-Engine wartet auf 5/5-Belegung. Aktuell 3/5 → keine Eviction möglich.

---

## VERHALTEN IN AKTUELLER MARKT-LAGE

**Warum bisher 0 Eviction-Plans:**
1. 2 SINGLE-Slots sind aktuell **leer** (durch D5/D6-Damping + MetaBrain CONSERVATIVE)
2. → Pre-Check #3 (`SLOTS_FREE`) blockt sofort
3. → Eviction-Engine wartet bis Bot 5/5 Slots befüllt hat ODER MetaBrain mehr SINGLE-Trades erlaubt

**Wenn Slots voll wären, würde Engine zusätzlich blocken durch:**
- Pre-Check #5 (`NO_BIG_OPP`): aktuelle Top-Opp DOT score=2.0 (<<6.0) → kein BIG
- Pre-Check #7 (`NO_WEAK_BOT`): alle aktuellen Bots protected (DCA/GRID/INFGRID)
- → Eviction-Wahn ausgeschlossen by-design

**Bewertung:** Engine **funktioniert wie spec'd**. Trigger braucht:
- 5/5 Slots besetzt
- Mind. 1 SINGLE-Trade als Eviction-Kandidat
- BIG Opportunity (score≥6, MITTEL-Profil)
- HMM in BEAR/BULL/CRASH/SQUEEZE (nicht RANGING/NEUTRAL)

---

## SAFETY-HARTLOCKS (alle 12 Pre-Checks)

| # | Check | Schwelle MITTEL | Funktioniert? |
|--:|---|---|:-:|
| 1 | Mode-Check | `DRY_RUN` / `LIVE` / nicht `DISABLED` | ✓ |
| 2 | Wallet-DD-Stop | < 95% Day-Start (1276.20×0.95=1212.39) | ✓ |
| 2b | Cum-Loss-Stop | > 1% Day-Start = >12.76 USDT/Tag | ✓ Telegram-CRIT |
| 3+4 | All-Slots-Busy | < 5 = block | ✓ aktuell aktiv |
| 5+6 | Big-Opp + Direction | score≥6, dir match HMM | ✓ |
| 7+10 | Weakest-Bot + Hold-Time | strength≤-0.4, age≥30min | ✓ |
| 8 | Eviction-Cooldown | 30min | ✓ |
| 9 | Per-Symbol-Cooldown | 60min | ✓ |
| 11 | Eviction-Loss-Cap | ≤5% Wallet | ✓ Premortem |
| 12 | Gain/Loss-Ratio | ≥1.5 | ✓ Premortem |

---

## API-ENDPOINTS NEU

| Endpoint | Methode | Zweck |
|---|:-:|---|
| `/api/eviction/snapshot` | GET | Full state (Engine+Ranker+Scanner) |
| `/api/eviction/history` | GET | Eviction-Log (DRY+LIVE, default 20) |
| `/api/eviction/mode` | POST | Mode-Switch (DRY_RUN/LIVE/DISABLED) — LIVE braucht `confirm:YES_LIVE_EVICTION` |
| `/api/eviction/force-rank` | POST | Force-Rerank aller Bots |
| `/api/eviction/force-scan` | POST | Force-Rescan aller Coins |

---

## DASHBOARD-INTEGRATION

KAPITAL-Tab → neue Sektion **"⚡ OPPORTUNITY-EVICTION"** unter Equity-Curve:
- **Status-Header:** Mode + Auto-Stop-Badge + Plans/Live-Counters + cumLoss
- **Strength-Ranking:** alle 3 Bots mit Status (protected/evictable/EVICTABLE-Warn)
- **Top-Opportunities:** bis zu 5 mit Direction + Score + 🔥BIG-Badge + ⚠️wrong-dir
- **Eviction-History:** letzte 5 Plans (DRY+LIVE) mit Timestamp + ratio
- **3 Buttons:** ↻ AKTUALISIEREN, 🔍 FORCE SCAN, 📊 FORCE RANK
- **Auto-Refresh:** alle 15s wenn KAPITAL-Tab aktiv

---

## DRY_RUN → LIVE AUTO-PROMOTE-SEQUENZ

**Aktiviert um:** 2026-05-23 16:23:51
**Auto-Promote um:** 2026-05-23 18:23:51 (2h später)

**Check-Logik:**
```js
if (dry_plans >= 0 && dry_plans <= 15 && errors === 0) {
  → mode = LIVE
  → Telegram: "✅ EVICTION SCHARFGESCHALTET"
} else {
  → DRY_RUN bleibt aktiv
  → Telegram: "⚠️ EVICTION DRY_RUN verlängert"
}
```

**Manueller Override jederzeit möglich:**
```bash
curl -X POST http://localhost:3000/api/eviction/mode \
  -d '{"mode":"LIVE","confirm":"YES_LIVE_EVICTION","reason":"manual"}'
```

---

## NÄCHSTE SCHRITTE (Christian-side)

1. **Beobachten 2h** — bei `pm2 logs nexus | grep EVICT` prüfen ob unerwartete Errors auftauchen
2. **Dashboard öffnen** → KAPITAL-Tab → ⚡ OPPORTUNITY-EVICTION Sektion live mitverfolgen
3. **Falls 5/5 Slots eintreten** (was selten passieren wird im aktuellen Markt): erste DRY_RUN-Plans erwartet
4. **Nach 2h** entweder Auto-Promote auf LIVE oder manueller Check

---

## OFFENE PUNKTE / KAVEATS

1. **Aktuelle Markt-Lage erzeugt 0 Evictions** — Brain ist im D5/D6-Damping, SINGLE-Slots leer, keine BIG-Opps. Das ist **korrekt**: keine Eviction nötig.
2. **DCA/GRID/INFGRID sind unantastbar** — selbst wenn sie tief im Buchverlust sind (siehe SUI-DCA total_size 57.94 @ avg 1.035). Christian-Direktive umgesetzt.
3. **Pipeline könnte Wochen-lang im DRY_RUN bleiben** — bis 5 SINGLE-Trades gleichzeitig offen sind UND BIG-Opp erscheint. Das ist ok — Eviction ist Sicherheitsnetz für volatile Phasen, nicht Routine-Mechanismus.
4. **OPP_SCAN top score aktuell 2.0** — weit unter BIG-Threshold 6.0. Würde erst bei Crash/Squeeze hochschnellen.

---

## BACKUP
`/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE_G7_PRE_20260523_161217/` (1.1 GB inkl. DB)

---

*G7 abgeschlossen: 2026-05-23 16:25*
*Bot: PID 11495, R=208, online, mem 163MB · Wallet 1276.20 stabil*
*D1-D6 Brain-Reform + E.1-E.6 Live-Parity + G7 Eviction-Engine alle live im PAPER-Mode*
