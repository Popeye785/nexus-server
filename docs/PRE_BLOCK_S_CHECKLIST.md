# Pre-Block-S Checklist — 24h Paper-Beobachtung

**Erstellt:** Block S-Prep A2 [27.05.2026, 14:18 CEST]
**Wartephase-Start:** ca. 27.05.2026 13:34 CEST (Block-Q-Final-Deploy)
**Wartephase-Ende:** ca. 28.05.2026 13:34 CEST
**Auswertung:** Block T (separater Block nach Wartephase)

## Zweck

Vor jedem Brain-Migrations-Schritt (Block S) muss verifiziert sein dass die
bestehende Architektur — SymbolUniverse, CUSUM-Trade-Gate, Per-Symbol-Floor,
Pair-Guard, MR-Sub-Source, MEGA-Disabled — **stabil und wirksam** läuft.

Codex-Disziplin: Beobachtung vor Aktion. Keine neuen Features ohne Daten-Evidenz.

## 9-Item-Checklist

| # | Item | Wie prüfen | Pass-Kriterium |
|---|---|---|---|
| 1 | Mindestens 1 echter Trade-Attempt | `sqlite3 nexus.db "SELECT count(*) FROM trades WHERE created_at > strftime('%s','now','-24 hour')*1000"` | ≥ 1 |
| 2 | CUSUM-Gate hat ≥1 Veto ODER ≥1 Pass | `node scripts/cusum_veto_summary.js --hours 24` | vetos + attempts ≥ 1 |
| 3 | DemoEngine 0 unerwartete Crashes | `node scripts/cusum_veto_summary.js --hours 24` → crash_indicators | = 0 |
| 4 | Bot drift = 0 konstant | `curl -s localhost:3000/api/guardian/status \| jq '.drift'` | = 0 |
| 5 | Per-Symbol-Floor wirkt (NEAR/SUI Floor 0.10) | `curl -s localhost:3000/api/symbol-universe/snapshot \| jq '.coin_configs.NEARUSDT.floor'` | = 0.10 |
| 6 | MR-Sub-Source aktiv beobachtet (MEGA-Brain) | `pm2 logs nexus --lines 500 --nostream \| grep -iE "MR.*BTC\|MR.*ETH\|MR.*SOL\|MR.*BNB" \| head` | Mindestens 1 MR-Log |
| 7 | Reserve unangetastet ($3.34) | `cat data/demo_wallet.json \| jq '.reserve_usdt'` | = 3.34 |
| 8 | 14/14 Integration-Tests grün | `cd ~/NEXUS_CLEAN && for t in tests/repro/test_*.js; do node "$t" >/dev/null 2>&1 && echo OK \|\| echo FAIL $t; done` | 14 × OK |
| 9 | Keine neuen [ERROR]-Lines | `pm2 logs nexus --lines 1000 --nostream --err \| tail -50` | nur historische Errors |

## Auswertungs-Befehl (24h-Status auf einen Blick)

```bash
cd ~/NEXUS_CLEAN

echo "=== ITEM 1: Trade-Attempts 24h ==="
sqlite3 nexus.db "SELECT count(*),symbol FROM trades WHERE created_at > strftime('%s','now','-24 hour')*1000 GROUP BY symbol"

echo "=== ITEM 2+3: CUSUM-Summary ==="
node scripts/cusum_veto_summary.js --hours 24 --report

echo "=== ITEM 4: Guardian ==="
curl -s localhost:3000/api/guardian/status | python3 -c "import sys,json;d=json.load(sys.stdin);print('drift:',d.get('drift'),'consistent:',d.get('consistent'))"

echo "=== ITEM 5: Floor-Config ==="
curl -s localhost:3000/api/symbol-universe/snapshot | python3 -c "import sys,json;d=json.load(sys.stdin);print('NEAR-floor:',d['coin_configs']['NEARUSDT']['floor'],'SUI-floor:',d['coin_configs']['SUIUSDT']['floor'])"

echo "=== ITEM 7: Reserve ==="
cat data/demo_wallet.json | python3 -c "import sys,json;d=json.load(sys.stdin);print('reserve:',d.get('reserve_usdt'))"

echo "=== ITEM 8: Tests ==="
PASS=0; FAIL=0; for t in tests/repro/test_*.js; do node "$t" >/dev/null 2>&1 && PASS=$((PASS+1)) || FAIL=$((FAIL+1)); done; echo "PASS: $PASS / FAIL: $FAIL"

echo "=== ITEM 9: Error-Tail ==="
pm2 logs nexus --lines 30 --nostream --err 2>&1 | grep -iE "TypeError|ReferenceError|FATAL" | tail -5
```

## Block-T-Entscheidungsbaum

```
Alle 9 Items grün?
├─ JA  → Block S Freigabe (Brain-Migration auf SymbolUniverse)
└─ NEIN → Welches Item fehlt?
   ├─ Item 1 (0 trades): Floor zu hoch? Confidence-Threshold? ML-Pause-Flag?
   │  → Diagnose vor Block S. Brain-Migration ohne Trade-Aktivität sinnlos.
   ├─ Item 2 (0 vetos+passes): CUSUM nicht erreicht. Threshold-Calibration prüfen.
   ├─ Item 3+9 (crashes): DemoEngine instabil → STOP, Forensik
   ├─ Item 4 (drift>0): Reconciliation-Problem → STOP
   ├─ Item 5 (floor≠0.10): SymbolUniverse-Config verstellt
   ├─ Item 6 (kein MR): MR-Modul live aber inaktiv → Brain-Integration prüfen
   ├─ Item 7 (Reserve≠3.34): KRITISCH STOP, sofort melden
   └─ Item 8 (Tests rot): Regression → Rollback auf BLOCKS_PREP_POST_A1
```

## Was während Wartezeit erlaubt ist

- ✅ Passive Beobachtung (curl-Checks, Telegram-Status)
- ✅ Lesen + Recherche für Block S Vorbereitung
- ✅ Doku-Updates (CLAUDE.md, ROADMAP)
- ✅ Quick-Wins ohne Architektur-Eingriff (z.B. Cleanup-Items)
- ❌ Brain-Migration (Block S)
- ❌ allowed_strategies-Enforcement (Block S)
- ❌ DB-Migration für Per-Symbol Bayesian (Block S+1)
- ❌ LIVE-Aktivierung (Codex-Direktive)
- ❌ Neue CFG-Toggles für ML-Features

## Block-S Scope (NACH Checklist-Pass)

- Brain liest SymbolUniverse durchgehend (kein Read auf alte Listen mehr)
- `getAllowedStrategies(symbol)` aktiv im Trade-Routing
- `getForbiddenStrategies(symbol)` blockt z.B. BTC-TREND-Calls
- Strategy-Veto sauber loggen + zählen
- SUI-only bleibt durch Pair-Guard blockiert
- MEGA-Class bleibt MR-only (Block Q A2 erhalten)

## Block-S+1 Scope (NACH Block S)

- Per-Symbol Bayesian Phase 2 (DB-Migration + Boot-Hook + Trade-Close-Hook)
- Toggle `CFG.BAYESIAN_PER_SYMBOL_ENABLED = false` initial
- Globaler Bayesian bleibt Fallback

## Referenz-Backups

- BLOCKR_20260527_135226_FINAL (Block-R-Endstand)
- BLOCKS_PREP_PRE_A1_20260527_140926 (1.9G tar + 1.1G nexus.db)
- BLOCKS_PREP_POST_A1_20260527_141726 (Pair-Guard konsolidiert)
- BLOCKS_PREP_PRE_A2_20260527_141726 (server+scripts+docs Snapshot)
