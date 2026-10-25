import { readFile } from "node:fs/promises";
import { resolveDesktopStateFilePath } from "../src/main/persisted-desktop-state";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";
import { launchedAgent, sendHook } from "./support/fixture-agents";
import { openNewTerminalSheet } from "./support/work-layout";

const conversation = "6f1c2a4e-8b1d-4c3e-9f2a-0d5e7b8c9a10";

test("resumes the Claude conversation its hooks named, after a restart", async ({ harness }) => {
  let { app, page } = harness;
  const { paths } = harness;
  await setWindowSize(app, page, 1440, 900);

  await openNewTerminalSheet(page);
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Claude/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(tile).toContainText("claude fixture ready");
  const clientId = (await tile.getAttribute("data-session-id"))!;

  const launched = await launchedAgent(paths.root, "claude", (args) => !args.includes("--resume"));
  await sendHook(launched, "Stop", {
    session_id: conversation,
    transcript_path: `/Users/sample/.claude/projects/-repo/${conversation}.jsonl`,
    last_assistant_message: "Done.",
  });

  const stateFile = resolveDesktopStateFilePath({ userDataPath: paths.userData });
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
      restoredTerminalSessions?: { clientId: string; resumeTarget?: unknown }[];
    };
    return saved.restoredTerminalSessions?.find((session) => session.clientId === clientId)?.resumeTarget;
  }).toEqual({ agentKind: "claude", sessionId: conversation, source: "agent-hook" });

  // Asleep after a restart, the session offers its own conversation rather than the project's latest.
  ({ app, page } = await harness.restart());
  await setWindowSize(app, page, 1440, 900);
  const asleep = page.getByRole("region", { name: "Asleep sessions" }).locator(`li[data-session-id="${clientId}"]`);
  await expect(asleep.getByRole("button")).toHaveText("Resume");
  await asleep.getByRole("button").click();

  const resumed = await launchedAgent(paths.root, "claude", (args) => args.includes("--resume"));
  expect(resumed.args.slice(-2)).toEqual(["--resume", conversation]);
});
