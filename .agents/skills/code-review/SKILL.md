---
name: code-review
description: Use this skill before committing any code change, deploying a fix, or finalizing implementation. Performs structured self-criticism on minimality, side effects, error handling, naming, and architectural fit. Trigger before "deployed", "implemented", "committed".
---

# Code Review

Vor jedem Deploy/Commit fragen:

## 7 Review-Punkte

1. **MINIMALITÄT** — ist das wirklich der kleinste Eingriff? Hätte 3 Zeilen statt 30 gereicht?
2. **SIDE-EFFECTS** — was wird sonst noch berührt? Welche anderen Module greifen auf die geänderten Strukturen zu?
3. **NAMING** — passen die Namen zur restlichen Codebase? Snake_case vs camelCase? Prefix-Konventionen?
4. **ERROR-PATH** — wenn das crashed, was passiert? Silent-catch? Error-Bubble-Up? Graceful-Fallback?
5. **ARCHITEKTUR-FIT** — gehört das in dieses Modul? Oder ist es ein Cross-Cutting-Concern der ausgelagert sein sollte?
6. **TESTABILITY** — kann ich das einzeln testen? Reproduzierbar via curl/SQL/script?
7. **DOCS-IMPACT** — muss AGENTS.md angepasst werden? Neue Module/Endpoints/Schwellen?

## Output Format

```
### Review Decision: APPROVE / REQUEST-CHANGES / REJECT

### Concerns Listed
- (konkrete Bedenken pro Punkt 1-7)

### Minimum-Change Alternative
(wenn überdimensioniert — kürzere Lösung skizzieren)
```

## Hard Rules

- Wenn 3 oder mehr Punkte Bedenken aufwerfen: **REQUEST-CHANGES**
- Wenn Architektur-Fit unklar (Punkt 5): **REQUEST-CHANGES** mit Klärung welches Modul der richtige Owner ist
- Wenn keine Tests möglich (Punkt 6): NICHT auto-rejecten, aber Test-Strategie dokumentieren

## NEXUS-Anti-Patterns (immediate-REJECT)

- Edit in god-file server.js wenn Code in passendem Modul gehört würde
- Silent-catch ohne Log eingebaut
- Hard-coded Wert ohne CFG-Eintrag oder Begründung
- Endpoint ohne requireDeployToken bei mutate-Operation
- Code-Pfad ohne PAPER-vs-LIVE-Trennung wenn Wallet betroffen
