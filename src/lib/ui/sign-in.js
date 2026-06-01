// Sign-in page behavior. On success, resume the OAuth flow by returning to the
// authorize endpoint with the original signed query (location.search).

// Carry the signed authorize query onto the cross-link, or the resume would lose it.
document.getElementById("signup").href = "/sign-up" + location.search;

document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
  });
  if (r.ok) location.href = "/api/auth/oauth2/authorize" + location.search;
  else document.getElementById("err").textContent = "Sign-in failed";
});
