import { createAuthClient } from "better-auth/react";

// No baseURL → same-origin: the client talks to /api/auth on whatever host served
// the page. That one-origin assumption is the whole point (see ui/vite.config.ts and
// src/lib/auth-ui.ts) — it's what keeps the session cookie and OAuth redirects on a
// single host instead of drifting between localhost and 127.0.0.1.
export const authClient = createAuthClient();

// Better Auth bounces an OAuth client through these pages with the signed authorization
// request as the query string. Its presence is what distinguishes the two flows fronting
// the one AS: a bearer/OAuth flow (resume the authorize request) vs a plain session visit
// (go to the app). Returns the URL to resume the authorize request, or null for a visit.
export function authorizeResume(): string | null {
  return new URLSearchParams(location.search).has("client_id")
    ? "/api/auth/oauth2/authorize" + location.search
    : null;
}
