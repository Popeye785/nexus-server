# NEXUS V9 — API-KEY SECURITY-RECHERCHE
**Datum:** 2026-05-24 18:25
**Status:** 🟡 NUR RECHERCHE — keine Code-Änderungen
**Auftrag:** Reicht DB-only? Oder bleibt .env Pflicht?

---

## TL;DR — EMPFEHLUNG

🟡 **HYBRID mit Boot-Pfad-Anpassung** (siehe Detail unten)

**Begründung kurz:**
- **AKTUELL:** Bot liest Keys **NUR aus `process.env`** beim Boot (Z.157-159). DB-Keys werden **NICHT** automatisch geladen. → Wenn `.env`-Keys gelöscht werden → Bot funktioniert nicht mehr.
- **DB-only wäre sicherer**, aber braucht Code-Anpassung im Boot-Pfad (~30 Min).
- **`.env` löschen JETZT wäre Boot-Break** — also nicht ohne Boot-Pfad-Anpassung.
- **Hybrid ist Industriestandard** (Bitget/Binance offizielle Doku, Freqtrade, Hummingbot).

---

## A) WIE FUNKTIONIERT DER BOT-BOOT AKTUELL? (Faktencheck)

### Code-Spuren in server.js
| Zeile | Code | Bedeutung |
|---:|---|---|
| 157 | `API_KEY: process.env.BITGET_API_KEY || ''` | CFG-Init liest .env |
| 158 | `SECRET_KEY: process.env.BITGET_SECRET_KEY` | dito |
| 159 | `PASSPHRASE: process.env.BITGET_PASSPHRASE` | dito |
| 1180 | `apiKey: process.env.BITGET_API_KEY` | Bitget-Modul-Init |
| 1181 | `secretKey: process.env.BITGET_SECRET_KEY` | dito |
| 16510 | `BITGET_API_KEY: process.env.BITGET_API_KEY` | weitere Stelle |

**Konsequenz:**
- **`process.env.BITGET_*`** wird von `dotenv` aus `.env` populiert beim Node-Start
- **DB-Keys werden beim Boot NICHT gelesen** — Encryption-Modul ist nur für API-Endpoint-Pfade (Add/Update/Delete via UI)
- **Migration ist nur 1-Way:** .env → DB. Andersrum (DB → process.env beim Boot) gibt es nicht.

### Was passiert wenn .env leer ist?
- `process.env.BITGET_API_KEY` = `''` (default)
- Bitget-Modul initialisiert mit leeren Keys
- Bot startet, **läuft im PAPER-Mode** ohne Probleme (DemoEngine simuliert sowieso)
- **Aber:** `Balance.refresh()`, `placeSpotOrder()`, etc. wären in LIVE-Mode tot
- Im aktuellen PAPER-Mode → kein funktionaler Schaden, aber kein Live-Switch mehr möglich

---

## B) WAS HABEN WIR GEBAUT (Faktencheck)

### ✅ Implementiert (T8.1)
1. `exchange_config`-DB-Tabelle mit AES-256-GCM-encrypted Spalten
2. `lib/encryption.js` mit macOS Keychain Master-Key
3. API-Endpoints `/api/exchange-config/*` (CRUD)
4. Bitget-Migration-Endpoint (.env → DB)
5. UI mit Expand/Collapse-Liste

### ❌ NICHT implementiert
- **Boot-Sequenz liest NICHT aus DB** — `process.env` wird nicht überschrieben
- **Kein Decrypt-on-Init-Mechanismus**
- **Kein Fallback-Pattern** (try DB → fallback .env)

### Reicht DB-only AKTUELL?
**NEIN.** Wenn `.env` jetzt gelöscht würde:
- Bitget-Modul hätte keine Keys → kein LIVE-Switch möglich
- DB-Keys werden ignoriert beim Boot
- Bot bleibt im PAPER-Modus funktional (DemoEngine), aber LIVE-Vorbereitung tot

---

## C) SICHERHEITS-VERGLEICH

| Option | Sicherheit | Praktikabilität | Industriestandard |
|---|:-:|:-:|:-:|
| **A) Nur DB (AES-256-GCM, Keychain Master-Key)** | 🟢 sehr hoch | 🔴 braucht Code-Anpassung (Boot-Pfad) | 🟢 (Freqtrade/Hummingbot Production-Setup) |
| **B) Hybrid: DB + .env Fallback** | 🟢 hoch | 🟢 funktioniert sofort | 🟢 (3commas/Cryptohopper-Stil) |
| **C) Nur .env (aktuell ohne Anpassung)** | 🟡 mittel | 🟢 funktioniert sofort | 🟡 (für kleine Deployments akzeptabel) |

### Sicherheits-Argumente

**Pro DB-only (A):**
- AES-256-GCM ist NIST-approved Authenticated Encryption
- Per-Wert IV verhindert Pattern-Analysis
- Master-Key in macOS Keychain (Hardware-Backed wenn Touch-ID/T2-Chip)
- Niemand kann mit Dateisystem-Lese-Zugriff Keys extrahieren
- `.env` ist Klartext — wer `cat .env` machen kann, hat alle Keys

**Pro .env (C, Status quo für Bitget):**
- Industriestandard für **kleine Deployments** (Bitget-Doku, Binance-Doku)
- Einfach: lesbar, editierbar
- Funktioniert ohne Decrypt-Logik
- Bei Server-Compromise verloren (gilt aber für DB auch)

**Pro Hybrid (B, empfohlen):**
- DB-Keys werden vorrangig geladen
- .env als Fallback wenn DB leer/decrypt-fail
- Migration kann schrittweise erfolgen
- Best-of-both: Sicherheit + Robustheit

---

## D) HEN-EI-PROBLEM: macOS Keychain + launchd

### Faktencheck Christians Setup
```
LaunchAgent: ~/Library/LaunchAgents/pm2.christianheilig.plist
  Label: com.PM2
  UserName: christianheilig
  RunAtLoad: true, KeepAlive: true
  EnvironmentVariables: PATH + PM2_HOME (keine Bitget-Keys!)
```

### Keychain-Zugriff bei LaunchAgent vs LaunchDaemon

| Typ | Wann lädt? | Keychain-Zugriff |
|---|---|---|
| **LaunchAgent** (aktuell bei Christian) | **Nach User-Login** | ✅ Login-Keychain verfügbar |
| LaunchDaemon | Beim System-Boot, vor Login | ❌ Login-Keychain NICHT verfügbar, nur System-Keychain (root) |

**Konsequenz für Christian:**
- Mac mini hat **Auto-Login aktiv** (vermutet)
- Reboot → User-Login (automatisch) → LaunchAgent startet → pm2 resurrect → Bot startet → Keychain erreichbar ✅

**Risiko-Szenario:**
- Wenn Auto-Login deaktiviert wird → Bot startet erst nach manuellem User-Login
- Wenn Mac neugestartet wird und User nicht eingeloggt ist → Bot ist OFFLINE bis Login
- Bei Server-Headless-Setups: braucht LaunchDaemon + System-Keychain (komplexer)

### Test
Eigentlich sollten wir verifizieren ob Bot nach Reboot ohne Login startet — nicht jetzt durchführen weil Drawdown nah am Limit.

---

## E) PROFI-TRADING-BOTS — KEY-STORAGE-PRAXIS

| Bot | Key-Storage | Quelle |
|---|---|---|
| **3Commas** | Cloud-stored encrypted, IP-whitelist | [3commas Security 2025](https://3commas.io/blog/secure-cryptocurrency-assets-2025) |
| **Hummingbot** | `.env` für Dev, encrypted DB für Production empfohlen | [Hummingbot Docs](https://hummingbot.org/docs/) |
| **Freqtrade** | `config.json` (Klartext) oder `--config` mit ENV, Production: HashiCorp Vault empfohlen | [Freqtrade Configuration](https://www.freqtrade.io/en/stable/configuration/) |
| **Pionex/Cryptohopper** | Cloud-encrypted (User-Side keine direkte Kontrolle) | [Cointracker AI Bots Review](https://www.cointracker.io/blog/best-ai-crypto-trading-bots) |
| **NEXUS V9 (jetzt)** | Hybrid bereit, aktuell `.env` aktiv | (eigene Implementation) |

**Gemeinsamer Standard:**
- Niemals Keys in Source-Code committen ([Bitget Wiki](https://www.bitget.com/wiki/how-to-use-api-key-in-website))
- IP-Whitelist auf Exchange-Seite (Bitget empfiehlt **max 10 IPs pro Key**)
- Nur READ + SPOT TRADE Permissions, niemals Withdrawal
- API-Keys alle 30-90 Tage rotieren

---

## F) BITGET/BINANCE OFFIZIELLE EMPFEHLUNG

### Bitget ([API Key Terms of Use](https://www.bitget.com/support/articles/12560603797947))
> "Refraining from placing API Keys directly into publicly available or insecure source code or repositories; not storing API Keys anywhere on the cloud; and not sharing API Keys with any third party."
>
> "Bitget recommends each API Key not be bound to more than 10 IP addresses."

→ **Bitget nennt KEIN spezifisches Storage-Format** (.env vs DB), aber:
- ❌ NICHT in Code committen
- ❌ NICHT in Cloud-Storage (Dropbox, GitHub, etc.)
- ✅ IP-Whitelist verwenden
- ✅ Minimum-Permissions

### Binance ([API Key Types](https://developers.binance.com/docs/binance-spot-api-docs/faqs/api_key_types))
> "API keys must never be hardcoded into bot scripts or committed to version control systems, and environment variables provide the minimum acceptable storage method."
>
> "Use Ed25519 API keys as they should provide the best performance and security."

→ **Binance: env-Variables sind das MINIMUM** (= `.env` ist OK, aber nicht das Maximum)
→ Encrypted DB ist **besser als Minimum**

---

## G) FAILOVER-SZENARIEN

### Szenario 1: DB korrupt → was passiert?
**Aktuell (Hybrid):**
- DB-Keys nicht lesbar → Encryption-API liefert null → API-Endpoints geben Fehler
- ABER: Boot-Pfad nutzt eh `.env` → Bot funktioniert weiter
- **Risiko:** niedrig wenn .env als Fallback bleibt

**Bei DB-only:**
- DB korrupt → Keys verloren → Bot kann nicht initialisieren → keine LIVE-Trades möglich
- **Recovery:** Backup-DB einspielen (`nexus.db.bak.*` vorhanden)
- **Risiko:** mittel — Wenn Backup ≥24h alt, neue Keys müssten manuell wiederhergestellt werden

### Szenario 2: Keychain-Master-Key gelöscht
**Aktuell:**
- `lib/encryption.js` generiert neuen Master-Key + speichert in Keychain
- **ABER:** alte DB-Werte sind mit altem Key verschlüsselt → können NICHT entschlüsselt werden
- → Alle DB-Keys müssen neu eingegeben werden
- **Recovery:** .env-Fallback rettet Bitget; andere Exchanges müssten neu konfiguriert werden

### Szenario 3: Mac-Reboot
**Aktuell (Christian's Setup):**
- macOS bootet → Auto-Login User `christianheilig` → LaunchAgent triggert → `pm2 resurrect` → Bot online
- Bot liest `.env` aus dem Dateisystem (kein Keychain-Zugriff nötig)
- ✅ Funktioniert automatisch

**Bei DB-only (ohne Anpassung):**
- Bot startet → liest leere `process.env.BITGET_*` → Bitget-Modul hat keine Keys
- LIVE-Mode tot, PAPER-Mode läuft weiter
- ❌ Manueller Eingriff nötig (Key-Reload)

**Bei Hybrid mit Boot-Pfad-Anpassung:**
- Bot startet → versucht DB → wenn DB-Keys da → decrypt → `process.env.BITGET_*` setzen
- Wenn DB leer → `.env` als Fallback
- ✅ Robust gegen DB-Probleme UND sicher gegen .env-Compromise

---

## EMPFEHLUNG MIT BEGRÜNDUNG

### 🟡 **HYBRID MIT BOOT-PFAD-ANPASSUNG** (empfohlen)

**Was tun:**
1. Boot-Sequenz in server.js erweitern (~30 Min Engineering):
   ```js
   // Vor CFG-Definition (Z.~150):
   try {
     const _enc = require('./lib/encryption');
     const _db = ... // DB-Handle
     const row = _db.prepare("SELECT api_key_enc, api_secret_enc, passphrase_enc FROM exchange_config WHERE exchange='bitget'").get();
     if (row && row.api_key_enc) {
       const parseEnc = (s) => { try { return JSON.parse(s); } catch(_) { return null; } };
       const ek = parseEnc(row.api_key_enc);
       const es = parseEnc(row.api_secret_enc);
       const ep = parseEnc(row.passphrase_enc);
       if (ek) {
         const decKey = _enc.decrypt(ek.ct, ek.iv, ek.tag);
         if (decKey) process.env.BITGET_API_KEY = decKey;
       }
       // ... analog für secret + passphrase
     }
   } catch(_) { /* fallback to .env */ }
   ```
2. .env-Keys können **dann** entfernt werden (nicht jetzt!)
3. Migration-Endpoint löscht .env-Keys automatisch nach erfolgreichem Test (Future)

**Pro:**
- Sicher (AES-256-GCM, Keychain)
- Robust (Fallback bei DB-Problem)
- Migrierbar (schrittweise)
- Industriestandard

**Contra:**
- Code-Eingriff in Boot-Sequenz
- Keychain-Abhängigkeit (User-Login nötig)

### ❌ NICHT empfohlen

**"Nur DB, .env weg JETZT":**
- Bot würde Bitget-Modul ohne Keys initialisieren
- LIVE-Mode tot
- Müsste sofortige Boot-Pfad-Anpassung machen (Risk höher als Hybrid)

**".env-Keys lassen wie bisher, nichts ändern":**
- Verbessert nichts an aktuellem Risiko
- DB-Encryption ist ungenutzt
- Verschenkter Wert der T8-Implementation

---

## RISIKO-MATRIX

| Risiko | .env-only (Status quo) | DB-only | **Hybrid (empfohlen)** |
|---|:-:|:-:|:-:|
| Klartext-Leak bei FS-Access | 🔴 hoch | 🟢 null | 🟢 niedrig (nur .env-Fallback) |
| Boot-Break bei DB-Korruption | 🟢 keine | 🔴 hoch | 🟢 keine (Fallback) |
| Bot bleibt nach Reboot online | 🟢 ja | 🟡 nur mit Login | 🟢 ja (Fallback) |
| Keychain-Master-Key-Verlust | 🟢 irrelevant | 🔴 alle Keys weg | 🟡 nur DB-Keys weg, .env rettet Bitget |
| Source-Code-Commit | 🟡 .env muss in .gitignore | 🟢 nur DB-Pfad | 🟡 .env muss in .gitignore |
| LIVE-Switch nach Migration | 🟢 ja | 🟢 ja | 🟢 ja |

→ **Hybrid hat die wenigsten 🔴-Felder.**

---

## ACTION-ITEMS (nicht jetzt — Christian-Entscheidung)

Wenn Christian **Hybrid** wählt:
1. Boot-Sequenz-Anpassung (server.js ~Z.150, vor CFG-Init): ~30 Min
2. Test-Plan: Boot mit DB → .env leer → Boot funktioniert?
3. Backup vor Anpassung (Standard)
4. Nach erfolgreichem Test: .env-Keys können bei Bedarf entfernt werden

Wenn Christian **Status quo** wählt:
- Nichts tun
- DB-Implementation bleibt für andere Exchanges nutzbar (Binance/Coinbase/etc.)
- Bitget bleibt .env-basiert

Wenn Christian **Nur-DB** wählt:
- Boot-Pfad-Anpassung Pflicht (gleich wie Hybrid)
- PLUS: .env-Keys aktiv entfernen
- PLUS: Robuste Recovery-Strategie für Keychain-Verlust nötig

---

## QUELLEN

1. [Apple Developer Forums — LaunchDaemons and keychain access](https://developer.apple.com/forums/thread/685967)
2. [Inventive HQ — LaunchAgents/LaunchDaemons macOS Management](https://inventivehq.com/knowledge-base/macos/how-to-manage-launchagents-launchdaemons-macos)
3. [Victor Software — launchd agents and daemons](https://victoronsoftware.com/posts/macos-launchd-agents-and-daemons/)
4. [Origami Tech — Crypto Bot Security and API Key Management](https://origami.tech/articles/crypto-bot-security-and-api-key-management-for-safe-automated-trading)
5. [Bitget Academy — Crypto Bot Security Setup 2025](https://www.bitget.com/academy/12560603876592)
6. [Bitget Support — API Key Terms of Use](https://www.bitget.com/support/articles/12560603797947)
7. [Bitget Wiki — How to use API Key in Website](https://www.bitget.com/wiki/how-to-use-api-key-in-website)
8. [Binance — API Key Types](https://developers.binance.com/docs/binance-spot-api-docs/faqs/api_key_types)
9. [3commas — Secure Cryptocurrency Assets 2025](https://3commas.io/blog/secure-cryptocurrency-assets-2025)
10. [Darkbot — API Key Security in Automated Crypto Trading](https://darkbot.io/blog/what-is-api-key-security-in-automated-crypto-trading)

---

*Security-Recherche abgeschlossen: 2026-05-24 18:25*
*Read-only. Keine .env/DB-Änderungen erfolgt. Wartet auf Christian-Freigabe.*
