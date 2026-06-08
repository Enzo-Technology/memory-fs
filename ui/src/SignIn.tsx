import { useEffect } from "react";
import { authClient, authorizeResume } from "./auth";
import { Shell } from "./Shell";

// Serves /sign-in and /sign-up identically: with Google-only social login there is no
// separate "create account" step — first-time and returning are the same action.
export function SignIn() {
  const { data: session, isPending } = authClient.useSession();
  const resume = authorizeResume();

  // Already signed in AND mid-OAuth: resume the authorization request automatically,
  // so a returning user sails through without re-clicking anything.
  useEffect(() => {
    if (session && resume) location.href = resume;
  }, [session, resume]);

  if (isPending) return <Shell><p>…</p></Shell>;

  if (session) {
    if (resume) return <Shell><p>Continuing…</p></Shell>;
    // Plain visit while signed in: the "you're already signed in" screen.
    return (
      <Shell>
        <p>
          You're signed in as <strong>{session.user.email}</strong>.
        </p>
        <a href="/">Go to memory browser</a>
        <button onClick={() => authClient.signOut().then(() => location.reload())}>
          Sign out
        </button>
      </Shell>
    );
  }

  // Not signed in. callbackURL resumes the OAuth flow if we're mid-authorize, else
  // lands on the app home. Dedicated centered card (not the generic Shell) so the entry
  // screen gets the Foundations treatment.
  const callbackURL = resume ?? "/";
  return (
    <main className="signin">
      <div className="signin__card">
        <div className="signin__wordmark">memory-fs</div>
        <p className="signin__tagline">Shared memory for your agents.</p>
        <button
          className="signin__google"
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
        >
          <GoogleGlyph />
          Continue with Google
        </button>
      </div>
    </main>
  );
}

// The Google "G" mark — inline so the button needs no asset pipeline.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
