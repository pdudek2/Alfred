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
import type { WorkMode } from "../terminal-desk-types";
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
  safeStagedCount: number;
  shortcutModifier: string;
  unsafeStagedCount: number;
  workspaces: WorkspaceRailWorkspace[];
  onAddManualSession: () => void;
  onAddWorkspace: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onApproveAll: () => void;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onRejectAll: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleArrange: () => void;
};

export function CommandPalette({
  activeWorkspaceId,
  activeWorkMode,
  arrangeMode,
  pendingPlan,
  query,
  safeStagedCount,
  shortcutModifier,
  unsafeStagedCount,
  workspaces,
  onAddManualSession,
  onAddWorkspace,
  onApplyWorkMode,
  onApproveAll,
  onChangeQuery,
  onClose,
  onRejectAll,
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

  const commands: CommandPaletteItem[] = useMemo(
    () => [
      {
        id: "new-terminal",
        label: "New manual terminal",
        detail: `${shortcutModifier} T · start a shell in this workspace`,
        run: onAddManualSession,
      },
      {
        id: "new-workspace",
        label: "New workspace from folder",
        detail: "Bind a project folder to Alfred",
        run: onAddWorkspace,
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
      arrangeMode,
      onAddManualSession,
      onAddWorkspace,
      onApplyWorkMode,
      onApproveAll,
      onRejectAll,
      onSelectWorkspace,
      onToggleArrange,
      pendingPlan,
      safeStagedCount,
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

function filterCommands(commands: CommandPaletteItem[], normalizedQuery: string): CommandPaletteItem[] {
  if (!normalizedQuery) return commands;

  const labelMatches = commands.filter((command) => command.label.toLowerCase().includes(normalizedQuery));
  const labelMatchIds = new Set(labelMatches.map((command) => command.id));
  const detailMatches = commands.filter(
    (command) => !labelMatchIds.has(command.id) && command.detail.toLowerCase().includes(normalizedQuery),
  );

  return [...labelMatches, ...detailMatches];
}
