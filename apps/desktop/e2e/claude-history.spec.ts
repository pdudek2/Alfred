import { readFile } from "node:fs/promises";
import { resolveDesktopStateFilePath } from "../src/main/persisted-desktop-state";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";
import { CLAUDE_FIXTURE_CONVERSATION } from "./support/desktop-state-fixture";
import { launchedAgent, sendHook } from "./support/fixture-agents";
import { openNewTerminalSheet, surfaceButton } from "./support/work-layout";

test.use({ fixtureOptions: { claudeSessionFixture: true } });

test("lists Claude Code conversations in History and resumes one in the deck", async ({ harness }) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);

  await surfaceButton(page, "History").click();
  const history = page.getByRole("region", { name: "History" });
  await history.getByRole("tab", { name: "Claude Code" }).click();
  const row = history.getByRole("listbox", { name: "Session results" }).getByRole("option", { name: /Launch check explained/ });
  await expect(row).toContainText("Claude Code");
  await row.click();
  await expect(history).toContainText("It runs before every start.");

  await history.getByRole("button", { name: "Resume", exact: true }).click();
  const resumed = await launchedAgent(paths.root, "claude", (args) => args.includes("--resume"));
  expect(resumed.args.slice(-2)).toEqual(["--resume", CLAUDE_FIXTURE_CONVERSATION]);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toContainText("claude fixture ready");
});

test("wakes the asleep Alfred session that holds a conversation resumed from History", async ({ harness }) => {
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
  await sendHook(launched, "Stop", { session_id: CLAUDE_FIXTURE_CONVERSATION, last_assistant_message: "Done." });
  const stateFile = resolveDesktopStateFilePath({ userDataPath: paths.userData });
  await expect.poll(async () => (await readFile(stateFile, "utf8")).includes(CLAUDE_FIXTURE_CONVERSATION)).toBe(true);

  ({ app, page } = await harness.restart());
  await setWindowSize(app, page, 1440, 900);
  const asleep = page.getByRole("region", { name: "Asleep sessions" }).locator(`li[data-session-id="${clientId}"]`);
  await expect(asleep).toBeVisible();

  await surfaceButton(page, "History").click();
  const history = page.getByRole("region", { name: "History" });
  await history.getByRole("tab", { name: "Claude Code" }).click();
  await history.getByRole("listbox", { name: "Session results" }).getByRole("option", { name: /Launch check explained/ }).click();
  await history.getByRole("button", { name: "Resume", exact: true }).click();

  const resumed = await launchedAgent(paths.root, "claude", (args) => args.includes("--resume"));
  expect(resumed.args.slice(-2)).toEqual(["--resume", CLAUDE_FIXTURE_CONVERSATION]);
  await expect(page.locator(`[data-testid="terminal-tile"][data-session-id="${clientId}"]`)).toContainText("claude fixture ready");
  await expect(asleep).toHaveCount(0);
});
