---
name: nexus-handover
description: Use this skill when preparing daily reports, status updates, or handing over to a new session. Formats output in Christian's preferred style — short, claim-status tagged, no multiple-choice, prose over bullets where possible.
---

# Handover-Format

## Christian-Stil-Regeln

- **Kurz, knapp, simpel** — keine 5000-word essays
- **Claim-Status pro Aussage:** VERIFIZIERT / PLAUSIBEL / UNSICHER / UNBEKANNT
- **Keine Multiple-Choice-Buttons** — entscheide selbst, melde Vorgehen
- **Code/Tabellen vor Theorie**
- **Ein Text, ohne Multi-Step**
- **Stale-Daten klar markieren** (z.B. "letzte Messung vor 2h")
- **Quant-Niveau** (LdP/LEAN/Aladdin/Nautilus/Renaissance), **kein 3Commas/Pionex/Bitsgap**
- **Reihenfolge von Codex 1:1** — Christian hasst Umsortierung

## Endbericht-Pflichtfelder

1. **Was wurde gemacht** (mit FIX-IDs)
2. **Bot-Health** (PID, R, mem, drift, brain alive)
3. **Backlog-Update** (was zugemacht, was offen)
4. **Ehrliche Lücken-Sektion** (was nicht geprüft wurde)
5. **Definition-of-Done Tabelle pro Hauptpunkt** (11 Rules pro Fix)
6. **Nächster Schritt-Vorschlag** (kein Multiple-Choice)

## Output-Format-Template

```
# [Block-Name] — Endbericht $(date)

## ✅ Was gemacht
- FIX X.Y: ...
- ...

## Bot-Health
- PID, R, mem, uptime
- drift, consistent
- DB integrity

## Definition-of-Done — pro Item
| # | Item | Rule | Status | Evidence |

## Backlog
| ID | Status |
| brain_acc_sample | ⏳ zeit-abhängig |
| ... | ... |

## ⚠️ Ehrliche Lücken
- (was nicht geprüft, warum)

## Nächster Schritt
- (konkret, single-track)
```

## Hard Rules

- **Niemals "wahrscheinlich" als Fakt verkaufen**
- **Niemals Stop-Gates wegen Approval** wenn Christian bereits "volle Freigabe" gegeben
- **Niemals Items ins Backlog schieben weil Token-Engpass** — sauberer Pause-Punkt mit "nächster Pass macht X"
- **Niemals 99.5% Win-Rate** ohne winRateWeighted-Kontext
- **Niemals "deployed" ohne Definition-of-Done Validation**

## Tone

- Sachlich, nicht euphorisch
- "✓" sparsam, nur bei harten Evidence
- Schlechte Befunde transparent (z.B. "Item 5 FAIL — Mobile-Touch 98% < 44px")
- Keine Marketing-Language ("massive improvement", "amazing", "blazing fast")
