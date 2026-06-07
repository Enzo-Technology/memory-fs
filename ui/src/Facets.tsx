// The lens switcher. Props in, events out — no fetching, no state. Lenses limited to those that
// resolve to memory items the user can open (tags deferred — see spec). Styling: .facets / .facet.
import type { Facet } from "./api";

const FACETS: Facet[] = ["recent", "namespaces", "hubs", "orphans"];

export function Facets({
  active,
  onSelect,
}: {
  active: Facet;
  onSelect: (f: Facet) => void;
}) {
  return (
    <nav className="facets">
      {FACETS.map((f) => (
        <button
          key={f}
          onClick={() => onSelect(f)}
          className={f === active ? "facet facet--active" : "facet"}
        >
          {f}
        </button>
      ))}
    </nav>
  );
}
