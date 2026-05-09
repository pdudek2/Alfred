import { Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SquadPlan } from "../alfred-state";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import type { WorkMode } from "../terminal-desk-types";
import type { WorkspaceAttention, WorkspaceReviewItem } from "../workspace-attention";
import type { AgentKind } from "../../shared/alfred-ipc";
import type { WorkspaceRailWorkspace } from "./WorkspaceRail";

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
  pendingPlan: SquadPlan | null;
  query: string;
  recoverableSessions: SessionTile[];
  reviewQueueCount: number;
  reviewQueuePreview: WorkspaceReviewItem | null;
  attention: WorkspaceAttention | null;
  safeStagedCount: number;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  shortcutModifier: string;
  unsafeStagedCount: number;
  workspaces: WorkspaceRailWorkspace[];
  canCloseWorkspace: boolean;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onAddWorkspace: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onApproveAll: () => void;
  onChangeQuery: (query: string) => void;
  onCloseRecoverableSessions: () => void;
  onClose: () => void;
  onCloseSession: (sessionId: string) => void;
  onCloseWorkspace: () => void;
  onContinueRecoverableSessions: () => void;
  onOpenWorkspaceFolder: () => void;
  onOpenWorkspaceTerminal: () => void;
  onRenameWorkspace: () => void;
  onFocusSession: (sessionId: string) => void;
  onFocusNextSession: () => void;
  onFocusPreviousSession: () => void;
  onOpenReviewQueue: () => void;
  onReviewAttention: () => void;
  onRejectAll: () => void;
  onRestartSession: (sessionId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleArrange: () => void;
};

export function CommandPalette({
  activeWorkspaceId,
  activeWorkMode,
  arrangeMode,
  pendingPlan,
  query,
  recoverableSessions,
  reviewQueueCount,
  reviewQueuePreview,
  attention,
  safeStagedCount,
  selectedSessionId,
  sessions,
  shortcutModifier,
  unsafeStagedCount,
  workspaces,
  canCloseWorkspace,
  onAddAgentSession,
  onAddManualSession,
  onAddWorkspace,
  onApplyWorkMode,
  onApproveAll,
  onChangeQuery,
  onCloseRecoverableSessions,
  onClose,
  onCloseSession,
  onCloseWorkspace,
  onContinueRecoverableSessions,
  onOpenWorkspaceFolder,
  onOpenWorkspaceTerminal,
  onRenameWorkspace,
  onFocusSession,
  onFocusNextSession,
  onFocusPreviousSession,
  onOpenReviewQueue,
  onReviewAttention,
  onRejectAll,
  onRestartSession,
  onSelectWorkspace,
  onToggleArrange,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef<string>(query);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
  const recoverableCount = recoverableSessions.length;

  const commands: CommandPaletteItem[] = useMemo(
    () => [
      {
        id: "new-terminal",
        label: "New manual terminal",
        detail: `${shortcutModifier} T · start a shell in this workspace`,
        run: onAddManualSession,
      },
      {
        id: "new-codex-session",
        label: "New Codex session",
        detail: "Start codex in this workspace",
        run: () => onAddAgentSession("codex"),
      },
      {
        id: "new-claude-session",
        label: "New Claude session",
        detail: "Start claude in this workspace",
        run: () => onAddAgentSession("claude"),
      },
      {
        id: "new-workspace",
        label: "New workspace from folder",
        detail: "Bind a project folder to Alfred",
        run: onAddWorkspace,
      },
      {
        id: "close-workspace",
        label: "Close current workspace",
        detail: canCloseWorkspace
          ? `Remove ${activeWorkspace?.label ?? "this workspace"} from the sidebar`
          : sessions.length > 0
            ? "Close sessions first"
            : activeWorkspaceId === "A"
              ? "Default workspace stays pinned"
              : "No workspace to close",
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
        detail: activeWorkspace?.rootPath ? shortenPath(activeWorkspace.rootPath) : "No folder bound to this workspace",
        disabled: !activeWorkspace?.rootPath,
        run: onOpenWorkspaceFolder,
      },
      {
        id: "open-workspace-terminal",
        label: "Open workspace in external terminal",
        detail: activeWorkspace?.rootPath
          ? `Open ${shortenPath(activeWorkspace.rootPath)} outside Alfred`
          : "No folder bound to this workspace",
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
      ...sessions.map((session) => ({
        id: `focus-session-${session.id}`,
        label: `Focus ${session.title}`,
        detail: `${sessionStatusLabel(session)} · ${shortenPath(session.cwd || "default workspace")}`,
        run: () => onFocusSession(session.id),
      })),
      {
        id: "open-review-queue",
        label: "Open review queue",
        detail: reviewQueuePreview
          ? `${reviewQueuePreview.workspaceLabel} · ${reviewQueuePreview.status.label} · ${reviewQueuePreview.session.title}`
          : "No queued decisions",
        disabled: reviewQueueCount === 0,
        run: onOpenReviewQueue,
      },
      {
        id: "review-attention",
        label: "Review attention",
        detail: attention
          ? `${attention.status.label} · ${attention.session.title} ${attention.detail}`
          : "No session needs review",
        disabled: attention === null,
        run: onReviewAttention,
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
        id: "relaunch-saved-sessions",
        label: "Relaunch saved sessions",
        detail: recoverableCount > 0
          ? `${recoverableCount} saved session${recoverableCount === 1 ? "" : "s"} in this workspace`
          : "No saved sessions in this workspace",
        disabled: recoverableCount === 0,
        run: onContinueRecoverableSessions,
      },
      {
        id: "dismiss-saved-sessions",
        label: "Dismiss saved sessions",
        detail: recoverableCount > 0
          ? `Remove ${recoverableCount} saved transcript${recoverableCount === 1 ? "" : "s"}`
          : "No saved sessions in this workspace",
        disabled: recoverableCount === 0,
        run: onCloseRecoverableSessions,
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
      {
        id: "launch-plan",
        label: unsafeStagedCount > 0 ? "Launch safe staged tiles" : "Launch staged plan",
        detail: pendingPlan
          ? `${safeStagedCount} launchable · ${unsafeStagedCount} need review`
          : "No Alfred plan staged",
        disabled: !pendingPlan || safeStagedCount === 0,
        run: onApproveAll,
      },
      {
        id: "clear-plan",
        label: "Clear staged plan",
        detail: pendingPlan ? "Reject Alfred's current proposal" : "No staged plan",
        disabled: !pendingPlan,
        run: onRejectAll,
      },
    ],
    [
      activeWorkMode,
      activeWorkspaceId,
      activeWorkspace,
      attention,
      arrangeMode,
      canCloseWorkspace,
      onAddAgentSession,
      onAddManualSession,
      onAddWorkspace,
      onApplyWorkMode,
      onApproveAll,
      onCloseSession,
      onCloseRecoverableSessions,
      onCloseWorkspace,
      onContinueRecoverableSessions,
      onOpenWorkspaceFolder,
      onOpenWorkspaceTerminal,
      onRenameWorkspace,
      onFocusSession,
      onFocusNextSession,
      onFocusPreviousSession,
      onOpenReviewQueue,
      onReviewAttention,
      onRejectAll,
      onRestartSession,
      onSelectWorkspace,
      onToggleArrange,
      pendingPlan,
      recoverableCount,
      reviewQueueCount,
      reviewQueuePreview,
      safeStagedCount,
      selectedRestartable,
      selectedSession,
      sessions,
      shortcutModifier,
      unsafeStagedCount,
      workspaces,
    ],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = filterCommands(commands, normalizedQuery);
  const enabledCommands = filteredCommands.filter((command) => !command.disabled);

  useEffect(() => {
    const activeStillVisible = filteredCommands.some((command) => command.id === activeCommandId && !command.disabled);
    if (activeStillVisible) return;
    setActiveCommandId(enabledCommands[0]?.id ?? null);
  }, [activeCommandId, enabledCommands, filteredCommands]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
          {filteredCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              className={command.id === activeCommandId ? "active" : ""}
              role="option"
              aria-selected={command.id === activeCommandId}
              disabled={command.disabled}
              onClick={() => runAndClose(command.run)}
              onMouseEnter={() => setActiveCommandId(command.id)}
            >
              <span>{command.label}</span>
              <small>{command.detail}</small>
            </button>
          ))}
          {filteredCommands.length === 0 && (
            <div className="command-palette-empty">No matching command.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function shortenPath(value: string): string {
  const parts = value.split("/");
  if (parts.length <= 3) return value;
  return `…/${parts.slice(-2).join("/")}`;
}

function sessionStatusLabel(session: SessionTile): string {
  return terminalSessionDisplayStatus(session).label;
}

function isRestartableSession(session: SessionTile): boolean {
  const status = terminalSessionDisplayStatus(session);
  return status.kind === "done" || status.kind === "error";
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
