// The MCP Resource Server: the skeptic half of the auth layer. It guards /mcp by
// verifying bearer JWTs *locally* against the Authorization Server's JWKS (no
// introspection), and advertises which AS it trusts via the
// Protected Resource Metadata doc. Both halves are bound to the one authContract,
// so the audience it advertises and the audience it enforces are the same string.
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { IncomingMessage, ServerResponse } from "node:http";
import { authContract } from "./auth.js";

// The verified identity a request acts as — just the token subject. The RS says
// *who*; it does not decide what they may do (authorization is descoped).
export interface Principal {
  sub: string;
}

// Build the request authenticator. The JWKS set is created once and caches the
// AS's public keys, so verification is offline and the AS is off the hot path.
export function makeAuthenticate(
  baseUrl: string,
): (req: IncomingMessage) => Promise<Principal | null> {
  const { issuer, audience, jwksUri } = authContract(baseUrl);
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  return async (req) => {
    const authz = req.headers["authorization"];
    if (typeof authz !== "string" || !authz.startsWith("Bearer ")) return null;
    const bearer = authz.slice("Bearer ".length);
    try {
      const { payload } = await jwtVerify(bearer, jwks, { issuer, audience });
      return { sub: String(payload.sub) };
    } catch {
      return null;
    }
  };
}

// Protected Resource Metadata (RFC 9728): the RS naming the AS it trusts. This is
// RS metadata, not routing — it belongs here, next to the verifier that enforces
// the same contract, not smeared into the entry point.
export function serveProtectedResourceMetadata(
  baseUrl: string,
  res: ServerResponse,
): void {
  const { issuer, audience } = authContract(baseUrl);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      resource: audience,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
    }),
  );
}
