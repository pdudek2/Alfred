import type { SessionTile } from "./session-state";

/**
 * The screens Codex holds on before its first turn, as of 0.164. It sends no signal for them, so they are read off the
 * terminal, by marks that only stand together on that screen.
 */
const START_SCREENS: ReadonlyArray<{ question: string; marks: readonly string[] }> = [
  { question: "Hooks need review", marks: ["Hooks need review", "Review hooks", "Trust all and continue"] },
  { question: "Hooks need review", marks: ["Lifecycle hooks from config", "need review before they can run"] },
  { question: "Trust this folder?", marks: ["Folder access", "Trust this folder?", "Trust and continue"] },
  { question: "Sign in to Codex", marks: ["Welcome to Codex", "Sign in with ChatGPT", "Press enter to continue"] },
  { question: "Sign in to Codex", marks: ["Welcome to Codex", "Paste or type your API key", "Press enter to save"] },
];

export function codexStartScreen(screen: string): string | null {
  return START_SCREENS.find(({ marks }) => marks.every((mark) => screen.includes(mark)))?.question ?? null;
}

/** Only until the session first reports or takes a message: later, the same words on screen are the agent's work. */
export function mayShowCodexStartScreen(
  session: Pick<SessionTile, "agentKind" | "agentSignal" | "command" | "promptSubmitted">,
): boolean {
  return (session.agentKind === "codex" || session.command === "codex") && !session.promptSubmitted && !session.agentSignal;
}
