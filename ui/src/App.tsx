import { SignIn } from "./SignIn";
import { Consent } from "./Consent";
import { Dashboard } from "./Dashboard";

// Path-based switch, not a router library: every screen is entered via a full-page
// redirect from Better Auth (/authorize → /sign-in, → /consent) or a typed URL, so
// there's no client-side navigation to manage yet. When the memory browser grows
// real in-app navigation, swap this for a router — until then this is the dumb thing
// that works.
export function App() {
  switch (location.pathname) {
    case "/consent":
      return <Consent />;
    case "/sign-in":
    case "/sign-up":
      return <SignIn />;
    default:
      return <Dashboard />;
  }
}
