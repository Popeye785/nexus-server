#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(
  !server.includes('INSERT OR REPLACE INTO candle_cache'),
  'candle_cache must not use INSERT OR REPLACE because it deletes/reinserts hot index rows'
);

assert(
  server.includes('ON CONFLICT(symbol,granularity,ts) DO UPDATE'),
  'candle_cache must update conflicts in place via UPSERT'
);

assert(
  server.includes('CANDLE_CACHE_BOOT_WRITE_DELAY_MS'),
  'candle_cache writes need a boot guard to prevent restart write storms'
);

assert(
  server.includes('CandleCacheWriteQueue'),
  'candle_cache writes must go through the serialized write queue'
);

const directRuns = [...server.matchAll(/DB\.cacheCandles\.run\(/g)].map(m => m.index);
assert.strictEqual(
  directRuns.length,
  1,
  'DB.cacheCandles.run should only appear inside CandleCacheWriteQueue'
);

const queuePos = server.indexOf('const CandleCacheWriteQueue');
assert(queuePos >= 0, 'CandleCacheWriteQueue declaration missing');
assert(
  directRuns[0] > queuePos,
  'the only DB.cacheCandles.run call must be inside the queue declaration'
);

console.log('ok candle_cache writer safety');
