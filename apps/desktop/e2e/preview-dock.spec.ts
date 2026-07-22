import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ElementHandle, Locator } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("Preview stays on demand and preserves xterm while loaded, resized, and offline", async ({ harness }, testInfo) => {
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

    const previewToggle = page.getByRole("button", { name: "Preview" });
    await expect(previewToggle).toBeEnabled();
    await expect(previewToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Workspace preview")).toHaveCount(0);

    await previewToggle.click();
    const preview = page.getByLabel("Workspace preview");
    const frame = page.getByTitle(`Preview of ${url}`);
    await expect(preview).toBeVisible();
    await expect(frame).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview of ${url}"]`).getByText("Preview fixture ready")).toBeVisible();
    await expectSameNode(xtermHandle, xterm);

    const divider = page.getByRole("separator", { name: "Resize Preview" });
    await divider.press("ArrowLeft");
    await expect(divider).toHaveAttribute("aria-valuenow", "516");
    await expectSameNode(xtermHandle, xterm);

    await page.getByRole("button", { name: "Close Preview" }).click();
    await expect(previewToggle).toBeFocused();
    await expect(preview).toHaveCount(0);
    await expectSameNode(xtermHandle, xterm);

    await previewToggle.click();
    await expect(frame).toBeVisible();
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = null;
    const refusedRequest = page.waitForEvent("requestfailed", (request) =>
      request.url() === url && request.failure()?.errorText === "net::ERR_CONNECTION_REFUSED",
    );
    await page.getByRole("button", { name: "More Preview actions" }).click();
    await page.getByRole("menuitem", { name: "Refresh preview" }).click();
    await refusedRequest;
    await expect(page.getByText("Preview is offline")).toBeVisible({ timeout: 5_000 });
    await expect(frame).toHaveCount(0);
    await expectSameNode(xtermHandle, xterm);
    harness.expectConnectionRefused(url);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const bounds = BrowserWindow.getAllWindows()[0]?.getBounds();
      return bounds ? { width: bounds.width, height: bounds.height } : null;
    })).toEqual({ width: 1120, height: 720 });
    await expect(preview).toBeVisible();
    await expect(xterm).toBeVisible();
    await expect(input).toBeVisible();
    await expectSameNode(xtermHandle, xterm);

    const screenshotPath = testInfo.outputPath("preview-dock-offline-1120x720.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("preview-dock-offline-1120x720.png", {
      path: screenshotPath,
      contentType: "image/png",
    });

    harness.assertNoRuntimeErrors();
  } finally {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    await harness.closeActiveTerminals();
  }
});

async function expectSameNode(before: ElementHandle<HTMLElement>, current: Locator): Promise<void> {
  const after = await current.elementHandle();
  if (!after) throw new Error("Expected the current xterm host.");
  expect(await before.evaluate((node, next) => node.isSameNode(next) && node.isConnected, after)).toBe(true);
}
