#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { getMigrations } from "better-auth/db/migration";
import { makeAuth } from "./lib/auth.js";
import {
  makeAuthenticate,
  serveProtectedResourceMetadata,
} from "./lib/resource-server.js";
import { openDb } from "./core/db.js";
import { MemoryStore } from "./core/store.js";
import { buildMcpServer } from "./lib/mcp-server.js";
import { serveWebApp } from "./lib/auth-ui.js";


let db;
try {
  db = openDb();
} catch (e) {
  console.error(`[memory-fs] failed to open db`);
  process.exit(1);
}
const store = new MemoryStore(db);

const BASE_URL =
  process.env.MEMORY_FS_BASE_URL ??
  (process.env.MEMORY_FS_DOMAIN ?
    `https://${process.env.MEMORY_FS_DOMAIN}` : undefined)
  ??
  `http://127.0.0.1:${process.env.MEMORY_FS_HTTP_PORT ??
  3000}`;

const httpPort = process.env.MEMORY_FS_HTTP_PORT

if (httpPort) {
  const parsedPort = parseInt(httpPort, 10);
  if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    console.error(`[memory-fs] MEMORY_FS_HTTP_PORT must be a number between 1 and 65535, got: ${httpPort}`);
    process.exit(1);
  }

  // Auth setup is HTTP-only: stdio is a local single-user transport with no bearer
  // path, so it must boot without a BETTER_AUTH_SECRET or Better Auth's tables.
  const auth = makeAuth(db, BASE_URL);
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) await runMigrations();

  const authHandler = toNodeHandler(auth);
  const authenticate = makeAuthenticate(BASE_URL);

  const httpServer = createHttpServer(async (req, res) => {
    const url = req.url ?? "/";

    // Authorization Server (Better Auth): its /api/auth/* routes, plus the
    // RFC-8414 suffixed alias for AS metadata that MCP clients fetch.
    if (url.startsWith("/api/auth") || url.startsWith("/.well-known/oauth-authorization-server")) {
      // MCP clients differ on AS-metadata discovery: some fetch the RFC-8414
      // path-aware URL (/.well-known/oauth-authorization-server/api/auth), others
      // the bare /.well-known/oauth-authorization-server. Better Auth only serves
      // the former, so rewrite the bare path to its native metadata route — else
      // the client never finds registration_endpoint, skips DCR, and hits
      // /authorize with no client_id.
      if (url === "/.well-known/oauth-authorization-server") {
        req.url = "/api/auth/.well-known/oauth-authorization-server";
      }
      return authHandler(req, res);
    }

    // Resource Server: advertise the AS we trust (PRM).
    if (url.startsWith("/.well-known/oauth-protected-resource")) {
      return serveProtectedResourceMetadata(BASE_URL, res);
    }

    // Resource Server: the one protected resource. Routed explicitly (before the SPA
    // catch-all below) so the history fallback can never swallow it. Requires a bearer.
    if (url === "/mcp" || url.startsWith("/mcp")) {
      const principal = await authenticate(req);
      if (!principal) {
        res.writeHead(401, {
          "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
        });
        res.end();
        return;
      }

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const mcpServer = buildMcpServer(store, principal.sub);
      res.on("close", () => { transport.close().catch(() => { }); });
      mcpServer.connect(transport).then(() => {
        return transport.handleRequest(req, res);
      }).catch((e) => {
        console.error("[memory-fs] transport error:", (e as Error).message);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }

    // Everything else: the single-page web app (login, consent, memory browser).
    serveWebApp(url, res);
  });

  httpServer.listen(parsedPort, "127.0.0.1", () => {
    console.error(`[memory-fs] listening on 127.0.0.1:${httpPort}`);
  });
} else {
  const transport = new StdioServerTransport();
  const server = buildMcpServer(store);
  await server.connect(transport);
  console.error(`[memory-fs] connected over stdio`);
}
