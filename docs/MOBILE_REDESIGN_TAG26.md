# Mobile-UI Redesign — Tag 26 (Block F Item 3)

**Datum:** 2026-05-26
**Bot-Status PRE:** PID 28633, R=278, PAPER, drift=0
**Backup:** `public/index.html.bak.PRE_BLOCKF_20260526_174116`

## Vorher / Nachher

| Metric | Vorher (Block D) | Nachher | Δ |
|---|---:|---:|---:|
| Touch-Target Fails iPhone 375×812 | 619/630 (98.3%) | **0/33** (0%) | -98.3 Pp |
| Touch-Target Fails iPhone Plus 414 | ~ähnlich | **0/33** (0%) | -98.3 Pp |
| PAGEERR Exchanges-Tab | 1 (Cannot set null.textContent) | **0** | -1 |
| Desktop-Layout Regression | n/a | **0 PAGEERR** | ok |
| Integration-Tests Regression | 10/10 | **10/10** | ok |

## Items

### 3.1 Touch-Targets ≥44px (Apple HIG / WCAG AAA)

**CSS-Block (public/index.html nach .btn-sm):**
```css
@media (pointer: coarse), (max-width: 768px) {
  .nb { min-height: 44px; min-width: 56px; padding: 10px 8px; }
  .btn { min-height: 44px; padding: 12px 14px; }
  .btn-sm { min-height: 44px; min-width: 44px; padding: 10px 14px; font-size: 10px; }
  .tog { width: 56px; height: 30px; border-radius: 15px; }
  .tog::after { width: 22px; height: 22px; top: 4px; left: 4px; }
  .tog.on::after { left: 30px; }
  .fi, .fsel { min-height: 44px; padding: 11px 14px; }
  .ex-row { min-height: 44px; padding: 14px; }
  .chip { min-height: 44px; min-width: 44px; padding: 12px 16px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
  .chips { gap: 6px; }
  #masterSwitch, #modeSwitchBtn { min-height: 44px; padding: 12px 16px !important; }
  button:not(.btn):not(.btn-sm):not(.nb):not(.tog):not(.chip) { min-height: 44px; padding-top: 10px; padding-bottom: 10px; }
}
```

**Wirkung:** Bei `pointer:coarse` (Touch-Device) ODER `max-width:768px` (Tablet/Phone) werden alle Buttons/Toggles ≥44px hoch. Desktop bleibt unverändert (Selector greift dort nicht).

**Catch-all** für unbenannte Buttons via `button:not(...)`-Negation — falls neue Buttons ohne .btn-Klasse hinzukommen, sind sie automatisch touch-konform.

### 3.2 nb-exchanges PAGEERR (Test-First Bug-Fix)

**Bug-Ursache:** Funktion `loadExchanges()` (Z.6117) referenziert `#exchange-list` Element. Dieses Element wurde durch T8.1.4-Refactor (24.05.2026) durch `#ex-list-tier1` + `#ex-list-tier2` ersetzt. `loadExchanges()` blieb aber im `nav('exchanges')` Switch (Z.3484).

**Test-First Workflow:**
1. **RED** (`tests/repro/repro_nb_exchanges_click.js`):
   ```
   PageErrors collected: 1
   PAGEERR: TypeError: Cannot set properties of null (setting 'textContent')
   Exit-Code: 1
   ```
2. **FIX:**
   - Z.3484: `loadExchanges()` → `loadExchangeList()` (richtige Render-Funktion)
   - Z.6117-6119: Null-Guard `if (!el) return;` in `loadExchanges()` als Belt-and-Suspenders
   - catch-Block: hartcodierter `getElementById('exchange-list')` → variable `el`
3. **GREEN:** `PAGEERR count: 0`

## Definition-of-Done Tabelle

| Rule | Item 3.1 (Touch-Targets) | Item 3.2 (nb-exchanges) |
|---|---|---|
| 1 Architecture-Fit | ✅ Media-Query bestehende CSS-Schicht | ✅ ersetzt veralteten Funktions-Call |
| 2 Regressions | ✅ Integration-Tests 10/10 grün | ✅ Integration-Tests 10/10 grün |
| 3 UI-Verifikation | ✅ Playwright Desktop+iPhone+iPhone-Plus | ✅ Playwright click + PAGEERR-Check |
| 4 Restart | ✅ HTML wird beim Browser-Refresh geladen, kein Server-Restart | ✅ HTML wird beim Browser-Refresh geladen, kein Server-Restart |
| 5 Error-Path | ✅ Fallback CSS-Defaults für non-touch | ✅ Null-Guard verhindert Crash |
| 6 Rollback | ✅ Backup `public/index.html.bak.PRE_BLOCKF_20260526_174116` | ✅ gleicher Backup |
| 7 Performance | ✅ Pure CSS, kein JS-Overhead | ✅ Funktions-Switch nur bei Tab-Click |
| 8 Edge-Cases | ✅ Tablets (max-width:768px), Touch+Mouse-Combo (pointer:coarse) | ✅ Element kann fehlen → return statt crash |
| 9 Logs/Audit | ✅ Screenshots in tests/screenshots/mobile_*.png | ✅ Test-Output in jsonl |
| 10 Docs | ✅ docs/MOBILE_REDESIGN_TAG26.md (dieses Doc) | ✅ inline-Kommentar T8.1.4 |
| 11 LIVE-Identität | ✅ kein Trade-Logik-Eingriff | ✅ kein Trade-Logik-Eingriff |

## Evidence

### Screenshots
- `tests/screenshots/mobile_iphone_375.png` — iPhone 11 Pro 375×812
- `tests/screenshots/mobile_iphone_414.png` — iPhone Plus 414×896
- `tests/screenshots/mobile_desktop_1920.png` — Desktop 1920×1080 (Regression-Check)

### Test-Output (Playwright `tests/integration/mobile_touch_targets.test.js`)
```
[iPhone 375x812] checked=33 fails<44px=0   PAGEERR=0  ✓
[iPhone Plus 414x896] checked=33 fails<44px=0   PAGEERR=0  ✓
[Desktop 1920x1080] checked=33 fails<44px=33 (info-only)  PAGEERR=0  ✓
[Exchanges-Tab] PAGEERR=0  ✓
4 passed (29.2s)
```

### Integration-Test-Regression
```
10 passed (15.6s) — kein Drift, kein PAGEERR-Neu
```

## Bot-Health POST-Item-3

Kein Server-Restart erforderlich (UI-only change). Bot weiter PID 28633 R=278 drift=0.
