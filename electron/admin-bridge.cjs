'use strict';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.2/3.6 — Electron main-process Firebase Admin SDK bridge.
 *
 * The Admin SDK lives ONLY in the main process. The renderer never sees the
 * service-account JSON contents — it can only invoke a narrow IPC surface,
 * exposed via electron/preload.cjs as `window.adminApi.*`.
 *
 * ── Multi-database support (Phase 3.6) ────────────────────────────────────
 *
 * A super-admin who manages several Firebase projects (one per company
 * /branch) keeps a SEPARATE service-account JSON per project. Files live
 * at:
 *
 *     <userData>/firebase-admin/<projectId>/serviceAccount.json
 *
 * Each project gets its own Admin SDK app instance. The renderer must
 * include `projectId` in every privileged IPC call so the bridge knows
 * which project's credentials to use. The legacy single-file path
 * (<userData>/firebase-admin/serviceAccount.json) is auto-migrated on
 * first read into the per-project subfolder.
 *
 * Why this matters: with one shared file, "link" on project B silently
 * overwrote project A's credentials. With per-project folders, you can
 * switch between databases freely without re-linking each time.
 *
 * ── Security model ───────────────────────────────────────────────────────
 *
 *   1. Service-account JSONs are NEVER bundled with the .exe. Each
 *      super-admin places their files locally after install.
 *   2. Privileged handlers verify the caller's Firebase ID token AND
 *      that the token's project_id matches the requested projectId.
 *      A super_admin token from project A can't drive admin ops on
 *      project B.
 *   3. ID-token verification uses Admin SDK's `verifyIdToken` (signature
 *      + expiry + audience checked).
 */

const path = require('path');
const fs = require('fs');
const { ipcMain, dialog, app } = require('electron');

let admin = null;                          // lazily required firebase-admin module
const adminApps = new Map();               // projectId → admin.App
const serviceAccountPaths = new Map();     // projectId → resolved file path

function adminRoot() {
  return path.join(app.getPath('userData'), 'firebase-admin');
}

function projectDir(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    const err = new Error('projectId is required');
    err.code = 'BAD_INPUT';
    throw err;
  }
  // Defensive: project IDs are alphanumeric + hyphens per Firebase rules,
  // but reject any path traversal characters just in case.
  if (/[\\/:*?"<>|.]/.test(projectId)) {
    const err = new Error(`Invalid projectId: ${projectId}`);
    err.code = 'BAD_INPUT';
    throw err;
  }
  return path.join(adminRoot(), projectId);
}

function projectServiceAccountPath(projectId) {
  return path.join(projectDir(projectId), 'serviceAccount.json');
}

/**
 * Migrates the legacy single-file location (pre-Phase-3.6) into the
 * per-project subfolder, based on the project_id field inside the JSON.
 * Idempotent — runs at most once per legacy file.
 */
function migrateLegacyServiceAccount() {
  try {
    const legacyPath = path.join(adminRoot(), 'serviceAccount.json');
    if (!fs.existsSync(legacyPath)) return;
    const json = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
    const projectId = json && json.project_id;
    if (!projectId) {
      // Don't throw — a malformed legacy file just gets left alone for
      // the user to clean up manually.
      console.warn('[admin-bridge] legacy serviceAccount.json has no project_id; skipping migration');
      return;
    }
    const targetDir = projectDir(projectId);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = projectServiceAccountPath(projectId);
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(legacyPath, targetPath);
    }
    fs.unlinkSync(legacyPath);
    console.log(`[admin-bridge] migrated legacy serviceAccount.json → ${targetPath}`);
  } catch (e) {
    console.warn('[admin-bridge] legacy migration failed (non-fatal):', e.message);
  }
}

function resolveServiceAccountPath(projectId) {
  // Run the legacy migration on first access. Cheap to call repeatedly
  // because it's a no-op once the legacy file is gone.
  migrateLegacyServiceAccount();

  const userPath = projectServiceAccountPath(projectId);
  if (fs.existsSync(userPath)) return userPath;

  // Dev convenience: also look at the repo-root path the bootstrap
  // script uses, IF its project_id matches the requested project.
  if (!app.isPackaged) {
    const repoPath = path.join(__dirname, '..', 'firebase-admin', 'serviceAccount.json');
    if (fs.existsSync(repoPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(repoPath, 'utf-8'));
        if (json && json.project_id === projectId) return repoPath;
      } catch { /* ignore — bad file */ }
    }
  }
  return null;
}

function loadAdminSdk(projectId) {
  // Each project has its own admin.App instance, cached by projectId.
  // firebase-admin allows multiple named apps; we name each one by
  // projectId to avoid collisions.
  if (adminApps.has(projectId)) return adminApps.get(projectId);

  const resolved = resolveServiceAccountPath(projectId);
  if (!resolved) {
    const err = new Error(`Service account not linked for project "${projectId}"`);
    err.code = 'NOT_LINKED';
    throw err;
  }
  if (!admin) {
    try {
      admin = require('firebase-admin');
    } catch {
      const err = new Error('firebase-admin is not installed in this build');
      err.code = 'SDK_MISSING';
      throw err;
    }
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (e) {
    const err = new Error(`Failed to read service account JSON: ${e.message}`);
    err.code = 'BAD_FILE';
    throw err;
  }
  if (serviceAccount.project_id !== projectId) {
    const err = new Error(
      `Service account project_id (${serviceAccount.project_id}) does not match expected ${projectId}`,
    );
    err.code = 'PROJECT_MISMATCH';
    throw err;
  }

  // initializeApp with a unique name keyed by projectId so we can hold
  // multiple project apps concurrently without "default app already
  // exists" collisions.
  const appName = `ils-admin-${projectId}`;
  const existing = admin.apps.find((a) => a && a.name === appName);
  const adminApp = existing ?? admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  }, appName);

  adminApps.set(projectId, adminApp);
  serviceAccountPaths.set(projectId, resolved);
  return adminApp;
}

/**
 * Verifies the caller's Firebase ID token, asserts super_admin claim,
 * AND asserts the token's audience (project_id) matches the requested
 * projectId. Returns the decoded token on success.
 */
async function requireSuperAdmin(projectId, idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const err = new Error('Missing ID token');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const adminApp = loadAdminSdk(projectId);
  const decoded = await adminApp.auth().verifyIdToken(idToken);
  if (decoded.role !== 'super_admin') {
    const err = new Error('Caller is not super_admin');
    err.code = 'NOT_AUTHORIZED';
    throw err;
  }
  if (decoded.aud && decoded.aud !== projectId) {
    const err = new Error(
      `Token audience (${decoded.aud}) does not match requested project (${projectId})`,
    );
    err.code = 'PROJECT_MISMATCH';
    throw err;
  }
  return decoded;
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

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  const buf = require('crypto').randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += chars[buf[i] % chars.length];
  return out;
}

function registerAdminIpc() {
  // ── Linking ────────────────────────────────────────────────────────────

  safeHandle('admin:isLinked', async ({ projectId } = {}) => {
    if (!projectId) {
      // Called pre-config (e.g. before any DB exists). Report not-linked.
      return { linked: false, path: null };
    }
    // Trigger legacy migration here so the first reachable IPC call
    // moves the old file into per-project subfolders without waiting
    // for an actual admin op.
    migrateLegacyServiceAccount();
    const resolved = resolveServiceAccountPath(projectId);
    return { linked: !!resolved, path: resolved };
  });

  safeHandle('admin:linkServiceAccount', async ({ projectId } = {}) => {
    const result = await dialog.showOpenDialog({
      title: projectId
        ? `Select service-account JSON for project "${projectId}"`
        : 'Select your Firebase service-account JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      const err = new Error('No file selected');
      err.code = 'CANCELLED';
      throw err;
    }
    const sourcePath = result.filePaths[0];

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    } catch (e) {
      const err = new Error(`File is not valid JSON: ${e.message}`);
      err.code = 'BAD_FILE';
      throw err;
    }
    if (!parsed.type || parsed.type !== 'service_account' || !parsed.project_id || !parsed.private_key) {
      const err = new Error(
        'Selected file does not look like a Firebase service-account JSON ' +
        '(missing type / project_id / private_key fields).',
      );
      err.code = 'BAD_FILE';
      throw err;
    }

    // If projectId was provided, require it to match. Otherwise the file's
    // own project_id determines where it lands — useful during the
    // first-time wizard before the active config is fully wired up.
    if (projectId && parsed.project_id !== projectId) {
      const err = new Error(
        `Selected service account is for project "${parsed.project_id}" ` +
        `but the active database is "${projectId}". Pick the matching file.`,
      );
      err.code = 'PROJECT_MISMATCH';
      throw err;
    }

    const targetProjectId = parsed.project_id;
    const targetDir = projectDir(targetProjectId);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = projectServiceAccountPath(targetProjectId);
    fs.copyFileSync(sourcePath, targetPath);

    // Drop any cached admin app for this project so subsequent calls
    // pick up the new credential. firebase-admin requires .delete()
    // before reinitializing under the same name.
    const existing = adminApps.get(targetProjectId);
    if (existing) {
      try { await existing.delete(); } catch { /* best-effort */ }
      adminApps.delete(targetProjectId);
      serviceAccountPaths.delete(targetProjectId);
    }

    // Eagerly load + validate.
    loadAdminSdk(targetProjectId);
    return { path: targetPath, projectId: targetProjectId };
  });

  // ── First-time bootstrap ───────────────────────────────────────────────

  /**
   * Phase 3.6 — single-call bootstrap that creates the super-admin's Auth
   * account AND grants the super_admin claim, all in-app via the Admin SDK.
   * Replaces the old "create user in Firebase Console first, then come back
   * with the UID" two-step. Console only needs to be opened to create the
   * Firebase project itself — user creation no longer requires it.
   *
   * Refuses to run if any super_admin already exists in the project, to
   * stop someone with a pirated service-account JSON from minting fresh
   * super-admins post-hoc.
   */
  safeHandle('admin:bootstrapSuperAdminAccount', async ({ projectId, email, password, displayName } = {}) => {
    if (!email || !password) {
      const err = new Error('email and password are required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = loadAdminSdk(projectId);
    const auth = adminApp.auth();
    const db = adminApp.firestore();

    // Bail if a super_admin already exists.
    const list = await auth.listUsers(1000);
    const existingSuperAdmin = list.users.find((u) => u.customClaims && u.customClaims.role === 'super_admin');
    if (existingSuperAdmin) {
      const err = new Error(
        `A super_admin already exists in this project (${existingSuperAdmin.email || existingSuperAdmin.uid}). ` +
        'Sign in as them and use the Super Admin tab to manage other accounts.',
      );
      err.code = 'ALREADY_BOOTSTRAPPED';
      throw err;
    }

    // Re-use the user if one with that email already exists (e.g. they
    // created it manually in Console before running the wizard); else
    // create. Either way we stamp the super_admin claim onto it.
    let uid;
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') {
        const created = await auth.createUser({
          email,
          password,
          displayName: displayName || undefined,
          emailVerified: false,
          disabled: false,
        });
        uid = created.uid;
      } else {
        throw e;
      }
    }

    await auth.setCustomUserClaims(uid, { role: 'super_admin' });
    await db.collection('users').doc(uid).set({
      email,
      displayName: displayName || null,
      role: 'super_admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { uid, email, role: 'super_admin' };
  });

  safeHandle('admin:bootstrapFirstSuperAdmin', async ({ projectId, uid } = {}) => {
    if (!uid) {
      const err = new Error('uid is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = loadAdminSdk(projectId);
    const auth = adminApp.auth();
    const db = adminApp.firestore();

    const list = await auth.listUsers(1000);
    const existingSuperAdmin = list.users.find((u) => u.customClaims && u.customClaims.role === 'super_admin');
    if (existingSuperAdmin && existingSuperAdmin.uid !== uid) {
      const err = new Error(
        `A super_admin already exists in this project (${existingSuperAdmin.email || existingSuperAdmin.uid}). ` +
        'Use the Super Admin tab to manage roles instead.',
      );
      err.code = 'ALREADY_BOOTSTRAPPED';
      throw err;
    }

    const user = await auth.getUser(uid);
    await auth.setCustomUserClaims(uid, { role: 'super_admin' });
    await db.collection('users').doc(uid).set({
      email: user.email || null,
      displayName: user.displayName || null,
      role: 'super_admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { uid, email: user.email || null, role: 'super_admin' };
  });

  // ── Users management ───────────────────────────────────────────────────

  safeHandle('admin:listUsers', async ({ projectId, idToken } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    const adminApp = adminApps.get(projectId);
    const auth = adminApp.auth();
    const db = adminApp.firestore();
    const list = await auth.listUsers(1000);
    const docsSnap = await db.collection('users').get();
    const docs = new Map();
    for (const d of docsSnap.docs) docs.set(d.id, d.data());
    return list.users.map((u) => {
      const userDoc = docs.get(u.uid) || {};
      return {
        uid: u.uid,
        email: u.email || null,
        displayName: u.displayName || null,
        disabled: !!u.disabled,
        emailVerified: !!u.emailVerified,
        createdAt: u.metadata.creationTime || null,
        lastSignInAt: u.metadata.lastSignInTime || null,
        role: (u.customClaims && u.customClaims.role) || userDoc.role || null,
        companies: (u.customClaims && u.customClaims.companies) || userDoc.companies || [],
        tabPerms: userDoc.tabPerms || null,
      };
    });
  });

  safeHandle('admin:createUser', async ({ projectId, idToken, email, password, role, companies = [], displayName, tabPerms } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    if (!email || !password || !role) {
      const err = new Error('email, password, and role are required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    if (!['super_admin', 'admin', 'supervisor'].includes(role)) {
      const err = new Error(`Invalid role: ${role}`);
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    const auth = adminApp.auth();
    const db = adminApp.firestore();
    const created = await auth.createUser({
      email,
      password,
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false,
    });
    const claims = role === 'supervisor'
      ? { role, companies: Array.isArray(companies) ? companies : [] }
      : { role };
    await auth.setCustomUserClaims(created.uid, claims);
    const userDoc = {
      email,
      displayName: displayName || null,
      role,
      ...(role === 'supervisor' ? { companies: claims.companies } : {}),
      ...(tabPerms ? { tabPerms } : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('users').doc(created.uid).set(userDoc, { merge: true });
    return {
      uid: created.uid,
      email: created.email,
      role,
      companies: claims.companies || [],
      tabPerms: tabPerms || null,
    };
  });

  safeHandle('admin:setUserRole', async ({ projectId, idToken, uid, role, companies = [], tabPerms } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    if (!uid || !role) {
      const err = new Error('uid and role are required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    if (!['super_admin', 'admin', 'supervisor'].includes(role)) {
      const err = new Error(`Invalid role: ${role}`);
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    const auth = adminApp.auth();
    const db = adminApp.firestore();
    const claims = role === 'supervisor'
      ? { role, companies: Array.isArray(companies) ? companies : [] }
      : { role };
    await auth.setCustomUserClaims(uid, claims);
    const docPatch = {
      role,
      ...(role === 'supervisor'
        ? { companies: claims.companies }
        : { companies: admin.firestore.FieldValue.delete() }),
      // tabPerms: explicit null clears, undefined leaves alone.
      ...(tabPerms === null
        ? { tabPerms: admin.firestore.FieldValue.delete() }
        : tabPerms !== undefined
          ? { tabPerms }
          : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('users').doc(uid).set(docPatch, { merge: true });
    await auth.revokeRefreshTokens(uid);
    return { uid, role, companies: claims.companies || [], tabPerms: tabPerms ?? null };
  });

  safeHandle('admin:disableUser', async ({ projectId, idToken, uid } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    if (!uid) {
      const err = new Error('uid is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    await adminApp.auth().updateUser(uid, { disabled: true });
    await adminApp.auth().revokeRefreshTokens(uid);
    return { uid, disabled: true };
  });

  safeHandle('admin:enableUser', async ({ projectId, idToken, uid } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    if (!uid) {
      const err = new Error('uid is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    await adminApp.auth().updateUser(uid, { disabled: false });
    return { uid, disabled: false };
  });

  safeHandle('admin:resetPassword', async ({ projectId, idToken, uid } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    if (!uid) {
      const err = new Error('uid is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    const tempPassword = generateTempPassword();
    await adminApp.auth().updateUser(uid, { password: tempPassword });
    await adminApp.auth().revokeRefreshTokens(uid);
    return { uid, tempPassword };
  });

  safeHandle('admin:deleteUser', async ({ projectId, idToken, uid } = {}) => {
    const decoded = await requireSuperAdmin(projectId, idToken);
    if (!uid) {
      const err = new Error('uid is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    if (decoded.uid === uid) {
      const err = new Error('Cannot delete your own account from inside the app');
      err.code = 'SELF_DELETE';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    await adminApp.auth().deleteUser(uid);
    try { await adminApp.firestore().collection('users').doc(uid).delete(); } catch { /* non-fatal */ }
    return { uid, deleted: true };
  });

  // ── Database cleanup ───────────────────────────────────────────────────

  safeHandle('admin:purgeAuditOlderThan', async ({ projectId, idToken, ts } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    if (typeof ts !== 'number' || !isFinite(ts)) {
      const err = new Error('ts (millisecond epoch) is required');
      err.code = 'BAD_INPUT';
      throw err;
    }
    const adminApp = adminApps.get(projectId);
    const db = adminApp.firestore();
    let deleted = 0;
    while (true) {
      const snap = await db.collection('audit').where('ts', '<', ts).limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 500) break;
    }
    return { deleted };
  });

  safeHandle('admin:auditStats', async ({ projectId, idToken } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    const adminApp = adminApps.get(projectId);
    const db = adminApp.firestore();
    const total = await db.collection('audit').count().get();
    const oldestSnap = await db.collection('audit').orderBy('ts', 'asc').limit(1).get();
    const oldest = oldestSnap.empty ? null : (oldestSnap.docs[0].data().ts || null);
    return { total: total.data().count, oldestTs: oldest };
  });

  // ── Cloud Monitoring quota dashboard (v4.2) ────────────────────────────
  //
  // Pulls live Firestore usage from Cloud Monitoring so the super-admin can
  // see how close the project is to the Spark plan's daily quota limits
  // BEFORE users start hitting "quota exhausted" errors. Reads daily totals
  // for document reads / writes / deletes from the time-series API.
  //
  // Spark plan free tier (current as of 2026-05):
  //   - 50,000 reads / day
  //   - 20,000 writes / day
  //   - 20,000 deletes / day
  //
  // Auth: the service-account JSON the user already linked has Editor role
  // on the GCP project by default (Firebase Console grants that), which
  // includes monitoring.viewer. No extra setup needed in 99% of cases. If
  // the API is disabled or permissions are missing, we surface that as a
  // clean error instead of a stack trace.
  //
  // Cost: Cloud Monitoring API has its own free tier independent of Spark/
  // Blaze. Polling every minute from one device costs effectively nothing.

  // Thin in-process cache so multiple panel renders / polls within 30s
  // don't hammer the API. Keyed by projectId.
  const quotaCache = new Map(); // projectId → { ts, payload }
  const QUOTA_CACHE_TTL_MS = 30_000;

  const QUOTA_METRICS = [
    { key: 'reads',   metric: 'firestore.googleapis.com/document/read_count',   limit: 50_000 },
    { key: 'writes',  metric: 'firestore.googleapis.com/document/write_count',  limit: 20_000 },
    { key: 'deletes', metric: 'firestore.googleapis.com/document/delete_count', limit: 20_000 },
  ];

  async function fetchQuotaUsage(projectId) {
    // Reuse the same service-account JSON the rest of the bridge uses. We
    // read it again here (instead of going through the firebase-admin
    // credential) so we can scope the OAuth token explicitly to
    // monitoring.read.
    const saPath = serviceAccountPaths.get(projectId);
    if (!saPath) {
      const err = new Error(`Service account not loaded for project "${projectId}"`);
      err.code = 'NOT_LINKED';
      throw err;
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    } catch (e) {
      const err = new Error(`Failed to read service account: ${e.message}`);
      err.code = 'BAD_FILE';
      throw err;
    }

    let GoogleAuth;
    try {
      ({ GoogleAuth } = require('google-auth-library'));
    } catch (e) {
      const err = new Error('google-auth-library is missing from this build');
      err.code = 'SDK_MISSING';
      throw err;
    }

    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/monitoring.read'],
    });
    const client = await auth.getClient();

    // Daily window. We use the last 24h instead of midnight-to-now because
    // (a) the actual quota window is midnight Pacific and translating to
    // the user's local time gets fiddly, and (b) the panel updates so
    // frequently that the current rolling-24h is more useful than the
    // calendar-day count anyway. The Cloud Monitoring API expects RFC3339.
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const out = {};
    for (const m of QUOTA_METRICS) {
      const params = new URLSearchParams({
        filter: `metric.type="${m.metric}"`,
        'interval.endTime': endTime,
        'interval.startTime': startTime,
        'aggregation.perSeriesAligner': 'ALIGN_SUM',
        'aggregation.alignmentPeriod': '86400s',
        'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      });
      const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params.toString()}`;
      try {
        const res = await client.request({ url });
        let total = 0;
        for (const series of (res.data && res.data.timeSeries) || []) {
          for (const pt of series.points || []) {
            const v = pt.value || {};
            // int64Value comes back as a string for safety; coerce.
            total += Number(v.int64Value ?? v.doubleValue ?? 0);
          }
        }
        out[m.key] = { used: total, limit: m.limit };
      } catch (e) {
        // Expected failure modes:
        //   - Cloud Monitoring API not enabled on the project (PERMISSION_DENIED)
        //   - Service account missing monitoring.viewer (PERMISSION_DENIED)
        //   - Network blip / Google outage (5xx)
        // Surface as a per-metric error so the panel can show a partial result.
        const code = (e && e.response && e.response.status) || (e && e.code) || 'UNKNOWN';
        const message = (e && e.response && e.response.data && e.response.data.error && e.response.data.error.message)
          || (e && e.message)
          || 'Cloud Monitoring API call failed';
        out[m.key] = { used: null, limit: m.limit, error: { code: String(code), message } };
      }
    }
    return out;
  }

  safeHandle('admin:quotaUsage', async ({ projectId, idToken, force } = {}) => {
    await requireSuperAdmin(projectId, idToken);
    const cached = quotaCache.get(projectId);
    if (!force && cached && (Date.now() - cached.ts < QUOTA_CACHE_TTL_MS)) {
      return { ...cached.payload, fetchedAt: cached.ts, cached: true };
    }
    const payload = await fetchQuotaUsage(projectId);
    const fetchedAt = Date.now();
    quotaCache.set(projectId, { ts: fetchedAt, payload });
    return { ...payload, fetchedAt, cached: false };
  });

  // ── Factory reset (Phase 3.6) ──────────────────────────────────────────

  /**
   * Removes every locally-stored secret + cache: all service-account JSONs,
   * all Firebase IndexedDB caches, all local-data JSON files. Renderer-side
   * factoryReset clears localStorage in tandem. After this returns, the
   * renderer reloads and the app boots in a true clean-slate state — no
   * mode picked, no databases saved, no signed-in session.
   *
   * Does NOT touch the Firebase project itself (data, auth users, rules,
   * indexes). Those persist server-side and only the super-admin can
   * touch them via the Firebase Console or the Admin SDK on a re-linked
   * machine.
   */
  safeHandle('admin:wipeLocalSecrets', async () => {
    // Drop all cached admin apps so subsequent calls re-init from scratch.
    for (const [, app] of adminApps) {
      try { await app.delete(); } catch { /* best-effort */ }
    }
    adminApps.clear();
    serviceAccountPaths.clear();

    const root = adminRoot();
    const removed = [];
    if (fs.existsSync(root)) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        removed.push(root);
      } catch (e) {
        console.warn('[admin-bridge] failed to remove firebase-admin folder:', e.message);
      }
    }
    return { removed };
  });
}

module.exports = { registerAdminIpc };
