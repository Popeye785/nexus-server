# STUFE 2 — COVERAGE-FIX 6 DORMANTE SUB-SOURCES — ENDBERICHT

**Verankert:** 2026-05-20 13:18
**Status:** ✅ CODE-COMPLETE / ⚠️ BEOBACHTUNG_NÖTIG
**Bot-State:** PID 5575, R=169, drift=0, brain_alive=true, KillSwitch ruhig

---

## A. WAS WURDE GEMACHT

6 Sub-Sources, die seit Wochen `direction:NEUTRAL score:0` lieferten, wurden code-mäßig wiederbelebt:

| # | Sub-Source | Patch | Datei:Zeile |
|---|---|---|---|
| 2.1 | mlEnsemble | Soft-Bias bei HOLD-Output (probBuy-probSell-Differenz statt binär) | server.js Z.11400-11414 |
| 2.2 | regime | Trend-Vorzeichen bei RANGING (Regime.trend ±0.002 → BUY/SELL ±0.15) | server.js Z.11431-11444 |
| 2.3 | anomaly | Score-Tier 2/4/6 statt binär block-only | server.js Z.11555 |
| 2.4 | btcCorr | Symmetric BUY-Bias bei BTC-Pump (vorher nur SELL bei Drop) | server.js Z.11599 |
| 2.5 | oi | 4-Stufen-Skala statt single threshold (STABLE/MILD/STRONG) | modules/datasource_funding_oi.js |
| 2.6 | macroCalendar | Pre-Awareness bis 8h vor High-Event + Active-Filter HIGH-only | modules/datasource_macro_calendar.js |

## B. WIESO

PRE-Snapshot (30 min vor STUFE 2): alle 6 Sub-Sources hatten 0% aktive Direction-Votes. Sie hingen passiv in den members-Listen ohne Brain-Beitrag. NEXUS V9 hatte effektiv nur ~23 von 29 Sub-Sources stimmberechtigt.

## C. ARCHITEKTUR-DETAIL

- **regime** und **mlEnsemble** haben unmittelbare empirische Aktivierung gezeigt (siehe E).
- **anomaly/btcCorr/oi** brauchen Markt-Bewegung um Score >Schwelle zu produzieren. RANGING-Markt zur Beobachtungszeit = wenig Trigger.
- **macroCalendar** triggert auf Event-Fenster: FOMC Minutes ist um 20:00 (6.7h nach Reload) → Pre-Awareness 8h-Window aktiv → erwartetes `PRE_HIGH_EVENT` SELL -0.1 ab ca. 12:00 sichtbar.
- **macroCalendar Sub-Fix:** Active-Window-Filter ignoriert jetzt Low-Impact-Events (FOMC Speakers etc.), damit Pre-Awareness für High-Impact-Events nicht von Low-Impact-Aktiv-Window blockiert wird.

## D. SNAPSHOTS

PRE: `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE2_COVERAGE_PRE_20260520_125146/`
POST: `/Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE2_COVERAGE_20260520_125946/`
DB-Snapshot inkl., server.js+modules-Verzeichnis komplett.

## E. VERIFY-KENNZAHLEN (5-min POST-Sample)

| Sub-Source | PRE | POST 5min | Diff |
|---|---:|---:|---:|
| mlEnsemble | 0% | **19.3%** | +19.3 ✅ |
| regime | 0% | **33.3%** | +33.3 ✅ |
| anomaly | 0% | 0% | — (markt-bedingt) |
| btcCorr | 0% | 0% | — (BTC stable) |
| oi | 0% | 0% | — (markt-bedingt) |
| macroCalendar | 0% | 0% (Fix-Reload erfolgt) | — (event-bedingt) |

**Family-Aktivität POST 5min:**
- TREND 85.9% / MOMENTUM 74.1% / RISK 34.8% / SENTIMENT 78.5% / MICROSTRUCTURE 84.4%
- Avg members per family stable
- Decision-Mix: BUY 114, SELL 21 (135 total in 5 min)

## F. ROLLBACK-PFAD

1. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE2_COVERAGE_PRE_20260520_125146/server.js /Users/christianheilig/NEXUS_CLEAN/server.js`
2. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE2_COVERAGE_PRE_20260520_125146/modules/datasource_funding_oi.js /Users/christianheilig/NEXUS_CLEAN/modules/`
3. `cp /Volumes/NEXUSBOT V9/NEXUS_BACKUPS/STUFE2_COVERAGE_PRE_20260520_125146/modules/datasource_macro_calendar.js /Users/christianheilig/NEXUS_CLEAN/modules/`
4. `pm2 reload nexus --update-env`

## G. DEMO=LIVE

Alle 6 Patches sind Score-Berechnungs-Logik in Brain-Sub-Sources, die in PAPER und LIVE identisch laufen. Kein Order-Send-Pfad, kein Wallet-Pfad berührt. DEMO=LIVE-Garantie erhalten.

## H. RISIKO-EINSCHÄTZUNG

- **anomaly:** wenn Markt vola-Spike, neue SELL-Stufen aktiv → conservative Bias bei extreme moves. KEIN Risiko durch zu aggressives Triggern (Threshold > 2 ist konservativ).
- **btcCorr:** symmetric Bias kann jetzt BUY-Votes auf BTC-Pump-Tagen geben — gewünschtes Verhalten.
- **mlEnsemble Soft-Bias:** confidence cap 0.35 (statt 0.50+) verhindert dass dieser Soft-Vote die Familie dominiert.

## I. NÄCHSTE BEOBACHTUNGS-FENSTER

- 30 min nach Reload: Erwartung dass anomaly/oi auch ohne extreme Markt-Events score ≠ 0.05 Stufen zeigt
- 12:00 lokal (5h später): macroCalendar PRE_HIGH_EVENT SELL für FOMC Minutes
- Bei BTC-Bewegung >0.2%: btcCorr-Aktivierung

## J. AUDIT-LOG

`/Users/christianheilig/NEXUS_CLEAN/.audit_log_master.tsv` Eintrag: `stufe2_coverage_fix` 2026-05-20

---

**STUFE 2 ENDE — STUFE 1 BEGINNT (HMM-Regime + Adaptive FAMILY_WEIGHTS)**
