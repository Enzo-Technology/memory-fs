// Serves the static OAuth UI assets (sign-in / consent pages + their browser scripts).
// The .html/.js live next to this file and are authored as real files with real tooling.
//
// SERVING stays in the main server (src/index.ts) — not the standalone ui-server — because
// the pages must be same-origin with the Better Auth AS at /api/auth: the authorize flow
// redirects to these paths and the session cookie is per-origin.
//
// import.meta.dirname resolves to src/lib/ui under tsx (dev) and dist/lib/ui under node
// (prod), so the build copies the assets next to the compiled pages.js (see package.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";

const dir = import.meta.dirname;
const read = (file: string) => readFileSync(join(dir, file), "utf8");

const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";

// Read once at startup. A missing asset throws here and crashes the process — correct:
// a deploy that forgot to copy assets should fail loudly, not 404 at request time.
const ASSETS: Record<string, { body: string; type: string }> = {
  "/sign-in": { body: read("sign-in.html"), type: HTML },
  "/sign-up": { body: read("sign-up.html"), type: HTML },
  "/consent": { body: read("consent.html"), type: HTML },
  "/_ui/sign-in.js": { body: read("sign-in.js"), type: JS },
  "/_ui/sign-up.js": { body: read("sign-up.js"), type: JS },
  "/_ui/consent.js": { body: read("consent.js"), type: JS },
};

/** Serve a static UI asset if the (query-stripped) path matches one. Returns true if handled. */
export function serveUiAsset(url: string, res: ServerResponse): boolean {
  const asset = ASSETS[url.split("?")[0]];
  if (!asset) return false;
  res.writeHead(200, { "Content-Type": asset.type });
  res.end(asset.body);
  return true;
}
