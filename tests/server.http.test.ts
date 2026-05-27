import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

async function spawnHttpServer(port: number, token: string): Promise<{ kill: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "memfs-http-"));
  const child = spawn("node", ["dist/server.js"], {
    env: {
      ...process.env,
      MEMORY_FS_DB: join(dir, "test.db"),
      MEMORY_FS_HTTP_PORT: String(port),
      MEMORY_FS_TOKEN: token,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  // Ensure the child is killed if vitest is forcibly terminated
  process.on("exit", () => child.kill());

  // Wait until the server is accepting connections
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

describe("server HTTP transport", () => {
  it("returns 401 without Authorization header", async () => {
    const port = await getFreePort();
    const server = await spawnHttpServer(port, "secret");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      expect(res.status).toBe(401);
    } finally {
      server.kill();
    }
  });

  it("lists 7 tools with valid Bearer token", async () => {
    const port = await getFreePort();
    const server = await spawnHttpServer(port, "secret");
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        {
          requestInit: {
            headers: { Authorization: "Bearer secret" },
          },
        },
      );
      const client = new Client({ name: "test", version: "0" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "memory_backlinks",
        "memory_browse",
        "memory_delete",
        "memory_link",
        "memory_note",
        "memory_read",
        "memory_recall",
      ]);
      await client.close();
    } finally {
      server.kill();
    }
  });
});
