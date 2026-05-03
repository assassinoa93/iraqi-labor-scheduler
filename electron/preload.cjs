'use strict';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.2 / 3.6 — Renderer-side bridge for the Admin SDK IPC surface.
 *
 * Sandboxed preload (sandbox: true) — only `electron` is requireable here,
 * not Node fs/path. That's fine: this file only forwards IPC calls.
 *
 * Every privileged call carries `projectId` so the main process can pick
 * the right service-account JSON + Admin SDK app for multi-database
 * super-admins. The renderer-side adminApi.ts wrapper reads projectId
 * from the active stored config.
 */

const { contextBridge, ipcRenderer } = require('electron');

function call(channel, arg) {
  return ipcRenderer.invoke(channel, arg).then((res) => {
    if (res && res.ok) return res.data;
    const err = new Error((res && res.message) || 'Admin call failed');
    err.code = (res && res.code) || 'UNKNOWN';
    throw err;
  });
}

contextBridge.exposeInMainWorld('adminApi', {
  isLinked: (projectId) => call('admin:isLinked', { projectId }),
  linkServiceAccount: (projectId) => call('admin:linkServiceAccount', { projectId }),
  bootstrapFirstSuperAdmin: (projectId, uid) => call('admin:bootstrapFirstSuperAdmin', { projectId, uid }),
  bootstrapSuperAdminAccount: (projectId, payload) => call('admin:bootstrapSuperAdminAccount', { projectId, ...payload }),
  listUsers: (projectId, idToken) => call('admin:listUsers', { projectId, idToken }),
  createUser: (projectId, idToken, payload) => call('admin:createUser', { projectId, idToken, ...payload }),
  setUserRole: (projectId, idToken, payload) => call('admin:setUserRole', { projectId, idToken, ...payload }),
  disableUser: (projectId, idToken, uid) => call('admin:disableUser', { projectId, idToken, uid }),
  enableUser: (projectId, idToken, uid) => call('admin:enableUser', { projectId, idToken, uid }),
  resetPassword: (projectId, idToken, uid) => call('admin:resetPassword', { projectId, idToken, uid }),
  deleteUser: (projectId, idToken, uid) => call('admin:deleteUser', { projectId, idToken, uid }),
  purgeAuditOlderThan: (projectId, idToken, ts) => call('admin:purgeAuditOlderThan', { projectId, idToken, ts }),
  auditStats: (projectId, idToken) => call('admin:auditStats', { projectId, idToken }),
  quotaUsage: (projectId, idToken, force) => call('admin:quotaUsage', { projectId, idToken, force }),
  wipeLocalSecrets: () => call('admin:wipeLocalSecrets'),
});
