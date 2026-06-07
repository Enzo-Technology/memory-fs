# Target MCP spec 2025-11-25; conform to the Resource-Server MUSTs

memory-fs builds to the **stable** MCP specification `2025-11-25`. We conform to
the OAuth 2.1 Resource Server obligations that apply to a protected HTTP transport,
accept one known low-risk gap (Origin validation) with a tracked fix, and do **not**
adopt the `2026-07-28` release candidate until it is final.

Authorization is OPTIONAL in MCP overall: these MUSTs bind the **HTTP** transport
(`/mcp`). The **stdio** transport is a local single-user path with no bearer and is
explicitly exempt from the HTTP authorization-discovery flow — do not add auth there.

## What we conform to (verified against the code)

- **Two standard transports** — stdio + Streamable HTTP. HTTP+SSE is deprecated; we
  never shipped it. `src/index.ts`.
- **Audience validation (RFC 8707 §2)** — `jwtVerify(bearer, jwks, { issuer, audience })`
  rejects tokens not minted for us. `src/lib/resource-server.ts:28`.
- **Protected Resource Metadata (RFC 9728)** — served at
  `/.well-known/oauth-protected-resource` with `authorization_servers`.
  `serveProtectedResourceMetadata`.
- **`WWW-Authenticate` on 401** pointing at the PRM URL. `src/index.ts:86`.
- **No token passthrough** — we verify locally against the AS's JWKS and call no
  upstream API, so we structurally cannot forward a client token (the confused-deputy
  defense). See [[0001-rs-verifies-bearers-locally]].

## Origin validation (closed)

Spec 2025-11-25 says a Streamable HTTP server MUST validate the `Origin` header and
return 403 when it is present-but-invalid (DNS-rebinding defense). `/mcp` now does
this: a present, untrusted `Origin` is rejected with 403 before any auth work; a
missing `Origin` (server-to-server MCP clients) passes through. `src/index.ts`,
enforced against the shared `trustedOrigins` list (`src/lib/auth.ts`) so the origins we
trust for CORS/CSRF and the ones we enforce on `/mcp` are one source of truth.
Covered by `tests/server.http.test.ts`.

The live risk was low regardless — DNS rebinding chiefly threatens localhost-bound
servers, and memory-fs is remote behind a bearer — but it was a spec MUST, so it's
implemented rather than waived. This closes the last open item against 2025-11-25 on
the HTTP transport.

## The 2026-07-28 release candidate: not yet

The RC reshapes the protocol — stateless at the protocol layer (removes the
`initialize` handshake and `Mcp-Session-Id`), `Mcp-Method`/`Mcp-Name` routing headers,
SSE server→client streaming replaced by `InputRequiredResult`, tool schemas lifted to
full JSON Schema 2020-12 (`structuredContent` any JSON value), and auth hardening
(RFC 9207 `iss` validation, OIDC `application_type`).

**Decision: build to 2025-11-25 today; do not migrate off sessions or onto RC features
until the RC is final** (slated 2026-07-28). We are already sessionless on the wire
(`StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`), so the
stateless-protocol shift is mostly a no-op for us when it lands — a point in favor of
not pre-emptively chasing the draft.

## Consequences

- Conformance is **transport-scoped**: changes to the bearer/PRM/audience contract live
  behind the one `authContract` ([[0001-rs-verifies-bearers-locally]]); stdio stays
  auth-free.
- With Origin validation closed, memory-fs is fully 2025-11-25-conformant on the HTTP
  transport. No open items remain against the stable spec.
- Revisit this ADR when the RC is final. The likely-cheap migrations (JSON Schema
  2020-12 on tool schemas; dropping any remaining session assumptions) should be costed
  then, not now.

## Source

Posture derived from a fact-checked research pass over the primary spec
(`modelcontextprotocol.io/specification/2025-11-25`), the 2025-06-18 authorization
spec, the 2026-07-28 RC blog, and Anthropic's tool-authoring guidance. Findings rest on
primary sources; only the Origin requirement and audience/PRM MUSTs are load-bearing here.
