// public/translations.js — NEXUS V9 i18n DE/EN/ES
// Verankert 2026-05-24 (T0.5 — Master-Pipeline T)
//
// Default: DE
// Persistenz: localStorage.nexus_lang
// Usage: T('key') oder T('key', { name: 'BTC' })

(function () {
  'use strict';

  const TEXTS = {
    DE: {
      // Generic
      'common.loading': 'Laden…',
      'common.error': 'Fehler',
      'common.save': 'Speichern',
      'common.cancel': 'Abbrechen',
      'common.refresh': 'Aktualisieren',
      'common.yes': 'Ja',
      'common.no': 'Nein',
      'common.on': 'AN',
      'common.off': 'AUS',
      'common.active': 'Aktiv',
      'common.inactive': 'Inaktiv',
      'common.healthy': 'Gesund',
      'common.warning': 'Warnung',
      'common.critical': 'Kritisch',

      // Tabs (Navigation)
      'tab.markt': 'MARKT',
      'tab.whale': 'WHALE',
      'tab.chart': 'CHART',
      'tab.analyse': 'ANALYSE',
      'tab.signal': 'SIGNAL',
      'tab.orders': 'ORDERS',
      'tab.indikatoren': 'INDIKATOREN',
      'tab.status': 'STATUS',
      'tab.bots': 'BOTS',
      'tab.coins': 'COINS',
      'tab.kapital': 'KAPITAL',
      'tab.news': 'NEWS',
      'tab.kidash': 'KI-DASH',
      'tab.ars': 'ARS',
      'tab.sicherheit': 'SICHERHEIT',
      'tab.ml': 'ML',
      'tab.system': 'SYSTEM',
      'tab.diagnose': 'DIAGNOSE',
      'tab.exchanges': 'EXCHG',
      'tab.stratbuild': 'STRATBUILD',
      'tab.config': 'CONFIG',

      // KAPITAL-Tab
      'kapital.title': 'KAPITAL · V9 BALANCE ENGINE',
      'kapital.total': 'Vermögen Gesamt',
      'kapital.reserve': 'Reserve (geschützt)',
      'kapital.trading': 'Trading-Cash',
      'kapital.imMarkt': 'Im Markt (offene Positions)',
      'kapital.realized_today': 'Realisiert heute',
      'kapital.realized_total': 'Realisiert gesamt seit Day-Zero',
      'kapital.unrealized': 'Unrealisiert',
      'kapital.win_rate_all': 'Win Rate (alle Bot-Types)',
      'kapital.pnl_realized': 'PnL realisiert',
      'kapital.trades_count': 'Trades',
      'kapital.equity_curve': 'Equity Curve · Kapital-Verlauf',
      'kapital.blocked_today': 'Blockierte Trades heute',
      'kapital.news_risk': 'News-Risk-Index',
      'kapital.startkapital': 'Start-Kapital nach Reset (USDT)',
      'kapital.eviction': 'Opportunity-Eviction',
      'kapital.eviction_strength_ranking': 'Aktive Bots — Strength-Ranking',
      'kapital.eviction_top_opps': 'Top Opportunities (live)',
      'kapital.eviction_history': 'Eviction History (letzte 5)',

      // CONFIG-Tab
      'config.title': 'KONFIGURATION',
      'config.language': 'SPRACHE',
      'config.language.choose': 'Sprache wählen',
      'config.security': 'SICHERHEIT',
      'config.deploy_token': 'Deploy-Token',
      'config.deploy_token.desc': 'Bestätigung kritischer Aktionen',
      'config.api_keys': 'API-Keys',
      'config.bitget': 'Bitget',
      'config.telegram': 'Telegram',

      // T6.1 [24.05.2026] CONFIG-Tab erweiterte i18n (DE)
      'config.api.title': 'API KONFIGURATION · BITGET',
      'config.api.warn': '🔐 Keys werden nur lokal gespeichert. Verlassen dein Gerät nicht.',
      'config.api.key': 'BITGET API KEY',
      'config.api.secret': 'SECRET KEY',
      'config.api.passphrase': 'PASSPHRASE',
      'config.btn.save': '💾 SPEICHERN',
      'config.btn.delete': '🗑 LÖSCHEN',
      'config.btn.save_risk': '💾 RISK GUARD SPEICHERN',
      'config.features.title': 'FEATURES · SPOT / MARGIN / FUTURES',
      'config.features.spot': 'Spot Trading',
      'config.features.spot.desc': 'Standard — immer aktiv',
      'config.features.margin': 'Margin Trading',
      'config.features.margin.desc': 'Vorsicht — Hebel auf Spot',
      'config.features.futures': 'Futures',
      'config.features.futures.desc': 'Vorsicht — Perpetual Contracts',
      'config.features.short': 'Short Selling',
      'config.features.short.desc': 'Vorsicht — Leerverkäufe',
      'config.features.leverage': 'Hebel / Leverage',
      'config.features.leverage.desc': 'Vorsicht — gehebelter Handel',
      'config.risk.title': 'RISK GUARD SCHWELLEN',
      'config.risk.vol': 'MAX VOLATILITÄT ATR%',
      'config.risk.pos': 'MAX POSITION %',
      'config.risk.loss': 'MAX VERLUST-SERIE',
      'config.risk.score': 'MIN SIGNAL SCORE',
      'config.risk.whale': 'WHALE SCHWELLE (/100)',
      'config.language.sub': 'UI + Telegram synchron · sofort wirksam',
      'config.security.antibrick': 'ℹ️ Anti-Brick aktiv: Kill-Switch, FLOOR, NotBremse, Anomaly, News-Risk laufen unabhängig.',
      'header.autonomous': 'AUTONOM',
      'header.demo': 'DEMO',
      'header.live': 'LIVE',
      'kapital.title.demo': 'DEMO KAPITAL (Simulation)',
      'kapital.title.live': 'LIVE BALANCE (BITGET)',
      'kapital.cron.note': 'Nach Tages-Verbuchung 23:55 (70/30-Split)',
      'kapital.reserve_ist': 'Reserve IST',
      'kapital.reserve_soll': 'Reserve nach 23:55',
      'kapital.cash_ist': 'Cash IST',
      'kapital.cash_soll': 'Cash nach 23:55',
      'kapital.blocked_label': 'Heute blockiert',
      'kapital.blocked_real': 'real',
      'kapital.blocked_floor': 'FLOOR-verhindert',
      'kapital.news_risk_label': 'News-Risk-Index',
      'kapital.news_risk_volume': 'News-Volumen',
      'kapital.news_articles_per_h': 'Artikel/Stunde',

      // Engine-Status
      'engine.active': 'AUTO-ENGINE AKTIV',
      'engine.paused': 'PAUSED',
      'engine.stopped': 'GESTOPPT',
      'engine.killswitch_active': 'KILL-SWITCH AKTIV',
      'engine.killswitch_ok': 'Kill-Switch OK',

      // Telegram
      'tg.report.title': 'NEXUS V9 — Tagesbericht',
      'tg.balance.title': 'WALLET',
      'tg.status.title': 'STATUS',
      'tg.lang_changed': 'Sprache geändert auf',
      'tg.confirm_required': 'Bestätigung erforderlich mit',

      // Slot-Layout
      'slots.label': 'Slots',
      'slots.busy': 'belegt',
      'slots.free': 'frei',

      // Regime
      'regime.bull_strong': 'BULL STARK',
      'regime.bull_weak': 'BULL SCHWACH',
      'regime.bull': 'BULL',
      'regime.bear_strong': 'BEAR STARK',
      'regime.bear_weak': 'BEAR SCHWACH',
      'regime.bear': 'BEAR',
      'regime.ranging': 'SEITWÄRTS',
      'regime.squeeze': 'SQUEEZE',
      'regime.crash': 'CRASH',
      'regime.recovery': 'ERHOLUNG',
      'regime.neutral': 'NEUTRAL',
      'regime.extreme_vol': 'EXTREM-VOL',
    },

    EN: {
      'common.loading': 'Loading…',
      'common.error': 'Error',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.refresh': 'Refresh',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.on': 'ON',
      'common.off': 'OFF',
      'common.active': 'Active',
      'common.inactive': 'Inactive',
      'common.healthy': 'Healthy',
      'common.warning': 'Warning',
      'common.critical': 'Critical',

      'tab.markt': 'MARKET',
      'tab.whale': 'WHALE',
      'tab.chart': 'CHART',
      'tab.analyse': 'ANALYSIS',
      'tab.signal': 'SIGNAL',
      'tab.orders': 'ORDERS',
      'tab.indikatoren': 'INDICATORS',
      'tab.status': 'STATUS',
      'tab.bots': 'BOTS',
      'tab.coins': 'COINS',
      'tab.kapital': 'CAPITAL',
      'tab.news': 'NEWS',
      'tab.kidash': 'AI-DASH',
      'tab.ars': 'ARS',
      'tab.sicherheit': 'SAFETY',
      'tab.ml': 'ML',
      'tab.system': 'SYSTEM',
      'tab.diagnose': 'DIAGNOSE',
      'tab.exchanges': 'EXCHG',
      'tab.stratbuild': 'STRAT-BUILD',
      'tab.config': 'CONFIG',

      'kapital.title': 'CAPITAL · V9 BALANCE ENGINE',
      'kapital.total': 'Total Equity',
      'kapital.reserve': 'Reserve (protected)',
      'kapital.trading': 'Trading Cash',
      'kapital.imMarkt': 'In Market (open positions)',
      'kapital.realized_today': 'Realized today',
      'kapital.realized_total': 'Realized total since Day-Zero',
      'kapital.unrealized': 'Unrealized',
      'kapital.win_rate_all': 'Win Rate (all bot types)',
      'kapital.pnl_realized': 'PnL realized',
      'kapital.trades_count': 'Trades',
      'kapital.equity_curve': 'Equity Curve · Capital Trajectory',
      'kapital.blocked_today': 'Blocked trades today',
      'kapital.news_risk': 'News-Risk Index',
      'kapital.startkapital': 'Starting capital after reset (USDT)',
      'kapital.eviction': 'Opportunity Eviction',
      'kapital.eviction_strength_ranking': 'Active Bots — Strength Ranking',
      'kapital.eviction_top_opps': 'Top Opportunities (live)',
      'kapital.eviction_history': 'Eviction History (last 5)',

      'config.title': 'CONFIGURATION',
      'config.language': 'LANGUAGE',
      'config.language.choose': 'Choose language',
      'config.security': 'SECURITY',
      'config.deploy_token': 'Deploy Token',
      'config.deploy_token.desc': 'Confirmation for critical actions',
      'config.api_keys': 'API Keys',
      'config.bitget': 'Bitget',
      'config.telegram': 'Telegram',

      // T6.1 [24.05.2026] CONFIG-Tab extended i18n (EN)
      'config.api.title': 'API CONFIGURATION · BITGET',
      'config.api.warn': '🔐 Keys stored locally only. Never leave your device.',
      'config.api.key': 'BITGET API KEY',
      'config.api.secret': 'SECRET KEY',
      'config.api.passphrase': 'PASSPHRASE',
      'config.btn.save': '💾 SAVE',
      'config.btn.delete': '🗑 DELETE',
      'config.btn.save_risk': '💾 SAVE RISK GUARD',
      'config.features.title': 'FEATURES · SPOT / MARGIN / FUTURES',
      'config.features.spot': 'Spot Trading',
      'config.features.spot.desc': 'Default — always active',
      'config.features.margin': 'Margin Trading',
      'config.features.margin.desc': 'Caution — leverage on spot',
      'config.features.futures': 'Futures',
      'config.features.futures.desc': 'Caution — perpetual contracts',
      'config.features.short': 'Short Selling',
      'config.features.short.desc': 'Caution — short positions',
      'config.features.leverage': 'Leverage',
      'config.features.leverage.desc': 'Caution — leveraged trading',
      'config.risk.title': 'RISK GUARD THRESHOLDS',
      'config.risk.vol': 'MAX VOLATILITY ATR%',
      'config.risk.pos': 'MAX POSITION %',
      'config.risk.loss': 'MAX LOSING STREAK',
      'config.risk.score': 'MIN SIGNAL SCORE',
      'config.risk.whale': 'WHALE THRESHOLD (/100)',
      'config.language.sub': 'UI + Telegram synced · immediate effect',
      'config.security.antibrick': 'ℹ️ Anti-brick active: Kill-Switch, FLOOR, NotBremse, Anomaly, News-Risk run independently.',
      'header.autonomous': 'AUTONOMOUS',
      'header.demo': 'DEMO',
      'header.live': 'LIVE',
      'kapital.title.demo': 'DEMO CAPITAL (Simulation)',
      'kapital.title.live': 'LIVE BALANCE (BITGET)',
      'kapital.cron.note': 'After daily settlement 23:55 (70/30 split)',
      'kapital.reserve_ist': 'Reserve current',
      'kapital.reserve_soll': 'Reserve after 23:55',
      'kapital.cash_ist': 'Cash current',
      'kapital.cash_soll': 'Cash after 23:55',
      'kapital.blocked_label': 'Blocked today',
      'kapital.blocked_real': 'real',
      'kapital.blocked_floor': 'FLOOR-prevented',
      'kapital.news_risk_label': 'News-Risk Index',
      'kapital.news_risk_volume': 'News Volume',
      'kapital.news_articles_per_h': 'articles/hour',

      'engine.active': 'AUTO-ENGINE ACTIVE',
      'engine.paused': 'PAUSED',
      'engine.stopped': 'STOPPED',
      'engine.killswitch_active': 'KILL-SWITCH ACTIVE',
      'engine.killswitch_ok': 'Kill-Switch OK',

      'tg.report.title': 'NEXUS V9 — Daily Report',
      'tg.balance.title': 'WALLET',
      'tg.status.title': 'STATUS',
      'tg.lang_changed': 'Language changed to',
      'tg.confirm_required': 'Confirmation required with',

      'slots.label': 'Slots',
      'slots.busy': 'busy',
      'slots.free': 'free',

      'regime.bull_strong': 'BULL STRONG',
      'regime.bull_weak': 'BULL WEAK',
      'regime.bull': 'BULL',
      'regime.bear_strong': 'BEAR STRONG',
      'regime.bear_weak': 'BEAR WEAK',
      'regime.bear': 'BEAR',
      'regime.ranging': 'RANGING',
      'regime.squeeze': 'SQUEEZE',
      'regime.crash': 'CRASH',
      'regime.recovery': 'RECOVERY',
      'regime.neutral': 'NEUTRAL',
      'regime.extreme_vol': 'EXTREME-VOL',
    },

    ES: {
      'common.loading': 'Cargando…',
      'common.error': 'Error',
      'common.save': 'Guardar',
      'common.cancel': 'Cancelar',
      'common.refresh': 'Actualizar',
      'common.yes': 'Sí',
      'common.no': 'No',
      'common.on': 'ENC',
      'common.off': 'APG',
      'common.active': 'Activo',
      'common.inactive': 'Inactivo',
      'common.healthy': 'Saludable',
      'common.warning': 'Advertencia',
      'common.critical': 'Crítico',

      'tab.markt': 'MERCADO',
      'tab.whale': 'BALLENA',
      'tab.chart': 'GRÁFICO',
      'tab.analyse': 'ANÁLISIS',
      'tab.signal': 'SEÑAL',
      'tab.orders': 'ÓRDENES',
      'tab.indikatoren': 'INDICADORES',
      'tab.status': 'ESTADO',
      'tab.bots': 'BOTS',
      'tab.coins': 'MONEDAS',
      'tab.kapital': 'CAPITAL',
      'tab.news': 'NOTICIAS',
      'tab.kidash': 'AI-DASH',
      'tab.ars': 'ARS',
      'tab.sicherheit': 'SEGURIDAD',
      'tab.ml': 'ML',
      'tab.system': 'SISTEMA',
      'tab.diagnose': 'DIAGNÓSTICO',
      'tab.exchanges': 'EXCHG',
      'tab.stratbuild': 'STRAT-BUILD',
      'tab.config': 'CONFIG',

      'kapital.title': 'CAPITAL · MOTOR DE BALANCE V9',
      'kapital.total': 'Patrimonio Total',
      'kapital.reserve': 'Reserva (protegida)',
      'kapital.trading': 'Efectivo de Trading',
      'kapital.imMarkt': 'En el Mercado (posiciones abiertas)',
      'kapital.realized_today': 'Realizado hoy',
      'kapital.realized_total': 'Realizado total desde Day-Zero',
      'kapital.unrealized': 'No realizado',
      'kapital.win_rate_all': 'Tasa de Ganancia (todos los bots)',
      'kapital.pnl_realized': 'PnL realizado',
      'kapital.trades_count': 'Trades',
      'kapital.equity_curve': 'Curva de Equity · Trayectoria de Capital',
      'kapital.blocked_today': 'Trades bloqueados hoy',
      'kapital.news_risk': 'Índice News-Risk',
      'kapital.startkapital': 'Capital inicial tras reset (USDT)',
      'kapital.eviction': 'Eviction de Oportunidad',
      'kapital.eviction_strength_ranking': 'Bots Activos — Ranking de Fuerza',
      'kapital.eviction_top_opps': 'Mejores Oportunidades (live)',
      'kapital.eviction_history': 'Historial de Eviction (últimos 5)',

      'config.title': 'CONFIGURACIÓN',
      'config.language': 'IDIOMA',
      'config.language.choose': 'Elegir idioma',
      'config.security': 'SEGURIDAD',
      'config.deploy_token': 'Deploy Token',
      'config.deploy_token.desc': 'Confirmación para acciones críticas',
      'config.api_keys': 'API-Keys',
      'config.bitget': 'Bitget',
      'config.telegram': 'Telegram',

      // T6.1 [24.05.2026] CONFIG-Tab extended i18n (ES)
      'config.api.title': 'CONFIGURACIÓN API · BITGET',
      'config.api.warn': '🔐 Keys almacenadas solo localmente. Nunca abandonan tu dispositivo.',
      'config.api.key': 'BITGET API KEY',
      'config.api.secret': 'SECRET KEY',
      'config.api.passphrase': 'PASSPHRASE',
      'config.btn.save': '💾 GUARDAR',
      'config.btn.delete': '🗑 ELIMINAR',
      'config.btn.save_risk': '💾 GUARDAR RISK GUARD',
      'config.features.title': 'FEATURES · SPOT / MARGIN / FUTURES',
      'config.features.spot': 'Spot Trading',
      'config.features.spot.desc': 'Estándar — siempre activo',
      'config.features.margin': 'Margin Trading',
      'config.features.margin.desc': 'Precaución — apalancamiento en spot',
      'config.features.futures': 'Futures',
      'config.features.futures.desc': 'Precaución — contratos perpetuos',
      'config.features.short': 'Short Selling',
      'config.features.short.desc': 'Precaución — ventas en corto',
      'config.features.leverage': 'Apalancamiento',
      'config.features.leverage.desc': 'Precaución — trading apalancado',
      'config.risk.title': 'UMBRALES DE RISK GUARD',
      'config.risk.vol': 'MAX VOLATILIDAD ATR%',
      'config.risk.pos': 'MAX POSICIÓN %',
      'config.risk.loss': 'MAX RACHA DE PÉRDIDAS',
      'config.risk.score': 'MIN SIGNAL SCORE',
      'config.risk.whale': 'UMBRAL BALLENA (/100)',
      'config.language.sub': 'UI + Telegram sincronizados · efecto inmediato',
      'config.security.antibrick': 'ℹ️ Anti-brick activo: Kill-Switch, FLOOR, NotBremse, Anomaly, News-Risk funcionan independientemente.',
      'header.autonomous': 'AUTÓNOMO',
      'header.demo': 'DEMO',
      'header.live': 'LIVE',
      'kapital.title.demo': 'CAPITAL DEMO (Simulación)',
      'kapital.title.live': 'BALANCE LIVE (BITGET)',
      'kapital.cron.note': 'Después del cierre diario 23:55 (división 70/30)',
      'kapital.reserve_ist': 'Reserva actual',
      'kapital.reserve_soll': 'Reserva después de 23:55',
      'kapital.cash_ist': 'Cash actual',
      'kapital.cash_soll': 'Cash después de 23:55',
      'kapital.blocked_label': 'Bloqueados hoy',
      'kapital.blocked_real': 'reales',
      'kapital.blocked_floor': 'FLOOR-evitados',
      'kapital.news_risk_label': 'Índice News-Risk',
      'kapital.news_risk_volume': 'Volumen de Noticias',
      'kapital.news_articles_per_h': 'artículos/hora',

      'engine.active': 'AUTO-ENGINE ACTIVO',
      'engine.paused': 'PAUSADO',
      'engine.stopped': 'DETENIDO',
      'engine.killswitch_active': 'KILL-SWITCH ACTIVO',
      'engine.killswitch_ok': 'Kill-Switch OK',

      'tg.report.title': 'NEXUS V9 — Informe Diario',
      'tg.balance.title': 'WALLET',
      'tg.status.title': 'ESTADO',
      'tg.lang_changed': 'Idioma cambiado a',
      'tg.confirm_required': 'Confirmación requerida con',

      'slots.label': 'Slots',
      'slots.busy': 'ocupados',
      'slots.free': 'libres',

      'regime.bull_strong': 'BULL FUERTE',
      'regime.bull_weak': 'BULL DÉBIL',
      'regime.bull': 'BULL',
      'regime.bear_strong': 'BEAR FUERTE',
      'regime.bear_weak': 'BEAR DÉBIL',
      'regime.bear': 'BEAR',
      'regime.ranging': 'LATERAL',
      'regime.squeeze': 'SQUEEZE',
      'regime.crash': 'CRASH',
      'regime.recovery': 'RECUPERACIÓN',
      'regime.neutral': 'NEUTRAL',
      'regime.extreme_vol': 'VOL-EXTREMA',
    },
  };

  const SUPPORTED = ['DE', 'EN', 'ES'];
  const DEFAULT_LANG = 'DE';

  function _getLang() {
    try {
      const stored = localStorage.getItem('nexus_lang');
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch (_) {}
    return DEFAULT_LANG;
  }

  function _setLang(lang) {
    if (!SUPPORTED.includes(lang)) return false;
    try { localStorage.setItem('nexus_lang', lang); } catch (_) {}
    window.__NEXUS_LANG = lang;
    // Bot-Settings synchronisieren
    try {
      fetch('/api/i18n/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang })
      }).catch(() => {});
    } catch (_) {}
    // DOM-Translation re-rendern
    _applyTranslations();
    // Custom-Event für Listeners
    try { window.dispatchEvent(new CustomEvent('nexus:langchange', { detail: { lang } })); } catch (_) {}
    return true;
  }

  // Helper: T('key') oder T('key', { name: 'BTC' })
  function T(key, params) {
    const lang = window.__NEXUS_LANG || _getLang();
    const dict = TEXTS[lang] || TEXTS[DEFAULT_LANG];
    let text = dict[key] || (TEXTS[DEFAULT_LANG][key]) || key;
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return text;
  }

  // Auto-translate alle Elemente mit data-i18n="key"
  function _applyTranslations() {
    try {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = T(key);
      });
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.setAttribute('title', T(key));
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.setAttribute('placeholder', T(key));
      });
    } catch (_) {}
  }

  // Init bei DOMContentLoaded
  function _init() {
    window.__NEXUS_LANG = _getLang();
    _applyTranslations();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Global API
  window.T = T;
  window.NEXUS_I18N = {
    getLang: _getLang,
    setLang: _setLang,
    supported: SUPPORTED,
    default: DEFAULT_LANG,
    apply: _applyTranslations,
    texts: TEXTS,
  };
})();
