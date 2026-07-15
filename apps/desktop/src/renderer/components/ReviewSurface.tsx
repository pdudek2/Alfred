import { CheckCircle2 } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AttentionProjection } from "../attention-projection";
import { InboxDecisionItem, attentionActionLabel } from "./InboxDecisionItem";

type ReviewSurfaceProps = {
  attentionItems: AttentionProjection[];
  onLaunch: (sessionId: string) => void;
  onOpenInWork: (workspaceId: string, sessionId: string) => void;
  onRecover: (workspaceId: string, sessionId: string) => void;
  onReviewEdit: (workspaceId: string, sessionId: string) => void;
};

export function ReviewSurface({
  attentionItems,
  onLaunch,
  onOpenInWork,
  onRecover,
  onReviewEdit,
}: ReviewSurfaceProps) {
  const decisions = attentionItems;
  const [selectedAttentionId, setSelectedAttentionId] = useState(
    () => decisions[0]?.id ?? null,
  );
  const previousDecisionsRef = useRef(decisions);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const selectedIndex = decisions.findIndex((item) => item.id === selectedAttentionId);
  const selectedItem = selectedIndex >= 0 ? decisions[selectedIndex] ?? null : null;
  const selectedSection = selectedItem?.section ?? null;

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
      surfaceRef.current?.focus();
      return;
    }
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(selectedAttentionId)
      : selectedAttentionId.replace(/["\\]/g, "\\$&");
    surfaceRef.current
      ?.querySelector<HTMLButtonElement>(`[data-attention-id="${escapedId}"]`)
      ?.focus();
  }, [selectedAttentionId, selectedSection]);

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

  const sections = [
    {
      id: "needs-you",
      title: "Needs you",
      detail: "Decisions that block an agent or a safe staged launch.",
      items: decisions.filter((item) => item.section === "needs-you"),
    },
    {
      id: "recovery",
      title: "Recovery",
      detail: "Saved and ended sessions with a concrete recovery path.",
      items: decisions.filter((item) => item.section === "recovery"),
    },
  ];

  return (
    <section
      ref={surfaceRef}
      className="review-surface inbox-surface"
      aria-label="Inbox workspace"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <header className="review-surface-header">
        <div>
          <strong>Decision inbox</strong>
          <p>Review the oldest blocking decision first, then recover saved work.</p>
        </div>
        {decisions.length > 0 && <span className="review-surface-waiting">{decisions.length} waiting</span>}
      </header>

      {decisions.length === 0 ? (
        <div className="review-surface-empty" role="status">
          <div className="review-empty-lead">
            <CheckCircle2 aria-hidden="true" size={20} />
            <span>Queue clear</span>
            <strong>No decisions waiting.</strong>
            <p>New launch gates and recovery prompts will land here.</p>
          </div>
        </div>
      ) : (
        <div className="inbox-section-stack" aria-label="Inbox sections">
          {sections.filter((section) => section.items.length > 0).map((section) => (
            <section
              className="inbox-section"
              aria-label={section.title}
              aria-describedby={`inbox-section-${section.id}-detail`}
              key={section.id}
            >
              <header title={section.detail}>
                <strong>{section.title}</strong>
                <small>{section.items.length}</small>
                <p className="visually-hidden" id={`inbox-section-${section.id}-detail`}>{section.detail}</p>
              </header>
              <ol className="review-surface-list" aria-label={`${section.title} items`}>
                {section.items.map((item) => (
                  <InboxDecisionItem
                    item={item}
                    key={item.id}
                    selected={item.id === selectedAttentionId}
                    onRunPrimaryAction={runPrimaryAction}
                    onSelect={setSelectedAttentionId}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {selectedItem && (
        <footer className="review-surface-status" aria-live="polite">
          <span>{selectedItem.sessionTitle}</span>
          <strong data-testid="inbox-status-action">{attentionActionLabel(selectedItem)}</strong>
          <small>Enter to run · ↑/↓ to select</small>
        </footer>
      )}
    </section>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported attention action: ${JSON.stringify(value)}`);
}
