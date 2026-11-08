import { Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SessionTile } from "../session-state";
import { isRestartable, sessionState } from "../session-status";
import type { AttentionProjection } from "../attention-projection";
import type { AgentKind } from "../../shared/alfred-ipc";
import type { ProjectNavigatorWorkspace } from "./ProjectNavigator";
import { shortenPath } from "../path-display";
import { externalTerminalApp } from "./WorkspaceActionsMenu";
import { trapDialogFocus } from "../dialog-focus";

type CommandPaletteItem = {
  id: string;
  label: string;
  /** Only what the label does not already say: a reason, a path, a state. */
  detail?: string;
  /** The key that runs it outside the palette, shown as quiet text beside the label. */
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};

/** "⌘⇧]" on a Mac, "Ctrl Shift ]" elsewhere, as the app labels its other shortcuts. */
function shortcutKey(modifier: string, keys: string): string {
  return modifier === "Cmd" ? `⌘${keys.replace("Shift ", "⇧")}` : `Ctrl ${keys}`;
}

type CommandPaletteProps = {
  activeWorkspaceId: string;
  allSessions: SessionTile[];
  now: number;
  pinnedSessionId: string | null;
  query: string;
  reviewQueuePreview: AttentionProjection | null;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  shortcutModifier: string;
  workspaces: ProjectNavigatorWorkspace[];
  canCloseWorkspace: boolean;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onOpenPlan?: (() => void) | undefined;
  onAddWorkspace: () => void;
  /** Adds a project from a folder you pick. */
  onAddProject: () => void;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onCloseSession: (sessionId: string) => void;
  onCloseWorkspace: () => void;
  onCopySessionCwd: (cwd: string) => void;
  onOpenWorkspaceFolder: () => void;
  onOpenWorkspaceTerminal: () => void;
  onOpenSessionFolder: (cwd: string) => void;
  onOpenSessionTerminal: (cwd: string) => void;
  onRenameWorkspace: () => void;
  onFocusSessionInWorkspace: (workspaceId: string, sessionId: string) => void;
  onFocusNextSession: () => void;
  onFocusPreviousSession: () => void;
  onOpenContext: () => void;
  onOpenNeedsYou: () => void;
  onOpenSettings: () => void;
  onPinSession: (sessionId: string | null) => void;
  onRestartSession: (sessionId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

export function CommandPalette({
  activeWorkspaceId,
  allSessions,
  now,
  pinnedSessionId,
  query,
  reviewQueuePreview,
  selectedSessionId,
  sessions,
  shortcutModifier,
  workspaces,
  canCloseWorkspace,
  onAddAgentSession,
  onAddManualSession,
  onOpenPlan,
  onAddWorkspace,
  onAddProject,
  onChangeQuery,
  onClose,
  onCloseSession,
  onCloseWorkspace,
  onCopySessionCwd,
  onOpenWorkspaceFolder,
  onOpenWorkspaceTerminal,
  onOpenSessionFolder,
  onOpenSessionTerminal,
  onRenameWorkspace,
  onFocusSessionInWorkspace,
  onFocusNextSession,
  onFocusPreviousSession,
  onOpenContext,
  onOpenNeedsYou,
  onOpenSettings,
  onPinSession,
  onRestartSession,
  onSelectWorkspace,
}: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef<string>(query);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInput = () => inputRef.current?.focus();

    focusInput();
    const frame = window.requestAnimationFrame(focusInput);

    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const runAndClose = useCallback((run: () => void) => {
    run();
    onClose();
  }, [onClose]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
  const selectedRestartable = selectedSession ? isRestartableSession(selectedSession) : false;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeWorkspaceAvailable = activeWorkspace?.rootStatus !== "missing";
  const launchBlocked = activeWorkspaceAvailable ? undefined : "Choose the project folder first";
  const normalizedQuery = query.trim().toLowerCase();
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const activeSearchableSessions = useMemo(
    () => [...sessions].sort((a, b) => compareSessionsForPalette(a, b, activeWorkspaceId)),
    [activeWorkspaceId, sessions],
  );
  const globalSearchableSessions = useMemo(
    () => [...allSessions].sort((a, b) => compareSessionsForPalette(a, b, activeWorkspaceId)),
    [activeWorkspaceId, allSessions],
  );
  const searchableSessions = normalizedQuery ? globalSearchableSessions : activeSearchableSessions;

  const commands: CommandPaletteItem[] = useMemo(
    () => [
      {
        id: "new-terminal",
        label: "New terminal",
        ...(launchBlocked && { detail: launchBlocked }),
        ...(activeWorkspaceAvailable ? { shortcut: shortcutKey(shortcutModifier, "T") } : {}),
        disabled: !activeWorkspaceAvailable,
        run: onAddManualSession,
      },
      {
        id: "new-codex-session",
        label: "New Codex session",
        ...(launchBlocked && { detail: launchBlocked }),
        disabled: !activeWorkspaceAvailable,
        run: () => onAddAgentSession("codex"),
      },
      {
        id: "new-claude-session",
        label: "New Claude session",
        ...(launchBlocked && { detail: launchBlocked }),
        disabled: !activeWorkspaceAvailable,
        run: () => onAddAgentSession("claude"),
      },
      ...(onOpenPlan ? [{ id: "new-plan", label: "Plan with Alfred", run: onOpenPlan }] : []),
      {
        id: "add-project",
        label: "Add project…",
        run: onAddProject,
      },
      {
        id: "new-workspace",
        label: "New scratch project",
        detail: "Without a folder",
        run: onAddWorkspace,
      },
      {
        id: "close-workspace",
        label: "Close current project",
        detail: canCloseWorkspace
          ? `Remove ${activeWorkspace?.label ?? "this project"} from the sidebar`
          : activeWorkspaceId === "A"
            ? "Pinned project"
            : sessions.length > 0
              ? "Close its running sessions first"
              : "No project selected",
        disabled: !canCloseWorkspace,
        run: onCloseWorkspace,
      },
      {
        id: "rename-workspace",
        label: "Rename current project",
        detail: activeWorkspace ? `Current name: ${activeWorkspace.label}` : "No active project",
        disabled: !activeWorkspace,
        run: onRenameWorkspace,
      },
      {
        id: "reveal-workspace-folder",
        label: "Show project in Finder",
        detail: activeWorkspace?.rootPath ? shortenPath(activeWorkspace.rootPath) : "No folder bound",
        disabled: !activeWorkspace?.rootPath,
        run: onOpenWorkspaceFolder,
      },
      {
        id: "open-workspace-terminal",
        label: `Open project in ${externalTerminalApp()}`,
        detail: activeWorkspace?.rootPath ? shortenPath(activeWorkspace.rootPath) : "No folder bound",
        disabled: !activeWorkspace?.rootPath,
        run: onOpenWorkspaceTerminal,
      },
      ...workspaces.map((workspace) => ({
        id: `switch-workspace-${workspace.id}`,
        label: `Switch to ${workspace.label}`,
        detail:
          workspace.id === activeWorkspaceId
            ? "Current project"
            : workspace.gitBranch
              ? `${shortenPath(workspace.rootPath ?? "local project")} on ${workspace.gitBranch}`
              : shortenPath(workspace.rootPath ?? "local project"),
        run: () => onSelectWorkspace(workspace.id),
      })),
      ...searchableSessions.map((session) => {
        const workspace = workspaceById.get(session.workspaceId);
        const workspaceLabel = workspace?.label ?? `Project ${session.workspaceId}`;
        const location = session.cwd ?? workspace?.rootPath ?? "default project";
        return {
          id: `focus-session-${session.workspaceId}-${session.id}`,
          label: `Open ${session.title}`,
          detail: `${sessionStatusLabel(session, now)} in ${workspaceLabel}, ${shortenPath(location)}`,
          run: () => onFocusSessionInWorkspace(session.workspaceId, session.id),
        };
      }),
      // Pinning is found by typing; listing it for every session would double the default list.
      ...(normalizedQuery ? sessions : [])
        .filter((session) => session.stage === "live" && session.id !== selectedSessionId && session.id !== pinnedSessionId)
        .map((session) => ({
          id: `pin-session-${session.id}`,
          label: `Pin ${session.title} under the focus`,
          run: () => onPinSession(session.id),
        })),
      ...sessions.filter((session) => session.id === pinnedSessionId).map((session) => ({
        id: `unpin-session-${session.id}`,
        label: `Unpin ${session.title}`,
        run: () => onPinSession(null),
      })),
      {
        id: "open-settings",
        label: "Settings",
        detail: "Local Data & Privacy",
        run: onOpenSettings,
      },
      {
        id: "open-context",
        label: "Details",
        run: onOpenContext,
      },
      {
        id: "open-needs-you",
        label: "Open Needs you",
        detail: reviewQueuePreview
          ? `${reviewQueuePreview.sessionTitle} in ${reviewQueuePreview.workspaceLabel}`
          : "No queued decisions",
        run: onOpenNeedsYou,
      },
      {
        id: "close-selected-session",
        label: "Close focused session",
        detail: selectedSession ? selectedSession.title : "No focused session",
        ...(selectedSession ? { shortcut: shortcutKey(shortcutModifier, "W") } : {}),
        disabled: !selectedSession,
        run: () => {
          if (selectedSession) onCloseSession(selectedSession.id);
        },
      },
      {
        id: "restart-selected-session",
        label: "Resume focused session",
        detail: selectedSession
          ? selectedRestartable
            ? selectedSession.title
            : "Available after a session exits or errors"
          : "No focused session",
        disabled: !selectedSession || !selectedRestartable,
        run: () => {
          if (selectedSession && selectedRestartable) onRestartSession(selectedSession.id);
        },
      },
      {
        id: "open-focused-session-terminal",
        label: `Open focused session in ${externalTerminalApp()}`,
        detail: selectedSession?.cwd ? shortenPath(selectedSession.cwd) : "No focused session folder",
        ...(selectedSession?.cwd ? { shortcut: shortcutKey(shortcutModifier, "Shift O") } : {}),
        disabled: !selectedSession?.cwd,
        run: () => {
          if (selectedSession?.cwd) onOpenSessionTerminal(selectedSession.cwd);
        },
      },
      {
        id: "reveal-focused-session-folder",
        label: "Show focused session in Finder",
        detail: selectedSession?.cwd ? shortenPath(selectedSession.cwd) : "No focused session folder",
        disabled: !selectedSession?.cwd,
        run: () => {
          if (selectedSession?.cwd) onOpenSessionFolder(selectedSession.cwd);
        },
      },
      {
        id: "copy-focused-session-cwd",
        label: "Copy focused session path",
        detail: selectedSession?.cwd ? selectedSession.cwd : "No focused session folder",
        disabled: !selectedSession?.cwd,
        run: () => {
          if (selectedSession?.cwd) onCopySessionCwd(selectedSession.cwd);
        },
      },
      {
        id: "next-session",
        label: "Next session",
        shortcut: shortcutKey(shortcutModifier, "Shift ]"),
        disabled: sessions.length < 2,
        run: onFocusNextSession,
      },
      {
        id: "previous-session",
        label: "Previous session",
        shortcut: shortcutKey(shortcutModifier, "Shift ["),
        disabled: sessions.length < 2,
        run: onFocusPreviousSession,
      },
    ],
    [
      activeWorkspaceId,
      activeWorkspace,
      activeWorkspaceAvailable,
      launchBlocked,
      canCloseWorkspace,
      now,
      onAddAgentSession,
      onAddManualSession,
      onOpenPlan,
      onAddWorkspace,
      onAddProject,
      onCloseSession,
      onCloseWorkspace,
      onCopySessionCwd,
      onOpenWorkspaceFolder,
      onOpenWorkspaceTerminal,
      onOpenSessionFolder,
      onOpenSessionTerminal,
      onRenameWorkspace,
      onFocusSessionInWorkspace,
      onFocusNextSession,
      onFocusPreviousSession,
      onOpenContext,
      onOpenNeedsYou,
      onOpenSettings,
      onPinSession,
      onRestartSession,
      onSelectWorkspace,
      normalizedQuery,
      pinnedSessionId,
      reviewQueuePreview,
      selectedRestartable,
      selectedSession,
      selectedSessionId,
      sessions,
      shortcutModifier,
      searchableSessions,
      workspaceById,
      workspaces,
    ],
  );
  const filteredCommands = filterCommands(commands, normalizedQuery);
  const paletteRows = groupPaletteCommands(filteredCommands, normalizedQuery !== "");
  // The rows in the order they are drawn, which the arrows walk and Enter falls back to.
  const enabledCommands = enabledRows(paletteRows);

  useEffect(() => {
    const activeStillVisible = filteredCommands.some((command) => command.id === activeCommandId && !command.disabled);
    if (activeStillVisible) return;
    setActiveCommandId(enabledCommands[0]?.id ?? null);
  }, [activeCommandId, enabledCommands, filteredCommands]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, panelRef.current);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (enabledCommands.length === 0) return;
      const currentIndex = Math.max(
        0,
        enabledCommands.findIndex((command) => command.id === activeCommandId),
      );
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextId = enabledCommands[(currentIndex + delta + enabledCommands.length) % enabledCommands.length]?.id ?? null;
      setActiveCommandId(nextId);
      if (nextId) panelRef.current?.querySelector(`[data-command-id="${CSS.escape(nextId)}"]`)?.scrollIntoView?.({ block: "nearest" });
      return;
    }

    // A focused row runs itself, as any button does.
    if (event.key === "Enter" && event.target === inputRef.current) {
      const currentQuery = queryRef.current.trim().toLowerCase();
      const currentEnabledCommands = enabledRows(groupPaletteCommands(filterCommands(commands, currentQuery), currentQuery !== ""));
      const command =
        currentEnabledCommands.find((item) => item.id === activeCommandId) ?? currentEnabledCommands[0];
      if (!command) return;
      event.preventDefault();
      runAndClose(command.run);
    }
  };

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Type a command..."
            aria-label="Search commands"
            onChange={(event) => {
              queryRef.current = event.target.value;
              onChangeQuery(event.target.value);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="command-palette-list" role="listbox" aria-label="Commands">
          {paletteRows.map((row) =>
            row.type === "group" ? (
              <div className="command-palette-group" key={row.id} role="presentation">
                {row.label}
              </div>
            ) : (
              <button
                key={row.command.id}
                type="button"
                className={row.command.id === activeCommandId ? "active" : ""}
                role="option"
                aria-selected={row.command.id === activeCommandId}
                disabled={row.command.disabled}
                data-command-id={row.command.id}
                onClick={() => runAndClose(row.command.run)}
                onFocus={() => setActiveCommandId(row.command.id)}
                // Move, not enter: a list scrolling under a resting pointer must not take the highlight.
                onMouseMove={() => setActiveCommandId(row.command.id)}
              >
                <span>{row.command.label}</span>
                {row.command.detail && <small>{row.command.detail}</small>}
                {row.command.shortcut && <kbd className="command-palette-shortcut">{row.command.shortcut}</kbd>}
              </button>
            ),
          )}
          {filteredCommands.length === 0 && (
            <div className="command-palette-empty" role="status">No matching command.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function sessionStatusLabel(session: SessionTile, now: number): string {
  return sessionState(session, "ready", now).label;
}

function compareSessionsForPalette(a: SessionTile, b: SessionTile, activeWorkspaceId: string): number {
  const aWorkspaceBias = a.workspaceId === activeWorkspaceId ? 0 : 1;
  const bWorkspaceBias = b.workspaceId === activeWorkspaceId ? 0 : 1;
  if (aWorkspaceBias !== bWorkspaceBias) return aWorkspaceBias - bWorkspaceBias;

  const aActivity = a.lastActivityAt ?? a.lastOutputAt ?? a.createdAt ?? 0;
  const bActivity = b.lastActivityAt ?? b.lastOutputAt ?? b.createdAt ?? 0;
  return bActivity - aActivity;
}

function isRestartableSession(session: SessionTile): boolean {
  return isRestartable(sessionState(session), session.runtimeStatus);
}

function filterCommands(commands: CommandPaletteItem[], normalizedQuery: string): CommandPaletteItem[] {
  if (!normalizedQuery) return commands;

  const labelMatches = commands.filter((command) => command.label.toLowerCase().includes(normalizedQuery));
  const labelMatchIds = new Set(labelMatches.map((command) => command.id));
  const detailMatches = commands.filter(
    (command) => !labelMatchIds.has(command.id) && Boolean(command.detail?.toLowerCase().includes(normalizedQuery)),
  );

  return [...labelMatches, ...detailMatches];
}

type CommandPaletteRow =
  | { type: "group"; id: string; label: string }
  | { type: "command"; command: CommandPaletteItem };

function enabledRows(rows: CommandPaletteRow[]): CommandPaletteItem[] {
  return rows.flatMap((row) => row.type === "command" && !row.command.disabled ? [row.command] : []);
}

/** Without a query the groups keep a fixed order; with one, the group of the best match comes first. */
function groupPaletteCommands(commands: CommandPaletteItem[], ranked: boolean): CommandPaletteRow[] {
  const rows: CommandPaletteRow[] = [];
  const groupOrder = ranked
    ? [...new Set(commands.map((command) => commandGroupLabel(command.id)))]
    : ["Launch", "Projects", "Review and resume", "Focused session", "Layout", "Commands"];

  for (const group of groupOrder) {
    const groupCommands = commands.filter((command) => commandGroupLabel(command.id) === group);
    if (groupCommands.length > 0) {
      rows.push({
        type: "group",
        id: `group-${rows.length}-${group.toLowerCase().replace(/\W+/g, "-")}`,
        label: group,
      });
      rows.push(...groupCommands.map((command) => ({ type: "command" as const, command })));
    }
  }

  return rows;
}

function commandGroupLabel(commandId: string): string {
  if (
    commandId.includes("review") ||
    commandId === "open-needs-you"
  ) {
    return "Review and resume";
  }

  if (
    commandId.includes("workspace") ||
    commandId.startsWith("switch-workspace")
  ) {
    return "Projects";
  }

  if (
    commandId === "new-terminal" ||
    commandId === "new-codex-session" ||
    commandId === "new-claude-session"
  ) {
    return "Launch";
  }

  if (
    commandId.includes("selected-session") ||
    commandId.includes("focused-session") ||
    commandId === "next-session" ||
    commandId === "previous-session"
  ) {
    return "Focused session";
  }

  return "Commands";
}
