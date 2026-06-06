import { useEffect } from "react";
import { authClient } from "./auth";
import { Shell } from "./Shell";

// The session-gated app home — the seed of the memory browser. Anything that isn't
// /sign-in, /sign-up, or /consent lands here.
export function Dashboard() {
  const { data: session, isPending } = authClient.useSession();

  // No session → this is a private surface, send them to sign in.
  useEffect(() => {
    if (!isPending && !session) location.href = "/sign-in";
  }, [isPending, session]);

  if (isPending || !session) return <Shell><p>…</p></Shell>;

  return (
    <Shell>
      <p>
        Signed in as <strong>{session.user.email}</strong>.
      </p>
      <p>Memory browser coming soon.</p>
      <button onClick={() => authClient.signOut().then(() => location.reload())}>
        Sign out
      </button>
    </Shell>
  );
}
