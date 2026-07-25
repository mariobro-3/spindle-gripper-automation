import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const ROOT = __dirname;
const JOBS_DIR = path.join(ROOT, "jobs");
const CAD_DIR = path.join(ROOT, "CAD Files");

function safeName(name: string): string | null {
  const decoded = decodeURIComponent(name);
  if (!decoded || decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")) return null;
  return decoded;
}

function listStepFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listStepFiles(path.join(dir, entry.name), rel));
    else if (/\.(step|stp)$/i.test(entry.name)) out.push(rel);
  }
  return out;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function apiMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown, type = "application/json") => {
      res.statusCode = status;
      res.setHeader("Content-Type", type);
      res.end(type === "application/json" ? JSON.stringify(body) : (body as string));
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
        return send(200, listStepFiles(CAD_DIR));
      }

      const cadMatch = url.pathname.match(/^\/cad\/(.+)$/);
      if (cadMatch && req.method === "GET") {
        const rel = decodeURIComponent(cadMatch[1]);
        if (rel.includes("..")) return send(400, { error: "bad path" });
        const file = path.join(CAD_DIR, rel);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: "not found" });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
        return;
      }
    } catch (err) {
      return send(500, { error: String(err) });
    }
    next();
  };
}

function localApiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use(apiMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware());
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: { port: 5178 },
  preview: { port: 5178 },
  optimizeDeps: {
    include: ["occt-import-js"],
    exclude: ["replicad-opencascadejs"],
  },
  worker: {
    format: "es",
  },
});
