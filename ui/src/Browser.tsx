// The composer: calls useBrowser and wires its view-model + actions into the three panes. No
// logic of its own — if a derived/massaged prop is ever needed, it belongs in useBrowser, not
// here (keeps this from rotting into a pass-through layer). Styling: .browser.
import { useBrowser } from "./useBrowser";
import { Facets } from "./Facets";
import { MemoryList } from "./MemoryList";
import { MemoryDetail } from "./MemoryDetail";

export function Browser() {
  const vm = useBrowser();
  return (
    <div className="browser">
      <Facets active={vm.facet} onSelect={vm.selectFacet} />
      <MemoryList
        query={vm.query}
        onQuery={vm.setQuery}
        browse={vm.browse}
        results={vm.results}
        onOpen={vm.open}
        onNamespace={vm.selectNamespace}
      />
      <MemoryDetail detail={vm.detail} onNavigate={vm.open} />
    </div>
  );
}
