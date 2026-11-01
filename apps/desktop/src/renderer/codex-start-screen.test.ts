import { describe, expect, it } from "vitest";
import { codexStartScreen, mayShowCodexStartScreen } from "./codex-start-screen";

describe("codexStartScreen", () => {
  it.each([
    ["Hooks need review", `
  Hooks need review
  4 hooks are new or changed.
  Hooks can run outside the sandbox after you trust them.
› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)
  enter confirm · esc skip`],
    ["Hooks need review", `
  Hooks
  Lifecycle hooks from config and enabled plugins.
  ⚠ 4 hooks need review before they can run.
  Event                 Installed   Active      Review      Description
› PermissionRequest     1           0           1           When permission is requested`],
    ["Trust this folder?", `
  Folder access
  /repo
  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.
› 1. Trust and continue
  2. Quit
  enter continue · esc quit`],
    ["Sign in to Codex", `
  Welcome to Codex, OpenAI's command-line coding agent
  Choose how you want to use Codex.
> 1. Sign in with ChatGPT
  3. Use an OpenAI API key
  Press enter to continue`],
    ["Sign in to Codex", `
  Welcome to Codex, OpenAI's command-line coding agent
> Use your own OpenAI API key for usage-based billing
  Paste or type your API key below.
│Paste or type your API key
  Press enter to save`],
  ])("reads %s off the terminal", (question, screen) => {
    expect(codexStartScreen(screen)).toBe(question);
  });

  it.each([
    "",
    ">_ OpenAI Codex (v0.164.0)\n\n› Ask Codex to do anything",
    "Hooks need review is what the screen says when a hook is new.",
    "Hooks\nLifecycle hooks from config and enabled plugins.\nEvent  Installed  Active  Review",
  ])("leaves any other screen alone: %j", (screen) => {
    expect(codexStartScreen(screen)).toBeNull();
  });

  it("watches only a Codex session that has not reported or taken a message yet", () => {
    expect(mayShowCodexStartScreen({ agentKind: "codex" })).toBe(true);
    expect(mayShowCodexStartScreen({ command: "codex" })).toBe(true);
    expect(mayShowCodexStartScreen({ agentKind: "claude" })).toBe(false);
    expect(mayShowCodexStartScreen({ agentKind: "codex", promptSubmitted: true })).toBe(false);
    expect(mayShowCodexStartScreen({ agentKind: "codex", agentSignal: { state: "working", source: "hook", at: 1 } })).toBe(false);
  });
});
