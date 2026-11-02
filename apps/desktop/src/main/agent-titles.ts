import path from "node:path";
import { redactText } from "@alfred/schema";
import { normalizeSessionTitle } from "../shared/session-title.js";
import type { TerminalResumeTarget } from "../shared/terminal-ipc.js";
import { claudeConversationTitle } from "./claude-transcripts.js";
import { readCodexSessionTitleIndex } from "./external-sessions.js";
import { defaultClaudeHome, defaultCodexHome } from "./sessions-ipc.js";

/** The name Claude Code or Codex shows for a conversation; empty until it has one. */
export async function agentConversationTitle(
  target: TerminalResumeTarget,
  cwd: string,
  transcriptPath?: string,
): Promise<string> {
  const title = target.agentKind === "codex"
    ? (await readCodexSessionTitleIndex(defaultCodexHome())).get(target.sessionId)
    : await claudeConversationTitle(transcriptPath ?? claudeTranscriptPath(cwd, target.sessionId));
  return normalizeSessionTitle(redactText(title ?? ""));
}

// A session asleep since an earlier launch has no path from a hook; Claude Code names a project's folder this way.
function claudeTranscriptPath(cwd: string, conversationId: string): string {
  return path.join(defaultClaudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${conversationId}.jsonl`);
}
