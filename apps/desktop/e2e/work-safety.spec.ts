import type { Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { listMainProcessTerminals } from "./support/app-state";
import { openPlan } from "./support/plan-line";

test.describe("blocked launch geometry", () => {
  test.use({ fixtureOptions: { stagedItems: 1, blockedStagedItem: 1, activeWorkspaceId: "A" } });
  test("keeps blocked actions inside the window at both window sizes", async ({ harness }, testInfo) => {
    const { page, app } = harness;
    for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
      await app.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
      }, { width, height });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      const row = (await openPlan(page)).getByRole("listitem", { name: "Draft Fixture item 1" });
      await expect(row).toContainText("Blocked:");
      await expect(row.getByRole("button", { name: "Launch Fixture item 1" })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`blocked-deck-${width}.png`) });
      await expect.poll(() => row.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
      }))).toBe(true);
      await row.getByRole("button", { name: "Discard Fixture item 1" }).click({ trial: true });
      await page.keyboard.press("Escape");
    }
    await (await openPlan(page)).getByRole("button", { name: "Discard Fixture item 1" }).click();
    await expect(page.locator(".plan-line")).toHaveCount(0);
  });
});

test.describe("Work restart", () => {
  test.use({ fixtureOptions: { restoredSessions: 1, unsafeRecoveryItem: 1 } });
  // An ended shell leaves the deck for History, so the deck's asleep list is where Work arms an unsafe resume.
  test("keeps unsafe resume confirmation until the second click", async ({ harness }, testInfo) => {
    const { page } = harness;
    const row = page.getByRole("region", { name: "Asleep sessions" }).locator('li[data-session-id="restored-1"]');
    const review = row.getByRole("button", { name: "Review resume: Restored fixture 1", exact: true });
    const confirm = row.getByRole("button", { name: "Confirm resume: Restored fixture 1", exact: true });
    await review.click();
    await expect(confirm).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("work-restart-confirmation.png") });
    await page.keyboard.press("Escape");
    await expect(review).toBeVisible();
    expect(await sentinelCount(page)).toBe(0);
    await review.click();
    await confirm.click();
    await expect.poll(() => sentinelCount(page)).toBe(1);
  });
});

async function sentinelCount(page: Page): Promise<number> {
  const listed = await listMainProcessTerminals(page);
  const session = [...listed.sessions, ...(listed.restoredSessions ?? [])].find((candidate) => candidate.clientId === "restored-1");
  return session?.buffer?.match(/unsafe recovery confirmed/g)?.length ?? 0;
}
