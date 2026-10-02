import { expect, it } from "vitest";
import { normalizeAgentCommand } from "./agent-command";

it("preserves literal prompt text after the argument terminator", () => {
  expect(normalizeAgentCommand({ agentKind: "codex", command: "codex", args: ["--", "--prompt=explain this flag"] }).args)
    .toEqual(["--", "--prompt=explain this flag"]);
});
