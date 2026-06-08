// eval/server/index.mjs — renameable MCP stdio wrapper around the production store.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "../../dist/core/db.js";
import { MemoryStore } from "../../dist/core/store.js";
import { loadConditions } from "../lib/conditions.mjs";

const NAMING = process.env.NAMING;
const cond = loadConditions()[NAMING];
if (!cond) {
  console.error(`[wrapper] unknown NAMING='${NAMING}' (expect M|C|K|N|MxC|CxM)`);
  process.exit(1);
}

const TERSE = process.env.TERSE === "1";
// Condition-independent stub descriptions used when TERSE=1.
// Tool names and argument schemas are preserved; only descriptions + result strings change.
const TERSE_DESC = {
  write:     "Save an item.",
  read:      "Get an item by location.",
  search:    "Find items by keyword.",
  browse:    "List items.",
  link:      "Relate two items.",
  backlinks: "Find items referencing this one.",
  delete:    "Remove an item.",
};
const TERSE_RESULTS = { write: "Saved.", delete: "Removed." };

const store = new MemoryStore(openDb()); // MEMORY_FS_DB selects the file

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const okWith = (prefix, data) => ({
  content: [{ type: "text", text: `${prefix}\n${JSON.stringify(data, null, 2)}` }],
});

// Argument schemas are IDENTICAL across conditions — only name/description vary.
const memoryType = z.enum(["user", "feedback", "project", "reference", "note"]);
const schemas = {
  write: {
    content: z.string().min(1), namespace: z.string().min(1), key: z.string().optional(),
    type: memoryType.optional(), tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(), source: z.string().optional(),
    on_conflict: z.enum(["overwrite", "append", "error"]).optional(),
  },
  read:   { namespace: z.string().min(1), key: z.string().min(1) },
  search: { query: z.string().min(1), namespace: z.string().optional(), type: memoryType.optional(),
            tags: z.array(z.string()).optional(), since: z.string().optional(),
            limit: z.number().int().positive().max(20).optional() },
  browse: { kind: z.enum(["index","recent","hubs","orphans","tags","namespaces"]),
            namespace: z.string().optional(), prefix: z.string().optional(),
            limit: z.number().int().positive().max(100).optional() },
  link:   { from_namespace: z.string().min(1), from_key: z.string().min(1),
            to_namespace: z.string().min(1), to_key: z.string().min(1), relation: z.string().optional() },
  backlinks: { namespace: z.string().min(1), key: z.string().min(1) },
  delete: { namespace: z.string().min(1), key: z.string().min(1), force: z.boolean().optional() },
};

// Each verb's handler delegates to the same store method regardless of condition.
const resultStr = (verb) => TERSE ? TERSE_RESULTS[verb] ?? cond.resultStrings[verb] : cond.resultStrings[verb];
const handlers = {
  write: (a) => okWith(resultStr("write"), store.note(a, null)),
  read:  (a) => {
    const m = store.read(a.namespace, a.key);
    return ok(m ?? { found: false, hint: `No record at namespace='${a.namespace}' key='${a.key}'.` });
  },
  search: (a) => ok(store.recall(a)),
  browse: (a) => ok(store.browse(a)),
  link:   (a) => ok({ linked: store.link(a.from_namespace, a.from_key, a.to_namespace, a.to_key, a.relation),
                      relation: a.relation ?? "related" }),
  backlinks: (a) => ok(store.backlinks(a.namespace, a.key)),
  delete: (a) => {
    try { return okWith(resultStr("delete"), { deleted: store.del(a.namespace, a.key, a.force ?? false), namespace: a.namespace, key: a.key }); }
    catch (e) { return { content: [{ type: "text", text: String(e.message) }], isError: true }; }
  },
};

const server = new McpServer({ name: `wording-${NAMING}`, version: "0.1.0" });
const readOnly = new Set(["read", "search", "browse", "backlinks"]);
for (const verb of Object.keys(schemas)) {
  const t = cond.tools[verb];
  server.registerTool(
    t.name,
    { title: t.name, description: TERSE ? TERSE_DESC[verb] : t.description,
      annotations: verb === "delete" ? { destructiveHint: true } : { readOnlyHint: readOnly.has(verb) },
      inputSchema: schemas[verb] },
    async (args) => handlers[verb](args),
  );
}

await server.connect(new StdioServerTransport());
