// The composer: calls useBrowser and wires its view-model + actions into the full-viewport shell
// (top bar / lens row / body split). In drill mode the tree is unmounted and the reader becomes a
// single centered column. No logic of its own — derived props belong in useBrowser. Styling: .app.
import { useBrowser } from "./useBrowser";
import { TopBar } from "./TopBar";
import { LensRow } from "./LensRow";
import { TreePane } from "./TreePane";
import { Reader } from "./Reader";

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
  return (
    <div className={drilled ? "app app--drill" : "app"}>
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
