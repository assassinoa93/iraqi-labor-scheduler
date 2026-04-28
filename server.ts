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

// Default company id used when migrating legacy single-company data files.
// Stays stable across versions so backups generated pre-multi-company keep
// working after a roundtrip. Mirrored on the client (initialData.ts).
const DEFAULT_COMPANY_ID = 'co-default';

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

  // Per-company domains. Each is stored on disk as Record<companyId, T>; the
  // server migrates legacy bare arrays / objects to the namespaced shape on
  // first read. `companies.json` carries the list of companies + active id.
  const COMPANY_DOMAINS = new Set(["employees", "shifts", "holidays", "config", "stations", "allSchedules"]);
  const ALLOWED_KEYS = new Set([...COMPANY_DOMAINS, "companies"]);
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
    companyId?: string;  // namespace the entry — undefined for global ops
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

  // Detect a legacy (pre-multi-company) bare array/object and lift it under
  // DEFAULT_COMPANY_ID so the rest of the codebase only deals with the
  // namespaced shape. Returns the (possibly migrated) value plus a flag the
  // caller can use to know whether to write back the migration.
  const migrateLegacyDomain = (key: string, raw: any): { value: Record<string, any>; migrated: boolean } => {
    if (raw == null) return { value: {}, migrated: false };
    // Domains are objects-keyed-by-companyId. Heuristic: if it's an array,
    // it's the legacy bare shape. The `config` and `allSchedules` domains are
    // objects either way — we detect by spotting a known field at the top
    // level. `config` always has `year`/`month`; `allSchedules` keys look like
    // `scheduler_schedule_YYYY_MM`.
    if (Array.isArray(raw)) {
      return { value: { [DEFAULT_COMPANY_ID]: raw }, migrated: true };
    }
    if (key === "config") {
      // Bare legacy config has top-level `year` / `month` numbers.
      if (typeof raw.year === "number" && typeof raw.month === "number") {
        return { value: { [DEFAULT_COMPANY_ID]: raw }, migrated: true };
      }
      return { value: raw, migrated: false };
    }
    if (key === "allSchedules") {
      // Bare legacy allSchedules: keys are `scheduler_schedule_YYYY_MM`.
      // Namespaced shape: keys are companyIds whose values are themselves
      // objects with `scheduler_schedule_YYYY_MM` keys.
      const keys = Object.keys(raw);
      const looksLegacy = keys.length > 0 && keys.every(k => /^scheduler_schedule_/.test(k));
      if (looksLegacy) {
        return { value: { [DEFAULT_COMPANY_ID]: raw }, migrated: true };
      }
      return { value: raw, migrated: false };
    }
    return { value: raw, migrated: false };
  };

  // Compute audit entries by diffing the prior on-disk value against the incoming one.
  // Each domain has its own identity rule — the function knows enough to label changes
  // without trying to be a generic deep-diff library (would create noise). Operates on
  // the namespaced shape (Record<companyId, T>); emits one entry per company × change.
  const diffDomain = (key: string, prevAll: any, nextAll: any): AuditEntry[] => {
    const ts = Date.now();
    if (prevAll == null && nextAll == null) return [];

    if (key === "companies") {
      const a = prevAll || { companies: [], activeCompanyId: '' };
      const b = nextAll || { companies: [], activeCompanyId: '' };
      const aArr: any[] = Array.isArray(a.companies) ? a.companies : [];
      const bArr: any[] = Array.isArray(b.companies) ? b.companies : [];
      const aById = new Map(aArr.map(x => [x.id, x]));
      const bById = new Map(bArr.map(x => [x.id, x]));
      const entries: AuditEntry[] = [];
      for (const [id, item] of bById) {
        if (!aById.has(id)) entries.push({ ts, domain: "companies", op: "add", targetId: id, label: item.name, summary: `Added company: ${item.name}` });
        else if (JSON.stringify(aById.get(id)) !== JSON.stringify(item)) {
          entries.push({ ts, domain: "companies", op: "modify", targetId: id, label: item.name, summary: `Renamed company → ${item.name}` });
        }
      }
      for (const [id, item] of aById) {
        if (!bById.has(id)) entries.push({ ts, domain: "companies", op: "remove", targetId: id, label: item.name, summary: `Removed company: ${item.name}` });
      }
      if (a.activeCompanyId !== b.activeCompanyId) {
        entries.push({ ts, domain: "companies", op: "modify", summary: `Active company switched`, targetId: b.activeCompanyId });
      }
      return entries;
    }

    const prevByCo: Record<string, any> = (prevAll && typeof prevAll === 'object') ? prevAll : {};
    const nextByCo: Record<string, any> = (nextAll && typeof nextAll === 'object') ? nextAll : {};
    const allCompanyIds = new Set([...Object.keys(prevByCo), ...Object.keys(nextByCo)]);
    const entries: AuditEntry[] = [];

    for (const companyId of allCompanyIds) {
      const prev = prevByCo[companyId];
      const next = nextByCo[companyId];
      if (key === "employees" || key === "shifts" || key === "stations") {
        const idKey = key === "employees" ? "empId" : key === "shifts" ? "code" : "id";
        const labelKey = "name";
        const prevArr: any[] = Array.isArray(prev) ? prev : [];
        const nextArr: any[] = Array.isArray(next) ? next : [];
        const prevById = new Map(prevArr.map(x => [x[idKey], x]));
        const nextById = new Map(nextArr.map(x => [x[idKey], x]));
        for (const [id, item] of nextById) {
          if (!prevById.has(id)) entries.push({ ts, domain: key, op: "add", targetId: id, label: item[labelKey], summary: `Added ${key.slice(0, -1)}: ${item[labelKey] ?? id}`, companyId });
          else if (JSON.stringify(prevById.get(id)) !== JSON.stringify(item)) entries.push({ ts, domain: key, op: "modify", targetId: id, label: item[labelKey], summary: `Modified ${key.slice(0, -1)}: ${item[labelKey] ?? id}`, companyId });
        }
        for (const [id, item] of prevById) {
          if (!nextById.has(id)) entries.push({ ts, domain: key, op: "remove", targetId: id, label: item[labelKey], summary: `Removed ${key.slice(0, -1)}: ${item[labelKey] ?? id}`, companyId });
        }
      } else if (key === "holidays") {
        const prevArr: any[] = Array.isArray(prev) ? prev : [];
        const nextArr: any[] = Array.isArray(next) ? next : [];
        const prevByDate = new Map(prevArr.map(x => [x.date, x]));
        const nextByDate = new Map(nextArr.map(x => [x.date, x]));
        for (const [d, item] of nextByDate) {
          if (!prevByDate.has(d)) entries.push({ ts, domain: "holidays", op: "add", targetId: d, label: item.name, summary: `Added holiday ${item.name} (${d})`, companyId });
          else if (JSON.stringify(prevByDate.get(d)) !== JSON.stringify(item)) entries.push({ ts, domain: "holidays", op: "modify", targetId: d, label: item.name, summary: `Modified holiday ${item.name} (${d})`, companyId });
        }
        for (const [d, item] of prevByDate) {
          if (!nextByDate.has(d)) entries.push({ ts, domain: "holidays", op: "remove", targetId: d, label: item.name, summary: `Removed holiday ${item.name} (${d})`, companyId });
        }
      } else if (key === "config") {
        const a = prev || {}, b = next || {};
        const changed: string[] = [];
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
          if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
        }
        if (changed.length > 0) {
          entries.push({ ts, domain: "config", op: "modify", summary: `Config edited: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? `, +${changed.length - 8} more` : ""}`, companyId });
        }
      } else if (key === "allSchedules") {
        const a = prev || {}, b = next || {};
        const months = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const m of months) {
          if (JSON.stringify(a[m]) !== JSON.stringify(b[m])) {
            entries.push({ ts, domain: "schedule", op: "replace", targetId: m, summary: `Schedule edited for ${m.replace("scheduler_schedule_", "").replace("_", "-")}`, companyId });
          }
        }
      }
    }

    return entries;
  };

  // API: Get App Data — also performs lazy migration of legacy bare-shape
  // files so the next save writes them out in the namespaced shape.
  app.get("/api/data", (_req, res) => {
    const data: Record<string, any> = {};
    let migratedAny = false;
    for (const file of ALLOWED_KEYS) {
      const filePath = path.join(DATA_DIR, `${file}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (file === "companies") {
            data[file] = raw;
          } else {
            const { value, migrated } = migrateLegacyDomain(file, raw);
            data[file] = value;
            if (migrated) migratedAny = true;
          }
        } catch (e) {
          console.error(`[Scheduler] Corrupt data file ${file}.json:`, e);
          data[file] = file === "companies" ? null : {};
        }
      } else {
        data[file] = file === "companies" ? null : {};
      }
    }
    if (migratedAny) {
      console.log("[Scheduler] Migrated legacy data files into namespaced (multi-company) shape.");
    }
    res.json(data);
  });

  // API: Save App Data — also computes a per-domain diff vs. the prior on-disk
  // state and appends entries to the audit log so we have a "who/what/when"
  // record across edits even though there's only one user.
  // Pass ?skipAudit=1 to write data without appending audit entries (used by
  // the renderer right after a factory reset, when default seed data would
  // otherwise generate dozens of noise entries).
  app.post("/api/save", (req, res) => {
    const body = req.body || {};
    const skipAudit = req.query?.skipAudit === '1';
    try {
      const auditEntries: AuditEntry[] = [];
      for (const key of Object.keys(body)) {
        if (!ALLOWED_KEYS.has(key)) continue;
        if (!skipAudit) {
          const prevRaw = readDomain(key);
          const prev = key === "companies" ? prevRaw : migrateLegacyDomain(key, prevRaw).value;
          const next = body[key];
          auditEntries.push(...diffDomain(key, prev, next));
        }
        const filePath = path.join(DATA_DIR, `${key}.json`);
        atomicWrite(filePath, JSON.stringify(body[key], null, 2));
      }
      if (!skipAudit) appendAudit(auditEntries);
      res.json({ success: true, auditAdded: auditEntries.length, skipAudit });
    } catch (e) {
      console.error("[Scheduler] Save failed:", e);
      res.status(500).json({ error: "Save failed" });
    }
  });

  // API: Audit Log — returns the most recent entries (already capped server-side)
  app.get("/api/audit", (_req, res) => {
    res.json({ entries: readAudit() });
  });

  // API: Update status. The Electron main process writes ILS_JUST_UPDATED_*
  // env vars when it detects a successful post-update snapshot. The renderer
  // pings this endpoint at startup so it can show a one-time "updated to vX"
  // toast and surface where the snapshot landed.
  app.get("/api/update-status", (_req, res) => {
    const justUpdatedFrom = process.env.ILS_JUST_UPDATED_FROM || null;
    const justUpdatedTo = process.env.ILS_JUST_UPDATED_TO || null;
    let mostRecentSnapshot: string | null = null;
    try {
      const parent = path.dirname(DATA_DIR);
      if (fs.existsSync(parent)) {
        const candidates = fs.readdirSync(parent, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.startsWith("data-backup-"))
          .map(d => ({ name: d.name, mtime: fs.statSync(path.join(parent, d.name)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (candidates.length > 0) mostRecentSnapshot = path.join(parent, candidates[0].name);
      }
    } catch {
      // Best-effort only.
    }
    res.json({ justUpdatedFrom, justUpdatedTo, mostRecentSnapshot });
  });

  // API: Acknowledge the update toast. Clears the env vars so subsequent
  // launches don't re-show the post-update notice.
  app.post("/api/update-status/ack", (_req, res) => {
    delete process.env.ILS_JUST_UPDATED_FROM;
    delete process.env.ILS_JUST_UPDATED_TO;
    res.json({ success: true });
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
      // Replace the wiped audit log with a single "Factory reset" marker so
      // the user has a clear record of when the reset happened, instead of
      // dozens of "added employee" entries when the client re-seeds defaults.
      const resetEntry: AuditEntry = {
        ts: Date.now(),
        domain: "system",
        op: "replace",
        summary: "Factory reset performed",
      };
      atomicWrite(AUDIT_FILE, JSON.stringify([resetEntry], null, 2));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Could not reset data" });
    }
  });

  // Save endpoint accepts ?skipAudit=1 so the client can avoid spamming the
  // log right after a factory reset (when the renderer re-seeds defaults).
  // The flag is set on the client side via a localStorage marker that survives
  // the post-reset page reload.

  // API: Shutdown
  app.post("/api/shutdown", (_req, res) => {
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
