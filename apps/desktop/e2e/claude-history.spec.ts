import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";
import { CLAUDE_FIXTURE_CONVERSATION } from "./support/desktop-state-fixture";
import { launchedAgent } from "./support/fixture-agents";
import { surfaceButton } from "./support/work-layout";

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
