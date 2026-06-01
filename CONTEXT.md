# memory-fs

A shared memory store exposed over MCP, fronted by an OAuth 2.1 auth layer. This
file pins the auth vocabulary so reviews and refactors speak one language; the
core memory model (memories, links, wikilinks, namespaces) is documented in code.

## Language

**Authorization Server** (AS):
The party that mints credentials — runs login/consent, issues JWT access tokens,
serves AS discovery metadata. This is Better Auth (`src/lib/auth.ts`).
_Avoid_: "the auth server" (ambiguous with the Resource Server), "Better Auth" as
a synonym for the whole auth layer.

**Resource Server** (RS):
The party that *guards a protected resource* — receives a token from an untrusted
client, verifies it, and yields a principal. Owns `/mcp` and the PRM discovery doc.
A skeptic, not an authority: it trusts the AS's published keys, nothing more.
_Avoid_: "the API guard", "middleware".

**Principal**:
The verified identity a request acts as — just the token's `sub`. The RS produces
a principal or `null`; it does not decide what the principal may *do* (that is
authorization, descoped).
_Avoid_: "actor", "user" (until there is a user record behind it), "session" (that
is the cookie path, not the bearer path).

**Contract** (`{issuer, audience}`):
The two strings the AS and RS must agree on: the AS stamps them into every token,
the RS requires them when verifying. One exported constant, consumed by both sides
— not a code comment.
_Avoid_: restating either string as a literal anywhere but the constant.

## Relationships

- The **Authorization Server** issues tokens stamped with the **Contract**.
- The **Resource Server** verifies those tokens against the **Contract** and the
  AS's JWKS, yielding a **Principal**.
- There are **two authentication paths**, both fronting the one AS:
  - **bearer / JWT** (MCP, future API) — verified *locally* by the RS via JWKS.
  - **session / cookie** (browser UI) — verified by *deferring* to the AS's
    `getSession`, because sessions are stateful and same-origin.

## Example dialogue

> **Dev:** "If it's all one process, why does the RS verify the token instead of
> just asking Better Auth?"
> **Architect:** "Because the token came back from an untrusted browser. The RS is
> the skeptic. For a *bearer* it verifies locally against JWKS — that keeps the RS
> IdP-agnostic and off the AS's critical path. Only the *session* path defers to
> the AS, because a cookie is opaque and stateful."

## Flagged ambiguities

- "auth" was used for both issuing and verifying — resolved: **Authorization
  Server** issues, **Resource Server** verifies. They share a process, not a module.
- "token" and "session" were used interchangeably — resolved: distinct paths with
  distinct verification (local JWKS vs deferral). See Relationships.
