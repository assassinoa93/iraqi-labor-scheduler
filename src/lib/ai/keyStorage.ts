/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Renderer-side wrapper around the Electron AI bridge.
 *
 * Every call here forwards to the sandboxed preload (window.aiApi) which
 * forwards to the main-process safeStorage handler. The renderer never
 * touches the encrypted blob directly — it asks for the plaintext key
 * just before an outbound HTTP call and lets it fall out of scope after.
 *
 * `getAiUserId(firebaseUid)` returns the stable per-machine identifier
 * used to scope the encrypted key file:
 *   - Online mode: `online:<firebaseUid>` so a user signing in on a
 *     second device does NOT auto-decrypt the first device's blob (they
 *     re-paste their key — by design).
 *   - Offline mode: `offline:<uuid>` generated once and persisted in
 *     localStorage. Survives reloads on the same install.
 */

export interface AiBridge {
  isAvailable: () => Promise<{ encryptionAvailable: boolean }>;
  hasKey: (userId: string) => Promise<{ hasKey: boolean }>;
  saveKey: (userId: string, plaintextKey: string) => Promise<{ saved: boolean }>;
  getKey: (userId: string) => Promise<{ key: string | null }>;
  deleteKey: (userId: string) => Promise<{ deleted: boolean }>;
  getConsent: (userId: string) => Promise<{ accepted: boolean; acceptedAt: number | null }>;
  setConsent: (userId: string, accepted: boolean) => Promise<{ saved: boolean }>;
}

declare global {
  interface Window {
    aiApi?: AiBridge;
  }
}

const OFFLINE_USER_KEY = 'ils.ai.offlineUserId';

/**
 * Stable per-machine identifier for AI-key storage. Pass the current
 * Firebase UID when in Online mode (or null in Offline). Offline mode
 * generates and persists a UUID once.
 */
export function getAiUserId(firebaseUid: string | null): string {
  if (firebaseUid) return `online:${firebaseUid}`;
  let id = localStorage.getItem(OFFLINE_USER_KEY);
  if (!id) {
    // crypto.randomUUID is available in every Electron/Chromium runtime
    // we ship to. No polyfill needed.
    id = `offline:${crypto.randomUUID()}`;
    localStorage.setItem(OFFLINE_USER_KEY, id);
  }
  return id;
}

export function isAiBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.aiApi;
}

function bridge(): AiBridge {
  if (!window.aiApi) {
    throw new Error(
      'AI key storage requires the desktop app (Electron). Run `npm run electron:dev` to use AI Services.',
    );
  }
  return window.aiApi;
}

export const aiKeyStore = {
  /** Reports whether OS-level encryption is wired up (gnome-keyring on Linux, etc.). */
  async isEncryptionAvailable(): Promise<boolean> {
    if (!isAiBridgeAvailable()) return false;
    const { encryptionAvailable } = await bridge().isAvailable();
    return encryptionAvailable;
  },

  hasKey(userId: string): Promise<boolean> {
    return bridge().hasKey(userId).then((r) => r.hasKey);
  },

  /** Decrypts and returns the plaintext key, or null if none is stored. */
  getKey(userId: string): Promise<string | null> {
    return bridge().getKey(userId).then((r) => r.key);
  },

  saveKey(userId: string, plaintextKey: string): Promise<void> {
    return bridge().saveKey(userId, plaintextKey).then(() => undefined);
  },

  deleteKey(userId: string): Promise<void> {
    return bridge().deleteKey(userId).then(() => undefined);
  },

  getConsent(userId: string): Promise<{ accepted: boolean; acceptedAt: number | null }> {
    return bridge().getConsent(userId);
  },

  setConsent(userId: string, accepted: boolean): Promise<void> {
    return bridge().setConsent(userId, accepted).then(() => undefined);
  },
};
