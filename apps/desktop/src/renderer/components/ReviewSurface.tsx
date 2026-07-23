import { ChevronLeft } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AttentionProjection } from "../attention-projection";
import type { SessionTile } from "../session-state";
import { InboxDecisionItem } from "./InboxDecisionItem";
import { InboxRecoveryList } from "./InboxRecoveryList";

type ReviewSurfaceProps = {
  attentionItems: AttentionProjection[];
  armedRecoverySessionIds: ReadonlySet<string>;
  sessionDetailsById: ReadonlyMap<string, Pick<SessionTile, "args" | "command" | "cwd">>;
  onLaunch: (sessionId: string) => void;
  onOpenInWork: (workspaceId: string, sessionId: string) => void;
  onRecover: (workspaceId: string, sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onReviewEdit: (workspaceId: string, sessionId: string) => void;
  onBackToWork: () => void;
};

export function ReviewSurface({
  attentionItems,
  armedRecoverySessionIds,
  sessionDetailsById,
  onLaunch,
  onOpenInWork,
  onRecover,
  onDiscardRecovery,
  onReviewEdit,
  onBackToWork,
}: ReviewSurfaceProps) {
  const decisions = attentionItems.filter((item) => item.section === "needs-you");
  const recoveryItems = attentionItems.filter((item) => item.section === "recovery");
  const [selectedAttentionId, setSelectedAttentionId] = useState(
    () => decisions[0]?.id ?? null,
  );
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

  return (
    <section
      ref={surfaceRef}
      className="inbox-docket"
      aria-label="Inbox workspace"
      data-secondary-chrome-height="52"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <header className="inbox-docket__toolbar" aria-label="Inbox toolbar">
        <button
          type="button"
          className="inbox-docket__back"
          aria-label="Back to Work"
          onClick={onBackToWork}
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <span className="inbox-docket__title">
          <strong role="heading" aria-level={1}>Inbox</strong>
          <small>All projects</small>
        </span>
        <span className="inbox-docket__summary">
          {decisions.length} need you · {recoveryItems.length} recovery
        </span>
      </header>

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

    </section>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported attention action: ${JSON.stringify(value)}`);
}
