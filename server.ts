import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const DATA_DIR = path.join(__dirname, "data");

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
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
