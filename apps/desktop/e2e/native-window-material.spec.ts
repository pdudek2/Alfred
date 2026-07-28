import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { collectControlOverflowEvidence } from "./support/control-overflow-evidence";
import { privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";

test("keeps native window material bounded to chrome while Work remains stable", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  const nativeMaterial = process.platform === "darwin";
  const previewServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Preview fixture</title><main>Preview ready</main>");
  });
  await listen(previewServer);

  try {
    await expect(page.getByTestId("workbench-header")).toBeVisible();
    await expect(page.getByTestId("xterm-host").first()).toBeVisible();
    await assertInitialWindowBoundary(app, page, nativeMaterial);

    const screenBefore = await requiredHandle(page.locator(".xterm-screen").first(), "initial xterm screen");
    await setWindowSize(app, page, 1440, 900);

    const address = previewServer.address() as AddressInfo;
    const previewUrl = `http://127.0.0.1:${address.port}/`;
    const input = page.getByRole("textbox", { name: "Terminal input" }).first();
    await input.fill(`printf 'Preview ${previewUrl}\\n'`);
    await input.press("Enter");
    await expect(page.getByTestId("xterm-host").first()).toContainText(previewUrl);

    await page.getByRole("button", { name: "Preview" }).click();
    const preview = page.getByLabel("Workspace preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTitle(`Preview of ${previewUrl}`)).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview of ${previewUrl}"]`).getByText("Preview ready")).toBeVisible();

    await assertMaterialSurfaces(page, nativeMaterial);
    const divider = page.getByRole("separator", { name: "Resize Preview" });
    const widthBeforeResize = await divider.getAttribute("aria-valuenow");
    await divider.press("ArrowLeft");
    await expect.poll(() => divider.getAttribute("aria-valuenow")).not.toBe(widthBeforeResize);
    await assertNoOverflow(page);
    await screenshot(page, testInfo, "native-window-material-1440x900.png");

    await setWindowSize(app, page, 1120, 720);
    await expect(page.getByTestId("project-navigator")).toHaveCSS("width", "46px");
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("button", { name: "Close Preview" })).toBeVisible();
    await assertOpaque(page.getByTestId("xterm-host").first(), "terminal content at 1120x720");
    await assertWindowMatchesDocument(app, page, 1120, 720);
    await assertNoOverflow(page);
    await screenshot(page, testInfo, "native-window-material-1120x720.png");

    await preview.getByRole("button", { name: "Close Preview" }).click();
    await expect(preview).toHaveCount(0);
    await selectSurface(page, "Context");
    const context = page.getByRole("complementary", { name: "Session context" });
    await expect(context).toBeVisible();
    await context.getByRole("button", { name: "Close Context panel" }).click();
    await selectSurface(page, "Sessions");
    await expect(page.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
    await selectSurface(page, "Work");
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
    await expectSameConnectedNode(screenBefore, page.locator(".xterm-screen").first());

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  } finally {
    await closeServer(previewServer);
  }
});

async function assertInitialWindowBoundary(
  app: ElectronApplication,
  page: Page,
  nativeMaterial: boolean,
): Promise<void> {
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
    await assertTranslucent(page.locator(".mission-bar"), "mission bar");
    await assertTranslucent(page.getByTestId("project-navigator"), "Projects navigator");
  } else {
    expect(marker).toBeUndefined();
    await assertOpaque(page.locator(".desktop-frame"), "opaque shell fallback");
  }
  await assertOpaque(page.getByTestId("workbench-surface"), "orchestrator surface");
  await assertOpaque(page.getByTestId("xterm-host").first(), "terminal content");
}

async function assertMaterialSurfaces(page: Page, nativeMaterial: boolean): Promise<void> {
  if (nativeMaterial) {
    await assertTranslucent(page.locator(".mission-bar"), "mission bar after preview opens");
    await assertTranslucent(page.getByTestId("project-navigator"), "Projects navigator after preview opens");
  } else {
    await assertOpaque(page.locator(".mission-bar"), "opaque mission bar fallback");
    await assertOpaque(page.getByTestId("project-navigator"), "opaque Projects fallback");
  }
  await assertOpaque(page.getByTestId("xterm-host").first(), "terminal content after preview opens");
  await assertOpaque(page.locator(".workspace-preview-dock"), "Preview dock");
}

async function assertTranslucent(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  expect(await backgroundAlpha(locator), `${label} must be translucent`).toBeLessThan(1);
}

async function assertOpaque(locator: Locator, label: string): Promise<void> {
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

async function assertNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => ({
    horizontal: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    vertical: Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight),
  }))).toEqual({ horizontal: 0, vertical: 0 });
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role='menuitem']",
    verticalScrollOwners: [{
      id: "terminal-grid-column",
      label: "Terminal grid column",
      selector: ".terminal-grid-column",
    }],
  })).toEqual([]);
}

async function assertWindowMatchesDocument(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const [bounds, documentSize] = await Promise.all([
    app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      if (!window) throw new Error("Electron window is missing.");
      const { width: boundsWidth, height: boundsHeight } = window.getBounds();
      return { width: boundsWidth, height: boundsHeight };
    }),
    page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight })),
  ]);
  expect(bounds).toEqual({ width, height });
  expect(documentSize).toEqual({ width, height });
}

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
}

async function selectSurface(page: Page, surface: "Work" | "Sessions" | "Context"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function expectSameConnectedNode(before: ElementHandle<HTMLElement>, current: Locator): Promise<void> {
  const after = await requiredHandle(current, "final xterm screen");
  expect(await before.evaluate(
    (node, next) => node.isSameNode(next) && node.isConnected,
    after,
  )).toBe(true);
}

async function screenshot(page: Page, testInfo: import("@playwright/test").TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, style: privacySafeScreenshotStyle });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
