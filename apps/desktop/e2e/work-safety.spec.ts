import { expect, test } from "./support/electron-app";
import { openPlan } from "./support/plan-line";
import { chooseWorkLayout } from "./support/work-layout";

test.describe("blocked launch geometry", () => {
  test.use({ fixtureOptions: { inboxItems: 1, blockedInboxItem: 1, activeWorkspaceId: "A" } });
  test("keeps blocked actions inside the window in every Work layout", async ({ harness }, testInfo) => {
    const { page, app } = harness;
    for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
      await app.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
      }, { width, height });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const layout of ["Focus", "Split", "Grid", "Arrange"] as const) {
        await chooseWorkLayout(page, layout);
        const row = (await openPlan(page)).getByRole("listitem", { name: "Draft Fixture item 1" });
        await expect(row).toContainText("Blocked:");
        await expect(row.getByRole("button", { name: "Launch Fixture item 1" })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`blocked-${layout}-${width}.png`) });
        await expect.poll(() => row.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
        }))).toBe(true);
        await row.getByRole("button", { name: "Discard Fixture item 1" }).click({ trial: true });
        await page.keyboard.press("Escape");
      }
    }
    await (await openPlan(page)).getByRole("button", { name: "Discard Fixture item 1" }).click();
    await expect(page.locator(".plan-line")).toHaveCount(0);
  });
});

test.describe("Work restart", () => {
  test.use({ fixtureOptions: { restoredSessions: 1, unsafeRecoveryItem: 1 } });
  test("keeps unsafe restart confirmation until the second click", async ({ harness }, testInfo) => {
    const { page } = harness;
    await page.getByRole("button", { name: "Browse 1 asleep session" }).click();
    const history = page.getByRole("region", { name: "History" });
    await history.getByRole("option", { name: /Restored fixture 1/ }).click();
    await history.getByRole("button", { name: "Review resume" }).click();
    await history.getByRole("button", { name: "Confirm resume" }).click();
    await chooseWorkLayout(page, "Grid");
    const tile = page.locator('article[data-session-id="restored-1"]');
    const review = tile.getByRole("button", { name: "Review resume Restored fixture 1", exact: true });
    const confirm = tile.getByRole("button", { name: "Confirm resume Restored fixture 1", exact: true });
    await review.click();
    await expect(confirm).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("work-restart-confirmation.png") });
    await page.keyboard.press("Escape");
    await expect(review).toBeVisible();
    await review.click();
    await confirm.click();
    await expect(review).toBeVisible();
  });
});
