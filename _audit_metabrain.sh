#!/bin/bash
set +e
DB=~/NEXUS_CLEAN/nexus.db
SRV=~/NEXUS_CLEAN/server.js

H() { echo ""; echo "═══════════════════════════════════════════════════════════════"; echo "  $1"; echo "═══════════════════════════════════════════════════════════════"; }
S() { echo ""; echo "── $1 ──"; }

H "1. KERN-BUG-CHECK: candle_cache hat Spalte 'vol' — Code liest 'volume'"
S "Schema candle_cache"
sqlite3 $DB ".schema candle_cache"
S "Wo wird candle_cache gelesen — passt der Spaltenname?"
grep -nE "candle_cache" $SRV | head -10
S "Code-Stelle: wo wird Kerze-Object gebaut (close/high/low/volume)?"
grep -nE "\{ *open.*high.*low.*close|open:.*high:.*low:.*close:|\.volume *=|volume:" $SRV | grep -iE "candle|kline|cache" | head -10

H "2. METABRAIN _classifyRegime — wie wird metaRegime bestimmt?"
S "Funktion classifyRegime"
awk '/_classifyRegime\(/,/^  \},$/' $SRV | head -60

H "3. STRATEGIES5 — ALLE 5 Strategien komplett"
S "TREND_FOLLOW"
awk '/TREND_FOLLOW: \{/,/^  \},$/' $SRV | head -35
S "MEAN_REVERT"
awk '/MEAN_REVERT: \{/,/^  \},$/' $SRV | head -35
S "PULLBACK_BUY"
awk '/PULLBACK_BUY: \{/,/^  \},$/' $SRV | head -35
S "BREAKOUT_HUNT (schon bekannt — kurz)"
sed -n '8786,8810p' $SRV
S "CONSERVATIVE"
awk '/CONSERVATIVE: \{/,/^  \},$/' $SRV | head -20

H "4. STRATEGY_WHITELIST + SYMBOL_LIMIT + REGIME_TO_BOTTYPE"
grep -nE "STRATEGY_WHITELIST|STRATEGY_SYMBOL_LIMIT|BOTTYPE_WHITELIST|REGIME_TO_BOTTYPE" $SRV | head -15
echo ""
sed -n '8350,8385p' $SRV

H "5. WIE WIRD evaluateStrategy aufgerufen — welche candles werden übergeben?"
grep -nE "evaluateStrategy\(|Strategies5\.evaluate" $SRV | head -10
S "Übergebene candles für Strategy-Eval"
sed -n '23612,23625p' $SRV

H "6. CANDLES-SOURCE — woher kommen die Kerzen die an Strategy gehen?"
grep -nE "const candles|candles *=" $SRV | grep -vE "candles\.length|c =>|map\(c|//" | head -15

H "7. REAL-DATA-CHECK: Was steht aktuell in candle_cache für unsere 7 Symbole?"
S "Zeilenzahlen pro Symbol (24h)"
sqlite3 $DB "SELECT symbol, granularity, COUNT(*) as n, MIN(datetime(ts/1000,'unixepoch','localtime')) as oldest, MAX(datetime(ts/1000,'unixepoch','localtime')) as newest FROM candle_cache WHERE ts > (strftime('%s','now')-86400)*1000 GROUP BY symbol, granularity ORDER BY symbol;"
S "Volume-Statistik letzte 24h (alle Symbole, 1h-Kerzen)"
sqlite3 $DB "SELECT symbol, COUNT(*) as n, ROUND(MIN(vol),2) as min_v, ROUND(AVG(vol),2) as avg_v, ROUND(MAX(vol),2) as max_v FROM candle_cache WHERE granularity='1h' AND ts > (strftime('%s','now')-86400)*1000 GROUP BY symbol;"

H "8. KRITISCH: kommen die DB-Kerzen mit Feld 'volume' oder 'vol' in den Code?"
S "SELECT ... FROM candle_cache — welche Spalten werden gemappt?"
grep -nB2 -A5 "FROM candle_cache" $SRV | head -40

H "9. ALADDIN-BRAIN: ist readOnly: true wirklich der ganze Block?"
S "AladdinBrain-Header"
sed -n '26170,26200p' $SRV
S "Wo wird readOnly geprüft?"
grep -nE "this\.readOnly|AladdinBrain\.readOnly" $SRV | head -10

H "10. ZUSAMMENFASSUNG: was tradet überhaupt — gibt's irgendwo einen Pfad ohne MetaBrain?"
grep -nE "_executeTrade\(" $SRV
echo ""
S "Kommt _executeTrade auch ohne MetaBrain-Filter durch? (z.B. Rotation-Pfad)"
sed -n '23905,23925p' $SRV
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  AUDIT ENDE"
echo "═══════════════════════════════════════════════════════════════"
