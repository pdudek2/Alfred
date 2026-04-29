import type { TriageTab } from "../lib/run-view-model";

type SoftFilterBarProps = {
  tab: TriageTab;
  query: string;
  counts: Record<TriageTab, number>;
  onTabChange(tab: TriageTab): void;
  onQueryChange(query: string): void;
};

const TABS: Array<{ id: TriageTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "needs", label: "Needs you" },
  { id: "done", label: "Done" },
];

export function SoftFilterBar({ tab, query, counts, onTabChange, onQueryChange }: SoftFilterBarProps) {
  return (
    <div className="reader-filter-bar">
      <div aria-label="Run filters" className="reader-filter-bar__pills" role="group">
        {TABS.map((item) => {
          const active = tab === item.id;

          return (
            <button
              aria-label={`${item.label} ${counts[item.id]}`}
              aria-pressed={active}
              className={`reader-filter-pill${active ? " reader-filter-pill--active" : ""}`}
              key={item.id}
              onClick={() => onTabChange(item.id)}
              type="button"
            >
              <span className="reader-filter-pill__label">{item.label}</span>
              <span className="reader-filter-pill__count">{counts[item.id]}</span>
            </button>
          );
        })}
      </div>

      <label className="reader-filter-bar__search">
        <span aria-hidden="true" className="reader-filter-bar__search-prefix">
          ›
        </span>
        <input
          aria-label="Search runs"
          data-reader-search
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="search project or topic"
          type="search"
          value={query}
        />
      </label>
    </div>
  );
}
