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
import { terminalSessionDisplayStatus } from "../session-status";
import type { WorkMode } from "../terminal-desk-types";
import type { AttentionProjection } from "../attention-projection";
import type { AgentKind } from "../../shared/alfred-ipc";
import type { TerminalSessionIsolation } from "../../shared/terminal-ipc";
import type { ProjectNavigatorWorkspace } from "./ProjectNavigator";
import { shortenPath } from "../path-display";

type CommandPaletteItem = {
  id: string;
  label: string;
  detail: string;
  disabled?: boolean;
  run: () => void;
};

type CommandPaletteProps = {
  activeWorkspaceId: string;
  activeWorkMode: WorkMode;
  arrangeMode: boolean;
  allSessions: SessionTile[];
  query: string;
  reviewQueuePreview: AttentionProjection | null;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  shortcutModifier: string;
  workspaces: ProjectNavigatorWorkspace[];
  canCloseWorkspace: boolean;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">, isolation?: TerminalSessionIsolation) => void;
  onAddManualSession: () => void;
  onAddWorkspace: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
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
  onOpenInbox: () => void;
  onOpenPrivacyControls: () => void;
  onRestartSession: (sessionId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleArrange: () => void;
};

export function CommandPalette({
  activeWorkspaceId,
  activeWorkMode,
  arrangeMode,
  allSessions,
  query,
  reviewQueuePreview,
  selectedSessionId,
  sessions,
  shortcutModifier,
  workspaces,
  canCloseWorkspace,
  onAddAgentSession,
  onAddManualSession,
  onAddWorkspace,
  onApplyWorkMode,
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
  onOpenInbox,
  onOpenPrivacyControls,
  onRestartSession,
  onSelectWorkspace,
  onToggleArrange,
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
  const activeWorkspaceBound = Boolean(activeWorkspace?.rootPath);
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
        label: "New manual terminal",
        detail: activeWorkspace?.rootPath
          ? `${shortcutModifier} T · start a shell in this workspace`
          : `${shortcutModifier} T · start a shell in the scratch desk`,
        run: onAddManualSession,
      },
      {
        id: "new-codex-session",
        label: "New Codex session",
        detail: activeWorkspaceBound ? "Start Codex in this workspace" : "Start Codex in the scratch desk",
        run: () => onAddAgentSession("codex"),
      },
      {
        id: "new-claude-session",
        label: "New Claude session",
        detail: activeWorkspaceBound ? "Start Claude in this workspace" : "Start Claude in the scratch desk",
        run: () => onAddAgentSession("claude"),
      },
      {
        id: "new-codex-isolated-session",
        label: "New Codex isolated checkout",
        detail: activeWorkspaceBound
          ? "Create a temporary Git worktree for risky or parallel edits"
          : "Bind a workspace folder to create a temporary Git worktree for risky or parallel edits",
        disabled: !activeWorkspaceBound,
        run: () => onAddAgentSession("codex", "worktree"),
      },
      {
        id: "new-claude-isolated-session",
        label: "New Claude isolated checkout",
        detail: activeWorkspaceBound
          ? "Create a temporary Git worktree for risky or parallel edits"
          : "Bind a workspace folder to create a temporary Git worktree for risky or parallel edits",
        disabled: !activeWorkspaceBound,
        run: () => onAddAgentSession("claude", "worktree"),
      },
      {
        id: "new-workspace",
        label: "New scratch workspace",
        detail: "Create an empty desk without choosing a folder",
        run: onAddWorkspace,
      },
      {
        id: "close-workspace",
        label: "Close current workspace",
        detail: canCloseWorkspace
          ? `Remove ${activeWorkspace?.label ?? "this workspace"} from the sidebar`
          : sessions.length > 0
            ? "Available when every session is closed"
            : activeWorkspaceId === "A"
              ? "Pinned workspace"
              : "No workspace selected",
        disabled: !canCloseWorkspace,
        run: onCloseWorkspace,
      },
      {
        id: "rename-workspace",
        label: "Rename current workspace",
        detail: activeWorkspace ? `Current name: ${activeWorkspace.label}` : "No active workspace",
        disabled: !activeWorkspace,
        run: onRenameWorkspace,
      },
      {
        id: "reveal-workspace-folder",
        label: "Reveal workspace folder",
        detail: activeWorkspace?.rootPath ? shortenPath(activeWorkspace.rootPath) : "No folder bound",
        disabled: !activeWorkspace?.rootPath,
        run: onOpenWorkspaceFolder,
      },
      {
        id: "open-workspace-terminal",
        label: "Open workspace in external terminal",
        detail: activeWorkspace?.rootPath
          ? `Open ${shortenPath(activeWorkspace.rootPath)} outside Alfred`
          : "No folder bound",
        disabled: !activeWorkspace?.rootPath,
        run: onOpenWorkspaceTerminal,
      },
      ...workspaces.map((workspace) => ({
        id: `switch-workspace-${workspace.id}`,
        label: `Switch to ${workspace.label}`,
        detail:
          workspace.id === activeWorkspaceId
            ? "Current workspace"
            : workspace.gitBranch
              ? `${shortenPath(workspace.rootPath ?? "local desk")} · ${workspace.gitBranch}`
              : shortenPath(workspace.rootPath ?? "local desk"),
        run: () => onSelectWorkspace(workspace.id),
      })),
      ...searchableSessions.map((session) => {
        const workspace = workspaceById.get(session.workspaceId);
        const workspaceLabel = workspace?.label ?? `Workspace ${session.workspaceId}`;
        const location = session.branchName ?? session.cwd ?? workspace?.rootPath ?? "default workspace";
        return {
          id: `focus-session-${session.workspaceId}-${session.id}`,
          label: `Open ${session.title}`,
          detail: `${workspaceLabel} · ${sessionStatusLabel(session)} · ${shortenPath(location)}`,
          run: () => onFocusSessionInWorkspace(session.workspaceId, session.id),
        };
      }),
      {
        id: "local-data-privacy",
        label: "Local Data & Privacy",
        detail: "Saved scrollback, external Codex indexing, and local state",
        run: onOpenPrivacyControls,
      },
      {
        id: "open-context",
        label: "Open Context",
        detail: "Inspect the focused session",
        run: onOpenContext,
      },
      {
        id: "open-inbox",
        label: "Open Inbox",
        detail: reviewQueuePreview
          ? `${reviewQueuePreview.workspaceLabel} · ${reviewQueuePreview.sessionTitle}`
          : "No queued decisions",
        run: onOpenInbox,
      },
      {
        id: "close-selected-session",
        label: "Close focused session",
        detail: selectedSession
          ? `${shortcutModifier} W · ${selectedSession.title}`
          : "No focused session",
        disabled: !selectedSession,
        run: () => {
          if (selectedSession) onCloseSession(selectedSession.id);
        },
      },
      {
        id: "restart-selected-session",
        label: "Restart focused session",
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
        label: "Open focused session in external terminal",
        detail: selectedSession?.cwd
          ? `${shortcutModifier} Shift O · ${shortenPath(selectedSession.cwd)}`
          : "No focused session folder",
        disabled: !selectedSession?.cwd,
        run: () => {
          if (selectedSession?.cwd) onOpenSessionTerminal(selectedSession.cwd);
        },
      },
      {
        id: "reveal-focused-session-folder",
        label: "Reveal focused session folder",
        detail: selectedSession?.cwd ? shortenPath(selectedSession.cwd) : "No focused session folder",
        disabled: !selectedSession?.cwd,
        run: () => {
          if (selectedSession?.cwd) onOpenSessionFolder(selectedSession.cwd);
        },
      },
      {
        id: "copy-focused-session-cwd",
        label: "Copy focused session cwd",
        detail: selectedSession?.cwd ? selectedSession.cwd : "No focused session folder",
        disabled: !selectedSession?.cwd,
        run: () => {
          if (selectedSession?.cwd) onCopySessionCwd(selectedSession.cwd);
        },
      },
      {
        id: "next-session",
        label: "Next session",
        detail: `${shortcutModifier} Shift ] · move focus forward`,
        disabled: sessions.length < 2,
        run: onFocusNextSession,
      },
      {
        id: "previous-session",
        label: "Previous session",
        detail: `${shortcutModifier} Shift [ · move focus back`,
        disabled: sessions.length < 2,
        run: onFocusPreviousSession,
      },
      {
        id: "mode-focus",
        label: "Focus mode",
        detail: activeWorkMode === "focus" ? "Current mode" : "Full-width working stack",
        run: () => onApplyWorkMode("focus"),
      },
      {
        id: "mode-split",
        label: "Split mode",
        detail: activeWorkMode === "split" ? "Current mode" : "Two-up desk for paired work",
        run: () => onApplyWorkMode("split"),
      },
      {
        id: "mode-desk",
        label: "Desk mode",
        detail: activeWorkMode === "desk" ? "Current mode" : "Balanced multi-tile workspace",
        run: () => onApplyWorkMode("desk"),
      },
      {
        id: "arrange",
        label: arrangeMode ? "Exit arrange mode" : "Arrange tiles",
        detail: "Drag headers and resize corners",
        run: onToggleArrange,
      },
    ],
    [
      activeWorkMode,
      activeWorkspaceId,
      activeWorkspace,
      activeWorkspaceBound,
      arrangeMode,
      canCloseWorkspace,
      onAddAgentSession,
      onAddManualSession,
      onAddWorkspace,
      onApplyWorkMode,
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
      onOpenInbox,
      onOpenPrivacyControls,
      onRestartSession,
      onSelectWorkspace,
      onToggleArrange,
      reviewQueuePreview,
      selectedRestartable,
      selectedSession,
      sessions,
      shortcutModifier,
      searchableSessions,
      workspaceById,
      workspaces,
    ],
  );
  const filteredCommands = filterCommands(commands, normalizedQuery);
  const enabledCommands = filteredCommands.filter((command) => !command.disabled);
  const paletteRows = groupPaletteCommands(filteredCommands);

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
      const nextIndex = (currentIndex + delta + enabledCommands.length) % enabledCommands.length;
      setActiveCommandId(enabledCommands[nextIndex]?.id ?? null);
      return;
    }

    if (event.key === "Enter") {
      const currentCommands = filterCommands(commands, queryRef.current.trim().toLowerCase());
      const currentEnabledCommands = currentCommands.filter((item) => !item.disabled);
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
                onClick={() => runAndClose(row.command.run)}
                onMouseEnter={() => setActiveCommandId(row.command.id)}
              >
                <span>{row.command.label}</span>
                <small>{row.command.detail}</small>
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

function sessionStatusLabel(session: SessionTile): string {
  return terminalSessionDisplayStatus(session).label;
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
  const status = terminalSessionDisplayStatus(session);
  return status.kind === "done" || status.kind === "error";
}

function trapDialogFocus(event: ReactKeyboardEvent, panel: HTMLElement | null): void {
  if (!panel) return;
  const focusable = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );

  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function filterCommands(commands: CommandPaletteItem[], normalizedQuery: string): CommandPaletteItem[] {
  if (!normalizedQuery) return commands;

  const labelMatches = commands.filter((command) => command.label.toLowerCase().includes(normalizedQuery));
  const labelMatchIds = new Set(labelMatches.map((command) => command.id));
  const detailMatches = commands.filter(
    (command) => !labelMatchIds.has(command.id) && command.detail.toLowerCase().includes(normalizedQuery),
  );

  return [...labelMatches, ...detailMatches];
}

type CommandPaletteRow =
  | { type: "group"; id: string; label: string }
  | { type: "command"; command: CommandPaletteItem };

function groupPaletteCommands(commands: CommandPaletteItem[]): CommandPaletteRow[] {
  const rows: CommandPaletteRow[] = [];
  const groupOrder = ["Launch", "Workspaces", "Review and recovery", "Focused session", "Desk layout", "Commands"];

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
    commandId === "open-inbox"
  ) {
    return "Review and recovery";
  }

  if (
    commandId.includes("workspace") ||
    commandId.startsWith("switch-workspace")
  ) {
    return "Workspaces";
  }

  if (
    commandId === "new-terminal" ||
    commandId === "new-codex-session" ||
    commandId === "new-claude-session" ||
    commandId === "new-codex-isolated-session" ||
    commandId === "new-claude-isolated-session"
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

  if (commandId.startsWith("mode-") || commandId === "arrange") {
    return "Desk layout";
  }

  return "Commands";
}
