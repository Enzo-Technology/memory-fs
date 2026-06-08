// The 50px lens row: the lenses (Namespaces/All/Recent/Hubs/Orphans/Tags) and the
// running total pinned right. Selecting
// a lens swaps what populates the tree pane; it never changes the layout. Props only.
// Styling: .lensrow / .lens.
import type { Lens } from "./api";

const LENSES: { id: Lens; label: string }[] = [
  { id: "namespaces", label: "Namespaces" },
  { id: "all", label: "All" },
  { id: "recent", label: "Recent" },
  { id: "hubs", label: "Hubs" },
  { id: "orphans", label: "Orphans" },
  { id: "tags", label: "Tags" },
];

export function LensRow({
  active,
  onSelect,
  totals,
}: {
  active: Lens;
  onSelect: (l: Lens) => void;
  totals: { memories: number; namespaces: number };
}) {
  return (
    <nav className="lensrow">
      <div className="lensrow__lenses">
        {LENSES.map((l) => (
          <button
            key={l.id}
            className={l.id === active ? "lens lens--active" : "lens"}
            onClick={() => onSelect(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <span className="lensrow__total">
        {totals.memories} memories · {totals.namespaces} namespaces
      </span>
    </nav>
  );
}
