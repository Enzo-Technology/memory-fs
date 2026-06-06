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
  // lands on the app home.
  const callbackURL = resume ?? "/";
  return (
    <Shell>
      <button
        onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
      >
        Continue with Google
      </button>
    </Shell>
  );
}
