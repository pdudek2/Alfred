import { appendFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { neutralScreenshotPointer } from "./support/privacy-safe-screenshot";

// Fixture item 1 is a blocked draft in Alpha (Needs you); Beta gets a Codex session kept busy;
// the five folderless projects fold into Sandboxes.
test.use({ fixtureOptions: { activeWorkspaceId: "A", blockedInboxItem: 1, inboxItems: 1, projectShell: true } });

test("the rail shows one state glyph per project and folds rootless projects into Sandboxes", async ({ harness }, testInfo) => {
  const { app, page, paths } = harness;
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Rail Preview Fixture</title><main>Preview fixture ready</main>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let keepBusy: NodeJS.Timeout | undefined;

  try {
    await setWindowSize(app, page, 1440, 900);
    const rail = page.getByRole("navigation", { name: "Projects and Free Chats" });
    const alpha = rail.getByRole("button", { name: "Fixture Alpha project" });
    const beta = rail.getByRole("button", { name: "Fixture Beta project" });

    await beta.click();
    await startSession(page, /^Codex/);
    await expect(page.locator('[data-testid="terminal-tile"]:visible')).toContainText("codex fixture ready");
    // The fixture agent prints once; keep its output flowing so Beta stays Working, not Your turn.
    const markers = (await readdir(paths.root)).filter((name) => name.startsWith("alfred-codex-fixture-"));
    expect(markers).toHaveLength(1);
    keepBusy = setInterval(() => void appendFile(path.join(paths.root, markers[0]!), "working\n"), 1_000);

    await alpha.click();
    await startSession(page, /^Terminal/);

    await expect(alpha.locator(".project-row-state")).toHaveClass(/status-needs-you/);
    await expect(alpha).toHaveAccessibleDescription("needs you");
    await expect(beta.locator(".project-row-state")).toHaveClass(/status-working/);
    const sandboxes = rail.getByRole("button", { name: "Sandboxes, 5 projects" });
    await expect(sandboxes).toHaveAttribute("aria-expanded", "false");
    await expect(sandboxes).toHaveText("Sandboxes5");
    await expect(sandboxes.locator(".project-row-state")).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Fixture Gamma project" })).toHaveCount(0);
    await expect(rail.locator(".project-session[data-session-id^='manual-']")).toHaveCount(0);
    await expect(rail.locator("kbd")).toHaveCount(0);

    await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
    await page.screenshot({ path: testInfo.outputPath("deck-rail-1440x900.png") });

    await sandboxes.click();
    const gamma = rail.getByRole("button", { name: "Fixture Gamma project" });
    await expect(gamma).toBeVisible();
    await expect(gamma).toHaveClass(/is-calm/);
    await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
    await page.screenshot({ path: testInfo.outputPath("deck-rail-sandboxes-1440x900.png") });

    // Preview at the minimum window compacts the rail to short labels with the glyph in the corner.
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const input = page.locator('[data-testid="terminal-tile"]:visible').getByRole("textbox", { name: "Terminal input" });
    await input.fill(`printf 'Ready at ${url}\\n'`);
    await input.press("Enter");
    await setWindowSize(app, page, 1120, 720);
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByLabel("Project preview")).toBeVisible();
    await expect(page.getByTestId("project-navigator")).toHaveCSS("width", "46px");
    await expect(alpha.locator(".project-row-monogram")).toHaveText("FA");
    await expect(alpha.locator(".project-row-state")).toBeVisible();
    await expect(beta.locator(".project-row-state")).toBeVisible();
    await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
    await page.screenshot({ path: testInfo.outputPath("deck-rail-preview-1120x720.png") });

    harness.assertNoRuntimeErrors();
  } finally {
    if (keepBusy) clearInterval(keepBusy);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await harness.closeActiveTerminals();
  }
});

async function startSession(page: Page, kind: RegExp): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: kind }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
}
