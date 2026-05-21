import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_USER_PREFS,
  DEFAULT_WORKSPACE_POLICY,
  getUserPrefs,
  getWorkspacePolicy,
  isModelAllowed,
  setUserPrefs,
  setWorkspacePolicy,
} from '../policy';

// Lightweight in-memory shim. The policy module uses localStorage at module
// scope, so the tests can't depend on jsdom — we install a Map-backed stub.
function installLocalStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = stub as unknown as Storage;
  (globalThis as unknown as { window: { addEventListener: () => void; removeEventListener: () => void; dispatchEvent: () => boolean } }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  // setWorkspacePolicy constructs a CustomEvent — keep that available too.
  (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
    class CustomEvent { constructor(_t: string) {} } as unknown as typeof CustomEvent;
}

beforeEach(() => {
  installLocalStorageStub();
});

describe('isModelAllowed', () => {
  it('allows any model when allowlist is null', () => {
    expect(isModelAllowed('openai/gpt-4o', null)).toBe(true);
  });
  it('allows any model when allowlist is empty', () => {
    expect(isModelAllowed('openai/gpt-4o', [])).toBe(true);
  });
  it('returns true for ids in the allowlist', () => {
    expect(isModelAllowed('anthropic/claude-sonnet-4-6', ['anthropic/claude-sonnet-4-6'])).toBe(true);
  });
  it('returns false for ids missing from the allowlist', () => {
    expect(isModelAllowed('openai/gpt-4o', ['anthropic/claude-sonnet-4-6'])).toBe(false);
  });
});

describe('workspace policy persistence', () => {
  it('returns DEFAULT_WORKSPACE_POLICY when storage is empty', () => {
    expect(getWorkspacePolicy()).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it('round-trips through setWorkspacePolicy', () => {
    setWorkspacePolicy({ aiModeEnabled: false, allowedModels: ['x/y'], aiUsageLog: true });
    expect(getWorkspacePolicy()).toEqual({
      aiModeEnabled: false,
      allowedModels: ['x/y'],
      aiUsageLog: true,
    });
  });

  it('merges partial saved policies with the defaults', () => {
    localStorage.setItem('ils.ai.workspacePolicy', JSON.stringify({ aiUsageLog: true }));
    expect(getWorkspacePolicy()).toEqual({
      ...DEFAULT_WORKSPACE_POLICY,
      aiUsageLog: true,
    });
  });

  it('falls back to defaults when stored JSON is malformed', () => {
    localStorage.setItem('ils.ai.workspacePolicy', '{not json}');
    expect(getWorkspacePolicy()).toEqual(DEFAULT_WORKSPACE_POLICY);
  });
});

describe('user prefs persistence', () => {
  it('returns DEFAULT_USER_PREFS when nothing stored', () => {
    expect(getUserPrefs('u1')).toEqual(DEFAULT_USER_PREFS);
  });

  it('keys prefs per user id', () => {
    setUserPrefs('u1', { selectedModel: 'a/b', noTraining: false });
    setUserPrefs('u2', { selectedModel: 'c/d', noTraining: true });
    expect(getUserPrefs('u1').selectedModel).toBe('a/b');
    expect(getUserPrefs('u2').selectedModel).toBe('c/d');
  });

  it('defaults noTraining to true (privacy by default)', () => {
    expect(DEFAULT_USER_PREFS.noTraining).toBe(true);
  });
});
