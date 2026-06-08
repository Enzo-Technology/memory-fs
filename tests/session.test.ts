import { describe, expect, it } from "vitest";
import { makeRequireSession } from "../src/lib/session.js";

// A fake AS: getSession honours only the cookie header (via the translated Headers),
// so this also proves fromNodeHeaders maps req.headers.cookie → Headers.get("cookie").
function fakeAuth(validCookie: string) {
  return {
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("cookie") === validCookie
          ? { session: { id: "s1" }, user: { id: "u1", email: "a@b.co" } }
          : null,
    },
  } as unknown as Parameters<typeof makeRequireSession>[0];
}

describe("makeRequireSession", () => {
  it("returns the session when the cookie is valid", async () => {
    const requireSession = makeRequireSession(fakeAuth("token=good"));
    const session = await requireSession({ headers: { cookie: "token=good" } } as never);
    expect(session).not.toBeNull();
    expect(session!.user.id).toBe("u1");
  });

  it("returns null when the cookie is missing", async () => {
    const requireSession = makeRequireSession(fakeAuth("token=good"));
    const session = await requireSession({ headers: {} } as never);
    expect(session).toBeNull();
  });
});
