import { useEffect } from "react";
import { authClient } from "./auth";
import { Shell } from "./Shell";
import { Browser } from "./Browser";

// The session-gated app home: the memory browser. Anything that isn't /sign-in, /sign-up, or
// /consent lands here. Styling: .dashboard-bar.
export function Dashboard() {
  const { data: session, isPending } = authClient.useSession();

  // No session → this is a private surface, send them to sign in.
  useEffect(() => {
    if (!isPending && !session) location.href = "/sign-in";
  }, [isPending, session]);

  if (isPending || !session) return <Shell><p>…</p></Shell>;

  return (
    <Shell wide>
      <div className="dashboard-bar">
        <span>
          Signed in as <strong>{session.user.email}</strong>.
        </span>
        <button onClick={() => authClient.signOut().then(() => location.reload())}>
          Sign out
        </button>
      </div>
      <Browser />
    </Shell>
  );
}
