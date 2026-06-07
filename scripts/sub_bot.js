#!/usr/bin/env node
/**
 * NEXUS Trading Farm — Sub-Bot Worker (Phase 6 Teil 5, 15.05.2026)
 *
 * Minimal worker process that:
 *   - Reads its assignment (BOT_ID, symbols) from env
 *   - Sends heartbeat to master via HTTP every 30s
 *   - Logs activity to console (captured by PM2 logs)
 *
 * v1: read-only (no trade execution). Master process owns all DB writes.
 *     Heartbeats arrive via HTTP at /api/farm/bots/:bot_id/heartbeat.
 *
 * Source: FreqTrade worker-heartbeat-pattern, PM2 ecosystem multi-app, WAL multi-reader.
 */

const BOT_ID = process.env.BOT_ID || 'sub_unknown';
const BOT_NAME = process.env.BOT_NAME || BOT_ID;
const MASTER_URL = process.env.MASTER_URL || 'http://localhost:3000';
const HEARTBEAT_MS = parseInt(process.env.HEARTBEAT_MS || '30000', 10);

let heartbeatCount = 0;
let lastError = null;

async function sendHeartbeat() {
  try {
    const r = await fetch(`${MASTER_URL}/api/farm/bots/${BOT_ID}/heartbeat`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      heartbeatCount++;
      console.log(`[${BOT_NAME}] heartbeat #${heartbeatCount} OK`);
    } else {
      lastError = `HTTP ${r.status}`;
      console.error(`[${BOT_NAME}] heartbeat fail: ${lastError}`);
    }
  } catch (e) {
    lastError = e.message;
    console.error(`[${BOT_NAME}] heartbeat error: ${e.message}`);
  }
}

console.log(`[${BOT_NAME}] sub-bot starting (master=${MASTER_URL}, heartbeat=${HEARTBEAT_MS}ms)`);

// First heartbeat after 2s, then every HEARTBEAT_MS
setTimeout(() => {
  sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);
}, 2000);

// Clean shutdown on SIGTERM / SIGINT
function shutdown(signal) {
  console.log(`[${BOT_NAME}] received ${signal}, shutting down (heartbeats=${heartbeatCount}, lastError=${lastError})`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Liveness check — alle 5s log dass wir noch da sind
setInterval(() => {
  console.log(`[${BOT_NAME}] alive (heartbeats=${heartbeatCount}, mem=${(process.memoryUsage().heapUsed/1024/1024).toFixed(1)}MB)`);
}, 60000);
