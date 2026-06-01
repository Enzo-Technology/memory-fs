#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { getMigrations } from "better-auth/db/migration";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { makeAuth } from "./lib/auth.js";
import { z } from "zod";
import { openDb } from "./core/db.js";
import { MemoryStore } from "./core/store.js";
import { buildMcpServer } from "./lib/mcp-server.js";
import { serveUiAsset } from "./lib/ui/pages.js";

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

const BASE_URL =
  process.env.MEMORY_FS_BASE_URL ??
  (process.env.MEMORY_FS_DOMAIN ?
    `https://${process.env.MEMORY_FS_DOMAIN}` : undefined)
  ??
  `http://127.0.0.1:${process.env.MEMORY_FS_HTTP_PORT ??
  3000}`;

const auth = makeAuth(db, BASE_URL);

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
if (toBeCreated.length || toBeAdded.length) await runMigrations();

const httpPort = process.env.MEMORY_FS_HTTP_PORT

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

  const authHandler = toNodeHandler(auth);

  // Resource Server: verify the bearer on /mcp. Static token = legacy shared identity;
  // otherwise a Better-Auth-issued JWT, verified locally against the JWKS (audience-bound).
  const jwks = createRemoteJWKSet(new URL(`${BASE_URL}/api/auth/jwks`));
  const authenticate = async (
    req: import("node:http").IncomingMessage,
  ): Promise<{ id: string; source: "static" | "oauth" } | null> => {
    const authz = req.headers["authorization"];
    if (typeof authz !== "string" || !authz.startsWith("Bearer ")) return null;
    const bearer = authz.slice("Bearer ".length);
    if (bearer === token) return { id: "shared", source: "static" };
    try {
      const { payload } = await jwtVerify(bearer, jwks, {
        issuer: `${BASE_URL}/api/auth`,
        // The MCP client requests a token for the /mcp resource (confirmed in the
        // Inspector's authorize request: resource=<BASE_URL>/mcp), so the token's aud is
        // <BASE_URL>/mcp. Must match what auth.ts validAudiences accepts.
        audience: `${BASE_URL}/mcp`,
      });
      return { id: String(payload.sub), source: "oauth" };
    } catch {
      return null;
    }
  };

  const httpServer = createHttpServer(async (req, res) => {
    const url = req.url ?? "/";


    // Forward to Better Auth: its /api/auth/* routes, plus the RFC-8414 suffixed root alias
    // for AS metadata (/.well-known/oauth-authorization-server/api/auth) that MCP clients use.
    if (url.startsWith("/api/auth") || url.startsWith("/.well-known/oauth-authorization-server")) {
      return authHandler(req, res);
    }

    // PRM is the one discovery doc Better Auth doesn't serve — hand-build it.
    if (url.startsWith("/.well-known/oauth-protected-resource")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        resource: `${BASE_URL}/mcp`,
        authorization_servers: [`${BASE_URL}/api/auth`],
        bearer_methods_supported: ["header"],
        scopes_supported: ["openid", "profile", "email", "offline_access"],
      }));
      return;
    }

    // Static OAuth UI assets (sign-in / consent pages + their scripts). Public, so this
    // must come before the /mcp auth gate below.
    if (serveUiAsset(url, res)) return;

    // Everything else is the MCP Resource Server — require a valid bearer.
    const actor = await authenticate(req);
    if (!actor) {
      res.writeHead(401, {
        "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
      });
      res.end();
      return;
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = buildMcpServer(store);
    res.on("close", () => { transport.close().catch(() => { }); });
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
  const server = buildMcpServer(store);
  await server.connect(transport);
  console.error(`[memory-fs] connected over stdio`);
}
