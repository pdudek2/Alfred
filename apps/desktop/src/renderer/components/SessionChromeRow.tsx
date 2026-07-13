import { useRef, useState } from "react";
import { normalizeSessionTitle } from "../../shared/session-title";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import type { WorkMode } from "../terminal-desk-types";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

export function workChromeSessions(sessions: SessionTile[]): SessionTile[] {
  return sessions.filter(
    (session) => session.stage === "live" && session.runtimeStatus !== "restored",
  );
}

export type SessionChromeRowProps = {
  activeSessionId: string | null;
  arrangeMode: boolean;
  sessions: SessionTile[];
  workMode: WorkMode;
  workspaceDetail: string;
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onCloseSession: (sessionId: string) => void;
  onFocusSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onToggleArrangeMode: () => void;
};

export function SessionChromeRow({
  activeSessionId,
  arrangeMode,
  sessions,
  workMode,
  workspaceDetail,
  onAddManualSession,
  onApplyWorkMode,
  onCloseSession,
  onFocusSession,
  onRenameSession,
  onToggleArrangeMode,
}: SessionChromeRowProps) {
  const chromeSessions = workChromeSessions(sessions);
  const activeSession = chromeSessions.find((session) => session.id === activeSessionId) ?? chromeSessions[0];
  const [renameDraft, setRenameDraft] = useState<{ sessionId: string; value: string } | null>(null);
  const renameTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingRenameFocusRef = useRef<string | null>(null);

  const submitRename = (session: SessionTile) => {
    if (renameDraft?.sessionId !== session.id) return;
    const title = normalizeSessionTitle(renameDraft.value);
    setRenameDraft(null);
    if (title) onRenameSession(session.id, title);
  };

  return (
    <div className="session-chrome-row" role="toolbar" aria-label="Session and layout controls">
      {workMode === "focus" && !arrangeMode && (
        <div className="session-chrome-tabs" role="tablist" aria-label="Sessions">
          {chromeSessions.map((session) => {
            const status = terminalSessionDisplayStatus(session);
            const active = session.id === activeSession?.id;

            return (
              <div className="session-chrome-tab" key={session.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onFocusSession(session.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const offset = event.key === "ArrowRight" ? 1 : -1;
                    const targetIndex = (chromeSessions.indexOf(session) + offset + chromeSessions.length)
                      % chromeSessions.length;
                    const targetSession = chromeSessions[targetIndex];
                    const targetTab = event.currentTarget
                      .closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[targetIndex];
                    targetTab?.focus();
                    if (targetSession) onFocusSession(targetSession.id);
                  }}
                >
                  <SessionStatusGlyph kind={status.kind} label={status.label} />
                  <span>{session.title}</span>
                </button>
                {active && (
                  <div className="session-chrome-tab-actions">
                    {renameDraft?.sessionId !== session.id ? (
                      <button
                        ref={(node) => {
                          if (node) {
                            renameTriggerRefs.current.set(session.id, node);
                            if (pendingRenameFocusRef.current === session.id) {
                              pendingRenameFocusRef.current = null;
                              renameTriggerRefs.current.get(session.id)?.focus();
                            }
                          } else {
                            renameTriggerRefs.current.delete(session.id);
                          }
                        }}
                        type="button"
                        aria-label={`Rename ${session.title}`}
                        title={`Rename ${session.title}`}
                        onClick={() => setRenameDraft({ sessionId: session.id, value: session.title })}
                      >
                        Rename
                      </button>
                    ) : (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename(session);
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={`Rename ${session.title}`}
                          value={renameDraft.value}
                          onChange={(event) => setRenameDraft({ sessionId: session.id, value: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key !== "Escape") return;
                            event.preventDefault();
                            pendingRenameFocusRef.current = session.id;
                            setRenameDraft(null);
                          }}
                        />
                      </form>
                    )}
                    <button
                      type="button"
                      aria-label={`Close ${session.title}`}
                      title={`Close ${session.title}`}
                      onClick={() => onCloseSession(session.id)}
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="session-chrome-add"
        aria-label="New terminal"
        title="New terminal"
        onClick={onAddManualSession}
      >
        +
      </button>

      <div className="session-chrome-layout" role="group" aria-label="Layout mode">
        <button type="button" aria-pressed={workMode === "focus"} onClick={() => onApplyWorkMode("focus")}>
          Focus
        </button>
        <button type="button" aria-pressed={workMode === "split"} onClick={() => onApplyWorkMode("split")}>
          Split
        </button>
        <button type="button" aria-pressed={workMode === "desk"} onClick={() => onApplyWorkMode("desk")}>
          Grid
        </button>
        <button type="button" aria-pressed={arrangeMode} onClick={onToggleArrangeMode}>
          Arrange
        </button>
      </div>

      <span className="session-chrome-context">{workspaceDetail}</span>
    </div>
  );
}
