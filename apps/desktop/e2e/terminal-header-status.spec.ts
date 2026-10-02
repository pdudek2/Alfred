import { test, expect } from "./support/electron-app";

test("keeps compact terminal status text and glyph inside the header", async ({ harness }, testInfo) => {
  const { page } = harness;
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const count of [2, 3]) {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("radio", { name: /^Terminal/ }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("terminal-tile")).toHaveCount(count);
    for (const width of [1440, 1120]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.locator(".terminal-status-label").evaluateAll(labels => labels.every(label => {
        const text = label.querySelector(".terminal-status-text")!;
        const glyph = label.querySelector("svg")!;
        const actions = label.closest(".tile-actions")!;
        const bounds = actions.getBoundingClientRect();
        return text.scrollWidth <= text.clientWidth
          && glyph.getBoundingClientRect().left >= bounds.left
          && label.getBoundingClientRect().right <= bounds.right;
      }))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`headers-${count}-${width}.png`) });
    }
  }
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});
