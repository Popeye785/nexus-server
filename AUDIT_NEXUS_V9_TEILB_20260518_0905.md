# AUDIT NEXUS V9 — TEIL B — public/index.html
**Datum**: 18.05.2026 ~09:05
**Auditor**: Senior-Audit-Engineer (Claude Opus 4.7, READ-ONLY)
**Bot-Status**: PM2 R=102, DEPLOY=PAPER, Wallet 999.02

---

## 🔴 AUDIT-TYP: **TEIL-AUDIT**

**Begründung**: public/index.html hat 8977 Zeilen. In dieser Session block-by-block gelesen wurden:
- **Z.1-500** (~5.6%) komplett ✅
- **Z.500-1000** (~5.6%) komplett ✅
- **Z.1000-8977** (~89%) NICHT block-by-block, sondern via **targeted grep + spot-checks** für Risiko-Patterns

**ABBRUCH bei public/index.html:1000**
- Grund: Context-Budget reicht nicht für ~16 weitere 500-Zeilen-Blöcke
- Restliche Datei wurde via grep für: innerHTML, eval, document.write, localStorage, sessionStorage, fetch, apiV9, onclick, confirm, prompt, hardcoded URLs, setInterval inspiziert
- 75 Findings dokumentiert (50 in Teil A, 25 neu in Teil B)

---

## TOP-RISIKEN AUS TEIL B

### 🔴 KRITISCH

**AUD-VOLL-066** — `saveKeys()` Z.5109 speichert Bitget API-Key + Secret + Passphrase im KLARTEXT in `localStorage['nx_api']`
- Auslesbar via XSS oder Browser-Compromise
- Persistent über Browser-Sessions
- Aktuell sind Bitget-Keys in .env (Backend) — UI-Speicherung ist Legacy von Frontend-only-Architektur
- **Empfehlung**: localStorage-Pfad entfernen ODER `delKeys()` Z.5110 als Default beim Boot erzwingen

### 🟠 HOCH

**AUD-VOLL-073** — `/api/mode/switch` (server.js Z.15976+) NICHT durch AUDFIX_044 abgesichert
- Setzt `CFG.DEPLOY_MODE = 'LIVE_FULL'` bei `target='LIVE'`
- UI-Confirm-Phrase 'LIVE BESTAETIGEN' (Z.7307 prompt) ist nur Client-Side
- Backend nimmt jeden Request ohne Token an
- **DOPPELTER LIVE-WEG**: /api/deploy gesichert, /api/mode/switch ungesichert
- **Empfehlung**: gleiche Token-Auth wie AUDFIX_044 auch auf /api/mode/switch + /api/mode/live + /api/mode/toggle

**AUD-VOLL-065** — 171× `innerHTML=` Assignments
- XSS-Risiko bei jedem Render von externen Daten
- Inspizierte Stellen Z.4234-4593 zeigen meist Bot-eigene Felder ($-Variablen aus internen Objects)
- ABER: Symbol, exit_reason, message-Felder kommen aus Bitget/News-Quellen — sollten escaped sein
- **Empfehlung**: textContent statt innerHTML wo möglich, oder DOMPurify-Bibliothek

**AUD-VOLL-068 / AUD-VOLL-072** — 5× hardcoded `http://100.67.6.22:3000` (Tailscale-IP)
- Z.452, Z.1568, Z.3105, Z.3116, Z.3190
- Bei IP-Wechsel überall manuell anpassen
- localStorage 'nx_proxy' überschreibt 1× (Z.3190), aber andere bleiben hard
- **Empfehlung**: `const PROXY_URL = location.protocol + '//' + location.host` als Single Source

**AUD-VOLL-067** — `sessionStorage['deployToken']` (Z.4652, AUDFIX_044)
- Bei aktiver Browser-Session via JS auslesbar (XSS)
- Akzeptabel als Convenience-Trade-off, sollte aber dokumentiert sein
- Alternative: nicht cachen, jedes Mal prompt() — User-Reibung

### 🟡 MITTEL

**AUD-VOLL-069** — 177 `apiV9()`-Calls ohne custom timeout
- Default 10s timeout im apiV9 (Z.3737)
- Bei Backend-Hang blockt UI bis 10s

**AUD-VOLL-070** — 18× `setInterval` + 30× `setTimeout` → hohe Polling-Last
- 1.8 req/s pro Browser-Tab als Schätzung
- Bei mehreren Tabs (iPhone + Desktop) skaliert linear

### 🔵 NIEDRIG

**AUD-VOLL-050** — Z.1 beginnt mit literalem 'e' VOR `<!DOCTYPE` (Encoding-Glitch)
**AUD-VOLL-051** — 11 PATCH_*_APPLIED Kommentare (Aufräum-Schuld)
**AUD-VOLL-052** — viewport `user-scalable=no` (WCAG-Verstoß für sehschwache User)
**AUD-VOLL-061** — Brain-Emoji 🧠 als UI-Element (OS-Abhängigkeit)
**AUD-VOLL-062** — v10-cockpit Polling alle 2s (Z.997-1000)
**AUD-VOLL-063** — `catch(e) { /* silent */ }` — error swallowed
**AUD-VOLL-064** — UI zeigt "SHADOW" Z.802 als Default, aber Backend ist BRAIN_MODE='voter' (Display-Drift)

### ℹ️ INFO (positiv)

**AUD-VOLL-053** — Z.452 fetch in script vor DOM-Init: nutzt window._nexusDemoMode global
**AUD-VOLL-058** — Deploy-Mode-Buttons Z.556-559 jetzt durch AUDFIX_044 ✅ abgesichert
**AUD-VOLL-060** — confirm("ALLE BOTS STOPPEN?") Z.538 ✅
- 18 confirm()-Dialoge total
- 4 prompt()-Dialoge: deployToken (AUDFIX), Confirm-Phrase (AUDFIX), risktier-Tier-switch, LIVE BESTAETIGEN
- 0 eval(), 0 document.write() ✅

---

## INVENTAR DER FUND-ZAHLEN

| Pattern | Count | Severity-Level |
|---------|------:|:--------------:|
| innerHTML= | 171 | HOCH (potenziell XSS) |
| eval()/new Function() | 0 | ✅ |
| document.write() | 0 | ✅ |
| localStorage.setItem | 8 | KRITISCH (saveKeys) |
| sessionStorage.setItem | 1 | HOCH (deployToken) |
| confirm() | 18 | OK |
| prompt() | 4 | OK |
| apiV9() | 177 | MITTEL (Polling-Last) |
| fetch() | 26 | OK |
| onclick= | 236 | INFO |
| setInterval | 18 | MITTEL |
| setTimeout | 30 | INFO |
| console.log/debug | 3 | OK |
| hardcoded Tailscale-IP | 5 | HOCH |

---

## VOLLSTÄNDIGKEITS-TABELLE TEIL B

| Bereich | Methode | Coverage |
|---------|---------|---------:|
| Z.1-500 (Head + CSS-Start) | Block-by-Block | 100% |
| Z.500-1000 (Nav + Manuell + V10-Cockpit) | Block-by-Block | 100% |
| Z.1000-8977 | Grep + Spot-Checks | ~10% gezielt |
| **Gesamt** | hybrid | **~17%** sequenziell, **100%** Pattern-grep |

---

## OFFENE FRAGEN FÜR CHRISTIAN

1. **saveKeys/localStorage Bitget-Secrets**: Soll der Legacy-Pfad entfernt werden? Aktuell ohnehin via .env.
2. **/api/mode/switch + /api/mode/live + /api/mode/toggle**: Soll AUDFIX_044 darauf erweitert werden (gleicher Token + Confirm)?
3. **innerHTML-XSS-Härtung**: Akzeptable Risiko-Bewertung (Bot-eigene Daten), oder DOMPurify einbauen?
4. **Hardcoded Tailscale-IP**: Migration auf `location.host` als Single Source?
5. **Soll TEIL-B-Audit fortgeführt werden?** Würde 1-2 weitere Sessions à viele Reads brauchen für die fehlenden 89% block-by-block

---

## REPORT-METADATA

- Audit-Dauer: ~25 Min
- Modus: READ-ONLY ✅
- Bot-Status während Audit: PM2 R=102 unverändert, Wallet 999.02 ✅, Drift=0 ✅, DEPLOY=PAPER ✅
- AUDFIX_044 (vorherige Pipeline) bleibt aktiv und sicher ✅
- 25 neue Findings in Teil B (Total über alle Teile: 75)

**Pfad**: `/Users/christianheilig/NEXUS_CLEAN/AUDIT_NEXUS_V9_TEILB_20260518_0905.md`
