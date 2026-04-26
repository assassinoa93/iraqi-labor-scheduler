# 🇮🇶 Iraqi Labor Scheduler (Standalone)

A professional, local-first workforce management and automated scheduling system tailored for **Iraqi Labor Law (Art. 67-74, Art. 88)**.

![App Icon](assets/icon.png)

## 🌟 Key Features
- **⚖️ Legal Compliance Engine**: Automated checks for maximum work hours (Art. 67), mandatory rest days (Art. 71), holiday compensation (Art. 73-74), and **transport-worker rules for drivers (Art. 88)**.
- **📜 Legal Variables Tab**: All compliance caps — daily / weekly hours, hazardous limits, driver caps, OT multipliers — visible in a single tab with the governing article tagged on each value. Edit a cap and both the compliance engine and the auto-scheduler update immediately.
- **🚚 Driver / Transport Mode**: Mark personnel as Drivers and have them scheduled under stricter caps — 9h daily / 56h weekly, 4.5h continuous-driving cap, 11h min daily rest. Configurable per fleet.
- **🔄 Rotating Rest Day**: Toggle "No Fixed Rest Day" on any employee — the auto-scheduler rotates their off across the week so weekend coverage is shared fairly between staff.
- **🤖 Intelligent Auto-Scheduler**: Fills your shop layout stations automatically based on employee eligibility, role, category, and legal limits.
- **🖥️ Native Standalone App**: Runs as a professional Windows application with no browser tabs or address bars.
- **🔒 Privacy First**: 100% Local data storage, server bound to `127.0.0.1` only, atomic writes prevent corruption, factory reset requires explicit confirmation token. No cloud dependencies, no tracking.
- **💾 One-Click Backup / Restore**: Export and import full JSON snapshots of all months, employees, shifts, stations, and config.
- **📄 Professional Reporting**: One-click PDF compliance reports and CSV payroll drafts.
- **🔐 Verifiable Builds**: Every release ships with a `SHA256SUMS.txt` so you can confirm the installer is byte-identical to what GitHub Actions built from this open-source code.

## 🚀 Quick Start (Recommended)
The easiest way to use the app is to download the pre-built installer:

1. Navigate to the **[Releases](https://github.com/assassinoa93/Iraqi-Workplace---Vibecoded-apps/releases)** page on GitHub.
2. Under the **latest release (v1.3.1)**, scroll down to the **Assets** section.
3. Download `Iraqi-Labor-Scheduler-Setup-1.3.1.exe` **and** `SHA256SUMS.txt`.
4. (Optional but recommended) Verify the installer hash — open PowerShell in the folder where you saved both files and run:
   ```powershell
   Get-FileHash -Algorithm SHA256 .\Iraqi-Labor-Scheduler-Setup-1.3.1.exe
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

# Build standalone installer
npm run electron:build
```

## 📸 Screenshots
| Compliance Dashboard | Employee Management | Station Configuration |
| :---: | :---: | :---: |
| ![Dashboard](docs/screenshots/payroll_export_button_1777193316198.png) | ![Roster](docs/screenshots/employee_modal_rest_day_1777193295597.png) | ![Layout](docs/screenshots/station_modal_times_1777193258342.png) |

## ⚖️ Legal Framework
This application is designed to support the **Iraqi Labor Law No. 37 of 2015**:
- **Article 67**: Standard 8-hour workday / 48-hour workweek.
- **Article 68**: 7-hour daily cap for hazardous work.
- **Article 71**: Mandatory weekly rest (minimum 24 consecutive hours), minimum 11h rest between shifts.
- **Article 73-74**: Double pay or compensation days for work on official holidays.
- **Article 88** (transport workers): Stricter caps for drivers — 9h daily / 56h weekly, 4.5h max continuous driving with mandatory 30-min break, 11h daily rest. All thresholds are configurable in Settings to match sector-specific Ministry of Transport regulations.

---
*Built with React, Electron, and Tailwind CSS. Tailored for the Iraqi Workforce.*
