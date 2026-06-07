---
name: market-data-verify
description: Use this skill BEFORE any claim about current market state, prices, percentage changes, trends, sentiment. Required before words like "bullish", "bearish", "trend", "24h-change", "BTC price", "ETH price", "market is", "leicht-bullisch", "leicht-bearish". Enforces 3-source cross-reference, candle-ordering verification, timestamp documentation.
---

# Market-Data Verify

VOR jeder Markt-Aussage durchlaufen.

## PREREQUISITE

Zuerst session-context Skill durchlaufen
(Datum/Uhrzeit als Anker).

## Pflicht-3-Quellen

Mindestens 3 unabhängige Quellen abfragen:

1. **Primär**: Bot-intern oder Bitget direkt
   `curl https://api.bitget.com/api/v2/spot/market/tickers`
2. **Sekundär**: CoinGecko
   `curl https://api.coingecko.com/api/v3/simple/price`
3. **Tertiär**: web_fetch oder web_search
   Yahoo, Coinbase, Fortune

## Bewertung

- Alle 3 Werte vergleichen
- Diff ≥0.5% → STOP, Bug-Verdacht
- Vorzeichen unterschiedlich → SOFORT STOP, sicher Bug
- Erst nach Übereinstimmung Aussage tätigen

## Candle-Ordnung Pflicht

WENN aus Candle-Array gerechnet:
1. Erste Zeile IMMER:
   `print(candles[0].ts, candles[-1].ts)`
2. Älteste→neueste oder neueste→älteste explizit klären
3. Niemals annehmen
4. Bei Zweifel: sort by ts explizit

## Verbotene Aussagen ohne Cross-Reference

Bei diesen Wörtern Skill ZWINGEND:
- bullish / bearish
- im Aufwärtstrend / Abwärtstrend
- Markt ist BULL/BEAR
- +X% in 24h / -X% in 24h
- leicht-bullisch / leicht-bearish
- BTC bei $X / ETH bei $X
- Fear & Greed Y
- News-Risk Z

## Anti-Pattern aus Historie

**27.5.2026 06:55 (Block H+24h):**
- Behauptung: "BTC +1.43% leicht-bullisch"
- Realität: BTC -1.52% (bearish)
- Ursache: Candle-Ordnung-Annahme falsch (k[0]=älteste statt neueste)
- Folge: komplette Bias-Diagnose falsch
- Erkannt von: Christian live auf Handy

Dieser Anti-Pattern nie wieder.

## Output-Format

Bei JEDER Markt-Aussage zuerst ausgeben:

```
📊 Market-Data Cross-Reference
- Datum (aus session-context): T
- Quelle 1 [Name]: BTC = $X (24h-Change = Y%)  Timestamp: T1
- Quelle 2 [Name]: BTC = $X (24h-Change = Y%)  Timestamp: T2
- Quelle 3 [Name]: BTC = $X (24h-Change = Y%)  Timestamp: T3
- Übereinstimmung: ja/nein (Diff < 0.5%)
- Vorzeichen: konsistent ja/nein
- Verdict: VERIFIZIERT / WIDERSPRUCH
```

Dann erst Markt-Aussage.
