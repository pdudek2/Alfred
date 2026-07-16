import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { AttentionProjection } from "../attention-projection";
import type { SessionTile } from "../session-state";
import { InboxDecisionItem, attentionActionLabel } from "./InboxDecisionItem";
import { InboxRecoveryList } from "./InboxRecoveryList";
import { SurfaceSwitcher } from "./SurfaceSwitcher";
import type { PrimarySurface } from "./WorkbenchHeader";

type ReviewSurfaceProps = {
  attentionItems: AttentionProjection[];
  armedRecoverySessionIds: ReadonlySet<string>;
  sessionDetailsById: ReadonlyMap<string, Pick<SessionTile, "args" | "command" | "cwd">>;
  onLaunch: (sessionId: string) => void;
  onOpenInWork: (workspaceId: string, sessionId: string) => void;
  onRecover: (workspaceId: string, sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onExitToWork: () => void;
  onReviewEdit: (workspaceId: string, sessionId: string) => void;
  onSelectSurface: (surface: PrimarySurface) => void;
};

export function ReviewSurface({
  attentionItems,
  armedRecoverySessionIds,
  sessionDetailsById,
  onLaunch,
  onOpenInWork,
  onRecover,
  onDiscardRecovery,
  onExitToWork,
  onReviewEdit,
  onSelectSurface,
}: ReviewSurfaceProps) {
  const decisions = attentionItems.filter((item) => item.section === "needs-you");
  const recoveryItems = attentionItems.filter((item) => item.section === "recovery");
  const [selectedAttentionId, setSelectedAttentionId] = useState(
    () => decisions[0]?.id ?? null,
  );
  const [focusedPrimaryActionLabel, setFocusedPrimaryActionLabel] = useState<string | null>(null);
  const previousDecisionsRef = useRef(decisions);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const selectedIndex = decisions.findIndex((item) => item.id === selectedAttentionId);
  const selectedItem = selectedIndex >= 0 ? decisions[selectedIndex] ?? null : null;

  const runPrimaryAction = useCallback((item: AttentionProjection) => {
    const action = item.action;
    switch (action.kind) {
      case "open-in-work":
        onOpenInWork(item.workspaceId, item.sessionId);
        break;
      case "launch":
        onLaunch(item.sessionId);
        break;
      case "review-edit":
        onReviewEdit(item.workspaceId, item.sessionId);
        break;
      case "resume":
      case "relaunch":
        onRecover(item.workspaceId, item.sessionId);
        break;
      default:
        assertNever(action);
    }
  }, [onLaunch, onOpenInWork, onRecover, onReviewEdit]);

  useLayoutEffect(() => {
    const previousDecisions = previousDecisionsRef.current;
    previousDecisionsRef.current = decisions;
    if (decisions.length === 0) {
      if (selectedAttentionId !== null) setSelectedAttentionId(null);
      return;
    }
    if (decisions.some((item) => item.id === selectedAttentionId)) return;

    const previousIndex = previousDecisions.findIndex((item) => item.id === selectedAttentionId);
    const nextIds = new Set(decisions.map((item) => item.id));
    const nextSurvivor = previousDecisions
      .slice(previousIndex + 1)
      .find((item) => nextIds.has(item.id));
    const previousSurvivor = previousIndex > 0
      ? previousDecisions
          .slice(0, previousIndex)
          .reverse()
          .find((item) => nextIds.has(item.id))
      : undefined;
    setSelectedAttentionId(nextSurvivor?.id ?? previousSurvivor?.id ?? decisions[0]?.id ?? null);
  }, [decisions, selectedAttentionId]);

  useLayoutEffect(() => {
    if (!selectedAttentionId) {
      const recoveryToggle = surfaceRef.current?.querySelector<HTMLButtonElement>("[data-inbox-recovery-toggle]");
      if (recoveryToggle) recoveryToggle.focus();
      else surfaceRef.current?.focus();
      return;
    }
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(selectedAttentionId)
      : selectedAttentionId.replace(/["\\]/g, "\\$&");
    surfaceRef.current
      ?.querySelector<HTMLButtonElement>(`[data-attention-id="${escapedId}"]`)
      ?.focus();
  }, [selectedAttentionId]);

  const moveSelection = (nextIndex: number) => {
    const nextItem = decisions[nextIndex];
    if (nextItem) setSelectedAttentionId(nextItem.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onExitToWork();
      return;
    }
    if (event.target instanceof Element && event.target.closest(".surface-switcher")) return;
    if (!selectedItem) return;
    if (event.key === "Enter") {
      event.preventDefault();
      runPrimaryAction(selectedItem);
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(selectedIndex + 1, decisions.length - 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(selectedIndex - 1, 0);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = decisions.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    moveSelection(nextIndex);
  };

  const handleFocusCapture = (event: FocusEvent<HTMLElement>) => {
    const actionOwner = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-inbox-primary-action]")
      : null;
    const nextLabel = actionOwner?.dataset.inboxPrimaryAction ?? null;
    if (nextLabel !== focusedPrimaryActionLabel) setFocusedPrimaryActionLabel(nextLabel);
  };

  return (
    <section
      ref={surfaceRef}
      className="inbox-docket"
      aria-label="Inbox workspace"
      data-secondary-chrome-height="36"
      onFocusCapture={handleFocusCapture}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="inbox-docket__chrome">
        <SurfaceSwitcher activeSurface="inbox" onSelectSurface={onSelectSurface} />
        <span className="inbox-docket__summary">
          {decisions.length} need you · {recoveryItems.length} recovery
        </span>
      </div>

      <div className="inbox-docket__canvas">
        <header className="inbox-docket__header">
          <h2>Needs You <span>{decisions.length} decision{decisions.length === 1 ? "" : "s"}</span></h2>
          <p>Sorted by <strong>impact, then age</strong></p>
        </header>

        {decisions.length === 0 ? (
          <div className="inbox-docket__empty" role="status">
            <strong>{recoveryItems.length > 0 ? "Queue clear" : "Nothing needs you"}</strong>
            {recoveryItems.length > 0 && <span>No decisions are blocking work.</span>}
          </div>
        ) : (
          <ol className="inbox-docket__list" aria-label="Needs you items">
            {decisions.map((item) => (
              <InboxDecisionItem
                item={item}
                key={item.id}
                selected={item.id === selectedAttentionId}
                onRunPrimaryAction={runPrimaryAction}
                onSelect={setSelectedAttentionId}
              />
            ))}
          </ol>
        )}
        <InboxRecoveryList
          armedRecoverySessionIds={armedRecoverySessionIds}
          items={recoveryItems}
          sessionDetailsById={sessionDetailsById}
          onDiscard={onDiscardRecovery}
          onRecover={onRecover}
        />
      </div>

      <footer className="inbox-docket__statusbar" aria-live="polite">
        <span><kbd>↑↓</kbd>Select</span>
        {(focusedPrimaryActionLabel || selectedItem) && (
          <strong data-testid="inbox-status-action">
            <kbd>↵</kbd>{focusedPrimaryActionLabel ?? (selectedItem ? attentionActionLabel(selectedItem) : null)}
          </strong>
        )}
        <span><kbd>Esc</kbd>Back to Work</span>
      </footer>
    </section>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported attention action: ${JSON.stringify(value)}`);
}
