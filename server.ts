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
  const AUDIT_FILE = path.join(DATA_DIR, "audit.json");
  const AUDIT_MAX_ENTRIES = 2000;

  // Atomic write: write to *.tmp then rename. On Windows same-volume renames are atomic,
  // so a crash mid-write can never leave a half-written JSON on disk.
  const atomicWrite = (filePath: string, contents: string) => {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, filePath);
  };

  type AuditEntry = {
    ts: number;          // epoch millis
    domain: string;      // 'employees' | 'shifts' | ...
    op: 'add' | 'remove' | 'modify' | 'replace';
    targetId?: string;   // empId / shift code / station id / holiday date
    label?: string;      // human-friendly target name
    summary: string;     // short rendered description
  };

  const readAudit = (): AuditEntry[] => {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    try {
      return JSON.parse(fs.readFileSync(AUDIT_FILE, "utf-8")) as AuditEntry[];
    } catch (e) {
      console.error("[Scheduler] Corrupt audit.json:", e);
      return [];
    }
  };

  const appendAudit = (entries: AuditEntry[]) => {
    if (entries.length === 0) return;
    const existing = readAudit();
    const merged = [...entries, ...existing].slice(0, AUDIT_MAX_ENTRIES);
    atomicWrite(AUDIT_FILE, JSON.stringify(merged, null, 2));
  };

  // Read whatever is currently on disk for a domain, returning null on absence/corruption.
  const readDomain = (key: string): any => {
    const fp = path.join(DATA_DIR, `${key}.json`);
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return null; }
  };

  // Compute audit entries by diffing the prior on-disk value against the incoming one.
  // Each domain has its own identity rule — the function knows enough to label changes
  // without trying to be a generic deep-diff library (would create noise).
  const diffDomain = (key: string, prev: any, next: any): AuditEntry[] => {
    const ts = Date.now();
    if (prev == null && next == null) return [];

    if (key === "employees" || key === "shifts" || key === "stations") {
      const idKey = key === "employees" ? "empId" : key === "shifts" ? "code" : "id";
      const labelKey = key === "shifts" ? "name" : "name";
      const prevArr: any[] = Array.isArray(prev) ? prev : [];
      const nextArr: any[] = Array.isArray(next) ? next : [];
      const prevById = new Map(prevArr.map(x => [x[idKey], x]));
      const nextById = new Map(nextArr.map(x => [x[idKey], x]));
      const entries: AuditEntry[] = [];
      for (const [id, item] of nextById) {
        if (!prevById.has(id)) {
          entries.push({ ts, domain: key, op: "add", targetId: id, label: item[labelKey], summary: `Added ${key.slice(0, -1)}: ${item[labelKey] ?? id}` });
        } else if (JSON.stringify(prevById.get(id)) !== JSON.stringify(item)) {
          entries.push({ ts, domain: key, op: "modify", targetId: id, label: item[labelKey], summary: `Modified ${key.slice(0, -1)}: ${item[labelKey] ?? id}` });
        }
      }
      for (const [id, item] of prevById) {
        if (!nextById.has(id)) {
          entries.push({ ts, domain: key, op: "remove", targetId: id, label: item[labelKey], summary: `Removed ${key.slice(0, -1)}: ${item[labelKey] ?? id}` });
        }
      }
      return entries;
    }

    if (key === "holidays") {
      const prevArr: any[] = Array.isArray(prev) ? prev : [];
      const nextArr: any[] = Array.isArray(next) ? next : [];
      const prevByDate = new Map(prevArr.map(x => [x.date, x]));
      const nextByDate = new Map(nextArr.map(x => [x.date, x]));
      const entries: AuditEntry[] = [];
      for (const [d, item] of nextByDate) {
        if (!prevByDate.has(d)) entries.push({ ts, domain: "holidays", op: "add", targetId: d, label: item.name, summary: `Added holiday ${item.name} (${d})` });
        else if (JSON.stringify(prevByDate.get(d)) !== JSON.stringify(item)) entries.push({ ts, domain: "holidays", op: "modify", targetId: d, label: item.name, summary: `Modified holiday ${item.name} (${d})` });
      }
      for (const [d, item] of prevByDate) {
        if (!nextByDate.has(d)) entries.push({ ts, domain: "holidays", op: "remove", targetId: d, label: item.name, summary: `Removed holiday ${item.name} (${d})` });
      }
      return entries;
    }

    if (key === "config") {
      const a = prev || {}, b = next || {};
      const changed: string[] = [];
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
      }
      if (changed.length === 0) return [];
      return [{ ts, domain: "config", op: "modify", summary: `Config edited: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? `, +${changed.length - 8} more` : ""}` }];
    }

    if (key === "allSchedules") {
      // Per-month replacements — emit one entry per month whose key changed.
      const a = prev || {}, b = next || {};
      const months = new Set([...Object.keys(a), ...Object.keys(b)]);
      const entries: AuditEntry[] = [];
      for (const m of months) {
        if (JSON.stringify(a[m]) !== JSON.stringify(b[m])) {
          entries.push({ ts, domain: "schedule", op: "replace", targetId: m, summary: `Schedule edited for ${m.replace("scheduler_schedule_", "").replace("_", "-")}` });
        }
      }
      return entries;
    }

    return [];
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

  // API: Save App Data — also computes a per-domain diff vs. the prior on-disk
  // state and appends entries to the audit log so we have a "who/what/when"
  // record across edits even though there's only one user.
  app.post("/api/save", (req, res) => {
    const body = req.body || {};
    try {
      const auditEntries: AuditEntry[] = [];
      Object.keys(body).forEach(key => {
        if (!ALLOWED_KEYS.has(key)) return;
        const prev = readDomain(key);
        const next = body[key];
        auditEntries.push(...diffDomain(key, prev, next));
        const filePath = path.join(DATA_DIR, `${key}.json`);
        atomicWrite(filePath, JSON.stringify(next, null, 2));
      });
      appendAudit(auditEntries);
      res.json({ success: true, auditAdded: auditEntries.length });
    } catch (e) {
      console.error("[Scheduler] Save failed:", e);
      res.status(500).json({ error: "Save failed" });
    }
  });

  // API: Audit Log — returns the most recent entries (already capped server-side)
  app.get("/api/audit", (req, res) => {
    res.json({ entries: readAudit() });
  });

  // API: Clear Audit Log (requires same destructive token as factory reset)
  app.post("/api/audit/clear", (req, res) => {
    if (req.body?.confirm !== RESET_CONFIRM_TOKEN) {
      return res.status(400).json({ error: "Confirmation token missing" });
    }
    try {
      if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Could not clear audit log" });
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
      // Audit log is wiped alongside everything else on factory reset.
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
