# Changelog

All notable changes to **Iraqi Labor Scheduler** are listed here. Versioning follows [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH); each release tag (`vX.Y.Z`) on GitHub triggers a build that publishes the signed-by-hash Windows installer plus `SHA256SUMS.txt` to the matching GitHub Release.

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
