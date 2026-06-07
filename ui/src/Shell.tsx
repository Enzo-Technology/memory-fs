import type { ReactNode } from "react";

// Shared page chrome. Every screen is a centered card; factoring it here keeps the
// route components about behavior, not layout. `wide` swaps the narrow auth-card width for a
// full-width canvas — the memory browser's three panes need the room. Visual styling lives in
// styles.css (.shell / .shell--narrow), not here.
export function Shell({
  title = "memory-fs",
  wide = false,
  children,
}: {
  title?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={wide ? "shell" : "shell shell--narrow"}>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
