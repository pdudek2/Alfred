import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ElementHandle, Locator } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("Preview takes the terminal's place, keeps Details beside it, and preserves xterm while loaded and offline", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  let server: Server | null = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Alfred Preview Fixture</title><main>Preview fixture ready</main>");
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });

  try {
    if (!server) throw new Error("Preview server did not start.");
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/`;
    const xterm = page.getByTestId("xterm-host").first();
    const xtermHandle = await xterm.elementHandle();
    if (!xtermHandle) throw new Error("Expected the first xterm host.");

    const input = page.getByRole("textbox", { name: "Terminal input" }).first();
    await input.fill(`printf 'Ready at ${url}\\n'`);
    await input.press("Enter");

    const previewTab = page.getByRole("tab", { name: "Preview" });
    const terminalTab = page.getByRole("tab", { name: "Terminal" });
    await expect(previewTab).toBeEnabled();
    await expect(previewTab).toHaveAttribute("aria-selected", "false");
    await expect(page.getByLabel("Project preview")).toHaveCount(0);
    // Each tab points at the panel it shows: the focused terminal, then the preview in its place.
    const terminalPanel = page.getByRole("tabpanel", { name: "Terminal" });
    await expect(terminalPanel).toHaveAttribute("data-testid", "xterm-host");
    await expectControls(terminalTab, terminalPanel);
    const terminalBox = await xterm.boundingBox();
    const details = page.getByRole("complementary", { name: "Details" });
    const detailsBox = await details.boundingBox();

    await previewTab.click();
    const preview = page.getByLabel("Project preview");
    const frame = page.getByTitle(`Preview of ${url}`);
    await expect(preview).toBeVisible();
    await expect(frame).toBeVisible();
    const previewPanel = page.getByRole("tabpanel", { name: "Preview" });
    await expect(previewPanel.getByLabel("Project preview")).toBeVisible();
    await expectControls(previewTab, previewPanel);
    await expect(page.frameLocator(`iframe[title="Preview of ${url}"]`).getByText("Preview fixture ready")).toBeVisible();
    await expectSameNode(xtermHandle, xterm);

    // Preview covers exactly the terminal's cell. The terminal keeps its size underneath, so the shell is not
    // resized, and Details and the session strip stay where they were.
    expect(await preview.boundingBox()).toEqual(terminalBox);
    expect(await xterm.boundingBox()).toEqual(terminalBox);
    await expect(xterm).toHaveAttribute("inert", "");
    expect(await details.boundingBox()).toEqual(detailsBox);
    await expect(page.locator('[data-testid="terminal-tile"]:visible .session-strip')).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize Preview" })).toHaveCount(0);

    // Details stays beside Preview instead of giving way to it.
    await expect(details).toBeVisible();
    await expect(frame).toBeVisible();

    await terminalTab.click();
    await expect(preview).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(xterm).not.toHaveAttribute("inert", "");
    await expectSameNode(xtermHandle, xterm);

    await previewTab.click();
    await expect(frame).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const bounds = BrowserWindow.getAllWindows()[0]?.getBounds();
      return bounds ? { width: bounds.width, height: bounds.height } : null;
    })).toEqual({ width: 1120, height: 720 });
    await expect(page.getByTestId("project-navigator")).toHaveCSS("width", "264px");
    // At the minimum window Preview has the whole focus column and Details is still there.
    await expect(details).toBeVisible();
    expect(await page.locator(".terminal-grid-column").evaluate((node) => node.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(420);
    expect((await preview.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(420);
    await expectSameNode(xtermHandle, xterm);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);

    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = null;
    const refusedRequest = page.waitForEvent("requestfailed", (request) =>
      request.url() === url && request.failure()?.errorText === "net::ERR_CONNECTION_REFUSED",
    );
    await preview.getByRole("button", { name: "Reload" }).click();
    await refusedRequest;
    await expect(page.getByText("Preview is offline")).toBeVisible({ timeout: 5_000 });
    await expect(frame).toHaveCount(0);
    await expectSameNode(xtermHandle, xterm);
    harness.expectConnectionRefused(url);
    await expect(preview).toBeVisible();

    const screenshotPath = testInfo.outputPath("preview-tab-offline-1120x720.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("preview-tab-offline-1120x720.png", {
      path: screenshotPath,
      contentType: "image/png",
    });

    // Escape hands the keyboard back to the terminal.
    await preview.getByRole("button", { name: "Reload" }).focus();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(input).toBeFocused();
    await expectSameNode(xtermHandle, xterm);

    harness.assertNoRuntimeErrors();
  } finally {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    await harness.closeActiveTerminals();
  }
});

async function expectSameNode(before: ElementHandle<HTMLElement | SVGElement>, current: Locator): Promise<void> {
  const after = await current.elementHandle();
  if (!after) throw new Error("Expected the current xterm host.");
  expect(await before.evaluate((node, next) => node.isSameNode(next) && node.isConnected, after)).toBe(true);
}

async function expectControls(tab: Locator, panel: Locator): Promise<void> {
  const id = await panel.getAttribute("id");
  expect(id).toBeTruthy();
  await expect(tab).toHaveAttribute("aria-controls", id!);
}
