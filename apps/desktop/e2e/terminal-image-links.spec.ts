import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "./support/electron-app";

// The smallest valid PNG: one transparent pixel.
const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("previews an image behind an OSC 8 link or a printed path while the pointer rests on it", async ({ harness }) => {
  const { page } = harness;
  const dir = await mkdtemp(path.join(os.tmpdir(), "alfred-image-link-"));
  const image = path.join(dir, "shot.png");
  await writeFile(image, PIXEL_PNG);
  const tile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  await expect(tile).not.toHaveAttribute("aria-hidden", "true");
  const rows = tile.locator(".xterm-rows > div");
  const peek = tile.locator(".terminal-image-peek");

  // Keys typed before zsh draws its prompt lose the start of the line under load. On Linux a resize can make zsh
  // draw it twice.
  await expect(rows.filter({ hasText: /%\s*$/ }).first()).toBeVisible();
  // The link Claude Code prints for a sent [Image #1], then the same file as a bare path.
  await tile.getByTestId("xterm-host").click();
  await page.keyboard.type(`printf '\\e]8;;file://${image}\\e\\\\[Image #1]\\e]8;;\\e\\\\\\n%s\\n' ${image}`);
  await page.keyboard.press("Enter");
  // xterm draws spaces as no-break spaces, which \s matches.
  const linked = rows.filter({ hasText: /^\[Image\s#1\]\s*$/ });
  const printed = rows.filter({ hasText: new RegExp(`^${image.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`) });
  await expect(linked).toHaveCount(1);
  await expect(printed).toHaveCount(1);

  await hoverStartOf(linked, page);
  await expect(peek).toBeVisible();
  await expect(peek).toContainText("shot.png");
  await expect.poll(() => peek.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);

  await hoverStartOf(printed, page);
  await expect(peek).toContainText("shot.png");
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);

  // A page an agent draws a chart in shows as its scripts leave it.
  const chart = path.join(dir, "chart.html");
  await writeFile(chart, "<script>document.documentElement.style.background = 'rgb(255, 0, 0)'</script>");
  await page.keyboard.type(`printf '%s\\n' ${chart}`);
  await page.keyboard.press("Enter");
  const printedChart = rows.filter({ hasText: new RegExp(`^${chart.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`) });
  await expect(printedChart).toHaveCount(1);
  await hoverStartOf(printedChart, page);
  await expect(peek).toContainText("chart.html");
  await expect.poll(() => peek.locator("img").evaluate((element: HTMLImageElement) => {
    if (!element.naturalWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0);
    // Colour management can move the red a little off 255, 0, 0.
    const [red = 0, green = 0, blue = 0] = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return red > 200 && green < 60 && blue < 60;
  })).toBe(true);
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
  await rm(dir, { recursive: true, force: true });
});

async function hoverStartOf(row: Locator, page: import("@playwright/test").Page): Promise<void> {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected the terminal row on screen.");
  // A move inside the row first, so xterm sees the pointer arrive over the link.
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
}
