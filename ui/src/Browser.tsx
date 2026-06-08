// The composer: calls useBrowser and wires its view-model + actions into the full-viewport shell
// (top bar / lens row / body split). In drill mode the tree is unmounted and the reader becomes a
// single centered column. No logic of its own — derived props belong in useBrowser. Styling: .app.
import { useEffect } from "react";
import { useBrowser } from "./useBrowser";
import { TopBar } from "./TopBar";
import { LensRow } from "./LensRow";
import { TreePane } from "./TreePane";
import { Reader } from "./Reader";
import { CommandPalette } from "./CommandPalette";

export function Browser({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const vm = useBrowser();
  const drilled = vm.mode === "drill";
  const emptyReader =
    vm.totals.memories === 0
      ? "Agents haven't written anything here yet."
      : "Select a memory.";

  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        vm.openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm.openPalette]);

  return (
    <div className={drilled ? "app app--drill" : "app"}>
      {vm.paletteOpen && (
        <CommandPalette
          open={vm.paletteOpen}
          onClose={vm.closePalette}
          onOpenMemory={vm.open}
        />
      )}
      <TopBar query={vm.query} onQuery={vm.setQuery} email={email} onSignOut={onSignOut} />
      <LensRow active={vm.lens} onSelect={vm.selectLens} totals={vm.totals} />
      <div className="app__body">
        {!drilled && (
          <TreePane
            lens={vm.lens}
            query={vm.query}
            tree={vm.tree}
            expanded={vm.expanded}
            leaves={vm.leaves}
            flat={vm.flat}
            results={vm.results}
            selected={vm.selected}
            onToggle={vm.toggleFolder}
            onOpen={vm.open}
            onExpandAll={vm.expandAll}
          />
        )}
        <Reader
          detail={vm.detail}
          mode={vm.mode}
          empty={emptyReader}
          onNavigate={vm.open}
          onDrill={vm.drill}
          onShowTree={vm.showTree}
        />
      </div>
    </div>
  );
}
