# Deploy on GCP with a Google-Workspace Org Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the hosted memory-fs MCP server to one Google Workspace org and ship it on a single GCE VM, reusing the existing `deploy/` artifacts.

**Architecture:** The store is a single shared namespace; authorization is descoped (see `CONTEXT.md`), so the **only** perimeter is a Google-Workspace org gate. The gate is a pure function that verifies Google's server-side `hd` (hosted-domain) claim, wired into Better Auth's `mapProfileToUser` so it runs on every sign-in. The allowed domain is read from `MEMORY_FS_ALLOWED_HD` and the server **fails closed** (refuses to boot in HTTP mode) if it's unset. A second, free perimeter is Google's "Internal" OAuth consent screen, set in the Cloud console. Token TTLs keep Better Auth defaults (soft ~30-day revocation window, accepted). Deployment fixes the stale `deploy/` bits and follows the existing runbook.

**Tech Stack:** Node + TypeScript (ESM), Better Auth + `@better-auth/oauth-provider`, better-sqlite3, vitest, Debian GCE `e2-micro`, Caddy (auto-TLS), systemd.

---

## File Structure

- **Create** `src/lib/org-gate.ts` — the pure org-gate function (`assertOrgMember`). One responsibility: decide if a Google profile is an allowed org member. Testable with no OAuth/server.
- **Create** `tests/org-gate.test.ts` — unit tests for the gate.
- **Modify** `src/lib/auth.ts` — read + validate `MEMORY_FS_ALLOWED_HD` (fail closed), wire `mapProfileToUser` into the Google provider.
- **Modify** `tests/server.http.test.ts` — add `MEMORY_FS_ALLOWED_HD` to the spawn env (otherwise the new fail-closed boot check breaks existing HTTP tests); add a test that boot fails without it.
- **Modify** `deploy/memory-fs.service` — fix `ExecStart` entry point and the stale env-var comment.
- **Modify** `deploy/README.md` — replace the stale env-file template with the real OAuth vars.
- **Modify** `README.md`, `skills/using-memory-fs/SKILL.md`, `eval/README.md` — correct `dist/server.js` → `dist/index.js` in operative docs (historical `docs/plans/*` left as dated records).
- **Modify** `package.json` — add an `engines` Node pin so `better-sqlite3`'s native build can't silently drop on a mismatched Node.

---

## Task 1: Org-gate pure function

**Files:**
- Create: `src/lib/org-gate.ts`
- Test: `tests/org-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/org-gate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assertOrgMember } from "../src/lib/org-gate.js";

describe("assertOrgMember", () => {
  const allowed = "useenso.co";

  it("accepts a verified member of the allowed domain", () => {
    expect(() =>
      assertOrgMember({ email_verified: true, hd: "useenso.co" }, allowed),
    ).not.toThrow();
  });

  it("rejects a different hosted domain", () => {
    expect(() =>
      assertOrgMember({ email_verified: true, hd: "evil.com" }, allowed),
    ).toThrow(/not "useenso.co"/);
  });

  it("rejects a consumer account with no hd claim", () => {
    expect(() =>
      assertOrgMember({ email_verified: true }, allowed),
    ).toThrow(/not "useenso.co"/);
  });

  it("rejects an unverified email even on the right domain", () => {
    expect(() =>
      assertOrgMember({ email_verified: false, hd: "useenso.co" }, allowed),
    ).toThrow(/not verified/);
  });

  it("accepts any account when allowed is '*'", () => {
    expect(() =>
      assertOrgMember({ email_verified: false }, "*"),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/org-gate.test.ts`
Expected: FAIL — cannot resolve `../src/lib/org-gate.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/org-gate.ts`:

```typescript
// The org gate: the SOLE perimeter for the shared store. Authorization is
// descoped (see CONTEXT.md) — every authenticated member reads/writes everything
// — so the only thing between an outsider and the store is this check on Google's
// verified `hd` (hosted-domain) claim. It is server-side and non-bypassable: the
// `hd` *request* param only filters Google's account chooser; this verifies the
// claim Google actually signed.

export interface GoogleOrgProfile {
  email_verified: boolean;
  hd?: string;
}

// Throws if `profile` is not a verified member of `allowed`. `allowed === "*"` is
// the explicit opt-out for self-hosters who want no domain restriction.
export function assertOrgMember(profile: GoogleOrgProfile, allowed: string): void {
  if (allowed === "*") return;
  if (!profile.email_verified) {
    throw new Error("org gate: rejected — email not verified");
  }
  if (profile.hd !== allowed) {
    throw new Error(`org gate: rejected — hd "${profile.hd ?? ""}" is not "${allowed}"`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/org-gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/org-gate.ts tests/org-gate.test.ts
git commit -m "feat(auth): org-gate pure function (verify Google hd claim)"
```

---

## Task 2: Wire the gate into the Authorization Server (fail closed)

**Files:**
- Modify: `src/lib/auth.ts:22-54`
- Modify: `tests/server.http.test.ts:19-53` (spawn env) + add one test

- [ ] **Step 1: Add the failing boot test**

In `tests/server.http.test.ts`, add this `it` block inside the existing `describe("server HTTP transport", ...)`:

```typescript
  it("refuses to boot in HTTP mode without MEMORY_FS_ALLOWED_HD", async () => {
    const port = await getFreePort();
    const dir = mkdtempSync(join(tmpdir(), "memfs-noallow-"));
    const child = spawn("node", ["dist/index.js"], {
      env: {
        ...process.env,
        MEMORY_FS_DB: join(dir, "test.db"),
        MEMORY_FS_HTTP_PORT: String(port),
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
        MEMORY_FS_ALLOWED_HD: "", // explicitly unset
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const code: number = await new Promise((resolve) =>
      child.on("exit", (c) => resolve(c ?? 0)),
    );
    expect(code).not.toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/server.http.test.ts -t "refuses to boot"`
Expected: FAIL — the server currently boots fine without `MEMORY_FS_ALLOWED_HD`, so it does not exit non-zero.

- [ ] **Step 3: Implement the gate wiring in `src/lib/auth.ts`**

At the top of the file, add the import:

```typescript
import { assertOrgMember } from "./org-gate.js";
```

Inside `makeAuth`, immediately after the `BETTER_AUTH_SECRET` check (currently `auth.ts:26`), add the fail-closed read:

```typescript
  // The org gate is the sole perimeter (authorization is descoped). Refuse to
  // run the hosted AS without an explicit policy. Use "*" to allow any Google
  // account; set a domain (e.g. "useenso.co") to restrict to one Workspace.
  const allowedHd = process.env.MEMORY_FS_ALLOWED_HD;
  if (!allowedHd) {
    throw new Error('MEMORY_FS_ALLOWED_HD is required (a Workspace domain, or "*" for any Google account)');
  }
```

Replace the Google provider block (currently `auth.ts:33-36`) with:

```typescript
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        // Pre-filter Google's account chooser to the org (UX only; not a control).
        ...(allowedHd !== "*" ? { authorizationUrlParams: { hd: allowedHd } } : {}),
        // The actual control: verify the signed hd claim on every sign-in. Throws
        // to abort the OAuth flow for anyone outside the org.
        mapProfileToUser: (profile) => {
          assertOrgMember(profile, allowedHd);
          return {};
        },
      },
```

- [ ] **Step 4: Add `MEMORY_FS_ALLOWED_HD` to the existing spawn helper**

In `tests/server.http.test.ts`, in `spawnHttpServer` (currently lines 19-53), add the var to the spawned `env` object so the existing 401/PRM tests still boot:

```typescript
    env: {
      ...process.env,
      MEMORY_FS_DB: join(dir, "test.db"),
      MEMORY_FS_HTTP_PORT: String(port),
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      MEMORY_FS_ALLOWED_HD: "*",
    },
```

- [ ] **Step 5: Run the full suite to verify green**

Run: `npm run build && npx vitest run`
Expected: PASS — the new "refuses to boot" test passes, and all pre-existing HTTP/smoke tests still pass (they now spawn with `MEMORY_FS_ALLOWED_HD="*"`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts tests/server.http.test.ts
git commit -m "feat(auth): fail-closed org gate via MEMORY_FS_ALLOWED_HD + mapProfileToUser"
```

> **Note for the implementer:** if `npm run build` (tsc) complains that `authorizationUrlParams` or `mapProfileToUser` is not a known property on the Google provider type for the installed Better Auth version, check the version's type with `npx tsc --noEmit` and adjust the property name to the one that version exposes (the `hd` claim is present on the parsed `GoogleProfile`; the verification in `assertOrgMember` is the load-bearing part — keep it). Do not delete the verification to satisfy the type.

---

## Task 3: Fix the stale deploy artifacts

**Files:**
- Modify: `deploy/memory-fs.service:7,9`
- Modify: `deploy/README.md:12-15`
- Modify: `README.md:18`, `skills/using-memory-fs/SKILL.md:59`, `eval/README.md:22`

No automated test — this is config/docs. Verification is a grep.

- [ ] **Step 1: Fix the systemd unit**

In `deploy/memory-fs.service`, change line 7 from:

```ini
ExecStart=/usr/bin/node /opt/memory-fs/dist/server.js
```

to:

```ini
ExecStart=/usr/bin/node /opt/memory-fs/dist/index.js
```

And change the stale comment on line 9 from:

```ini
# Holds MEMORY_FS_HTTP_PORT, MEMORY_FS_TOKEN, MEMORY_FS_DB, etc.
```

to:

```ini
# Holds MEMORY_FS_HTTP_PORT, MEMORY_FS_DOMAIN, MEMORY_FS_DB, BETTER_AUTH_SECRET,
# GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MEMORY_FS_ALLOWED_HD, BUCKET.
```

- [ ] **Step 2: Fix the deploy env template**

In `deploy/README.md`, replace the env block (currently lines 12-15) with:

```
MEMORY_FS_HTTP_PORT=3456
MEMORY_FS_DOMAIN=memory.useenso.co
MEMORY_FS_DB=/var/lib/memory-fs/memory.db
BETTER_AUTH_SECRET=<32+ random chars — openssl rand -base64 32>
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
MEMORY_FS_ALLOWED_HD=useenso.co
BUCKET=<gcs-bucket-name>
```

- [ ] **Step 3: Fix operative `dist/server.js` references**

Change `dist/server.js` → `dist/index.js` in: `README.md:18`, `skills/using-memory-fs/SKILL.md:59`, `eval/README.md:22`. (Leave `docs/plans/*.md` untouched — they are dated historical records.)

- [ ] **Step 4: Verify no stale references remain in operative files**

Run: `git grep -n "dist/server.js" -- ':!docs/plans'`
Expected: no output (all operative references fixed).

Run: `git grep -n "MEMORY_FS_TOKEN" -- deploy/`
Expected: no output (the static-bearer var is gone from the deploy config).

- [ ] **Step 5: Commit**

```bash
git add deploy/memory-fs.service deploy/README.md README.md skills/using-memory-fs/SKILL.md eval/README.md
git commit -m "fix(deploy): correct entry point to dist/index.js, refresh env template for OAuth"
```

---

## Task 4: Pin the Node version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add an `engines` field**

In `package.json`, add a top-level `engines` field (after `"type": "module",`):

```json
  "engines": {
    "node": ">=20 <25"
  },
```

Rationale: `better-sqlite3` is a native addon; on a mismatched Node (e.g. 26) npm can silently exclude it, disabling FTS5. Pinning makes that fail loudly at install instead.

- [ ] **Step 2: Verify install + build still work**

Run: `npm install && npm run build && npx vitest run`
Expected: install succeeds on the current Node, build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: pin Node engine so better-sqlite3 native build can't silently drop"
```

---

## Task 5: Provision and validate on GCP (manual runbook)

These steps run against Google Cloud and the GCE host, not the repo — no commits. Follow `deploy/README.md` and `docs/plans/2026-05-27-phase-5-hosted-gcp.md` for the systemd/Caddy/backup details.

- [ ] **Step 1: Create a production Google OAuth client**
  - New OAuth 2.0 Client (Web application) in the Cloud project.
  - **Set the OAuth consent screen User Type = Internal** — this restricts who can authorize the app to your Workspace (the second, free perimeter).
  - Authorized redirect URI: `https://memory.useenso.co/api/auth/callback/google` (this is the AS's own Google callback; Claude registers its callback via DCR, not here).

- [ ] **Step 2: Generate fresh prod secrets**
  - `openssl rand -base64 32` → `BETTER_AUTH_SECRET`.
  - Do **not** reuse the dev `.env` Google client or secret.

- [ ] **Step 3: Write the host env file** at `/etc/memory-fs/env` (root, mode 600) using the template from Task 3 Step 2, with `MEMORY_FS_ALLOWED_HD=useenso.co`.

- [ ] **Step 4: Provision the VM** per `deploy/README.md`: clone to `/opt/memory-fs`, `npm ci && npm run build`, install the systemd units, point DNS (`memory.useenso.co` → the VM's static IP), bring up Caddy for auto-TLS, enable the backup timer.

- [ ] **Step 5: Validate the full loop with ONLY your own account**
  - Add the MCP server in Claude, complete the Google sign-in + consent, confirm `/mcp` works (a memory write/read round-trips).
  - Confirm the gate rejects an outsider: attempt sign-in with a non-`useenso.co` Google account and verify it is refused.

- [ ] **Step 6: Invite the team** once both validations pass.

---

## Self-Review

- **Spec coverage:** org gate (Tasks 1–2) ✓; fail-closed/configurable domain (Task 2) ✓; Google "Internal" consent screen (Task 5 Step 1) ✓; stale `deploy/` fixes (Task 3) ✓; fresh prod secrets (Task 5 Steps 1–3) ✓; GCE deploy + validate-private-first (Task 5) ✓; Node pin to protect better-sqlite3 (Task 4) ✓. Token-TTL tuning intentionally **out of scope** (soft window accepted — Better Auth defaults).
- **Placeholders:** none in code steps. The `<...>` markers in Task 3/5 env templates are operator-supplied secrets, not code placeholders.
- **Type consistency:** `assertOrgMember(profile, allowed)` and `GoogleOrgProfile { email_verified, hd? }` are used identically in `org-gate.ts`, its test, and the `auth.ts` wiring. `MEMORY_FS_ALLOWED_HD` is spelled identically across `auth.ts`, the tests, and the deploy template.
