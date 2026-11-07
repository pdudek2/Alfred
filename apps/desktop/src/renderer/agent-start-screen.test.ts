import { describe, expect, it } from "vitest";
import { agentStartScreen, watchesAgentStartScreen } from "./agent-start-screen";

const rows = (screen: string) => screen.split("\n");

describe("agentStartScreen", () => {
  it.each([
    ["hooks", `
  Hooks need review
  4 hooks are new or changed.
  Hooks can run outside the sandbox after you trust them.
› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)
  enter confirm · esc skip`],
    ["hooks", `
  Hooks
  Lifecycle hooks from config and enabled plugins.
  ⚠ 4 hooks need review before they can run.
  Event                 Installed   Active      Review      Description
› PermissionRequest     1           0           1           When permission is requested
  t trust all · enter review · esc close`],
    ["folder", `
  Folder access
  /repo
  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.
› 1. Trust and continue
  2. Quit
  enter continue · esc quit`],
    ["sign-in", `
  Welcome to Codex, OpenAI's command-line coding agent
  Choose how you want to use Codex.
> 1. Sign in with ChatGPT
  3. Use an OpenAI API key
  Press enter to continue`],
    ["sign-in", `
  Welcome to Codex, OpenAI's command-line coding agent
> Use your own OpenAI API key for usage-based billing
  Paste or type your API key below.
│Paste or type your API key
  Press enter to save`],
    ["claude-folder", `
╭───────────────────────────────────────────────────╮
│ Accessing workspace:                              │
│                                                   │
│ /repo                                             │
│                                                   │
│ Quick safety check: Is this a project you created │
│ or one you trust? (Like your own code, a          │
│ well-known open source project, or work from your │
│ team). If not, take a moment to review what's in  │
│ this folder first.                                │
│                                                   │
│ Claude Code'll be able to read, edit, and execute │
│ files here.                                       │
│                                                   │
│ Security guide                                    │
│                                                   │
│ ❯ No, exit                                        │
│   Yes, I trust this folder                        │
│                                                   │
│ Enter to confirm · Esc to cancel                  │
╰───────────────────────────────────────────────────╯`],
  ])("reads the %s screen off the terminal", (screen, text) => {
    expect(agentStartScreen(rows(text))).toBe(screen);
  });

  it.each([
    ["an empty screen", ""],
    ["the composer", ">_ OpenAI Codex (v0.164.0)\n\n› Ask Codex to do anything"],
    ["Claude's prompt", '❯ Try "how do I log an error?"'],
    ["one mark", "Hooks need review"],
    ["the hooks panel once every hook is trusted", "Hooks\nLifecycle hooks from config and enabled plugins.\nEvent  Installed  Active  Review"],
    ["a quote on one row", "• The screen said Hooks need review, Trust all and continue, enter confirm · esc skip."],
    ["the marks quoted in code", `  { marks: ["Folder access", "Trust this folder?", "enter continue · esc quit"] },`],
    ["the marks out of order", "  enter continue · esc quit\n  Folder access\n  Trust this folder?"],
  ])("leaves %s alone", (_, text) => {
    expect(agentStartScreen(rows(text))).toBeNull();
  });
});

describe("watchesAgentStartScreen", () => {
  it("watches Codex and Claude sessions, however they were started", () => {
    expect(watchesAgentStartScreen({ agentKind: "codex" })).toBe(true);
    expect(watchesAgentStartScreen({ command: "codex" })).toBe(true);
    expect(watchesAgentStartScreen({ detectedAgentKind: "codex" })).toBe(true);
    expect(watchesAgentStartScreen({ agentKind: "claude" })).toBe(true);
    expect(watchesAgentStartScreen({ detectedAgentKind: "claude" })).toBe(true);
    expect(watchesAgentStartScreen({ command: "zsh" })).toBe(false);
  });
});
