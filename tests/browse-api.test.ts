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

function call(store: MemoryStore, guard: () => Promise<never>, url: string) {
  const api = makeBrowseApi(store, guard);
  const res = fakeRes();
  return api({ url } as never, res as never).then(() => res.out);
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
