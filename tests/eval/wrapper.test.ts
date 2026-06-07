import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function connect(naming: string) {
  const db = join(mkdtempSync(join(tmpdir(), "memfs-wrap-")), "w.db");
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [resolve(import.meta.dirname, "../../eval/server/index.mjs")],
    env: { ...process.env, NAMING: naming, MEMORY_FS_DB: db },
  }));
  return client;
}

describe("wrapper server", () => {
  it("exposes context_* names under NAMING=C", async () => {
    const client = await connect("C");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("context_write");
    expect(names).toContain("context_search");
    expect(names).not.toContain("memory_write");
    await client.close();
  });

  it("write then search round-trips through the real store", async () => {
    const client = await connect("C");
    await client.callTool({ name: "context_write", arguments: {
      namespace: "project:enzo", key: "x", content: "the auth provider is Clerk",
    }});
    const res = await client.callTool({ name: "context_search", arguments: { query: "auth" }});
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("Clerk");
    await client.close();
  });

  it("write result carries the condition's result string", async () => {
    const client = await connect("K");
    const res = await client.callTool({ name: "knowledge_write", arguments: {
      namespace: "project:enzo", key: "y", content: "we use Vitest",
    }});
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("Knowledge base entry added.");
    await client.close();
  });
});
