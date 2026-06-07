# DIAGNOSE — HISTORISCHE DATEN FÜR NEUE QUELLEN
**Datum**: 2026-05-18 15:42
**Modus**: READ-ONLY, kein Patch
**Anlass**: Klärung ob Hyperopt/Retraining mit neuen Sources sofort möglich

---

## Tabellen-Inventar (relevant)

```
news_feed                              ← RSS-Aggregator-Stream (12 Quellen)
news_enriched                          ← AUDFIX heute Phase A
news_clusters                          ← AUDFIX heute Phase A
liquidations_24h                       ← AUDFIX heute Phase B
funding_oi_history                     ← AUDFIX heute Phase 2/B
etf_flows                              ← AUDFIX heute Phase C
macro_events                           ← AUDFIX heute Phase 4
market_sentiment                       ← Fear & Greed (alternative.me, Tier 1.4a)
balance_history                        ← Wallet-Trajektorie
aladdin_decisions                      ← Brain-Decisions live
aladdin_decisions_archive_20260513     ← Brain-Decisions vor Reset
```

64 Tabellen insgesamt; weitere Archiv-Tabellen vorhanden.

---

## Coverage pro Quelle

### 1. news_feed (RSS) — ✅ SEHR GUT
- **2142 Einträge**
- **2025-12-29 → 2026-05-18** (140 Tage Coverage)
- Dichte-Buckets:
  - **A_high** (ab 09.05.): 2092 News in 10 Tagen → ~210 News/Tag
  - **B_mid** (07.–08.05.): 30 News
  - **C_low** (Ende Dez 2025 – 23.01.2026): 20 News (sparsam, Initial-Test-Phase)
- **Hyperopt-Tauglichkeit**: ✅ **AUSREICHEND** für Sentiment-Klassifikator-Training (mind. 10 Tage High-Density)

### 2. news_enriched (Phase A heute) — ❌ NUR HEUTE
- 126 Einträge
- 2026-05-18 07:17 → 14:15 (nur heute, ~7h Coverage)
- Hinweis: Kann **rückwirkend aus news_feed gefüllt werden** (Klassifikator läuft offline auf 2142 Posts)
- **Hyperopt-Tauglichkeit**: ✅ wenn Backfill aus news_feed (möglich, ~5min Job)

### 3. liquidations_24h (Phase B heute) — ❌ ZU WENIG
- 104 Einträge
- 2026-05-18 12:25 → 13:13 (nur **3h** Coverage, später WS-Disconnect oder ruhig)
- Quelle: Binance WebSocket (live)
- **Kein Historical-Replay möglich** (Binance liefert keine free-historical Liq-Daten)
- **Hyperopt-Tauglichkeit**: ❌ **30 Tage Sammelphase nötig**

### 4. funding_oi_history (Phase 2 heute) — ❌ ZU WENIG
- 268 Einträge
- 2026-05-18 12:28 → 14:32 (nur 6h Coverage)
- Quelle: Bitget mix-ticker (real-time)
- **Historical Backfill möglich** über Bitget-API: `mix/market/history-fundRate` + OI-Historie ist auf Bitget Public-Endpoint
- **Hyperopt-Tauglichkeit**: ⚠️ **mit Backfill 30-90 Tage möglich** (separate F2)

### 5. etf_flows (Phase C heute) — ⚠️ STARTKAPITAL
- 5 Einträge (manuell gepflegt)
- 2026-05-14 → 2026-05-18 (5 Tage)
- Quelle: manuell aus News-Headers / CSV-Import-Endpoint
- **Historical Backfill möglich** durch CSV-Upload aus alten Berichten (Farside.co.uk Archiv, CoinShares-Reports)
- **Hyperopt-Tauglichkeit**: ⚠️ **mit manuellem Backfill 90-365 Tage möglich** (Christian-Aufwand)

### 6. macro_events (Phase 4 heute) — ❌ NUR ZUKUNFT
- 6 Einträge
- 2026-05-19 → 2026-05-22 (nur kommende Woche)
- Quelle: ForexFactory JSON (this-week only)
- **Historical Backfill möglich** über ForexFactory historical-archive (CSV-Download manuell)
- **Hyperopt-Tauglichkeit**: ⚠️ **mit manuellem Backfill machbar**, sonst 30 Tage warten

### 7. market_sentiment (Fear & Greed) — ⚠️ KNAPP
- 10 Einträge
- 2026-05-09 → 2026-05-18 (10 Tage)
- Quelle: alternative.me
- **Historical Backfill möglich**: alternative.me Endpoint `?limit=N` liefert N Tage retro
- **Hyperopt-Tauglichkeit**: ⚠️ **mit Backfill 365+ Tage möglich** (1 API-Call)

### 8. aladdin_decisions — ✅ EXCELLENT (Brain-Historie)
- **192689 Einträge live** (seit 13.05.2026, 5 Tage)
- **25460 Einträge im Archiv** (04.05.–13.05., 9 Tage)
- = 24 Tage Brain-Decision-Historie
- **Hyperopt-Tauglichkeit**: ✅ für Konsens-Voter-Optimization

### 9. Candles (historical_data/) — ✅ EXCELLENT
- 30+ Symbol-CSVs (1h + 15m)
- BTC: 2020-03-01 → 2026-04-30 (**6.17 Jahre**)
- Coverage perfekt

---

## Gesamt-Bilanz für Hyperopt

| Datenquelle | Coverage | 30d-Schwelle erreicht? | Backfill möglich? |
|---|---|:-:|:-:|
| News (raw) | 140 Tage | ✅ JA | (nicht nötig) |
| News (enriched) | 7h | ❌ | ✅ Backfill ohne Aufwand (Job läuft) |
| Liquidations | 3h | ❌ | ❌ KEIN free Archiv (Coinglass paywalled) |
| Funding/OI | 6h | ❌ | ✅ Bitget history-fundRate Endpoint |
| ETF-Flows | 5 Tage | ❌ | ⚠️ manueller CSV-Upload (Aufwand) |
| Macro-Events | nur Zukunft | ❌ | ⚠️ ForexFactory-Archiv (Aufwand) |
| Fear & Greed | 10 Tage | ⚠️ | ✅ 1 API-Call füllt 365 Tage |
| Aladdin-Decisions | 24 Tage | ⚠️ | (gibt's, lokal) |
| Candles | 6.17 Jahre | ✅ JA | (nicht nötig) |

---

## Empfehlungs-Matrix

### Hyperopt SOFORT MÖGLICH ohne Backfill
- **Strategie-Backtest auf Candles + Fear&Greed**: ✅ heute machbar (6.17J Candles + Backfill F&G 10 min)
- **News-Sentiment-Klassifikator-Tuning**: ✅ 140 Tage News reichen
- **Brain-Familie-Weights-Tuning** (FAMILY_WEIGHTS): ✅ 24 Tage Aladdin-Decisions

### Hyperopt SOFORT MÖGLICH MIT KLEINEM BACKFILL (1-2h)
- **F&G + Candles**: alternative.me `?limit=365` einmal aufrufen → 365 Tage
- **Funding/OI**: Bitget history-fundRate Loop über 90 Tage
- **News-enriched**: news_intelligence-Klassifikator offline über alle 2142 news_feed-Einträge laufen lassen

### Hyperopt BRAUCHT 30-90 TAGE WARTEN
- **Liquidations** (kein free Archiv)
- **ETF-Flows** ohne manuellen Upload

### Hyperopt BRAUCHT MANUELLE DATEN-EINSPEISUNG
- **ETF-Flows**: Christian importiert via CSV historische Farside/CoinShares-Daten
- **Macro-Events**: Christian lädt ForexFactory-Archiv

---

## Top-Empfehlung

**Phase E** (separate F2 wenn gewünscht):
1. **News-Backfill** (5 min Job): news_intelligence-Klassifikator über 2142 news_feed-Einträge → news_enriched mit 140 Tagen
2. **F&G-Backfill** (1 min Job): alternative.me `?limit=365` Call → market_sentiment 365 Tage
3. **Funding/OI-Backfill** (1-2h Job): Bitget history-fundRate Loop über 90 Tage für BTC/ETH/SOL/BNB
4. **ETF-Flow-Manual-Upload**: 30-Tage-Pflege via CSV-Upload-Endpoint

**Damit wäre Hyperopt mit 4 von 6 neuen Sources sofort möglich**, ohne 30-Tage-Wartephase.

**Liquidations** bleibt das Bottleneck (kein Free-Archiv) — entweder Bezahl-Coinglass-API oder 30 Tage warten.

---

## Bot-Status (während Diagnose)
- PM2 R=132 online, PAPER, drift=0
- Brain blockt aktuell wegen NEWS_EXTREME (siehe Diagnose 15:37) — sicheres Crash-Day-Verhalten
- Keine Aktion durch diese Diagnose
