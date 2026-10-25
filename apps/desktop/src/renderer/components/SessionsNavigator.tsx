import { ChevronDown, RefreshCcw, Search } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import {
  SESSIONS_PAGE_SIZE,
  type SessionSummary,
  type SessionsProjectInput,
} from "../../shared/sessions-ipc";
import { historyKindLabel } from "../history-presentation";
import type { SessionsProjectionPage } from "../sessions-projection";
import { isFreeChatPath } from "../session-scope";
import type { SessionDisplayStatus } from "../session-status";
import type { SessionsViewState } from "../sessions-view-state";
import { historyDayGroup, sessionAgeShort, sessionDateTimeLabel, type HistoryDayGroup } from "../session-time";
import { moveTabFocus } from "../tab-keys";

const RESULTS_DOM_ID = "sessions-results";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

const SOURCE_TABS: ReadonlyArray<{ id: SessionsViewState["source"]; label: string }> = [
  { id: "all", label: "All" },
  { id: "managed", label: "From Alfred" },
  { id: "external-codex", label: "Codex CLI" },
  { id: "external-claude", label: "Claude Code" },
];

type SessionsNavigatorProps = {
  activeSessionKey: string | null;
  externalSessionsError: string | null;
  loadingExternalSessions: boolean;
  navigatorRef: RefObject<HTMLDivElement | null>;
  now: number;
  projection: SessionsProjectionPage;
  projectCounts: Record<string, number>;
  searchRef: RefObject<HTMLInputElement | null>;
  showControls: boolean;
  state: SessionsViewState;
  statusByKey: ReadonlyMap<string, SessionDisplayStatus>;
  workspaces: SessionsProjectInput[];
  onActiveSessionKeyChange: (sessionKey: string | null) => void;
  onRefreshExternalSessions: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onSelectProject: (projectId: string) => void;
  onFocusTargetChange: (target: "search" | "results") => void;
  onStatePatch: (patch: Partial<SessionsViewState>) => void;
};

/** The History list from the v4 canvas: search, source tabs, then one line per session, grouped by day. */
export function SessionsNavigator({
  activeSessionKey,
  externalSessionsError,
  loadingExternalSessions,
  navigatorRef,
  now,
  projection,
  projectCounts,
  searchRef,
  showControls,
  state,
  statusByKey,
  workspaces,
  onActiveSessionKeyChange,
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
  // A project is offered while it has sessions of its own; one rooted in the free chats folder only
  // while it is the scope the deck opened.
  const projectOptions = workspaces.filter((workspace) => (
    state.selectedProjectId === workspace.id
    || (!isFreeChatsWorkspace(workspace) && (projectCounts[workspace.id] ?? 0) > 0)
  ));
  // The list is sorted by time, so each day group is one run of rows. Indexes stay those of the flat list.
  const dayGroups: Array<{ label: HistoryDayGroup; rows: Array<{ session: SessionSummary; index: number }> }> = [];
  projection.items.forEach((session, index) => {
    const label = historyDayGroup(session.updatedAt, now);
    const current = dayGroups.at(-1);
    if (current?.label === label) current.rows.push({ session, index });
    else dayGroups.push({ label, rows: [{ session, index }] });
  });

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
    <aside className="sessions-navigator" aria-label="History">
      {showControls && (
        <>
          <label className="sessions-navigator__search">
            <Search aria-hidden="true" size={13} />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search sessions"
              placeholder="Search sessions"
              value={state.query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onStatePatch({ query: event.target.value, pageIndex: 0 })}
              onFocus={() => onFocusTargetChange("search")}
            />
          </label>
          <div className="sessions-navigator__filters">
            <div className="sessions-navigator__tabs text-tabs" role="tablist" aria-label="Source" onKeyDown={moveTabFocus}>
              {SOURCE_TABS.map((tab) => (
                <button
                  type="button"
                  role="tab"
                  key={tab.id}
                  aria-selected={state.source === tab.id}
                  aria-controls={RESULTS_DOM_ID}
                  tabIndex={state.source === tab.id ? 0 : -1}
                  onClick={() => onStatePatch({ source: tab.id, pageIndex: 0 })}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* The canvas reads "41 in Alfred": the count, then the project the list is scoped to. */}
            <div className="sessions-navigator__scope" role="group" aria-label="Session scope controls">
              <span aria-label="Session count" aria-live="polite" aria-atomic="true" role="status">{resultStatus}</span>
              <span aria-hidden="true">in</span>
              <label className="sessions-navigator__project">
                <select
                  aria-label="Project scope"
                  value={state.selectedProjectId}
                  onChange={(event) => onSelectProject(event.target.value)}
                >
                  <option value="all">all projects</option>
                  {projectOptions.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.label}</option>
                  ))}
                  <option value="free-chats">Free Chats</option>
                </select>
                <ChevronDown aria-hidden="true" size={11} />
              </label>
              <button
                type="button"
                aria-label="Refresh external sessions"
                title="Refresh Codex CLI sessions"
                disabled={loadingExternalSessions}
                onClick={onRefreshExternalSessions}
              >
                <RefreshCcw aria-hidden="true" size={12} />
              </button>
            </div>
          </div>
        </>
      )}

      {externalSessionsError && projection.items.length > 0 && (
        <p className="sessions-navigator__notice"><span>External sessions may be incomplete.</span><span>{externalSessionsError}</span></p>
      )}
      <div
        ref={navigatorRef}
        id={RESULTS_DOM_ID}
        className="sessions-results"
        role="listbox"
        aria-label="Session results"
        aria-activedescendant={selectedDomId}
        tabIndex={0}
        onFocus={() => onFocusTargetChange("results")}
        onKeyDown={handleListKeyDown}
        onScroll={(event) => onStatePatch({ navigatorScrollTop: event.currentTarget.scrollTop })}
      >
        {dayGroups.map((group) => (
          <div className="sessions-results__day" role="group" aria-label={group.label} key={group.label}>
            <div className="sessions-results__day-label" aria-hidden="true">{group.label}</div>
            {group.rows.map(({ session, index }) => {
              const status = statusByKey.get(session.sessionKey);
              return (
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
                  {status && <SessionStatusGlyph kind={status.kind} label={status.label} />}
                  <span className="sessions-result__title">{session.title}</span>
                  <span className="sessions-result__kind">{historyKindLabel(session)}</span>
                  <time
                    className="sessions-result__age"
                    dateTime={new Date(session.updatedAt).toISOString()}
                    title={sessionDateTimeLabel(session.updatedAt) ?? undefined}
                  >
                    {sessionAgeShort(session.updatedAt, now)}
                  </time>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {state.selectedProjectId === "all" && projection.technicalRunCount > 0 && (
        <details className="sessions-navigator__maintenance">
          <summary>
            {projection.technicalRunCount} internal run{projection.technicalRunCount === 1 ? "" : "s"} hidden
          </summary>
          <p>These records could not be attached to a verified parent session.</p>
        </details>
      )}
      {(state.pageIndex > 0 || hasNextPage) && (
        <nav className="sessions-navigator__pagination" aria-label="Session result pages">
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
