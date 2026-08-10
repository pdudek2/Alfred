import { ChevronLeft, RefreshCcw, Search } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import {
  SESSIONS_PAGE_SIZE,
  type SessionSummary,
  type SessionsProjectInput,
} from "../../shared/sessions-ipc";
import type { SessionsProjectionPage } from "../sessions-projection";
import { isFreeChatPath } from "../session-scope";
import type { SessionsViewState } from "../sessions-view-state";
import { sessionAgeLabel } from "../session-time";

type SessionsNavigatorProps = {
  activeSessionKey: string | null;
  externalSessionIndexingEnabled: boolean;
  externalSessionsError: string | null;
  loadingExternalSessions: boolean;
  navigatorRef: RefObject<HTMLDivElement | null>;
  projection: SessionsProjectionPage;
  projectCounts: Record<string, number>;
  searchRef: RefObject<HTMLInputElement | null>;
  showControls: boolean;
  state: SessionsViewState;
  workspaces: SessionsProjectInput[];
  onActiveSessionKeyChange: (sessionKey: string | null) => void;
  onBackToWork: () => void;
  onOpenPrivacySettings: (() => void) | undefined;
  onRefreshExternalSessions: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onSelectProject: (projectId: string) => void;
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
  projectCounts,
  searchRef,
  showControls,
  state,
  workspaces,
  onActiveSessionKeyChange,
  onBackToWork,
  onOpenPrivacySettings,
  onRefreshExternalSessions,
  onSelectSession,
  onSelectProject,
  onFocusTargetChange,
  onStatePatch,
}: SessionsNavigatorProps) {
  const activeIndex = Math.max(0, projection.items.findIndex((item) => item.sessionKey === activeSessionKey));
  const selectedDomId = projection.items.length > 0 ? optionDomId(activeIndex) : undefined;
  const resultStatus = loadingExternalSessions && projection.items.length === 0
    ? "…"
    : externalSessionsError && projection.items.length === 0
      ? "—"
    : String(projection.total);
  const hasNextPage = (state.pageIndex + 1) * SESSIONS_PAGE_SIZE < projection.total;
  const projectOptions = workspaces.filter((workspace) => (
    (!isFreeChatsWorkspace(workspace) || (state.source === "saved" && state.selectedProjectId === workspace.id))
    && ((projectCounts[workspace.id] ?? 0) > 0 || state.selectedProjectId === workspace.id)
  ));

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
        <button type="button" aria-label="Back to Work" onClick={onBackToWork}>
          <ChevronLeft aria-hidden="true" size={15} />
        </button>
        <strong>Conversations</strong>
        <span aria-hidden="true">/</span>
        <select
          aria-label="Project scope"
          value={state.selectedProjectId}
          onChange={(event) => onSelectProject(event.target.value)}
        >
          <option value="all">All projects</option>
          {projectOptions.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.label}</option>
          ))}
          <option value="free-chats">Free Chats</option>
        </select>
        <span
          aria-label="Conversation count"
          aria-live="polite"
          aria-atomic="true"
          role="status"
        >{resultStatus}</span>
      </header>
      {showControls && (
        <>
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
            <label>
              <span className="visually-hidden">Session source</span>
              <select
                aria-label="Session source"
                value={state.source}
                onChange={(event) => onStatePatch({
                  source: event.target.value as SessionsViewState["source"],
                  pageIndex: 0,
                })}
              >
                <option value="all">All sources</option>
                <option value="managed">Managed</option>
                <option value="saved">Saved</option>
                <option value="external-codex">Codex</option>
              </select>
            </label>
            <label>
              <span className="visually-hidden">Session time range</span>
              <select
                aria-label="Session time range"
                value={state.timeRange}
                onChange={(event) => onStatePatch({
                  timeRange: event.target.value as SessionsViewState["timeRange"],
                  pageIndex: 0,
                })}
              >
                <option value="any">Any time</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
            <button
              type="button"
              aria-label="Refresh external sessions"
              disabled={!externalSessionIndexingEnabled || loadingExternalSessions}
              onClick={onRefreshExternalSessions}
            >
              <RefreshCcw aria-hidden="true" size={14} />
            </button>
          </div>
        </>
      )}

      {!externalSessionIndexingEnabled && projection.items.length > 0 && (
        <p className="sessions-navigator__notice">
          <strong>External Codex indexing is off.</strong>
          {onOpenPrivacySettings && <button type="button" onClick={onOpenPrivacySettings}>Open Local Data &amp; Privacy</button>}
        </p>
      )}
      {externalSessionIndexingEnabled && externalSessionsError && projection.items.length > 0 && (
        <p className="sessions-navigator__notice"><strong>External sessions may be incomplete.</strong><span>{externalSessionsError}</span></p>
      )}
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
        {projection.items.map((session, index) => (
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

function isFreeChatsWorkspace(workspace: SessionsProjectInput): boolean {
  return isFreeChatPath(workspace.rootPath ?? "");
}
