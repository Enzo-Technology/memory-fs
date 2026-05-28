#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`[memory-fs-ui] ${name} must be set`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// MCP helper: one call, one connection
// ---------------------------------------------------------------------------

async function callTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const client = new Client({ name: "memory-fs-ui", version: "0.1.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0].text ?? "";
    return JSON.parse(text);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx === -1 ? "" : url.slice(idx + 1));
}

function jsonResponse(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Exported start function (lets tests import without running directly)
// ---------------------------------------------------------------------------

export async function startUiServer(): Promise<Server> {
  const memoryFsUrl = requireEnv("MEMORY_FS_URL");
  const token = requireEnv("MEMORY_FS_TOKEN");
  const uiPort = parseInt(process.env.MEMORY_FS_UI_PORT ?? "4040", 10);

  const indexHtmlPath = join(import.meta.dirname, "../public/index.html");

  const server = createHttpServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const path = url.split("?")[0];

    try {
      // -----------------------------------------------------------------------
      // GET / — serve the HTML UI (or placeholder if not built yet)
      // -----------------------------------------------------------------------
      if (method === "GET" && path === "/") {
        let html: Buffer | null = null;
        try {
          html = await readFile(indexHtmlPath);
        } catch {
          // index.html not yet built (Task 2)
        }
        if (html) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(html);
        } else {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("UI page not built yet");
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /api/browse
      // -----------------------------------------------------------------------
      if (method === "GET" && path === "/api/browse") {
        const q = parseQuery(url);
        const args: Record<string, unknown> = {
          kind: q.get("kind") ?? "index",
        };
        if (q.has("namespace")) args.namespace = q.get("namespace");
        if (q.has("prefix")) args.prefix = q.get("prefix");
        if (q.has("limit")) args.limit = parseInt(q.get("limit")!, 10);
        const data = await callTool(memoryFsUrl, token, "memory_browse", args);
        jsonResponse(res, 200, data);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /api/read
      // -----------------------------------------------------------------------
      if (method === "GET" && path === "/api/read") {
        const q = parseQuery(url);
        const data = await callTool(memoryFsUrl, token, "memory_read", {
          namespace: q.get("namespace") ?? "",
          key: q.get("key") ?? "",
        });
        jsonResponse(res, 200, data);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /api/backlinks
      // -----------------------------------------------------------------------
      if (method === "GET" && path === "/api/backlinks") {
        const q = parseQuery(url);
        const data = await callTool(memoryFsUrl, token, "memory_backlinks", {
          namespace: q.get("namespace") ?? "",
          key: q.get("key") ?? "",
        });
        jsonResponse(res, 200, data);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /api/delete
      // -----------------------------------------------------------------------
      if (method === "POST" && path === "/api/delete") {
        const raw = await readBody(req);
        const { namespace, key, force } = JSON.parse(raw) as {
          namespace: string;
          key: string;
          force?: boolean;
        };
        // Tool returns an error result (not a thrown error) when backlinks block
        // deletion. Pass the result through as-is; don't treat it as a 500.
        const data = await callTool(memoryFsUrl, token, "memory_delete", {
          namespace,
          key,
          force: force ?? false,
        });
        jsonResponse(res, 200, data);
        return;
      }

      // -----------------------------------------------------------------------
      // Fallthrough → 404
      // -----------------------------------------------------------------------
      jsonResponse(res, 404, { error: "not found" });
    } catch (e) {
      jsonResponse(res, 502, { error: (e as Error).message });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(uiPort, "127.0.0.1", resolve);
  });

  console.error(`[memory-fs-ui] serving on http://127.0.0.1:${uiPort} -> ${memoryFsUrl}`);
  return server;
}

// ---------------------------------------------------------------------------
// Entry point when run directly
// ---------------------------------------------------------------------------

// Detect if this file is the main module
const isMain = process.argv[1]?.endsWith("ui-server.js") ||
  process.argv[1]?.endsWith("ui-server.ts");

if (isMain) {
  startUiServer().catch((e) => {
    console.error("[memory-fs-ui] fatal:", (e as Error).message);
    process.exit(1);
  });
}
