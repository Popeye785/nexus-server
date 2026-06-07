---
name: session-context
description: Use this skill at the START of every session and BEFORE any time-dependent statement. Establishes current date, time, timezone, bot-uptime context. Required before any output containing "today", "yesterday", "since", "before", "after", "hours ago", "days ago", "still running", "uptime", or any relative time reference.
---

# Session-Context

PFLICHT bei jeder Session-Aktion + vor zeitbezogenen Aussagen.

## Schritte (immer in dieser Reihenfolge)

1. Bash: `date`
   → System-Zeit lokal mit Timezone

2. Bash: `date -u`
   → UTC-Zeit

3. Bash: `pm2 list | grep nexus`
   → Bot-PID, Uptime, R-Counter

4. Ins Audit-Log schreiben:
   - Aktuelles Datum lokal: ...
   - Aktuelles Datum UTC: ...
   - Bot uptime: ...
   - R-Counter: ...
   - Letzter Restart: ...

## Triggerwörter (vor diesen Aussagen Skill durchlaufen)

- "today", "heute", "now", "jetzt", "currently", "aktuell"
- "yesterday", "gestern"
- "since", "seit"
- "before", "after", "vor", "nach"
- "X hours ago", "X Stunden her", "X days ago", "X Tage her"
- "still running", "läuft noch"
- "uptime", "Laufzeit"
- "this morning", "heute morgen", "heute abend"
- "letzte Stunde", "last hour"

## Anti-Pattern

NIEMALS aus Memory/Annahme antworten:
  ❌ "vor 24h" (woher weißt du es?)
  ❌ "seit gestern" (welcher Tag ist gestern?)
  ❌ "jetzt 06:55" (echte System-Zeit prüfen)

IMMER aus `date`-Befehl ableiten.

## Output-Format

Bei jeder zeitbezogenen Aussage zuerst Block ausgeben:

```
📅 Session-Context
- Lokal: <date output>
- UTC: <date -u output>
- Bot uptime: X / R: Y / mem: Z
- Letzter Restart: T
```

Dann erst Aussage tätigen.

## NEXUS-Spezifika

Wichtige Zeit-Anker:
- Day Zero: 20.05.2026 16:53
- 30-Tage-Window endet: 19.06.2026
- brain_acc_sample wartet auf real-trading
- Aktueller Tag = Tag (today - 20.05.2026)
