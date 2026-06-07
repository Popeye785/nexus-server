# AUFKLAERUNG MULTI-KI-GATE — TEIL A
**Datum**: 2026-05-18 12:13

## A1 — Multi-KI-Modul im Code
- `server.js:11153` — `const MultiKI = { ... requiredVotes:3, voters:['SelfHeal','AnomalyDetector','StressTest','SecurityKI','Regime'] }`
- Voter-Pool fest, Quorum 3

## A2 — Multi-KI Endpoints
- `POST /api/multiki/vote` — **MIT requireDeployToken** (Z.17716, geschützt durch AUDFIX_E001_PHASE2)
- `GET /api/multiki/snapshot` — **OFFEN** (Z.17717, read-only)

## A4 — UI-Aufrufer
- `public/index.html:7930` `multiKIVote()` → `apiV9('/api/multiki/vote','POST',{action:'SYSTEM_CHECK'})`
- `public/index.html:7926` `loadMKIGate()` → `apiV9('/api/multiki/snapshot')`
- `apiV9` Wrapper (Z.3735): schickt nur `Content-Type: application/json` — **KEIN x-deploy-token!**

## A5+A6 — curl-Tests

| Test | Code | Body |
|---|---|---|
| GET /api/multiki/snapshot ohne Token | 200 | `{requiredVotes:3, voters:[…], recentVotes:[], lastVote:null}` |
| POST /api/multiki/vote ohne Token | **403** | `{error:'forbidden'}` |
| POST /api/multiki/vote mit Token | 200 | `{passed:true, approved:5, total:5, votes:{SelfHeal:true,…}}` |

## A7 — Hypothesen-Bewertung

| Hypothese | Bewertung |
|---|---|
| A) UI ohne Token → 403 → UNDEFINED | **BESTÄTIGT** für POST /api/multiki/vote |
| B) Endpoint funktioniert, Tabelle leer | **BESTÄTIGT** für GET /api/multiki/snapshot (`lastVote:null`) |
| C) Feld-Name-Mismatch | nein |
| D) Sonstiges | nein |

## Wurzel

`apiV9`-Wrapper hat **keinen X-Deploy-Token**-Header. Seit AUDFIX_E001_PHASE2 (heute 11:48) sind alle Mutation-Endpoints token-pflichtig → alle POST/PUT/DELETE-Aufrufe vom Dashboard scheitern mit 403.

Multi-KI-Gate Anzeige "undefined/undefined" ist Folge daraus:
- Nach Button-Klick "Multi-KI-Abstimmung" → POST → 403 → fetch-result hat keine `passed`/`approved`/`total` → UI zeigt "undefined".

## Fix-Empfehlung (TEIL B)

Zentrale Lösung: `apiV9`-Wrapper erweitern, dass er bei Mutation-Methoden (POST/PUT/DELETE/PATCH) automatisch `x-deploy-token` aus `sessionStorage.getItem('deployToken')` mitschickt. Das fixt **alle UI-fetch-Calls** auf einmal, nicht nur Multi-KI.

Brain-Logik bleibt unangetastet — nur fetch-Header.

## Empfehlung Token-Bootstrap

UI muss Token einmal in `sessionStorage` setzen. Optionen:
1. **Browser-Prompt** beim ersten Mutation-Versuch
2. **Hardcoded** (unsicher, NIEMALS für LIVE-Token)
3. **Auto-Fetch** beim Login-Flow (existiert hier nicht)

Pragmatik: **Prompt-once on first 403** (mit sessionStorage-Persistenz).
