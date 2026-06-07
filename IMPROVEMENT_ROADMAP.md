# Iraqi Labor Scheduler — Improvement Roadmap (v5.26.0)

> **Implementation status (v5.27.0, branch `feature/data-trust-batch`):** ✅ **Batch 1 (Data Trust & Safety) shipped** — leave-queue persistence, employee/station delete-orphan fixes, online backup-import guard, immutable-audit Clear guard, modal ID validation, StationModal dirty-guard, real Reports coverage tile, PDF Arabic-tofu fix. tsc clean, 443 tests pass (+13). "Confirm before Rebuild From Scratch" was intentionally **skipped** (the preview-and-apply flow + 5-deep undo stack already protect that path). Batches 2 (UX) and 3 (compliance/a11y/i18n/perf) below are not started.


> Generated 2026-06-07 by a 67-agent code-grounded review (map → 8 review lenses → cluster → adversarial verify → synthesize). 103 raw findings → 49 candidates → **48 verified**, 1 killed (theme switcher already exists in LocaleSwitcher). Each item below was checked against the real code and the project philosophy (reporting-not-enforcement, dual-mode parity, local-first).

## Executive Summary

The app is a mature, dual-mode (offline JSON / Firestore) workforce scheduler with deep Iraqi Labor Law compliance, a complete bilingual EN/AR layer, and a thoughtful reporting-not-enforcement philosophy. Its core engines (compliance, payroll, gratuity, auto-scheduler, fines, findings) are well-factored and broadly correct; most gaps are at the *edges* — data-integrity boundaries (a non-persisted leave queue, silent Firestore overwrites on duplicate keys, orphaned schedule entries), unfinished UX wiring (two competing setup checklists, a wizard with no entry point, hidden coverage on manual shifts), and an incomplete accessibility/RTL/contrast pass. The single biggest risk cluster is **data trust**: a handful of paths silently lose or corrupt data, which is corrosive for a compliance tool. The biggest *leverage* is a set of small (S) fixes — PDF Arabic tofu, identifier validation, CSV hardening, contrast — that materially raise polish and trust for very little effort.

A few candidate framings were found partly inaccurate during verification (e.g. fines exposure is *already* on the Dashboard; Payroll already shows truthful net leave balance; the holiday-tier "self-disagreement" is actually self-agreement). Those are reframed below so you don't pay for work that's already done.

---

## Quick Wins (high impact, low effort — S)

| Title | Area | Why it helps | Effort |
|---|---|---|---|
| **Validate empId/code/id on modal saves** | Data trust | Stops silent Firestore doc overwrites and lost employees from duplicate/`/`-bearing keys | S |
| **PDF Arabic labels render as tofu** | i18n / Reporting | Force English labels + warn on Arabic names so the compliance PDF is actually readable | S |
| **Harden schedule CSV (BOM/CRLF/charset/revoke)** | Data trust | Fixes Arabic-name mojibake in exports; mirrors the already-correct Payroll exporter | S* |
| **Raise muted-label contrast above WCAG AA** | Accessibility | slate-400 = 2.56:1 fails AA; one find/replace fixes light mode, no-op in dark | M (S core) |
| **prefers-reduced-motion support** | Accessibility | One CSS block + `MotionConfig` kills vestibular-triggering pulses/spinners app-wide | S |
| **Disable Audit-log Clear in Online mode** | Data trust | Removes a misleading "cleared" toast on an immutable Firestore trail | S |
| **aria-sort on SortableHeader** | Accessibility | One shared component fixes sort semantics on every table | S |
| **Sticky first column on dense tables** | UX | Native `position: sticky` keeps names visible while scrolling wide Payroll/Roster tables | S |
| **Roster select-all safe across filters** | UX | Stops bulk-delete from silently acting on filter-hidden rows | S |
| **Defer auto-save JSON.stringify to debounce** | Performance | Removes per-paint full-dataset serialization on the hottest interaction path | S |
| **Replace fake "Coverage Status: Authenticated" tile** | Data trust | Wires the already-computed coverage % into Reports so the badge means something | S |
| **StationModal dirty-guard** | UX | Brings the one outlier modal in line with Employee/Shift/Holiday unsaved-changes protection | S |
| **Re-launch Venue Wizard + fix bare-preset holiday drop** | UX / Config | Makes a documented-but-dead re-run promise real; fixes a discarded holiday answer | S |
| **Confirm before "Rebuild From Scratch"** | UX / Safety | Adds a scope-named confirm to the only destructive auto-schedule path | S |
| **RTL-aware wizard arrows** | i18n / RTL | One CSS `.rtl-flip` helper points nav arrows the right way in Arabic | S |
| **i18n scattered hardcoded a11y labels** | i18n | Closes ~8 English leaks in Arabic mode by reusing existing keys | S |
| **Non-blocking auto-scheduler spinner** | Performance / UX | rAF-yield spinner (pattern already used in 4 components) ends the freeze on Run | S |

\* CSV hardening is the S core of a larger M item (it also adds Reports empty-state guards).

---

## Missing Features

- **Persist the leave-request queue.** It is in-memory only and vanishes on reload/restart/company-switch in *both* modes — a direct dual-mode-parity violation, and two docstrings actively claim the opposite. Approved leaves survive (they stamp the employee), but the pending queue, rejections, and decision audit evaporate.
  **How:** Add `leaveRequests` as a first-class domain — `server.ts` COMPANY_DOMAINS + diff branch; `App.tsx` emptyCompanyData/load-map/the three offline body builders/import-backup/audit+sync switches/subscription effect; `firestoreDomains.ts` thin `syncLeaveRequests`/`subscribeLeaveRequests`; `audit.ts` diff branch; check `firestore.rules`. **Dual-mode:** this *is* the parity fix. Effort **M**.

- **Station picker in the schedule painter.** The write path already persists `stationId`; only the UI control to set it is missing, so every hand-painted shift is invisible to station coverage counts.
  **How:** Add a station `<select>` (with an "Auto" default) to the painter strip in `ScheduleTab.tsx`; preserve `stationId` across shift-pill/keyboard re-selection; extract a shared `eligibleStationsForEmployee` helper. **Dual-mode:** free — `ScheduleEntry.stationId` already round-trips both layers. Effort **M**.

- **"Copy previous month" + "Copy week → next week".** Stable rotations are re-painted by hand every period; cross-month data is already in memory and keyed by month.
  **How:** `handleCopyPreviousMonth`/`handleCopyWeek` in `App.tsx` (reuse BulkAssign skip-existing semantics + push one undo); buttons in `ScheduleTab.tsx`; new i18n keys. **Defer** the "named template snapshot" sub-feature (the only part needing a new persisted field). **Dual-mode:** free via `setSchedule`→`updateActive`. Effort **M**.

- **Track fixed-term contract end dates + surface expiries.** `contractType` is purely cosmetic today; the workforce planner literally advises "let fixed-term contracts expire (Art. 36)" with no dates to act on.
  **How:** Add optional `contractStartDate`/`contractEndDate` to `types.ts`; backfill in `migration.normalizeEmployee`; date field in `EmployeeModal`; CSV import + `hrisBundle` columns; AI query projection; Roster expiry chip + Dashboard card; emit `severity:'info'` finding. **Dual-mode gotcha:** Firestore `setDoc` throws on literal `undefined` — *omit* empty contract keys, don't assign undefined. Effort **M**.

- **Bulk "Record leave for selected" in RosterTab.** A 50-person Eid closure currently means opening 50 modals one at a time.
  **How:** New `BulkLeaveModal` (clone BulkAssign shell); `onBulkLeave` prop in RosterTab; `applyBulkLeave` in `App.tsx` that replicates *both* halves of the single save (append `LeaveRange` **and** `stampLeaveOntoSchedule`). Keep types annual/sick/maternity only — **drop** the "public-holiday closure as leave" idea (holidays are modeled separately). **Dual-mode:** free via `setEmployees`. Effort **S**.

---

## UX & Ease-of-Use

- **Unify the two competing setup checklists; make Step 4 completable.** SetupChecklist hardcodes Step 4 `done={false}` and self-dismisses the instant stations+employees+shifts exist — exactly when the "now generate a schedule" nudge becomes relevant. Meanwhile Dashboard renders a *parallel* amber card; both co-render.
  **How:** Drive the single SetupChecklist off the Dashboard's 5-signal model (add `hasEligibility`/`hasScheduleEntries`), delete the amber card block, fix the now-wrong subtitle copy. Effort **M**.

- **Wire Plan-Everything wizard into first-run paths.** The wizard is reachable only from the Schedule toolbar; Step 4's CTA says "Run the wizard" but dumps you on the Schedule tab to find the button.
  **How:** Add `onOpenPlanWizard` prop; fix SetupChecklist Step 4 CTA; offer the wizard after "Seed Sample Data" (seeded data satisfies every prerequisite); wire the amber setup card's button. **Leave** the zero-employee empty state alone (opening a wizard full of blockers is worse UX). Effort **M**.

- **Leave indicator on Roster rows + Dashboard "off this week" card.** Roster — the most-used daily list — has zero leave visibility; nothing answers "who is off Thursday, by name."
  **How:** `getEmployeeLeaveOnDate` badge on the row (real `today`, not config.month); a new Dashboard card over `[today, today+6]`; reuse `leaves.ts` helpers and existing `leaves.type.*` i18n keys. **Dual-mode:** pure read over `leaveRanges`. Effort **S**.

- **Add Expand-all/Collapse-all + search to FindingsList.** On a busy month a supervisor clicks each grouped rule open one at a time inside a 360px scroll box.
  **How:** Lift expansion state to the top-level component (Set of open keys); add expand/collapse and a name/rule search that auto-opens matches; the severity filter is the lowest-value piece — ship last. Effort **M**.

- **Period-over-period deltas (OT/payroll/fines/headcount).** No "vs last month" anywhere, despite the prior month's schedule already being in memory.
  **How:** New `periodComparison.ts` computing deltas *live* against `allSchedules[prevKey]` (NOT a new persisted snapshot — that would be offline-only and would drift); `DeltaChip` component; chips on Coverage/OT KPIs and a new Payroll grand-total header. `useMemo`-guard the double recompute. **Dual-mode:** zero new persistence. Effort **M**.

---

## Compliance Depth

- **Show remaining annual-leave balance + overdraw warning at approval (no auto-decrement).** A manager can approve 30 days for someone with 5 left, with no signal. Note: Payroll *already* shows truthful net balance — the gap is the approve dialog/Roster/LeaveRequestPanel.
  **How:** Add `remainingAnnualLeave(emp, asOf)` helper in `leaves.ts` (entitlement minus consumed); show used/remaining + info banner in LeaveRequestPanel; mirror on Roster. **Explicitly do NOT decrement `annualLeaveBalance`** — it's the entitlement baseline the whole projection layer depends on; mutating it double-counts. Effort **M**.

- **Surface annual-leave below the 21-day statutory minimum as an info finding.** A worker carrying 0 annual days produces no finding today.
  **How:** Add an employee-level `severity:'info'` rule in `ComplianceEngine.check`, prorated by elapsed-year fraction (mid-year "balance < 21" would reproduce the PH-worked noise spike). **Verify the correct article** — the engine already uses Art. 71 for rest, so don't reuse it blindly. Effort **M**.

- **Art. 69 intra-shift rest-break check for long shifts.** `breakMin` is currently checked only for drivers (Art. 88); a Standard worker on a 9–10h shift with `breakMin=0` flags nothing.
  **How:** New non-driver rule in `compliance.ts` (and `previewAssignmentWarnings`); two Config-overridable thresholds; new RULE_KEYS/fine/article/i18n entries (remember `VariablesTab` has a *hardcoded* ordered-keys array); default the Config fields in `migration.ts`. Use `severity:'violation'` (hard breach). **Confirm the article number** with counsel. Effort **M**.

- **Enrich exported compliance evidence with statute citations + plain-language verdicts.** Exports emit rule/article tokens but no requirement text and no preamble.
  **How:** New data-only `statuteText.ts`; add `articleFull`+`requirement` to compliance.json and a "Requirement" column + preamble to the PDF. **Derive the verdict from each finding's actual `severity`**, never a static per-rule map (weekly-cap is dynamic). The PDF is the dual-mode-reaching surface (bundle is online-only). Effort **M**.

- **Make the PDF compliance report consume the canonical pay engine.** The PDF re-derives pay inline and *over-bills* vs Payroll in three ways (2× on all holiday hours ignoring comp-mode, no leave exclusion, flat cap).
  **How:** Extract `computePayrollRow` in `payroll.ts`; have both PayrollTab and `pdfReport.ts` consume it; thread `allSchedules` into the PDF; align PayrollTab's cap to `monthlyCapFor` (note: this changes on-screen Driver/hazardous OT, flag separately). Effort **M**.

- **Probation-period awareness (info only).** No probation concept exists; entitlements/notice show as fully vested from day one.
  **How:** Optional `probationEndDate` on Employee; "In probation until …" info badge + `severity:'info'` finding. **Drop** the gratuity-exclusion idea — Art. 137 accrues from hire date, probation included, so clamping would *mis-state* liability. Effort **M**, impact low.

---

## Accessibility

- **Trap focus inside modals + restore focus on close.** No Tab-trap or focus restore anywhere; Tab walks keyboard users straight into the background grid.
  **How:** Preferred — extract a shared `ModalShell` (the backdrop/dialog/motion block is duplicated across ~20 modals) that captures `activeElement`, cycles Tab among focusable descendants, restores on unmount, and `inert`s the app root. Capture in a ref (StrictMode double-invoke safety). Effort **M**.

- **Schedule grid ARIA semantics.** No `role="grid"`/`gridcell`/`columnheader` and virtualization-skipped rows can't report position.
  **How (tiered):** **Tier A (S)** — spread react-window's provided `ariaAttributes` onto rows + label the sticky name cell. **Tier B (L)** — full `role=grid` requires restructuring the 3 scroll-synced containers under one grid ancestor and overriding react-window's listitem defaults. Ship Tier A now. Effort **L** for full.

- **Encode diff/violation/stats with more than color + English titles.** The violation dot's title is hardcoded English; the *screen-reader* string is the hardcoded `· violation` aria-label template (the real fix site); the near-cap badge only appears on hover.
  **How:** Route the dot title + aria suffix through new i18n keys (build aria in the ScheduleTab caller, not the shared Primitive); localize `formatEmployeeStatsTooltip` and add it as `aria-label`; add `group-focus-within` to the near-cap badge. Effort **M**.

- **Form-bearing modals should not dismiss on backdrop click.** Approval modals carry mandatory free-text reasons; a stray backdrop click discards them. (Matches your documented v5.3.1 convention.)
  **How:** Remove the backdrop `onClick` on ApprovalActionModals' `ModalShell`; add a `sticky?` prop to UsersPanel's shared `Modal` (also wire `useModalKeys` — it's not imported there) for UserFormModal but not the info dialog. **Leave** ConfirmModal dismissable. Effort **S**.

---

## i18n / RTL

- **Localize the OnlineSetup first-run screen.** It's the single un-localized English island between two fully bilingual screens (LoginScreen, SuperAdminWizard).
  **How:** Wire `useI18n` into OnlineSetup + its sub-components; new `onlineSetup.*` namespace in en.ts **and** ar.ts; keep technical field labels (API key, Project ID) and code snippets English; dir-aware Back arrow via the real `Primitives.tsx` precedent. Effort **M**.

- **Localize schedule grid dates + the per-employee stats tooltip.** Raw `date-fns format` and a hardcoded-English tooltip render English in Arabic mode.
  **How:** Swap raw `format` for context `fmt.date` in the header + PrintScheduleView; refactor `formatEmployeeStatsTooltip(stats, t)`; thread `t`/`fmt` through the react-window `RowData`/`rowProps`. Keep day-number digits ASCII. Effort **M**.

---

## Performance

- **Gate Dashboard-only analytics memos behind `activeTab`.** A supervisor painting cells pays full `hourlyCoverage`/`staffingGapsByStation`/`coverageMetrics`/`otSummary` recomputes for numbers shown only on the Dashboard.
  **How:** In `App.tsx` — gate `otSummary` behind `simMode` (its only consumer early-returns off-sim), gate the coverage trio behind `activeTab==='dashboard'`, and precompute the per-hour requirement vectors inside `hourlyCoverage`. Leave findings/violations ungated (cross-tab). Effort **M**.

- **Memoize ScheduleCell, stabilize handlers, batch drag-paint.** A 31-day drag fires ~31 full-app recomputes (and N Firestore writes); a batched commit collapses to one.
  **How:** Accumulate drag cells in a ref, commit once on mouseup via a new `onCellPaintBatch` (reuse the `handleCellRangeFill` pattern); wrap `ScheduleCell` in `React.memo` with a comparator that *excludes* the handler closures. **Dual-mode win:** one `syncMonth` instead of N. Effort **M**.

- **Virtualize or paginate the Roster.** A plain `<table>` renders every filtered row; 200+ rosters are anticipated. (Caveat: react-window can't live in a `<tbody>`, and rows are variable-height.)
  **How:** Recommend **pagination** (page the existing `visible` memo, redefine select-all over the full filtered set) over full virtualization. Escalate to react-window (table→div rewrite + measured heights) only if profiling demands it. Effort **M**.

---

## Data Trust & Safety

- **Backup import silently no-ops in Online mode.** super_admin confirms, UI flashes the imported roster, reload restores OLD cloud data with zero error.
  **How:** Add a mode-aware guard at the top of `handleImportBackup` — in online mode show an honest "not supported yet, cloud data unchanged" message instead of mutating state; fix the confirm copy that falsely promises "sync to the local server." Real online restore (routing through the sync fan-out) is a separate L follow-up. Effort **M**.

- **Deleting an employee/station orphans schedule entries in non-active months.** Deletes only touch the active month; orphans persist in every other month and inflate the WorkforcePlanning demand profile (station delete has no reference count at all).
  **How:** One `setAllSchedules` pass that deletes the empId from *every* month (clone only touched months for reference-equality); for stations, count + warn on references like the shift-library path, then clear `stationId` (keep the cell). **Dual-mode:** only affected months fire `syncMonth`. Effort **M**.

- **Honor `holidayMinHC` in coverage scenarios** *(reframed — low priority).* Verified the candidate's "planner self-disagrees" claim is **false** (workforcePlanning *also* ignores the holiday tier — they agree). The real item is a small optional feature: add a "holiday" day-type to the Coverage Scenario walkthrough.
  **How:** Extend `DayTypeToggle` to a 3rd option, thread `isHoliday` into `buildCoverageScenarios`, show the tab only when a station has holiday demand set. The higher-value separate item is making `autoScheduler.ts` pass `isHoliday` (a real consumer divergence). Effort **M**, impact low.

- **Online-mode hydration skeleton.** Returning users on a cold cache briefly see alarming empty states because `dataLoaded` flips true before Firestore snapshots arrive.
  **How:** Per-active-company "first snapshot for employees+stations" flag in `App.tsx`; skeleton the content body until hydrated; reset on company switch; **Offline is a no-op** (no warmup gap). Effort **M**.

---

## Recommended Sequencing

1. **First — stop the data bleeding (trust + cheap wins).** Ship the S-effort safety/correctness cluster together: identifier validation, CSV hardening, backup-import online guard, PDF Arabic tofu, audit-log Clear guard, fake "Authenticated" tile, StationModal dirty-guard, Rebuild-from-scratch confirm. These are mostly independent, individually small, and each one removes a silent-loss or misleading-state trap — the highest priority for a compliance product. Then land **persist the leave-request queue** (M) since it's an outright dual-mode-parity violation with misleading docstrings.

2. **Second — finish the half-built UX so features are discoverable.** Unify the setup checklists, wire the Plan-Everything wizard into first-run paths, add the station picker to the painter (manual shifts finally count toward coverage), and add Roster/Dashboard leave visibility. These convert existing-but-hidden capability into everyday value and unblock the onboarding story.

3. **Third — depth + polish in parallel tracks.** (a) *Compliance:* PDF-uses-canonical-pay-engine and statute-citation exports (most credible to a regulator); the Art. 69 break check and 21-day-minimum finding after article numbers are confirmed. (b) *Accessibility/i18n:* the contrast sweep, reduced-motion, aria-sort, focus-trap, OnlineSetup localization, and RTL arrows — high cumulative polish, low coupling. (c) *Performance:* batch drag-paint and gate the Dashboard memos before rosters grow past a few hundred. Defer the L-effort items (full grid ARIA, true online restore, Roster virtualization) until a concrete user need or profiling result justifies them.

**Files most often touched across this roadmap:** `src/App.tsx`, `src/lib/i18n/en.ts` + `ar.ts` (every i18n item — keep them in lockstep), `src/tabs/ScheduleTab.tsx`, `src/lib/compliance.ts` + `fines.ts` + `findings.ts`, `src/components/Primitives.tsx`. Almost nothing here needs a Firestore migration — most fixes are pure derivation, presentation, or route through the existing `updateActive`/`setSchedule` dual-mode setters.

---

### Verification note (killed candidate)
- **"Add a theme switcher to Settings"** — KILLED. A full 3-button light/dark/system picker already exists in `LocaleSwitcher.tsx` (rendered in the persistent sidebar footer, visible on every tab, fully a11y + i18n'd). Do not re-suggest.
