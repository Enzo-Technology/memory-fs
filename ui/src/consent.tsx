import { StrictMode } from "react";
  import { createRoot } from "react-dom/client";

  function Consent() {
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
      <main style={{ fontFamily: "system-ui", maxWidth: "24rem", margin: "4rem auto" }}>
        <h1>Authorize access</h1>
        {/* React escapes {client}/{scope} by default — the textContent XSS-safety the old
            comment guarded is now automatic. */}
        <p><strong>{client}</strong> wants access to:</p>
        <p><code>{scope}</code></p>
        <button onClick={() => decide(true)}>Allow</button>
        <button onClick={() => decide(false)}>Deny</button>
      </main>
    );
  }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Consent />
  </StrictMode>,
);