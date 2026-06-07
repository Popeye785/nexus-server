# Bitget API Key Rotation — Schritt-für-Schritt

**Erstellt:** 2026-05-26 (Block C, 4.3)
**Status:** Anleitung — Christian-manuelle Aktion bei Bitget nötig

## Warum

Bitget-Keys liegen seit Tag 1 in `.env`. Pre-LIVE muss rotation gemacht werden:
- Best-Practice: Keys regelmäßig rotieren (mind. quartalsweise)
- BUG-004 Backlog-Eintrag adressieren
- Trennung Read-Only / Write-Trading-Keys

## Schritte

### 1. Bei Bitget einloggen
- https://www.bitget.com/
- Account → API Management

### 2. Neue Keys generieren

**Key 1: READ-ONLY** (für Market-Data, Balance-Read, Order-Read)
- Permissions: ☑ Read (alles)
- Permissions: ☐ Spot Trade, ☐ Futures Trade, ☐ Withdrawals
- Notiere: API Key, Secret Key, Passphrase

**Key 2: WRITE-TRADING** (nur für aktive Trades)
- Permissions: ☑ Read, ☑ Spot Trade, ☑ Futures Trade
- Permissions: ☐ Withdrawals (NIEMALS!)
- IP-Whitelist: Tailscale-IP des Mac mini einsetzen
- Notiere: API Key, Secret Key, Passphrase

### 3. Bot stoppen (vor .env-Edit)
```bash
pm2 stop nexus
```

### 4. Backup .env
```bash
cp ~/NEXUS_CLEAN/.env ~/NEXUS_CLEAN/.env.bak.PRE_KEY_ROTATION_$(date +%Y%m%d_%H%M%S)
```

### 5. .env updaten
```bash
# alte Keys (vorher):
# BITGET_API_KEY=<alt>
# BITGET_SECRET_KEY=<alt>
# BITGET_PASSPHRASE=<alt>

# neue Read-Only Keys:
BITGET_READ_API_KEY=<neu_read>
BITGET_READ_SECRET=<neu_read_secret>
BITGET_READ_PASSPHRASE=<neu_read_pass>

# neue Trading-Keys (LIVE only!):
BITGET_TRADE_API_KEY=<neu_trade>
BITGET_TRADE_SECRET=<neu_trade_secret>
BITGET_TRADE_PASSPHRASE=<neu_trade_pass>

# Backwards-compat: alte Var-Names point auf Read-Only (PAPER nutzt nur Read)
BITGET_API_KEY=<neu_read>
BITGET_SECRET_KEY=<neu_read_secret>
BITGET_PASSPHRASE=<neu_read_pass>
```

### 6. Permissions check
```bash
chmod 600 ~/NEXUS_CLEAN/.env
ls -la ~/NEXUS_CLEAN/.env
# Expected: -rw------- (kein anderer User darf lesen)
```

### 7. Bot starten + Verify
```bash
pm2 start nexus --update-env
sleep 30
pm2 logs nexus --lines 20 --nostream --raw | grep -iE "bitget|api"
# Expected: keine 401/403/Auth-Fehler
```

### 8. Alte Keys bei Bitget DEAKTIVIEREN
- Account → API Management → alte Keys → Delete
- (NICHT direkt nach Schritt 7 — erst 24h nach erfolgreichem neuen Setup, falls Rollback nötig)

## Rollback (wenn neue Keys fail)

```bash
pm2 stop nexus
cp ~/NEXUS_CLEAN/.env.bak.PRE_KEY_ROTATION_* ~/NEXUS_CLEAN/.env
pm2 start nexus --update-env
```

## Code-Anpassung (separater PR, nicht Teil dieser Anleitung)

Aktuell nutzt server.js nur `BITGET_API_KEY/SECRET_KEY/PASSPHRASE`.
Split Read vs Write: 
- `BITGET_READ_*` für `Bitget.publicGet/privateGet` (Markt-Data + Balance-Read)
- `BITGET_TRADE_*` für `Bitget.privatePost` (Order-Submit)
- Aktiv erst nach LIVE-Switch (PAPER nutzt eh keine Trade-Calls)

## Status

🟡 **PENDING Christian-Aktion** — Keys-Generation muss bei Bitget durchgeführt werden, kann nicht automatisiert werden.

Aktuelle .env hat funktionale Keys (PAPER-mode liest nur). Vor LIVE-Switch obligatorisch rotieren.
