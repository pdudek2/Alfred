import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("plain terminals report Idle at the prompt and Running while a program holds the foreground", async ({ harness }) => {
  const { page } = harness;
  // A shell's state is the glyph on its drawer tab.
  const status = shellTab(page).locator(".session-status-glyph");
  const input = shellInput(page);

  // Fresh shell: no output timing involved, the shell itself is in the foreground.
  await expect(status).toHaveAttribute("aria-label", "status idle");

  await input.fill("sleep 4");
  await input.press("Enter");
  await expect(status).toHaveAttribute("aria-label", "status running");

  await expect(status).toHaveAttribute("aria-label", "status idle", { timeout: 15_000 });
});

test("a plain terminal goes by the program it runs and says where it serves, then by its own name at the prompt", async ({ harness }) => {
  const { page, paths } = harness;
  // A shell is named on its drawer tab, which also carries the port it serves on.
  const tab = shellTab(page);
  const port = tab.locator(".shell-drawer-tab-port");
  const status = tab.locator(".session-status-glyph");
  const input = shellInput(page);
  await writeFile(path.join(paths.root, "serve.js"), [
    "const server = require('node:http').createServer((_request, response) => response.end('<h1>served</h1>'));",
    "server.listen(0, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}/`));",
  ].join("\n"));
  await expect(tab).toContainText("zsh");

  // A program that ends at once names nothing.
  await input.fill("sleep 0.2");
  await input.press("Enter");
  await expect(status).toHaveAttribute("aria-label", "status idle");
  await page.waitForTimeout(1_500);
  await expect(tab).not.toContainText("sleep");

  await input.fill(`cd '${paths.root}' && '${process.execPath}' serve.js`);
  await input.press("Enter");
  await expect(tab).toContainText("node serve.js");
  await expect(port).toHaveText(/^:\d+$/);
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.locator(".workspace-preview-source")).toHaveText("from node serve.js");
  // Leaving Preview removes its frame; a frame removed while its process starts makes Chromium log an error.
  await expect(page.frameLocator('iframe[title^="Preview of "]').getByText("served")).toBeVisible();
  await page.getByRole("tab", { name: "Terminal" }).click();

  await input.press("Control+C");
  await expect(status).toHaveAttribute("aria-label", "status idle");
  await expect(tab).not.toContainText("node serve.js");
  await expect(tab).toContainText("zsh");
  await expect(port).toHaveCount(0);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

function shellTab(page: Page): Locator {
  return page.getByRole("tablist", { name: "Shells" }).locator('[role="tab"][data-session-id="manual-1"]');
}

function shellInput(page: Page): Locator {
  return page.locator('.terminal-tile[data-session-id="manual-1"]').getByRole("textbox", { name: "Terminal input" });
}
