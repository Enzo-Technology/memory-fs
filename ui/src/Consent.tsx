import { Shell } from "./Shell";

// The OAuth consent screen, reached only mid-authorize (Better Auth redirects here
// after a session exists). It hands the signed authorization request back to the
// consent endpoint, which returns the client callback URL carrying the auth code.
export function Consent() {
  const params = new URLSearchParams(location.search);
  const client = params.get("client_id") || "An application";
  const scope = params.get("scope") || "openid profile email";
  const oauth_query = location.search.replace(/^\?/, ""); // the signed query, handed back

  async function decide(accept: boolean) {
    const r = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query }),
    });
    const data = await r.json().catch(() => ({}));
    if (data.url) location.href = data.url; // client callback (carries the auth code)
  }

  return (
    <Shell title="Authorize access">
      {/* React escapes {client}/{scope}, so these interpolations are XSS-safe. */}
      <p>
        <strong>{client}</strong> wants access to:
      </p>
      <p>
        <code>{scope}</code>
      </p>
      <button onClick={() => decide(true)}>Allow</button>
      <button onClick={() => decide(false)}>Deny</button>
    </Shell>
  );
}
