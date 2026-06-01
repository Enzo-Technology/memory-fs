import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection } from "node:net";

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

async function spawnHttpServer(port: number): Promise<{ kill: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "memfs-http-"));
  const child = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      MEMORY_FS_DB: join(dir, "test.db"),
      MEMORY_FS_HTTP_PORT: String(port),
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
  // The Resource Server's sole contribution at the HTTP layer is the bearer gate.
  // The MCP tool surface itself is covered, auth-free, by the stdio smoke test —
  // no need to mint an OAuth token here just to re-list the same 7 tools.
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });

  it("returns 401 without an Authorization header", async () => {
    const port = await getFreePort();
    const server = await spawnHttpServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: initBody,
      });
      expect(res.status).toBe(401);
      // PRM pointer so the client knows where to start the OAuth flow.
      expect(res.headers.get("WWW-Authenticate")).toMatch(/resource_metadata=/);
    } finally {
      server.kill();
    }
  });

  it("returns 401 for an unverifiable bearer (no static-token bypass)", async () => {
    const port = await getFreePort();
    const server = await spawnHttpServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer not-a-real-jwt",
        },
        body: initBody,
      });
      expect(res.status).toBe(401);
    } finally {
      server.kill();
    }
  });

  it("serves Protected Resource Metadata pointing at the trusted AS", async () => {
    const port = await getFreePort();
    const server = await spawnHttpServer(port);
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`,
      );
      expect(res.status).toBe(200);
      const prm = (await res.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(prm.resource).toBe(`http://127.0.0.1:${port}/mcp`);
      expect(prm.authorization_servers).toEqual([
        `http://127.0.0.1:${port}/api/auth`,
      ]);
    } finally {
      server.kill();
    }
  });
});
