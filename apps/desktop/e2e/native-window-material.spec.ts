import type { Locator } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("shows bounded macOS material or its reduced-transparency fallback while keeping Work opaque", async ({ harness }) => {
  const { app, page } = harness;
  const nativeMaterial = process.platform === "darwin";
  const reducedTransparency = await page.evaluate(
    () => window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
  );

  await expect(page.getByTestId("workbench-header")).toBeVisible();
  await expect(page.getByTestId("xterm-host").first()).toBeVisible();

  const windowState = await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    return {
      minimumSize: window.getMinimumSize(),
      resizable: window.isResizable(),
      shadow: window.hasShadow(),
    };
  });
  expect(windowState.minimumSize).toEqual([1120, 720]);
  expect(windowState.resizable).toBe(true);

  const marker = await page.evaluate(() => document.documentElement.dataset.alfredWindowMaterial);
  if (nativeMaterial) {
    expect(windowState.shadow).toBe(true);
    expect(marker).toBe("native");
    const expectChromeAlpha = reducedTransparency ? expectAlphaOne : expectAlphaBelowOne;
    await expectChromeAlpha(page.locator(".mission-bar"), "titlebar");
    await expectChromeAlpha(page.getByTestId("project-navigator"), "Projects");
  } else {
    expect(marker).toBeUndefined();
  }

  await expectAlphaOne(page.getByTestId("workbench-surface"), "Work");
  await expectAlphaOne(page.getByTestId("xterm-host").first(), "terminal");
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function expectAlphaBelowOne(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  expect(await backgroundAlpha(locator), `${label} must be translucent`).toBeLessThan(1);
}

async function expectAlphaOne(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  expect(await backgroundAlpha(locator), `${label} must be opaque`).toBe(1);
}

async function backgroundAlpha(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const color = getComputedStyle(node).backgroundColor;
    const values = color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(",").map(Number);
    if (!values || values.length < 3 || values.some(Number.isNaN)) {
      throw new Error(`Unsupported computed background color: ${color}`);
    }
    return values[3] ?? 1;
  });
}
