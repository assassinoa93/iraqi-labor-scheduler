/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI workspace policy + per-user prefs.
 *
 * Workspace policy (super_admin-controlled):
 *   - aiModeEnabled  master switch; off = AI tab hidden for everyone
 *   - allowedModels  optional allowlist (model ids); null = no restriction
 *   - aiUsageLog     when on, log {userId, ts, action} for admin visibility
 *
 * Per-user prefs (each user manages their own):
 *   - selectedModel  active OpenRouter model id
 *   - noTraining     when true, request `provider.data_collection: 'deny'`
 *
 * Both live in localStorage in v5.20. The encrypted OpenRouter key is the
 * only AI artifact that warrants Electron safeStorage; the policy and
 * prefs are non-secret and per-device. Future versions may sync workspace
 * policy through a /system/aiPolicy/current Firestore doc — at that
 * point, this module's setters become the single rewire point.
 */

import { useEffect, useState } from 'react';

export interface WorkspaceAiPolicy {
  /** Master switch. Off = AI tab hidden regardless of role / per-user keys. */
  aiModeEnabled: boolean;
  /** Optional model-id allowlist. null = no restriction. */
  allowedModels: string[] | null;
  /** When true, log {userId, ts, action} so admins can see who is using AI. */
  aiUsageLog: boolean;
}

export const DEFAULT_WORKSPACE_POLICY: WorkspaceAiPolicy = {
  aiModeEnabled: true,
  allowedModels: null,
  aiUsageLog: false,
};

const POLICY_KEY = 'ils.ai.workspacePolicy';
const USER_PREFS_KEY = (uid: string) => `ils.ai.userPrefs.${uid}`;
const POLICY_EVENT = 'ils:ai-policy-changed';

export function getWorkspacePolicy(): WorkspaceAiPolicy {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    if (!raw) return DEFAULT_WORKSPACE_POLICY;
    const parsed = JSON.parse(raw) as Partial<WorkspaceAiPolicy>;
    return { ...DEFAULT_WORKSPACE_POLICY, ...parsed };
  } catch {
    return DEFAULT_WORKSPACE_POLICY;
  }
}

export function setWorkspacePolicy(p: WorkspaceAiPolicy): void {
  localStorage.setItem(POLICY_KEY, JSON.stringify(p));
  // Same-tab consumers don't get a `storage` event — dispatch a custom
  // one so all useWorkspaceAiPolicy() subscribers re-render in lockstep.
  window.dispatchEvent(new CustomEvent(POLICY_EVENT));
}

export function useWorkspaceAiPolicy(): [WorkspaceAiPolicy, (p: WorkspaceAiPolicy) => void] {
  const [policy, setPolicy] = useState<WorkspaceAiPolicy>(getWorkspacePolicy);
  useEffect(() => {
    const onChange = () => setPolicy(getWorkspacePolicy());
    window.addEventListener(POLICY_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(POLICY_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  const update = (next: WorkspaceAiPolicy) => {
    setWorkspacePolicy(next);
    setPolicy(next);
  };
  return [policy, update];
}

export interface AiUserPrefs {
  selectedModel: string | null;
  /** Default true — privacy by default, the user can opt in to model
   *  training via the AI Settings panel if they want to. */
  noTraining: boolean;
}

export const DEFAULT_USER_PREFS: AiUserPrefs = {
  selectedModel: null,
  noTraining: true,
};

export function getUserPrefs(uid: string): AiUserPrefs {
  try {
    const raw = localStorage.getItem(USER_PREFS_KEY(uid));
    if (!raw) return DEFAULT_USER_PREFS;
    const parsed = JSON.parse(raw) as Partial<AiUserPrefs>;
    return { ...DEFAULT_USER_PREFS, ...parsed };
  } catch {
    return DEFAULT_USER_PREFS;
  }
}

export function setUserPrefs(uid: string, p: AiUserPrefs): void {
  localStorage.setItem(USER_PREFS_KEY(uid), JSON.stringify(p));
}

export function useAiUserPrefs(uid: string | null): [AiUserPrefs, (p: AiUserPrefs) => void] {
  const [prefs, setPrefs] = useState<AiUserPrefs>(() =>
    uid ? getUserPrefs(uid) : DEFAULT_USER_PREFS,
  );
  useEffect(() => {
    if (uid) setPrefs(getUserPrefs(uid));
  }, [uid]);
  const update = (next: AiUserPrefs) => {
    if (uid) {
      setUserPrefs(uid, next);
      setPrefs(next);
    }
  };
  return [prefs, update];
}

/**
 * True when the model id is permitted under the current workspace
 * allowlist. Pass null/undefined for the unrestricted-list case.
 */
export function isModelAllowed(
  modelId: string,
  allowed: string[] | null | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(modelId);
}
