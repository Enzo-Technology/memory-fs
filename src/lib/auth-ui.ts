// Serves the Authorization Server's login/consent pages (built by `vite build ui` →
// dist/ui). They MUST be same-origin with Better Auth at /api/auth — the authorize flow
// redirects here and the session cookie is per-origin — so the Node server serves them,
// not a separate host. In dev the Vite dev server serves these with HMR and proxies
// /api/auth back here, so this is effectively prod-only. Reads are per-request so the
// Node server can boot without a UI build present.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";

const UI_DIR = join(process.cwd(), "dist", "ui");
const PAGES: Record<string, string> = {
  "/sign-in": "sign-in.html",
  "/consent": "consent.html",
};

function contentType(file: string): string {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

function send(res: ServerResponse, file: string): boolean {
  try {
    const body = readFileSync(join(UI_DIR, file));
    res.writeHead(200, { "Content-Type": contentType(file) });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
  return true; // handled either way — don't fall through to the auth gate
}

/** Serve a built UI page or hashed /assets/* file. Returns true if it handled the URL. */
export function serveAuthUi(url: string, res: ServerResponse): boolean {
  const path = url.split("?")[0];
  if (PAGES[path]) return send(res, PAGES[path]);
  if (path.startsWith("/assets/")) {
    const name = path.slice("/assets/".length);
    if (name.includes("/") || name.includes("..")) return false; // no path traversal
    return send(res, join("assets", name));
  }
  return false;
}