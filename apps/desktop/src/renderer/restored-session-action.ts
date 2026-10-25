import type { SessionTile } from "./session-state";

type RestoredActionSession = {
  agentKind?: SessionTile["agentKind"] | undefined;
  args?: string[] | undefined;
  command?: string | undefined;
  resumeTarget?: SessionTile["resumeTarget"] | undefined;
};

export function restoredSessionActionLabel(
  session: RestoredActionSession,
  unsafe: boolean,
  armed: boolean,
): string {
  const codexAgent = session.agentKind === "codex" || session.command === "codex";
  const claudeAgent = session.agentKind === "claude" || session.command === "claude";
  const codingAgent = codexAgent || claudeAgent;

  if (!codingAgent) return relaunchActionLabel(unsafe, armed);

  if (codexAgent && !hasExactResumeTarget(session)) {
    if (!unsafe) return "Resume latest";
    return armed ? "Confirm resume latest" : "Review resume latest";
  }

  if (claudeAgent && !hasExactResumeTarget(session)) {
    if (!unsafe) return "Resume latest";
    return armed ? "Confirm continue latest" : "Review continue latest";
  }

  if (!unsafe) return "Resume";
  return armed ? "Confirm resume" : "Review resume";
}

export function restoredSessionActionTitle(session: RestoredActionSession): string {
  if ((session.agentKind === "codex" || session.command === "codex") && !hasExactResumeTarget(session)) {
    return "Resume the latest Codex conversation for this project.";
  }
  if ((session.agentKind === "claude" || session.command === "claude") && !hasExactResumeTarget(session)) {
    return "Resume the latest Claude conversation for this project.";
  }
  return "Resume this session";
}

/** Whether Resume reopens one known conversation rather than the project's latest. */
export function hasExactResumeTarget(session: Pick<RestoredActionSession, "args" | "resumeTarget">): boolean {
  if (session.resumeTarget?.sessionId) return true;
  return Boolean(session.args?.[0] === "resume" && session.args[1] && session.args[1] !== "--last");
}

function relaunchActionLabel(unsafe: boolean, armed: boolean): string {
  if (!unsafe) return "Resume";
  return armed ? "Confirm resume" : "Review resume";
}
