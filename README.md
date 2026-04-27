# 🇮🇶 Iraqi Labor Scheduler (Standalone)

A professional, local-first workforce management and automated scheduling system tailored for **Iraqi Labor Law (Art. 67-74, Art. 84, Art. 87, Art. 88)**.

![App Icon](assets/icon.png)

## 🌟 Key Features

### Compliance & legal
- **⚖️ Compliance engine**: Automated checks for daily/weekly hour caps (Art. 67/70), hazardous-work caps (Art. 68), mandatory rest (Art. 71-72), holiday compensation (Art. 73-74), **transport-worker rules for drivers (Art. 88)**, **sick leave (Art. 84)**, and **maternity leave (Art. 87)**.
- **📜 Legal Variables tab**: Every cap (daily / weekly / hazardous / driver / OT multipliers / Ramadan reduced-hours) is editable in one place with the governing article tagged on each value. Edits flow live into the engine and the auto-scheduler.
- **🌙 Ramadan mode**: Set a date range and a reduced daily-hour cap (default 6h). The auto-scheduler refuses to assign longer shifts to non-driver, non-hazardous staff during the window; the engine flags any breach as an `(Ramadan)` violation.
- **🤰 Maternity leave (Art. 87)**: Mark protected 14-week leave on any employee. The auto-scheduler stamps `MAT` on those days and skips the employee for assignments. Manual work shifts during the window surface as a violation.
- **🤒 Sick leave (Art. 84)**: Same date-range model as maternity. The auto-scheduler stamps `SL`, the engine flags any work shift assigned during the window.
- **🚚 Driver / Transport mode**: Mark personnel as Drivers and have them scheduled under stricter caps — 9h daily / 56h weekly, 4.5h continuous-driving cap, 11h min daily rest. Configurable per fleet.

### Scheduling power
- **🤖 Auto-Scheduler**: Fills your shop layout stations automatically based on employee eligibility, role, category, and legal limits. Indexed for performance — 50+ employee rosters complete in milliseconds.
- **👁️ Schedule Preview & Undo**: Review the auto-scheduler's proposed assignments, hours, and compliance impact before applying. A 5-deep undo stack lets you revert recent applies.
- **🔄 Rotating Rest Day**: Toggle "No Fixed Rest Day" on any employee — the auto-scheduler rotates their off across the week so weekend coverage is shared fairly between staff.
- **🎨 Paint mode + live conflict warnings**: Click a shift code to enter paint mode, then click cells to assign. Each paint runs a focused dry-run check — if the assignment would breach a daily / weekly / rest / consec-day / leave / Ramadan / holiday rule, an inline amber banner names the conflict.
- **🔍 Roster + schedule grid filters**: Search by name / ID / department, filter by role, sort columns. The schedule grid is fully virtualized — large rosters (50+) stay snappy.

### Productivity
- **📊 Smart Staffing Advisory**: Coverage gaps surface per-station with a recommended hire count. If `requiredRoles` is set on the station, the role hint is shown alongside (e.g. "Mall Shuttle — Role required: Driver — +1 to hire"). Largest gaps float to the top.
- **🌐 Bilingual UI (English / Arabic)**: One-click language toggle in the sidebar with full RTL layout for Arabic. Translations cover toolbar, every modal, every confirmation dialog, dashboard, payroll, reports, settings, and the PDF report headers.
- **📋 Audit Log**: Append-only log of every change to employees, schedules, shifts, stations, and config — exportable as CSV. Stored locally alongside your data.
- **💾 One-Click Backup / Restore**: Export and import full JSON snapshots of all months, employees, shifts, stations, and config.
- **📄 Professional Reporting**: One-click PDF compliance reports and CSV payroll drafts. The PDF chunk lazy-loads, so the app starts instantly even on slower hardware.
- **💡 Live auto-save indicator**: A status badge in the top bar shows pending / saving / saved / error in real time, so you never wonder whether your last edit reached the disk.

### Architecture
- **🖥️ Native standalone app**: Runs as a professional Windows application with no browser tabs or address bars.
- **🔒 Privacy first**: 100% local data storage, server bound to `127.0.0.1` only, atomic writes prevent corruption, factory reset requires explicit confirmation token. No cloud dependencies, no tracking.
- **🔐 Verifiable builds**: Every release ships with a `SHA256SUMS.txt` so you can confirm the installer is byte-identical to what GitHub Actions built from this open-source code.
- **♿ Accessible**: All modals trap focus and close on Escape. Every icon-only button has an `aria-label`. Tables use semantic markup with sortable column headers.
- **🧪 Tested**: 18 Vitest unit tests lock down the compliance engine — daily / weekly caps, rest periods, consecutive days, holiday OT, driver caps, Ramadan, maternity, sick leave, violation grouping. Run `npm test` to verify.

## 🚀 Quick Start (Recommended)
The easiest way to use the app is to download the pre-built installer:

1. Navigate to the **[Releases](https://github.com/assassinoa93/iraqi-labor-scheduler/releases)** page on GitHub.
2. Under the **latest release (v1.5.0)**, scroll down to the **Assets** section.
3. Download `Iraqi-Labor-Scheduler-Setup-1.5.0.exe` **and** `SHA256SUMS.txt`.
4. (Optional but recommended) Verify the installer hash — open PowerShell in the folder where you saved both files and run:
   ```powershell
   Get-FileHash -Algorithm SHA256 .\Iraqi-Labor-Scheduler-Setup-1.5.0.exe
   ```
   Compare the printed hash against the line for that filename in `SHA256SUMS.txt`. They must match exactly.
5. Double-click the `.exe` to install. Open the app from your **Desktop Shortcut**.

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

# Build standalone installer
npm run electron:build
```

### Project layout
```
src/
├── App.tsx                  # Top-level shell + state, ~1200 lines (was 2200 before v1.5)
├── tabs/                    # One file per sidebar tab — code-split via React.lazy
│   ├── DashboardTab.tsx
│   ├── RosterTab.tsx        # Search + role filter + sortable columns
│   ├── ScheduleTab.tsx      # Virtualized grid (react-window)
│   ├── PayrollTab.tsx
│   ├── HolidaysTab.tsx
│   ├── LayoutTab.tsx
│   ├── ShiftsTab.tsx
│   ├── ReportsTab.tsx
│   └── SettingsTab.tsx
├── components/              # Cross-cutting modals + primitives
│   ├── EmployeeModal.tsx    # With maternity + sick-leave date inputs
│   ├── StationModal.tsx
│   ├── ShiftModal.tsx
│   ├── HolidayModal.tsx
│   ├── ConfirmModal.tsx
│   ├── SchedulePreviewModal.tsx
│   ├── VariablesTab.tsx     # Includes Ramadan window controls
│   ├── AuditLogTab.tsx
│   └── Primitives.tsx       # Card, KpiCard, ScheduleCell, SettingField, TabButton
└── lib/
    ├── compliance.ts        # ComplianceEngine + previewAssignmentWarnings
    ├── autoScheduler.ts     # Indexed greedy-fill scheduler
    ├── payroll.ts           # baseHourlyRate, monthlyHourCap, default constants
    ├── time.ts              # parseHour / parseHourBounds helpers
    ├── i18n.tsx             # EN + AR dictionaries with {var} interpolation
    ├── hooks.ts             # useModalKeys (Esc + auto-focus)
    ├── appMeta.ts           # APP_VERSION
    ├── initialData.ts       # Seed shifts / stations / holidays / config
    ├── pdfReport.ts         # jspdf-based report (lazy-loaded)
    ├── colors.ts
    └── utils.ts
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
- **Article 87**: 14-week paid maternity leave (configurable date range per employee).
- **Article 88** (transport workers): Stricter caps for drivers — 9h daily / 56h weekly, 4.5h max continuous driving with mandatory 30-min break, 11h daily rest.

All thresholds are configurable in the Legal Variables tab to match sector-specific Ministerial decrees, collective bargaining agreements, or Ministry of Transport regulations.

## 📦 What's new in v1.5

| Area | Change |
|------|--------|
| **Compliance** | Added Ramadan reduced-hours mode, maternity leave (Art. 87), sick leave (Art. 84). Engine + auto-scheduler enforce all three. |
| **UX** | Inline paint-mode conflict warnings. Live auto-save indicator. Sortable + filterable roster. Full-month coverage heatmap. |
| **Performance** | Schedule grid virtualized via `react-window`. Tabs code-split via `React.lazy`. PDF generator lazy-loaded. **Initial bundle 918KB → 448KB.** |
| **Accessibility** | Esc closes every modal, focus auto-managed. Icon-only buttons gained `aria-label`. Sortable column headers are real `<button>`s. |
| **Domain features** | Staffing advisory pivoted from role-guessed to station-pinned — works correctly with any role label including new ones (Security Guard, etc.). |
| **Code quality** | App.tsx 2211 → ~1200 lines via per-tab extraction. Centralized payroll + time helpers. Eliminated `as any` casts on schedule entries. 18 Vitest unit tests on the compliance engine. |

---
*Built with React, Electron, react-window, jspdf, motion (framer), date-fns, and Tailwind CSS. Tailored for the Iraqi Workforce.*
