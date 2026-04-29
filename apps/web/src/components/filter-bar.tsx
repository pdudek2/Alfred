import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { RunFilters, RunListItem } from "../lib/api-client";

type FilterDraft = {
  source: string;
  status: string;
  project: string;
  since: string;
};

type FilterBarProps = {
  filters: RunFilters;
  runs: RunListItem[];
  onApply(filters: RunFilters): void;
};

const EMPTY_DRAFT: FilterDraft = {
  source: "",
  status: "",
  project: "",
  since: "",
};

const DEFAULT_STATUSES = ["running", "waiting", "stale", "completed", "failed", "unknown"];

export function FilterBar({ filters, runs, onApply }: FilterBarProps) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromFilters(filters));

  useEffect(() => {
    setDraft(draftFromFilters(filters));
  }, [filters]);

  const sourceOptions = useMemo(
    () => uniqueSorted(runs.map((run) => run.source_id)),
    [runs],
  );
  const projectOptions = useMemo(
    () => uniqueSorted(runs.map((run) => run.project_name ?? run.project_key ?? "").filter(Boolean)),
    [runs],
  );
  const statusOptions = useMemo(
    () => uniqueSorted([...DEFAULT_STATUSES, ...runs.map((run) => run.status), draft.status]),
    [draft.status, runs],
  );
  const appliedDraft = draftFromFilters(filters);
  const applyDisabled = draftsEqual(draft, appliedDraft);
  const clearDisabled = draftsEqual(appliedDraft, EMPTY_DRAFT) && draftsEqual(draft, EMPTY_DRAFT);
  const hasActiveFilters = !draftsEqual(appliedDraft, EMPTY_DRAFT);

  function updateDraft(key: keyof FilterDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyDraft() {
    onApply(filtersFromDraft(draft));
  }

  function clearFilters() {
    setDraft(EMPTY_DRAFT);
    onApply({});
  }

  return (
    <details className="filter-disclosure" open={hasActiveFilters || undefined}>
      <summary className="filter-summary">
        <SlidersHorizontal aria-hidden="true" size={15} />
        <span>Filters</span>
        {hasActiveFilters ? <strong>active</strong> : null}
      </summary>

      <form
        aria-label="Run filters"
        className="filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          applyDraft();
        }}
      >
        <label className="filter-field" htmlFor="run-filter-source">
          <span>Source</span>
          <input
            id="run-filter-source"
            list="run-filter-source-options"
            onChange={(event) => updateDraft("source", event.target.value)}
            placeholder="any"
            type="text"
            value={draft.source}
          />
        </label>
        <datalist id="run-filter-source-options">
          {sourceOptions.map((source) => (
            <option key={source} value={source} />
          ))}
        </datalist>

        <label className="filter-field" htmlFor="run-filter-status">
          <span>Status</span>
          <select
            id="run-filter-status"
            onChange={(event) => updateDraft("status", event.target.value)}
            value={draft.status}
          >
            <option value="">any</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field" htmlFor="run-filter-project">
          <span>Project</span>
          <input
            id="run-filter-project"
            list="run-filter-project-options"
            onChange={(event) => updateDraft("project", event.target.value)}
            placeholder="any"
            type="text"
            value={draft.project}
          />
        </label>
        <datalist id="run-filter-project-options">
          {projectOptions.map((project) => (
            <option key={project} value={project} />
          ))}
        </datalist>

        <label className="filter-field" htmlFor="run-filter-since">
          <span>Since</span>
          <input
            id="run-filter-since"
            onChange={(event) => updateDraft("since", event.target.value)}
            type="date"
            value={draft.since}
          />
        </label>

        <div className="filter-actions">
          <button
            aria-label="Apply filters"
            className="filter-action filter-action-primary"
            disabled={applyDisabled}
            type="submit"
          >
            Apply
          </button>
          <button
            aria-label="Clear filters"
            className="filter-action"
            disabled={clearDisabled}
            onClick={clearFilters}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            Clear
          </button>
        </div>
      </form>
    </details>
  );
}

function draftFromFilters(filters: RunFilters): FilterDraft {
  return {
    source: filters.source ?? "",
    status: filters.status ?? "",
    project: filters.project ?? "",
    since: filters.since ?? "",
  };
}

function filtersFromDraft(draft: FilterDraft): RunFilters {
  const filters: RunFilters = {};
  const source = draft.source.trim();
  const status = draft.status.trim();
  const project = draft.project.trim();
  const since = draft.since.trim();

  if (source) filters.source = source;
  if (status) filters.status = status;
  if (project) filters.project = project;
  if (since) filters.since = since;

  return filters;
}

function draftsEqual(left: FilterDraft, right: FilterDraft) {
  return (
    left.source === right.source &&
    left.status === right.status &&
    left.project === right.project &&
    left.since === right.since
  );
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}
