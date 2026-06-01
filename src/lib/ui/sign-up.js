// Carry the signed authorize query onto the cross-link, or the resume would lose it.
document.getElementById("signin").href = "/sign-in" + location.search;

// On success Better Auth creates a session immediately, so we can resume the OAuth flow
// by returning to the authorize endpoint with the original signed query.
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: fd.get("name"),
      email: fd.get("email"),
      password: fd.get("password"),
    }),
  });
  if (r.ok) location.href = "/api/auth/oauth2/authorize" + location.search;
  else document.getElementById("err").textContent = "Sign-up failed";
});
