// THROWAWAY spike. Better Auth as an in-process OAuth 2.1 authorization server.
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import type { Database } from "better-sqlite3";
import { oauthProvider } from "@better-auth/oauth-provider";


// BASE_URL must be the PUBLIC url Claude reaches (the ngrok https url) so that the
// discovery metadata advertises absolute, reachable endpoints. Defaults to localhost
// for an initial local smoke.

export const makeAuth = (db: Database, baseUrl: string) => {
  return betterAuth({
    database: db,
    // Throwaway secret — fine for a prototype, never reuse.
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: baseUrl,
    socialProviders: {
      google: { 
            clientId: process.env.GOOGLE_CLIENT_ID as string, 
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string, 
        }, 
    },
    // CORS/CSRF origin trust (NOT redirect-uri allowlisting — DCR clients self-declare those).
    trustedOrigins: ["https://claude.ai", "https://claude.com", baseUrl, "http://localhost:3000"],
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        validAudiences: [baseUrl, `${baseUrl}/mcp`],
      })
    ] // required by oauth-provider (issues the JWT access tokens)
  })
};
