import { test, expect } from "./support/electron-app";

test("keeps the session strip inside the terminal box at wide and narrow widths", async ({ harness }, testInfo) => {
  const { page } = harness;
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const count of [2, 3]) {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("radio", { name: /^Terminal/ }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("terminal-tile")).toHaveCount(count);
    for (const width of [1440, 1120]) {
      await page.setViewportSize({ width, height: 900 });
      const tile = page.locator('[data-testid="terminal-tile"]:visible');
      await expect(tile.locator("header")).toHaveCount(0);
      await expect(tile.locator(".session-strip-kind")).toHaveText("Terminal");
      await expect(tile.locator(".session-strip-age")).toHaveText(/^Started /);
      await expect(tile.getByRole("button", { name: /^More actions for / })).toBeVisible();
      await expect.poll(() => tile.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const strip = node.querySelector(".session-strip")!.getBoundingClientRect();
        const info = node.querySelector<HTMLElement>(".session-strip-info")!;
        const host = node.querySelector("[data-testid='xterm-host']")!.getBoundingClientRect();
        return info.scrollWidth <= info.clientWidth
          && strip.left >= box.left
          && strip.right <= box.right
          && strip.bottom <= box.bottom
          // Drawn under the terminal although it comes first in the DOM.
          && strip.top >= host.bottom - 1;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`strip-${count}-${width}.png`) });
    }
  }
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});
