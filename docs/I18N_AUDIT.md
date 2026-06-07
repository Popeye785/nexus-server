# I18N AUDIT — `public/translations.js` × `public/index.html`

**Datum:** 2026-05-25
**Quellen:** `/Users/christianheilig/NEXUS_CLEAN/public/translations.js` (531 Zeilen) und `/Users/christianheilig/NEXUS_CLEAN/public/index.html` (9 805 Zeilen).
**Methode:** AST-light Parsing des `const TEXTS = { … }` Literals via braced-balanced Extraktion + `new Function(...)`-Eval (Lit ist reines Object-Literal, kein eval-Risiko). HTML-Scan via Regex auf `data-i18n=`, `data-i18n-title=`, `data-i18n-placeholder=` plus `T('key')`-Aufrufe in inline-JS.

---

## 1. Sprachen und Schlüssel-Bestände

| Sprache | Keys | Fehlend vs. Union | Leer |
|---|---:|---:|---:|
| **DE** (Default) | **131** | 0 | 0 |
| **EN** | **131** | 0 | 0 |
| **ES** | **131** | 0 | 0 |

**Union aller Keys:** 131. Die drei Sprachen sind **vollständig deckungsgleich** — kein Key fehlt in EN oder ES, keine leeren Strings.

`SUPPORTED = ['DE','EN','ES']` · `DEFAULT_LANG = 'DE'` · Persistenz via `localStorage.nexus_lang`. Fallback in `T(key)`: erst aktive Sprache, dann DE, dann Key selbst.

---

## 2. HTML-Nutzung der Übersetzungen

| Attribut | Anzahl Vorkommen |
|---|---:|
| `data-i18n="…"` | **44** |
| `data-i18n-title="…"` | 0 |
| `data-i18n-placeholder="…"` | 0 |
| `T('key')` direkt im Inline-JS | 0 |
| **Unique Used Keys** | **44** |

Inline-Aufrufe vom i18n-API beschränken sich auf `window.NEXUS_I18N.setLang/getLang` (Zeilen 5577, 5610) — kein `T('…')`-Call in Inline-Scripts.

### Verwendete Keys (44, sortiert)
```
config.deploy_token, config.deploy_token.desc,
config.features.futures, config.features.futures.desc,
config.features.leverage, config.features.leverage.desc,
config.features.margin, config.features.margin.desc,
config.features.short, config.features.short.desc,
config.features.spot, config.features.spot.desc,
config.features.title,
config.language, config.language.choose, config.language.sub,
config.risk.pos, config.risk.title, config.risk.vol,
config.security, config.security.antibrick,
kapital.blocked_today, kapital.cron.note, kapital.news_risk,
tab.analyse, tab.ars, tab.bots, tab.chart, tab.coins, tab.config,
tab.diagnose, tab.exchanges, tab.indikatoren, tab.kapital,
tab.markt, tab.ml, tab.news, tab.orders, tab.sicherheit,
tab.signal, tab.status, tab.stratbuild, tab.system, tab.whale
```

---

## 3. Critical — HTML verwendet Key aber Übersetzung fehlt

**Anzahl: 0** ✅

Jeder im HTML referenzierte `data-i18n`-Key existiert in DE (Default-Sprache) — UI-Render läuft niemals in `key`-Fallback. Da DE/EN/ES symmetrisch sind, gilt das automatisch auch für EN und ES.

---

## 4. Unused — Translation-Keys ohne HTML-Verwendung

**Anzahl: 87 / 131** (66 % aller Keys werden im aktuellen HTML nicht via `data-i18n` referenziert).

### Verteilung nach Namespace
| Prefix | Unused | Gesamt im DE |
|---|---:|---:|
| `kapital.*` | 29 | ca. 38 |
| `config.*` | 15 | ca. 30 |
| `common.*` | 14 | 14 (komplett ungenutzt) |
| `regime.*` | 12 | 12 (komplett ungenutzt) |
| `engine.*` | 5 | 5 (komplett ungenutzt) |
| `tg.*` | 5 | 5 (Telegram-Backend-only) |
| `header.*` | 3 | 3 (komplett ungenutzt) |
| `slots.*` | 3 | 3 (komplett ungenutzt) |
| `tab.*` | 1 (`tab.kidash`) | 22 |

### Top-20 (illustrativ — Auswahl quer durch Namespaces)
1. `common.loading`
2. `common.error`
3. `common.save`
4. `common.cancel`
5. `common.refresh`
6. `common.yes`
7. `common.no`
8. `common.on`
9. `common.off`
10. `common.active`
11. `common.inactive`
12. `common.healthy`
13. `common.warning`
14. `common.critical`
15. `tab.kidash`
16. `kapital.title`
17. `kapital.total`
18. `kapital.reserve`
19. `kapital.trading`
20. `kapital.imMarkt`

### Interpretation
- `tg.*` (5 Keys) sind ausdrücklich für **Telegram-Server-Side** (Bot-Antworten), erscheinen daher nicht im HTML — **nicht** als toter Code zu zählen, sondern als Server-Use-Case.
- `regime.*` (12 Keys) werden dynamisch in inline-JS via `regime.<value>` per **String-Konkatenation** referenziert; eine reine Regex auf statische `T('regime.bull')`-Calls erkennt sie nicht. Wahrscheinlich live verwendet — **Falsch-Positiv** der Regex.
- `engine.*` (5 Keys), `header.*` (3), `slots.*` (3) sind klassische dynamische Status-Texte, die per JS gesetzt werden. Vermutlich genutzt aber nicht via `data-i18n` deklariert.
- `common.*` (14 Keys, 100 %) — komplett ungenutzt. Verdacht: hard-coded statt `data-i18n` in HTML.
- `kapital.*` (29 Keys) — viele 1:1-Detail-Texte (z.B. `kapital.title.demo`, `kapital.reserve_ist`, `kapital.blocked_floor`); UI baut KAPITAL-Tab vermutlich teils direkt aus DOM-IDs ohne `data-i18n`-Markup.
- `tab.kidash` — der Tab heißt im HTML `nb-aidash` (siehe Mobile-Audit). Translation-Key heißt `tab.kidash` (deutsche Schreibweise) — **echter Mismatch**, KI-DASH-Tab wird nicht übersetzt.

---

## 5. Inconsistencies / Befunde

| # | Befund | Schweregrad |
|---|---|---|
| 1 | `tab.kidash` existiert in 3 Sprachen, **HTML-Element heißt aber `nb-aidash` ohne `data-i18n`** → KI-DASH-Tab wird in EN/ES nie übersetzt. | **gelb** (Funktional, aber lokalisiert nicht) |
| 2 | `common.*` 14 Keys, 0 Verwendung — entweder Roadmap-vorbereitet oder hard-coded-Strings in HTML statt Markup. | gelb |
| 3 | `regime.*`, `engine.*`, `header.*`, `slots.*` (23 Keys) — vermutlich dynamisch gesetzt via JS `T('regime.bull')` als String-Konkat oder `el.textContent = T(...)` außerhalb des `_applyTranslations`-Loops. Audit-Regex erfasst das nicht. | gelb (Unsicherheit) |
| 4 | Nur **44 von 131 Keys** werden statisch via `data-i18n` im HTML gerendert — d.h. 66 % des Vokabulars hängt entweder am Telegram-Bot oder an dynamischem JS. | gelb (Coverage-Gap) |
| 5 | `tab.diagnose` ist im Translations-Dict, **kein** `nb-diagnose` Tab existiert im HTML (Mobile-Audit zeigt 21 Tabs ohne diesen Namen) — möglicherweise abgeschaffter Tab, Key ist verwaist. | grün-gelb |
| 6 | `data-i18n-title` und `data-i18n-placeholder`-Loops sind in `_applyTranslations` implementiert (translations.js:499-507) — aber **0 Anwendungen** im HTML. Funktion existiert ohne Verbraucher. | grün (kein Schaden, leichte Dead-Code-Lage) |
| 7 | DE/EN/ES sind exakt symmetrisch (131/131/131) — keine Übersetzungs-Lücken, keine leeren Strings. | **grün** |

---

## 6. Verdikt

# 🟢 GRÜN mit gelben Punkten

**Begründung:**
- ✅ **Keine fehlenden Übersetzungen** — alle 131 Keys existieren in allen 3 Sprachen (DE/EN/ES), keine leeren Werte.
- ✅ **0 critical missing** — jeder `data-i18n`-Key im HTML hat einen Eintrag im DE-Default.
- ✅ Fallback-Logik sauber implementiert (`T(key)` → aktive Sprache → DE → Key).
- 🟡 **1 echter Mismatch**: Tab-ID `nb-aidash` verwendet keinen `data-i18n`-Hook → Translation-Key `tab.kidash` greift nicht; KI-DASH-Tab-Label bleibt sprachfix.
- 🟡 **66 % Coverage-Gap**: 87 Keys werden im HTML-Markup nicht statisch eingebunden. Davon sind ca. 25-30 Keys vermutlich legitim dynamisch (regime, engine, header, slots, tg) — aber `common.*` (14) und große Teile von `kapital.*` (29) sind reale Dead-Code-Kandidaten oder fehlende `data-i18n`-Hooks im HTML.
- 🟡 `data-i18n-title` und `data-i18n-placeholder` haben Maschinerie ohne aktiven Konsumenten.

**Empfehlungen (nicht im Audit-Auftrag, nur Referenz):**
1. `tab.kidash` → HTML-Element `nb-aidash` mit `data-i18n="tab.kidash"` ergänzen (1-Zeilen-Fix, oder Key auf `tab.aidash` umbenennen). Same für ggf. fehlendes `tab.diagnose`-Mapping.
2. `common.*`-Cluster (14 Keys, 0 Use) — einmal entscheiden: ins HTML als `data-i18n` einbinden (KAPITAL-Tab, Status-Karten) oder als veraltet löschen.
3. `regime.*`, `engine.*` dynamische Nutzung verifizieren: `grep -n "T('regime" public/index.html` zeigt aktuell 0 Hits. Wenn Status-Texte hardcoded sind, dann via JS auf `T(...)` umstellen.
4. `data-i18n-placeholder` für die Input-Felder im CONFIG-Tab nutzen — der Mechanismus existiert bereits.

---

*Erstellt: 2026-05-25 — read-only audit, keine Code-Änderungen. Methode: braced-balance-Extraktion + `new Function`-Eval des Object-Literals + Regex-Scan über HTML.*
