import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./support/electron-app";

test("Preview cannot navigate Alfred or open a privileged popup", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(request.url === "/"
      ? '<!doctype html><title>Preview fixture</title><a target="_top" href="/takeover">Navigate top</a><a target="_blank" href="/popup">Open popup</a>'
      : '<!doctype html><title>Foreign document</title><main>Foreign document</main>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const entryUrl = page.url();
    const input = page.getByRole("textbox", { name: "Terminal input" }).first();
    await input.fill(`printf 'Ready at ${url}\\n'`);
    await input.press("Enter");
    await page.getByRole("button", { name: "Preview", exact: true }).click();

    const preview = page.frameLocator("iframe[title^='Preview of']");
    await expect(preview.getByRole("link", { name: "Navigate top" })).toBeVisible();
    const screenshotPath = testInfo.outputPath("preview-security-live.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("preview-security-live.png", { path: screenshotPath, contentType: "image/png" });
    await preview.getByRole("link", { name: "Navigate top" }).click();
    expect(page.url()).toBe(entryUrl);
    await expect(preview.getByRole("link", { name: "Navigate top" })).toBeVisible();
    await expect.poll(() => {
      harness.expectRendererError(
        "The frame attempting navigation of the top-level window is sandboxed, but the flag of " +
        "'allow-top-navigation' or 'allow-top-navigation-by-user-activation' is not set.",
      );
      return true;
    }).toBe(true);

    await preview.getByRole("link", { name: "Open popup" }).click();
    expect(app.windows()).toHaveLength(1);
    await expect.poll(() => {
      harness.expectRendererError(
        "because the request was made in a sandboxed frame whose 'allow-popups' permission is not set.",
      );
      return true;
    }).toBe(true);
    expect(await page.evaluate(async () => {
      const bridge = (window as Window & { alfredDesktop?: { terminal: { list(): Promise<{ sessions: unknown[] }> } } }).alfredDesktop;
      return (await bridge?.terminal.list())?.sessions.length;
    })).toBeGreaterThanOrEqual(1);

    try {
      await app.evaluate(({ BrowserWindow }, target) => BrowserWindow.getAllWindows()[0]!.loadURL(target), `${url}takeover`);
      await page.waitForURL(`${url}takeover`);
      const foreign = await page.evaluate(async () => {
        const bridge = (window as Window & { alfredDesktop?: { terminal: { list(): Promise<unknown> } } }).alfredDesktop;
        try {
          await bridge?.terminal.list();
          return { bridge: Boolean(bridge), denied: false };
        } catch (error) {
          return { bridge: Boolean(bridge), denied: String(error).includes("Untrusted IPC sender.") };
        }
      });
      expect(foreign).toEqual({ bridge: true, denied: true });
      await expect.poll(() => {
        harness.expectMainError("Error occurred in handler for 'alfred:terminal:list': Error: Untrusted IPC sender.");
        return true;
      }).toBe(true);
    } finally {
      await app.evaluate(({ BrowserWindow }, target) => BrowserWindow.getAllWindows()[0]!.loadURL(target), entryUrl);
      await page.waitForURL(entryUrl);
    }
  } finally {
    try {
      await harness.close();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
