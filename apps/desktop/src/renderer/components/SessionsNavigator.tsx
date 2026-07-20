import { ChevronLeft, RefreshCcw, Search } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { SESSIONS_PAGE_SIZE, type SessionSummary } from "../../shared/sessions-ipc";
import type { SessionsProjectionPage } from "../sessions-projection";
import type { SessionsViewState } from "../sessions-view-state";
import { sessionAgeLabel } from "../session-time";

type SessionsNavigatorProps = {
  activeSessionKey: string | null;
  externalSessionIndexingEnabled: boolean;
  externalSessionsError: string | null;
  loadingExternalSessions: boolean;
  navigatorRef: RefObject<HTMLDivElement | null>;
  projection: SessionsProjectionPage;
  searchRef: RefObject<HTMLInputElement | null>;
  state: SessionsViewState;
  onActiveSessionKeyChange: (sessionKey: string | null) => void;
  onBackToWork: () => void;
  onRefreshExternalSessions: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onStatePatch: (patch: Partial<SessionsViewState>) => void;
};

export function SessionsNavigator({
  activeSessionKey,
  externalSessionIndexingEnabled,
  externalSessionsError,
  loadingExternalSessions,
  navigatorRef,
  projection,
  searchRef,
  state,
  onActiveSessionKeyChange,
  onBackToWork,
  onRefreshExternalSessions,
  onSelectSession,
  onStatePatch,
}: SessionsNavigatorProps) {
  const activeIndex = Math.max(0, projection.items.findIndex((item) => item.sessionKey === activeSessionKey));
  const selectedDomId = projection.items.length > 0 ? optionDomId(activeIndex) : undefined;
  const resultStatus = loadingExternalSessions && projection.items.length === 0
    ? "Loading sessions…"
    : `${projection.total} result${projection.total === 1 ? "" : "s"}`;
  const hasNextPage = (state.pageIndex + 1) * SESSIONS_PAGE_SIZE < projection.total;

  const updateQuery = (event: ChangeEvent<HTMLInputElement>) => {
    onStatePatch({ query: event.target.value, pageIndex: 0 });
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (projection.items.length === 0) return;
    let nextIndex = activeIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(projection.items.length - 1, activeIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, activeIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = projection.items.length - 1;
    else if (event.key === "Enter") {
      event.preventDefault();
      const session = projection.items[activeIndex];
      if (session) onSelectSession(session);
      return;
    } else {
      return;
    }

    event.preventDefault();
    const session = projection.items[nextIndex];
    onActiveSessionKeyChange(session?.sessionKey ?? null);
    document.getElementById(optionDomId(nextIndex))?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <aside className="sessions-navigator" aria-label="Sessions search">
      <div className="sessions-navigator__heading">
        <button type="button" onClick={onBackToWork}>
          <ChevronLeft aria-hidden="true" size={14} />
          <span>Projects</span>
        </button>
        <strong>Sessions</strong>
      </div>
      <label className="sessions-navigator__search">
        <Search aria-hidden="true" size={15} />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search sessions"
          placeholder="Search sessions…"
          value={state.query}
          onChange={updateQuery}
        />
      </label>
      <div className="sessions-navigator__filters">
        <fieldset aria-label="Session source">
          <legend className="visually-hidden">Session source</legend>
          {([
            ["all", "All sources"],
            ["managed", "Managed"],
            ["external-codex", "External Codex"],
          ] as const).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="sessions-source"
                checked={state.source === value}
                onChange={() => onStatePatch({ source: value, pageIndex: 0 })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset aria-label="Session time range">
          <legend className="visually-hidden">Session time range</legend>
          {([
            ["any", "Any time"],
            ["day", "Past day"],
            ["week", "Past week"],
            ["month", "Past month"],
          ] as const).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="sessions-time-range"
                checked={state.timeRange === value}
                onChange={() => onStatePatch({ timeRange: value, pageIndex: 0 })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          aria-label="Refresh external sessions"
          disabled={!externalSessionIndexingEnabled || loadingExternalSessions}
          onClick={onRefreshExternalSessions}
        >
          <RefreshCcw aria-hidden="true" size={14} />
        </button>
      </div>

      {!externalSessionIndexingEnabled && (
        <p className="sessions-navigator__notice"><strong>External Codex indexing is off.</strong></p>
      )}
      {externalSessionIndexingEnabled && externalSessionsError && (
        <p className="sessions-navigator__notice">
          <strong>Showing last successful results.</strong>
          <span>{externalSessionsError}</span>
        </p>
      )}
      <span className="sessions-navigator__result-status" role="status" aria-live="polite" aria-atomic="true">
        {resultStatus}
      </span>

      <div
        ref={navigatorRef}
        className="sessions-results"
        role="listbox"
        aria-label="Session results"
        aria-activedescendant={selectedDomId}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        onScroll={(event) => onStatePatch({ navigatorScrollTop: event.currentTarget.scrollTop })}
      >
        {projection.items.length === 0 && !loadingExternalSessions ? (
          <div className="sessions-navigator__empty">
            <strong>No sessions found.</strong>
            <span>Try another title, project, source, or time range.</span>
          </div>
        ) : projection.groups.map((group) => (
          <section role="group" aria-label={group.label} key={group.id}>
            <h2>{group.label}</h2>
            {group.items.map((session) => {
              const index = projection.items.findIndex((item) => item.sessionKey === session.sessionKey);
              const active = index === activeIndex;
              return (
                <button
                  type="button"
                  role="option"
                  id={optionDomId(index)}
                  aria-selected={state.selectedSessionKey === session.sessionKey}
                  className={active ? "sessions-result active" : "sessions-result"}
                  key={session.sessionKey}
                  tabIndex={-1}
                  onClick={() => {
                    onActiveSessionKeyChange(session.sessionKey);
                    onSelectSession(session);
                  }}
                >
                  <span className="sessions-navigator__result-title">
                    <strong>{session.title}</strong>
                    <time>{sessionAgeLabel(session.updatedAt)}</time>
                  </span>
                  {session.snippet && <span>{session.snippet}</span>}
                  <span className="sessions-navigator__result-meta">
                    <b>{session.kind === "manual" ? "Manual" : session.kind === "claude" ? "Claude" : "Codex"}</b>
                    <span>{session.branch ?? session.locationLabel}</span>
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {(state.pageIndex > 0 || hasNextPage) && (
        <nav className="sessions-navigator__pagination" aria-label="Session result pages">
          <button
            type="button"
            disabled={state.pageIndex === 0}
            onClick={() => onStatePatch({ pageIndex: Math.max(0, state.pageIndex - 1), navigatorScrollTop: 0 })}
          >
            Previous
          </button>
          <span>Page {state.pageIndex + 1}</span>
          <button
            type="button"
            disabled={!hasNextPage}
            onClick={() => onStatePatch({ pageIndex: state.pageIndex + 1, navigatorScrollTop: 0 })}
          >
            Next
          </button>
        </nav>
      )}
    </aside>
  );
}

function optionDomId(index: number): string {
  return `sessions-option-${index}`;
}
