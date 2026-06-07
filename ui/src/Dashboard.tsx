import { useEffect } from "react";
import { authClient } from "./auth";
import { Shell } from "./Shell";
import { Browser } from "./Browser";

// The session-gated app home: the full-viewport memory browser. Anything that isn't /sign-in,
// /sign-up, or /consent lands here — including /:namespace/:key deep links, which the browser
// reads off the URL. The auth screens still use the centered Shell; the browser does not.
export function Dashboard() {
  const { data: session, isPending } = authClient.useSession();

  // No session → this is a private surface, send them to sign in.
  useEffect(() => {
    if (!isPending && !session) location.href = "/sign-in";
  }, [isPending, session]);

  if (isPending || !session)
    return (
      <Shell>
        <p>…</p>
      </Shell>
    );

  return (
    <Browser
      email={session.user.email}
      onSignOut={() => authClient.signOut().then(() => location.reload())}
    />
  );
}
