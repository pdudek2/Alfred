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

type CommandPaletteItem = {
  id: string;
  label: string;
  detail: string;
  disabled?: boolean;
  run: () => void;
};

type CommandPaletteProps = {
  activeWorkMode: WorkMode;
  arrangeMode: boolean;
  pendingPlan: SquadPlan | null;
  query: string;
  safeStagedCount: number;
  shortcutModifier: string;
  unsafeStagedCount: number;
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onApproveAll: () => void;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onRejectAll: () => void;
  onToggleArrange: () => void;
};

export function CommandPalette({
  activeWorkMode,
  arrangeMode,
  pendingPlan,
  query,
  safeStagedCount,
  shortcutModifier,
  unsafeStagedCount,
  onAddManualSession,
  onApplyWorkMode,
  onApproveAll,
  onChangeQuery,
  onClose,
  onRejectAll,
  onToggleArrange,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      arrangeMode,
      onAddManualSession,
      onApplyWorkMode,
      onApproveAll,
      onRejectAll,
      onToggleArrange,
      pendingPlan,
      safeStagedCount,
      shortcutModifier,
      unsafeStagedCount,
    ],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = normalizedQuery
    ? commands.filter((command) =>
        `${command.label} ${command.detail}`.toLowerCase().includes(normalizedQuery),
      )
    : commands;
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
      const command = enabledCommands.find((item) => item.id === activeCommandId);
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
            onChange={(event) => onChangeQuery(event.target.value)}
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
