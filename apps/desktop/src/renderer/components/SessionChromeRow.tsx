import { useState } from "react";
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
  const [renameDraft, setRenameDraft] = useState<string | null>(null);

  const submitRename = () => {
    if (!activeSession || renameDraft === null) return;
    const title = normalizeSessionTitle(renameDraft);
    setRenameDraft(null);
    if (title) onRenameSession(activeSession.id, title);
  };

  return (
    <div className="session-chrome-row" role="toolbar" aria-label="Session and layout controls">
      {workMode === "focus" && (
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
                >
                  <SessionStatusGlyph kind={status.kind} label={status.label} />
                  <span>{session.title}</span>
                </button>
                {active && (
                  <div className="session-chrome-tab-actions">
                    {renameDraft === null ? (
                      <button
                        type="button"
                        aria-label={`Rename ${session.title}`}
                        title={`Rename ${session.title}`}
                        onClick={() => setRenameDraft(session.title)}
                      >
                        Rename
                      </button>
                    ) : (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename();
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={`Rename ${session.title}`}
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Escape") return;
                            event.preventDefault();
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

      <span className="session-chrome-context mono">{workspaceDetail}</span>
    </div>
  );
}
