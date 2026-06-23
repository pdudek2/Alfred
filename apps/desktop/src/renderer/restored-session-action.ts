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

  if (codexAgent && !hasExactCodexResumeTarget(session)) {
    if (!unsafe) return "Resume latest";
    return armed ? "Confirm resume latest" : "Review resume latest";
  }

  if (claudeAgent) {
    if (!unsafe) return "Continue latest";
    return armed ? "Confirm continue latest" : "Review continue latest";
  }

  if (!unsafe) return "Resume";
  return armed ? "Confirm resume" : "Review resume";
}

export function restoredSessionActionTitle(session: RestoredActionSession): string {
  if ((session.agentKind === "codex" || session.command === "codex") && !hasExactCodexResumeTarget(session)) {
    return "Resume the latest Codex conversation for this workspace.";
  }
  if (session.agentKind === "claude" || session.command === "claude") {
    return "Continue the latest Claude conversation for this workspace.";
  }
  return "Resume this saved session";
}

export function hasExactCodexResumeTarget(session: Pick<RestoredActionSession, "args" | "resumeTarget">): boolean {
  if (session.resumeTarget?.agentKind === "codex" && session.resumeTarget.sessionId) return true;
  return Boolean(session.args?.[0] === "resume" && session.args[1] && session.args[1] !== "--last");
}

function relaunchActionLabel(unsafe: boolean, armed: boolean): string {
  if (!unsafe) return "Relaunch";
  return armed ? "Confirm relaunch" : "Review relaunch";
}
