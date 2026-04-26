import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// In production, esbuild provides __dirname for CJS
// In dev (tsx), we handle both
const _dirname = typeof __dirname !== 'undefined' 
  ? __dirname 
  : path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000');
  
  // DATA_DIR is set by Electron main process (AppData in production)
  const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(_dirname, "data");

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  app.use(express.json({ limit: '50mb' }));

  const ALLOWED_KEYS = new Set(["employees", "shifts", "holidays", "config", "stations", "allSchedules"]);
  const RESET_CONFIRM_TOKEN = "DELETE_ALL_DATA";

  // Atomic write: write to *.tmp then rename. On Windows same-volume renames are atomic,
  // so a crash mid-write can never leave a half-written JSON on disk.
  const atomicWrite = (filePath: string, contents: string) => {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, filePath);
  };

  // API: Get App Data
  app.get("/api/data", (req, res) => {
    const data: Record<string, any> = {};
    ALLOWED_KEYS.forEach(file => {
      const filePath = path.join(DATA_DIR, `${file}.json`);
      if (fs.existsSync(filePath)) {
        try {
          data[file] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (e) {
          // Corrupt file: surface in server log so users can recover from a backup
          console.error(`[Scheduler] Corrupt data file ${file}.json:`, e);
          data[file] = null;
        }
      } else {
        data[file] = null;
      }
    });

    res.json(data);
  });

  // API: Save App Data
  app.post("/api/save", (req, res) => {
    const body = req.body || {};
    try {
      Object.keys(body).forEach(key => {
        if (!ALLOWED_KEYS.has(key)) return; // Drop unknown keys (defense in depth)
        const filePath = path.join(DATA_DIR, `${key}.json`);
        atomicWrite(filePath, JSON.stringify(body[key], null, 2));
      });
      res.json({ success: true });
    } catch (e) {
      console.error("[Scheduler] Save failed:", e);
      res.status(500).json({ error: "Save failed" });
    }
  });

  // API: Reset Data (Factory Reset)
  // Requires an explicit confirm token in the body to prevent accidental wipes
  // from a misfired fetch in the renderer.
  app.post("/api/reset", (req, res) => {
    if (req.body?.confirm !== RESET_CONFIRM_TOKEN) {
      return res.status(400).json({ error: "Confirmation token missing" });
    }
    try {
      if (fs.existsSync(DATA_DIR)) {
        const files = fs.readdirSync(DATA_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(DATA_DIR, file));
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Could not reset data" });
    }
  });

  // API: Shutdown
  app.post("/api/shutdown", (req, res) => {
    console.log("Shutting down server...");
    res.json({ success: true });
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(_dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to loopback only — this is a single-user local app embedded in Electron.
  // 0.0.0.0 would expose the unauthenticated /api/save and /api/reset to anything
  // on the LAN (café/hotel Wi-Fi), allowing data exfiltration or wipe.
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
  });
}

startServer();
