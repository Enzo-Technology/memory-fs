// eval/snapshot-surfaces.mjs — list each condition's live tool surface and commit it,
// so the exact manipulation is part of the record (per spec §5/§7).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const CONDS = ["M", "C", "K", "N", "MxC", "CxM"];
const outDir = resolve(import.meta.dirname, "surfaces");
mkdirSync(outDir, { recursive: true });

for (const NAMING of CONDS) {
  const client = new Client({ name: "snap", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [resolve(import.meta.dirname, "server/index.mjs")],
    env: { ...process.env, NAMING, MEMORY_FS_DB: `/tmp/snap-${randomUUID()}.db` },
  }));
  const { tools } = await client.listTools();
  await client.close();
  const surface = tools
    .map((t) => ({ name: t.name, description: t.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(resolve(outDir, `${NAMING}.json`), JSON.stringify(surface, null, 2));
  console.log(`snapshot ${NAMING}: ${tools.length} tools`);
}
