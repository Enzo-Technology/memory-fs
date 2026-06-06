import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import type { Database } from "better-sqlite3";
import { oauthProvider } from "@better-auth/oauth-provider";


// BASE_URL must be the PUBLIC url Claude reaches (the ngrok https url) so that the
// discovery metadata advertises absolute, reachable endpoints. Defaults to localhost
// for an initial local smoke.

// The single source of truth for the AS<->RS trust contract. The Authorization
// Server (below) stamps these into the tokens it issues; the Resource Server
// (resource-server.ts) requires the same strings when it verifies a bearer.
// Defined here, with the AS, because the AS is the authority that mints them; the
// RS imports it (relying party depends on authority, not the reverse).
export const authContract = (baseUrl: string) => ({
  issuer: `${baseUrl}/api/auth`,
  audience: `${baseUrl}/mcp`,
  jwksUri: `${baseUrl}/api/auth/jwks`,
});

export const makeAuth = (db: Database, baseUrl: string) => {
  // Boundary check: a missing secret makes Better Auth fall back to a default
  // signing key, which silently mints forgeable tokens. Crash instead.
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required (32+ random chars)");

  return betterAuth({
    database: db,
    secret,
    baseURL: baseUrl,
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    // CORS/CSRF origin trust (NOT redirect-uri allowlisting — DCR clients self-declare those).
    trustedOrigins: ["https://claude.ai", "https://claude.com", baseUrl, "http://localhost:3000"],
    // Google-only: the AS issues no password credentials. Sign-up/sign-in
    // happens through the social provider above, nothing else.
    emailAndPassword: { enabled: false },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        validAudiences: [baseUrl, authContract(baseUrl).audience],
      })
    ] // required by oauth-provider (issues the JWT access tokens)
  })
};
