// lib/encryption.js — AES-256-GCM Encryption mit macOS Keychain Master-Key
// Verankert 2026-05-24 (T8.1.3 — Multi-Exchange UI)
//
// SICHERHEIT:
//   - AES-256-GCM (authenticated encryption)
//   - Master-Key persistiert in macOS Keychain (security cli)
//   - Niemals Klartext in DB, niemals in Logs, niemals in Stacktraces
//   - Per-Wert IV (12 Bytes Random)
//   - Auth-Tag pro Verschlüsselung
//
// USAGE:
//   const enc = require('./lib/encryption');
//   const r = enc.encrypt('my-api-secret');  // → { ciphertext, iv, tag }
//   const p = enc.decrypt(r.ciphertext, r.iv, r.tag);  // → 'my-api-secret'
//   const masked = enc.mask('my-api-secret');  // → '****cret'
//
// MIGRATION:
//   Erster Aufruf von getMasterKey() lädt Key aus Keychain.
//   Falls nicht vorhanden: generiert neuen 32-Byte-Key + schreibt in Keychain.

'use strict';

const crypto = require('crypto');
const { execSync } = require('child_process');

const KEYCHAIN_SERVICE = 'NEXUS_V9_BOT';
const KEYCHAIN_ACCOUNT = 'master_encryption_key';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;            // 12 bytes = 96 bits (recommended for GCM)
const KEY_LENGTH = 32;            // 32 bytes = 256 bits
const AUTH_TAG_LENGTH = 16;

let _cachedMasterKey = null;       // Lazy-cache (nicht persistiert)

// ─── Master-Key aus macOS Keychain (oder Fallback aus .env) ─────────
function _getMasterKey() {
  if (_cachedMasterKey) return _cachedMasterKey;
  // Try macOS Keychain first
  try {
    const stdout = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (stdout && stdout.length >= 64) {  // 32 bytes hex = 64 chars
      _cachedMasterKey = Buffer.from(stdout, 'hex');
      return _cachedMasterKey;
    }
  } catch (e) {
    // Key not in Keychain → generate new
  }
  // Fallback: ENV-Variable (NICHT empfohlen, nur falls Keychain fail)
  if (process.env.NEXUS_MASTER_KEY) {
    const hex = String(process.env.NEXUS_MASTER_KEY).trim();
    if (hex.length === 64) {
      _cachedMasterKey = Buffer.from(hex, 'hex');
      return _cachedMasterKey;
    }
  }
  // Neuer Key: 32 random bytes
  const newKey = crypto.randomBytes(KEY_LENGTH);
  // Try to persist in Keychain
  try {
    execSync(
      `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${newKey.toString('hex')}" -U 2>/dev/null`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (e) {
    // Falls Keychain-add fail → in Memory bleiben, aber WARN
    if (typeof console.warn === 'function') {
      // Niemals den Key selbst loggen
      console.warn('[ENCRYPTION] Could not persist master key to Keychain (will live in memory only this session).');
    }
  }
  _cachedMasterKey = newKey;
  return newKey;
}

// ─── Encrypt: returns { ciphertext, iv, tag } as base64 strings ────
function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return { ciphertext: null, iv: null, tag: null };
  }
  const key = _getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

// ─── Decrypt: takes base64 strings, returns plaintext ──────────────
function decrypt(ciphertextB64, ivB64, tagB64) {
  if (!ciphertextB64 || !ivB64 || !tagB64) return null;
  try {
    const key = _getMasterKey();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ciphertextB64, 'base64');
    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    // Auth-Tag-Fehler oder Key-Mismatch → null statt throw (sicher)
    return null;
  }
}

// ─── Mask: für UI/Logs — zeigt nur letzte 4 Zeichen ────────────────
function mask(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return '';
  if (plaintext.length <= 4) return '****';
  return '****' + plaintext.slice(-4);
}

// ─── Roundtrip-Test: für Boot-Verifikation ────────────────────────
function roundtripTest() {
  try {
    const testPlain = 'NEXUS_ROUNDTRIP_TEST_' + Date.now();
    const enc = encrypt(testPlain);
    if (!enc.ciphertext || !enc.iv || !enc.tag) return { ok: false, error: 'encrypt failed' };
    const dec = decrypt(enc.ciphertext, enc.iv, enc.tag);
    if (dec !== testPlain) return { ok: false, error: 'roundtrip mismatch' };
    return { ok: true, masterKeySource: _getMasterKeySource() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _getMasterKeySource() {
  // Diagnostic: woher kam der Key (Keychain / env / new)?
  // OHNE den Key selbst zu zeigen
  try {
    execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return 'keychain';
  } catch (_) {}
  if (process.env.NEXUS_MASTER_KEY) return 'env';
  return 'generated-this-session';
}

// ─── Sanitizer für Logs: entfernt potenzielle Keys ────────────────
// Pattern: 32+ zeichen hex/base64 → durch ****REDACTED**** ersetzen
// Auch wenn von Underscore / Sonderzeichen umgeben (echte Keys haben oft Prefixes)
function sanitizeForLog(str) {
  if (typeof str !== 'string') return str;
  return str
    // Long hex sequences (likely keys) — auch mit Prefix wie "bg_..."
    .replace(/[A-Fa-f0-9]{32,}/g, '****REDACTED****')
    // Base64-like long sequences
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '****REDACTED****');
}

module.exports = {
  encrypt,
  decrypt,
  mask,
  roundtripTest,
  sanitizeForLog,
  KEYCHAIN_SERVICE,
};
