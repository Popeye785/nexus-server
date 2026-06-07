# DIAGNOSE — Slot-Management + AUTO-Button + Performance-Logik
**Datum**: 2026-05-19 10:54
**Modus**: READ-ONLY

---

## A) Was macht AUTO konkret?

### Code-Stelle: `_suggestSlots(capital)` (server.js Z.17588-17596)

```js
function _suggestSlots(capital) {
  if (capital < 300)    return { slots: 2,  rationale: '< 300 USDT — sehr defensiv, 2 Slots' };
  if (capital < 800)    return { slots: 3,  rationale: '300-800 USDT — vorsichtig, 3 Slots' };
  if (capital < 2000)   return { slots: 5,  rationale: '800-2000 USDT — Standard, 5 Slots' };
  if (capital < 10000)  return { slots: 8,  rationale: '2-10k USDT — diversifiziert, 8 Slots' };
  if (capital < 50000)  return { slots: 12, rationale: '10-50k USDT — Skalierung, 12 Slots' };
  return { slots: 15, rationale: '> 50k USDT — Vollausbau, 15 Slots' };
}
```

**Verdikt**: AUTO ist **rein Kapital-basierte Lookup-Tabelle**. 6 Stufen, fix.
- Nicht dynamisch
- Nicht performance-abhängig
- Nicht volatilitäts-abhängig
- Wird in `/api/slots/snapshot.suggested` zurückgegeben
- Telegram-Command `/slots auto` setzt `CFG.MAX_OPEN_TRADES = _sug.slots` (Z.19219)

**Bei Wallet 999.024 USDT** → AUTO empfiehlt **5 Slots** (800-2000-Bucket).

---

## B) Ist Performance-basierte Slot-Allocation eingebaut?

**Nein für Slot-Anzahl.** ✅ **JA für CapitalPool** (BotType-Allokation).

### CapitalPool (server.js Z.10378+)
Trade-Capital wird auf **BotType-Quoten** verteilt (nicht Performance-basiert):

```js
ALLOC: { SINGLE: 0.40, GRID: 0.25, DCA: 0.20, INFGRID: 0.15 }
LIMITS: SINGLE max 3, GRID max 2, DCA max 2, INFGRID max 1
```

Live-Werte:
```
SINGLE:  Quote 40%, balance 393.59 USDT, 0/3 aktiv
GRID:    Quote 25%, balance 245.99 USDT, 2/2 aktiv (full)
DCA:     Quote 20%, ...
INFGRID: Quote 15%, ...
```

→ **Pools sind fix-allokiert pro BotType, nicht performance-gewichtet.**

---

## C) Existiert "schwächsten Bot rauswerfen"-Logik?

**Ja: `StrategyRotation`** (server.js Z.6825+)

### Funktionsweise
- Läuft alle 5 Minuten (`STRATEGY_ROTATION_EVAL_MS: 300000`)
- Berechnet Sharpe pro Strategie aus letzten N Trades (`STRATEGY_ROTATION_WINDOW_TRADES`, default 50)
- Wählt **EINE** aktive Strategie (`_active`)
- Wechselt zu bester Strategie wenn:
  - Sharpe-Differenz > Hysterese (`STRATEGY_ROTATION_HYSTERESIS`)
  - Mindest-Haltedauer überschritten (`STRATEGY_ROTATION_MIN_HOLD_DAYS`)
  - Mindest-Trades pro Strategie (`STRATEGY_ROTATION_MIN_TRADES`, default 20)

### Aktueller Stand
```json
{
  "active": {
    "strategy": "DEMO_UNIFIED",
    "since": 1778913771354,
    "sharpe": -0.104
  },
  "history_count": 0
}
```

**Problem**: Nur 1 Strategie (`DEMO_UNIFIED`) mit 27 Trades existiert. Sharpe -0.10. Keine Alternative zum Rotieren.

→ **StrategyRotation existiert**, ist aber praktisch **stillgelegt** weil:
1. Nur 1 Strategie in `strategy_performance`
2. Erst bei 20+ Trades pro Strategie aktiv
3. Wechsel-History = 0

---

## D) Christian's Idee — schon implementiert?

**Teilweise. Aber 3 Lücken:**

### Was IST da:
- ✅ Slot-Anzahl per Kapital-Lookup (`/slots auto`)
- ✅ BotType-Capital-Pool (40/25/20/15)
- ✅ StrategyRotation per Sharpe (Code da, ungenutzt)

### Was FEHLT:
1. **Performance-basierte Slot-Anzahl** — z.B. mehr Slots wenn gut performt, weniger bei DD
2. **Performance-basierte CapitalPool-Gewichtung** — aktuell fix 40/25/20/15, könnte z.B. SINGLE auf 50% wenn besser läuft als GRID
3. **Per-Symbol-Performance-Filter** — schwacher BTC raus, ETH bekommt mehr

---

## E) Empfehlung

| Option | Aufwand | Wirkung |
|---|---|---|
| **UI besser nutzen** (Christian klickt manuell um zu testen) | 0 | sofort |
| **Performance-Slot-Anzahl** (Sharpe>1 → +2 Slots, MaxDD>5% → -1 Slot) | 1-2h | dynamisch |
| **CapitalPool dynamisch** (BotType-Quoten nach 7d-PnL) | 2-3h | bessere Allokation |
| **Per-Symbol-Blacklist** (schwächste 2 Symbole 30d → skip) | 1-2h | Filter |
| **StrategyRotation aktivieren** (braucht mehrere Strategien in DB) | separate F2 | aktuell deaktiviert in Praxis |

---

## ANTWORT KOMPAKT

**A) AUTO** = Kapital-Lookup (300/800/2000/10k/50k Stufen → 2/3/5/8/12/15 Slots). KEINE Performance.

**B) Performance-Slot-Allocation:** NEIN für Slots, JA für BotType-Capital (aber fix-quotiert).

**C) Schwächste-Bot-Rauswerfen:** Code existiert (`StrategyRotation`), aber nur 1 Strategie aktiv → läuft nicht.

**D) Christian's Idee:** zur Hälfte implementiert (Capital-Pool ja, dynamic Slots nein).

**E) Empfehlung:** Performance-basierte dynamische Slot-Anzahl bauen (1-2h) wäre größter Hebel — verdoppelt Slots wenn gut, reduziert bei DD.
