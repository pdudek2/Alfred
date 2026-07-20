import { RefreshCcw, Search } from "lucide-react";
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
  onOpenPrivacySettings: (() => void) | undefined;
  onRefreshExternalSessions: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onFocusTargetChange: (target: "search" | "results") => void;
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
  onOpenPrivacySettings,
  onRefreshExternalSessions,
  onSelectSession,
  onFocusTargetChange,
  onStatePatch,
}: SessionsNavigatorProps) {
  const activeIndex = Math.max(0, projection.items.findIndex((item) => item.sessionKey === activeSessionKey));
  const selectedDomId = projection.items.length > 0 ? optionDomId(activeIndex) : undefined;
  const resultStatus = loadingExternalSessions && projection.items.length === 0
    ? "Loading conversations…"
    : `${projection.total} conversation${projection.total === 1 ? "" : "s"}`;
  const hasNextPage = (state.pageIndex + 1) * SESSIONS_PAGE_SIZE < projection.total;

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (projection.items.length === 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const session = projection.items[activeIndex];
      if (session) onSelectSession(session);
      return;
    }
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(projection.items.length - 1, activeIndex + 1)
      : event.key === "ArrowUp"
        ? Math.max(0, activeIndex - 1)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? projection.items.length - 1
            : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const session = projection.items[nextIndex];
    onActiveSessionKeyChange(session?.sessionKey ?? null);
    document.getElementById(optionDomId(nextIndex))?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <aside className="sessions-navigator" aria-label="Conversations">
      <header className="sessions-navigator__heading">
        <strong>Conversations</strong>
        <span>{projection.total}</span>
      </header>
      <label className="sessions-navigator__search">
        <Search aria-hidden="true" size={15} />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search sessions"
          placeholder="Search conversations…"
          value={state.query}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onStatePatch({ query: event.target.value, pageIndex: 0 })}
          onFocus={() => onFocusTargetChange("search")}
        />
      </label>
      <div className="sessions-navigator__filters">
        <fieldset aria-label="Session source">
          <legend className="visually-hidden">Session source</legend>
          {([ ["all", "All"], ["managed", "Managed"], ["external-codex", "Codex"] ] as const).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="sessions-source" checked={state.source === value} onChange={() => onStatePatch({ source: value, pageIndex: 0 })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset aria-label="Session time range">
          <legend className="visually-hidden">Session time range</legend>
          {([ ["any", "Any time"], ["day", "Day"], ["week", "Week"], ["month", "Month"] ] as const).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="sessions-time-range" checked={state.timeRange === value} onChange={() => onStatePatch({ timeRange: value, pageIndex: 0 })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" aria-label="Refresh external sessions" disabled={!externalSessionIndexingEnabled || loadingExternalSessions} onClick={onRefreshExternalSessions}>
          <RefreshCcw aria-hidden="true" size={14} />
        </button>
      </div>

      {!externalSessionIndexingEnabled && (
        <p className="sessions-navigator__notice">
          <strong>External Codex indexing is off.</strong>
          {onOpenPrivacySettings && <button type="button" onClick={onOpenPrivacySettings}>Open Local Data &amp; Privacy</button>}
        </p>
      )}
      {externalSessionIndexingEnabled && externalSessionsError && (
        <p className="sessions-navigator__notice"><strong>External sessions may be incomplete.</strong><span>{externalSessionsError}</span></p>
      )}
      <span className="sessions-navigator__result-status" role="status" aria-live="polite" aria-atomic="true">{resultStatus}</span>

      <div
        ref={navigatorRef}
        className="sessions-results"
        role="listbox"
        aria-label="Conversation results"
        aria-activedescendant={selectedDomId}
        tabIndex={0}
        onFocus={() => onFocusTargetChange("results")}
        onKeyDown={handleListKeyDown}
        onScroll={(event) => onStatePatch({ navigatorScrollTop: event.currentTarget.scrollTop })}
      >
        {projection.items.length === 0 && !loadingExternalSessions ? (
          <div className="sessions-navigator__empty">
            <strong>No conversations found.</strong>
            <span>Try another title, source, or time range.</span>
            {state.query && <button type="button" onClick={() => onStatePatch({ query: "", pageIndex: 0 })}>Clear search</button>}
          </div>
        ) : projection.items.map((session, index) => (
          <button
            type="button"
            role="option"
            id={optionDomId(index)}
            aria-selected={state.selectedSessionKey === session.sessionKey}
            className={index === activeIndex ? "sessions-result active" : "sessions-result"}
            key={session.sessionKey}
            tabIndex={-1}
            onClick={() => {
              onActiveSessionKeyChange(session.sessionKey);
              onSelectSession(session);
            }}
          >
            <span className="sessions-navigator__result-title"><strong>{session.title}</strong><time>{sessionAgeLabel(session.updatedAt)}</time></span>
            {session.snippet && <span>{session.snippet}</span>}
            <span className="sessions-navigator__result-meta">
              <b>{session.kind === "manual" ? "Manual" : session.kind === "claude" ? "Claude" : "Codex"}</b>
              <span>{session.branch ?? session.locationLabel}</span>
              {(session.delegatedRunCount ?? 0) > 0 && <em>{session.delegatedRunCount} delegated</em>}
            </span>
          </button>
        ))}
      </div>
      {state.selectedProjectId === "all" && projection.technicalRunCount > 0 && (
        <details className="sessions-navigator__maintenance">
          <summary>
            {projection.technicalRunCount} internal run{projection.technicalRunCount === 1 ? "" : "s"} hidden
          </summary>
          <p>These records could not be attached to a verified parent conversation.</p>
        </details>
      )}
      {(state.pageIndex > 0 || hasNextPage) && (
        <nav className="sessions-navigator__pagination" aria-label="Conversation result pages">
          <button type="button" disabled={state.pageIndex === 0} onClick={() => onStatePatch({ pageIndex: Math.max(0, state.pageIndex - 1), navigatorScrollTop: 0 })}>Previous</button>
          <span>Page {state.pageIndex + 1}</span>
          <button type="button" disabled={!hasNextPage} onClick={() => onStatePatch({ pageIndex: state.pageIndex + 1, navigatorScrollTop: 0 })}>Next</button>
        </nav>
      )}
    </aside>
  );
}

function optionDomId(index: number): string {
  return `sessions-option-${index}`;
}
