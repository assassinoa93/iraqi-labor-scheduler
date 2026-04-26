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

  // API: Get App Data
  app.get("/api/data", (req, res) => {
    const data: Record<string, any> = {};
    const files = ["employees", "shifts", "holidays", "config", "stations", "allSchedules"];
    
    files.forEach(file => {
      const filePath = path.join(DATA_DIR, `${file}.json`);
      if (fs.existsSync(filePath)) {
        try {
          data[file] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (e) {
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
    const body = req.body;
    Object.keys(body).forEach(key => {
      const filePath = path.join(DATA_DIR, `${key}.json`);
      fs.writeFileSync(filePath, JSON.stringify(body[key], null, 2));
    });
    res.json({ success: true });
  });

  // API: Reset Data (Factory Reset)
  app.post("/api/reset", (req, res) => {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
