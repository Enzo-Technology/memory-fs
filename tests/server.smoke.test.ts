import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

interface JsonRpcResponse {
  id: number;
  result?: { content?: { text: string }[]; tools?: { name: string }[] };
}

async function callServer(messages: object[]): Promise<JsonRpcResponse[]> {
  const dir = mkdtempSync(join(tmpdir(), "memfs-"));
  const child = spawn("node", ["dist/index.js"], {
    // Deliberately no BETTER_AUTH_SECRET: stdio is auth-free and must boot without it.
    env: { ...process.env, MEMORY_FS_DB: join(dir, "test.db") },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const responses: JsonRpcResponse[] = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) responses.push(JSON.parse(trimmed) as JsonRpcResponse);
  });
  // Send messages sequentially, waiting for each response
  for (const m of messages) {
    child.stdin.write(JSON.stringify(m) + "\n");
    // Wait for this specific response
    await new Promise<void>((res) => {
      const check = setInterval(() => {
        const id = (m as { id?: number }).id;
        if (id !== undefined && responses.some((r) => r.id === id)) {
          clearInterval(check);
          res();
        }
      }, 10);
    });
  }
  child.stdin.end();
  child.kill();
  return responses;
}

describe("server stdio smoke", () => {
  it("lists 7 tools after initialize", async () => {
    const responses = await callServer([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const list = responses.find((r) => r.id === 2);
    const names = list?.result?.tools?.map((t) => t.name).sort();
    expect(names).toEqual([
      "context_backlinks",
      "context_browse",
      "context_delete",
      "context_link",
      "context_read",
      "context_search",
      "context_write",
    ]);
  });

  it("round-trips write → search → backlinks", async () => {
    const responses = await callServer([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "context_write",
          arguments: {
            namespace: "test",
            key: "target",
            content: "# Auth Decision\n\nWe picked Clerk.",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "context_write",
          arguments: {
            namespace: "test",
            key: "src",
            content: "see [[target]] for details",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "context_search",
          arguments: { query: "auth Clerk" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "context_backlinks",
          arguments: { namespace: "test", key: "target" },
        },
      },
    ]);
    const recall = responses.find((r) => r.id === 4);
    const recallText = recall?.result?.content?.[0]?.text ?? "";
    expect(recallText).toContain("Clerk");
    const backlinks = responses.find((r) => r.id === 5);
    const blText = backlinks?.result?.content?.[0]?.text ?? "";
    expect(blText).toContain("from_key");
    expect(blText).toContain("src");
  });
});
