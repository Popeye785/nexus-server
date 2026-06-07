# Geparkte Module — Verzeichnis

Liste aller Module die deployed, aber nicht in Brain/Trade-Pipeline integriert sind. Bewusst geparkt aus Anti-Bloat-Disziplin (eine Variable pro Test, sonst Attribution unmöglich).

## fractional_diff.js — PARKED 27.05.2026

**Status:** PARKED
**Verantwortlich:** Christian (Reaktivierungs-Entscheidung)

**Was es ist:**
- Lopez de Prado Ch.5 — Fractional Differentiation für stationary indicators
- Memory-erhaltende Stationarität (FFD-Variante mit Threshold-Cutoff)
- Modul + Tests + Live-Probe seit Block M Abschnitt 2 (27.05.2026)

**Warum geparkt:**
- MR-Modul (Avellaneda) wurde in Block O A2 ins Brain integriert (Sub-Source MICROSTRUCTURE-Familie für MEGA-Class)
- 2 neue Variablen gleichzeitig im Brain = Attribution-Problem
- Isolation-Disziplin: erst MR-Edge messen, dann nächste Variable

**Reaktivierungs-Trigger:**
1. **MR-Edge nach 14d Beobachtung nicht bestätigt** → FracDiff als alternative Stationaritäts-Lösung
2. **ODER:** explizite Empfehlung aus Validation-Dashboard zeigt Indikator-Overreaction (z.B. RSI/MACD-False-Positives in trending markets)
3. **ODER:** Christian gibt explizit `CFG.FRACDIFF_ENABLED=true` mit Migrations-Plan

**Reaktivierungs-Pfad:**
1. PARKED-Header in `modules/fractional_diff.js` entfernen
2. Pre-Compute optimal-d pro Symbol via `FractionalDiff.findOptimalD(closes)` beim Bot-Boot
3. Cache pro Symbol in `_dCache`
4. In `UnifiedScore.compute` (server.js:~11818) Hook: bei TREND/MOMENTUM-Familien-Indikatoren FracDiff-Variante zur Berechnung
5. Test-First: bekannte non-stationary Series → ADF<-2.86 nach FD
6. CPCV-Validation: ist der Edge tatsächlich besser?

**Risiken bei Reaktivierung:**
- Wenn MR + FracDiff gleichzeitig aktiv: Attribution-Problem
- d-Parameter braucht Tuning pro Symbol (Block-N-Probe ergab d=1.0 für 200-Candle-Sample → mehr Daten nötig)
- Brain-Verhalten ändert sich messbar — Validation-Run erforderlich

**Code-Status:**
- ✅ Modul-Datei vorhanden
- ✅ 5 Tests PASS
- ✅ API-funktional (`FractionalDiff.fracDiff`, `findOptimalD`)
- ❌ NICHT in Brain integriert
- ❌ NICHT in CFG-Toggles enthalten

## Verzeichnis aktualisieren

Bei neuer Modul-Parkung hier eintragen mit:
- Modul-Name + Pfad
- Datum + Block
- Reason + Trigger
- Reaktivierungs-Pfad
