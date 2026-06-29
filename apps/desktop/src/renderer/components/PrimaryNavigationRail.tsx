import { Clock3, Command, Inbox, ListChecks, ShieldCheck } from "lucide-react";
import type { Ref } from "react";

export type PrimarySurface = "work" | "inbox" | "history";

type PrimaryNavigationRailProps = {
  activeSurface: PrimarySurface;
  contextOpen: boolean;
  inboxCount: number;
  contextSignalCount: number;
  shortcutModifier: string;
  commandPaletteTriggerRef?: Ref<HTMLButtonElement>;
  onOpenCommandPalette: () => void;
  onOpenPrivacyControls: () => void;
  onToggleContext: () => void;
  onSelectSurface: (surface: PrimarySurface) => void;
};

export function PrimaryNavigationRail({
  activeSurface,
  contextOpen,
  inboxCount,
  contextSignalCount,
  shortcutModifier,
  commandPaletteTriggerRef,
  onOpenCommandPalette,
  onOpenPrivacyControls,
  onToggleContext,
  onSelectSurface,
}: PrimaryNavigationRailProps) {
  return (
    <nav className="primary-nav-rail" data-testid="primary-nav-rail" aria-label="Primary navigation">
      <div className="primary-nav-brand" aria-hidden="true">
        A
      </div>
      <div className="primary-nav-stack">
        <button
          type="button"
          className={activeSurface === "work" ? "active" : ""}
          aria-label="Open Work surface"
          aria-current={activeSurface === "work" ? "page" : undefined}
          onClick={() => onSelectSurface("work")}
        >
          <ListChecks size={18} />
        </button>
        <button
          type="button"
          className={activeSurface === "inbox" ? "active" : ""}
          aria-label={`Open Inbox surface${inboxCount > 0 ? `, ${inboxCount} items` : ""}`}
          aria-current={activeSurface === "inbox" ? "page" : undefined}
          onClick={() => onSelectSurface("inbox")}
        >
          <Inbox size={18} />
          {inboxCount > 0 && <span>{inboxCount}</span>}
        </button>
        <button
          type="button"
          className={activeSurface === "history" ? "active" : ""}
          aria-label="Open History surface"
          aria-current={activeSurface === "history" ? "page" : undefined}
          onClick={() => onSelectSurface("history")}
        >
          <Clock3 size={18} />
        </button>
      </div>
      <div className="primary-nav-stack primary-nav-bottom">
        <button
          type="button"
          aria-label={
            contextOpen
              ? "Close Context drawer"
              : `Open Context drawer${contextSignalCount > 0 ? `, ${contextSignalCount} important signal${contextSignalCount === 1 ? "" : "s"}` : ""}`
          }
          aria-expanded={contextOpen}
          onClick={onToggleContext}
        >
          <ShieldCheck size={18} />
          {contextSignalCount > 0 && <span>{contextSignalCount}</span>}
        </button>
        <button
          ref={commandPaletteTriggerRef}
          type="button"
          aria-label="Open command palette"
          title={`${shortcutModifier} K`}
          onClick={onOpenCommandPalette}
        >
          <Command size={18} />
        </button>
        <button type="button" aria-label="Open Local Data & Privacy" onClick={onOpenPrivacyControls}>
          <ShieldCheck size={18} />
        </button>
      </div>
    </nav>
  );
}
