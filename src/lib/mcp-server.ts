import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "../core/store";
import { log, safeArgs } from "./log.js";

const recordType = z.enum(["user", "feedback", "project", "reference", "note"]);
const onConflict = z.enum(["overwrite", "append", "error"]);
const browseKind = z.enum(["index", "recent", "tags", "namespaces"]);

// Shared field hints so the same concept reads identically across all tools.
const NS_DESC =
    "logical scope, e.g. 'user', 'project:web', 'agent:reviewer' " +
    "(lowercased; ':' separates scope levels)";
const NS_FILTER_DESC = "restrict results to this namespace";
const KEY_DESC = "stable slug identifying the record within its namespace (normalized to a slug)";
const TYPE_DESC =
    "kind of record: 'user' (who the user is), 'feedback' (how to work), " +
    "'project' (ongoing work/goals), 'reference' (durable reference docs — use " +
    "for longer material), 'note' (default; a single atomic fact)";

const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (message: string) => ({
    content: [{ type: "text" as const, text: message }],
    isError: true,
});

// Single error boundary for every tool: an uncaught throw from the store would otherwise
// reach the client as an opaque protocol error with nothing recorded server-side. Wrap each
// handler so all errors are logged with their tool + structural args (never record bodies —
// see safeArgs) and returned as a clean isError result.
type Handler<A> = (args: A) => Promise<ReturnType<typeof ok>>;
const guard = <A>(tool: string, fn: Handler<A>): Handler<A> =>
    async (args: A) => {
        try {
            return await fn(args);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error({ tool, args: safeArgs(args), err: message }, "tool error");
            return err(message);
        }
    };

// `author` is the verified principal's id (token sub) for this request, or null
// over stdio. It is bound here, not taken from tool args, so writes are attributed
// to whoever the Resource Server authenticated.
export function buildMcpServer(store: MemoryStore, author: string | null = null): McpServer {
    const server = new McpServer({ name: "memory-fs", version: "0.1.0" });

    server.registerTool(
        "context_write",
        {
            title: "Write to the shared context",
            annotations: { readOnlyHint: false },
            description:
                "Write a record to the SHARED team context: a key decision, convention, or piece of " +
                "direction the team relies on — visible to all agents, machines, and teammates, unlike " +
                "your local session memory. When direction changes, update the existing record rather " +
                "than appending a near-duplicate. Auto-extracts [[wikilinks]] and warns on near-duplicates; " +
                "key auto-derives from content if omitted. Namespace is a logical scope like 'user', " +
                "'project:web', or 'agent:reviewer'. Use when the team makes a decision, sets a convention, " +
                "or establishes direction; not for transient task state. Keep each record atomic; for a " +
                "topic with several facts, write a short hub note that links [[the atoms]] so they're " +
                "discoverable together. Never store secrets or PII.",
            inputSchema: {
                content: z.string().min(1).describe("markdown body of the record; can include [[wikilinks]]"),
                namespace: z.string().min(1).describe(NS_DESC),
                key: z.string().optional().describe("stable slug; normalized to a slug, or auto-derived from content if omitted"),
                type: recordType.optional().describe(TYPE_DESC),
                tags: z.array(z.string()).optional().describe("freeform labels for filtering"),
                metadata: z.record(z.string(), z.unknown()).optional().describe("arbitrary structured data attached to the record"),
                source: z.string().optional().describe("where this record came from, e.g. a URL or document reference"),
                on_conflict: onConflict.optional().describe("behavior if (namespace, key) already exists; default 'overwrite'"),
            },
        },
        guard("context_write", async (args) => ok(store.note(args, author))),
    );

    server.registerTool(
        "context_search",
        {
            title: "Search the shared context",
            annotations: { readOnlyHint: true },
            description:
                "Search the SHARED team context by full-text query; returns full ranked records " +
                "(records with inbound links rank first), not just snippets. Read it before acting when " +
                "the user references prior context, decisions, conventions, or direction you weren't told " +
                "this session. Just type the words you're looking for — multiple words are matched together " +
                "and ordinary terms (including hyphenated ones like 'one-pager') are handled safely, no " +
                "escaping needed. Optional operators to refine: OR to broaden across synonyms " +
                "(a OR b OR c), \"quoted phrases\" for an exact sequence, and term* for a prefix.",
            inputSchema: {
                query: z.string().min(1).describe("search words, or an expression using OR / \"phrases\" / term*"),
                namespace: z.string().optional().describe(NS_FILTER_DESC),
                type: recordType.optional().describe("restrict results to this type"),
                tags: z.array(z.string()).optional().describe("restrict results to records with all these tags"),
                since: z.string().optional().describe("ISO date; only records updated since"),
                limit: z.number().int().positive().max(20).optional().describe("default 5"),
            },
        },
        guard("context_search", async (args) => ok(store.recall(args))),
    );

    server.registerTool(
        "context_browse",
        {
            title: "Browse the shared context",
            annotations: { readOnlyHint: true },
            description:
                "Survey the SHARED team context without a query, so you know what the team already relies " +
                "on. kind='index' for an overview; 'recent' for last-updated records (each with a snippet); " +
                "'tags' for the tag vocabulary with counts; 'namespaces' for the namespace vocabulary with " +
                "counts (prefix 'voice:' lists every voice:* scope). Use to orient before acting, then " +
                "context_read a specific record or context_search to search.",
            inputSchema: {
                kind: browseKind.describe("what view to return"),
                namespace: z.string().optional().describe(NS_FILTER_DESC),
                prefix: z.string().optional().describe("for 'recent' filters keys; for 'tags'/'namespaces' filters the vocabulary"),
                limit: z.number().int().positive().max(100).optional().describe("default 20"),
            },
        },
        guard("context_browse", async (args) => ok(store.browse(args))),
    );

    server.registerTool(
        "context_read",
        {
            title: "Read a context record by exact key",
            annotations: { readOnlyHint: true },
            description:
                "Fetch one record by exact (namespace, key) from the SHARED context — read it before you " +
                "act on it — plus its immediate neighbourhood: outbound links ('children') and inbound " +
                "links ('backlinks'), each with a snippet. Reading a hub-note surfaces everything it links " +
                "in one call. Returns a hint if no record exists at that location.",
            inputSchema: {
                namespace: z.string().min(1).describe(NS_DESC),
                key: z.string().min(1).describe(KEY_DESC),
            },
        },
        guard("context_read", async ({ namespace, key }) => {
            const m = store.read(namespace, key);
            if (!m) {
                return ok({
                    found: false,
                    hint: `No record at namespace='${namespace}' key='${key}'. Try context_search or context_browse.`,
                });
            }
            return ok(m);
        }),
    );

    server.registerTool(
        "context_delete",
        {
            title: "Delete a context record",
            annotations: { destructiveHint: true },
            description:
                "Permanently delete a record from the SHARED context. Refuses if any other record links " +
                "to it (force=true overrides, but consider updating the target instead). Use when a record " +
                "no longer reflects the team's direction or is clearly wrong.",
            inputSchema: {
                namespace: z.string().min(1).describe(NS_DESC),
                key: z.string().min(1).describe(KEY_DESC),
                force: z.boolean().optional().describe("override the backlink-protection check"),
            },
        },
        guard("context_delete", async ({ namespace, key, force }) => {
            const deleted = store.del(namespace, key, force ?? false);
            return ok({ deleted, namespace, key });
        }),
    );

    server.registerTool(
        "context_link",
        {
            title: "Link two context records manually",
            annotations: { idempotentHint: true },
            description:
                "Assert a directional relationship between two records that you can't express as a " +
                "[[wikilink]] in content, e.g. 'supersedes' or 'caused-by'. Most links auto-extract " +
                "from wikilinks; use this only for the rest. Idempotent.",
            inputSchema: {
                from_namespace: z.string().min(1).describe(NS_DESC),
                from_key: z.string().min(1).describe(KEY_DESC),
                to_namespace: z.string().min(1).describe(NS_DESC),
                to_key: z.string().min(1).describe(KEY_DESC),
                relation: z.string().optional().describe("defaults to 'related'"),
            },
        },
        guard("context_link", async ({ from_namespace, from_key, to_namespace, to_key, relation }) => {
            const linked = store.link(from_namespace, from_key, to_namespace, to_key, relation);
            return ok({ linked, relation: relation ?? "related" });
        }),
    );

    server.registerTool(
        "context_backlinks",
        {
            title: "List records that link to a context record",
            annotations: { readOnlyHint: true },
            description:
                "List records in the SHARED context that reference the given (namespace, key) via a link " +
                "or [[wikilink]] — what discussed it, depends on it, or supersedes it. Often more " +
                "useful than context_search for understanding a topic.",
            inputSchema: {
                namespace: z.string().min(1).describe(NS_DESC),
                key: z.string().min(1).describe(KEY_DESC),
            },
        },
        guard("context_backlinks", async ({ namespace, key }) => ok(store.backlinks(namespace, key))),
    );

    return server;
}
