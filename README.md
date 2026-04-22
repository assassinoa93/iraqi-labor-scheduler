# Iraqi Labor Scheduler - Local Installation Guide

This application is designed to run entirely on your local machine to ensure maximum data privacy. No personnel data is ever sent to a server.

## Prerequisites
- [Node.js](https://nodejs.org/) (Version 18 or higher recommended)
- A modern web browser (Chrome, Edge, or Firefox)

## Local Setup Instructions
1. **Extract the ZIP**: Unzip the project files into a folder on your computer.
2. **Open Terminal**: Open your Command Prompt (CMD), PowerShell, or Terminal in that folder.
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Start the App**:
   ```bash
   npm run dev
   ```
5. **Access the App**:
   Once started, the terminal will provide a local link (usually `http://localhost:3000`). Copy and paste this into your browser.

## Data Privacy Facts
- **Zero Server Storage**: Every employee name, salary detail, and schedule is stored in your browser's local cache.
- **Offline Use**: Once you have run `npm install`, you do not need an internet connection to run the scheduler.
- **Backup Often**: Use the **System Settings > Create Local Backup** button in the app frequently to save your work to a file, as clearing browser history may delete your records.
