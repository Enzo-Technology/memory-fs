// Consent page behavior. client_id/scope come from the query string; we fill them in
// with textContent (never innerHTML) so attacker-controlled values can't inject markup.
const params = new URLSearchParams(location.search);
document.getElementById("client").textContent = params.get("client_id") || "An application";
document.getElementById("scope").textContent = params.get("scope") || "openid profile email";

// The signed query the authorize endpoint handed us; the consent endpoint needs it back.
const oauth_query = location.search.replace(/^\?/, "");

async function decide(accept) {
  const r = await fetch("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept, oauth_query }),
  });
  // oauth-provider returns { redirect: true, url } — `url` is the client callback
  // (carrying the authorization code), for both Allow and Deny. `redirect` is just a flag.
  const data = await r.json().catch(() => ({}));
  if (data.url) location.href = data.url;
  else document.getElementById("err").textContent = "Consent failed";
}

document.getElementById("allow").onclick = () => decide(true);
document.getElementById("deny").onclick = () => decide(false);
