'use strict';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI Services bridge.
 *
 * Per-user OpenRouter key storage. The renderer hands us a plaintext
 * key, we run it through Electron `safeStorage` (which is OS-keychain
 * backed on every supported platform) and persist the encrypted blob
 * at:
 *
 *     <userData>/ai/key-<sha256(userId).slice(0,32)>.enc
 *
 * The userId is hashed (not used raw) so the on-disk filename never
 * leaks the Firebase UID or the offline local id. Decryption reads
 * the blob, calls safeStorage.decryptString(), and the plaintext only
 * lives in the renderer for the duration of an outbound HTTP call.
 *
 * The encrypted blobs are tied to the OS user account that ran the
 * app at save time. They are NOT portable to a second device and are
 * NEVER synced to Firestore — same local-first ethos as the
 * service-account JSONs in admin-bridge.cjs.
 *
 * The first-use consent flag is also stored here (per user) so the
 * renderer doesn't have to re-prompt every launch. Same lifecycle as
 * the key — clearing the key clears the consent.
 */

const { ipcMain, app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function aiRoot() {
  return path.join(app.getPath('userData'), 'ai');
}

function ensureRoot() {
  const root = aiRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

// Hash the userId for filesystem hygiene. We never need the raw id back —
// every IPC call carries its own userId — so a one-way digest is enough.
function safeId(userId) {
  if (!userId || typeof userId !== 'string') {
    const err = new Error('userId is required');
    err.code = 'BAD_INPUT';
    throw err;
  }
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32);
}

function userKeyPath(idHash) {
  return path.join(ensureRoot(), `key-${idHash}.enc`);
}

function consentPath(idHash) {
  return path.join(ensureRoot(), `consent-${idHash}.json`);
}

function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (_event, arg) => {
    try {
      const data = await handler(arg);
      return { ok: true, data };
    } catch (e) {
      return {
        ok: false,
        code: (e && e.code) || 'UNKNOWN',
        message: (e && e.message) || String(e),
      };
    }
  });
}

function registerAiIpc() {
  safeHandle('ai:isAvailable', async () => ({
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }));

  safeHandle('ai:hasKey', async ({ userId } = {}) => {
    const id = safeId(userId);
    return { hasKey: fs.existsSync(userKeyPath(id)) };
  });

  safeHandle('ai:saveKey', async ({ userId, plaintextKey } = {}) => {
    if (!plaintextKey || typeof plaintextKey !== 'string') {
      const err = new Error('plaintextKey is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      const err = new Error(
        'OS-level encryption is not available on this machine. ' +
        'On Linux, install gnome-keyring or kwallet; on Windows / macOS this should never happen.',
      );
      err.code = 'NO_ENCRYPTION';
      throw err;
    }
    const id = safeId(userId);
    const blob = safeStorage.encryptString(plaintextKey);
    fs.writeFileSync(userKeyPath(id), blob);
    return { saved: true };
  });

  safeHandle('ai:getKey', async ({ userId } = {}) => {
    const id = safeId(userId);
    const p = userKeyPath(id);
    if (!fs.existsSync(p)) return { key: null };
    if (!safeStorage.isEncryptionAvailable()) {
      const err = new Error('OS-level encryption is not available on this machine.');
      err.code = 'NO_ENCRYPTION';
      throw err;
    }
    const blob = fs.readFileSync(p);
    const key = safeStorage.decryptString(blob);
    return { key };
  });

  safeHandle('ai:deleteKey', async ({ userId } = {}) => {
    const id = safeId(userId);
    const k = userKeyPath(id);
    const c = consentPath(id);
    if (fs.existsSync(k)) fs.unlinkSync(k);
    if (fs.existsSync(c)) fs.unlinkSync(c);
    return { deleted: true };
  });

  safeHandle('ai:getConsent', async ({ userId } = {}) => {
    const id = safeId(userId);
    const p = consentPath(id);
    if (!fs.existsSync(p)) return { accepted: false, acceptedAt: null };
    try {
      const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { accepted: !!json.accepted, acceptedAt: json.acceptedAt || null };
    } catch {
      return { accepted: false, acceptedAt: null };
    }
  });

  safeHandle('ai:setConsent', async ({ userId, accepted } = {}) => {
    const id = safeId(userId);
    const p = consentPath(id);
    fs.writeFileSync(p, JSON.stringify({
      accepted: !!accepted,
      acceptedAt: Date.now(),
    }));
    return { saved: true };
  });
}

module.exports = { registerAiIpc };
