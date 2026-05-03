# Changelog

All notable changes to **Iraqi Labor Scheduler** are listed here. Versioning follows [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH); each release tag (`vX.Y.Z`) on GitHub triggers a build that publishes the signed-by-hash Windows installer plus `SHA256SUMS.txt` to the matching GitHub Release.

## v5.1.6 — 2026-05-03

**CI hotfix.** v5.1.5's release build failed with `ECONNRESET` during `npm install` on the GitHub Actions runner — a transient registry blip that left the workflow with no fallback. v5.1.6 hardens the release pipeline so a single network hiccup can't kill the build.

**Changes** ([`.github/workflows/release.yml`](.github/workflows/release.yml))
- **npm cache enabled** via `actions/setup-node@v4`'s built-in `cache: 'npm'`. Restores `~/.npm` keyed on `package-lock.json` — saves 60–90s of fresh re-downloads per run AND mostly side-steps registry availability blips because warm cache hits don't go to network.
- **`npm install` → `npm ci`**, with `--prefer-offline --no-audit --no-fund` for speed. Lockfile-exact, deterministic, ~2× faster than the resolution-path install. `--legacy-peer-deps` stays for now because the dep tree has a known peer conflict between firebase and firebase-admin's transitive types; removing it is a separate migration.
- **Retry wrapper** around the install step: PowerShell loop, up to 3 attempts with exponential backoff (10s / 20s). Pre-v5.1.6, one ECONNRESET aborted the whole release.
- **Tests now run on CI** before the build (`npm test`). Pre-v5.1.6 the workflow only ran `tsc --noEmit` (the `lint` script); a regression that compiled but failed at runtime could still ship to release. Vitest uses no network so doesn't need the retry wrapper.

**Recovery for v5.1.5**
- The v5.1.5 tag is already pushed. Re-running the failed workflow from the GitHub Actions UI ("Re-run all jobs" on the failed run) will use the same tag with the new workflow file from main, producing the v5.1.5 installer with the hardened pipeline.
- v5.1.6's tag will produce a separate installer with the version stamp updated, in case you'd rather skip past v5.1.5 entirely.

## v5.1.5 — 2026-05-03

**Patch follow-up to v5.1.4.** Dependency-vulnerability triage. Production audit went from 14 → 11 vulnerabilities by retiring the DOMPurify XSS chain via `jspdf` upgrade. The remaining 11 are in the firebase-admin transitive dep tree and are not exploitable in our use; rationale documented below for future audits.

**jspdf 2.5 → 4.2 + jspdf-autotable 3.8 → 5.0** ([`package.json`](package.json))
- Kills the entire DOMPurify XSS / prototype-pollution / FORBID_TAGS-bypass chain (7 advisories) that fed through `jspdf > dompurify`.
- Our usage in [`pdfReport.ts`](src/lib/pdfReport.ts) and [`WorkforcePlanningTab.tsx`](src/tabs/WorkforcePlanningTab.tsx) only feeds structured table data through `autoTable` — no user-controlled HTML — so the XSS vectors weren't actually reachable in our code path. Upgrading is hardening rather than a fix for an exploit, but it removes the audit noise.
- API stayed compatible: `import jsPDF from 'jspdf'` (default), `const { jsPDF } = await import('jspdf')` (dynamic), `import autoTable from 'jspdf-autotable'` (default v5 ESM) all work without code changes. `tsc --noEmit` clean, all 179 tests pass.

**Remaining 11 production-tree vulnerabilities — accepted, rationale**

These are all in the `firebase-admin` transitive dep chain. They cannot be fixed without downgrading `firebase-admin` to v10 (current is v13), which would lose the Auth + Firestore + SecurityRules features the app depends on. The `npm audit fix --force` recommendation would silently break the app.

| Advisory | Package | Where | Why not exploitable in our use |
|---|---|---|---|
| GHSA-vpq2-c234-7xj6 | `@tootallnate/once` | `firebase-admin > @google-cloud/storage > teeny-request > http-proxy-agent` | Incorrect control-flow scoping in proxy-agent. We do not configure HTTP proxies for the Admin SDK — service-account → Firestore traffic goes direct. No untrusted input reaches the proxy code path. |
| GHSA-w5hq-g745-h8pq | `uuid` (v3/v5/v6) | `firebase-admin`, `gaxios`, `google-gax`, `teeny-request`, `exceljs` (transitive) | Missing buffer bounds check **only** when callers pass a custom `buf` parameter to v3/v5/v6 generators. None of our consumers do — they call the simple `uuid.v4()` form which is unaffected. We never call `uuid` directly. |

When `firebase-admin` upstream releases a version that bumps these transitive deps, we'll re-audit and pick it up. Tracked here so future triage doesn't have to re-derive the rationale.

## v5.1.4 — 2026-05-03

**Patch follow-up to v5.1.3.** v5.1.3 changed `firestore.rules` to allow manager + supervisor to edit the operating-window subsection of the Variables tab — but the rule change only takes effect after `firebase deploy --only firestore:rules` runs against the project. Anyone installing the app on a fresh Firebase project would either have no rules (locked-down default) or stale rules from earlier installs. v5.1.4 wires the deploy into the setup flow so fresh installs land with a working rule set out of the box, plus adds an in-app re-sync button for ongoing rule updates.

**Bundled rules + auto-deploy on bootstrap** ([`package.json`](package.json), [`admin-bridge.cjs`](electron/admin-bridge.cjs), [`SuperAdminWizard.tsx`](src/components/Onboarding/SuperAdminWizard.tsx))
- `electron-builder` now includes `firestore.rules` in the installer (`build.files`). The main process resolves it via `app.getAppPath()` so dev mode (repo root) and packaged mode (resources path) both work.
- New `_deployRulesToProject(projectId)` helper in admin-bridge reads the bundled file and calls `admin.securityRules().releaseFirestoreRulesetFromSource(source)` — one round-trip that creates a new ruleset AND releases it as the active Firestore ruleset.
- `bootstrapSuperAdminAccount` now auto-deploys at the end of the first-time setup wizard. Failure is non-fatal — the super-admin account is still created and the user gets an explicit "rules deploy failed, retry from Super Admin → Database" notice. Success surfaces the new ruleset name in the wizard's confirmation card.

**Manual re-sync from Super Admin → Database** ([`DatabasePanel.tsx`](src/components/SuperAdmin/DatabasePanel.tsx))
- New "Sync rules" button pushes the bundled rules to the active project. Use case: app upgraded with new bundled rules (e.g. v5.1.3 added the operating-window carve-out). Without the sync, manager / supervisor edits hit `permission-denied` even though the renderer accepts the input.
- Surfaces the new ruleset name + create-time + bytes after a successful deploy. Failures call out the most common cause (service account missing the Firebase Rules Admin role) with a deep-link to Cloud Console IAM.
- New `admin:deployFirestoreRules({projectId, idToken})` IPC handler exposes `_deployRulesToProject` to authenticated super-admins. Same code path as the bootstrap auto-deploy; both produce identical rulesets.

**CLI script for scripted environments** ([`scripts/deploy-firestore-rules.cjs`](scripts/deploy-firestore-rules.cjs))
- `npm run deploy-rules` runs the same deploy from a Node script using the locally-stored service-account JSON. Useful for CI / CLI-only super-admins / cases where you don't want to launch the Electron app just to push a rules update.
- Same source of truth (`firestore.rules`) as the in-app paths, so all three deploy methods produce identical rulesets.

**Compatibility**
- All 179 tests pass. `tsc --noEmit` clean. Secret-leak audit clean.
- Existing installs unaffected — the auto-deploy runs only at first super-admin bootstrap. Existing super-admins who upgrade the app should run **Super Admin → Database → Sync rules** once after the upgrade if the release notes mention a rules change.
- New permission required: the linked service account needs `roles/firebaserules.admin` (or the broader Firebase Admin SDK service-account role, which includes it). Default Firebase setup grants this.

## v5.1.3 — 2026-05-03

**Patch follow-up to v5.1.2.** v5.1.1 made the Variables tab super-admin-only edit to lock down governance config. End-to-end testing surfaced one carve-out: the **operating-window subsection** (default open / close + per-day overrides) is operational, not governance — manager and supervisor own day-to-day business hours. v5.1.3 splits the Variables tab into two write-gates: governance stays super-admin-only; operating window is editable by supervisor + manager + super-admin. Admin remains read-only on operating window (consistent with the v5.1.1 monitor-only-on-operations stance).

**Renderer-side gate** ([`VariablesTab.tsx`](src/components/VariablesTab.tsx), [`App.tsx`](src/App.tsx))
- New `operatingWindowReadOnly` prop on `VariablesTab`. When falsy, the open/close time inputs + per-day override row controls accept edits even if the rest of the tab is `readOnly`.
- App.tsx passes `operatingWindowReadOnly={role === 'admin'}` so admin alone is locked out — every other authenticated role (super_admin, manager, supervisor) can edit the operating window.
- Read-only banner copy now distinguishes between "everything is read-only" (admin) and "governance is read-only but operating window is editable below" (manager + supervisor).
- Supervisor's tab-access defaults gain `variables: 'read'` so the tab actually appears in the sidebar; the per-section gates inside the tab handle the editability.

**Firestore rule update** ([`firestore.rules`](firestore.rules))
- Adds an `operatingWindowKeys()` function listing the three fields manager + supervisor are allowed to mutate inside the config doc: `shopOpeningTime`, `shopClosingTime`, `operatingHoursByDayOfWeek`.
- New `configWriteAllowed()` helper: super-admin + admin pass through unconditionally; manager + supervisor pass only when `request.resource.data.value.diff(resource.data.value).affectedKeys().hasOnly(operatingWindowKeys())`. Governance fields stay admin-only because any write touching them fails `hasOnly()`.
- Rule deploy required: `firebase deploy --only firestore:rules`. Without the deploy, manager + supervisor edits will hit `permission-denied` on the Firestore write even though the renderer accepts the input.

**Compatibility**
- All 179 tests pass. `tsc --noEmit` clean. Secret-leak audit clean.
- No data migration. The Config doc shape is unchanged; only the rule that gates writes to it gets more granular.
- No Firestore index change.

## v5.1.2 — 2026-05-03

**Hotfix on top of v5.1.1.** Real-world repro of "the dashboard force-pulls me back to April": active-month navigation (year / month / daysInMonth) was being persisted in the per-company Firestore Config doc, which is admin-write-only per the security rules. When a supervisor or manager clicked next-month, their write was rejected silently, then the config listener re-fired with the server-side stale month and reset their visible month back. v5.1.2 separates UI navigation from governance config in both directions.

**Active-month navigation is now per-user** ([`firestoreDomains.ts`](src/lib/firestoreDomains.ts), [`App.tsx`](src/App.tsx))
- `syncConfig` now strips `year` / `month` / `daysInMonth` from the push. The Firestore config doc represents shared governance (caps, Ramadan window, weekend policy) and shouldn't be mutated by a month-picker click.
- The `subscribeConfig` callback in App.tsx merges server governance fields with the local UI nav — `year` / `month` / `daysInMonth` always come from local state. Each user's session navigates independently of what other users have on screen.
- Net effect: supervisor / manager / admin can now all freely navigate to any month (including future months with no schedule yet) without being yanked back. The bug only ever affected non-admin roles because admins had write permission and weren't fighting their own listener; the symmetric fix means even admins won't get a "snap back" if their click loses a race against a concurrent governance write.

**Compatibility**
- All 179 tests pass. `tsc --noEmit` clean.
- No data migration needed. Existing Firestore Config docs retain `year` / `month` / `daysInMonth` from pre-v5.1.2 writes; they're harmless but will gradually be dropped on the next admin governance edit (the new `syncConfig` push omits them).
- No Firestore index change.

## v5.1.1 — 2026-05-03

**Patch follow-up to v5.1.0.** End-to-end testing surfaced six issues at the boundary between role permissions, governance config, and the workflow UX. Fixes: (1) admin tier is now strictly monitor-only on schedule cells, (2) manager can submit on behalf of an absent supervisor, (3) Holidays + Legal Variables tabs are super-admin-only edit (governance config), (4) reopen modal makes the textarea-focus + disabled-state obvious, (5) snapshot-load failures surface their actual error reason, (6) the sidebar always shows the signed-in user's name + position + role.

**Strict admin monitor-only + manager submit-on-behalf** ([`scheduleApproval.ts`](src/lib/scheduleApproval.ts))
- v5.0.2's matrix had `canEditCells = (status === 'draft' || status === 'rejected')` for every authenticated role. In practice this let admins paint cells AND run the auto-scheduler in draft state, silently rewriting `entries` and side-stepping the workflow they're supposed to be reviewing. v5.1.1 adds a role gate: admins are `canEditCells: false` regardless of state. They monitor, send back, save, and reopen — they don't author schedules.
- Auto-scheduler button in [`App.tsx`](src/App.tsx) is now gated on `activeMonthCanEdit` with a role-aware disabled-reason ("Admins are monitor-only on cells. Auto-schedule has to be run by a supervisor or manager.") so the disabled state isn't a mystery.
- Manager gains `submit` action so the chain doesn't grind to a halt when the supervisor is out (sick day / vacation). The manager fills in the schedule and submits on the supervisor's behalf; the audit log records the manager as the submitter, and the lock step is still a separate manager action so the dual-eyes gate isn't lost.
- Valid-transition matrix sanity count moved from 14 → 16 (+2 for manager-submit on draft / rejected). 56 tests in [`scheduleApproval.test.ts`](src/lib/__tests__/scheduleApproval.test.ts) including new coverage of admin-cannot-edit-in-draft / admin-cannot-edit-in-rejected / manager-can-edit-and-submit.

**Holidays + Variables tabs: super-admin-only edit** ([`tabAccess.ts`](src/lib/tabAccess.ts))
- Both are per-company governance config (Iraqi Labor Law caps, Ramadan window, public-holiday calendar). Editing them changes the rules every other role plays under. Pre-v5.1.1 admin could edit holidays + supervisor could too, which let operational users alter governance silently.
- Defaults updated:
  - admin: `holidays: 'full' → 'read'`, `variables: 'read'` (already was).
  - supervisor: `holidays: 'full' → 'read'`, no variables tab by default.
  - manager: unchanged (already read).
  - super_admin: unchanged (full edit).
- `GRANTABLE_TABS` defaults updated to match, so the per-user permissions UI starts from the new safer baseline. Super-admin can still grant `'full'` per user when a delegate genuinely needs to edit them.

**Reopen modal UX** ([`ApprovalActionModals.tsx`](src/components/Schedule/ApprovalActionModals.tsx))
- Auto-focuses the reason textarea when the modal opens. Pre-v5.1.1 a user who saw the warning text + a disabled-looking confirm button thought the action was blocked; in fact they just hadn't typed a reason yet.
- Disabled-state hint is now red (textarea border + helper paragraph) when below the minimum char count, with copy "Type at least 1 character of reason to enable Reopen. N more to go." Pre-v5.1.1 the hint was a small grey paragraph users skimmed past.
- Recent-export tier copy softened from "your downstream system has an out-of-date version" (read as a hard error) to "remember to re-export after re-saving so HRIS has the new official version" (forward-looking reminder).

**Snapshot load error surfaces the actual reason** ([`App.tsx`](src/App.tsx))
- `getLatestSnapshot` failures previously rendered as "Failed to load the archived snapshot for the diff view. Refresh and try again." with no clue what went wrong. v5.1.1 inspects the Firestore error code and shows: "Permission denied reading /snapshots/. If your role was changed recently, sign out and sign back in to refresh the token, then try again." for `permission-denied` (the most common cause — newly-created admins / managers whose token claims haven't refreshed). Other errors show their `code: message` payload directly.

**Self-edit button label** ([`UsersPanel.tsx`](src/components/SuperAdmin/UsersPanel.tsx))
- The super-admin's own-row Edit form button used to read "Close" (because v5.0.2 made self-edit no-op-then-close). Now that self-edit actually persists `displayName` + `position`, the button reads "Save changes" in every mode — `'Saving…' | 'Create user' | 'Save changes'`.

**Identity badge in the sidebar** ([`App.tsx`](src/App.tsx))
- Adds a small card right below the brand header: avatar disc with the user's initial, displayName (or email fallback), position (when set), and a colour-coded role badge (purple = super_admin, blue = admin, orange = manager, emerald = supervisor). Always visible in Online mode so reviewers know "which voice" they're acting with before clicking Lock / Save / Send-back. Offline mode is single-user — identity is implicit, no badge.

**Compatibility**
- All 179 tests pass (4 new — admin-cannot-edit, manager-can-edit, manager-can-submit, sanity matrix update). `tsc --noEmit` clean. Secret-leak audit clean.
- No Firestore schema migration. The matrix changes are renderer-side; existing approval blocks read identically.
- No Firestore index change.

## v5.1.0 — 2026-05-03

**Minor version. Re-approval diff view + HRIS manual-bundle export.** v5.0 made the approval workflow real; v5.1 closes the two follow-on gaps that real-world payroll cycles need: (1) when a saved schedule is reopened and re-submitted, reviewers can now see exactly which cells changed since the last archived snapshot, instead of having to remember; and (2) when a schedule is finally saved, an admin can produce a single .zip handoff for HRIS import without leaving the app.

Both features are **Online-mode only** by design (the workflow itself is online-only, so the diff and the export inherit that gate). Offline Demo mode is unchanged.

**Re-approval diff view** ([`firestoreSchedules.ts`](src/lib/firestoreSchedules.ts), [`Primitives.tsx`](src/components/Primitives.tsx), [`ScheduleApprovalBanner.tsx`](src/components/Schedule/ScheduleApprovalBanner.tsx))
- New `getLatestSnapshot()` helper queries `/companies/{cid}/schedules/{yyyymm}/snapshots/` ordered by doc ID descending, limit 1. Doc IDs are millisecond timestamps so the highest-keyed doc is always the latest archive — no separate `orderBy` needed.
- New `diffScheduleVsSnapshot(current, snapshot)` returns a `Map<"empId:day", 'added' | 'modified' | 'removed'>`. **Station-only changes are intentionally suppressed** — visually the cell still shows the same shift code, so flagging it would be confusing noise. Empty `shiftCode` is treated as no-cell so a cleared-then-still-empty round-trip doesn't false-positive as removed.
- Banner renders a **"Show changes since last archive"** toggle when (a) a snapshot exists for the month OR (b) approval history contains a `reopen` action OR (c) `approval.savedAt` is set. The toggle lazy-loads the snapshot on first click; subsequent toggles flip the flag without re-fetching. Schedule cells get a 2px outline ring (emerald = added, amber = modified, rose = removed) with a legend below the action row.
- Banner body lines now prepend **"Resubmitted after a previous archive"** when the schedule is mid-re-approval, **"Reopened from a previous archive"** when status is `draft` post-reopen, and **"Re-saved after a previous archive"** when status is `saved` again. Reviewers know immediately whether they're looking at a fresh submission or a re-approval cycle.
- 10 new tests in [`scheduleDiff.test.ts`](src/lib/__tests__/scheduleDiff.test.ts) cover empty/empty, code-only-change vs station-only-change, added vs removed vs modified attribution, station-only suppression, the supervisor-cleared-then-blank round-trip, employees who only exist on one side, and the summary aggregator.

**HRIS manual-bundle export** ([`hrisBundle.ts`](src/lib/hrisBundle.ts), [`firestoreSchedules.ts`](src/lib/firestoreSchedules.ts), [`ScheduleApprovalBanner.tsx`](src/components/Schedule/ScheduleApprovalBanner.tsx))
- New `assembleHrisBundle()` produces a single `.zip` (`HRIS_<companyId>_<yyyymm>.zip`) with six files:
  - `manifest.json` — schema-versioned metadata + the **full approval lineage** (submitted / locked / saved actors with names, positions, timestamps, and reviewer notes; plus the complete `history[]` from the approval block). Bundle ID = `<yyyymm>-<ms>` so re-exports after a reopen → re-save cycle get a stable dedupe key.
  - `schedule.csv` — header `Employee ID, Name, Role, Department, Day 1 … Day N`, one row per employee. Same shape the existing `exportScheduleCSV` button produces, so HRIS importers that already parse it keep working.
  - `roster.csv` — employee master data (id, name, role, department, category, gender, contract type, weekly hours, salary, hire date, phone, notes).
  - `leaves.csv` — every leave range overlapping the active month (annual, sick, maternity), with a `Source` column distinguishing `explicit` (LeaveManagerModal entries) from `painted` (auto-derived from contiguous AL/SL/MAT cells) so downstream systems can tell them apart.
  - `compliance.json` — violations + info findings + heuristic score. The README clarifies that `info` severity = legitimate operational situation, `violation` = hard rule break — same distinction the schedule banner makes.
  - `README.txt` — plain-English walkthrough: bundle ID, company, month, generator identity, full approval lineage, file-by-file description, import-order recommendation, re-export semantics.
- jszip is **lazy-loaded** (12 KB gzipped) at the moment of export — same pattern as the jspdf report path — so the initial bundle stays small for users who never reach a saved schedule.
- Banner gains an **"Export HRIS bundle"** button that renders only in `saved` state for `admin` / `super_admin`. Wording switches to **"Re-export HRIS bundle"** when `hrisSync.lastExportedAt` is set, with a "last exported on …" hint underneath. Tooltip explains that re-export produces a fresh bundle ID.
- New `stampHrisExport()` writes `hrisSync.lastExportedAt` (server timestamp), `hrisSync.lastExportedBy`, `hrisSync.method = 'manual-bundle'` via field-path `updateDoc` so concurrent approval transitions can't trample each other (each writer touches a disjoint subobject). Stamp + audit run AFTER the user has the file in hand so a stamp-write failure can't make them think the export didn't happen.
- 8 new tests in [`hrisBundle.test.ts`](src/lib/__tests__/hrisBundle.test.ts) round-trip the bundle through JSZip's loader: zip is non-empty, the documented six files exist, manifest carries the full approval lineage with names + positions, schedule.csv has the right header + per-employee rows, leaves.csv flattens painted AL ranges with the correct source, compliance.json reports correct counts + score, CSV escaping survives commas + quotes.

**Compatibility**
- All 175 tests pass (15 new — 10 diff + 8 bundle, minus 3 absorbed/renamed). `tsc --noEmit` clean. Secret-leak audit clean (no AIzaSy keys, JSONs, .env, PEM markers).
- No Firestore schema migration. The diff view reads existing `/snapshots/{ts}` docs; the export reads existing `approval` + `schedule` data. The HRIS stamp adds a `hrisSync` subobject that's optional everywhere it's read.
- No Firestore index change. The snapshot query (`orderBy(__name__, 'desc')` + `limit(1)`) uses the auto-created `__name__` index.
- New dependency: `jszip ^3.10.1`. Tree-shaken into a separate dynamic import so it only loads on first export.

## v5.0.2 — 2026-05-03

**Patch follow-up to v5.0.0.** End-to-end testing surfaced four issues at the boundary between the v5.0 approval workflow and the multi-user identity it depends on. Fixes are deliberately conservative — same state machine, same Firestore doc shape, same modals. What changed is **who can do what**, **how actions are attributed**, and **what the user sees when something refuses to run**.

**Strict per-role permission matrix** ([`scheduleApproval.ts`](src/lib/scheduleApproval.ts))
- Pre-v5.0.2 the validator allowed admin to lock a submitted schedule and to send a submitted schedule back ("admin-as-fallback-manager" semantics). That blurred the two-tier review the workflow exists to enforce.
- v5.0.2 tightens to one role per action: **supervisor** submits only; **manager** locks or sends back to supervisor only; **admin** saves, sends back to manager, or reopens; **super-admin** can do all (audit log records the actor's true role).
- Test count update: valid transitions across the (state × action × role) matrix went from 16 → 14 (-1 for admin-can-lock, -1 for admin-can-reject-from-submitted).

**Manager role recognized end-to-end** ([`auth.tsx`](src/lib/auth.tsx), [`admin-bridge.cjs`](electron/admin-bridge.cjs))
- Pre-v5.0.2 bug: `auth.tsx` claim-hydration only checked `super_admin | admin | supervisor`, silently dropping `'manager'` to `null`. Combined with the role-null = offline-mode fallback, a real manager user was treated as "no auth, full access" — entirely outside the workflow.
- Bridge fix: `admin:createUser` and `admin:setUserRole` rejected `'manager'` with `BAD_INPUT`. Now use a shared `VALID_ROLES` allowlist that includes manager, plus a `SCOPED_ROLES` set so manager (like supervisor) gets `companies` written to its custom claims and to `/users/{uid}.companies`.

**Human identity on every approval action** ([`firestoreSchedules.ts`](src/lib/firestoreSchedules.ts), [`ScheduleApprovalBanner.tsx`](src/components/Schedule/ScheduleApprovalBanner.tsx), [`PendingApprovalsCard.tsx`](src/components/Schedule/PendingApprovalsCard.tsx), [`UsersPanel.tsx`](src/components/SuperAdmin/UsersPanel.tsx))
- Pre-v5.0.2 the banner read *"Submitted by k7BTzr… on 2026-04-12 14:08"* — a UID, no name, no role context.
- New `position` field on the user profile doc, set by the super-admin alongside `displayName` in the New User / Edit User form (now editable in **both** create and edit modes; retroactive fill-in supported for users created before v5.0.2). Self-edit still locks role / companies / tabPerms — name and position are the only self-editable fields, with both client-side and handler-side guards against tampered submissions.
- Public transition functions (`submitForApproval` / `lockSchedule` / `saveSchedule` / `sendBackToSupervisor` / `sendBackToManager` / `reopenSchedule`) now take a `TransitionActor { uid, email, role, name?, position? }` object instead of positional uid+email+role. Each transaction stamps `${prefix}ByName` and `${prefix}ByPosition` field-paths onto the `approval` block alongside the existing `${prefix}By` (UID). Pre-v5.0.2 records keep working — the UI degrades to UID when the name fields are absent.
- New shared formatter `formatApprovalActor(name, position, uid)` consumed by the banner, lock/save modals, pending-approvals queue, and history viewer. Format: `"Mohammed Al-Rashid · Floor Manager — Branch A"` when both fields are set; `"Mohammed Al-Rashid"` if position is empty; UID as last-resort fallback.
- Approval-history entries (`buildHistoryEntry`) capture `actorName` + `actorPosition` snapshot at action time so the audit trail keeps a stable identity even if the user is later renamed or repositioned.

**Cell-editing visual feedback in non-editable states** ([`Primitives.tsx`](src/components/Primitives.tsx), [`ScheduleTab.tsx`](src/tabs/ScheduleTab.tsx))
- `ScheduleCell` gains a `readOnly` prop. When the schedule is in `submitted` / `locked` / `saved` (or any non-draft state for an authenticated user), filled cells fade to 60% opacity, empty cells get a subtle slate background, the hover scale-up is skipped, and the cursor switches to `not-allowed` immediately. Pre-v5.0.2 the cells rendered identically to draft state — clicks did nothing because the handlers short-circuited, but users had no visual signal why.
- Paint mode now auto-clears when the grid transitions into a read-only state, so the painter banner can't sit "armed but inert".

**Quota panel: BILLING_REQUIRED setup path** ([`admin-bridge.cjs`](electron/admin-bridge.cjs), [`QuotaPanel.tsx`](src/components/SuperAdmin/QuotaPanel.tsx))
- Cloud Monitoring's `timeSeries` endpoint returns 403 with `reason: BILLING_DISABLED` on Firebase projects still on the Spark plan — billing has to be enabled (Blaze pay-as-you-go) before the API will respond, even though the metric read itself is free.
- Pre-v5.0.2 the bridge classified this as generic `FORBIDDEN`, so the quota panel surfaced a confusing IAM-role-missing card. Now there's a dedicated `BILLING_REQUIRED` cause with clear copy ("Live quota visibility requires the Blaze plan"), a deep-link to Firebase Console → Usage & Billing → Modify plan, and an explicit reassurance that Blaze stays free up to the same Spark caps.
- Approval-error handler also `console.error()`s the raw error now so failed transitions show their underlying Firestore / validator message in DevTools — useful for diagnosing user-reported "nothing happens" reports.

**Compatibility**
- All 157 tests pass. `tsc --noEmit` clean. Secret-leak audit clean (no real keys, JSONs, .env, or PEM markers in tracked history).
- No Firestore schema migration needed: every new field (`displayName`, `position`, `submittedByName`, `submittedByPosition`, etc.) is optional and pre-v5.0.2 docs render with the UID fallback. Existing users will see UIDs in their banner until the super-admin opens **Super Admin → Users → Edit** and fills in the name + position fields.
- No Firestore index change. Indexes from v5.0.1 still apply.

## v5.0.1 — 2026-05-03

**Operational follow-up to v5.0.0** — adds the missing Firestore field-override that lets the v5.0 manager + admin dashboard widgets actually run their `collectionGroup('schedules')` queries without a console error.

**Why this is needed**
- Firestore auto-creates single-field indexes only for `COLLECTION`-scope queries. Collection-group queries (the `useApprovalQueue` hook reads schedule docs across ALL companies in one query, scoped by `allowedCompanies` client-side) need the index declared explicitly.
- Without it, `where('approval.status', 'in', […])` against `collectionGroup('schedules')` returns a `FAILED_PRECONDITION` from Firestore with a helpful "create the index here" deep-link in the console — but the dashboard widgets just silently show "0 pending" until the link is clicked.

**What changed**
- [`firestore.indexes.json`](firestore.indexes.json) gains a `fieldOverrides` entry for `schedules` × `approval.status` covering both `COLLECTION` and `COLLECTION_GROUP` query scopes (ASCENDING + DESCENDING for COLLECTION so single-month subscribers can still order by status if they need to).

**To deploy**
```bash
firebase deploy --only firestore:indexes
```
Indexes apply globally per Firebase project. After deploy the manager and admin dashboards see live submitted/locked schedules across the user's `allowedCompanies` immediately. No app rebuild required — this is a Firebase-side config change.

**Compatibility**
- All 157 tests still pass. No code changes outside the indexes file + version stamps. Pre-deploy, the dashboard widgets simply show empty queues; post-deploy they populate live with no client-side change.

## v5.0.0 — 2026-05-03

**Major version. Schedule approval workflow + manager role.** v4 made the app multi-user via Firebase. v5 makes that multi-user reality safe by adding a strict two-tier validation chain on top of the schedule grid: supervisor builds → manager validates (locks) → admin finalizes (saves) → archived as the official record. Every step can EITHER proceed forward OR send the schedule back to the immediately-previous user — never skip a step. This forces every reviewer to see every change before it advances. The "saved" state is backed by an immutable snapshot doc in Firestore so the official version is preserved even if the live schedule is later reopened.

The whole feature is **Online-mode only** by design. Offline Demo mode is single-user, has no role hierarchy, and is preserved byte-identical to v4 — Offline users see no banner, no modals, no badge, and the schedule grid stays freely editable as before.

**New `manager` role**
- Sits between admin and supervisor in the role hierarchy. Companies-scoped via `allowedCompanies` claim like supervisor. Default tab perms: full on dashboard / schedule / coverageOT / reports / audit / settings; read on operational tabs; no access to User Management or Super Admin.
- Manager option is now in the User Management role dropdown with an orange role badge (between supervisor green and admin blue).
- New `isManager()` helper in `firestore.rules`; manager included in `hasCompany()` for read paths and in audit-log read access.

**Approval state machine**
- Five statuses: `draft` (supervisor editing) → `submitted` (awaiting manager) → `locked` (manager-validated, awaiting admin) → `saved` (admin-finalized, archived). Plus `rejected` as a sub-state of draft when a reviewer sends the schedule back; auto-clears on the supervisor's first edit.
- Seven valid transitions, every one validated by `isValidTransition(state, action, role)` and dispatched inside a Firestore `runTransaction` so the read-validate-write of `approval.status` is atomic. Catches "two managers approve at once" and "supervisor reopens while admin saves" races. Field-path writes only — never touches the `entries` map.
- Backward compatible: missing `approval` block reads as `'draft'`, so every pre-v5.0 schedule starts in the workflow's entry state.

**Read-only-while-pending**
- Schedule cells are editable only when `status === 'draft'`. In every other state the grid renders read-only for everyone, including managers and admins. This is what makes "send back" meaningful — a reviewer who wants changes can't stealth-edit; they send the schedule back with notes, and the previous user makes the changes transparently.
- Auto-scheduler, paint mode, drag-paint, range-fill, and per-cell undo are all gated on `canEditCells`. The Ctrl+Z keyboard handler still works but no-ops when the grid is read-only.

**UI surfaces**
- New top-of-grid `ScheduleApprovalBanner` colour-keyed to status (slate / amber / blue / emerald / rose). Always names the active month + company in bold so the user can never confuse which schedule they're acting on. Surfaces send-back notes from the previous reviewer when in `rejected` state.
- Five action modals (`SubmitForApproval`, `Lock`, `Save`, `SendBack`, `Reopen`) — each shows the month prominently as the title AND in the confirm button (*"Lock April 2026"*, *"Save April 2026 as final"*, *"Send April 2026 back to supervisor"*) to make accidental cross-month approvals harder. Lock and Save modals embed a compliance summary card (violations + info findings + score) so the reviewer sees what the supervisor saw. Send-back and Reopen require notes; Submit / Lock / Save make notes optional.
- Reopen modal applies tiered safeguards based on `hrisSync.lastExportedAt`: pre-export is a simple confirmation; recent-export warns the admin their HRIS may now hold an out-of-date version; old-export requires a 30-character minimum reason note and explicitly flags the audit entry as `"post-HRIS-export reopen"`.
- New dashboard cards: **Schedules awaiting your validation** (manager + admin + super-admin) and **Schedules awaiting your finalization** (admin + super-admin). Each lists pending items across the user's `allowedCompanies` with a Review button that jumps to the schedule's tab.
- Sidebar Schedule TabButton gains a numeric badge — count of items the user can act on (validation + finalization + own-rejected).

**Audit log**
- New domain `'scheduleApproval'` with seven entry kinds: submit, lock, save, send-back-to-supervisor, send-back-to-manager, reopen, hris-export. Each entry uses the existing AuditEntry shape (no schema change) — `targetId` carries the month key, `actorUid`/`actorEmail` cover "who", and the `summary` is human-readable for the audit log UI.

**Snapshot subcollection**
- Saving a schedule writes an immutable snapshot to `/companies/{cid}/schedules/{YYYY-MM}/snapshots/{savedAtMillis}`. Snapshot doc carries `entries` + the full submit/lock/save lineage. Firestore rules: anyone with company access can read; only admin/super-admin can create; updates and deletes are forbidden — snapshots are append-only history. Each save creates a new snapshot, so reopen → re-save leaves a chain.

**Concurrency safety**
- `runTransaction` on every transition catches concurrent state changes — e.g. two admins clicking Save in different tabs at the same time. The losing transaction throws "already saved by another user" and the modal surfaces it.
- One-line existing-code fix in [`firestoreSchedules.ts`](src/lib/firestoreSchedules.ts): the large-diff path now uses `setDoc(ref, {...}, { merge: true })` instead of plain `setDoc`. Pre-fix, a >200-cell auto-scheduler write would silently drop any `approval` / `hrisSync` blocks. Merging keeps cell-content writes orthogonal to approval-state writes.

**Per-month enforcement (explicit)**
- Bulk approval / multi-month batch transitions are out of scope. The Firestore transition functions take exactly one `(cid, monthKey)` pair. Modals always name a single month. Dashboard rows have per-row Review buttons. There is no "Approve all" anywhere.

**Unit tests**
- 49 new Vitest cases covering every (state × action × role) triple in the validator (~50 valid + invalid combos), `availableActionsFor`, `effectiveStatus`, `stampPrefixForAction`, and `buildHistoryEntry`. Total suite: 157 passing.

**Compatibility**
- All 108 pre-v5.0 tests still pass. No data-model changes — pre-v5.0 schedule docs (no `approval` field) read as `'draft'` and behave identically. Offline mode is byte-identical to v4.2.1.
- Firestore composite index required for the `collectionGroup('schedules')` × `approval.status` query that powers the manager / admin dashboards. Define in `firestore.indexes.json` and deploy alongside the rules.

**Deferred to v5.1+ (not in this release)**
- HRIS manual-bundle export (zip of schedule + roster + leaves + manifest with full approval lineage). The `hrisSync` field shape and the post-export reopen-tier safeguards are wired in; only the actual zip generator is deferred.
- Outbound webhook + per-HRIS connectors. v5.2+ if a customer asks.

## v4.2.1 — 2026-05-03

**Patch.** Three issues from real-install testing of v4.2.0.

**Quota panel — actionable setup-required state**
- Pre-v4.2.1 the panel showed three rows of *"unavailable · 403: Permission denied"* with no path forward. The default Firebase service-account role (`roles/firebase.sdkAdminServiceAgent`) doesn't include `monitoring.viewer`, and Cloud Monitoring API isn't always enabled on a fresh project — both produce a 403, but the fix is different. The bridge now classifies the 403's sub-cause from the structured API response (`SERVICE_DISABLED` vs `IAM_PERMISSION_DENIED`) and the panel renders one of two clear setup cards: a deep link to enable the API, or a deep link to IAM with the service-account email pre-displayed and a Copy button so the super-admin can paste it straight into the IAM filter, plus step-by-step instructions and a "Re-check" button that bypasses the 30 s cache.

**Self-protection in User Management**
- The super-admin can no longer disable, delete, or change the role/permissions of their *own* account from inside the app — locking yourself out of the system would leave no in-app recovery path. The own-row gets a *"You"* badge and a subtle blue tint; Disable + Delete buttons are visibly disabled with explanatory tooltips; the edit modal renders a banner *"You're editing your own account…"* and locks the role select. Reset Password and Edit Display Name remain allowed (those don't risk lock-out). To demote yourself, ask another super-admin or use the Firebase Console.

**Toolbar — tab-scoped actions instead of a persistent global banner**
- The four tab-specific buttons that used to live in the top toolbar across all tabs (*Export Schedule*, *Mass Import Personnel*, *CSV Template*, *Enter Simulation*) now live inside the tabs they actually belong to: import + template in the Roster tab header, export + simulation in the Schedule tab toolbar. The header now carries only truly global state — active-database chip, connection-status dot, and (when sim mode is active) an Exit Simulation pill so the supervisor can never get stuck in sandbox by navigating away from Schedule.

**Compatibility**
- All 108 tests pass. No data-model changes.

## v4.2.0 — 2026-05-03

**Online-mode integrity + super-admin observability.** v4.0 / v4.1 made Online mode work; v4.2 makes it *defensible* against the dual-source-of-truth concern a senior reviewer raised, and gives the super-admin a way to see Firebase quota usage live so they're never surprised by users hitting limits.

**Single source of truth in Online mode**
- Initial load now branches on mode. Online mode skips the unconditional `fetch('/api/data')` that pre-v4.2 ran on every boot — the local Express + JSON store is no longer a parallel source that briefly painted stale state before Firestore subscriptions overlaid it. Firestore is the only authoritative store; the local IndexedDB cache that's been part of `firestoreClient.ts` since v4.0 (`persistentLocalCache` + `persistentSingleTabManager`) handles outage resilience exactly as intended — reads served from cache when offline, writes queued locally and replayed on reconnect.
- Shutdown also branches: Online mode no longer flushes one last `/api/save` before closing, which would otherwise write a stale shadow copy of cloud data into the local JSON (and resurface as bogus state if the user later picked Offline mode on the same machine). Just `/api/shutdown` and close.
- Offline mode is byte-identical to v4.1 — Express + JSON remains the only store there, no behaviour change.

**Firestore-aware connection indicator**
- The toolbar dot in Online mode now reflects actual Firestore state (synced / syncing / offline-queued) instead of mirroring the Express auto-save state, which doesn't apply Online. New `useFirestoreSync()` hook subscribes to `onSnapshotsInSync` + `navigator.onLine` events. Amber means edits are queued locally and waiting for the connection to return; the queued writes will replay automatically.

**User-facing quota-exhausted message**
- When a Firestore write returns `resource-exhausted` (Spark plan daily quota hit), the affected user sees a friendly modal naming the next reset time in their local timezone instead of a cryptic SDK error: *"The database has reached today's free-tier quota. Please check back at … to resume your work. Your super-admin has been notified."* The detection is sticky for the rest of the session so an edit storm can't spam the modal.

**Super-admin Firestore quota dashboard**
- New **Super Admin → Firebase quota** panel pulls live usage (document reads / writes / deletes, rolling 24h) from Cloud Monitoring API v3 via the Admin SDK bridge — auth uses the linked service-account JSON's default `monitoring.viewer` permission, so no extra IAM setup. Auto-refreshes every 60 s with a manual *Refresh now* button; bridge has a 30 s in-process cache so multiple panel mounts don't multiply API calls. Per-metric progress bars colour-tier from green → blue → amber → rose so capacity is scannable at a glance. A separate banner surfaces the most recent local quota-exhausted detection (stamped to localStorage by App.tsx) — gives the super-admin retroactive visibility even before Cloud Monitoring's 3–5 minute metric lag catches up.
- Spark free-tier limits (50,000 reads, 20,000 writes, 20,000 deletes per day) are baked in as the comparison baselines. If a project upgrades to Blaze, replace the limits in `electron/admin-bridge.cjs` accordingly — the panel UI is generic.

**Compatibility**
- All 108 tests pass. No data-model changes. No new dependencies — Cloud Monitoring auth uses `google-auth-library`, which `firebase-admin` already pulls in.

## v4.1.0 — 2026-05-03

**Onboarding + admin polish.** v4.0.0 shipped the AIO wizard for first-time super-admins, but a returning super-admin reconnecting on a new PC went through the inline paste form, which only collected the `firebaseConfig` and dropped them at the SuperAdmin tab — where they hit *"Service account not linked"* because nothing on the journey had asked them to link one. v4.1.0 closes that gap and rounds out a handful of QoL items that turned up alongside it.

**Reconnect wizard for returning super-admins**
- `SuperAdminWizard` gains a `mode='reconnect'` variant. The Stepper drops the project-creation and account-creation steps (those already exist on the existing project) and walks through firebaseConfig paste + service-account link only. OnlineSetup's super-admin **"Connect to a database I already set up"** now launches this wizard instead of the inline paste form, so the link step is part of the path — no more deferring it to the SuperAdmin tab. The inline paste form is now reserved for admin/supervisor join via connection code (those roles don't need a service account).
- Step 1 of the reconnect wizard (paste firebaseConfig) leads with the recommended path — copy an `ils-connect:…` code from another PC's **Settings → Generate connection code** — and falls back to a Firebase Console deep link if the user prefers grabbing the values from Console directly.
- Step 2 (service account) and the SuperAdmin → Connection panel both deep-link to `console.firebase.google.com/project/<projectId>/settings/serviceaccounts/adminsdk` using the active project's id, so multi-database super-admins go straight to the right project's tab. The URL is computed inline at render time, so switching active database immediately points the link at the new project.

**Branded confirm dialogs across admin / settings UI**
- `useConfirm()` Promise hook added to `ConfirmModal.tsx`. Six native `window.confirm()` calls that v4.0 introduced — switch / remove / add database in Settings, remove saved DB in OnlineSetup, delete user, audit purge — now use the branded modal: dark mode, RTL, design-system motion, escape-to-close. Native `confirm()` couldn't render Arabic right-to-left or honor the dark theme, so this is a polish *and* i18n fix.

**Login + onboarding QoL**
- LoginScreen password input gains an eye / eye-off toggle. Useful when pasting a temp password from a manager or typing one with ambiguous chars (0/O, l/1) on a touch keyboard.
- Wizard Step 4 (super-admin account creation) — the auto-generated password gets a Copy button matching the existing TempPasswordModal pattern (2-second *Copied* state). Pre-fix, the user had to triple-click-select before clicking Create — and once Create fired, the password disappeared from screen.
- Wizard Step 2 — *"In Firebase Console: gear icon → Project settings → ..."* is now an actual clickable link to `console.firebase.google.com`, rather than just bold copy.
- UsersPanel "service account not linked" error fallback rewritten: was *"Connection panel above first"* (incorrect on User Management tab, where Connection isn't above), now points to **Super Admin → Connection** with the same deep link.

**Compatibility**
- All 108 tests pass. No data-model changes, no migration needed.

## v4.0.1 — 2026-04-30

**Hot fix.** v4.0.0 ModePicker gated the **Connect Online** button on `isFirebaseConfigured()` returning true — but a fresh install never has a config yet, so the button was permanently disabled and showed *"Firebase not configured · See .env.example"*. The whole AIO onboarding flow we just shipped (in-app wizard, paste connection code, etc.) was unreachable from the launch screen. Fixed by removing the gate: the button is always clickable, and `AppShell` already handles the no-config case by routing to OnlineSetup, which shows the role picker → wizard or paste form. No other changes.

## v4.0.0 — 2026-04-30

**Major version. Online mode + AIO management.** v3 hardened the offline product; v4 adds an opt-in cloud mode for teams. The single-user Offline Demo experience is preserved verbatim (no migration, no behavioural change). Online mode is multi-user, role-aware, and managed entirely from inside the app — no Firebase Console for routine work after first-time setup.

**Dual-mode architecture**
- New launch flow: **Offline Demo** (current local-first behavior) or **Connect Online**. The choice persists; switching prompts a reload from Settings. Express + JSON data layer stays in place for Offline mode as a permanent fallback.
- Online mode runs entirely on Firebase Spark (free) plan — no Cloud Functions, no Blaze, no credit card. Firestore + Auth handle data and identity; the Firebase Admin SDK loads in the Electron main process for super-admin operations that exceed client SDK reach.
- Every domain — companies, employees, shifts, stations, station groups, holidays, config, schedules, audit log — has dual-mode parity. The same UI reads from Firestore in Online and the local Express server in Offline; mutators dual-dispatch in `App.tsx`.

**AIO onboarding**
- First-time super-admin runs an in-app step-by-step wizard. Firebase Console is needed only for the Console-only steps (project creation, enabling Firestore + Auth) — `firebaseConfig` paste, service-account JSON link, super-admin Auth account creation and `super_admin` claim grant all happen inside the wizard via the Admin SDK bridge.
- Returning super-admin (different PC) gets a short reconnect path with explicit instructions for getting the `firebaseConfig` either from another machine's "Generate connection code" button or from Firebase Console.
- Admin / Supervisor onboarding is one paste — the super-admin generates a `ils-connect:<base64>` code from Settings; the team member pastes it on the **Join with a connection code** screen and signs in.

**Multi-database support**
- A super-admin managing multiple companies / branches can keep several Firebase projects connected on a single install. Saved databases appear in the OnlineSetup picker and in **Settings → Connected databases** with switch / rename / remove. The active project is shown as a chip in the top toolbar at all times.
- Service-account JSONs are scoped per project (`<userData>/firebase-admin/<projectId>/serviceAccount.json`) so adding a second project never overwrites the first's credentials. Each project gets its own cached Admin SDK app instance.

**Per-tab permissions + dedicated User Management tab**
- New **User Management** tab (super_admin only) splits user CRUD out of Super Admin. Create, disable / enable, reset password (via Admin SDK; auto-generates a temp password), delete (refuses self-delete), edit role + scoped companies.
- Per-user **per-tab access**: every tab is independently set to `Hidden`, `Read-only`, or `Full`. Hidden tabs don't appear in the sidebar at all. Read-only tabs render with all add / edit / delete actions disabled (Variables tab fully wired; pattern is reusable). Bulk presets ("All Read-only", "All Hidden") for fast configuration.
- Permissions are stored on the `/users/{uid}` Firestore doc and live-subscribed in `AuthProvider` — super-admin edits propagate to the affected user within ~1 second without a re-login.

**Super Admin tab — Connection / Companies / Database**
- Connection panel: link / re-link the service-account JSON for the active project; status badge + project ID display.
- Companies panel: add / rename / delete companies (delegates to the same flow `App.tsx` uses, so confirmations and cascade behaviour match).
- Database panel: audit-log retention controls (purge entries older than 90 / 180 / 365 days) using the Admin SDK to bypass the immutability rule that blocks ordinary clients from deleting `/audit` entries.

**Audit log enrichment**
- Audit entries now record actor email + actor uid alongside the change, and modify summaries name the changed fields (e.g. *"Modified employee: Ahmed (name, salary)"*). Schedule edits list specific cells when 1–5 cells changed, or *"Schedule edited for 2026-04 (47 cells)"* for bulk operations.
- Audit Log tab dual-reads: Firestore in Online mode, Express in Offline mode.

**Factory reset = true clean slate**
- Factory reset now wipes every local trace: signs out Firebase Auth, terminates Firestore (so its IndexedDB cache can actually be deleted instead of going into "blocked" state), removes all service-account JSONs, clears `localStorage` + `sessionStorage`, deletes Firebase IndexedDB databases, and reloads.
- A `localStorage.setItem` shim runs during the wipe so straggling React effects (e.g. the active-company persistence effect) can't repopulate state between clear and reload. Server-side Firestore data is intentionally not touched — that's a separate operation from the Database panel.

**Connection code — single-string database sharing**
- Settings → Generate connection code emits an `ils-connect:<base64>` string that encodes the full `firebaseConfig`. Recipients paste it on the OnlineSetup join screen and skip the 6-field manual form. Firebase config values are public client identifiers — security stays in Firestore Rules + Auth, never in obscurity.

**Firestore Security Rules**
- Three roles enforced server-side: `super_admin` (everything), `admin` (all companies, Variables read-only, no user mgmt), `supervisor` (operational tabs only, scoped via `companies` claim).
- Per-company subcollections gate read/write on the user's claim. Supervisors filtered to their `companies` list. Audit entries are immutable to clients — only super-admin via the Admin SDK can purge.

**Migration script**
- `npm run migrate-to-firestore` walks an existing offline-mode `data/` folder and bulk-uploads all 9 domains to the matching Firestore structure. Idempotent — running it twice produces the same state. `--dry-run` previews without writing. Auto-consolidates split-Eid holiday entries from older saves into single records with `durationDays`.

**Compatibility**
- All 108 unit tests pass. Pre-4.0 backups load unchanged via the existing migration normalizers. Offline mode is byte-identical to v3.0 in behaviour.

## v3.0.0 — 2026-04-29

**Major version. Maturity milestone.** Three years after v1's MVP and a year of design-system maturation since v2.0, the visual language is now codified in an external claude.ai/design package and applied end-to-end across every tab. v3.0.0 isn't breaking — pre-3.0 backups load via the same migration normalisers — but the design system, offline-ready font bundle, comprehensive dark mode, and FT/PT-split workforce planning are all post-2.0 additions and form the new baseline.

**Offline-ready webfont bundle**
- Pre-3.0 the app loaded Inter / Outfit / JetBrains Mono / Noto Naskh / Noto Kufi from the Google Fonts CDN. A first-launch with no internet would render the app in the system fallback stack until the user got online.
- v3.0 bundles all five families locally via `@fontsource/*` packages. Each weight ships a hashed `.woff2` next to the bundle; `main.tsx` imports them directly so Vite handles emit + cache-busting. The `@theme` font stack in `index.css` keeps the same family names so component classes stay unchanged. Arabic faces appended to the sans/display stacks so an Arabic glyph picks Naskh / Kufi via unicode-range fallback even outside the explicit `[dir="rtl"]` pass.

**Design system applied end-to-end**
- Every tab — Dashboard, Schedule, Roster, Payroll, Workforce Planning, Coverage & OT, Layout, Shifts, Holidays, Reports, Variables, Settings, Audit Log — now uses the design-system primitives consistently: `Card`, `KpiCard`, `apple-press` interaction, eyebrow→stat→unit KPI rhythm, three-tier shadow elevation, logical utilities (`ms-*`/`me-*`/`ps-*`/`pe-*`/`start-*`/`end-*`) for RTL, and the rounded-pill sidebar nav from the design package.
- Settings, Reports, Holidays, Audit Log received explicit `dark:` annotations on every accent surface (alert banners, status chips, hover surfaces, sticky headers). The Audit Log's day-grouper sticky header used to hardcode `bg-[#F3F4F6]` — invisible in dark mode; now uses the page-bg token with both light/dark variants.
- Global dark-override pass extended to cover `text-*-800` / `text-*-900` foregrounds, `text-orange-*` / `bg-orange-*`, `text-teal-*` / `bg-teal-*`, `divide-slate-50`. Pre-3.0 these tinted accents stayed dark-on-dark in dark mode (legible-but-poor-contrast); now they remap to luminance-correct shades automatically across every component.

**Compatibility**
- All 108 tests pass. Backups load unchanged. The font bundle adds ~600 KB to the gzipped distribution but eliminates the offline-first failure mode.

## v2.7.0 — 2026-04-29

**Design-system pass + per-station demand profile.** Two user-driven items: pulled the sidebar pattern out of the new claude.ai/design package and wired it into production, then carried the v2.6 FTE/PT annual demand profile down into the per-station and per-group drilldowns so the depth of analysis is consistent at every level of the workforce planner.

**Sidebar — design-system pattern**
- TabButton switches from the v2.6 leading-edge blue stripe to a macOS Big Sur-style rounded-12 pill: tinted blue surface, hairline blue ring, inset highlight, and a small pulsing blue dot at the inline-end edge. Auto-mirrors in RTL via logical classes.
- Brand area gets a monochrome calendar-check icon block + concise wordmark + mono version pip — replaces the all-caps text-only header.
- Sidebar narrowed from 256→248 px and the rail palette aligned to the design tokens (`#0f172a`).
- SidebarGroup tightened — lighter dividers, indentation aligned with the new pill margin.

**Workforce Planning — per-station demand profile**
- The v2.6 Annual Headcount Plan panel introduced FTE / PT split with Avg / Median / Peak / Valley tiles for the company as a whole. v2.7 takes that exact treatment to the per-station and per-group expanded drilldowns. Click any station or group row → see the same 4-tile demand profile **scoped to just that station / group** (e.g. "Cashier Counter 3 peaks at 4 FTE in April, valleys at 2 in August").
- Standalone station rollup rows (the no-group case) are now click-to-expand with the same profile.
- New `MonthlyDemandProfile` component renders a compact two-column FT | PT layout that auto-collapses to a single column when only one contract type is recommended (conservative mode).
- `AnnualRollupStation` and `AnnualRollupGroup` now expose `monthlyFTE: number[12]` and `monthlyPartTime: number[12]` arrays — the data was already computed inside `buildAnnualRollup` but discarded after reducing to a single recommendation. The new fields cost no extra compute. `fiveNumberSummary()` extracted to a top-level helper so the top KPI panel and the drilldowns compute identically.

**Compatibility**
- 108 / 108 tests pass. Backups load unchanged — `monthlyFTE` / `monthlyPartTime` are runtime-computed, not persisted. The sidebar markup change is structurally equivalent (button + label + dot) so screen readers still announce the same nav.

## v2.6.0 — 2026-04-29

**Apple-polish UX overhaul.** The biggest visual sweep since v1: a coherent design-token system, a comprehensively dark dark mode, visible schedule grid lines in both themes, and Excel-style pivot grouping in the schedule. Two user-driven fixes round it out — the Workforce Planning forecast now projects movable holidays by month/day instead of dropping them, and the Schedule grid's "Group by station" toggle now collapses station blocks instead of just sorting rows.

**Dark mode + design tokens**
- New CSS variable layer (`--surface`, `--foreground`, `--border`, `--ring`, `--grid-line`, …) drives the whole app. Light palette stays slate-based; dark palette is tuned warmer than raw `slate-900` — a graphite GitHub-Dark feel that doesn't strain on long sessions. Sidebar uses softer `#161b22` / `#1c2230` instead of pure `#1E293B` / `#0F172A`.
- Comprehensive dark-mode global overrides for previously washed-out tokens: every tinted surface (`bg-blue-50`, `bg-emerald-50`, `bg-amber-50`, `bg-rose-50`, `bg-red-50`, `bg-indigo-50`, `bg-purple-50`, `bg-yellow-50` plus their `/30` `/40` `/50` `/70` `/80` opacity variants and `bg-*-100` solid versions) now picks an alpha-tinted hue against the dark surface instead of bleeding through as off-white. Same for hover surfaces (`hover:bg-slate-50`, `group-hover:bg-slate-50`, `hover:bg-blue-50`, etc.) and disabled-button slate states.
- Tinted text colors (`text-blue-700`, `text-emerald-700`, `text-amber-800`, `text-rose-700`, …) re-tone to readable shades (`-300` / `-200` / `-100`) in dark mode. Borders bump to `#2a313c` / `#3a4250` so dividers stay visible. Backdrops on modals deepen to `rgba(0,0,0,0.7)+`.
- New shift-cell color pairs in `lib/colors.ts`. Each shift code (FS, HS, MX, OFF, AL, SL, PH, MAT, CP) ships an explicit dark variant (~15% alpha tinted background, light readable text) so the schedule cells stay semantic in dark mode rather than blending into a single off-white smudge.

**Schedule grid — visible gridlines**
- New `.schedule-grid-line` utility binds vertical day-cell borders to a CSS variable that picks a stronger value in both themes (`rgba(148,163,184,0.28)` light, `rgba(120,138,162,0.45)` dark). Pre-2.6 dark mode mapped the cell border to the same slate as the cell background — invisible. Now you can read the calendar as a grid in either theme.
- Day header gets explicit dark contrast: weekend tint `dark:bg-slate-800/80`, holiday tint `dark:bg-red-500/15`, today highlight `dark:bg-blue-500/20` with a `ring-blue-300` inset ring. Weekday-of-week label and day numbers picked tones for both themes.
- ScheduleCell uses `transform-gpu` + cubic-bezier easing and an explicit `dark:hover:bg-slate-700/40` for empty cells. The `isRecent` swap-highlight ring is `dark:outline-amber-300`.

**Schedule — pivot-style "Group by station"**
- Toggling "Group by station" now produces Excel-pivot-style collapsible station headers instead of just sorting rows. Each station block opens with a tinted header strip (chevron + map-pin icon + station name + headcount badge); click the header to collapse / expand the block. Collapsed station IDs persist across sessions in `localStorage` (key `iraqi-scheduler-collapsed-station-groups`).
- Employees whose primary station can't be determined (no scheduled assignments yet) cluster under an "Unassigned" header at the bottom; collapsing it works the same way.
- The schedule virtualizer now uses a per-row height function (38 px for headers, 48 px for employee rows) so the row plan can mix the two without losing virtualisation perf.

**Workforce Planning — forecast projects ALL holidays**
- Pre-2.6 the forecast year selector dropped movable Islamic holidays (Eid Al-Fitr, Eid Al-Adha, etc.) when projecting to 2027+ because their Hijri-determined dates can't be auto-shifted without a Hijri calendar lib. The user reading is that for budget / hiring purposes, a same-month/day approximation is more useful than dropping them entirely.
- `projectHolidaysToYear()` now projects every holiday by month/day to the target year. Movable holidays get an `isApproximation: true` flag on the projected record, and the forecast banner shows "{count} movable holiday(s) approximated by same month/day in {year} — actual dates drift ~11 days earlier each Gregorian year. Adjust the exact dates in the Holidays tab once the official Hijri calendar for {year} is announced." instead of the old "couldn't be auto-projected" wording.

**Workforce Planning — clearer FTE/PT split + annual demand profile**
- The KPI strip used to merge FTE and PT into a single "recommended roster" number with a small "X FTE + Y PT" subtitle, and the headcount delta was a single combined figure. The user reading was that the two contract types are operationally and legally distinct — they should never be summed. Replaced with a focused 3-card anchor row (Total hours · Annual cost delta · Legal-safety premium *or* Peak month) plus a dedicated **Annual Headcount Plan** panel below.
- The new panel is two parallel columns (FTE | PT). Each column shows: current → recommended (with a coloured Δ pill that reads `+4 FTE` / `−2 PT`), then a 4-tile "Annual demand profile" grid with **Avg / Median / Peak / Valley**. Peak and valley tiles include the month name (e.g. "Peak 8 (Apr)" / "Valley 4 (Aug)") so the supervisor reads the demand shape, not just a number. Each column ends with a one-sentence rationale that swaps with the planner mode (peak-driven for conservative, average-driven for optimal).
- Median / peak / valley are computed from the 12-month series in `annual.byMonth`. The recommended figure stays sourced from `rollup.totalRecommendedFTE` / `rollup.totalRecommendedPartTime` so it matches the rest of the tab and the PDF / Excel exports. No backend changes.

**Apple-style polish**
- New `apple-press` utility class for primary CTA buttons: cubic-bezier ease, subtle `translateY(-1px)` on hover, `scale(0.98)` on press. `prefers-reduced-motion` disables the transform.
- Top toolbar uses `backdrop-blur-md` with a translucent surface, hairline bottom border, and softer rounded buttons — reads as elevated chrome instead of a hard panel.
- Sidebar TabButton: fixed-width tab-index column, blue active-stripe pinned to inline-start (RTL-correct), softer active surface (`bg-blue-500/15`).
- LocaleSwitcher in the sidebar footer becomes a 3-button segmented theme picker (Light / Dark / System) instead of a cycle button — three states visible at once, matches macOS preference panes.
- Generic page scrollbars get the thin pill treatment (Webkit + Firefox), tinted for both themes.
- ConfirmModal: deeper backdrop blur, softer corner radius (`rounded-2xl`), motion uses cubic-bezier, action buttons get coloured shadow.

**Compatibility**
- All 108 tests pass. The `projectHolidaysToYear()` return shape gains `projectedFixed` + `approximatedMovable`; `skippedMovable` is kept (deprecated, always 0) for back-compat. New `PublicHoliday.isApproximation?` field is optional. No data migration needed.

## v2.5.0 — 2026-04-29

**Forecasting + supply truth-telling.** Three user-driven items: a forecast-year selector for planning future years from current data, optimal-mode 'release' actions with Iraqi-law caveats, fair-share effective supply per station to fix the "35 eligible / 2 needed" double-count, and multi-day holiday support so Eid Al-Fitr can be one record instead of three.

**Workforce planning — forecast year selector**
- New ‹/›-stepped year card in the WorkforcePlanningTab toolbar replacing the static year display. Stepping to a year other than the active calendar's flips the card into amber FORECAST mode and surfaces a banner explaining the simulation: demand is computed using the current roster + station setup + shift definitions projected onto the target year's calendar, and fixed-Gregorian holidays (National Day, Labour Day, etc.) shift to the same month/day in the target year. Movable Islamic holidays carry through only when their date is already in the target year — they need a Hijri lookup to auto-shift, which we deliberately don't do; the banner reports the count we couldn't auto-project so the supervisor knows to add 2027 dates manually for accurate forecasts.
- New `projectHolidaysToYear()` helper in `lib/holidays.ts`. Pure projection — does not mutate input. Returns `{ projected, skippedMovable }` so the UI can surface both numbers.

**Workforce planning — optimal mode emits 'release'**
- Pre-2.5 the planner only ever surfaced 'hire' or 'hold' (never 'release') because Iraqi Labor Law makes FTE dismissals legally fraught (Art. 36 — fixed-term renewals become open-ended; Art. 40 — dismissals require Minister of Labor approval). That kept conservative mode honest but neutered optimal mode's whole point: showing the cost-minimising answer with the caveats spelled out. Now the action union is `'hire' | 'hold' | 'release'`. Optimal mode raises 'release' for surplus rows; conservative still folds surplus into 'hold'. Release rows render with an amber `AlertTriangle` icon and reasoning text spelling out "consider not renewing fixed-term PT (Art. 36) or freezing replacements; FTE dismissals require Minister of Labor approval (Art. 40) — treat as a recruitment-freeze signal, not a layoff list." Excel rows tinted amber to match the on-screen tone.

**Workforce planning — fair-share effective supply**
- Pre-2.5 a station with 35 eligible operators across a 10-station group displayed as "35 eligible / 2 needed" in the per-station drilldown — misleading because each operator can only cover ~1/10 of the time. The drilldown now leads with **effective supply** (3.5 in the example): for each employee, capacity is divided by the number of stations they're eligible for, then summed per station. The raw eligible count moves to the tooltip alongside an explanation of the math. Delta and action are computed from effective supply too, so optimal mode no longer falsely flags every station in a wide-eligibility pool as 'release'.
- Bonus fix: the eligibility helper now honours `eligibleGroups` (group-only employees were previously invisible to the per-station rollup, so big-pool venues with all-group eligibility under-counted supply across the board).

**Multi-day public holidays**
- `PublicHoliday.durationDays?: number` (default 1, clamped 1-14 in the migration). Eid Al-Fitr / Eid Al-Adha typically span 2-3 days; pre-2.5 the user added 3 separate records to model that. New "Duration" field in HolidayModal with an inline hint. HolidaysTab cards show an amber "{days} days" badge and a `start → end` date range when `durationDays > 1`.
- New `expandHolidayDates()` helper in `lib/holidays.ts`. Materialises multi-day holidays into one synthetic single-day record per covered date, sharing the parent's id/name/legalReference/compMode. App.tsx expands once at the entry point, so every downstream consumer (compliance, payroll, auto-scheduler, workforce planner, OT analysis, advisory, schedule grid, dashboard, payroll PDF, …) keeps using `holiday.date === dateStr` and gets correct multi-day behaviour without per-call expansion. The HolidaysTab itself receives the raw (unexpanded) list for editing.

**Compatibility**
- Pre-2.5 backups load cleanly. `durationDays` is backfilled to 1 by the migration; existing single-day holidays are byte-identical at runtime. The new `effectiveSupplyFTE` / `effectiveSupplyPartTime` fields on `AnnualRollupStation` are computed at runtime from existing data. The action union added 'release' as a NEW value — consumers that didn't anticipate it (Excel, on-screen rollup row) were updated; external callers receiving the rollup will see 'release' if they pass `mode='optimal'`. 108 tests pass.

## v2.4.0 — 2026-04-29

**Hiring Roadmap.** The workforce planner now answers *when* to hire — not just how many. New month-by-month recruitment plan that phases hires so new staff land just before each demand step-up, deferring payroll until needed and saving money vs hiring everyone at year start. Surfaces on screen, in the PDF export, and in the Excel workbook.

**Algorithm**
- New `buildHiringRoadmap()` walks the 12-month demand curve and emits a per-month action plan with `fteAdds`, `ptAdds`, `ptReleases`, end-of-month roster, monthly cost, and a generated reasoning sentence. Conservative mode never reduces FTE (Iraqi Labor Law Art. 36/40 makes releases hard) and ignores PT entirely; optimal mode allows PT contracts to scale up and down freely while still treating FTE as effectively permanent. Default 1-month lead time so a hire placed in April is productive in May — the supervisor reads "Ramp 2 FTE for May peak" rather than "Hire 2 FTE in May" (too late).
- The plan is benchmarked against a naive "hire every needed FTE/PT in January and hold all year" baseline. The difference is the timing-only savings — same headcount target, just deferred. Always ≥ 0 (you never lose money by deferring non-binding hires). The savings figure is the recruitment plan's punchline: "Phased plan saves X IQD/yr vs hiring everyone in January."
- Algorithm walks Jan→Dec. Step 1 handles January urgency (any current shortfall vs Jan demand becomes an immediate Jan add). Step 2 looks ahead by `leadMonths` and hires *this* month to cover that future demand. Step 3 sweeps any tail-end demand that didn't fit in the lead window. PT releases land in the month before demand drops so the next month's headcount is lower without paying for unneeded PT.

**On-screen — WorkforcePlanningTab**
- New "Hiring Roadmap" card after the monthly demand chart. Headline KPI strip surfaces total FTE adds, PT movement (optimal only) or peak roster (conservative), savings vs baseline (with %), and the phased annual cost. 12-bucket horizontal timeline below: each month renders a stacked bar (slate FTE + blue PT) sized to the peak roster, with rose `+N FT` and blue `+M PT` chips above the bar for hires and an amber `−K PT` chip below for releases. Tooltip on each bar shows the full reasoning. Reasoning list at the bottom defaults to action months only (skip the "hold" rows) with a toggle to expand to all 12.
- Mode toggle (Conservative ↔ Optimal) at the top of the tab automatically rebuilds the roadmap, so flipping modes shows the trade-off in real time.

**PDF export**
- New "Hiring Roadmap" page after the Monthly Demand Breakdown. Headline block lists total movements, smart cost, baseline cost, savings + percentage, and the lead-time assumption. Monthly schedule table follows: Month, +FTE / +PT / −PT, FTE end / PT end, Need FTE/PT, Monthly cost, Action / reasoning. Hire rows tinted rose, release rows tinted amber so the recruitment team can scan straight to the actionable months.

**Excel export**
- The "Hiring Roadmap" sheet (sheet 2) is rewritten from a per-group action list into the month-by-month plan. Three blocks now: a Plan Summary at the top (total adds/releases, smart cost, baseline cost, savings, lead time, starting roster), the 12-row Monthly Schedule with action-tinted rows + totals row, and a "Where to hire — peak-driven per group" compressed view at the bottom (so the supervisor sees both *when* and *where* on one sheet). Per-group full detail still lives on the Group Rollup sheet. Budget Impact sheet (sheet 6) gains a "Phasing impact" block surfacing the same savings figure for Finance.

**Compatibility**
- `buildHiringRoadmap()` is a new export — no existing call sites changed. The PDF and Excel exporters' `roadmap` arg is optional, so any external caller still compiles. Tests unchanged (108 pass).

## v2.3.0 — 2026-04-29

**Workforce planning sprint.** Three user-driven items: a smarter eligibility model in the employee modal, a richer current/recommended breakdown on the workforce planner, and a brand-new Excel export of the workforce plan tailored for HR / Finance / CEO sign-off. No breaking schema changes; pre-2.3.0 backups load cleanly.

**Employee setup**
- **Group click auto-selects every member station; station click carves out exceptions.** Pre-2.3.0 the eligibility section had two parallel surfaces (group chips + station chips) that didn't talk to each other — clicking "Cashiers" added the group to `eligibleGroups` but the per-station chips below stayed visually unselected, leaving the supervisor to either trust the invisible coverage or duplicate the work by also ticking each station. The refactored `EmployeeModal` unifies the two: group chips give blanket coverage of every member station (current and future), and a per-station chip click "expands" the group internally — the group is removed from `eligibleGroups`, all OTHER members are added to `eligibleStations`, and the clicked one stays off. Station chips render in three states: blue (directly eligible), emerald (covered via a group), and outlined (off). New helpers cover bulk operations: a `Select all` button explicitly fans out every station as a per-station selection (replacing any group coverage), and `Clear` wipes both lists. A live "Covers X of Y stations" badge in the section header shows the supervisor at a glance how broadly the employee is eligible. Group chips also gain a "partial" visual state when some — but not all — member stations are individually selected (the group is OFF but you've carved out a subset), with a tooltip explaining click-to-promote-to-blanket.

**Workforce planning**
- **Current side now breaks down FT vs PT.** Pre-2.3.0 the comparative `current / recommended` block showed `5 / 9` with the FTE+PT split only on the recommended side ("7 FTE + 2 PT"). The current side stayed a single opaque count, so a supervisor staring at "5 / 9" couldn't tell if those 5 were already 5 FTE (so the gap is +4 hires) or 3 FTE + 2 PT (so the gap is more nuanced). New `currentFTECount` / `currentPartTimeCount` fields on `AnnualRollupGroup` and `AnnualRollupStation`, populated by `buildAnnualRollup` using a configurable `standardWeeklyHrsCap` threshold (defaults to 48h / Art. 70). The `ComparativeKpi` primitive accepts a new `currentBreakdown` prop and renders the breakdown line as `current / recommended` mirroring the headline numbers. Annual KPI strip's "Current" card also shows `X FT + Y PT` when there are any PT employees on the roster. Group → station drilldowns inside the rollup mirror the same split.
- **Excel export of the workforce plan.** New "Export Excel" button next to the existing PDF export. Generates a 7-sheet `.xlsx` workbook designed as a working document HR / Finance / CEO can sort, filter, and copy from rather than a single readout: **(1) Executive Summary** — demand snapshot, roster snapshot, budget snapshot, and a sign-off block with explicit decisions per function; **(2) Hiring Roadmap** — one row per group + standalone station, with current FT/PT, recommended FT/PT, net hire, action priority (Critical/High/Medium/Low based on delta + role peak alignment with venue peak), suggested start month (peak month - 2 to allow onboarding), reasoning, and approver; **(3) Group Rollup** — annual recommendation per group with action-tinted rows; **(4) Station Rollup** — finer per-station detail; **(5) Monthly Demand** — required hours, recommended FT/PT, monthly salary, and % of peak per month, peak/valley rows tinted; **(6) Budget Impact** — current vs recommended annual salary, net delta, conservative vs optimal cost, legal-safety premium; **(7) Implementation Schedule** — start-month → annual savings table. Headers are styled with dark slate fill + white text, totals rows highlighted, currency formatted with " IQD" suffix, hours formatted with " h" suffix, hire/hold rows tinted rose/emerald, frozen header row on every sheet. exceljs is loaded dynamically (mirrors the jspdf import pattern) so it doesn't enter the main bundle.

**Compatibility**
- Pre-2.3.0 backups load cleanly. The new optional fields on `AnnualRollupGroup` / `AnnualRollupStation` are computed at runtime from existing data (no schema change). `buildAnnualRollup`'s new `config` parameter is optional and defaults to a 48h FT threshold so existing call sites and tests are unaffected. `ComparativeKpi`'s new `currentBreakdown` prop is optional; without it the v2.2 single-line breakdown rendering is byte-identical.

## v2.2.0 — 2026-04-29

**Big UX sprint.** Eleven user-driven items spanning the workforce planner, schedule grid, employee setup, station groups, auto-scheduler, holiday admin, and Electron shell. Compliance philosophy unchanged (reporting not enforcement); no breaking schema changes.

**Workforce Planning**
- **Comparative current/recommended rollup format.** Group + station rollup rows now lead with a single `current / recommended` ComparativeKpi block (e.g. "5 / 9 — 7 FTE + 2 PT, +4 to hire") instead of three separate KPIs (Eligible Now, Recommended FTE, Recommended PT). The expanded station drilldown inside group rows mirrors the same comparative pattern. New `ComparativeKpi` component lives in `components/Primitives.tsx` and is reused by both rollup rows. Ideal-only view is unchanged — it suppresses the comparative since there's nothing to compare against.
- **Bar-click drilldown panel.** Pre-2.2.0 clicking a month bar in the monthly demand chart only highlighted the bar with no surfaced detail (effectively a no-op from the user's POV). The new `MonthDrilldownPanel` reveals on click: month name + peak/valley badge, required hours for the month, recommended FTE+PT roster, monthly salary, % of peak demand, and a top-3 roles bar showing which roles drive the demand. Helps answer "why does August spike?" without leaving the planning view.

**Station groups**
- **Preset icon picker.** New `StationGroup.icon` field carrying one of 20 curated lucide icon names (`boxes` / `cart` / `coffee` / `truck` / `car` / `building` / `wrench` / `cpu` / `phone` / `monitor` / `lock` / `heart` / `headphones` / `briefcase` / `activity` / `users` / `package` / `zap` / `store` / `utensils`). Picker UI in `LayoutTab` New-Group form + click-the-tile popover on existing kanban headers (`GroupIconButton`). The chosen icon also propagates through `AnnualRollupGroup.groupIcon` to the workforce-planning rollup so a group's visual identity is consistent across views. Migration normalizer round-trips the field; pre-2.2.0 groups fall back to the default `boxes` glyph.

**Schedule grid**
- **Violations-only filter.** New toolbar button next to the role filter. Narrows the visible roster to employees with at least one `severity:'violation'` finding in the active month (info findings don't count). Shows the violation count as a badge; disables when there are no violations to filter so the user doesn't toggle to an empty grid and wonder where everyone went.
- **Group-by-station view.** New toolbar button. Sorts visible rows by each employee's primary station (= the stationId they're assigned to most often in the visible month); employees with no station assignments fall to the bottom. Lets the supervisor scan station-by-station coverage without re-architecting the grid into a station×day pivot.

**Month / year picker**
- Replaces the prev/next-only chevrons across the Schedule, Dashboard, Payroll, and Coverage&OT tabs with a shared `MonthYearPicker` component. Clicking the date card opens a 4×3 month grid + year stepper. Jumping Jan→Dec is one click instead of twelve. The chevrons still step ±1 month for adjacent navigation. Logical RTL — chevrons flip direction in Arabic. New `setActiveMonth(year, month)` setter centralises the cell-undo-stack reset and `daysInMonth` recompute that the prev/next helpers used to duplicate. WorkforcePlanningTab dropped its dead `prevMonth`/`nextMonth` props (it's annual-only).

**Auto-scheduler**
- **Custom date range, including cross-month.** New `RunArgs.startDay` / `RunArgs.endDay` (defaults to 1 / `daysInMonth`); the day loop iterates only the picked range; out-of-range cells are preserved unchanged in both fresh and preserve modes. UI is a `Calendar` chevron next to the Auto-Schedule buttons that opens a start/end *date* picker (HTML `<input type="date">`), day-count summary, "minimum 28-day" hint, and a "Reset to full month" shortcut. **Cross-month ranges work too** — `App.tsx` orchestrates per-month invocations, stitches the running `allSchedules` between calls so each subsequent month's rolling-7-day window sees the trailing days of the prior month, threads `updatedEmployees` through (so holiday-bank counters etc. accumulate), and applies directly with a summary toast (multi-month preview would be too dense). Within-month ranges still go through the regular preview-then-apply flow with day clamps. Picking a single-month range that targets a different month than the one currently displayed switches the active month before running so the preview makes sense.

**Employee setup**
- **Station group eligibility.** New section in `EmployeeModal` above the per-station eligibility chips, letting the supervisor pick station groups instead. Toggles each group's id in/out of `Employee.eligibleGroups`; the auto-scheduler already treats this as "open eligibility for any station in this group". Newly-added stations inside a chosen group inherit eligibility automatically — no need to revisit every employee's profile when expanding the kanban. Section is hidden when no groups are defined so single-group venues don't see clutter.

**Shifts**
- **System shifts locked from accidental edits.** The `OFF / CP / AL / SL / MAT / PH` codes drive the auto-scheduler, leave system, and comp-day rotation; their `isWork` / `isHazardous` flags must match the engine's expectations. New `lib/systemShifts.ts` exports `SYSTEM_SHIFT_CODES` + `isSystemShift()` (extracted from the inline `App.tsx` set). On the Shifts tab, system shifts now show a lock icon instead of a delete button (deletion was already blocked by an info-only confirm modal — exposing the trash icon implied otherwise). In `ShiftModal`, the two toggles are replaced with a read-only summary line + lock chip; display name, times, break, and description remain editable for the rare cosmetic tweak.

**Holidays**
- **Bulk compMode set.** Three new pills in the Holidays tab header — `Inherit` / `Comp day` / `Cash 2×` — flip every holiday's mode at once. Saves the supervisor from cycling 14 individual pills when peak-season policy changes uniformly (e.g. switching the whole year to cash-ot for Q4 then back to inherit afterwards).
- **Stable holiday `id`.** Pre-2.2.0 holidays were keyed by `date` (the field that's *also* user-editable). Editing a holiday's date orphaned the entry — `findIndex(h => h.date === editingDate)` failed once the date had changed, and a subsequent import with the original date would silently overwrite a different holiday. New `PublicHoliday.id` field; the migration normalizer backfills `id = date` for legacy records (so existing entries keep their identity), `HolidayModal`'s `empty()` factory mints `holi-{timestamp}-{rand}`, and App.tsx's save / update / delete paths all match by id with a defensive `id ?? date` fallback. Library functions (compliance, OT, PDF report) still key off `date` for "is this calendar day a holiday" — that semantic is unchanged. Optional in the type to keep test fixtures lightweight.

**Electron**
- **Taskbar minimize fix.** Pre-2.2.0 [electron/main.cjs:235-238](electron/main.cjs#L235) intercepted the minimize event and called `mainWindow.hide()`, which removed the window from the taskbar entirely — so a second taskbar-click sent the window to the system tray instead of restoring it. v2.2.0 lets Windows handle minimize natively (window stays in the taskbar). The tray remains the path for FULL hiding via the close button + `tray > Open` to bring it back.

**Tests** — 108 passing, no test changes (the additions are mostly UI restructuring + new optional fields; the auto-scheduler range parameter is a clamped iteration with passthrough behaviour at the defaults).

**Migration**
- Pre-2.2.0 backups load cleanly. New optional fields (`StationGroup.icon`, `Employee.eligibleGroups` already existed since v1.16) default to undefined and the renderer falls back gracefully (boxes icon, no group eligibility). The auto-scheduler's new `startDay`/`endDay` are optional with defaults to the full month, so existing runs are byte-identical.

## v2.1.4 — 2026-04-29

**Audit follow-up.** A wider review of v2.1.3 surfaced seven items worth shipping in their own batch — one data-loss bug, one consistency bug, two UX defaults that read as broken, and an i18n sweep across five surfaces.

**Real bugs**
- **Station groups never persisted.** The kanban groups (Cashier Counters / Game Machines / Vehicles + any user-created) lived only in memory pre-2.1.4. Every reload re-seeded `INITIAL_STATION_GROUPS` for the default company (silently overwriting user renames / recolours / new groups), and custom companies always started with an empty kanban. Backups also lacked them. The server's `COMPANY_DOMAINS` set now includes `stationGroups` (with full audit-log diff so add/modify/remove are recorded the same way `stations` are), and all three client save paths — auto-save (`App.tsx:286-339`), Quit-app last-sync (`:921-961`), `exportBackup` (`:973-1003`) — now carry the namespaced groups dictionary.
- **Schedule grid weekend was Sat/Sun, not Fri/Sat.** [ScheduleTab.tsx:608](src/tabs/ScheduleTab.tsx#L608) used date-fns `isWeekend` (locale-naïve, defaults to Sat/Sun); the print view at [PrintScheduleView.tsx:39-40](src/components/PrintScheduleView.tsx#L39) already had Fri/Sat hardcoded for the Iraqi weekend. Same release, two different weekends. Schedule grid now matches the print view.
- **StaffingAdvisoryCard active-tab rendered uncoloured.** [StaffingAdvisoryCard.tsx:73](src/components/StaffingAdvisoryCard.tsx#L73) built `bg-white text-${tone}-700 border-${tone}-500` via template-literal interpolation, which Tailwind v4's source scan can't see — so the active mode tab dropped its tone tint and looked the same as inactive tabs. Switched to a static class lookup keyed on `tone`. (The other class-string sites flagged in the audit turned out to be using guarded `&&` literal strings, which Tailwind detects fine — no changes needed there.)
- **Sim panel OT Pay used the pre-v2.1.1 always-2× holiday math.** The v2.1.1 hotfix routed PayrollTab + DashboardTab through `computeHolidayPay` for the Art. 74 either-or model, but the simulation delta path at `App.tsx:1414-1444` (live `otSummary`) and `:1776-1804` (baseline `simMetrics`) was missed. Sim runs reported inflated OT pay that contradicted every other tab whenever a comp day was granted. Both now route through `computeHolidayPay` + `computeWorkedHours` so the totals match.

**UX**
- **BulkAssignModal default shift.** Pre-2.1.4 the modal initialised to `shifts[0]?.code` — for the seeded shift list, OFF is first, so a one-click apply assigned OFF for the whole month to every selected employee. Now defaults to the first `isWork` shift.
- **Run Auto-Schedule disabled when impossible.** The Auto-Schedule and Optimal buttons in the Schedule tab fired regardless of whether the roster had any employees or whether any stations were defined; the result was either a throw or an empty schedule with a confusing info modal. Both buttons now disable with a hint tooltip ("Add at least one employee in the Roster tab…" / "Define at least one station in the Stations / Assets tab…") when the run can't possibly produce useful output.

**i18n**
- **EmployeeModal hardcoded English.** Three helper `<p>`s under Rest Day / Personnel Category, the Stations + Work-shifts empty states, the "OT Hourly Rate (Derived)" label, and the notes textarea placeholder were all English-only. Now route through new keys (`modal.employee.rest.help.*`, `modal.employee.cat.help.*`, `modal.employee.stations.empty`, `modal.employee.shifts.empty`, `modal.employee.field.otHourlyRate`, `modal.employee.notes.placeholder`).
- **ShiftModal hardcoded English.** Almost every label (Code / Display Name / Start / End / Work Hours / Break / Description) plus the two switch labels (Hazardous / Counts as Work) plus the "Warning: shift outside business hours" banner stayed English in Arabic UI. Now route through new `modal.shift.field.*` and `modal.shift.toggle.*` keys.
- **AuditLogTab `DOMAIN_LABEL` + "All" + "change(s)".** The chip labels and grouping headers stayed English on a sensitive tab. Pivoted to a `DOMAIN_LABEL_KEY` map of i18n keys; new `audit.domain.*` keys (incl. `stationGroups`); plural-aware `audit.changes.one` / `audit.changes.many`; `audit.filter.all` for the All chip.
- **SettingsTab peak-day chips.** Hardcoded `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']` array replaced with `common.day.short.*` keys.
- **WorkforcePlanningTab month abbreviations.** Hardcoded `['Jan','Feb','Mar',…]` for the on-screen rollup peak-pills replaced with `common.month.short.*` keys. The PDF export keeps an English `MONTH_NAMES_PDF` constant since the document is typically shared regardless of UI locale.

**Tests** — 108 passing, no test changes (the bug fixes are either trivially correct or covered by manual UX verification: persistence touches the I/O layer; weekend shading is a one-line const; sim OT now reuses the holidayCompPay test surface).

## v2.1.3 — 2026-04-29

**Cleanup batch.** The deferred items from the v2.1.2 audit — one real bug, one performance win, two UX upgrades.

**Real bug**
- **PayrollTab Net Payable double-counted legacy single-range leaves.** A v1.6 backup with `annualLeaveStart/End` set could inflate Net Payable when the schedule grid still showed the pre-leave shift code on those dates (the supervisor edited the leave field before re-running the auto-scheduler, or the legacy field was never converted to a multi-range entry). Pre-2.1.3 the table summed those hours as worked, pushing total past the monthly cap and triggering phantom 1.5× standard OT. New `computeWorkedHours` helper in `lib/payroll.ts` walks the schedule and subtracts overlapping leave days via `getEmployeeLeaveOnDate` — handles both v1.7 multi-range `leaveRanges` and the legacy single-range fields uniformly. The CSV export and on-screen table both flow through the helper.

**Performance**
- **Schedule search-box stat memoization.** `computeEmployeeRunningStats` was rebuilt for every employee on every keystroke in the search filter — ~3100 stat objects per character (100 emp × 31 days). The cache was re-keyed on `filteredEmployees`, which the parent rebuilds whenever the search text changes. Re-keyed on the full `employees` array instead so the cache survives across keystrokes; search now only re-filters the visible row list.

**UX**
- **Sortable PayrollTab + ShiftsTab.** Adopted the `SortableHeader` pattern from RosterTab. PayrollTab sorts on Name / Hours / Holiday Bank / Annual Leave / Salary / Hourly Rate / OT Amount / Net Payable. The CSV export honours the active sort so the file matches what's on screen. Per-row payroll figures are now computed in a `useMemo` once and reused by sort + render + CSV — no per-sort recomputation of holiday breakdowns. ShiftsTab sorts on Code / Name / Hours / Status; the manual reorder up/down buttons disable while a sort is active (with `shifts.reorder.disabled.sortActive` hint tooltip) so the underlying-vs-visible index mismatch can't read as a bug. `SortableHeader` extracted from RosterTab to `components/Primitives.tsx` for reuse — accepts a string sort key + alignment + className override.
- **Holiday date input.** Upgraded the date field in HolidayModal from `type="text"` to `type="date"` for the native calendar picker. `SettingField` now accepts `type='date'` (HTML `<input type="date">` produces the same `YYYY-MM-DD` format the rest of the app expects, so no conversion is needed). The YYYY-MM-DD hint text stays for users who type the date instead.

**Tests**
- 108 passing (6 new in `payroll.test.ts`): work hours summed correctly in the no-leave case; legacy `annualLeaveStart/End`, `sickLeave*`, `maternityLeave*` overlaps subtracted; v1.7 `leaveRanges` overlaps subtracted; AL-painted-on-grid not double-subtracted; empty schedule returns 0.

## v2.1.2 — 2026-04-28

**UX & bug-hunt batch.** A wide audit surfaced ~25 issues; this release ships fixes for the highest-impact 12. All low-risk, all things a supervisor would feel within minutes of using the app.

**Real bugs**
- **NaN-poisoning numeric inputs.** Six `parseInt(value)` / `parseFloat(value)` call sites in EmployeeModal, StationModal, and ShiftModal accepted an empty input as `NaN` and persisted it — the next render would then read `NaN` salary, hourly rate, headcount, etc., quietly breaking payroll. All sites now wrap with `|| 0` and clamp non-negative where appropriate.
- **DashboardTab `isPeakDay` was holiday-blind.** A local copy on the dashboard only checked `config.peakDays`, while the canonical App.tsx version also counts every public holiday as peak. The 3-mode staffing advisory ran with the holiday-blind predicate, silently disagreeing with every other tab on holiday-heavy months. Now plumbed from App.tsx as a prop — single source of truth.
- **AnimatePresence + constant-key pitfall in three modals.** CoverageHintToast, LeaveManagerModal, and BulkAssignModal each used a single child under `<AnimatePresence>` with no per-instance `key` — the documented React StrictMode foot-gun where the exit animation can hang and leave the component invisible on the next mount. All three now use dynamic keys.
- **HolidayModal hard-coded English labels and `'Article 73'` reference.** The legal reference disagrees with the rest of the codebase (Art. 74 governs holiday work). Now i18n'd, defaults to `'Art. 74'`, validates the date format, and exposes the per-holiday `compMode` picker at create time so peak-week opt-outs don't require save-then-edit.
- **RosterTab "Stations" column ignored `eligibleGroups`.** A v1.16 employee assigned only via group eligibility (e.g. `eligibleGroups: ['cashier-grp']`) showed as "Unassigned" even though the auto-scheduler considered them eligible for every station in the group. Now renders group chips first, then deduplicates per-station chips that fall under those groups.
- **StationModal "Required Role" hardcoded to Driver only.** Custom roles ("Cashier", "Operator", "Security") on the roster could not be required at station level via the UI. Dropdown now populates from the live roster + Driver. Empty ID/name now block save with an inline error instead of silently creating duplicates.
- **Shift deletion left dangling references.** Deleting CP / OFF / AL / SL / MAT / PH silently broke the auto-scheduler, comp-day rotation, or leave system; deleting any in-use shift left stale codes in schedule cells. Now: system shifts are protected with a clear "can't delete" notice; in-use shifts trigger a confirmation showing the affected cell count.
- **Sim panel reported a fake +N% coverage gain on every run.** The "Coverage" metric hardcoded `baseline: 0` because the baseline coverage wasn't recomputed during sim. Removed the metric entirely until baseline computation is wired; the remaining four (workforce / OT hours / OT pay / violations) are honestly comparable.
- **Dashboard heatmap title misrepresented effective hours.** When per-day-of-week overrides extended the operating window (e.g. Friday to 02:00), the heatmap correctly plotted the union but the title showed only the default open/close. Now shows the effective range with a "varies by day" suffix when overrides exist.

**UX wins**
- **Modals close on backdrop click.** Six modals (Confirm, Employee, Station, Holiday, Shift, BulkAssign, LeaveManager) now dismiss when the user clicks the dimmed area outside the card. Esc still works via `useModalKeys`. The standard "click-outside" gesture was the most surprising omission in usability testing.
- **Schedule paint banner stops pulsing after 1.8s.** Pre-2.1.2 the blue "Painting FS" banner pulsed indefinitely, reading as visual noise after the first second. The pulse now triggers only when paint mode changes and settles to a static label.
- **Holidays tab cards have an edit pencil.** Pre-2.1.2 the only path to fix a typo'd date or holiday name was delete + recreate — losing any per-holiday `compMode` override. Now an edit icon opens the modal pre-populated.
- **EmployeeModal initial focus lands on the form, not the close button.** Pre-2.1.2 hitting Enter immediately after "New Employee" dismissed the modal. Now defers focus to the first text input.
- **CSV payroll import guards `≥ 0` on Holiday Bank and Annual Leave.** Pre-2.1.2 only `baseMonthlySalary` had the guard; negative balances surfaced as "credit deficits" downstream.
- **KpiCard cleanup.** Removed an always-empty `<span>` that took a column gap on every dashboard card. Status labels ("Requires Review" / "System Balanced") and units ("Staff", "Stations") now route through i18n.

**Architecture / cleanup**
- **Stale comment block in PayrollTab.** The commented-out HolidayCompensationModal block from v1.10 still claimed Art. 74 entitled workers to "BOTH the 2× cash premium AND a comp rest day" — directly contradicting v2.1's either-or model. Removed.

**Tests**
- 102 passing across compliance, auto-scheduler, OT analysis, holidayCompPay, coverage hints, staffing advisory, and workforce planning. No new tests this batch — every fix is either trivially correct (NaN guards, prop plumbing, dynamic keys) or covered by manual UX verification (modals, focus, banner timing).

## v2.1.1 — 2026-04-28

**Hotfix — Art. 74 either-or model now applies to the on-screen Payroll table and Dashboard KPIs.**

The user reported still seeing 2× holiday OT pay in the Credits & Payroll table even with `comp-day` mode selected and CP days granted in the schedule. v2.1.0 fixed the model in `otAnalysis.ts` and the new payroll CSV export, but missed two on-screen call sites that were hardcoding "always 2× for any holiday hour worked":

- **PayrollTab table** — the displayed OT amount and net payable used the v1.14 always-2× math. Now routes through the shared comp-window check; holiday hours with a CP / OFF / leave inside the configured window contribute 1× regular pay (no premium added). The OT cell shows `(8.0h holiday — comp day granted)` in green when the rotation succeeded, vs `(incl. 8.0h @ 200%)` only when the premium is genuinely owed.
- **DashboardTab KPIs** — the headline "Holiday OT Pay" and total OT projection were also hardcoded to 2×. Same fix.

**Cross-month visibility for late-month holidays.** A holiday on Jan 28 with the comp day landing on Feb 3 was previously reporting "premium owed" everywhere because the analysis couldn't see next month's schedule. v2.1.1 plumbs `allSchedules` through to PayrollTab, DashboardTab, and `analyzeOT` so the look-ahead crosses the month boundary correctly.

**Single source of truth.** New `lib/holidayCompPay.ts` exposes `computeHolidayPay(emp, schedule, shifts, holidays, config, hourlyRate, allSchedules?)` — used by PayrollTab (table + CSV export), DashboardTab (KPIs), and `analyzeOT`. Pre-2.1.1 the gating logic lived inline in three places with subtle drift (otAnalysis was correct but month-bound; PayrollTab + DashboardTab still on v1.14 math). Now they share one implementation and any future Art. 74 change touches a single helper.

**Tests** — 102 passing (9 new in `holidayCompPay.test.ts`): comp granted via CP / OFF inside the window, premium owed past the max, cross-month CP visibility, cash-ot mode override, per-holiday override beating the global default, holidays outside the active month skipped.

## v2.1.0 — 2026-04-28

**Art. 74 either-or model + CP shift + RTL polish + payroll CSV.**

The headline change is a legal-model swap on Art. 74. The user surfaced that practitioners disagree with the v1.14 "BOTH 2× cash AND a comp rest day" reading — the prevailing alternative is "EITHER a comp rest day OR the 2× cash premium, not both." v2.1 implements the either-or model with per-holiday flexibility for peak weeks where the comp rotation isn't realistic.

**Art. 74 — comp day OR cash premium (not both)**
- New `Config.holidayCompMode` (default `'comp-day'` | `'cash-ot'`) drives the auto-scheduler + payroll path globally. `comp-day` rotates a CP rest day inside the configured window so holiday hours stay paid at the regular wage; `cash-ot` skips the rotation and pays 2× per Art. 74.
- New per-holiday override on `PublicHoliday.compMode` lets the supervisor flip a single holiday to `cash-ot` when peak-week HC can't absorb the rotation. The Holidays tab pill cycles inherit-default → comp-day-override → cash-ot-override.
- Comp window extended from a hardcoded 7 days to two configurable thresholds: `holidayCompWindowDays` (default 30 — the legal max before "Comp day owed" fires) and `holidayCompRecommendedDays` (default 7 — soft target). Comp rest days landing past the recommendation but inside the max surface as a new `Comp day late` info note rather than a hard "owed" finding.
- Variables tab gets a new Art. 74 section with the mode picker and both threshold inputs.
- otAnalysis splits holiday hours into total + premium-owed pools. A CP/OFF day inside the window converts the 2× premium to the 1× regular wage, matching the new legal model. Mitigation projection shows the projected cash savings of completing the rotation.

**New CP shift code (Compensation rest day)**
- Distinct from OFF so the supervisor can see at a glance which non-work days were granted as Art. 74 comp days vs routine weekly rest. The auto-scheduler stamps `CP` (instead of `OFF`) when an employee with a pending PH-work debt rotates to a non-work day.
- Migration backfills the `CP` shift onto every pre-2.1 company on first load — no manual intervention.
- Compliance + payroll both recognise CP as a comp-day marker; OFF still satisfies the comp-day-owed check (a routine OFF inside the window still works as compensation).

**UX bug fixes**
- **Stations / Assets dropdown:** the "Move to" menu was being clipped by the kanban column's `overflow-hidden` and could escape the viewport on the bottom card of a tall column. Now rendered via a React portal with viewport-aware drop-up placement, click-outside dismissal, and direction-aware anchoring (start side in RTL).
- **Seeded factory layout:** verified the demo data already lands with three groups (Cashier Counters, Game Machines, Vehicles) wired to matching `eligibleGroups` on the seed employees.

**RTL / Arabic polish**
- **SuggestionPane** repositioned via logical `inset-inline-end` so it lands opposite the sidebar in Arabic instead of overlapping the tabs. Collapse arrow icon flips with direction; main content shifts via `pe-*` (logical) instead of `pr-*`.
- **Schedule grid** locked to `dir="ltr"` — calendar days 1→31 read naturally in both locales, the sticky names column stays visually pinned, and `scrollLeft` semantics stay consistent across browsers (RTL `scrollLeft` is an inconsistent mess across Chrome/Edge/Safari/Firefox).
- **Switch (Apple pill)** thumb travel mirrors via `rtl:` Tailwind variants — ON state lands on the inline-end of the track in Arabic.
- **Logical RTL rules** added in `index.css` for common `right-*` / `left-*` positioning, `text-start` / `text-end`, and shadow patterns. Tables and buttons use `text-start` / `text-end` everywhere.
- **Arabic terminology:** الورديات / الوردية → المناوبات / المناوبة across all 14 occurrences (the user's preferred Iraqi-Arabic word for shifts).

**Payroll / Credits CSV (HRIS-ready)**
- New **Export CSV** button on the Credits & Payroll tab dumps a per-employee row with hours, holiday-bank days, annual-leave days, base salary, hourly rate, standard OT hours/pay, holiday OT hours/pay, and net payable. Numeric fields are unformatted (raw IQD / hours) for clean import into SAP, Kayan HR, or any HRIS system.
- New **Import CSV** updates `Holiday Bank Days`, `Annual Leave Days`, and `Base Monthly Salary` by `Employee ID`. Other columns (computed payroll values) remain read-only — re-importing them is a no-op since the values are recalculated from the schedule. Skipped row count surfaces in a status banner.

**Tests**
- 93 passing across compliance, auto-scheduler, OT analysis, coverage hints, staffing advisory, and workforce planning. New tests cover comp-day vs cash-ot mode in both compliance and OT analysis paths.

**Migration**
- Pre-2.1 backups load cleanly. The `holidayCompMode` field defaults to `'comp-day'` (matches the auto-scheduler's pre-2.1 behaviour); window / recommended day fields default to 30 / 7. Per-holiday `compMode` is `undefined` for legacy holidays (inherits the global default). The CP shift is auto-injected into shift lists that lack it.

## v2.0.0 — 2026-04-28

**Maturity milestone.** 25 releases since v1.0's MVP — the data model, feature surface, and analytical layer have evolved enough that a major bump is warranted. Conservative-mode workforce planning, station groups, holiday compensation tracking, multi-range leaves, group-level eligibility, and the cross-tab analytics (Compliance / Coverage & OT / Workforce Planning) all post-date v1.0 and form the new baseline. v2.0.0 isn't breaking — pre-2.0 backups load via the migration normalisers — but the app you see in v2.0.0 is fundamentally a different product from v1.0.

The v2.0.0 release also addresses four user-reported items in this batch:

**Leave-history sync (hotfix)**
- The `LeaveManagerModal` now also surfaces leaves painted directly on the schedule grid (read-only entries with a "Painted" tag). Pre-2.0 the count + tooltip on the Credits & Payroll row included painted leaves, but clicking Manage only showed manually-managed ranges — confusing for supervisors who paint leaves in the schedule.
- After the auto-scheduler in fresh mode overwrites AL/SL/MAT cells, the painted ranges in the modal disappear automatically since the schedule is the single source of truth (the modal re-derives via `useMemo` keyed on the schedule).

**Credits & Payroll month selector**
- New month-navigation header matching the Schedule, Compliance Dashboard, and Coverage & OT tabs. Credits / OT / leave figures now pivot on the active month — pre-2.0 it always reflected the last-edited month with no way to navigate.

**Auto-scheduler comp-day insufficiency warning**
- When the scheduler can't place an OFF/leave inside the 7-day comp window after a PH-work day (Art. 74 obligation), the residual debt is reported per-employee on `RunResult.compDayShortfall`. The Schedule Preview modal surfaces this as an amber "Insufficient HC for full comp-day rotation" warning with the count of unplaced comp-days and affected employees.
- Workforce Planning now factors the comp-day overhead into demand-hours: every hour worked on a public holiday creates a 1-hour comp-rest-day obligation in the days following, which is real workforce demand. The recommended FTE accounts for this, surfacing the true HC need.

**Station groups + group-level eligibility**
- New `StationGroup` data model: each group has an id, name, color, and optional description. Stations can declare a `groupId`; employees can declare `eligibleGroups` (a list of group IDs).
- Stations / Assets tab redesigned around a kanban view — each group is a column with its member stations as cards. Add / rename / re-colour groups inline. Move a station to a different group via the card's "Move to" dropdown. Stations without a group land in the "Ungrouped" column at the end. The auto-scheduler is unchanged at station granularity; groups are purely metadata that drive (a) one-click eligibility and (b) the workforce-planning rollup.
- The Workforce Planning tab now shows a **per-group rollup** as the primary view when groups exist. Rows aggregate demand across the group's stations and show "X people eligible to staff any cashier station today" instead of the per-station drill. The per-station view is still available by expanding a group row.
- Seeded data in factory reset now includes three sample groups — Cashier Counters, Game Machines, Vehicles — and the seed employees declare matching `eligibleGroups`. New installs land with the kanban pre-populated.

**Tests** — 89 passing across compliance, auto-scheduler, coverage hints, staffing advisory, OT analysis, and workforce planning.

**Migration**
- All pre-2.0 backups load cleanly. `holidayCompensations` field on Employee retained as no-op (it was removed in v1.14 but we keep the field on the data model so older backups don't fail validation). New `eligibleGroups` field defaults to undefined for legacy data, which the auto-scheduler treats as "open eligibility unless `eligibleStations` is set".

## v1.15.0 — 2026-04-28

Six user-reported quality-of-life fixes.

**1. Comp-day mitigation reframed.** The OT analysis tab's comp-day row used to suggest "replace 2× premium with comp day" — wrong post-1.14 since Art. 74 entitles workers to BOTH. The text and CTA now read as a compliance reminder ("Schedule the OFF day too — engine will flag any PH-work day with no rest in 7 days") and the button deep-links to the schedule.

**2. Painted leaves now show in the roster's leave history.** New `deriveLeaveRangesFromSchedule` walks contiguous AL/SL/MAT runs in the active month and synthesises LeaveRange entries. The Credits & Payroll tab's leave-count + tooltip merges manual ranges with painted ones via the new `listAllLeaveRangesIncludingPainted` helper, so painting a leave on the schedule is visible from the roster card immediately.

**3. Workforce planning anchored to stations.** Pre-1.15 the rollup grouped by role label (Cashier, Driver, Standard…) — but role names change while station identities don't. v1.15 adds a per-station rollup as the primary view: each row is a physical station with its annual demand-hours, peak-month FTE need, current eligible employee count, and hire/hold action. The phantom "Standard" bucket is gone — the supervisor reads "Cashier Point 1 needs 2 FTE, you have 3 eligible" rather than abstract role categories. PDF export updated to match.

**4. Names column actually sticky during horizontal scroll.** react-window's overflow:auto container was intercepting the body row's `position: sticky; left: 0`, so the names column scrolled away with the day cells. Replaced the CSS sticky with a JS scroll handler that translates `[data-sticky-left]` elements by `-scrollLeft` to keep them visually pinned. Also re-applies on row mount/update via MutationObserver so virtualization re-renders don't lose the offset. The day header still uses CSS sticky since it lives outside the List.

**5. Sidebar scrollbar restyled.** Apple-style thin pill thumb on a faded track, matching the schedule top-rail and OT-analysis scrollbars. The OS default chunky scrollbar is gone.

**6. Sidebar tabs reorganised.** Tabs are now grouped by usage frequency: **Operations** (Compliance, Schedule, Roster, Payroll), **Analytics** (Coverage&OT, Workforce, Reports), **Setup** (Stations, Shifts, Holidays, Variables), **System** (Audit, Settings). Group headers use a small caps label so the navigation reads as a hierarchical menu rather than a long flat list.

**Tests** — 89 total (2 new station-rollup tests, all passing).

## v1.14.0 — 2026-04-28

Legal-correctness pass + Workforce Planning v2.

**Holiday compensation — Art. 74 corrected**
- Pre-1.14 the OT analysis tab and PayrollTab let the supervisor toggle "comp day in lieu" per holiday, dropping the 2× cash premium to 0× when chosen. That modeled Art. 74 as an OR (cash XOR comp day), which is the strict-grammar reading. In our sector's prevailing CBA interpretation, the worker is entitled to BOTH: the cash premium for working AND a comp rest day (the rest portion of Art. 73 isn't waived just because Art. 74 also applies).
- v1.14 removes the choose-comps modal entirely. Holiday hours always pay 2×; the comp rest day is a scheduling obligation tracked separately. The compliance engine's "Comp day owed" warning fires by default for any PH-work day with no OFF in 7 days, no opt-in required (reverted to v1.10 default-on semantics).
- The `holidayCompensations` field on Employee is retained on the data model for forward-compat but is no longer read by the math.

**Workforce Planning — two strategies**
- New `mode` parameter: `conservative` or `optimal`. The supervisor picks via an Apple-style segmented control at the top of the tab.
  - **Conservative** (default): pure FTE, hire-to-peak, never recommend release. Sized for the busiest month and held through valleys. Carrying excess capacity through valley months is cheaper than the legal/social cost of releases under Iraqi Labor Law (Art. 36/40 — fixed-term renewals become open-ended FTE; dismissals require Minister of Labor approval).
  - **Optimal**: cost-minimising FTE baseline + part-time surge mix. Cheaper on paper but requires scaling the workforce up/down across the year — legally complex.
- Action labels: `release` is gone from the recommendation vocabulary entirely. When current > recommended, the planner surfaces `hold` instead — carry the surplus through valleys, don't fire anyone.
- New "Annual rollup" panel above the monthly chart: one row per role with the year-round recommendation (peak FTE in conservative mode, monthly average in optimal). Includes the per-role peak-month indicator and a plain-language reasoning line.
- New top-right Apple-style switch toggles between **Comparative** view (current vs recommended side-by-side) and **Ideal-only** view (standalone recommendation, easier to share with stakeholders).
- New PDF export — single-click report download for HR Director / CEO. Includes the annual summary, per-role rollup table, monthly demand breakdown, and the legal-safety premium calculation.
- KPI strip in ideal-only mode shows the **legal-safety premium**: the IQD/yr cost of choosing conservative over optimal — what the supervisor is paying to avoid the legal complexity of releases.

**Tests**
- Updated `workforcePlanning.test.ts`: 4 new tests for conservative/optimal mode behaviour + buildAnnualRollup. 21 tests total in this file.
- Updated `compliance.test.ts`: reverted comp-day-owed tests to default-on semantics.
- Updated `otAnalysis.test.ts`: removed the comp-choice tests.
- 87 tests total across the suite, all passing.

**Architecture**
- `src/lib/workforcePlanning.ts` — added `PlanMode`, mode-aware `recommendMix`, `buildAnnualRollup`, `AnnualRollup` interface.
- `src/tabs/WorkforcePlanningTab.tsx` — rewritten with mode toggle, view toggle, annual rollup panel, PDF export.
- `src/components/HolidayCompensationModal.tsx` — deleted.
- `src/lib/otAnalysis.ts` — `EmployeeOT.compensatedHolidayHours` / `uncompensatedHolidayHours` removed; holiday hours always pay 2×.

## v1.13.1 — 2026-04-28

Hotfix on top of v1.13.0.

**Sticky names column on the top-rail scrollbar**
- v1.13.0 added a top-rail scrollbar that mirrored the FULL grid width — including the sticky-left name column zone. This meant the rail's thumb position didn't map cleanly to the day cells: dragging the thumb 50% of the way right wouldn't show day 15 below it because the rail's content included the 224 px name column area too.
- v1.13.1 splits the rail into a sticky-left "personnel" placeholder (matching the names-column width) and a flex-1 scroll mirror that holds only the day-cell scroll. The names column zone is now anchored at the left of BOTH the rail and the grid; the rail thumb maps directly to day-cell scroll position.
- A small ⇄ glyph in the placeholder hints at the bidirectional scroll affordance.

## v1.13.0 — 2026-04-28

UX polish + Workforce Planning goes annual. Four user-reported quality-of-life requests addressed in one batch.

**Schedule grid — sticky top-rail scrollbar**
- Pre-1.13 the only horizontal scrollbar lived at the bottom of the grid container. With 30+ employees on screen the bottom of the grid is OFF-SCREEN, so panning across the calendar required scrolling the whole page down to find the bar, dragging it, then scrolling back up. v1.13 adds a synchronised "rail" scrollbar at the top of the grid that stays inside the visible viewport — drag either thumb and both move in lockstep. Apple-style thin pill thumb on a faded track, always visible.

**Apple-style toggle component**
- New `<Switch>` component replaces raw `<input type="checkbox">` for boolean feature toggles. Pill track + sliding circular thumb + 220 ms ease-out cubic, focus ring matches the accent. Five tones (indigo / emerald / rose / amber / blue) so the colour itself can signal meaning (rose for "enforce" rules, emerald for "counts as work", etc.). Replaced in EmployeeModal, ShiftModal, BulkAssignModal, and VariablesTab. Multi-select row checkboxes (Roster) stay as actual checkboxes since they're for data selection, not feature state.

**Tab transitions polished**
- The lazy-loaded tab swap now uses an Apple-flavour ease-out cubic (`cubic-bezier(0.22, 1, 0.36, 1)`) with a slight scale + vertical lift instead of plain linear opacity. 220 ms duration. Subtle but the transition feels intentional.

**Workforce Planning — annual analysis**
- Pre-1.13 the tab analyzed only the active month, which made the recommendation jumpy: Ramadan dropped demand, Eid spiked it, and the supervisor couldn't see the bigger picture. v1.13 runs the monthly analyzer for every month of the year and surfaces:
  - **Annual KPI strip**: total annual demand-hours, average recommended FTE/PT across the year, payroll delta vs (current monthly bill × 12).
  - **Monthly demand bar chart**: 12 bars with the peak month flagged red, valley month flagged green, and the active drill month flagged blue. Click any bar to drill into that month's per-role plan.
  - **Per-role drill-down**: collapsible cards showing current vs recommended FTE/PT for the picked month, with the same demand-split visual + per-station breakdown as before.
  - **Implementation timing table**: 12 cards, one per potential start month. Each shows the IQD savings if the supervisor adopts the recommendation from that month forward (months before stay on current; months from start onward switch to recommended). Use this to decide WHEN to roll out the change — savings shrink the later you start, and the panel makes that visible at a glance.
- Math lives in `src/lib/workforcePlanning.ts` as `analyzeWorkforceAnnual` (6 new unit tests covering aggregation, peak/valley detection, savings table sign-correctness).

**Tests**
- 6 new annual-workforce tests bringing the file to 17. 86 tests total, all passing.

**Architecture**
- `src/components/ui/Switch.tsx` — new toggle primitive.
- `src/lib/workforcePlanning.ts` — extended with `analyzeWorkforceAnnual` + `MonthlyPlanSummary` + `AnnualWorkforcePlan` types.
- `src/tabs/WorkforcePlanningTab.tsx` — rebuilt around the annual view.
- `src/index.css` — scroll-rail, slider, and toggle styles + Apple ease-out cubic for shared use.

## v1.12.0 — 2026-04-28

UX polish + Workforce Planning tab. Three reported UX issues from v1.11 plus a substantial new tab that answers "what does my ideal roster look like?".

**Schedule toolbar layout (UX #1)**
- Pre-1.12 the master-schedule toolbar used `flex flex-col lg:flex-row` so it switched to a single row at lg+ widths. With the suggestion pane open the main content is ~1010px on a 1366×768 laptop — tighter than `lg:` assumes — so the rightmost buttons (Auto-Schedule, Print) ended up obscured by the pane. v1.12 raises the breakpoint to `xl:` and adds explicit `flex-wrap` so the toolbar wraps cleanly inside the padded area regardless of pane state.

**Suggestion-pane queue + mass-change detection (UX #2)**
- Pre-1.12 each new gap REPLACED the prior coverage hint, so painting absences for two employees in sequence dropped the first suggestion the moment the second paint fired. v1.12 maintains a queue of pending hints — the pane shows the head as the "active" suggestion plus a `+N queued` badge, and dismissing/picking advances to the next.
- New "Bulk operation detected" banner: when ≥3 distinct gaps open within an 8-second window the pane surfaces a one-click CTA to re-run the auto-scheduler in preserve-absences mode. That's the right answer at scale — picking substitutes one by one is slow when the supervisor is stamping leaves on a whole crew.
- Auto-dismiss policy unchanged from v1.10.1: hints only disappear when the originally-vacated employee comes back to the station (Ctrl+Z scenario). All other paths leave the queue intact.

**OT analysis CTA clarity (UX #3)**
- The comp-day mitigation row's CTA was labeled "Open payroll" which was unclear about what it would do. Renamed to "Choose comps" with a more explicit body explaining that the modal lets you pick which holidays to compensate per employee and that pay drops from 2× to 1× regular wage for those dates.

**New: Workforce Planning tab (sidebar position #3)**
- Sidebar order: Compliance Dashboard (01), Coverage & OT Analysis (02), Workforce Planning (03), then the operational tabs. New `Building2` icon to differentiate from Roster's `Users`.
- Math lives in `src/lib/workforcePlanning.ts` (pure function, 11 unit tests). Per role:
  - Sums monthly demand-hours = open-window × required headcount × applicable days (peakMinHC on peak days/holidays, normalMinHC otherwise).
  - Splits demand into peak vs non-peak. When peak demand exceeds 1.25× non-peak, the recommendation switches to an FTE+PT mix (FTEs for the baseline, part-timers at 96h/mo for the surge — cheaper than scaling FTE for peak). Otherwise stays all-FTE.
  - Drivers use Art. 88 caps (224h/mo); everyone else uses Art. 67/70 (192h/mo).
- Per-role card shows: current count vs recommended FTE vs recommended PT, payroll delta, peak/non-peak demand visual, plus a per-station breakdown of where the demand comes from.
- Top-level KPI strip: Ideal FTE (all-FTE math), Recommended FTE, Part-time, Monthly payroll delta vs current.
- "Method" panel explains the recommendation logic so the supervisor can sanity-check it.
- Empty / no-demand states with shortcuts to Stations / Roster.

**Tests**
- New `workforcePlanning.test.ts` (11 tests): empty/zero-demand, flat demand → all-FTE, peak-only → all-PT, peak-lift → mixed, driver caps separated, payroll delta sign.
- 80 tests total, all passing.

**Architecture**
- `src/lib/workforcePlanning.ts` — pure analyzer.
- `src/tabs/WorkforcePlanningTab.tsx` — code-split, lazy-loaded.
- App.tsx wires the new pane queue (`coverageHints: PendingHint[]` instead of single hint) + mass-change detector.
- SuggestionPane gains `pendingCount` + `massChangeDetected` + `onRunOptimal` props.

## v1.11.0 — 2026-04-28

Holiday-comp-day workflow. Iraqi Labor Law (Art. 74) lets the supervisor compensate public-holiday work either with the 2× cash premium or by granting a paid day off in lieu within 7 days. Pre-v1.11 the app paid the cash premium regardless and tracked `holidayBank` as an opaque counter — there was no way to actually realise the legal alternative and save the venue the premium. v1.11 adds the explicit per-employee, per-holiday choice, and propagates it through every cost surface.

**New: per-holiday compensation choice**
- New `holidayCompensations: string[]` field on Employee (YYYY-MM-DD list of dates the supervisor has elected to grant a comp day in lieu). Pre-v1.11 saves migrate to undefined (treated as empty list — every holiday hour pays double, identical to v1.10 behaviour).
- New `HolidayCompensationModal` lets the supervisor pick per worked holiday: pay 2× cash OR grant a paid off day in lieu. Live "premium savings" preview shows the IQD impact as choices toggle. Comp-all / Pay-all bulk buttons for fast setup.
- Modal opens from two places: Credits & Payroll (per-employee row, when the employee worked any holiday) and Coverage & OT Analysis (Coins button on each top-burner row + the comp-day mitigation card's CTA pre-fills the highest-uncompensated-pressure employee).

**OT math now respects the choice**
- `lib/otAnalysis.ts` splits holiday hours into `compensatedHolidayHours` (pay 1× regular, already covered by base salary → 0 extra premium) and `uncompensatedHolidayHours` (pay 2×). The byEmployee detail now includes a `holidayDates` array with per-date `compensated` flags so UIs can show what's still pending.
- The Coverage & OT Analysis tab's "Holiday (2.0×)" KPI and per-station / per-employee breakdowns now reflect only uncompensated hours. Granting a comp day visibly drops the IQD figures across every surface in real time.
- Compliance Dashboard's "Monthly OT Premium" cell honours the same split: only uncompensated holidays contribute to the IQD total, so the supervisor sees the realised savings on the headline.
- Credits & Payroll's "OT Amount" column shows compensated vs uncompensated hours separately and surfaces a one-click button per-row to open the modal.

**Compliance engine semantics**
- "Comp day owed" finding now fires only when the supervisor has explicitly opted into comp-day-in-lieu for that date AND no OFF/leave appears within 7 days. If they're paying the 2× cash premium, Art. 74 is satisfied by the cash and the warning is suppressed. Pre-v1.11 saves with empty `holidayCompensations` default to pay-double semantics — "Public holiday worked" info finding still surfaces them.

**Suggestion-pane (carryover from v1.10.1, restated for visibility)**
- Auto-dismiss now only fires when the originally-vacated employee comes back to the station (Ctrl+Z scenario). All other paths leave the hint visible until the user clicks X or picks a candidate. Fixes the "hint flashes off when I paint a single OFF on someone" report.

**Tests**
- Added 5 new otAnalysis tests for compensation behaviour: single comp drops pay to 0, default keeps 2×, partial comp across multiple holidays, per-date `compensated` flags exposed in `byEmployee.holidayDates`.
- Updated 5 existing comp-day-owed compliance tests to use the new opt-in semantics (was: warning fired by default; now: only when comp was explicitly chosen).
- Added a "default keeps cash premium" regression test so future changes can't silently re-default.
- 69 tests total, all passing.

**Architecture / files**
- `src/components/HolidayCompensationModal.tsx` — new modal component.
- `src/lib/otAnalysis.ts` — split fields; `analyzeOT` and `suggestMitigations` honour compensations.
- `src/lib/compliance.ts` — `Comp day owed` short-circuits when not opted in.
- `src/lib/migration.ts` — recognises `holidayCompensations` array on load; drops malformed entries silently.
- `src/tabs/PayrollTab.tsx` + `src/tabs/DashboardTab.tsx` + `src/tabs/CoverageOTAnalysisTab.tsx` — all three honour the split.

## v1.10.1 — 2026-04-28

Hotfix on top of v1.10.0.

**Suggestion pane — final fix for the disappearing hint**
- v1.10.0's auto-dismiss was still wrong for stations with overlapping multi-shift coverage. Example: cashier station with `peakMinHC: 1` covered by Morning + Evening shifts on the same day means TWO employees are at the station (different hours). Painting OFF on the morning worker left the evening worker visible, so the heuristic counted "still filled" and dismissed the hint — even though the morning hours are now actually uncovered.
- v1.10.1 simplifies the rule: auto-dismiss ONLY when the originally-vacated employee has been reassigned back to the station (typical undo case). All other paths leave the hint open until the user explicitly dismisses (X) or picks a candidate. This matches the user-reported expectation that hints should persist after a paint until acted on.

**Dashboard OT premium — visible breakdown**
- The "Monthly OT Premium" cell on the Compliance Dashboard now shows the over-cap : holiday split inline beneath the total. e.g. `12,300,000 IQD` headline with `2,900,000 over-cap · 9,400,000 holiday` underneath. Pre-1.10.1 the IQD figure mixed both pools and didn't tell the supervisor which lever to pull. The Coverage & OT Analysis tab continues to be the deep-dive view; this is a pointer.

## v1.10.0 — 2026-04-28

OT-truth release. Two user-reported bugs from v1.9.0 + a substantial new tab to answer "why is the OT bill so high?".

**Bug fixes**
- **Suggestion pane no longer flashes off on manual paint.** Pre-1.10 the live-refresh effect dismissed the hint the moment ANY worker had a station-bound work shift at the gap's station — even if the station's `peakMinHC` was 2 and only one worker remained, or when the next paint immediately replaced the previous gap. The new auto-dismiss only fires when the gap is genuinely closed (the original employee was reassigned back, or another employee has taken a station-bound work shift such that the headcount meets the requirement). For permissive-mode hints (cashier stations on non-peak days where `normalMinHC: 0`) the hint persists until the user dismisses or picks a candidate — silent suppression was the wrong answer there.
- **Manual paint now uses permissive coverage detection.** Painting a non-work shift over a working cashier on a non-peak day used to silently produce nothing (because `normalMinHC: 0` told the strict detector "no gap"). The same permissive pipeline that v1.9.0 introduced for the leave flow is now used for manual paints — the supervisor always sees substitute candidates when they remove someone from a working cell.

**OT attribution — honest about both pools**
- The dashboard advisory + simulation used to count only over-cap hours (paid 1.5×) as "OT". Holiday-premium hours (Art. 74, paid 2.0× regardless of cap) didn't show up in `totalOTHours`, so a clean run with everyone at-cap could still produce millions of IQD in premium pay yet report "remaining OT 0". The simulation now reports holiday hours as a separate residual pool with the correct caveat: hires CANNOT eliminate them — only comp days or fewer holiday operations can.
- The new `src/lib/otAnalysis.ts` is the single source of truth for both pools. It splits per-employee and per-station OT into:
  - **Over-cap pool** — hours over the monthly cap (excluding holiday hours, which are already paid 2× so we don't double-charge them in the 1.5× pool). Hires absorb this.
  - **Holiday-premium pool** — every hour worked on a public holiday in the active month. Comp days within 7 days convert the 2× premium to a 1× wage.

**New: Coverage & OT Analysis tab**
- Sidebar position #2 (right after Compliance Dashboard). Compliance stays first.
- Top KPI strip: total OT cost, over-cap pool, holiday pool, public holidays in this month.
- "Why we have OT this month" panel with a stacked-bar visualisation showing the over-cap : holiday split, plus a per-holiday chip list.
- Per-station OT breakdown: each station's total OT pay, with the over-cap : holiday share visualised inline. OT hours are attributed to stations proportionally to where the over-scheduled employees worked.
- Per-employee burner list (top 20, with link to Reports for full export): total hours vs cap, over-cap hours, holiday hours, total IQD impact.
- Mitigations panel with three actionable suggestions:
  - **Hire +N to absorb over-cap OT** (links to Compliance Dashboard advisory)
  - **Grant N comp days for holiday work** (links to Credits & Payroll)
  - **Re-run auto-scheduler in strict mode** (one-click button to schedule)
- Empty-state: friendly "no schedule yet" prompt with shortcuts to Roster + Schedule.

**Tests**
- New `otAnalysis.test.ts` (11 tests): empty / clean state, over-cap pool, holiday pool, no double-counting when both apply, station attribution, mitigation suggestions.
- 64 tests total, all passing.

**Architecture**
- `src/lib/otAnalysis.ts` — `analyzeOT` + `suggestMitigations` are pure functions. The new tab and the dashboard advisory both consume them so the totals never disagree.
- `src/tabs/CoverageOTAnalysisTab.tsx` — code-split, lazy-loaded like every other tab.
- `simulateWithExtraHires` extended with `remainingHolidayHours` so the simulation readout can flag the structural premium that hires can't fix.

## v1.9.0 — 2026-04-28

Quality + accuracy release on top of v1.8.0. Closes the four open follow-ups from the v1.8.0 batch (test coverage for the new helper modules, narrow-viewport pane behaviour, PH cross-month handling) and fixes four user-reported issues with the auto-scheduler advisory pipeline + dashboard recommendations.

**Bug fixes**
- **Leave-driven coverage hints now fire for every employee category, not just drivers.** Adding annual / sick / maternity leave on a cashier or operator previously produced no swap suggestions because the cashier stations have `normalMinHC: 0` on non-peak days — the gap detector treated the dropped shift as "not required" and stayed silent. The leave-pipeline now uses a permissive detection mode that surfaces substitutes whenever a work shift is removed, regardless of the station's minimum threshold. Strict (manual-paint) detection is unchanged so cycling a cell at a non-required station still doesn't spam toasts.
- **Dashboard advisory + strategic-growth gating.** The Strategic Growth Path card and the 3-mode Staffing Advisory now only render when the supervisor has finished basic setup: at least one employee in the roster, stations defined, work shifts defined, every non-driver assigned to ≥1 eligible station, and a schedule painted (auto or manual) for the active month. While setup is incomplete a checklist banner replaces the cards so the supervisor sees exactly what is still missing instead of advice computed from an empty dataset.
- **Duplicate Staffing Advisory panel removed.** v1.8.0 introduced the new 3-mode StaffingAdvisoryCard but left the older small "Staffing Advisory" panel mounted as well, so the dashboard was showing the same hire counts in two places. The old panel is gone — its content is fully covered by the new card with per-mode tabs + per-station breakdown + simulation.

**Staffing Advisory upgrades — accurate, station-aware, simulation-validated**
- **Per-station breakdown for every mode.** Each mode now lists exactly which stations the recommended hires would land at, the reason each station is in the list (`OT pressure` / `Peak shortfall` / `Both`), and the numerical evidence (monthly OT hours attributed to that station + the peak-hour FTE shortfall). OT is distributed across stations proportionally to the hours an over-scheduled employee actually worked there, so a cashier burning OT covering Cashier 2 puts the recommended hire on Cashier 2, not on a generic queue.
- **Validate with simulation button.** Each mode has a "Run" button that injects phantom hires (one per recommended slot, pinned to the station that drives that recommendation) and re-runs the auto-scheduler. The result reports residual OT hours and residual coverage gap days so the supervisor can sanity-check the recommendation against a real run before approving any headcount. A clean run flips the readout green; a partial result shows what's still left for a follow-up pass.
- **Math now lives in `src/lib/staffingAdvisory.ts`.** The OT-attribution + per-station-hire logic is its own pure function with 15 unit tests and a `simulateWithExtraHires` helper that re-runs the scheduler.

**Auto-scheduler results UI**
- **Hero header on the preview modal** with the compliance-score percentage front and centre, gradient backdrop matching the violation tier (clean / mild / heavy), and a larger-format icon so the user sees at a glance whether the run was clean.
- **Hours-by-role becomes a bar chart.** The flat list of role-keyed totals is now a horizontal bar visualization with each role coloured distinctly so the workload distribution reads at a glance.
- **Findings split into Hard Violations vs Informational Notes.** v1.7.2's severity tier wasn't honoured by the preview modal — info-severity findings (PH worked, Comp day owed) were shown alongside hard violations in the same red-tinted list. The two columns now render side-by-side with their own colours so the supervisor can tell at a glance which findings will lower the compliance score and which are advisory only.
- **Better empty state**: "Clean run — you can apply this with confidence" instead of a thin one-line note.

**Comp-day cross-month handling (Art. 74)**
- The compliance engine's `Comp day owed` check used to bail at the month boundary — a public holiday worked on Jan 28 with no OFF in days 29-31 was treated as "supervisor handles it next month" and produced no finding. When the next month's schedule already exists, the check now peeks into it so a late-month PH-work can be compensated by an early-month OFF in the following month. If the next month hasn't been generated yet the original behaviour applies (no false positive at the boundary).

**Suggestion pane — narrow-viewport responsiveness**
- The 340px right rail used to leave laptops at 1366×768 with the schedule grid cut in half. The pane now starts collapsed below 1280px viewport width and auto-tracks resize crossings — until the user manually expands or collapses, after which their preference wins for the rest of the session. The collapsed state still surfaces the unread-changes count and gap dot.

**Tests + observability**
- **`src/lib/__tests__/staffingAdvisory.test.ts`** — 15 unit tests covering all three modes, per-station breakdown, edge cases (empty roster, negative gaps, salary fallback).
- **`src/lib/__tests__/coverageHints.test.ts`** — 8 unit tests covering strict mode (manual paint), permissive mode (leave pipeline), driver vs non-driver paths, and `findSwapCandidates`.
- **`src/lib/__tests__/autoScheduler.test.ts`** — 5 tests covering PH-debt rotation, holiday-day assignment, balanced workload, complete-month population, and `preserveExisting` mode.
- **`compliance.test.ts`** — added 5 tests for `Comp day owed` (rule firing, OFF in window, empty cells in window, cross-month boundary handling, holiday-day OFF means no PH work).

**Architecture**
- `lib/staffingAdvisory.ts` — `computeStaffingAdvisory` now returns per-station breakdowns; new `simulateWithExtraHires` runs the auto-scheduler with phantom hires and reports residual OT + gap.
- `lib/coverageHints.ts` — `detectCoverageGap` accepts an optional `permissive` flag for the leave-pipeline path.
- `lib/compliance.ts` — `Comp day owed` reads the next month's schedule from `allSchedules` when the comp window crosses month boundary.

## v1.8.0 — 2026-04-28

Major UX + advisory release. Four substantial additions in one batch: PH comp-day awareness in the auto-scheduler + compliance engine, a persistent right-side suggestion pane on the Schedule tab (replaces the bottom-right toast), a 3-mode hiring advisory on the Dashboard, and several focused improvements to the Master Schedule grid.

**Auto-scheduler — public holiday comp days**
- Added per-employee `phDebt` tracking inside `runAutoScheduler`. Working a public holiday increments debt by 1; the after-day OFF/leave pass decrements it. The candidate sort now pushes employees with unmet PH debt LATER in work priority (heavier weight than the existing soft preference bias) so they naturally rotate to OFF in the days after a holiday — satisfying the "comp day in the following week" expectation under Art. 74 without scheduling extra rest days arbitrarily.
- Companion compliance check: a new `Comp day owed` info-severity finding fires when a PH-work day isn't followed by any OFF / leave within 7 days. Same severity tier as the v1.7.2 PH-worked finding (informational, not a violation) so it appears in reports without dragging down the compliance score.

**Right-side Suggestion Pane (replaces CoverageHintToast on Schedule tab)**
- New `SuggestionPane` component — fixed right rail, ~340px wide, full viewport height. Two sections:
  1. **Coverage suggestions** — the same swap-candidate logic the toast used to show, but persistent. When there's no active gap a pleasant "All stations covered" state appears.
  2. **Recent changes** — per-session log of cell modifications (paint, cycle, swap, leave-stamp) with one-click undo per entry. Capped at 50 entries; "show more" expands beyond the first 10.
- Pane is collapsible to a thin tab against the right edge (with a status dot if a gap is active and a count badge for unread changes). The Schedule tab applies right-padding only when the pane is open so the grid never slides under it.
- The CoverageHintToast still ships and is shown on non-Schedule tabs, so cross-tab edits (e.g. adding a leave from Credits & Payroll) still surface a toast.

**3-mode Staffing Advisory (Dashboard)**
- New `StaffingAdvisoryCard` with three flavours of hiring strategy as a tab strip:
  1. **Eliminate Overtime** — hires needed to absorb every OT hour into regular FTE shifts.
  2. **Optimal Coverage** — hires needed to fill every peak-hour station gap.
  3. **Best of Both** — the conservative ceiling, max of the two above.
- Each mode shows hires needed, OT saved (IQD/mo), salary added (IQD/mo), and net monthly delta. The footnote spells out that the recommendation is based on current OT — after adding hires, the user must re-run the auto-scheduler so the load gets spread (this directly addresses the "I followed the recommendation but it still says I need to hire more HC" report — the advisor doesn't know about hires that haven't been scheduled yet).
- Math lives in `src/lib/staffingAdvisory.ts` so it can be unit-tested or reused.

**Master Schedule UX**
- **Day-header overhaul**: today indicator (blue ring + ●), holiday dot (top-left), better contrast for weekends/holidays, full holiday name in the cell tooltip.
- **Footer summary bar**: totals across the currently-filtered roster — total work hours, employees at cap (≥100% weekly), employees near cap (≥90%), employees with any leave-day this month, and an X/Y employee count.

**Architecture / new files**
- `src/lib/staffingAdvisory.ts` — pure compute for the 3 hiring modes.
- `src/components/SuggestionPane.tsx` — the right-rail pane.
- `src/components/StaffingAdvisoryCard.tsx` — the dashboard card.

## v1.7.2 — 2026-04-28

Compliance-semantics + leave-sync fixes. The user reported that May produced a "substantial OT" spike and most of the violations were "Worked on a public holiday without an explicit OT or PH designation" — not actually a rule breach, just compensable per Art. 74. Demoted that finding to an informational note so it shows in the report without polluting the violation count or compliance score.

**Compliance**
- New `severity?: 'violation' | 'info'` field on the Violation type. Default is `'violation'` for backward compat. Consumers (Dashboard KPI, simulation delta panel, schedule preview) only count `'violation'`-severity findings; `'info'`-severity findings appear in the report's notes section but don't lower the score.
- Reclassified the **Holiday OT flag** rule (renamed to **Public holiday worked**) as `severity: 'info'`. Working a public holiday is legal under Art. 74 — it just requires double pay or a comp day. The platform now notes the eligibility without flagging it as a rule breach. The supervisor is assumed to process holiday OT in the next payroll cycle.
- The **violations vs notes split** lives in `App.tsx`: `findings = engine.check(...)`, `violations = findings.filter(severity === 'violation')`, `infoFindings = findings.filter(severity === 'info')`. This is the single point of truth — every consumer pulls from the right list.

**Leave management**
- New `stampLeaveOntoSchedule(prevEmp, nextEmp)` helper. When a leave is added or extended via the LeaveManagerModal (or, for back-compat, the EmployeeModal), the schedule cells in the new leave window are automatically stamped with the appropriate code (`AL` / `SL` / `MAT`). No more double-input — the leave manager is now the single source of truth, and the schedule grid updates to match. Existing leave codes are left alone; existing work shifts get overwritten because the user has just declared the employee absent.
- Wired into both code paths (`handleSaveEmployee` for legacy Roster modal saves, `onUpdateEmployee` for the LeaveManagerModal save) alongside the existing `surfaceLeaveCoverageHint` helper, so leave additions both stamp the schedule AND surface a coverage-hint toast for the most-impactful affected day.

**Tests**
- Updated the holiday-OT-flag test to assert the new `severity: 'info'` semantics (was checking for the old `'Holiday OT flag'` rule name and treating it as a hard violation).

## v1.7.1 — 2026-04-28

Hotfix on top of v1.7.0 — surfaces the coverage-hint toast when a leave is added through the new LeaveManagerModal, and reverts the v1.7.0 AnimatePresence wrapper on the auto-scheduler preview that turned out to interact badly with React StrictMode (the modal could get stuck at opacity:0 between consecutive runs).

**Fixes**
- **Leave additions now suggest replacements.** The PayrollTab → LeaveManagerModal save path was missing the leave→coverage-gap pipeline that the legacy EmployeeModal had. Refactored both code paths to share a new `surfaceLeaveCoverageHint(prevEmp, nextEmp)` helper that diffs the employee's leave state across the active month using `getEmployeeLeaveOnDate` (so it works for both v1.7 multi-range and legacy single-range fields), picks the most-impactful newly-vacated day, and surfaces a single coverage-hint toast with swap candidates.
- **Auto-scheduler preview reliability.** Reverted the `AnimatePresence` wrapper introduced in v1.7.0 — combined with React StrictMode's double-mount in dev, it could cause the entry animation to be cancelled by a stray exit and leave the modal at opacity:0. Restored the original direct conditional render (`if (!isOpen || !stats) return null`) and added a `runId` field to `pendingScheduleResult` that's used as the modal's React `key`, so consecutive auto-scheduler runs always force a fresh remount with no stale animation state to recover from.

## v1.7.0 — 2026-04-28

Two-batch release: a focused bug-fix round followed by a feature push. Schema gains an optional multi-range `leaveRanges` field on Employee; old single-range fields stay supported via a unified read helper, so v1.6.x backups load without conversion.

**Workforce features**
- **Multi-range leave manager.** New `LeaveManagerModal` accessed from the Credits & Payroll tab (one button per employee). Each employee can have any number of annual / sick / maternity windows, each with its own start/end and optional notes. Replaces the single date-range fields that used to live on the EmployeeModal — those were misleading because employees rarely take exactly one block of leave per type. The auto-scheduler, compliance engine, and coverage-hint toast now read leave state via `getEmployeeLeaveOnDate(emp, dateStr)` in `lib/leaves.ts`, which transparently handles both the new `leaveRanges` array and the legacy single-range fields.
- **Schedule grid power-ups.** Drag-to-paint (hold mouse + drag across cells in paint mode), Shift+click range fill (rectangle from the last clicked cell to the current one, single bundled undo entry), and per-cell undo (Ctrl+Z) that reverts the most recent paint without losing the rest of the month. The per-cell undo stack is separate from the existing 5-deep Auto-Schedule undo stack.
- **Bulk shift assignment from the Roster.** Select N employees, hit *Assign Shift*, pick a shift code and day range, choose whether to overwrite existing entries — paints the rectangle in one shot.
- **Per-employee labor-law card.** Hover any employee name in the schedule grid for a tooltip showing total hours, hours-vs-cap, peak rolling-7 window, longest streak, and last day worked. A small badge highlights employees at or above 90% of their weekly cap.
- **Compliance trendline (dashboard).** A 30-day sparkline driven by per-day localStorage snapshots. Self-bootstrapping — no setup. Per-company so switching company resets the chart.
- **Print view.** Schedule tab "Print" button renders all employees as a static A3 landscape table with shift colours preserved (`-webkit-print-color-adjust: exact`). Hidden in normal display via `@media print`; the static table sidesteps the virtualised grid's clipping.
- **Dark mode.** Sidebar toggle cycles Light → Dark → System. Tailwind v4 `@variant dark` is wired up alongside global CSS overrides for `bg-white`, `text-slate-*`, and form fields so the app reads cleanly without per-component edits.
- **Daily auto-snapshot.** Electron main process snapshots `data/` once per calendar day on launch, retains the 7 most recent. Independent from the post-update snapshot — gives you a recovery point even between version updates.
- **RTL pass.** CSS shim mirrors `ml-*` / `mr-*` / `pl-*` / `pr-*` / `border-l/r` / `text-left/right` utilities when `dir="rtl"` is set, so icon+text patterns and tab indicators flip correctly in Arabic mode.

**Bug fixes**
- **Auto-scheduler preview reliability.** The `SchedulePreviewModal` is now wrapped in `AnimatePresence` with explicit enter/exit animations. Previously, fast consecutive auto-scheduler runs could leave the panel in a partially-animated state where it never reached `opacity:1` and silently failed to appear.
- **Simulation banner no longer blocks modals.** Lowered the panel's z-index from `z-[80]` to `z-[40]` (below all modals at z-50+) and added a collapse toggle so the user can shrink it to a small floating pill in the bottom-center.
- **Leave fields removed from Employee modal.** The single-range fields were misleading and lived in the wrong place. The Roster modal now points users to the Credits & Payroll tab via a one-line note.
- **Legal Variables tab translates to Arabic.** All cap labels, descriptions, units, section subtitles, the editing-warning panel, and the references footer go through `t()` now (was hardcoded English).
- **Factory reset audit-log spam.** `/api/reset` now writes a single "Factory reset performed" entry server-side. The renderer sets a one-shot localStorage flag so the next save (which would otherwise re-emit dozens of "added employee" entries from the seeded defaults) is sent with `?skipAudit=1`.
- **Clear Audit Log action.** New button on the Audit Log tab with a confirmation modal. Calls the existing `/api/audit/clear` endpoint.
- **Factory Reset moved off the front page.** Removed from the sidebar (where it was tempting to mis-click). Still accessible from System Settings → Database & Security where it belongs.
- **Master Schedule keyboard shortcuts.** Number keys 1–9 select the Nth shift code from the painter row; Esc / 0 clear paint mode. Each painter button now displays a small superscript hint, plus a `1-9 / Esc` legend in the toolbar.

**Architecture**
- New `src/lib/leaves.ts` — single source of truth for "is this employee on leave on this date" with bidirectional support for new multi-range and legacy single-range fields.
- New `src/lib/employeeStats.ts` — per-employee monthly running counters used by the schedule-grid tooltip + cap badge.
- New `src/lib/complianceHistory.ts` — per-company localStorage-backed daily snapshot store powering the trendline.
- New `src/lib/theme.tsx` — ThemeProvider with light / dark / system preference, OS-theme tracking via `prefers-color-scheme`.
- `src/lib/migration.ts` extended to recognize and validate the new `leaveRanges` field; malformed rows are dropped silently rather than blocking the load.
- `electron/main.cjs` adds `performDailySnapshot()` alongside the existing post-update snapshot, with the same rotation pattern.

## v1.6.3 — 2026-04-27

Polish round on top of v1.6.2 — auto-scheduler insights, swap-suggestion UX, and more realistic seeded data. No data-format changes; v1.6.2 backups load directly.

**Auto-scheduler & coverage UX**
- **Strategic Growth Path now answers "where?"** Below the aggregate "Hiring N additional staff" message the dashboard surfaces a per-station gap breakdown (station name, role hint, headcount needed). Mirrors the Staffing Advisory but condensed for the strategic-growth context.
- **Coverage-hint toast: starred recommendation.** The lowest-scoring candidate is now flagged with a star + `Recommended` badge so the most optimal pick is obvious at a glance. Logic lives in `findSwapCandidates` so the badge stays in sync with the scoring.
- **Coverage-hint toast: live refresh.** The toast's candidate list now refreshes on every schedule change while it's open — previously it only populated on the initial paint and could go stale as the user kept editing. If a subsequent edit fills the gap, the toast auto-dismisses.
- **Recently-changed cell highlight.** When the user accepts a swap from the toast, both the source and destination cells flash with a pulsing amber outline for 5 seconds so the user can see exactly which rows moved.
- **Optimal (Keep Absences) button.** New green button on the Schedule tab next to Auto-Schedule. Runs the auto-scheduler in *preserve* mode: every cell the user has manually populated (annual leave, sick leave, maternity, OFF, manual shift overrides) stays locked, and the algorithm fills only the empty cells around them. The locked entries also count toward each day's station headcount and the rolling-7-day window so caps are respected.

**Seeded data**
- Drivers' `eligibleStations` now defaults to the four vehicle stations (`ST-V1..ST-V4`) so they show their assignments in the EmployeeModal and Roster instead of rendering as "Unassigned". The auto-scheduler already routed them via `requiredRoles: ['Driver']` — this just makes the link visible.
- Cashiers seed as a 50/50 gender mix (alternating F/M); operators and drivers default to male. Lines up with realistic venue staffing and gives Art. 86 someone to protect when an industrial-flagged shift is added.
- `enforceArt86NightWork` is now `true` by default, with the standard 22:00–07:00 night window. Existing seed shifts are non-industrial so the rule has no immediate effect — but the moment a user adds an industrial shift, the protection fires automatically. Toggle off in Variables for sectors with a Ministerial exemption.

## v1.6.2 — 2026-04-27

Patch release. The 1.6.0 / 1.6.1 builds failed in CI at NSIS compile time; v1.6.2 ships the same feature set with a working installer.

**Fixes**
- **NSIS:** dropped the named `Var ILS_PreviousVersion` declaration in `build/installer.nsh` (makensis runs with `-WX` warnings-as-errors and reported the var as unused even though the macros referenced it). Replaced with the `$R0` user register inside each macro. v1.6.0 had additionally tried to swap welcome-page text via a runtime `${If}` at script top level — that's only valid inside a Section/Function, so it's been moved into a `MessageBox` inside `customInit`.
- **Workflow:** swapped the unmaintained `samuelmeuli/action-electron-builder@v1` (last release 2021, force-bumped onto Node 24 by the runner) for a direct `npx electron-builder --windows --publish always` invocation. Cleaner logs and removes a wrapper that obscured the NSIS error.

## v1.6.0 — 2026-04-27

Feature batch — multi-company, simulation mode, soft preferences, gender + Art. 86, per-day operating windows, annual-leave workflow, coverage-gap hints, safe-update installer, post-update data snapshot, centralised data-migration layer, real Windows installer icon.

> *(v1.6.0 and v1.6.1 release tags exist in git history but their CI runs failed before publishing — there are no installer artifacts attached to those tags. v1.6.2 is the canonical 1.6.x release.)*

**Workforce features**
- **Multi-company / branches.** Sidebar `CompanySwitcher` with add / rename / delete; each company owns its own employees, shifts, stations, holidays, config, and schedules. Active company is sticky across reloads. On-disk format migrated to `Record<companyId, T>` per domain — single-company backups from v1.5.x and earlier load automatically and lift under a default company id.
- **Simulation / forecasting mode.** Toolbar toggle freezes a baseline, suspends auto-save, and renders a delta panel comparing baseline vs. sandboxed state across workforce, coverage %, OT hours, OT pay (IQD), and violations. Apply / Reset / Discard.
- **Shift preferences.** `preferredShiftCodes` / `avoidShiftCodes` per employee with pill toggles in the Employee Modal. Auto-scheduler honours preferences as a *soft* constraint at strictness level 1 (rejects avoided codes, biases candidate sort toward preferred), ignores at levels 2/3 so coverage is never sacrificed.
- **Gender + Art. 86 night work.** Optional `gender` field. The maternity panel only renders for female employees. New compliance rule + Variables-tab toggle: women on industrial-flagged shifts that overlap a configurable night window (default 22:00–07:00) surface as `(Art. 86)` violations. Auto-scheduler treats it as a hard rule at levels 1 and 2.
- **Per-day operating windows.** New `operatingHoursByDayOfWeek` config with seven day-of-week toggles in the Variables tab. Dashboard heatmap and coverage-% metrics honour per-day overrides — useful when, e.g., Friday closes at 02:00 instead of 23:00.
- **Annual / approved leave.** `annualLeaveStart` / `annualLeaveEnd` date-range fields like maternity / sick. Auto-scheduler stamps `AL`, compliance flags work shifts inside the window.
- **Cross-month rolling-7 awareness.** Compliance engine and auto-scheduler peek at the trailing 6 days of the prior month so weekly caps don't reset arbitrarily on day 1.
- **Coverage-gap hint toast.** When a manual paint vacates a station-bound work shift (or a leave date range empties cells), a non-blocking bottom-right toast surfaces the affected day + station, lists up to 5 swap candidates ranked by score (off-day employees first, preference match, compliance warnings factored in), with one-click swap or "Keep gap" override. The original change is never rolled back.
- **Schedule staleness banner.** Detects schedule entries that reference deleted employees / shift codes / stations; offers an inline "Re-run Auto-Scheduler" button.
- **FTE forecast KPI** added to the Dashboard's top row.

**Installer / safe update**
- NSIS installer detects existing installations via `HKCU\Software\<productName>\Version` and shows a "v{previous} detected — will update in place" `MessageBox` at the start of the wizard.
- Three layers protect user data through an update: `deleteAppDataOnUninstall: false`, the data folder lives outside `${INSTDIR}` by design, and a custom `customUnInstall` macro logs that the data folder is preserved during the silent pre-update sweep.
- **Defensive snapshot.** On first launch after an update, Electron copies the entire `data/` folder to a timestamped `data-backup-<oldVersion>-<ISO-timestamp>/` sibling. Keeps the 5 most recent snapshots; rotates older ones automatically.
- **One-time post-update toast** in the renderer ("Updated to v{X}") naming the previous version and printing the absolute snapshot path.

**Backward compatibility**
- New `src/lib/migration.ts` centralises load-time normalisation across every domain (Employee, Shift, Station, Holiday, Config, Schedule, Company). Old records missing fields added in this release backfill safely to defaults. Legacy bare-string schedule entries auto-upgrade to the modern `{shiftCode, stationId?}` shape. `CURRENT_DATA_VERSION` constant ready for future structural migrations. Wired into both the initial-fetch and backup-import paths.

**Tooling / build**
- Real multi-size Windows installer icon. The repo's `assets/icon.png` was actually a JPEG and `assets/icon.ico` had never been generated, so prior installers fell back to the generic Electron icon. Rewrote `scripts/build-icon.cjs` to use `sharp` (handles JPEG-or-PNG input) → multi-size `png-to-ico` (16/24/32/48/64/128/256). Also emits a clean 256×256 `assets/icon-256.png` for Linux + Electron tray. New `npm run icons` script wired into both `electron:build` and the GitHub Actions release workflow.

**Optimizations / cleanup**
- Replaced 8 native `alert()` calls with the polished `ConfirmModal` (now supports an `infoOnly` mode). Messages now respect RTL layout for Arabic.
- Fixed dead-code path in `hourlyCoverage` requirements computation.
- CSV export quote-escapes cells containing commas / quotes / newlines.
- Initial `/api/data` fetch now falls back to in-memory defaults instead of hanging if the local server is unreachable.

**i18n**
- 50+ new English / Arabic key pairs covering gender, preferences, annual leave, simulation mode, coverage-hint toast, schedule staleness banner, company switcher, info-only dialogs, post-update toast, per-day operating window editor, and the Art. 86 toggle.

## v1.5.0 — 2026-04-26

- **Compliance.** Ramadan reduced-hours mode, maternity leave (Art. 87), sick leave (Art. 84). Engine + auto-scheduler enforce all three.
- **UX.** Inline paint-mode conflict warnings. Live auto-save indicator. Sortable + filterable roster. Full-month coverage heatmap.
- **Performance.** Schedule grid virtualized via `react-window`. Tabs code-split via `React.lazy`. PDF generator lazy-loaded. Initial bundle 918 KB → 448 KB.
- **Accessibility.** Esc closes every modal, focus auto-managed. Icon-only buttons gained `aria-label`. Sortable column headers are real `<button>`s.
- **Domain.** Staffing advisory pivoted from role-guessed to station-pinned — works correctly with any role label.
- **Code quality.** App.tsx 2211 → ~1200 lines via per-tab extraction. Centralized payroll + time helpers. 18 Vitest unit tests on the compliance engine.

## v1.4.0

- Append-only audit log of every change (employees, shifts, stations, schedules, config) with a CSV export.
- Auto-scheduler preview-then-apply flow with a 5-deep undo stack.
- Bilingual UI (English + Arabic) with full RTL layout for Arabic and `t()` interpolation helper.
- Role-aware staffing advisory.

## v1.3.1

- Rotating rest day became the default for new employees.
- "Stations" tab renamed to "Stations / Assets" — vehicles and other non-physical-station assets fit naturally.
- Settings tab deduplicated.

## v1.3.0

- New Legal Variables tab — every cap (daily / weekly / hazardous / driver / OT multipliers) editable in one place with the governing Art. cited next to each value.
- App.tsx refactor — split into per-tab modules.
- Signing-ready metadata in package.json (publisherName, legalTrademarks).

## v1.2.0

- Driver / Transport mode (Art. 88) — 9h daily / 56h weekly cap, 4.5h continuous-driving cap, 11h min daily rest.
- Rotating Rest Day option per employee.
- Server hardening — bound to `127.0.0.1` only, atomic writes, factory-reset confirmation token.

## v1.0.x — v1.1.0

Initial public releases. Standalone Electron app with Vite-built React frontend, embedded Express server on `127.0.0.1:3000`, JSON-on-disk persistence under `%APPDATA%\Roaming\iraqi-labor-scheduler\data\`. Compliance engine v1: Art. 67 / 68 / 70 / 71 / 72 / 73 / 74. Single-company.
