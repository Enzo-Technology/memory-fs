#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { z } from "zod";
import { openDb } from "./db.js";
import { MemoryStore } from "./store.js";

const memoryType = z.enum(["user", "feedback", "project", "reference", "note"]);
const onConflict = z.enum(["overwrite", "append", "error"]);
const browseKind = z.enum(["index", "recent", "hubs", "orphans", "tags"]);

const dbPath = process.env.MEMORY_FS_DB ?? `${process.env.HOME}/.memory-fs/memory.db`;
console.error(`[memory-fs] starting pid=${process.pid} db=${dbPath} node=${process.version}`);

let db;
try {
  db = openDb();
} catch (e) {
  console.error(`[memory-fs] failed to open db at ${dbPath}: ${(e as Error).message}`);
  process.exit(1);
}
const store = new MemoryStore(db);

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

function buildServer(): McpServer {
  const server = new McpServer({ name: "memory-fs", version: "0.1.0" });

  server.registerTool(
    "memory_note",
    {
      title: "Write a memory",
      description:
        "Save a fact, decision, preference, or piece of context for future sessions. " +
        "Auto-extracts [[wikilinks]] from the content into a backlink graph, and warns " +
        "if a near-duplicate already exists. The key is auto-generated from the first " +
        "heading or first words of content unless you supply one. Namespace is a logical " +
        "scope like 'user', 'project:enzo', or 'agent:reviewer'. " +
        "Use this when the user states something durable ('we picked Clerk for auth'), " +
        "makes a decision, expresses a lasting preference, or explicitly asks to remember. " +
        "Do NOT use for transient task state. IMPORTANT: do not store secrets or PII.",
      inputSchema: {
        content: z.string().min(1).describe("markdown body of the memory; can include [[wikilinks]]"),
        namespace: z.string().min(1).describe("logical scope, e.g. 'user', 'project:enzo'"),
        key: z.string().optional().describe("stable slug; auto-derived from content if omitted"),
        type: memoryType.optional(),
        tags: z.array(z.string()).optional().describe("freeform labels for filtering"),
        on_conflict: onConflict.optional().describe("behavior if (namespace, key) already exists; default 'overwrite'"),
      },
    },
    async (args) => ok(store.note(args)),
  );

  server.registerTool(
    "memory_recall",
    {
      title: "Search memories",
      description:
        "Retrieve memories matching a query. Returns full records (not snippets), ranked " +
        "by relevance with hub records (frequently-linked memories) promoted. " +
        "Use this when the user asks about something they might have told you before " +
        "('did we already decide on auth?', 'what's the merge freeze date?'), references a " +
        "prior project, or expects you to know context you weren't explicitly told this session. " +
        "Supports FTS5 syntax: phrases (\"merge freeze\"), boolean (auth AND legal), prefix (auth*).",
      inputSchema: {
        query: z.string().min(1).describe("FTS5 search expression"),
        namespace: z.string().optional(),
        type: memoryType.optional(),
        tags: z.array(z.string()).optional(),
        since: z.string().optional().describe("ISO date; only records updated since"),
        limit: z.number().int().positive().max(20).optional().describe("default 5"),
      },
    },
    async (args) => ok(store.recall(args)),
  );

  server.registerTool(
    "memory_browse",
    {
      title: "Browse the memory store",
      description:
        "Discovery — orient yourself in the store without a specific query. " +
        "Use when you're not sure what's in here, want to summarize what exists, or need " +
        "to find structural records (hubs, orphans, tag vocabulary). " +
        "kind='index' for an overview; 'recent' for last-updated; 'hubs' for highly-linked " +
        "records (these are usually the most important); 'orphans' for unlinked records " +
        "(often stale or in need of integration); 'tags' for the tag vocabulary with counts.",
      inputSchema: {
        kind: browseKind.describe("what view to return"),
        namespace: z.string().optional().describe("filter to this namespace"),
        prefix: z.string().optional().describe("filter keys/tags starting with this prefix"),
        limit: z.number().int().positive().max(100).optional().describe("default 20"),
      },
    },
    async (args) => ok(store.browse(args)),
  );

  server.registerTool(
    "memory_read",
    {
      title: "Read a memory by exact key",
      description:
        "Fetch a single memory by (namespace, key). Use when you already know the exact " +
        "location — e.g. you got the key from memory_recall, memory_browse, or memory_backlinks. " +
        "Returns null with a hint if no record exists at that location.",
      inputSchema: {
        namespace: z.string().min(1),
        key: z.string().min(1),
      },
    },
    async ({ namespace, key }) => {
      const m = store.read(namespace, key);
      if (!m) {
        return ok({
          found: false,
          hint: `No record at namespace='${namespace}' key='${key}'. Try memory_recall or memory_browse.`,
        });
      }
      return ok(m);
    },
  );

  server.registerTool(
    "memory_delete",
    {
      title: "Delete a memory",
      description:
        "Permanently delete a memory. Refuses if any other memory links to it (use force=true " +
        "to override, but consider whether the target should just be updated instead). " +
        "Use when the user explicitly asks to forget something or when a memory is clearly wrong.",
      inputSchema: {
        namespace: z.string().min(1),
        key: z.string().min(1),
        force: z.boolean().optional().describe("override the backlink-protection check"),
      },
    },
    async ({ namespace, key, force }) => {
      try {
        const deleted = store.del(namespace, key, force ?? false);
        return ok({ deleted, namespace, key });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "memory_link",
    {
      title: "Link two memories manually",
      description:
        "Create a directional link between two memories with a relation label. " +
        "Most links are auto-extracted from [[wikilinks]] inside content — use this tool only " +
        "to assert a relationship you can't express in markdown, e.g. 'supersedes' or 'caused-by'. " +
        "Idempotent.",
      inputSchema: {
        from_namespace: z.string().min(1),
        from_key: z.string().min(1),
        to_namespace: z.string().min(1),
        to_key: z.string().min(1),
        relation: z.string().optional().describe("defaults to 'related'"),
      },
    },
    async ({ from_namespace, from_key, to_namespace, to_key, relation }) => {
      const linked = store.link(from_namespace, from_key, to_namespace, to_key, relation);
      return ok({ linked, relation: relation ?? "related" });
    },
  );

  server.registerTool(
    "memory_backlinks",
    {
      title: "List records that link to a memory",
      description:
        "Return all memories that reference the given (namespace, key) via a link or [[wikilink]]. " +
        "Use to find context around a record — what discussed it, what depends on it, " +
        "what supersedes it. Often more useful than memory_recall for understanding a topic.",
      inputSchema: {
        namespace: z.string().min(1),
        key: z.string().min(1),
      },
    },
    async ({ namespace, key }) => ok(store.backlinks(namespace, key)),
  );

  return server;
}

const httpPort = process.env.MEMORY_FS_HTTP_PORT;

if (httpPort) {
  const token = process.env.MEMORY_FS_TOKEN;
  if (!token) {
    console.error("[memory-fs] MEMORY_FS_TOKEN must be set when MEMORY_FS_HTTP_PORT is set");
    process.exit(1);
  }

  const parsedPort = parseInt(httpPort, 10);
  if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    console.error(`[memory-fs] MEMORY_FS_HTTP_PORT must be a number between 1 and 65535, got: ${httpPort}`);
    process.exit(1);
  }

  const httpServer = createHttpServer((req, res) => {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized");
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = buildServer();
    res.on("close", () => { transport.close().catch(() => {}); });
    mcpServer.connect(transport).then(() => {
      return transport.handleRequest(req, res);
    }).catch((e) => {
      console.error("[memory-fs] transport error:", (e as Error).message);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  httpServer.listen(parsedPort, "127.0.0.1", () => {
    console.error(`[memory-fs] listening on 127.0.0.1:${httpPort}`);
  });
} else {
  const transport = new StdioServerTransport();
  const server = buildServer();
  await server.connect(transport);
  console.error(`[memory-fs] connected over stdio`);
}
