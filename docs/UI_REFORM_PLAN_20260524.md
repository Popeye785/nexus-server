# [VERWORFEN — nicht nötig] NEXUS V9 — UI-REFORM PLAN (Phase 3)

> ⚠️ **DIESES DOKUMENT IST VERWORFEN** (24.05.2026 15:30)
> Grund: Basierte auf fehlerhaftem UI_DEEP_AUDIT (BOTS-Tab als leer markiert).
> Christian-Entscheidung nach UI_AUDIT_V2_VISUAL: Option D Mikro-Cleanup statt Reform.
> Keine Tab-Reorganisation. Keine Block-Struktur. Kein STRATBUILD-Hide. Nichts.
>
> **Master-Doc gültig:** `docs/UI_AUDIT_V2_VISUAL_20260524.md`
> Tatsächlich umgesetzt: nur DEMO-Badge weg + "47 IND" → "INDIKATOREN".

---

# NEXUS V9 — UI-REFORM PLAN (Phase 3) [VERWORFEN]
**Datum:** 2026-05-24 14:40
**Status:** 🟡 STOPP für Christian-Freigabe (jeder Move/Hide/Remove einzeln freigeben)
**Methodik:** Profi-Vorschlag basierend auf Christian-Vision + Deep-Audit

---

## VORGESCHLAGENE NEUE TAB-REIHENFOLGE (21 Tabs)

### Block A — TRADING (täglich, vorne)
| Pos | Alt-Tab | Neu-Name | Begründung |
|--:|---|---|---|
| 1 | MARKT | **📊 MARKT** | Haupt-Ticker, Start-Tab |
| 2 | CHART | **📈 CHART** | Live-Chart |
| 3 | ANALYSE | **🔬 ANALYSE** | TA-Score + Indikatoren-Snapshot |
| 4 | 47 IND | **🧮 INDIKATOREN** | RENAME (Christian T6.9) |
| 5 | SIGNAL | **⚡ SIGNAL** | Signal-Tabelle |
| 6 | ORDERS | **📖 ORDERS** | Orderbook |
| 7 | WHALE | **🐋 WHALE** | Wyckoff-Methode |
| 8 | NEWS | **📰 NEWS** | RSS-Feed + Risk |

### Block B — BOT-MANAGEMENT (mehrmals täglich)
| Pos | Alt-Tab | Neu-Name | Begründung |
|--:|---|---|---|
| 9 | STATUS + (manuell) | **⚡ STATUS** | Engine-Status + manueller Override zusammen |
| 10 | BOTS | **⚙️ BOTS** | Aktive Bots (wenn gefüllt) — sonst HIDE |
| 11 | KAPITAL | **💰 KAPITAL** | V9 Balance + Eviction + Equity-Curve |
| 12 | COINS | **🪙 COINS** | Coin-Verwaltung + Watchlist |

### Block C — KI & ML (Profi-Tiefe)
| Pos | Alt-Tab | Neu-Name | Begründung |
|--:|---|---|---|
| 13 | KI-DASH | **🧠 KI-DASH** | Live-Status aller AI-Algorithmen |
| 14 | ML | **🧬 ML** | Training + Model-Management |

### Block D — INFRASTRUKTUR & SICHERHEIT (selten)
| Pos | Alt-Tab | Neu-Name | Begründung |
|--:|---|---|---|
| 15 | SICHERHEIT | **🛡 SICHERHEIT** | KI-Monitoring + DD-Recovery |
| 16 | ARS | **🔧 ARS** | Autonomous Repair |
| 17 | DIAGNOSE | **🔎 DIAGNOSE** | Watchdog + Wächter-Checks |
| 18 | SYSTEM | **🛠 SYSTEM** | Kill-Switch + Risk-Tier + Trend-Quality |
| 19 | EXCHG | **🌐 EXCHG** | Multi-Exchange-Router |
| 20 | STRATBUILD | **🧩 STRATBUILD** | nur wenn Christian aktiv nutzt — sonst HIDE |
| 21 | CONFIG | **🔑 CONFIG** | API + Sprache + Security + Risk-Guard |

---

## KONKRETE ENTSCHEIDUNGEN

### ✅ AUTONOM (mache ich ohne Rückfrage)

| # | Aktion | Begründung |
|--:|---|---|
| 1 | RENAME "47 IND" → "INDIKATOREN" (DE/EN/ES) | T6.9 freigegeben |
| 2 | Tab-Reihenfolge neu sortieren | UX-Verbesserung |
| 3 | Visuelle Konsistenz (Card-Style, Buttons, Farben) | erlaubt |
| 4 | Tooltips hinzufügen wo unklar | erlaubt |
| 5 | i18n für alle Tab-Labels + Card-Titel ergänzen | erlaubt |
| 6 | "STATUS" (scr-trade) inhaltlich aufwerten mit scr-manuell-Inhalt embedded | Tab umfunktionieren = autonomy-grey-area, aber **innerhalb des STATUS-Tabs**, kein neuer Tab |
| 7 | Mobile-Test + Responsive-Fix | erlaubt |
| 8 | Sprach-Toggle Live-Switch im Header (statt nur CONFIG) | UX-Plus, kein Move |

### 🟡 BRAUCHE CHRISTIAN-FREIGABE

| # | Aktion | Risiko | Empfehlung |
|--:|---|:-:|---|
| **9** | **HIDE "STRATBUILD"** | niedrig | Tab ist ungenutzter Drag&Drop-Builder. HIDE statt REMOVE → wiederherstellbar |
| **10** | **HIDE "BOTS"** wenn leer bleibt | niedrig | scr-bots hat 0 Cards → leer. Entweder mit Bot-Übersicht füllen oder HIDE |
| **11** | **Sub-Tab-Struktur** für KAPITAL (Balance/Equity/Eviction als interne Tabs) | mittel | aktuell 7 Cards in 1 Tab — könnte überladen |
| **12** | **Trade-Bots-Übersicht** (Liste aller Bots) in BOTS-Tab einbauen | niedrig | scr-bots ist leer, sollte mit Bot-Liste gefüllt werden |
| **13** | **scr-manuell** komplett in STATUS-Tab embedden | mittel | macht STATUS richtig "voll" und sinnvoll |
| **14** | **NOTFALL-Card aus scr-manuell entfernen** | hoch | Duplikat zu SYSTEM-Kill-Switch — aber Notfall-Button extra ist evtl. gewollt |
| **15** | **scr-features** in CONFIG-Tab embedden | mittel | Feature-Toggles gehören zu Config |
| **16** | **scr-scripting** in STRATBUILD embedden | mittel | beides "Custom Code" |

### ❌ NICHT EMPFOHLEN (Christian-Vision sagt sonst)

- Bitget-API von CONFIG zu EXCHG verschieben → Christian-Status: Bitget bleibt PRIMARY in CONFIG, EXCHG ist für andere Exchanges
- Tabs vollständig entfernen → HIDE bevorzugt

---

## 16 ENTSCHEIDUNGEN — CHRISTIAN-ANTWORT-CHECKLISTE

Bitte je mit ✅/❌ markieren:

```
Block-Autonom (mache ich ohnehin):
 1. ☑ "47 IND" → "INDIKATOREN" RENAME      → mache ich
 2. ☑ Tab-Reorder Block A/B/C/D            → mache ich
 3. ☑ Visuelle Konsistenz                  → mache ich
 4. ☑ Tooltips + DAU-Tauglichkeit          → mache ich
 5. ☑ i18n vollständig (alle Card-Titel)   → mache ich
 6. ☑ STATUS-Tab inhaltlich aufwerten      → mache ich (intern)
 7. ☑ Mobile responsive                    → mache ich
 8. ☑ Sprach-Toggle im Header              → mache ich (UX-Plus)

Block-Freigabe-Pflichtig (brauche dein ✅/❌):
 9. ☐ HIDE "STRATBUILD" (Drag&Drop-Builder, vermutlich ungenutzt)
10. ☐ HIDE "BOTS" wenn leer bleibt
11. ☐ KAPITAL als Sub-Tabs strukturieren (Balance/Equity/Eviction getrennt)
12. ☐ BOTS-Tab mit Bot-Liste füllen (statt HIDE) — Alternative zu #10
13. ☐ scr-manuell komplett in STATUS-Tab embedden
14. ☐ NOTFALL-Card aus scr-manuell entfernen (Duplikat zu SYSTEM-Kill)
15. ☐ scr-features in CONFIG embedden
16. ☐ scr-scripting in STRATBUILD embedden
```

---

## VORHER-NACHHER VORSCHAU

### Aktuell (verwirrend)
```
MARKT | WHALE | CHART | ANALYSE | SIGNAL | ORDERS | 47 IND |
STATUS | BOTS | COINS | KAPITAL | NEWS | KI-DASH | ARS | SICHERHEIT |
ML | SYSTEM | DIAGNOSE | EXCHG | STRATBUILD | CONFIG

(2-Zeilen-Nav, gemischte Reihenfolge, "47 IND" unklar, leerer BOTS)
```

### Vorschlag (Profi-strukturiert)
```
BLOCK A (Trading):   MARKT │ CHART │ ANALYSE │ INDIKATOREN │ SIGNAL │ ORDERS │ WHALE │ NEWS
BLOCK B (Bots):      STATUS │ BOTS │ KAPITAL │ COINS
BLOCK C (KI):        KI-DASH │ ML
BLOCK D (Tech):      SICHERHEIT │ ARS │ DIAGNOSE │ SYSTEM │ EXCHG │ [STRATBUILD] │ CONFIG
                                                                  ↑ optional HIDE
```

---

## VERIFIKATIONS-PLAN nach Umsetzung

| Test | Kriterium |
|---|---|
| DAU-Test "wo wechsel ich die Sprache?" | CONFIG-Tab → SPRACHE-Karte sichtbar |
| DAU-Test "wo sehe ich meine Trades?" | STATUS oder BOTS-Tab |
| DAU-Test "wo ist mein Kapital?" | KAPITAL-Tab |
| DAU-Test "wie pausiere ich?" | STATUS-Tab Manueller Modus |
| DAU-Test "Notfall-Stopp?" | SYSTEM-Tab Kill-Switch ODER STATUS-Tab |
| Profi-Test "wo sind die Bot-Strategien?" | STRATBUILD (wenn aktiv) ODER ML |
| Profi-Test "Indikator-Bundle?" | INDIKATOREN-Tab (war 47 IND) |
| i18n-Test EN/ES | alle Tab-Labels + alle Card-Titel übersetzt |
| Mobile-Test | Nav scrollbar, Cards stapeln |

---

## STOPP-PUNKT

Pipeline pausiert. Bot bleibt unverändert. Backup steht.

**Bitte gib pro Entscheidung 9-16 ein ✅/❌**, dann setze ich Phase 4-7 in einem Rutsch um (3-5h Engineering).

Wenn du sagst "mach alle 16 wie vorgeschlagen" → ich mache.
Wenn du sagst "skip 9-10-12, rest ja" → ich mache nur 11+13-16.

---

*Phase 3 Plan abgeschlossen: 2026-05-24 14:40*
*Bot R=224, online, Wallet 1194.98, HMM BULL conf 0.95, Drawdown 9.99% stabil*
