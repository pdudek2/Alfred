import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AttentionProjection } from "../attention-projection";
import type { SessionTile } from "../session-state";

const RECOVERY_DOCKET_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", " ", "Enter"]);

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
      className="inbox-docket__recovery"
      aria-label="Recovery"
      onKeyDown={(event) => {
        if (RECOVERY_DOCKET_KEYS.has(event.key)) {
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="inbox-docket__recovery-toggle"
        data-inbox-recovery-toggle
        aria-label={summaryLabel}
        aria-expanded={expanded}
        aria-controls="inbox-recovery-items"
        onClick={() => setExpanded((current) => !current)}
      >
        <RotateCcw aria-hidden="true" size={13} />
        <strong>{summaryLabel}</strong>
        <span>{expanded ? "Hide saved sessions" : `Show all ${items.length}`}</span>
      </button>

      {expanded && (
        <ol className="inbox-docket__recovery-list" aria-label="Recovery items" id="inbox-recovery-items">
          {items.map((item) => {
            const armed = armedRecoverySessionIds.has(item.sessionId);
            const unsafe = item.action.kind === "relaunch" && item.action.confirmation === "required";
            const details = sessionDetailsById.get(item.sessionId);
            const actionLabel = recoveryActionLabel(item, armed);
            const fullCommand = details ? displayCommand(details) : item.command;

            return (
              <li
                className="inbox-docket__recovery-item"
                data-testid={`inbox-recovery-item-${item.id}`}
                key={item.id}
              >
                <div className="inbox-docket__recovery-row">
                  <span className="inbox-docket__glyph inbox-docket__glyph--recovery" role="img" aria-label="Recovery">
                    <RotateCcw aria-hidden="true" size={14} />
                  </span>
                  <span className="inbox-docket__recovery-copy">
                    <strong>{item.sessionTitle}</strong>
                    <small>{item.workspaceLabel} · {item.sessionId}</small>
                  </span>
                </div>

                <div className="inbox-docket__recovery-detail">
                  {unsafe && armed && (
                    <div className="inbox-docket__recovery-warning">
                      <p>{item.reason}</p>
                      {details?.cwd && (
                        <div className="inbox-docket__technical-block">
                          <span>Working directory</span>
                          <code title={details.cwd}>{details.cwd}</code>
                        </div>
                      )}
                      {fullCommand && (
                        <div className="inbox-docket__technical-block">
                          <span>Command</span>
                          <code title={fullCommand}>{fullCommand}</code>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="inbox-docket__recovery-actions">
                    <button
                      type="button"
                      className="inbox-docket__recovery-primary"
                      aria-label={`${actionLabel} ${item.sessionTitle} in ${item.workspaceLabel}`}
                      data-inbox-primary-action={actionLabel}
                      onClick={() => onRecover(item.workspaceId, item.sessionId)}
                    >
                      <RotateCcw aria-hidden="true" size={14} />
                      <span>{actionLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="inbox-docket__recovery-secondary"
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
