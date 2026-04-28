# 🇮🇶 Iraqi Labor Scheduler (Standalone)

A professional, local-first workforce management and automated scheduling system tailored for **Iraqi Labor Law (Art. 67-74, Art. 84, Art. 86, Art. 87, Art. 88)**.

![App Icon](assets/icon.png)

## 🌟 Key Features

### Compliance & legal
- **⚖️ Compliance engine**: Automated checks for daily/weekly hour caps (Art. 67/70), hazardous-work caps (Art. 68), mandatory rest (Art. 71-72), holiday compensation (Art. 73-74), **transport-worker rules for drivers (Art. 88)**, **sick leave (Art. 84)**, **maternity leave (Art. 87)**, and the new **Art. 86 women's night-work rule** for industrial undertakings.
- **📜 Legal Variables tab**: Every cap (daily / weekly / hazardous / driver / OT multipliers / Ramadan reduced-hours / Art. 86 night window) is editable in one place with the governing article tagged on each value. Edits flow live into the engine and the auto-scheduler.
- **🌙 Ramadan mode**: Set a date range and a reduced daily-hour cap (default 6h). The auto-scheduler refuses to assign longer shifts to non-driver, non-hazardous staff during the window; the engine flags any breach as an `(Ramadan)` violation.
- **🤰 Maternity leave (Art. 87)**: Mark protected 14-week leave on any female employee. The auto-scheduler stamps `MAT` on those days and skips the employee for assignments. Manual work shifts during the window surface as a violation.
- **🤒 Sick leave (Art. 84)**: Same date-range model as maternity. The auto-scheduler stamps `SL`, the engine flags any work shift assigned during the window.
- **🏖️ Annual leave**: Approved-vacation date range per employee. Auto-scheduler stamps `AL`, compliance flags work shifts inside the window.
- **🚚 Driver / Transport mode**: Mark personnel as Drivers and have them scheduled under stricter caps — 9h daily / 56h weekly, 4.5h continuous-driving cap, 11h min daily rest. Configurable per fleet.
- **🌃 Art. 86 night-work rule**: Optional. When enabled (Variables tab), any shift flagged industrial that overlaps the configured night window (default 22:00–07:00) and is assigned to a female employee surfaces as an Art. 86 violation; the auto-scheduler treats it as a hard rule at the legal/continuity strictness levels.
- **🔁 Cross-month rolling-7 awareness**: Compliance engine and auto-scheduler peek at the trailing 6 days of the prior month so weekly caps don't reset arbitrarily on day 1.

### Scheduling power
- **🤖 Auto-Scheduler**: Fills your shop layout stations automatically based on employee eligibility, role, category, and legal limits. Indexed for performance — 50+ employee rosters complete in milliseconds.
- **🪄 Optimal (Keep Absences) mode**: A second scheduler button next to Auto-Schedule. Input the month's leaves, vacations, and any manual shift overrides first, then click *Optimal (Keep Absences)* — the algorithm fills only the empty cells around your locked entries, with the locked rows still counted toward station headcount and the rolling-7-day cap. Lets you build a "manual edits + auto-fill" hybrid in one click without losing what you've already entered.
- **🧪 Simulation / forecasting mode**: Toolbar toggle freezes a baseline, suspends auto-save, and renders a delta panel comparing baseline vs. sandboxed state across workforce size, coverage %, OT hours, OT pay (IQD), and violations. Apply / Reset / Discard. Lets you model "what if I hire 3 more cashiers?" or "what if I open Friday from 09:00?" without touching saved data.
- **🪄 Coverage-gap hint toast**: When a manual edit vacates a station-bound work shift (or a leave date range empties cells), a non-blocking bottom-right toast surfaces the affected day + station and lists swap candidates ranked by score (off-day employees first, preference match, compliance warnings factored in). The most optimal pick is flagged with a ⭐ "Recommended" badge; the candidate list refreshes live as you keep editing, and auto-dismisses if the gap fills itself. One-click swap or "Keep gap" override — the original change is never rolled back. After a swap, both the source and destination cells flash with a pulsing amber ring for 5 seconds so you can see exactly what moved.
- **👁️ Schedule Preview & Undo**: Review the auto-scheduler's proposed assignments, hours, and compliance impact before applying. A 5-deep undo stack lets you revert recent applies.
- **🔄 Rotating Rest Day**: Toggle "No Fixed Rest Day" on any employee — the auto-scheduler rotates their off across the week so weekend coverage is shared fairly between staff.
- **🎯 Shift preferences**: Mark preferred / avoided shift codes per employee. The auto-scheduler honours preferences as a *soft* constraint at the legal-strictness level — biases the candidate sort toward preferred codes and skips avoided ones — and ignores them at relaxed levels so coverage is never sacrificed.
- **🎨 Paint mode + live conflict warnings**: Click a shift code to enter paint mode, then click cells to assign. Each paint runs a focused dry-run check — if the assignment would breach a daily / weekly / rest / consec-day / leave / Ramadan / Art. 86 / holiday rule, an inline amber banner names the conflict.
- **🔍 Roster + schedule grid filters**: Search by name / ID / department, filter by role, sort columns. The schedule grid is fully virtualized — large rosters (50+) stay snappy.

### Productivity
- **📅 Multi-range leave manager**: Replaces the single date-range fields on the Employee modal. Open Credits & Payroll, click *Manage* on any row, and add as many leave windows as you need (annual / sick / maternity), each with its own start/end and optional notes. The auto-scheduler, compliance engine, and coverage-hint toast all read from the new structure via a single helper (`getEmployeeLeaveOnDate`); legacy single-range data is back-compatible and surfaces as editable rows on first open.
- **🖱️ Schedule grid power-ups**: Drag the mouse across cells in paint mode to fill a swath in one motion; Shift+click to rectangle-fill from the last clicked cell to the current one (one undo entry per range). Per-cell undo (Ctrl+Z) reverts the most recent paint without touching the rest of the month — separate from the existing 5-deep Auto-Schedule undo. Number keys 1–9 still pick a paint code, Esc clears paint mode.
- **📋 Bulk shift assignment**: Select N employees in the Roster, hit *Assign Shift*, pick a shift code and day range, choose whether to overwrite existing entries — paints the rectangle in one shot.
- **👤 Per-employee labor-law card**: Hover any employee name in the schedule grid to see a tooltip with hours-vs-cap, peak weekly window, longest streak, and last day worked. A small badge appears on rows that are at or above 90% of their weekly cap so you spot saturated employees before painting another shift.
- **📈 Compliance trendline**: A sparkline on the Dashboard records daily compliance % per company in localStorage and shows the 30-day delta with an up/down indicator — no server work needed.
- **🖨️ Print view**: One-click "Print" button in the schedule toolbar renders all employees (no virtualization) on an A3 landscape page with the proper shift colours preserved (`-webkit-print-color-adjust: exact`). Hidden in normal display via `@media print`.
- **🌗 Dark mode**: Sidebar toggle cycles Light → Dark → System. Tailwind `dark:` variant is wired via `@variant` in CSS, with global overrides for `bg-white`, `text-slate-*`, and form fields so the app reads cleanly in dark mode without per-component edits.
- **💾 Daily auto-snapshot**: On the first launch each calendar day, the Electron main process snapshots the data folder to `data-daily-<YYYY-MM-DD>/` next to the live folder. The 7 most recent daily snapshots are kept; older ones rotate out automatically. Independent from the post-update snapshot — gives you a recovery point even between version updates.
- **🏢 Multi-company / branches**: Sidebar `CompanySwitcher` to add, rename, or delete companies. Each company owns its own employees, shifts, stations, holidays, config, and schedules. Active company is sticky across reloads. Backups round-trip every company in one file; legacy single-company backups are migrated automatically.
- **🕒 Per-day operating windows**: Default opening / closing hours plus a seven-toggle override grid in the Variables tab. Useful when peak days run later than weekdays — e.g. Friday closes at 02:00 instead of 23:00. Dashboard heatmap and coverage-% metrics honour the per-day window.
- **📊 Smart Staffing Advisory**: Coverage gaps surface per-station with a recommended hire count. If `requiredRoles` is set on the station, the role hint is shown alongside (e.g. "Mall Shuttle — Role required: Driver — +1 to hire"). Largest gaps float to the top.
- **📈 FTE forecast KPI**: Dashboard top row shows the recommended additional headcount based on monthly OT load.
- **🧭 Strategic Growth Path**: The Dashboard's optimisation card shows aggregate scheduled-OT, premium pay, deficit, and savings — *and* a per-station gap breakdown right below it (station name, role required, headcount needed) so the recommendation isn't a black box.
- **🚧 Schedule staleness banner**: Detects entries that reference deleted employees / shift codes / stations and offers an inline "Re-run Auto-Scheduler" button.
- **🌐 Bilingual UI (English / Arabic)**: One-click language toggle in the sidebar with full RTL layout for Arabic. Translations cover toolbar, every modal, every confirmation dialog, dashboard, payroll, reports, settings, simulation panel, coverage-hint toast, post-update toast, and the PDF report headers.
- **📋 Audit Log**: Append-only log of every change to employees, schedules, shifts, stations, and config — exportable as CSV, namespaced by company id. Stored locally alongside your data.
- **💾 One-Click Backup / Restore**: Export and import full JSON snapshots of every company, all months, employees, shifts, stations, and config.
- **📄 Professional Reporting**: One-click PDF compliance reports and CSV payroll drafts. The PDF chunk lazy-loads, so the app starts instantly even on slower hardware.
- **💡 Live auto-save indicator**: A status badge in the top bar shows pending / saving / saved / error in real time, plus a distinct *Sandbox · not saving* state when simulation mode is active.

### Architecture
- **🖥️ Native standalone app**: Runs as a professional Windows application with no browser tabs or address bars.
- **🔒 Privacy first**: 100% local data storage, server bound to `127.0.0.1` only, atomic writes prevent corruption, factory reset requires explicit confirmation token. No cloud dependencies, no tracking.
- **🛡️ Safe-update installer**: The Windows installer detects an existing installation and runs as an in-place update (the wizard pops a "v{previous} detected — will update" notice). On the first launch after every update, the Electron main process snapshots the entire `data/` folder to a timestamped `data-backup-<oldVersion>-<ts>/` sibling, keeping the 5 most recent. Your data is preserved through three layers (`deleteAppDataOnUninstall: false`, data folder lives outside `${INSTDIR}`, custom uninstall macro skips the data folder during the pre-update sweep).
- **🧬 Backward-compatible data layer**: A central `src/lib/migration.ts` normaliser runs every loaded record through field-by-field defaults. Schemas can grow (new optional fields, future structural changes via `CURRENT_DATA_VERSION`) without breaking older backups.
- **🔐 Verifiable builds**: Every release ships with a `SHA256SUMS.txt` so you can confirm the installer is byte-identical to what GitHub Actions built from this open-source code.
- **♿ Accessible**: All modals trap focus and close on Escape. Every icon-only button has an `aria-label`. Tables use semantic markup with sortable column headers.
- **🧪 Tested**: 18 Vitest unit tests lock down the compliance engine — daily / weekly caps, rest periods, consecutive days, holiday OT, driver caps, Ramadan, maternity, sick leave, violation grouping. Run `npm test` to verify.

## 🚀 Quick Start (Recommended)
The easiest way to use the app is to download the pre-built installer:

1. Navigate to the **[Releases](https://github.com/assassinoa93/iraqi-labor-scheduler/releases)** page on GitHub.
2. Under the **latest release (v1.7.0)**, scroll down to the **Assets** section.
3. Download `Iraqi-Labor-Scheduler-Setup-1.7.0.exe` **and** `SHA256SUMS.txt`.
4. (Optional but recommended) Verify the installer hash — open PowerShell in the folder where you saved both files and run:
   ```powershell
   Get-FileHash -Algorithm SHA256 .\Iraqi-Labor-Scheduler-Setup-1.7.0.exe
   ```
   Compare the printed hash against the line for that filename in `SHA256SUMS.txt`. They must match exactly.
5. Double-click the `.exe` to install. Open the app from your **Desktop Shortcut**.

### 🔄 Updating from an earlier version
Just download the newer installer and run it. **Do not uninstall the previous version first.** The installer:

1. Detects the existing installation via the registry and pops a one-line notice (*"An existing installation was detected (v1.6.x). This wizard will update Iraqi Labor Scheduler to v1.7.0…"*).
2. Replaces the program files in the existing install directory.
3. Leaves your data folder untouched — it lives at `%APPDATA%\Roaming\iraqi-labor-scheduler\data\`, outside the install directory.
4. On first launch the app snapshots your data to `data-backup-<old-version>-<timestamp>/` next to the live folder. The 5 most recent snapshots are kept; older ones are pruned automatically.
5. A one-time toast shows up confirming the version bump and naming the snapshot path. Click OK and you're in.

If anything ever looks wrong after an update, close the app, rename the snapshot folder back to `data`, and relaunch — you'll be back on your previous data.

### About the Windows SmartScreen / Chrome warning

Windows SmartScreen and Chrome will display a warning ("Windows protected your PC" / "may harm your device") when you download or run the installer. **This is expected for unsigned software** — the warning is triggered by the absence of a Microsoft-trusted Authenticode signature, not by anything malicious in the app.

To proceed safely:

- **Verify the SHA-256 hash first** (step 4 above). If the hash matches what GitHub published, the installer is byte-identical to what was built from the open-source code in this repository.
- In Chrome, click the down-arrow next to the file in the download bar → **Keep**.
- In the SmartScreen dialog, click **More info** → **Run anyway**.

We're in the process of applying for free open-source code signing through [**SignPath Foundation**](https://signpath.org/about). Once approved, releases will be Authenticode-signed and the warning will go away after enough installs build SmartScreen reputation. Until then, hash verification is the right way to confirm the installer's integrity.

---

## 🛠️ For Developers / Advanced Setup
If you are working with the source code:

### Prerequisites
- [Node.js](https://nodejs.org/) (Recommended: v20+)

### One-Click Build & Install
To create your own standalone `.exe` installer:
1. Double-click **`CREATE_MY_DESKTOP_APP.vbs`**.
2. This will handle all dependencies, build the assets, and launch the installer for you.

### Manual Commands
```bash
# Install dependencies
npm install

# Run in Development mode (Native Window)
npm run electron:dev

# Type-check
npm run lint

# Run unit tests (Vitest)
npm test

# Generate the multi-size Windows .ico from assets/icon.png
npm run icons

# Build standalone installer (runs lint + icons + build + server bundle + electron-builder)
npm run electron:build
```

### Project layout
```
src/
├── App.tsx                       # Top-level shell + state, multi-company + sim-mode wiring
├── tabs/                         # One file per sidebar tab — code-split via React.lazy
│   ├── DashboardTab.tsx          # KPI row (incl. FTE forecast), heatmap, optimisation card
│   ├── RosterTab.tsx             # Search + role filter + sortable columns
│   ├── ScheduleTab.tsx           # Virtualized grid (react-window) + staleness banner
│   ├── PayrollTab.tsx
│   ├── HolidaysTab.tsx
│   ├── LayoutTab.tsx
│   ├── ShiftsTab.tsx
│   ├── ReportsTab.tsx
│   └── SettingsTab.tsx
├── components/                   # Cross-cutting modals + primitives
│   ├── EmployeeModal.tsx         # Roster fields (leaves moved to LeaveManagerModal)
│   ├── LeaveManagerModal.tsx     # Multi-range annual / sick / maternity editor
│   ├── BulkAssignModal.tsx       # Roster-driven bulk shift assignment
│   ├── StationModal.tsx
│   ├── ShiftModal.tsx
│   ├── HolidayModal.tsx
│   ├── ConfirmModal.tsx          # With infoOnly variant — replaces native alert()
│   ├── SchedulePreviewModal.tsx  # AnimatePresence-wrapped (1.7 reliability fix)
│   ├── ComplianceTrendCard.tsx   # 30-day localStorage-backed sparkline
│   ├── PrintScheduleView.tsx     # Hidden static table, revealed by @media print
│   ├── CompanySwitcher.tsx       # Sidebar multi-company UI
│   ├── SimulationDeltaPanel.tsx  # Collapsible bottom panel for sim-mode metrics
│   ├── CoverageHintToast.tsx     # Bottom-right swap-suggestion toast
│   ├── VariablesTab.tsx          # Ramadan + per-day window + Art. 86 controls (i18n)
│   ├── AuditLogTab.tsx           # With Clear Log action + confirmation
│   ├── LocaleSwitcher.tsx        # Locale toggle + theme cycle (Light/Dark/System)
│   └── Primitives.tsx            # Card, KpiCard, ScheduleCell (mouse events), SettingField
└── lib/
    ├── compliance.ts             # ComplianceEngine + previewAssignmentWarnings
    ├── autoScheduler.ts          # Indexed greedy-fill scheduler with soft preferences
    ├── coverageHints.ts          # detectCoverageGap + findSwapCandidates
    ├── leaves.ts                 # Unified getEmployeeLeaveOnDate (multi+legacy ranges)
    ├── employeeStats.ts          # Per-employee running counters for tooltip + badge
    ├── complianceHistory.ts      # Per-company localStorage-backed daily snapshots
    ├── theme.tsx                 # ThemeProvider (light / dark / system)
    ├── migration.ts              # Backward-compat normaliser per domain
    ├── payroll.ts                # baseHourlyRate, monthlyHourCap, default constants
    ├── time.ts                   # parseHour / parseHourBounds / per-day operating window
    ├── i18n.tsx                  # EN + AR dictionaries with {var} interpolation
    ├── hooks.ts                  # useModalKeys (Esc + auto-focus)
    ├── appMeta.ts                # APP_VERSION
    ├── initialData.ts            # Seed companies / shifts / stations / holidays / config
    ├── pdfReport.ts              # jspdf-based report (lazy-loaded)
    ├── colors.ts
    └── utils.ts

build/
└── installer.nsh                 # NSIS hooks: customInit / customUnInstall / customInstall

electron/
└── main.cjs                      # Window + tray + post-update data snapshot

server.ts                         # Express + atomic JSON writes + audit diff
                                  # /api/data /api/save /api/audit /api/update-status

scripts/
├── build-icon.cjs                # sharp + png-to-ico → multi-size icon.ico
└── build-server.cjs              # esbuild bundler for production server
```

## 📸 Screenshots
| Compliance Dashboard | Employee Management | Station Configuration |
| :---: | :---: | :---: |
| ![Dashboard](docs/screenshots/payroll_export_button_1777193316198.png) | ![Roster](docs/screenshots/employee_modal_rest_day_1777193295597.png) | ![Layout](docs/screenshots/station_modal_times_1777193258342.png) |

## ⚖️ Legal Framework
This application is designed to support the **Iraqi Labor Law No. 37 of 2015**:
- **Article 67**: Standard 8-hour workday / 48-hour workweek.
- **Article 68**: 7-hour daily cap for hazardous work.
- **Article 70**: Weekly hours cap.
- **Article 71**: Mandatory weekly rest (minimum 24 consecutive hours), minimum 11h rest between shifts.
- **Article 72**: Maximum consecutive working days.
- **Article 73-74**: Double pay or compensation days for work on official holidays.
- **Article 84**: Paid sick leave (configurable date range per employee).
- **Article 86**: Restrictions on women's night work in industrial undertakings (configurable window; off by default — enable in Variables).
- **Article 87**: 14-week paid maternity leave (configurable date range per employee).
- **Article 88** (transport workers): Stricter caps for drivers — 9h daily / 56h weekly, 4.5h max continuous driving with mandatory 30-min break, 11h daily rest.

All thresholds are configurable in the Legal Variables tab to match sector-specific Ministerial decrees, collective bargaining agreements, or Ministry of Transport regulations.

## 📦 What's new in v1.7

| Area | Change |
|------|--------|
| **Leave management** | New **multi-range leave manager** in the Credits & Payroll tab. Each employee can have any number of annual / sick / maternity windows with notes. Replaces the single date-range fields that used to live on the Employee modal (which were misleading — employees rarely take exactly one block of leave per type). Legacy data is read transparently via a single `getEmployeeLeaveOnDate` helper, so old saves keep working. |
| **Schedule grid UX** | **Drag-to-paint** — hold the mouse and drag across cells in paint mode to fill them in one motion. **Shift+click range fill** rectangle-fills from the last clicked cell to the current one (single bundled undo entry). **Per-cell undo (Ctrl+Z)** reverts the most recent paint without losing the rest of the month — separate stack from the existing Auto-Schedule undo. |
| **Roster bulk action** | Select N employees → **Assign Shift** opens a modal where you pick a shift code and day range and apply in one shot. Toggle "Overwrite existing" to either replace or preserve manual edits. |
| **At-a-glance compliance** | Hover any employee name in the schedule grid for a tooltip showing hours-vs-cap, peak rolling-7 window, longest streak, and last day worked. A small badge highlights employees at or above 90% of their weekly cap so you spot saturation before painting. |
| **Compliance trendline** | Dashboard sparkline records daily compliance % per company in localStorage and shows the 30-day delta. Self-bootstrapping — no setup. |
| **Print** | Schedule tab "Print" button renders the full month as an A3 landscape table with shift colours preserved; no virtualization clipping. |
| **Dark mode** | Sidebar toggle cycles Light → Dark → System. Tailwind v4 `@variant dark` is wired up with global overrides for the most-used surfaces. |
| **Daily auto-snapshot** | Electron main process snapshots `data/` once per calendar day on launch, retaining the 7 most recent. Independent from the post-update snapshot. |
| **RTL pass** | CSS shim mirrors `ml-*`/`mr-*`/`pl-*`/`pr-*`/`border-l/r`/`text-left/right` utilities when `dir="rtl"` so icon+text patterns and tab indicators flip correctly. |
| **Bug fixes carried from v1.6.4** | Auto-scheduler preview reliably opens (wrapped in `AnimatePresence`); simulation banner is collapsible and lowered below modal z-index; legal Variables tab translates to Arabic; factory reset moved off the front page into Settings; factory reset writes a single audit entry instead of dozens; new Clear Audit Log action with confirmation. |

For a full version-by-version history including the v1.0–v1.6 lineage, see **[CHANGELOG.md](CHANGELOG.md)**.

---
*Built with React, Electron, react-window, jspdf, motion (framer), date-fns, sharp, png-to-ico, and Tailwind CSS. Tailored for the Iraqi Workforce.*
