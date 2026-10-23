import type { Ref } from "react";
import { moveTabFocus } from "../tab-keys";
import "./side-column-tabs.css";

type SideColumnTabsProps = {
  detailsOpen: boolean;
  detailsTabRef?: Ref<HTMLButtonElement>;
  shortcutModifier: "Cmd" | "Ctrl";
  onToggleDetails: () => void;
};

/** The side column holds the session stack or Details. Both draw this row, so it reads as one set of tabs. */
export function SideColumnTabs({ detailsOpen, detailsTabRef, shortcutModifier, onToggleDetails }: SideColumnTabsProps) {
  return (
    <div className="side-column-tabs">
      <div className="text-tabs" role="tablist" aria-label="Side column" onKeyDown={moveTabFocus}>
        <button
          type="button"
          role="tab"
          aria-selected={!detailsOpen}
          tabIndex={detailsOpen ? -1 : 0}
          onClick={detailsOpen ? onToggleDetails : undefined}
        >
          Sessions
        </button>
        <button
          ref={detailsTabRef}
          type="button"
          role="tab"
          aria-selected={detailsOpen}
          tabIndex={detailsOpen ? 0 : -1}
          aria-keyshortcuts={shortcutModifier === "Cmd" ? "Meta+i" : "Control+i"}
          onClick={detailsOpen ? undefined : onToggleDetails}
        >
          Details
        </button>
      </div>
      <kbd>{shortcutModifier === "Cmd" ? "⌘I" : "Ctrl I"}</kbd>
    </div>
  );
}
