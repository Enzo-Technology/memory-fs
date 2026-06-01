#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "node:http";

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
    const content = result.content as Array<{ type: string; text?: string }> | undefined;
    if (!content || content.length === 0) {
      throw new Error("tool returned empty content");
    }
    const text = content[0].text ?? "";
    if (result.isError) {
      return { error: text };
    }
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

const MAX_BODY_BYTES = 65536;

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Exported start function (lets tests import without running directly)
// ---------------------------------------------------------------------------

export async function buildUiServer(): Promise<Server> {
  return createHttpServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // Health check
    if (url === "/healthz" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello, World!\n');
    return
  })

}