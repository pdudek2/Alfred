import { expect, test } from "./support/electron-app";
import { chooseWorkLayout } from "./support/work-layout";

test.describe("blocked launch geometry", () => {
  test.use({ fixtureOptions: { inboxItems: 1, blockedInboxItem: 1, activeWorkspaceId: "A" } });
  test("keeps blocked actions inside the window in every Work layout", async ({ harness }, testInfo) => {
    const { page, app } = harness;
    const tile = page.locator('[data-testid="terminal-tile"][data-session-id="fixture-item-1"]');
    for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
      await app.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
      }, { width, height });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const layout of ["Focus", "Split", "Grid", "Arrange"] as const) {
        await chooseWorkLayout(page, layout);
        const reject = tile.getByRole("button", { name: "Reject Fixture item 1" });
        if (layout === "Arrange") await reject.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`blocked-${layout}-${width}.png`) });
        await expect.poll(() => tile.locator(".staged-actions button").evaluateAll((buttons) => buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
        }))).toBe(true);
        await reject.click({ trial: true });
      }
    }
    await tile.getByRole("button", { name: "Reject Fixture item 1" }).click();
    await expect(tile).toHaveCount(0);
    await expect(page.getByText("Cannot launch yet", { exact: true })).toHaveCount(0);
  });
});

test.describe("Work restart", () => {
  test.use({ fixtureOptions: { restoredSessions: 1, unsafeRecoveryItem: 1 } });
  test("keeps unsafe restart confirmation until the second click", async ({ harness }, testInfo) => {
    const { page } = harness;
    await page.getByRole("button", { name: "Open Inbox surface" }).click();
    await page.getByRole("button", { name: "Recovery · 1 saved session", exact: true }).click();
    await page.getByRole("button", { name: "Review relaunch Restored fixture 1 in Fixture Alpha" }).click();
    await page.getByRole("button", { name: "Confirm relaunch Restored fixture 1 in Fixture Alpha" }).click();
    await chooseWorkLayout(page, "Grid");
    const tile = page.locator('article[data-session-id="restored-1"]');
    const review = tile.getByRole("button", { name: "Review restart Restored fixture 1", exact: true });
    const confirm = tile.getByRole("button", { name: "Confirm restart Restored fixture 1", exact: true });
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
