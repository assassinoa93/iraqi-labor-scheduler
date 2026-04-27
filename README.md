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
- **🧪 Simulation / forecasting mode**: Toolbar toggle freezes a baseline, suspends auto-save, and renders a delta panel comparing baseline vs. sandboxed state across workforce size, coverage %, OT hours, OT pay (IQD), and violations. Apply / Reset / Discard. Lets you model "what if I hire 3 more cashiers?" or "what if I open Friday from 09:00?" without touching saved data.
- **🪄 Coverage-gap hint toast**: When a manual edit vacates a station-bound work shift (or a leave date range empties cells), a non-blocking bottom-right toast surfaces the affected day + station and lists swap candidates ranked by score (off-day employees first, preference match, compliance warnings factored in). One-click swap or "Keep gap" override — the original change is never rolled back.
- **👁️ Schedule Preview & Undo**: Review the auto-scheduler's proposed assignments, hours, and compliance impact before applying. A 5-deep undo stack lets you revert recent applies.
- **🔄 Rotating Rest Day**: Toggle "No Fixed Rest Day" on any employee — the auto-scheduler rotates their off across the week so weekend coverage is shared fairly between staff.
- **🎯 Shift preferences**: Mark preferred / avoided shift codes per employee. The auto-scheduler honours preferences as a *soft* constraint at the legal-strictness level — biases the candidate sort toward preferred codes and skips avoided ones — and ignores them at relaxed levels so coverage is never sacrificed.
- **🎨 Paint mode + live conflict warnings**: Click a shift code to enter paint mode, then click cells to assign. Each paint runs a focused dry-run check — if the assignment would breach a daily / weekly / rest / consec-day / leave / Ramadan / Art. 86 / holiday rule, an inline amber banner names the conflict.
- **🔍 Roster + schedule grid filters**: Search by name / ID / department, filter by role, sort columns. The schedule grid is fully virtualized — large rosters (50+) stay snappy.

### Productivity
- **🏢 Multi-company / branches**: Sidebar `CompanySwitcher` to add, rename, or delete companies. Each company owns its own employees, shifts, stations, holidays, config, and schedules. Active company is sticky across reloads. Backups round-trip every company in one file; legacy single-company backups are migrated automatically.
- **🕒 Per-day operating windows**: Default opening / closing hours plus a seven-toggle override grid in the Variables tab. Useful when peak days run later than weekdays — e.g. Friday closes at 02:00 instead of 23:00. Dashboard heatmap and coverage-% metrics honour the per-day window.
- **📊 Smart Staffing Advisory**: Coverage gaps surface per-station with a recommended hire count. If `requiredRoles` is set on the station, the role hint is shown alongside (e.g. "Mall Shuttle — Role required: Driver — +1 to hire"). Largest gaps float to the top.
- **📈 FTE forecast KPI**: Dashboard top row shows the recommended additional headcount based on monthly OT load.
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
2. Under the **latest release (v1.6.3)**, scroll down to the **Assets** section.
3. Download `Iraqi-Labor-Scheduler-Setup-1.6.3.exe` **and** `SHA256SUMS.txt`.
4. (Optional but recommended) Verify the installer hash — open PowerShell in the folder where you saved both files and run:
   ```powershell
   Get-FileHash -Algorithm SHA256 .\Iraqi-Labor-Scheduler-Setup-1.6.3.exe
   ```
   Compare the printed hash against the line for that filename in `SHA256SUMS.txt`. They must match exactly.
5. Double-click the `.exe` to install. Open the app from your **Desktop Shortcut**.

### 🔄 Updating from an earlier version
Just download the newer installer and run it. **Do not uninstall the previous version first.** The installer:

1. Detects the existing installation via the registry and pops a one-line notice (*"An existing installation was detected (v1.5.0). This wizard will update Iraqi Labor Scheduler to v1.6.3…"*).
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
│   ├── EmployeeModal.tsx         # Maternity / sick / annual / shift-pref / gender panels
│   ├── StationModal.tsx
│   ├── ShiftModal.tsx
│   ├── HolidayModal.tsx
│   ├── ConfirmModal.tsx          # With infoOnly variant — replaces native alert()
│   ├── SchedulePreviewModal.tsx
│   ├── CompanySwitcher.tsx       # Sidebar multi-company UI
│   ├── SimulationDeltaPanel.tsx  # Bottom panel for sim-mode metrics + Apply/Reset
│   ├── CoverageHintToast.tsx     # Bottom-right swap-suggestion toast
│   ├── VariablesTab.tsx          # Ramadan + per-day window + Art. 86 controls
│   ├── AuditLogTab.tsx
│   └── Primitives.tsx            # Card, KpiCard, ScheduleCell, SettingField, TabButton
└── lib/
    ├── compliance.ts             # ComplianceEngine + previewAssignmentWarnings
    ├── autoScheduler.ts          # Indexed greedy-fill scheduler with soft preferences
    ├── coverageHints.ts          # detectCoverageGap + findSwapCandidates
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

## 📦 What's new in v1.6

| Area | Change |
|------|--------|
| **Multi-tenant** | Manage multiple **companies / branches** in one app — each with its own roster, shifts, stations, holidays, config, and schedules. |
| **Forecasting** | **Simulation mode** — sandbox edits with a live baseline-vs-sim delta panel (workforce, coverage, OT hours, OT pay, violations). |
| **Live scheduling** | **Coverage-gap hint toast** — when a manual edit vacates a station, a non-blocking toast suggests swap candidates with one-click rebalance. |
| **Compliance** | New **Art. 86 women's night-work rule** for industrial undertakings; **annual-leave** date-range workflow; **cross-month rolling-7** awareness so caps don't reset on day 1. |
| **Personalisation** | **Shift preferences** per employee (preferred / avoid) — auto-scheduler honours them softly without sacrificing coverage. **Gender** field with conditional maternity panel. |
| **Operations** | **Per-day operating window** override grid (e.g. Friday closes at 02:00); FTE forecast on the dashboard; schedule staleness banner detects orphaned references. |
| **Updates** | Installer detects existing version and runs as an in-place update; data is preserved through three layers; **timestamped data snapshot** on first launch after every update. |
| **Polish** | Real multi-size Windows installer icon (was falling back to the generic Electron one); native `alert()` calls replaced with the polished modal so messages respect RTL; CSV export quote-escapes; centralised `migration.ts` keeps every old backup loadable forever. |

For a full version-by-version history including the v1.0–v1.5 lineage, see **[CHANGELOG.md](CHANGELOG.md)**.

---
*Built with React, Electron, react-window, jspdf, motion (framer), date-fns, sharp, png-to-ico, and Tailwind CSS. Tailored for the Iraqi Workforce.*
