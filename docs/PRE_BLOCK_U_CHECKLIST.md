# Pre-Block-U Checklist — 24h Block-T Beobachtung

**Erstellt:** Block T A5 [27.05.2026, 15:18 CEST]
**Wartephase-Start:** 27.05.2026 14:54 CEST (Block-S-Final + Router live)
**Wartephase-Ende:** ca. 28.05.2026 14:54 CEST
**Block U (Per-Symbol Bayesian Phase 2) wartet auf Block-T-DoD.**

## Block-T-DoD (Codex, 8 Punkte)

| # | Punkt | Pass-Kriterium | Wie prüfen |
|---|---|---|---|
| 1 | 24h Veto-Stats sauber | `total > 0`, `blocked > 0`, `ANALYSIS_ONLY > 0` | `node scripts/log_router_stats.js --aggregate --pretty` |
| 2 | Keine Regression | 15/15 Tests grün | `cd ~/NEXUS_CLEAN && for t in tests/repro/test_*.js; do node "$t" >/dev/null 2>&1 && echo OK \|\| echo FAIL $t; done` |
| 3 | Keine Phantom-Coins als finale Trade-Kandidaten | 0 Trades in 24h für SEI/POL/DOT/LTC/UNI/ARB/OP/APT/ATOM | `sqlite3 nexus.db "SELECT count(*) FROM trades WHERE symbol IN ('SEIUSDT','POLUSDT','DOTUSDT','LTCUSDT','UNIUSDT','ARBUSDT','OPUSDT','APTUSDT','ATOMUSDT') AND created_at > strftime('%s','now','-24 hour')*1000"` |
| 4 | SEI bleibt analysis-only | `by_symbol.SEIUSDT.allowed = 0` und `vetos.ANALYSIS_ONLY > 0` | `curl -s 'localhost:3000/api/router/veto-stats?hours=24' \| python3 -m json.tool` |
| 5 | SUI-only blockbar (außer NEAR-Kontext) | bei NEAR-Inaktiv: SUI.blocked >0 mit reason PAIR_REQUIRED | siehe Block-T-Stats |
| 6 | MEGA+TREND blockiert | BTC/ETH/SOL/BNB: STRATEGY_FORBIDDEN >0 wenn TREND-Strategie | `curl -s localhost:3000/api/router/veto-stats?hours=24` |
| 7 | PAPER stabil | `pm2 list nexus` online + 0 unexpected restarts | `pm2 list \| grep nexus` |
| 8 | Rollback vorhanden | Backups BLOCKT_PRE_* + BLOCKT_POST_* + BLOCKS_FINAL existieren | `ls /Volumes/NEXUSBOT\ V9/backups/BLOCKT_*` |

## Auswertungs-Befehl (morgen ca. 14:54 CEST)

```bash
cd ~/NEXUS_CLEAN

echo "═════ Item 1: 24h Veto-Stats Aggregate ═════"
node scripts/log_router_stats.js --aggregate --pretty

echo "═════ Item 2: Test-Suite ═════"
PASS=0; FAIL=0; for t in tests/repro/test_*.js; do node "$t" >/dev/null 2>&1 && PASS=$((PASS+1)) || FAIL=$((FAIL+1)); done; echo "PASS $PASS / FAIL $FAIL"

echo "═════ Item 3: Phantom-Coin-Trades 24h ═════"
sqlite3 nexus.db "SELECT count(*) FROM trades WHERE symbol IN ('SEIUSDT','POLUSDT','DOTUSDT','LTCUSDT','UNIUSDT','ARBUSDT','OPUSDT','APTUSDT','ATOMUSDT') AND created_at > strftime('%s','now','-24 hour')*1000"

echo "═════ Item 4-6: Router-Stats 24h ═════"
curl -s "localhost:3000/api/router/veto-stats?hours=24" | python3 -m json.tool

echo "═════ Item 7: Bot stable ═════"
pm2 list | grep nexus
curl -s localhost:3000/api/guardian/status | python3 -c "import sys,json;d=json.load(sys.stdin);print('state:',d.get('lastState'),'runs:',d.get('stats',{}).get('runs'),'cons-bad:',d.get('consecutiveBad'))"

echo "═════ Item 8: Backups ═════"
ls /Volumes/NEXUSBOT\ V9/backups/BLOCKT_* 2>/dev/null
```

## ⚠️ Bekannte Lücken vor Wartephase

| # | Lücke | Konsequenz |
|---|---|---|
| 1 | **`autonomous_demo_trades_enabled=false`** (DB-flag seit 26.05. 16:31) → DemoEngine macht 0 Trade-Attempts → Router-Hook in `_executeTrade` wird NIE getriggert → 0 pm2-Veto-Marker | Item 3 trivial pass (0 Trades). Router-Wirkung NUR via API-Stats messbar, NICHT pm2-Logs. Christian-Entscheidung gefordert ob Flag während Wartephase auf `true` gesetzt werden soll, um pm2-Marker zu beweisen. |
| 2 | **MEGA+TREND-Path nur Brain-Read-Time messbar** — kein echter Trade-Attempt nötig weil DemoEngine paused | Item 6 wird über `/api/router/veto-stats` gemessen, nicht über trades-Tabelle. |
| 3 | **Symbol-Listen alte Code-Stellen** (`_altsHC` Z.25984, `L1_GROUP` Z.13004) bleiben unverändert | Sind Risk-Cap-Gates, NICHT Trade-Routing-Pfade. Funktional weiter aktiv aber nicht im Konflikt mit Router. **Block-U+Scope** falls migrationsbedarf. |

## Block-U-Vorschau (NACH Block-T-DoD-Pass)

**Per-Symbol Bayesian Phase 2** (laut Block-R-Roadmap + Codex):

1. DB-Migration: `sqlite3 nexus.db < scripts/migrate_bayesian_per_symbol.sql` (skeleton existiert)
2. Boot-Hook: `_PerSymBay.loadAll(DB.db)` beim Bot-Start
3. Trade-Close-Hook erweitern: zusätzlich zu globalem Bayesian-Update auch symbol-spezifisch
4. Toggle `CFG.BAYESIAN_PER_SYMBOL_ENABLED = false` initial (sicher)
5. Wenn stabil: Brain-Read aus per-symbol-Posterior in Block U+1

## Bei Block-T-DoD-Verstoss

1. **Diagnose**: Welcher Punkt ist gefailt?
2. **Fix-Block** dazwischen (z.B. Block T-Hotfix)
3. **Block U NICHT** starten
4. Christian-Approval für Fix-Plan

## Wartephase-Regeln

✅ Passive Beobachtung (curl, sqlite, pm2 logs)
✅ Doku-Updates (CLAUDE.md, ROADMAP)
✅ Block-U-Vorbereitung (Roadmap lesen, KEIN Code)
❌ Block-S/Block-T Code rückgängig
❌ Neue Features
❌ LIVE-Aktivierung
❌ DB-Migration
❌ Reserve antasten

## Backups dieses Sprints

```
BLOCKT_PRE_A1_20260527_151151   — 1.1G db + server.js
BLOCKT_POST_A1_20260527_151306  — log_router_stats.js + crontab
BLOCKT_POST_A2_20260527_151502  — block_t_veto_audit.sh
BLOCKT_PRE_A4_20260527_151604   — server.js pre-CoinScanner-Cleanup
BLOCKT_POST_A4_20260527_151818  — server.js post-CoinScanner-Cleanup
BLOCKT_FINAL_20260527_???       — Final-Backup (folgt)
```
