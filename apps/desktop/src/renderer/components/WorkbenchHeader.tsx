import { ChevronRight, Plus, Search } from "lucide-react";
import type { Ref } from "react";
import type { HistorySelection } from "../history-presentation";
import type { SessionTile } from "../session-state";
import { sessionState } from "../session-status";
import { moveTabFocus, SESSION_VIEW_IDS } from "../tab-keys";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

export type PrimarySurface = "work" | "sessions";

export type WorkbenchHeaderProps = {
  activeSurface: PrimarySurface;
  commandPaletteTriggerRef?: Ref<HTMLButtonElement>;
  /** The session open in History's reader; it follows "History" in the breadcrumb. */
  historySelection?: HistorySelection | null;
  needsYouCount: number;
  needsYouOpen: boolean;
  needsYouTriggerRef?: Ref<HTMLButtonElement>;
  newSessionTriggerRef?: Ref<HTMLButtonElement>;
  now: number;
  previewAvailable: boolean;
  previewOpen: boolean;
  projectDetail: string;
  projectLabel: string;
  selectedSession: SessionTile | null;
  shortcutModifier: "Cmd" | "Ctrl";
  onOpenCommandPalette: () => void;
  onOpenNewSession: () => void;
  onToggleNeedsYou: () => void;
  onTogglePreview: () => void;
};

export function WorkbenchHeader({
  activeSurface,
  commandPaletteTriggerRef,
  historySelection = null,
  needsYouCount,
  needsYouOpen,
  needsYouTriggerRef,
  newSessionTriggerRef,
  now,
  previewAvailable,
  previewOpen,
  projectDetail,
  projectLabel,
  selectedSession,
  shortcutModifier,
  onOpenCommandPalette,
  onOpenNewSession,
  onToggleNeedsYou,
  onTogglePreview,
}: WorkbenchHeaderProps) {
  const onDeck = activeSurface === "work";
  const session = onDeck ? selectedSession : null;
  const state = session ? sessionState(session, "ready", now) : null;
  const key = (letter: string) => shortcutModifier === "Cmd" ? `⌘${letter}` : `Ctrl ${letter}`;

  return (
    <header className="workbench-header" data-testid="workbench-header">
      <nav className="workbench-breadcrumb" aria-label="Breadcrumb">
        {session && state ? (
          <>
            <span className="workbench-breadcrumb-parent" title={projectDetail}>{projectLabel}</span>
            <ChevronRight aria-hidden="true" size={12} />
            <span className="workbench-breadcrumb-current">
              <SessionStatusGlyph kind={state.kind} label={state.label} size={13} />
              <span className="workbench-session-title">{session.title}</span>
            </span>
          </>
        ) : !onDeck && historySelection ? (
          <>
            <span className="workbench-breadcrumb-parent">History</span>
            <ChevronRight aria-hidden="true" size={12} />
            <span className="workbench-breadcrumb-current">
              <SessionStatusGlyph kind={historySelection.status.kind} label={historySelection.status.label} size={13} />
              <span className="workbench-session-title workbench-history-title">{historySelection.title}</span>
            </span>
          </>
        ) : (
          <span className="workbench-breadcrumb-current" title={onDeck ? projectDetail : undefined}>
            <span className="workbench-surface-title">{onDeck ? projectLabel : "History"}</span>
          </span>
        )}
      </nav>
      <div className="workbench-actions">
        {onDeck && (session || previewAvailable || previewOpen) && (
          <>
            <div className="workbench-view-tabs" role="tablist" aria-label="Session view" onKeyDown={moveTabFocus}>
              <button
                type="button"
                role="tab"
                id={SESSION_VIEW_IDS.terminalTab}
                aria-selected={!previewOpen}
                aria-controls={session ? SESSION_VIEW_IDS.terminalPanel : undefined}
                tabIndex={previewOpen ? -1 : 0}
                onClick={previewOpen ? onTogglePreview : undefined}
              >
                Terminal
              </button>
              <button
                type="button"
                role="tab"
                id={SESSION_VIEW_IDS.previewTab}
                aria-selected={previewOpen}
                aria-controls={previewOpen ? SESSION_VIEW_IDS.previewPanel : undefined}
                tabIndex={previewOpen ? 0 : -1}
                disabled={!previewAvailable}
                title={previewAvailable ? "Preview" : "Start a local dev server to enable Preview"}
                onClick={previewOpen ? undefined : onTogglePreview}
              >
                Preview
              </button>
            </div>
            <span className="workbench-divider" aria-hidden="true" />
          </>
        )}
        {needsYouCount > 0 && (
          <button
            ref={needsYouTriggerRef}
            type="button"
            className="workbench-needs-you"
            aria-label={`Needs you, ${needsYouCount} session${needsYouCount === 1 ? "" : "s"}`}
            aria-expanded={needsYouOpen}
            aria-haspopup="dialog"
            title={`Needs you (${key("J")})`}
            onClick={onToggleNeedsYou}
          >
            <AlfredSignalGlyph />
            <span>{needsYouCount} {needsYouCount === 1 ? "needs" : "need"} you</span>
          </button>
        )}
        <button
          ref={commandPaletteTriggerRef}
          type="button"
          className="workbench-control"
          aria-label="Open command palette"
          title={`Search (${key("K")})`}
          onClick={onOpenCommandPalette}
        >
          <Search aria-hidden="true" size={13} />
          <kbd>{key("K")}</kbd>
        </button>
        <button ref={newSessionTriggerRef} type="button" className="workbench-control workbench-new" aria-label="New"
          aria-haspopup="dialog" title={`New session (${key("N")})`} onClick={onOpenNewSession}>
          <Plus aria-hidden="true" size={13} /><span>New</span>
        </button>
      </div>
    </header>
  );
}
