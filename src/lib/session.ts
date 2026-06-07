// The cookie-path guard: turns an HTTP request's cookie into a verified session by
// deferring to the Authorization Server's getSession (sessions are stateful + same-origin,
// so we defer rather than verify locally — see CONTEXT.md). The session/cookie sibling of
// resource-server.ts's makeAuthenticate (the bearer/JWT guard). This file is the one place
// that knows the Better Auth getSession API and the Node-headers → Headers translation.
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingMessage } from "node:http";
import type { makeAuth } from "./auth.js";

type Auth = ReturnType<typeof makeAuth>;

// The verified session (or null). Shape owned by Better Auth; we re-export the awaited type
// so callers needn't reach into the AS.
export type Session = Awaited<ReturnType<Auth["api"]["getSession"]>>;

export function makeRequireSession(
  auth: Auth,
): (req: IncomingMessage) => Promise<Session> {
  return (req) => auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}
