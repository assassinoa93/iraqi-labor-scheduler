# Changelog

All notable changes to **Iraqi Labor Scheduler** are listed here. Versioning follows [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH); each release tag (`vX.Y.Z`) on GitHub triggers a build that publishes the signed-by-hash Windows installer plus `SHA256SUMS.txt` to the matching GitHub Release.

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
