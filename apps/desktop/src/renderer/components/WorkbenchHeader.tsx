import { ChevronDown, Command, Layers3, Plus } from "lucide-react";
import type { Ref } from "react";
import type { SessionTile } from "../session-state";
import { AlfredMark } from "./AlfredMark";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
import { ChromeMenu, type ChromeMenuItem } from "./ChromeMenu";

export type PrimarySurface = "work" | "sessions";

export type WorkbenchHeaderProps = {
  activeSurface: PrimarySurface;
  commandPaletteTriggerRef?: Ref<HTMLButtonElement>;
  needsYouCount: number;
  needsYouOpen: boolean;
  needsYouTriggerRef?: Ref<HTMLButtonElement>;
  newSessionTriggerRef?: Ref<HTMLButtonElement>;
  selectedSession: SessionTile | null;
  shortcutModifier: "Cmd" | "Ctrl";
  detailsTriggerRef?: Ref<HTMLButtonElement>;
  detailsOpen?: boolean;
  surfacesTriggerRef?: Ref<HTMLButtonElement>;
  workspaceDetail: string;
  onOpenCommandPalette: () => void;
  onOpenNewSession: () => void;
  onOpenPrivacyControls: () => void;
  onSelectSurface: (surface: PrimarySurface) => void;
  onToggleContext: () => void;
  onToggleNeedsYou: () => void;
};

export function WorkbenchHeader({
  activeSurface,
  commandPaletteTriggerRef,
  needsYouCount,
  needsYouOpen,
  needsYouTriggerRef,
  newSessionTriggerRef,
  selectedSession,
  shortcutModifier,
  detailsTriggerRef,
  detailsOpen = false,
  surfacesTriggerRef,
  workspaceDetail,
  onOpenCommandPalette,
  onOpenNewSession,
  onOpenPrivacyControls,
  onSelectSurface,
  onToggleContext,
  onToggleNeedsYou,
}: WorkbenchHeaderProps) {
  const surfaceTitle = activeSurface === "sessions" ? "History" : "Work";
  const surfaceDetail = activeSurface === "work" ? workspaceDetail : "Alfred";
  const surfaceItems: ChromeMenuItem[] = [
    { id: "work", label: "Work", run: () => onSelectSurface("work") },
    { id: "sessions", label: "History", run: () => onSelectSurface("sessions") },
    { id: "context", label: "Details", run: onToggleContext },
    { id: "privacy", label: "Local Data & Privacy", run: onOpenPrivacyControls },
  ];

  return (
    <header className="workbench-header" data-testid="workbench-header" data-chrome-height="44">
      <div className="workbench-primary-row">
        <div className="workbench-product-signature"><AlfredMark /></div>
        <div className="workbench-session-context">
          <div className="workbench-surface-menu">
            <ChromeMenu
              {...(surfacesTriggerRef ? { triggerRef: surfacesTriggerRef } : {})}
              label="Open Surfaces menu"
              title="Surfaces"
              items={surfaceItems}
            >
              <Layers3 aria-hidden="true" size={13} />
              <span>{surfaceTitle}</span>
              <ChevronDown aria-hidden="true" size={12} />
            </ChromeMenu>
          </div>
          {activeSurface === "work" && selectedSession && (
            <span className="workbench-session-title">{selectedSession.title}</span>
          )}
          <small className="workbench-context-detail">{surfaceDetail}</small>
          <button ref={newSessionTriggerRef} type="button" aria-label="New" aria-haspopup="dialog" onClick={onOpenNewSession}>
            <Plus aria-hidden="true" size={14} /><span>New</span><kbd>{shortcutModifier === "Cmd" ? "⌘N" : "Ctrl N"}</kbd>
          </button>
        </div>
        <div className="workbench-right-zone">
          <button ref={detailsTriggerRef} type="button" aria-label="Details" aria-expanded={detailsOpen}
            aria-keyshortcuts={shortcutModifier === "Cmd" ? "Meta+i" : "Control+i"}
            title={`Details (${shortcutModifier === "Cmd" ? "⌘I" : "Ctrl I"})`} onClick={onToggleContext}>
            <span>Details</span><kbd>{shortcutModifier === "Cmd" ? "⌘I" : "Ctrl I"}</kbd>
          </button>
          {needsYouCount > 0 && (
            <button
              ref={needsYouTriggerRef}
              type="button"
              className="workbench-needs-you"
              aria-label={`Needs you, ${needsYouCount} session${needsYouCount === 1 ? "" : "s"}`}
              aria-expanded={needsYouOpen}
              aria-haspopup="dialog"
              title={`Needs you (${shortcutModifier === "Cmd" ? "⌘J" : "Ctrl J"})`}
              onClick={onToggleNeedsYou}
            >
              <AlfredSignalGlyph />
              <span>{needsYouCount} {needsYouCount === 1 ? "needs" : "need"} you</span>
            </button>
          )}
          <button
            ref={commandPaletteTriggerRef}
            type="button"
            aria-label="Open command palette"
            title={shortcutModifier + " K"}
            onClick={onOpenCommandPalette}
          >
            <Command aria-hidden="true" size={14} />
            <kbd>{shortcutModifier === "Cmd" ? "⌘K" : "Ctrl K"}</kbd>
          </button>
        </div>
      </div>
    </header>
  );
}
