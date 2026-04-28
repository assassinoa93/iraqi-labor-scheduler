# Changelog

All notable changes to **Iraqi Labor Scheduler** are listed here. Versioning follows [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH); each release tag (`vX.Y.Z`) on GitHub triggers a build that publishes the signed-by-hash Windows installer plus `SHA256SUMS.txt` to the matching GitHub Release.

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
