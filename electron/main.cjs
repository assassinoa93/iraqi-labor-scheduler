'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const http  = require('http');
const fs    = require('fs');

// ─── Environment ─────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const PORT  = 3000;
const ICON  = path.join(__dirname, '..', 'assets', 'icon.png');

// ─── Data directory ──────────────────────────────────────────────────────────
// Production → AppData\Roaming\IraqiLaborScheduler\data   (writable, persisted)
// Dev        → ./data  (same as the old server.ts behaviour)
const dataDir = isDev
  ? path.join(__dirname, '..', 'data')
  : path.join(app.getPath('userData'), 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR    = dataDir;
process.env.PORT        = String(PORT);
process.env.NODE_ENV    = isDev ? 'development' : 'production';

// ─── Start Express server in-process (production only) ───────────────────────
// In dev, `npm run dev` already runs the tsx server separately.
if (!isDev) {
  try {
    require(path.join(__dirname, '..', 'server-bundle.js'));
  } catch (e) {
    console.error('[Electron] Failed to start embedded server:', e);
  }
}

// ─── Poll until server is ready ──────────────────────────────────────────────
function waitForServer(cb, retries = 40) {
  const req = http.get(`http://127.0.0.1:${PORT}/api/data`, (res) => {
    res.resume();
    if (res.statusCode < 500) { cb(); return; }
    setTimeout(() => waitForServer(cb, retries - 1), 400);
  });
  req.setTimeout(600);
  req.on('error', () => {
    if (retries > 0) setTimeout(() => waitForServer(cb, retries - 1), 400);
  });
  req.end();
}

// ─── Tray ────────────────────────────────────────────────────────────────────
let tray = null;

function createTray(win) {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Iraqi Labor Scheduler');
  const menu = Menu.buildFromTemplate([
    { label: 'Open',  click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Quit',  click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ─── Main window ─────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:    1440,
    height:   900,
    minWidth: 1100,
    minHeight:700,
    icon:     ICON,
    title:    'Iraqi Labor Scheduler',
    backgroundColor: '#1E293B',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          true,
    },
    show: false,   // reveal once ready-to-show
  });

  // Remove browser menu bar → feels like a native app
  Menu.setApplicationMenu(null);

  const loadURL = () => {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  };

  // In dev the server is already running; in prod wait for the embedded server
  if (isDev) {
    waitForServer(loadURL);   // Vite dev server may need a moment too
  } else {
    waitForServer(loadURL);
  }

  // Open external links in the default browser, not in the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Minimise to tray instead of hiding
  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  createTray(mainWindow);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Don't quit — window is hidden in tray; user must use Tray > Quit
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { app.isQuitting = true; });
