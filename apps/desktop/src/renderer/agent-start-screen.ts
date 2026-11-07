import type { SessionTile } from "./session-state";

export type AgentStartScreen = "hooks" | "folder" | "sign-in" | "claude-folder";

/**
 * The screens Codex (as of 0.164) and Claude Code (as of 2.1.319) hold on before they take a message. They send no
 * signal for them, so they are read off the terminal by their layout: every mark on a row of its own, in this order.
 */
const START_SCREENS: ReadonlyArray<{ screen: AgentStartScreen; marks: readonly string[] }> = [
  { screen: "hooks", marks: ["Hooks need review", "Trust all and continue", "enter confirm · esc skip"] },
  { screen: "hooks", marks: ["hooks need review before they can run", "t trust all · enter review · esc close"] },
  { screen: "folder", marks: ["Folder access", "Trust this folder?", "enter continue · esc quit"] },
  { screen: "sign-in", marks: ["Welcome to Codex", "Sign in with ChatGPT", "Press enter to continue"] },
  { screen: "sign-in", marks: ["Paste or type your API key", "Press enter to save"] },
  { screen: "claude-folder", marks: ["Accessing workspace:", "Quick safety check", "Yes, I trust this folder"] },
];

const START_SCREEN_SENTENCES: Record<AgentStartScreen, string> = {
  hooks: "Codex asks you to review its hooks",
  folder: "Codex asks to trust this folder",
  "sign-in": "Codex needs you to sign in",
  "claude-folder": "Claude asks to trust this folder",
};

export function agentStartScreen(rows: readonly string[]): AgentStartScreen | null {
  return START_SCREENS.find(({ marks }) => marksOnOwnRows(rows, marks))?.screen ?? null;
}

export function agentStartScreenSentence(screen: AgentStartScreen): string {
  return START_SCREEN_SENTENCES[screen];
}

export function watchesAgentStartScreen(session: Pick<SessionTile, "agentKind" | "command" | "detectedAgentKind">): boolean {
  return [session.agentKind, session.command, session.detectedAgentKind].some((kind) => kind === "codex" || kind === "claude");
}

function marksOnOwnRows(rows: readonly string[], marks: readonly string[]): boolean {
  let row = 0;
  return marks.every((mark) => {
    while (row < rows.length && !rows[row]!.includes(mark)) row += 1;
    row += 1;
    return row <= rows.length;
  });
}
