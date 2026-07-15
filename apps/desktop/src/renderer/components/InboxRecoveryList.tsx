import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AttentionProjection } from "../attention-projection";
import type { SessionTile } from "../session-state";

export type InboxRecoveryListProps = {
  items: readonly AttentionProjection[];
  sessionDetailsById: ReadonlyMap<
    string,
    Pick<SessionTile, "args" | "command" | "cwd">
  >;
  armedRecoverySessionIds: ReadonlySet<string>;
  onRecover: (workspaceId: string, sessionId: string) => void;
  onDiscard: (sessionId: string) => void;
};

export function InboxRecoveryList({
  items,
  sessionDetailsById,
  armedRecoverySessionIds,
  onRecover,
  onDiscard,
}: InboxRecoveryListProps) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const savedSessionLabel = `${items.length} saved session${items.length === 1 ? "" : "s"}`;
  const summaryLabel = `Recovery · ${savedSessionLabel}`;

  return (
    <section
      className="inbox-section"
      aria-label="Recovery"
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
      }}
    >
      <header>
        <button
          type="button"
          data-inbox-recovery-toggle
          aria-expanded={expanded}
          aria-controls="inbox-recovery-items"
          onClick={() => setExpanded((current) => !current)}
        >
          <strong>{summaryLabel}</strong>
        </button>
      </header>

      {expanded && (
        <ol className="review-surface-list" aria-label="Recovery items" id="inbox-recovery-items">
          {items.map((item) => {
            const armed = armedRecoverySessionIds.has(item.sessionId);
            const unsafe = item.action.kind === "relaunch" && item.action.confirmation === "required";
            const details = sessionDetailsById.get(item.sessionId);
            const actionLabel = recoveryActionLabel(item, armed);
            const fullCommand = details ? displayCommand(details) : item.command;

            return (
              <li
                className="review-surface-item tone-recovery"
                data-testid={`inbox-recovery-item-${item.id}`}
                key={item.id}
              >
                <div className="review-surface-item-main">
                  <span className="review-surface-workspace" role="img" aria-label="Recovery">
                    <RotateCcw aria-hidden="true" size={14} />
                  </span>
                  <span className="review-surface-copy">
                    <strong>{item.sessionTitle}</strong>
                    <small>{item.workspaceLabel} · {item.sessionId}</small>
                  </span>
                </div>

                <div className="review-surface-note">
                  {unsafe && armed && (
                    <div>
                      <p>{item.reason}</p>
                      {details?.cwd && (
                        <div className="review-surface-command">
                          <span>Working directory</span>
                          <code title={details.cwd}>{details.cwd}</code>
                        </div>
                      )}
                      {fullCommand && (
                        <div className="review-surface-command">
                          <span>Command</span>
                          <code title={fullCommand}>{fullCommand}</code>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="review-surface-row">
                    <button
                      type="button"
                      className="review-surface-primary action-recovery"
                      aria-label={`${actionLabel} ${item.sessionTitle} in ${item.workspaceLabel}`}
                      onClick={() => onRecover(item.workspaceId, item.sessionId)}
                    >
                      <RotateCcw aria-hidden="true" size={14} />
                      <span>{actionLabel}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Discard ${item.sessionTitle}`}
                      onClick={() => onDiscard(item.sessionId)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                      <span>Discard</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function recoveryActionLabel(item: AttentionProjection, armed: boolean): string {
  if (item.action.kind === "resume") return "Resume";
  if (item.action.kind === "relaunch") {
    if (item.action.confirmation === "required") return armed ? "Confirm relaunch" : "Review relaunch";
    return "Relaunch";
  }
  throw new Error(`Unsupported Recovery action: ${JSON.stringify(item.action)}`);
}

function displayCommand(details: Pick<SessionTile, "args" | "command">): string | undefined {
  const command = details.command?.trim();
  if (!command) return undefined;
  return [command, ...(details.args ?? [])].join(" ");
}
