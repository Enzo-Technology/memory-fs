import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db.js";
import { MemoryStore } from "../src/core/store.js";
import { makeBrowseApi } from "../src/lib/browse-api.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "memfs-api-"));
  return new MemoryStore(openDb(join(dir, "test.db")));
}

// Minimal ServerResponse double: capture status + body.
function fakeRes() {
  const out: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(body?: string) {
      out.body = body;
    },
    out,
  };
  return res;
}

// Guard doubles: a present session vs none. Lets us test routing/validation without auth.
const withSession = () =>
  Promise.resolve({ session: { id: "s" }, user: { id: "u" } } as never);
const noSession = () => Promise.resolve(null as never);

function call(
  store: MemoryStore,
  guard: () => Promise<never>,
  url: string,
  method = "GET",
) {
  const api = makeBrowseApi(store, guard);
  const res = fakeRes();
  return api({ url, method } as never, res as never).then(() => res.out);
}

describe("browse-api", () => {
  it("401 when there is no session", async () => {
    const out = await call(freshStore(), noSession, "/api/memories");
    expect(out.status).toBe(401);
  });

  it("browse recent returns the store result shape", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "hello world" });
    const out = await call(store, withSession, "/api/memories?kind=recent");
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body!);
    expect(body.kind).toBe("recent");
    expect(body.items[0].key).toBe("a");
  });

  it("400 on unknown browse kind", async () => {
    const out = await call(freshStore(), withSession, "/api/memories?kind=bogus");
    expect(out.status).toBe(400);
  });

  it("kind=tagged returns the tagged shape filtered by tag", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "alpha", tags: ["decision"] });
    store.note({ namespace: "ns", key: "b", content: "beta", tags: ["auth"] });
    const out = await call(store, withSession, "/api/memories?kind=tagged&tag=decision");
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body!);
    expect(body.kind).toBe("tagged");
    expect(body.items.map((i: { key: string }) => i.key)).toEqual(["a"]);
  });

  it("kind=tags (vocabulary) still returns tag counts", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "x", tags: ["decision"] });
    const out = await call(store, withSession, "/api/memories?kind=tags");
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body!);
    expect(body.kind).toBe("tags");
    expect(body.items[0].tag).toBe("decision");
  });

  it("401 on kind=tagged with no session", async () => {
    const out = await call(freshStore(), noSession, "/api/memories?kind=tagged&tag=x");
    expect(out.status).toBe(401);
  });

  it("400 when recall q is missing", async () => {
    const out = await call(freshStore(), withSession, "/api/memories/recall");
    expect(out.status).toBe(400);
  });

  it("recall returns matching memories", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "the quick brown fox" });
    const out = await call(store, withSession, "/api/memories/recall?q=quick");
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body!)[0].key).toBe("a");
  });

  it("read returns the record with its neighbourhood", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "a", content: "body" });
    const out = await call(store, withSession, "/api/memories/ns/a");
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body!);
    expect(body.key).toBe("a");
    expect(Array.isArray(body.children)).toBe(true);
    expect(Array.isArray(body.backlinks)).toBe(true);
  });

  it("404 on unknown memory", async () => {
    const out = await call(freshStore(), withSession, "/api/memories/ns/missing");
    expect(out.status).toBe(404);
  });
});

describe("browse-api delete", () => {
  it("401 when there is no session", async () => {
    const out = await call(freshStore(), noSession, "/api/memories/ns/a", "DELETE");
    expect(out.status).toBe(401);
  });

  it("409 with a backlinks list when inbound links exist and not forced", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "target", content: "x" });
    store.note({ namespace: "ns", key: "src", content: "see [[target]]" });
    const out = await call(store, withSession, "/api/memories/ns/target", "DELETE");
    expect(out.status).toBe(409);
    const body = JSON.parse(out.body!);
    expect(body.error).toBe("has backlinks");
    expect(body.backlinks[0].from_key).toBe("src");
    // still present
    expect(store.read("ns", "target")).not.toBeNull();
  });

  it("force=true deletes despite backlinks and the memory is gone", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "target", content: "x" });
    store.note({ namespace: "ns", key: "src", content: "see [[target]]" });
    const out = await call(
      store,
      withSession,
      "/api/memories/ns/target?force=true",
      "DELETE",
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body!).ok).toBe(true);
    expect(store.read("ns", "target")).toBeNull();
  });

  it("deletes a memory with no backlinks and it is gone", async () => {
    const store = freshStore();
    store.note({ namespace: "ns", key: "lone", content: "x" });
    const out = await call(store, withSession, "/api/memories/ns/lone", "DELETE");
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body!).ok).toBe(true);
    expect(store.read("ns", "lone")).toBeNull();
  });

  it("404 deleting a memory that does not exist", async () => {
    const out = await call(
      freshStore(),
      withSession,
      "/api/memories/ns/missing",
      "DELETE",
    );
    expect(out.status).toBe(404);
  });
});
