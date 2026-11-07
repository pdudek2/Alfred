import { appendFile } from "node:fs/promises";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";
import { fixtureAgentOutput, launchedAgent, paintedScreen, sendHook } from "./support/fixture-agents";
import { openNewSession } from "./support/work-layout";

const HOOKS_SCREEN = [
  "  Hooks need review",
  "  4 hooks are new or changed.",
  "› 1. Review hooks",
  "  2. Trust all and continue",
  "  3. Continue without trusting (hooks won't run)",
  "  enter confirm · esc skip",
];

const CLAUDE_TRUST_SCREEN = [
  "│ Accessing workspace:                              │",
  "│ /repo                                             │",
  "│ Quick safety check: Is this a project you created │",
  "│ ❯ No, exit                                        │",
  "│   Yes, I trust this folder                        │",
  "│ Enter to confirm · Esc to cancel                  │",
];

test("asks for you while Codex holds on a start screen, from any project, until the screen goes", async ({ harness }) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);
  const rail = page.getByRole("navigation", { name: "Projects and Free Chats" });

  await openNewSession(page);
  const sheet = page.getByRole("form", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Codex/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"][data-session-id="codex-1"]');
  await expect(tile).toContainText("codex fixture ready");
  const needsYou = page.getByRole("button", { name: "Needs you, 1 session" });
  await expect(needsYou).toHaveCount(0);

  const output = await fixtureAgentOutput(paths.root, "codex");
  await appendFile(output, paintedScreen(HOOKS_SCREEN));
  await expect(tile).toContainText("Trust all and continue");
  await expect(tile).toHaveClass(/session-needs-you/);
  await expect(needsYou).toBeVisible();

  // Keys on the screen leave it up, and so does it.
  await tile.getByTestId("xterm-host").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await rail.getByRole("button", { name: "Fixture Beta project", exact: true }).click();
  await expect(needsYou).toBeVisible();

  await needsYou.click();
  const popover = page.getByRole("dialog", { name: "Needs you" });
  await expect(popover).toContainText("Codex asks you to review its hooks");
  await popover.getByRole("button", { name: /^Open .+ in Fixture Alpha$/ }).click();
  await expect(rail.getByRole("button", { name: "Fixture Alpha project", exact: true })).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-session-id="codex-1"]') !== null)).toBe(true);

  await appendFile(output, "\u001b[2J\u001b[H› Ask Codex to do anything");
  await expect(tile).toContainText("Ask Codex to do anything");
  await expect(needsYou).toHaveCount(0);
  await expect(tile).not.toHaveClass(/session-needs-you/);

  // With the screen gone, what Codex reports counts again.
  await appendFile(output, "\u001b]9;Approval requested: /bin/zsh -lc 'touch probe.txt'\u0007");
  await expect(tile).toHaveClass(/session-needs-you/);
  await expect(needsYou).toBeVisible();
});

test("asks for you while Claude asks to trust its folder, and keeps what it draws after out of Activity", async ({ harness }) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);

  const sheet = await openNewSession(page);
  await sheet.getByRole("radio", { name: /^Claude/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(tile).toContainText("claude fixture ready");
  const claude = await launchedAgent(paths.root, "claude", () => true);

  const output = await fixtureAgentOutput(paths.root, "claude");
  await appendFile(output, paintedScreen(CLAUDE_TRUST_SCREEN));
  const needsYou = page.getByRole("button", { name: "Needs you, 1 session" });
  await expect(needsYou).toBeVisible();
  await needsYou.click();
  await expect(page.getByRole("dialog", { name: "Needs you" })).toContainText("Claude asks to trust this folder");
  await page.keyboard.press("Escape");

  // The Enter that trusts the folder is no message: the prompt Claude then draws is not activity.
  await tile.getByTestId("xterm-host").click();
  await page.keyboard.press("Enter");
  await appendFile(output, '\u001b[2J\u001b[H❯ Try "how do I log an error?"\n');
  await expect(tile).toContainText("how do I log an error?");
  await expect(needsYou).toHaveCount(0);

  await sendHook(claude, "UserPromptSubmit", { prompt: "Fix the build" });
  const activity = page.getByRole("complementary", { name: "Details" }).getByRole("region", { name: "Activity" });
  await expect(activity).toContainText("You asked: Fix the build");
  await expect(activity).not.toContainText("log an error");
});
