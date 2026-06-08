// The 60px top bar: wordmark, the wide global search field (full-text recall — NOT a tree
// filter; the ⌘K palette treatment is P2), and the account. Props in, events out.
// Styling: .topbar.
export function TopBar({
  query,
  onQuery,
  email,
  onSignOut,
}: {
  query: string;
  onQuery: (q: string) => void;
  email: string;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <span className="topbar__wordmark">memory-fs</span>
      <input
        className="topbar__search"
        value={query}
        placeholder="Search memories…"
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="topbar__account">
        <span className="topbar__email">{email}</span>
        <button className="topbar__signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
