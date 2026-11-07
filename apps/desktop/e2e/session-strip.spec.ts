import { openNewSession } from "./support/work-layout";
import { test, expect } from "./support/electron-app";

test("keeps the session's agent, age and menu beside its title at wide and narrow widths", async ({ harness }, testInfo) => {
  const { page } = harness;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const header = page.getByTestId("workbench-header");
  for (const count of [2, 3]) {
    await openNewSession(page);
    await page.getByRole("radio", { name: /^Terminal/ }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("terminal-tile")).toHaveCount(count);
    for (const width of [1440, 1120]) {
      await page.setViewportSize({ width, height: 900 });
      const tile = page.locator('[data-testid="terminal-tile"]:visible');
      // A running tile is only its terminal.
      await expect(tile.locator("header")).toHaveCount(0);
      await expect(tile.locator(".session-strip")).toHaveCount(0);
      await expect(header.locator(".session-meta-kind")).toHaveText("Terminal");
      if (width === 1440) await expect(header.locator(".session-meta-age")).toHaveText(/^Started /);
      await expect(header.getByRole("button", { name: /^More actions for / })).toBeVisible();
      await expect.poll(() => header.evaluate((node) => {
        const parent = node.querySelector<HTMLElement>(".workbench-breadcrumb-parent")!;
        const breadcrumb = node.querySelector(".workbench-breadcrumb")!.getBoundingClientRect();
        const meta = node.querySelector(".session-meta")!.getBoundingClientRect();
        const actions = node.querySelector(".workbench-actions")!.getBoundingClientRect();
        // The project name is never cut, and the details sit between the title and the actions without touching.
        return parent.scrollWidth <= parent.clientWidth
          && node.scrollWidth <= node.clientWidth
          && meta.left >= breadcrumb.right
          && meta.right <= actions.left;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`meta-${count}-${width}.png`) });
    }
  }
});
