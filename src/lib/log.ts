import pino from "pino";

// stdio MCP servers reserve stdout (fd 1) for the JSON-RPC stream; anything written there
// that isn't a protocol message corrupts the session. So every log line MUST go to stderr
// (fd 2). pino defaults to fd 1, so the destination is pinned explicitly — do not remove it.
export const log = pino(
  { level: process.env.MEMORY_FS_LOG_LEVEL ?? "info" },
  pino.destination(2),
);

// Tool/HTTP args can carry record bodies (content, metadata, source) that may hold PII —
// which we promise never to store in logs. Pick only the structural fields worth logging.
const SAFE_FIELDS = [
  "namespace",
  "key",
  "type",
  "kind",
  "query",
  "prefix",
  "tags",
  "limit",
  "since",
  "force",
  "relation",
  "on_conflict",
] as const;

export function safeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const a = args as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of SAFE_FIELDS) if (a[f] !== undefined) out[f] = a[f];
  return out;
}
