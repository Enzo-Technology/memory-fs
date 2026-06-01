import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAuthClient } from "better-auth/client";

const authClient = createAuthClient(); // no baseURL → same-origin (works with the
                                        // dev proxy and in prod)

function SignIn() {
// The signed authorize query that got us here. We must hand it back to the
// authorize endpoint *after* Google returns, or the OAuth flow can't resume.
// For a social login that means passing it as callbackURL — the redirect target
// Better Auth sends you to once the Google round-trip + session are done.
const resume = "/api/auth/oauth2/authorize" + location.search;
return (
    <main style={{ fontFamily: "system-ui", maxWidth: "24rem", margin: "4rem auto" }}>
        <h1>memory-fs</h1>
        <button onClick={() => authClient.signIn.social({ provider: "google", callbackURL: resume })}>
            Continue with Google
        </button>
    </main>
);
}

createRoot(document.getElementById("root")!).render(
<StrictMode>
    <SignIn />
</StrictMode>,
);