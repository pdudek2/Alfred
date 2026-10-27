import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { treeRow } from "./support/work-layout";

test("plain terminals report Idle at the prompt and Running while a program holds the foreground", async ({ harness }) => {
  const { page } = harness;
  // The focused session's state is the glyph beside its title in the breadcrumb.
  const status = page.getByRole("navigation", { name: "Breadcrumb" }).locator(".session-status-glyph");
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();

  // Fresh shell: no output timing involved, the shell itself is in the foreground.
  await expect(status).toHaveAttribute("aria-label", "status idle");

  await input.fill("sleep 4");
  await input.press("Enter");
  await expect(status).toHaveAttribute("aria-label", "status running");

  await expect(status).toHaveAttribute("aria-label", "status idle", { timeout: 15_000 });
});

test("a plain terminal goes by the program it runs and says where it serves, then by its own name at the prompt", async ({ harness }) => {
  const { page, paths } = harness;
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  const status = breadcrumb.locator(".session-status-glyph");
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();
  const row = treeRow(page, "manual-1");
  await writeFile(path.join(paths.root, "serve.js"), [
    "const server = require('node:http').createServer((_request, response) => response.end('<h1>served</h1>'));",
    "server.listen(0, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}/`));",
  ].join("\n"));
  await expect(breadcrumb).toContainText("zsh");

  // A program that ends at once names nothing.
  await input.fill("sleep 0.2");
  await input.press("Enter");
  await expect(status).toHaveAttribute("aria-label", "status idle");
  await page.waitForTimeout(1_500);
  await expect(breadcrumb).not.toContainText("sleep");

  await input.fill(`cd '${paths.root}' && '${process.execPath}' serve.js`);
  await input.press("Enter");
  await expect(breadcrumb).toContainText("node serve.js");
  await expect(row).toContainText("node serve.js");
  await expect(row).toContainText(/Serving on port \d+/);
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.locator(".workspace-preview-source")).toHaveText("from node serve.js");
  await page.getByRole("tab", { name: "Terminal" }).click();

  await input.press("Control+C");
  await expect(status).toHaveAttribute("aria-label", "status idle");
  await expect(breadcrumb).not.toContainText("node serve.js");
  await expect(row).toContainText("zsh");
  await expect(row).not.toContainText("Serving");
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});
