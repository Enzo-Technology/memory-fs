// The read-only, session-authenticated JSON API: the cookie-path sibling to the bearer
// Resource Server. Applies the session guard, then passes through to the MemoryStore's read
// methods. Knows nothing about HOW a session is verified (that's session.ts) — it depends on
// a guard function. Read-only by intent: writes stay on the MCP/agent path.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowseKind, MemoryStore } from "../core/store.js";
import type { Session } from "./session.js";

const BROWSE_KINDS = new Set<BrowseKind>([
  "index",
  "recent",
  "hubs",
  "orphans",
  "tags",
  "namespaces",
]);

type RequireSession = (req: IncomingMessage) => Promise<Session>;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function num(v: string | null): number | undefined {
  return v === null ? undefined : Number(v);
}

export function makeBrowseApi(store: MemoryStore, requireSession: RequireSession) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Boundary: no valid session → 401. The org perimeter is upstream (Google Internal
    // consent); here we only require *a* signed-in principal, not a specific one — reads are
    // global, matching the shared-store model and the /mcp read tools.
    const session = await requireSession(req);
    if (!session) return json(res, 401, { error: "unauthenticated" });

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const q = url.searchParams;

    // GET /api/memories/recall — full-text search. Checked before the detail pattern below;
    // they cannot collide (recall has one path segment, detail requires two).
    if (path === "/api/memories/recall") {
      const query = q.get("q");
      if (!query) return json(res, 400, { error: "q is required" });
      return json(
        res,
        200,
        store.recall({
          query,
          namespace: q.get("namespace") ?? undefined,
          limit: num(q.get("limit")),
        }),
      );
    }

    // GET /api/memories/:namespace/:key — one record + its depth-1 neighbourhood.
    const detail = path.match(/^\/api\/memories\/([^/]+)\/([^/]+)$/);
    if (detail) {
      const result = store.read(
        decodeURIComponent(detail[1]!),
        decodeURIComponent(detail[2]!),
      );
      if (!result) return json(res, 404, { error: "not found" });
      return json(res, 200, result);
    }

    // GET /api/memories — a browse lens (default: recent).
    if (path === "/api/memories") {
      const kind = (q.get("kind") ?? "recent") as BrowseKind;
      if (!BROWSE_KINDS.has(kind)) return json(res, 400, { error: "unknown kind" });
      return json(
        res,
        200,
        store.browse({
          kind,
          namespace: q.get("namespace") ?? undefined,
          prefix: q.get("prefix") ?? undefined,
          limit: num(q.get("limit")),
        }),
      );
    }

    return json(res, 404, { error: "not found" });
  };
}
