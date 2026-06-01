# Resource Server verifies bearers locally; no introspection

The MCP `/mcp` Resource Server verifies bearer JWTs **locally** against the
Authorization Server's published JWKS, bound to a shared `{issuer, audience}`
contract — it does **not** call the AS to introspect or look up a session per
request. We accept that a leaked token stays valid until it expires and rely on
**short access-token TTLs** for revocation rather than a per-request check.

## Considered options

- **Local JWKS verification (chosen)** — offline, keeps the RS interface
  IdP-agnostic (swap Better Auth → only the JWKS URL and issuer move), and keeps
  the AS off the critical path of every protected request.
- **Token introspection / `getSession` per request** — gives instant revocation,
  but makes the AS a synchronous dependency and per-request SPOF, and welds the RS
  to Better Auth's internals, defeating the point of using a self-contained JWT.
  Note: Better Auth's `mcp` plugin implements exactly this (a DB lookup of an
  opaque token in `getMcpSession`) — and is being deprecated in favor of the
  oauth-provider plugin we already use, which issues JWKS-verifiable JWTs. So the
  framework-native introspection path is also a dead end; do not re-adopt it.

## Consequences

- Revocation is not immediate. If immediate revocation ever becomes a requirement
  (e.g. high-value actions), revisit with introspection or a denylist — do not
  reach for it by default.
- The **session/cookie** path (browser UI) is the deliberate exception: it *does*
  defer to the AS's `getSession`, because a session is opaque and stateful. This
  ADR governs the **bearer** path only.
- When the descoped authorization/permissions service lands, the same trade-off
  recurs one layer up (permissions baked into the token vs looked up live). The
  RS returning only `sub` keeps both doors open.
