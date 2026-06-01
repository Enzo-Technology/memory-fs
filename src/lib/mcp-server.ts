import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "../core/store";

const memoryType = z.enum(["user", "feedback", "project", "reference", "note"]);
const onConflict = z.enum(["overwrite", "append", "error"]);
const browseKind = z.enum(["index", "recent", "hubs", "orphans", "tags"]);

const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (message: string) => ({
    content: [{ type: "text" as const, text: message }],
    isError: true,
});

// `author` is the verified principal's id (token sub) for this request, or null
// over stdio. It is bound here, not taken from tool args, so writes are attributed
// to whoever the Resource Server authenticated.
export function buildMcpServer(store: MemoryStore, author: string | null = null): McpServer {
    const server = new McpServer({ name: "memory-fs", version: "0.1.0" });

    server.registerTool(
        "memory_note",
        {
            title: "Write a memory",
            description:
                "Write a durable fact, decision, or preference to the SHARED memory store — visible " +
                "to all agents, machines, and teammates, unlike your local session memory. " +
                "Auto-extracts [[wikilinks]] and warns on near-duplicates; key auto-derives from " +
                "content if omitted. Namespace is a logical scope like 'user', 'project:enzo', or " +
                "'agent:reviewer'. Use when the user states something lasting, makes a decision, or " +
                "asks to remember; not for transient task state. Never store secrets or PII.",
            inputSchema: {
                content: z.string().min(1).describe("markdown body of the memory; can include [[wikilinks]]"),
                namespace: z.string().min(1).describe("logical scope, e.g. 'user', 'project:enzo'"),
                key: z.string().optional().describe("stable slug; auto-derived from content if omitted"),
                type: memoryType.optional(),
                tags: z.array(z.string()).optional().describe("freeform labels for filtering"),
                on_conflict: onConflict.optional().describe("behavior if (namespace, key) already exists; default 'overwrite'"),
            },
        },
        async (args) => ok(store.note(args, author)),
    );

    server.registerTool(
        "memory_recall",
        {
            title: "Search memories",
            annotations: { readOnlyHint: true },
            description:
                "Search the SHARED memory store; returns full ranked records (hubs promoted), not " +
                "snippets. Use when the user references prior context, decisions, or deadlines you " +
                "weren't told this session ('did we already decide on auth?', 'what's the merge " +
                "freeze date?'). FTS5 syntax: phrases (\"merge freeze\"), boolean (auth AND legal), " +
                "prefix (auth*).",
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
            annotations: { readOnlyHint: true },
            description:
                "Orient in the SHARED store without a query. kind='index' for an overview; 'recent' " +
                "for last-updated; 'hubs' for highly-linked records (usually the most important); " +
                "'orphans' for unlinked records (often stale); 'tags' for the tag vocabulary with " +
                "counts. Use to summarize what exists, find structural records, or filter by " +
                "tag/namespace.",
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
            annotations: { readOnlyHint: true },
            description:
                "Fetch one record by exact (namespace, key) from the SHARED store — typically a key " +
                "you got from memory_recall, memory_browse, or memory_backlinks. Returns a hint if " +
                "no record exists at that location.",
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
            annotations: { destructiveHint: true },
            description:
                "Permanently delete a record from the SHARED store. Refuses if any other record links " +
                "to it (force=true overrides, but consider updating the target instead). Use when the " +
                "user asks to forget something or a record is clearly wrong.",
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
            annotations: { idempotentHint: true },
            description:
                "Assert a directional relationship between two records that you can't express as a " +
                "[[wikilink]] in content, e.g. 'supersedes' or 'caused-by'. Most links auto-extract " +
                "from wikilinks; use this only for the rest. Idempotent.",
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
            annotations: { readOnlyHint: true },
            description:
                "List records in the SHARED store that reference the given (namespace, key) via a link " +
                "or [[wikilink]] — what discussed it, depends on it, or supersedes it. Often more " +
                "useful than memory_recall for understanding a topic.",
            inputSchema: {
                namespace: z.string().min(1),
                key: z.string().min(1),
            },
        },
        async ({ namespace, key }) => ok(store.backlinks(namespace, key)),
    );

    return server;
}
