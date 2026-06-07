// PM2 Ecosystem Config — Tier-Y House-Keeping (V14.5, 11.05.2026)
// Aktiviert --expose-gc, --max-old-space-size=2048, max_memory_restart=1G.
// Bot-Secrets (BITGET_*/TELEGRAM_*/CRYPTOPANIC_*) werden vom Shell-Env inherit'ed,
// NICHT hier hardcoded — bewusste Sicherheits-Trennung.
//
// Deploy: pm2 delete nexus && pm2 start ecosystem.config.js && pm2 save
// Counter wird auf 1 resettet (bewusst gewollt).

module.exports = {
  apps: [
    {
      name:                'nexus',
      script:              'server.js',
      cwd:                 __dirname,
      instances:           1,
      exec_mode:           'fork',
      autorestart:         true,
      watch:               false,
      max_memory_restart:  '1G',
      max_restarts:        50,
      restart_delay:       5000,
      node_args:           '--expose-gc --max-old-space-size=2048 --no-node-snapshot',
      merge_logs:          true,
      log_date_format:     'YYYY-MM-DD HH:mm:ss.SSS',
      // --no-node-snapshot (Phase 6 Teil 7, 15.05.2026) ist Pflicht für isolated-vm
      // unter Node 20.x. Ohne diesen Flag segfaultet `new ivm.Isolate(...)`.
      // Quelle: laverdet/isolated-vm GitHub Issue #415 + npmjs README.
      env: {
        NODE_OPTIONS: '--no-node-snapshot',
      },
      // env-Variablen werden vom Shell-Environment inherit'ed (NODE_ENV, PORT,
      // BITGET_*, TELEGRAM_*, CRYPTOPANIC_API_KEY etc.). Hier KEIN env-Block,
      // damit keine Secrets im Repo landen und Shell-Env die Single-Source bleibt.
    },
    // Phase 6 Teil 5 [15.05.2026] — Sub-Bot Worker Slots
    // Default: NICHT autostart. Master controls via /api/farm/start/:bot_id.
    // Sub-Bots heartbeaten via HTTP an Master; keine DB-Writes (Master single-writer).
    {
      name:                'nexus_sub_1',
      script:              'scripts/sub_bot.js',
      cwd:                 __dirname,
      instances:           1,
      exec_mode:           'fork',
      autorestart:         false,   // Master controls lifecycle
      watch:               false,
      max_restarts:        5,
      restart_delay:       3000,
      merge_logs:          true,
      log_date_format:     'YYYY-MM-DD HH:mm:ss.SSS',
      env: {
        BOT_ID:        'bot_sub_1',
        BOT_NAME:      'SUB_1',
        MASTER_URL:    'http://localhost:3000',
        HEARTBEAT_MS:  '30000',
      },
    },
    {
      name:                'nexus_sub_2',
      script:              'scripts/sub_bot.js',
      cwd:                 __dirname,
      instances:           1,
      exec_mode:           'fork',
      autorestart:         false,
      watch:               false,
      max_restarts:        5,
      restart_delay:       3000,
      merge_logs:          true,
      log_date_format:     'YYYY-MM-DD HH:mm:ss.SSS',
      env: {
        BOT_ID:        'bot_sub_2',
        BOT_NAME:      'SUB_2',
        MASTER_URL:    'http://localhost:3000',
        HEARTBEAT_MS:  '30000',
      },
    },
  ],
};
