import type { SessionTile } from "./session-state";

export type CodexStartScreen = "hooks" | "folder" | "sign-in";

/**
 * The screens Codex holds on before it takes a message, as of 0.164. It sends no signal for them, so they are read off
 * the terminal by their layout: every mark on a row of its own, in this order.
 */
const START_SCREENS: ReadonlyArray<{ screen: CodexStartScreen; marks: readonly string[] }> = [
  { screen: "hooks", marks: ["Hooks need review", "Trust all and continue", "enter confirm · esc skip"] },
  { screen: "hooks", marks: ["hooks need review before they can run", "t trust all · enter review · esc close"] },
  { screen: "folder", marks: ["Folder access", "Trust this folder?", "enter continue · esc quit"] },
  { screen: "sign-in", marks: ["Welcome to Codex", "Sign in with ChatGPT", "Press enter to continue"] },
  { screen: "sign-in", marks: ["Paste or type your API key", "Press enter to save"] },
];

const START_SCREEN_SENTENCES: Record<CodexStartScreen, string> = {
  hooks: "Codex asks you to review its hooks",
  folder: "Codex asks to trust this folder",
  "sign-in": "Codex needs you to sign in",
};

export function codexStartScreen(rows: readonly string[]): CodexStartScreen | null {
  return START_SCREENS.find(({ marks }) => marksOnOwnRows(rows, marks))?.screen ?? null;
}

export function codexStartScreenSentence(screen: CodexStartScreen): string {
  return START_SCREEN_SENTENCES[screen];
}

export function watchesCodexStartScreen(session: Pick<SessionTile, "agentKind" | "command" | "detectedAgentKind">): boolean {
  return session.agentKind === "codex" || session.command === "codex" || session.detectedAgentKind === "codex";
}

function marksOnOwnRows(rows: readonly string[], marks: readonly string[]): boolean {
  let row = 0;
  return marks.every((mark) => {
    while (row < rows.length && !rows[row]!.includes(mark)) row += 1;
    row += 1;
    return row <= rows.length;
  });
}
