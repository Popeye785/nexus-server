# NEXUS V9 — REVIEW ACTION-PLAN (Stufen-Roadmap)
**Datum:** 2026-05-23 11:45
**Status:** PLAN — keine Implementierung ohne Christian-Freigabe pro Stufe
**Grundprinzip:** minimal-invasiv zuerst, kritische Engine-Eingriffe zuletzt

---

## Übersicht aller Stufen

| Stufe | Was | Risiko | Aufwand | Christian-Freigabe |
|---|---|:-:|---|:-:|
| **1** | UI sichtbar machen (4 neue Felder + DCA-PnL) | 🟢 niedrig | 1h | empfohlen |
| **2** | Kapital-Anzeige-Fix Option 3 (UI-only) als Übergangs-Patch | 🟢 niedrig | 30min | empfohlen |
| **3** | News-Source-Dedup verifizieren über 24h | 🟢 keine | 0h passive | nicht nötig |
| **4** | Brain-Accuracy 24h beobachten (BUY-Bias-Fix einschwingen) | 🟢 keine | 0h passive | nicht nötig |
| **5** | Schema-Extend für Realize-Tracking | 🟡 mittel | 30min | nötig |
| **6** | Historical Backfill (276+105 USDT in Wallet) | 🔴 kritisch | 1h | **ZWINGEND** |
| **7** | Daily-MBT-Realize-Cron deployen (dry_run) | 🟡 mittel | 4h | nötig |
| **8** | Cron auf productive umstellen | 🔴 kritisch | 0h (Flag) | **ZWINGEND** |
| **9** | UI-Erweiterung mit "Last Realize" + Pending | 🟢 niedrig | 1h | empfohlen |
| **10** | Code-Hygiene (silent catches, tote LIVE-Pfade) | 🟢 niedrig | 4h | nicht nötig |

**Critical path 1→9 = ~7-8h Engineering + 1 Woche Beobachtung**

---

## STUFE 1 — UI-Sichtbarkeit (4 Felder + DCA-PnL)

### Was
4 Backend-Felder (`realizedGrid`, `realizedAllSinceReset`, `totalEquity`, `dayZeroAt`) ins UI einbinden. Plus DCA-PnL-Spalte in BOTS-Tab.

### Warum
Christian sieht $1130 statt echtem $1406+. Sichtbarkeit löst 70% des "fühlt sich falsch an"-Problems sofort.

### Wie
- `public/index.html` Z.1980+ (BOTS-Tab Vermögen-Box):
  - Neue Zeile: `🔄 Realized seit Day-Zero: <span id="pdb-realized-grid">--</span>`
  - Neue Zeile: `💎 Total Equity: <span id="pdb-total-equity">--</span>`
  - Footer: `Day Zero: <span id="pdb-day-zero">--</span>`
- Z.3441+ JS-Update-Block: `setT('pdb-realized-grid', p.realizedAllSinceReset.toFixed(2)+' USDT')`
- Z.1367+ KAPITAL-Tab analog
- DCA-PnL-Anzeige: neuer Block im BOTS-Tab mit Query `SELECT SUM(pnl_usdt) FROM dca_iterations WHERE dca_id IN (SELECT dca_id FROM dca_instances WHERE status IN ('CLOSED','CLOSED_TP'))`

### Risiko
🟢 niedrig — pure read-only Anzeige, keine Engine-Berührung.

### Aufwand
1h Frontend.

### Akzeptanz
- KAPITAL-Tab + BOTS-Tab zeigen `realizedAllSinceReset` und `totalEquity`
- Differenz zur reinen wallet.total + reserve klar erkennbar

### Rollback
Backup `index.html.bak.STUFE1_*`, revert per `cp`.

---

## STUFE 2 — UI-Only Übergangs-Anzeige (Option 3)

### Was
UI rechnet virtuell `Reserve + realized*0.7` und `Trading + realized*0.3` und zeigt es als "(virtuell)" an.

### Warum
Bis Backfill (Stufe 6) durch ist, soll Christian die SOLL-Aufteilung sehen.

### Wie
- `public/index.html` Z.4019-4021: neue Zeilen "SOLL Reserve" / "SOLL Trading" mit virtueller Berechnung
- Klarer Hinweis: "virtuell — echte Wallet noch nicht realisiert (Cron läuft 23:55)"

### Risiko
🟢 niedrig — pure Anzeige.

### Aufwand
30min.

### Akzeptanz
- UI zeigt parallel: IST-Wallet + SOLL-Wallet
- Differenz "schwebend" erkennbar

### Rollback
revert.

---

## STUFE 3 — News-Source-Dedup-Verify (passive)

### Was
24h Beobachtung des news_risk-Factors nach gestrigem Dedup-Fix.

### Warum
Verify dass Dedup wirkt + factor stabilisiert sich unter 3.0 ohne fresh-critical-Events.

### Wie
- 24h-Monitoring via `/api/news/risk?symbol=BTCUSDT`
- Erwartung: factor 1.5-2.5 statt vorher 3.5-4.5

### Risiko
🟢 keine (passive).

### Aufwand
0h aktive, 24h passive.

### Akzeptanz
- factor median <2.5 über 24h
- keine Cluster-Alerts mehr für Mark-Cuban-Style-Stories

### Rollback
n/a (nur Beobachtung).

---

## STUFE 4 — Brain-Accuracy-Monitoring

### Was
24h passive Beobachtung des Outcome-Trackers, ob BUY-Bias-Fix von gestern (fearGreed FG<30→NEUTRAL, smartMoney strenger, HMM 0.45) sich einschwingt.

### Warum
Aktuell Accuracy 1h=15.85% — wenn nach 24h immer noch <30%, ist tieferer Brain-Reset nötig.

### Wie
- 24h `/api/outcome/accuracy?horizon=1`, `?horizon=4`, `?horizon=24`
- Decision-Mix-Trend: BUY:SELL-Ratio

### Risiko
🟢 keine.

### Aufwand
0h, passive.

### Akzeptanz
- 1h-Accuracy steigt auf >30% nach 24h
- BUY:SELL-Ratio stabilisiert <2:1

### Rollback
n/a.

---

## STUFE 5 — Schema-Extend für Realize-Tracking

### Was
2 neue Spalten in DB für idempotenten Cron:
- `strategy_regime_performance.realized_at INTEGER`
- `grid_instances.profit_realized_at INTEGER`

### Warum
Idempotenz für Daily-Cron — verhindert Doppel-Apply.

### Wie
```sql
BEGIN TRANSACTION;
ALTER TABLE strategy_regime_performance ADD COLUMN realized_at INTEGER DEFAULT NULL;
ALTER TABLE grid_instances ADD COLUMN profit_realized_at INTEGER DEFAULT NULL;
COMMIT;
```

### Risiko
🟡 mittel — Schema-Änderung, aber non-destruktiv (DEFAULT NULL).

### Aufwand
30min mit Backup + Audit-Log.

### Akzeptanz
- `PRAGMA table_info(strategy_regime_performance)` zeigt `realized_at` als Spalte
- bestehende Rows haben `realized_at = NULL`
- DB-Größe wächst minimal

### Rollback
`ALTER TABLE ... DROP COLUMN ...` (SQLite >3.35) oder Backup-Restore.

### Christian-Freigabe NÖTIG
Ja — DB-Schema-Mutation auf produktiver DB.

---

## STUFE 6 — Historical Backfill (276+105 USDT)

### Was
Einmalig `applyPnL(Σ, 'HIST_BACKFILL_20260523')` aufrufen für aufgelaufene MBT-Profits seit Day-Zero.

### Warum
Wallet reflektiert SOLL-Zustand. Reserve füllt sich strategie-konform.

### Wie

```bash
# Pre-Check (no-op):
sqlite3 nexus.db "SELECT 
  SUM(pnl_usdt) AS strp_unrealized
FROM strategy_regime_performance WHERE ts >= dayZero AND realized_at IS NULL"
# → 276.20

# Doppel-Counting-Check: ATOM-GRID profit_acc 104.77 ist evtl. NICHT in strategy_regime_performance enthalten,
# weil GRID hooks (Z.8973) pro fill schreiben, profit_acc ist instance-cumulativ.
# Verify: SUM strp_pnl vs SUM profit_acc per grid_id

# Backfill:
node -e "
const { WalletProvider } = require('./server.js');  // NICHT importierbar
"
# → besser: API-Call POST /api/wallet/backfill (neu zu bauen) oder pm2-script

# Marker:
UPDATE strategy_regime_performance SET realized_at=NOW WHERE ts >= dayZero AND realized_at IS NULL;
UPDATE grid_instances SET profit_realized_at=NOW WHERE status IN ('CLOSED','CLOSED_TP') AND closed_at >= dayZero AND profit_realized_at IS NULL;

# Audit:
INSERT INTO wallet_ledger (op='HIST_BACKFILL', amount=276.20, reason='...') ...
```

### Doppel-Counting-Diagnose ZUERST
ATOM-GRID-Close +104.77 wurde gestern in `wallet_ledger` als `GRID_CLOSE_PROFIT` geschrieben (PRIO5_FIX #1). Dieser Eintrag ist **Audit-only** (kein Wallet-Mutation), wie der wallet_ledger zeigt: `before_trading=1000, after_trading=1000`.

Aber: GRID hat während des Lebens fortlaufend `strategy_regime_performance` befüllt. **Frage:** ist `profit_acc 104.77` von ATOM-GRID identisch zu `SUM(strp.pnl_usdt) WHERE bot_type='GRID' AND ...ATOM_GRID rows`?

Wenn ja → nur ein PnL-Topf. Wenn nein → Doppel-Counting möglich.

**Pre-Audit zwingend:** Vergleich `profit_acc` vs `SUM(strp.pnl_usdt) per grid_id`. **Ergebnis muss Christian sehen vor Backfill.**

### Risiko
🔴 KRITISCH — Wallet-Mutation.

### Aufwand
1h mit Pre-Audit + Backfill + Verify.

### Akzeptanz
- demo_wallet.json: total=1276.20 (oder 1381 falls profit_acc separat), reserve=193.34 (oder 266.70), trading=1082.86 (oder 1114.30)
- 0 CRITICAL in consistency_log
- Audit-Trail in wallet_ledger + system_log

### Rollback
- `cp data/demo_wallet.json.bak.STUFE6_* data/demo_wallet.json`
- `UPDATE strp SET realized_at=NULL WHERE realized_at >= STUFE6_TIMESTAMP`
- pm2 reload

### Christian-Freigabe ZWINGEND
Ja — Wallet-Mutation auf historische Daten.

---

## STUFE 7 — Daily-MBT-Realize-Cron (dry_run)

### Was
Neues Modul `modules/mbt_profit_realizer.js`. Cron 23:55 lokal liest unrealized PnL des Tages, computed, schreibt im DRY-RUN-Mode nur Log + Telegram-Alert, KEIN applyPnL.

### Warum
7-Tage-Trockenlauf bevor productive. Verifizieren dass Berechnung stabil ist.

### Wie

```js
// modules/mbt_profit_realizer.js
const MBTProfitRealizer = {
  _dry_run: true,
  _db: null,
  
  computeUnrealizedDaily() {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const ts = todayStart.getTime();
    const r = this._db.prepare(`
      SELECT bot_type, COUNT(*) n, SUM(pnl_usdt) total 
      FROM strategy_regime_performance 
      WHERE ts >= ? AND realized_at IS NULL 
      GROUP BY bot_type
    `).all(ts);
    return { total: r.reduce((s,x)=>s+x.total,0), perBot: r };
  },
  
  realizeIfProductive() {
    const { total, perBot } = this.computeUnrealizedDaily();
    if (this._dry_run) {
      Log.info('REALIZER_DRY', `Would apply: +${total.toFixed(2)} USDT (${perBot.length} bot_types)`);
      try { TelegramBot.send(`💤 [DRY] Daily-Realize: +${total.toFixed(2)} USDT`); } catch(_){}
      return;
    }
    if (total <= 0) return;
    const r = WalletProvider.applyPnL(total, `DAILY_REALIZE_${new Date().toISOString().slice(0,10)}`);
    if (r.ok) {
      // Markieren
      this._db.prepare('UPDATE strategy_regime_performance SET realized_at = ? WHERE ts >= ? AND realized_at IS NULL').run(Date.now(), todayStartTs);
      try { TelegramBot.send(`💰 Daily-Realize: +${total.toFixed(2)} → Reserve +${(total*0.7).toFixed(2)}, Trading +${(total*0.3).toFixed(2)}`); } catch(_){}
    }
  },
  
  startCron() {
    // 23:55 lokal jeden Tag
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 23 && now.getMinutes() === 55) this.realizeIfProductive();
    }, 60000);  // 1-min-tick
  }
};
```

### Risiko
🟡 mittel (dry_run = niedrig).

### Aufwand
3-4h Code + Tests + Telegram-Integration.

### Akzeptanz
- 7 Tage dry_run mit Logs zeigen sinnvolle PnL-Werte
- 0 Crashes
- Telegram-Notifications kommen pünktlich

### Rollback
`MBTProfitRealizer._dry_run = true` setzen + cron stoppen.

---

## STUFE 8 — Cron productive (Flag-Flip)

### Was
Nach 7-Tage-dry_run setzt `MBTProfitRealizer._dry_run = false`.

### Risiko
🔴 KRITISCH — Wallet-Mutation täglich automatisiert.

### Aufwand
0h (Flag-Änderung) + 1 Woche Beobachtung.

### Akzeptanz
- Erste 7 productive Cron-Runs lassen Wallet wachsen wie erwartet
- Reserve / Trading entwickeln sich gemäß 70/30 + Markt-PnL
- Idempotent (kein Doppel-Apply auch bei Cron-Crash/Restart)

### Christian-Freigabe ZWINGEND
Ja — letzter Switch auf Auto-Wallet-Mutation.

---

## STUFE 9 — UI-Erweiterung "Last Realize"

### Was
- KAPITAL-Tab: `Last MBT-Realize: 2026-05-23 23:55:00 (+276.20 USDT)`
- "Pending Realize: 12.34 USDT (next: today 23:55)"
- Source-Hint: "Tägliche Realize um 23:55 — Reserve+Trading wachsen nach 70/30"

### Risiko
🟢 niedrig.

### Aufwand
1h.

### Akzeptanz
- Christian sieht jederzeit den Realize-Status

### Rollback
revert.

---

## STUFE 10 — Code-Hygiene (Bonus, optional)

### Was
- 514 silent catches → mind. die kritischen 50 mit Log.debug versehen
- 4 ungenutzte Module (backtest_engine, lstm_engine, feature_engineering, gru_engine = 1108 LOC) → entweder als CLI-tools dokumentieren oder löschen
- 19 alte index.html-Backups → nach `public/_archive/` verschieben
- `feedLoad` Polling 2s → 30s (Server-Load-Reduktion)

### Risiko
🟢 niedrig.

### Aufwand
4h.

### Akzeptanz
- LOC server.js reduziert um >500
- public/ aufgeräumt
- Polling-Last reduziert

---

## ZUSAMMENFASSUNG

### Critical Path (Christian-F2 nötig)
**Stufe 1 → 2 → 5 → 6 → 7 → 8** (mit Beobachtung dazwischen)

### Quick-Wins (kein Risiko)
**Stufe 1, 2, 3, 4, 9** — ~3h Aufwand für massive Transparenz-Verbesserung

### Optional
**Stufe 10** — kann jederzeit später

### Empfohlener Start
**Stufe 1 + 2 zuerst** (~1.5h, kein Engine-Risiko, sofortige Sichtbarkeit für Christian) → dann Pre-Audit für Stufe 6 (Doppel-Counting-Check) → dann Stufe 5+6 mit Freigabe → dann Stufe 7+8.

---

## Premortem-Liste

**Was könnte schiefgehen?**

1. **Stufe 6 Backfill: Doppel-Counting** — profit_acc + strategy_regime_performance summieren denselben PnL. Mitigation: Pre-Audit Vergleich `SUM(profit_acc) vs SUM(strp.pnl_usdt) per grid_id`.

2. **Stufe 6: Wallet-Overflow** — falls Backfill-Sum > 1000 USDT → Trading +1000 = ~2000 → Position-Sizer öffnet plötzlich große Trades. Mitigation: Bot-Stop vor Backfill (pm2 stop) + Verify.

3. **Stufe 7 Cron: doppelter Lauf bei Restart** — pm2-Restart um 23:54 → nach Restart um 23:56 könnte cron erneut feuern. Mitigation: realized_at-Flag-Check + last_realize-Day-Marker in bot_settings.

4. **Stufe 8 productive: Race mit MBTTicker** — während Cron 23:55 läuft, könnte gleichzeitig ein DCA-Buy stattfinden → Wallet-Race. Mitigation: Mutex/Lock in WalletProvider.

5. **DB-Schema-Migration (Stufe 5) während Bot läuft** — ALTER TABLE könnte SQLite-WAL-conflict erzeugen. Mitigation: pm2 stop vor ALTER + start danach.

### Anti-Brick-Regel

- Pro Stufe: PRE-Snapshot M.2 + lokal
- Pro Stufe: Akzeptanzkriterien VOR der Aktion definiert
- Bei Failure: pm2 stop, Rollback, pm2 start, dann analysieren
- Bei Wallet-Drift >10 USDT (außerhalb 70/30-Logik): STOPP + Christian melden

---

*Phase 4 Action-Plan abgeschlossen. Insgesamt 10 Stufen mit klaren Akzeptanz/Rollback-Kriterien.*

*Wartet auf Christian-F2 pro Stufe.*
