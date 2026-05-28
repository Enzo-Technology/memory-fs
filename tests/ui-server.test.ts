import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve((addr as { port: number }).port));
    });
    srv.on("error", reject);
  });
}

async function spawnHttpServer(port: number, token: string, dbPath: string): Promise<{ kill: () => void }> {
  const child = spawn("node", ["dist/server.js"], {
    env: {
      ...process.env,
      MEMORY_FS_DB: dbPath,
      MEMORY_FS_HTTP_PORT: String(port),
      MEMORY_FS_TOKEN: token,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  process.on("exit", () => child.kill());

  const deadline = Date.now() + 5000;
  let connected = false;
  while (Date.now() < deadline) {
    connected = await new Promise<boolean>((resolve) => {
      const c = createConnection({ port, host: "127.0.0.1" });
      c.on("connect", () => { c.destroy(); resolve(true); });
      c.on("error", () => resolve(false));
    });
    if (connected) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!connected) {
    child.kill();
    throw new Error(`server did not start within 5s on port ${port}`);
  }

  return { kill: () => child.kill() };
}

// Import startUiServer lazily so we can set env vars first
async function importStartUiServer() {
  // Dynamic import ensures env is read at call time
  const mod = await import("../src/ui-server.js");
  return mod.startUiServer;
}

describe("ui-server proxy", () => {
  const token = "testsecret";
  let backendPort: number;
  let uiPort: number;
  let backend: { kill: () => void };
  let uiServer: Server;
  let dbDir: string;
  let mcpUrl: string;

  beforeAll(async () => {
    // Spin up real MCP server
    dbDir = mkdtempSync(join(tmpdir(), "memfs-ui-"));
    const dbPath = join(dbDir, "test.db");
    backendPort = await getFreePort();
    uiPort = await getFreePort();
    backend = await spawnHttpServer(backendPort, token, dbPath);
    mcpUrl = `http://127.0.0.1:${backendPort}/mcp`;

    // Start UI server with env pointing to our backend
    process.env.MEMORY_FS_URL = `http://127.0.0.1:${backendPort}/`;
    process.env.MEMORY_FS_TOKEN = token;
    process.env.MEMORY_FS_UI_PORT = String(uiPort);

    const startUiServer = await importStartUiServer();
    uiServer = await startUiServer();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => uiServer?.close(() => resolve()));
    backend?.kill();
  });

  it("full lifecycle: browse, read, delete", async () => {
    // Seed data via MCP client
    const transport = new StreamableHTTPClientTransport(
      new URL(mcpUrl),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const client = new Client({ name: "test-seeder", version: "0" });
    await client.connect(transport);
    await client.callTool({
      name: "memory_note",
      arguments: {
        namespace: "test-ns",
        key: "hello-world",
        content: "This is the seeded content",
      },
    });
    await client.close();

    // GET / — placeholder or index.html (200 either way)
    const rootRes = await fetch(`http://127.0.0.1:${uiPort}/`);
    expect(rootRes.status).toBe(200);
    const contentType = rootRes.headers.get("content-type") ?? "";
    expect(contentType).toMatch(/text\/(html|plain)/);

    // GET /api/browse?kind=recent — should include seeded key
    const browseRes = await fetch(`http://127.0.0.1:${uiPort}/api/browse?kind=recent`);
    expect(browseRes.status).toBe(200);
    const browseBody = await browseRes.json() as { kind: string; items: Array<{ key: string }> };
    expect(browseBody.kind).toBe("recent");
    const keys = browseBody.items.map((r) => r.key);
    expect(keys).toContain("hello-world");

    // GET /api/read — should return seeded content
    const readRes = await fetch(
      `http://127.0.0.1:${uiPort}/api/read?namespace=test-ns&key=hello-world`,
    );
    expect(readRes.status).toBe(200);
    const readBody = await readRes.json() as { content: string; found?: boolean };
    expect(readBody.content).toBe("This is the seeded content");

    // GET /api/backlinks — empty list is fine, just 200
    const backlinksRes = await fetch(
      `http://127.0.0.1:${uiPort}/api/backlinks?namespace=test-ns&key=hello-world`,
    );
    expect(backlinksRes.status).toBe(200);
    const backlinksBody = await backlinksRes.json();
    expect(Array.isArray(backlinksBody)).toBe(true);

    // POST /api/delete — should succeed
    const deleteRes = await fetch(`http://127.0.0.1:${uiPort}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: "test-ns", key: "hello-world", force: false }),
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json() as { deleted: boolean };
    expect(deleteBody.deleted).toBe(true);

    // Subsequent read should show not found
    const readAfterDelete = await fetch(
      `http://127.0.0.1:${uiPort}/api/read?namespace=test-ns&key=hello-world`,
    );
    expect(readAfterDelete.status).toBe(200);
    const readAfterBody = await readAfterDelete.json() as { found: boolean };
    expect(readAfterBody.found).toBe(false);

    // 404 for unknown route
    const notFoundRes = await fetch(`http://127.0.0.1:${uiPort}/api/unknown`);
    expect(notFoundRes.status).toBe(404);
  });

  it("delete blocked by backlinks returns 200 with error message", async () => {
    // Seed target note
    const transport = new StreamableHTTPClientTransport(
      new URL(mcpUrl),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const client = new Client({ name: "test-backlink-seeder", version: "0" });
    await client.connect(transport);
    await client.callTool({
      name: "memory_note",
      arguments: { namespace: "bl-ns", key: "target", content: "target note" },
    });
    // Seed source note with a wikilink to target
    await client.callTool({
      name: "memory_note",
      arguments: { namespace: "bl-ns", key: "src", content: "links to [[target]]" },
    });
    await client.close();

    // Attempt delete of target without force — backlinks should block it
    const res = await fetch(`http://127.0.0.1:${uiPort}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: "bl-ns", key: "target", force: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { error?: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/backlinks/i);

    // force:true should succeed
    const forceRes = await fetch(`http://127.0.0.1:${uiPort}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: "bl-ns", key: "target", force: true }),
    });
    expect(forceRes.status).toBe(200);
    const forceBody = await forceRes.json() as { deleted?: boolean };
    expect(forceBody.deleted).toBe(true);
  });
});
