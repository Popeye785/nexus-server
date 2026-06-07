-- Block R A2 [27.05.2026]: DB-Migration für Per-Symbol Bayesian-Posteriors.
-- NICHT in Block R ausgeführt — wartet auf Christian-OK in Block S.
--
-- Ausführung später via:
--   sqlite3 nexus.db < scripts/migrate_bayesian_per_symbol.sql
--
-- Rollback:
--   sqlite3 nexus.db "DROP TABLE bayesian_symbol_posteriors;"

CREATE TABLE IF NOT EXISTS bayesian_symbol_posteriors (
  symbol TEXT PRIMARY KEY,
  prior_bull REAL NOT NULL DEFAULT 0.333,
  prior_bear REAL NOT NULL DEFAULT 0.333,
  prior_sideways REAL NOT NULL DEFAULT 0.334,
  n_observations INTEGER NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bay_sym_last ON bayesian_symbol_posteriors(last_updated DESC);

-- Sanity-Check (nach Migration):
--   SELECT COUNT(*) FROM bayesian_symbol_posteriors;
--   PRAGMA table_info(bayesian_symbol_posteriors);
