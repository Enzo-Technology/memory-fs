import type { ReactNode } from "react";

// Shared page chrome. Every screen is a centered card; factoring it here keeps the
// route components about behavior, not layout.
export function Shell({
  title = "memory-fs",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        fontFamily: "system-ui",
        maxWidth: "24rem",
        margin: "4rem auto",
        display: "grid",
        gap: "1rem",
      }}
    >
      <h1>{title}</h1>
      {children}
    </main>
  );
}
