#!/bin/bash
# scripts/test_db_keys_hybrid.sh
# T8.3 Hybrid-Test: .env-Keys deaktivieren → Boot → DB-Quelle verifizieren → .env wiederherstellen
# Anti-Brick: Auto-Rollback bei jedem Fehler

set -e

cd "$(dirname "$0")/.."

TS=$(date +%Y%m%d_%H%M%S)
ENV_BACKUP=".env.t83_test_$TS"
ROLLBACK_DONE=0
ORIGINAL_WALLET=""
ORIGINAL_LIVE_READY=""

# ─── ROLLBACK-Funktion (idempotent, autom. bei EXIT/INT/TERM) ───
rollback() {
  if [ "$ROLLBACK_DONE" -eq 1 ]; then return 0; fi
  echo ""
  echo "🔄 ROLLBACK wird ausgeführt..."
  if [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" .env
    echo "✅ .env aus Backup wiederhergestellt"
  fi
  pm2 restart nexus --update-env > /dev/null 2>&1 || true
  sleep 20
  HEALTH_AFTER_ROLLBACK=$(curl -s http://localhost:3000/api/exchange-config/status 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('bitget_key_source','?'))" 2>/dev/null || echo "?")
  echo "✅ Bot neugestartet mit ursprünglichen Keys (source nach Rollback: $HEALTH_AFTER_ROLLBACK)"
  ROLLBACK_DONE=1
}
trap rollback EXIT INT TERM

echo "🔬 T8.3 HYBRID-TEST GESTARTET"
echo "════════════════════════════════════════════════════"

# ─── Pre-Check ───
echo ""
echo "📋 PRE-CHECK"
ORIGINAL_WALLET=$(cat data/demo_wallet.json | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
DD=$(cat data/demo_wallet.json | python3 -c "import sys,json;w=json.load(sys.stdin);print(round(((w['peakTotal']-w['total'])/w['peakTotal'])*100,2))")
ORIGINAL_LIVE_READY=$(curl -s http://localhost:3000/api/stats/strategy 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('gatesScore','?'))")
echo "  Wallet vorher:     \$$ORIGINAL_WALLET"
echo "  Drawdown:          ${DD}%"
echo "  LIVE-Ready:        $ORIGINAL_LIVE_READY"

# Hartlocks
WALLET_INT=$(echo "$ORIGINAL_WALLET" | awk -F. '{print $1}')
if [ "$WALLET_INT" -lt 1000 ]; then echo "❌ ABBRUCH: Wallet < \$1000"; exit 1; fi
DD_INT=$(echo "$DD" | awk -F. '{print $1}')
if [ "$DD_INT" -ge 12 ]; then echo "❌ ABBRUCH: Drawdown ≥ 12%"; exit 1; fi
echo "  ✅ Hartlocks OK (Wallet > \$1000, DD < 12%)"

# Verify DB hat Bitget-Keys
DB_SOURCE=$(curl -s http://localhost:3000/api/exchange-config/status 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('bitget_key_source','?'))")
echo "  Aktuelle Key-Source: $DB_SOURCE"
if [ "$DB_SOURCE" != "DB" ]; then
  echo "❌ ABBRUCH: Bitget-Keys nicht in DB. Erst Migration ausführen."
  exit 1
fi
echo "  ✅ DB hat Bitget-Keys"

# ─── .env Backup ───
echo ""
echo "💾 .env Backup → $ENV_BACKUP"
cp .env "$ENV_BACKUP"
echo "  ✅ Backup angelegt"

# ─── .env-Keys deaktivieren ───
echo ""
echo "🔒 .env-Keys deaktivieren (rename to DISABLED_TEST)"
sed -i.tmp 's/^BITGET_API_KEY=/BITGET_API_KEY_DISABLED_TEST=/' .env
sed -i.tmp 's/^BITGET_SECRET_KEY=/BITGET_SECRET_KEY_DISABLED_TEST=/' .env
sed -i.tmp 's/^BITGET_PASSPHRASE=/BITGET_PASSPHRASE_DISABLED_TEST=/' .env
rm -f .env.tmp

if grep -q "^BITGET_API_KEY=" .env; then
  echo "❌ FEHLER: BITGET_API_KEY noch aktiv in .env"
  exit 1
fi
if ! grep -q "^BITGET_API_KEY_DISABLED_TEST=" .env; then
  echo "❌ FEHLER: sed-Replace fehlgeschlagen"
  exit 1
fi
echo "  ✅ Alle 3 .env-Bitget-Variablen deaktiviert"

# ─── Bot-Restart ───
echo ""
echo "🔄 Bot-Restart"
pm2 restart nexus --update-env > /dev/null
echo "  ⏳ 30s warten für Boot..."
sleep 30

# ─── Boot-Log-Check ───
echo ""
echo "📊 BOOT-LOG-CHECK"
BOOT_LINE=$(pm2 logs nexus --lines 200 --nostream 2>&1 | grep -E "BOOT.*T8.3" | tail -1)
echo "  Boot-Log: $BOOT_LINE"

SOURCE_API=$(curl -s http://localhost:3000/api/exchange-config/status 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('bitget_key_source','?'))")
echo "  API source: $SOURCE_API"

if [ "$SOURCE_API" != "DB" ]; then
  echo "❌ TEST FEHLGESCHLAGEN: Bot lädt nicht aus DB (Source: $SOURCE_API)"
  exit 1
fi
echo "  ✅ DB ist primäre Key-Quelle"

# ─── Bot-Health-Check ───
echo ""
echo "🏥 BOT-HEALTH"
LIVE_READY=$(curl -s http://localhost:3000/api/stats/strategy 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('gatesScore','?'))")
echo "  LIVE-Ready: $LIVE_READY (vorher: $ORIGINAL_LIVE_READY)"
if [ "$LIVE_READY" != "$ORIGINAL_LIVE_READY" ]; then
  echo "❌ TEST FEHLGESCHLAGEN: LIVE-Ready verändert"
  exit 1
fi

# ─── 2 Min Beobachtung ───
echo ""
echo "⏳ 2-Minuten-Beobachtung"
for i in 1 2 3 4; do
  sleep 30
  WALLET_NOW=$(cat data/demo_wallet.json | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
  HMM=$(sqlite3 nexus.db "SELECT state FROM hmm_state ORDER BY id DESC LIMIT 1")
  echo "  Check $i/4: Wallet \$$WALLET_NOW · HMM=$HMM"
  # Wallet darf nicht >2% drift
  DELTA_PCT=$(python3 -c "print(round(abs(($WALLET_NOW-$ORIGINAL_WALLET)/$ORIGINAL_WALLET*100),2))")
  if [ $(echo "$DELTA_PCT" | awk -F. '{print $1}') -ge 2 ]; then
    echo "❌ TEST FEHLGESCHLAGEN: Wallet-Drift ${DELTA_PCT}% > 2%"
    exit 1
  fi
done

# ─── Erfolgs-Report ───
echo ""
echo "════════════════════════════════════════════════════"
echo "🎯 TEST-ERGEBNIS"
echo "════════════════════════════════════════════════════"
echo "Key-Source:        $SOURCE_API ✅"
echo "LIVE-Ready:        $LIVE_READY (unverändert)"
echo "Wallet vorher:     \$$ORIGINAL_WALLET"
echo "Wallet aktuell:    \$$WALLET_NOW"
echo "Bot-Health:        STABIL über 2 Min"
echo ""
echo "✅ HYBRID-TEST ERFOLGREICH"
echo "Bot lädt Bitget-Keys aus DB (AES-256-GCM), .env war deaktiviert."
echo ""
echo "🔄 Auto-Rollback startet (stellt .env-Fallback wieder her)..."
# trap-Funktion läuft automatisch bei exit 0
