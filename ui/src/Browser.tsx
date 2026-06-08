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

  // Global keyboard: ⌘K opens the palette; arrows/↵/Esc drive the tree/list cursor. Skipped while
  // the palette is open (it owns its own keys) or while typing in a field (the top-bar search).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        vm.openPalette();
        return;
      }
      if (vm.paletteOpen) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vm.moveCursor(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          vm.moveCursor(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          vm.cursorExpand();
          break;
        case "ArrowLeft":
          e.preventDefault();
          vm.cursorCollapse();
          break;
        case "Enter":
          e.preventDefault();
          vm.cursorActivate();
          break;
        case "Escape":
          e.preventDefault();
          if (drilled) vm.showTree();
          else if (vm.query) vm.setQuery("");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    vm.openPalette,
    vm.paletteOpen,
    vm.moveCursor,
    vm.cursorExpand,
    vm.cursorCollapse,
    vm.cursorActivate,
    vm.showTree,
    vm.setQuery,
    vm.query,
    drilled,
  ]);

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
            flatError={vm.flatError}
            results={vm.results}
            resultsError={vm.resultsError}
            selected={vm.selected}
            cursorAddress={vm.cursorAddress}
            tags={vm.tags}
            selectedTag={vm.selectedTag}
            onToggle={vm.toggleFolder}
            onOpen={vm.open}
            onExpandAll={vm.expandAll}
            onSelectTag={(tag) => vm.selectTag(tag)}
            onClearTag={() => vm.selectTag(null)}
          />
        )}
        <Reader
          key={vm.selected ? `${vm.selected.namespace}/${vm.selected.key}` : "none"}
          detail={vm.detail}
          detailError={vm.detailError}
          selected={!!vm.selected}
          mode={vm.mode}
          empty={emptyReader}
          onNavigate={vm.open}
          onDrill={vm.drill}
          onShowTree={vm.showTree}
          pendingBacklinks={vm.pendingBacklinks}
          onDelete={vm.confirmDelete}
          onCancelDelete={vm.cancelDelete}
        />
      </div>
    </div>
  );
}
