import { app, BrowserWindow, shell } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In the packaged app, jobs live in the user's Documents so they are easy to
// find and share; CAD Files are bundled read-only next to the executable.
const JOBS_DIR = app.isPackaged
  ? path.join(app.getPath("documents"), "Spindle Gripper Jobs")
  : path.join(__dirname, "..", "jobs");
const CAD_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "CAD Files")
  : path.join(__dirname, "..", "CAD Files");
// User-uploaded STEP files (soft jaws, own vises). The bundled CAD folder is
// read-only when packaged, so custom files live next to the saved jobs.
const CUSTOM_CAD_DIR = app.isPackaged
  ? path.join(app.getPath("documents"), "Spindle Gripper Jobs", "Custom CAD")
  : path.join(CAD_DIR, "Custom");
const DIST_DIR = path.join(__dirname, "..", "dist");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function safeName(name) {
  const decoded = decodeURIComponent(name);
  if (!decoded || decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")) return null;
  return decoded;
}

function listStepFiles(dir, base = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listStepFiles(path.join(dir, entry.name), rel));
    else if (/\.(step|stp)$/i.test(entry.name)) out.push(rel);
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status, body, type = "application/json") => {
    res.statusCode = status;
    res.setHeader("Content-Type", type);
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  try {
    if (url.pathname === "/api/jobs" && req.method === "GET") {
      fs.mkdirSync(JOBS_DIR, { recursive: true });
      const jobs = fs
        .readdirSync(JOBS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const stat = fs.statSync(path.join(JOBS_DIR, f));
          return { name: f.replace(/\.json$/, ""), modified: stat.mtimeMs };
        });
      return send(200, jobs);
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/(.+)$/);
    if (jobMatch) {
      const name = safeName(jobMatch[1]);
      if (!name) return send(400, { error: "bad name" });
      const file = path.join(JOBS_DIR, `${name}.json`);
      if (req.method === "GET") {
        if (!fs.existsSync(file)) return send(404, { error: "not found" });
        return send(200, JSON.parse(fs.readFileSync(file, "utf-8")));
      }
      if (req.method === "POST" || req.method === "PUT") {
        fs.mkdirSync(JOBS_DIR, { recursive: true });
        const body = await readBody(req);
        JSON.parse(body); // validate
        fs.writeFileSync(file, body, "utf-8");
        return send(200, { ok: true });
      }
      if (req.method === "DELETE") {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return send(200, { ok: true });
      }
    }

    if (url.pathname === "/api/cad" && req.method === "GET") {
      const files = listStepFiles(CAD_DIR);
      // packaged: custom files live outside CAD_DIR, list them under Custom/
      if (app.isPackaged) {
        for (const f of listStepFiles(CUSTOM_CAD_DIR)) files.push(`Custom/${f}`);
      }
      return send(200, files);
    }

    // upload a user STEP file into the custom CAD folder
    const cadUpload = url.pathname.match(/^\/api\/cad\/(.+)$/);
    if (cadUpload && req.method === "POST") {
      const name = safeName(cadUpload[1]);
      if (!name || !/\.(step|stp)$/i.test(name)) return send(400, { error: "bad name" });
      fs.mkdirSync(CUSTOM_CAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(CUSTOM_CAD_DIR, name), await readBodyBuffer(req));
      return send(200, { ok: true, path: `Custom/${name}` });
    }

    const cadMatch = url.pathname.match(/^\/cad\/(.+)$/);
    if (cadMatch && req.method === "GET") {
      const rel = decodeURIComponent(cadMatch[1]);
      if (rel.includes("..")) return send(400, { error: "bad path" });
      const file =
        app.isPackaged && rel.startsWith("Custom/")
          ? path.join(CUSTOM_CAD_DIR, rel.slice("Custom/".length))
          : path.join(CAD_DIR, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: "not found" });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      fs.createReadStream(file).pipe(res);
      return;
    }

    // Static files from the built app; anything unknown falls back to index.html.
    let rel = decodeURIComponent(url.pathname);
    if (rel.includes("..")) return send(400, { error: "bad path" });
    if (rel === "/") rel = "/index.html";
    let file = path.join(DIST_DIR, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      file = path.join(DIST_DIR, "index.html");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    send(500, { error: String(err) });
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(handleRequest);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    title: "Spindle Gripper Automation",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  // External links (docs etc.) open in the default browser, not the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
