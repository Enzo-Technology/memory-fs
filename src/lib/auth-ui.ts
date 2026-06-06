// Serves the single-page web app (built by `vite build ui` → dist/ui): the AS login &
// consent screens AND the session-managed memory browser, all one React bundle. It MUST
// be same-origin with Better Auth at /api/auth — the OAuth flow redirects here and the
// session cookie is per-origin — so the Node server serves it, not a separate host.
// History fallback: any path that isn't a hashed asset returns index.html, and the client
// (ui/src/App.tsx) picks the screen from the URL. Reads are per-request so the Node server
// can boot without a UI build present. The caller routes /mcp and /api/auth *before* this,
// so the catch-all never swallows them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";

const UI_DIR = join(process.cwd(), "dist", "ui");

function send(res: ServerResponse, file: string, contentType: string): void {
  try {
    res.writeHead(200, { "Content-Type": contentType });
    res.end(readFileSync(join(UI_DIR, file)));
  } catch {
    res.writeHead(404).end();
  }
}

/** Serve the SPA: hashed /assets/* files, else index.html (history fallback). */
export function serveWebApp(url: string, res: ServerResponse): void {
  const path = url.split("?")[0];
  if (path.startsWith("/assets/")) {
    const name = path.slice("/assets/".length);
    if (name.includes("/") || name.includes("..")) return void res.writeHead(404).end();
    const type = name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8";
    return send(res, join("assets", name), type);
  }
  send(res, "index.html", "text/html; charset=utf-8");
}
