import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { openNewSession } from "./support/work-layout";

test.use({ fixtureOptions: { previewDeploy: true } });

const builtRenderer = path.resolve(import.meta.dirname, "../dist/renderer");

/** A release folder holding a copy of the built renderer, marked so the test can tell which one the window shows. */
async function release(deployRoot: string, name: string, mainHash: string): Promise<void> {
  const dir = path.join(deployRoot, "releases", name);
  const renderer = path.join(dir, "apps", "desktop", "dist", "renderer");
  await cp(builtRenderer, renderer, { recursive: true });
  const index = path.join(renderer, "index.html");
  await writeFile(index, (await readFile(index, "utf8")).replace("<head>", `<head><meta name="alfred-release" content="${name}">`));
  await writeFile(path.join(deployRoot, "ready.json"), JSON.stringify({
    sha: `${name}0000000000`, ref: "a-branch", subject: `Release ${name}`, mainHash, electron: "/unused/Electron", path: dir,
  }));
}

test("loads a release that changes only the window with a reload, while the terminal keeps running", async ({ harness }) => {
  const { page, paths } = harness;
  const deployRoot = path.join(paths.root, "deploy");

  await openNewSession(page);
  const sheet = page.getByRole("form", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Terminal/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"]:visible');
  await tile.getByTestId("xterm-host").click();
  await page.keyboard.type("echo PID:$$");
  await page.keyboard.press("Enter");
  await expect(tile).toContainText(/PID:\d+/);
  const pid = (await tile.innerText()).match(/PID:(\d+)/)![1];

  const banner = page.getByRole("status", { name: "New version" });
  await expect(banner).toHaveCount(0);
  await release(deployRoot, "next", "same");
  await expect(banner).toContainText("New version ready");
  await expect(banner).toContainText("next000 Release next");
  await banner.getByRole("button", { name: "Reload window" }).click();

  // The window now shows the other release's renderer, and the shell it reattached to is the same process.
  await expect(page.locator('meta[name="alfred-release"]')).toHaveAttribute("content", "next");
  await expect(banner).toHaveCount(0);
  const reloaded = page.locator('[data-testid="terminal-tile"]:visible');
  await reloaded.getByTestId("xterm-host").click();
  await page.keyboard.type("echo AGAIN:$$");
  await page.keyboard.press("Enter");
  await expect(reloaded).toContainText(`AGAIN:${pid}`);
  expect((await readFile(path.join(deployRoot, "running.json"), "utf8"))).toContain(path.join("releases", "own"));

  // A release with other main-process code asks for a restart; Later puts it away.
  await release(deployRoot, "main-change", "other");
  await expect(banner).toContainText("main-ch Release main-change");
  await expect(banner.getByRole("button", { name: "Restart Alfred" })).toBeVisible();
  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toHaveCount(0);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});
