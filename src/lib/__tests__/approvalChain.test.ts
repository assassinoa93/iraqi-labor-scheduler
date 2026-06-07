import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveChain, presentRolesFrom, DEFAULT_APPROVAL_CONFIG,
  type WorkspaceApprovalConfig,
} from '../approvalChain';
import type { Role } from '../auth';

const present = (...roles: Role[]) => new Set<Role>(roles);

describe('resolveEffectiveChain — full staff', () => {
  it('keeps the default chain when supervisor, manager, and admin all exist', () => {
    const c = resolveEffectiveChain(DEFAULT_APPROVAL_CONFIG, present('supervisor', 'manager', 'admin'));
    expect(c).toEqual({ submit: 'supervisor', lock: 'manager', save: 'admin' });
  });
});

describe('resolveEffectiveChain — no-halt fallback (autoFallback on)', () => {
  it('folds the validate step onto the admin when there is no manager', () => {
    const c = resolveEffectiveChain(DEFAULT_APPROVAL_CONFIG, present('supervisor', 'admin'));
    expect(c.submit).toBe('supervisor');
    expect(c.lock).toBe('admin');  // admin absorbs the manager's validation
    expect(c.save).toBe('admin');
  });

  it('folds the finalize step onto the manager when there is no admin', () => {
    const c = resolveEffectiveChain(DEFAULT_APPROVAL_CONFIG, present('supervisor', 'manager'));
    expect(c.lock).toBe('manager');
    expect(c.save).toBe('manager');  // manager absorbs the admin's finalize
  });

  it('lets the supervisor complete everything when neither manager nor admin exists', () => {
    const c = resolveEffectiveChain(DEFAULT_APPROVAL_CONFIG, present('supervisor'));
    expect(c).toEqual({ submit: 'supervisor', lock: 'supervisor', save: 'supervisor' });
  });

  it('falls back to super_admin only when no operational roles are present at all', () => {
    const c = resolveEffectiveChain(DEFAULT_APPROVAL_CONFIG, present());
    expect(c).toEqual({ submit: 'super_admin', lock: 'super_admin', save: 'super_admin' });
  });
});

describe('resolveEffectiveChain — strict mode (autoFallback off)', () => {
  it('leaves an absent owner in place so only a super-admin override can act (pre-v5.27 behaviour)', () => {
    const strict: WorkspaceApprovalConfig = { ...DEFAULT_APPROVAL_CONFIG, autoFallback: false };
    const c = resolveEffectiveChain(strict, present('supervisor', 'admin'));
    expect(c.lock).toBe('manager'); // unchanged → halts for normal roles
  });
});

describe('resolveEffectiveChain — super-admin custom config', () => {
  it('honours a super-admin-defined owner when that role is present', () => {
    const custom: WorkspaceApprovalConfig = {
      steps: [
        { id: 'submit', role: 'supervisor' },
        { id: 'validate', role: 'admin' },   // company chooses admin to validate
        { id: 'finalize', role: 'admin' },
      ],
      autoFallback: true,
    };
    const c = resolveEffectiveChain(custom, present('supervisor', 'manager', 'admin'));
    expect(c.lock).toBe('admin');
    expect(c.save).toBe('admin');
  });
});

describe('presentRolesFrom', () => {
  it('collects the distinct roles from a workspace user list', () => {
    const roles = presentRolesFrom([{ role: 'supervisor' }, { role: 'manager' }, { role: 'manager' }]);
    expect(roles).toEqual(new Set<Role>(['supervisor', 'manager']));
  });
});
