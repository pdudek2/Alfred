import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";
import { launchedAgent } from "./support/fixture-agents";
import { surfaceButton } from "./support/work-layout";

const git = async (cwd: string, ...args: string[]) => (await promisify(execFile)("git", ["-C", cwd, ...args])).stdout.trim();
const BRANCH = "alfred-codex-fixture-handoff";

test.use({ fixtureOptions: { handoffDiff: true } });

test("discards an isolated checkout whose agent committed, once you confirm", async ({ harness }, testInfo) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);
  // The agent committed its work, so the checkout has no diff for Alfred to list.
  const checkout = (await git(paths.workspaceA, "worktree", "list", "--porcelain"))
    .split("\n").find((line) => line.startsWith("worktree ") && line.endsWith(BRANCH))!.slice("worktree ".length);
  await git(checkout, "-c", "user.name=Alfred E2E", "-c", "user.email=alfred-e2e@example.invalid", "commit", "-qam", "agent work");

  await surfaceButton(page, "History").click();
  const history = page.getByRole("region", { name: "History" });
  await history.getByRole("listbox", { name: "Session results" }).getByRole("option", { name: /Fixture diff handoff/ }).click();
  await history.getByRole("button", { name: "Discard asleep session" }).click();

  const dialog = page.getByRole("dialog", { name: "Discard isolated checkout" });
  await expect(dialog).toContainText("commits not present in the base workspace");
  await expect(dialog).toContainText(BRANCH);
  await expect(dialog.getByRole("button", { name: "Review changes" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("discard-unlisted-1440x900.png") });

  await dialog.getByRole("button", { name: "Discard checkout permanently" }).click();
  await expect.poll(() => git(paths.workspaceA, "worktree", "list")).not.toContain(BRANCH);
  expect(await git(paths.workspaceA, "branch", "--list", BRANCH)).toBe("");
});

test("asks before closing a running checkout with changes, then stops its agent and removes the checkout", async ({ harness }, testInfo) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);
  const asleep = page.getByRole("region", { name: "Asleep sessions" }).locator('li[data-session-id="fixture-handoff-diff"]');
  await asleep.getByRole("button").click();
  await launchedAgent(paths.root, "codex", () => true);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(1);

  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("textbox", { name: "Search commands" }).fill("close focused session");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Discard isolated checkout" });
  await expect(dialog).toContainText("handoff-status.txt");
  await page.screenshot({ path: testInfo.outputPath("discard-running-1440x900.png") });
  expect(await git(paths.workspaceA, "worktree", "list")).toContain(BRANCH);

  await dialog.getByRole("button", { name: "Discard checkout permanently" }).click();
  await expect.poll(() => git(paths.workspaceA, "worktree", "list")).not.toContain(BRANCH);
  expect(await git(paths.workspaceA, "branch", "--list", BRANCH)).toBe("");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(0);
});
