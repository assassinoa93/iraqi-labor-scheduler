# 🇮🇶 Iraqi Labor Scheduler (Standalone)

A professional, local-first workforce management and automated scheduling system tailored for **Iraqi Labor Law (Art. 67-74)**.

![App Icon](assets/icon.png)

## 🌟 Key Features
- **⚖️ Legal Compliance Engine**: Automated checks for maximum work hours (Art. 67), mandatory rest days (Art. 71), and holiday compensation (Art. 73-74).
- **🤖 Intelligent Auto-Scheduler**: Fills your shop layout stations automatically based on employee eligibility and legal limits.
- **🖥️ Native Standalone App**: Runs as a professional Windows application with no browser tabs or address bars.
- **🔒 Privacy First**: 100% Local data storage. No cloud dependencies, no tracking.
- **📄 Professional Reporting**: One-click PDF compliance reports and CSV payroll drafts.

## 🚀 Quick Start (Recommended)
The easiest way to use the app is to download the pre-built installer:

1. **[Download Latest Release (v1.0.5)](https://github.com/assassinoa93/Iraqi-Workplace---Vibecoded-apps/releases/latest)**
2. Run the **`Iraqi-Labor-Scheduler-Setup-1.0.4.exe`**.
3. Follow the on-screen instructions to install.
4. Open the app from your **Desktop Shortcut**.

> [!NOTE]
> **Windows Security Notice**: Because this is an independent open-source project, Windows may show a "SmartScreen" warning. Click **"More Info"** and then **"Run anyway"** to proceed. This is normal for custom software.

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
- **Article 71**: Mandatory weekly rest (minimum 24 consecutive hours).
- **Article 73**: Double pay or compensation days for work on official holidays.

---
*Built with React, Electron, and Tailwind CSS. Tailored for the Iraqi Workforce.*
