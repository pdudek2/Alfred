import { cp, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { launchedAgent, sendHook, type LaunchedAgent } from "./support/fixture-agents";
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
  // Alfred offers only a release whose Electron lies inside it; a restart would run that binary.
  await mkdir(path.join(dir, "electron"), { recursive: true });
  await writeFile(path.join(dir, "electron", "Electron"), "");
  await writeFile(path.join(deployRoot, "ready.json"), JSON.stringify({
    sha: `${name}0000000000`, ref: "a-branch", subject: `Release ${name}`, mainHash, electron: path.join(dir, "electron", "Electron"), path: dir,
  }));
}

test("loads a release that changes only the window with a reload, while the terminal keeps running", async ({ harness }) => {
  const { page, paths } = harness;
  const deployRoot = path.join(paths.root, "deploy");

  // The project's first shell, in the drawer.
  const tile = page.locator('.terminal-tile[data-session-id="manual-1"]');
  // Keys typed before the shell draws its prompt can be dropped while it starts its line editor.
  await expect(tile).toContainText(/[%$#]/);
  await tile.locator(".xterm-host").click();
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
  const reloaded = page.locator('.terminal-tile[data-session-id="manual-1"]');
  await reloaded.locator(".xterm-host").click();
  await page.keyboard.type("echo AGAIN:$$");
  await page.keyboard.press("Enter");
  await expect(reloaded).toContainText(`AGAIN:${pid}`);
  // The launcher starts the reloaded release next time; the main process still runs from the one it started in.
  expect(await realpath(path.join(deployRoot, "current"))).toBe(await realpath(path.join(deployRoot, "releases", "next")));
  expect(JSON.parse(await readFile(path.join(deployRoot, "running.json"), "utf8")).release).toBe(await realpath(path.join(deployRoot, "releases", "own")));

  // A release with other main-process code asks for a restart; Later puts it away.
  await release(deployRoot, "main-change", "other");
  await expect(banner).toContainText("main-ch Release main-change");
  await expect(banner.getByRole("button", { name: "Restart Alfred" })).toBeVisible();
  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toHaveCount(0);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

test("restarts for a main-process release once Claude is idle, and resumes every agent in its conversation, twice", async ({ harness }) => {
  const { app, paths } = harness;
  let { page } = harness;
  const deployRoot = path.join(paths.root, "deploy");
  const conversations = { alpha: "6f1c2a4e-8b1d-4c3e-9f2a-0d5e7b8c9a10", beta: "0b7a1d22-3c4e-4f5a-8b9c-1d2e3f4a5b6c" };
  // Every launch of the fixture Claude, by the conversation it resumed.
  const resumesOf = async (conversation: string) => {
    let count = 0;
    for (const name of await readdir(paths.root)) {
      if (!/^alfred-claude-args-\d+$/.test(name)) continue;
      const args = (await readFile(path.join(paths.root, name), "utf8")).split("\n").slice(0, -1);
      if (args.slice(-2).join(" ") === `--resume ${conversation}`) count += 1;
    }
    return count;
  };
  const startClaude = async (project: string) => {
    await openNewSession(page);
    const sheet = page.getByRole("form", { name: "New session", exact: true });
    await sheet.getByRole("button", { name: "Choose project", exact: true }).click();
    await page.getByRole("menuitemradio", { name: project }).click();
    await sheet.getByRole("radio", { name: /^Claude/ }).click();
    await sheet.getByRole("button", { name: "Start", exact: true }).click();
  };

  // Each fixture launch, in no particular order: its args and where its hooks report.
  const launches = async () => {
    const found: LaunchedAgent[] = [];
    for (const name of await readdir(paths.root)) {
      const [, pid] = /^alfred-claude-args-(\d+)$/.exec(name) ?? [];
      if (!pid) continue;
      const args = (await readFile(path.join(paths.root, name), "utf8")).split("\n").slice(0, -1);
      const [socketPath, sessionId] = (await readFile(path.join(paths.root, `alfred-claude-hook-${pid}`), "utf8").catch(() => "")).trim().split("\n");
      if (socketPath && sessionId) found.push({ args, socketPath, sessionId });
    }
    return found;
  };
  await startClaude("Fixture Beta");
  const beta = await launchedAgent(paths.root, "claude", (args) => !args.includes("--resume"));
  await sendHook(beta, "Stop", { session_id: conversations.beta, last_assistant_message: "Ready." });
  await startClaude("Fixture Alpha");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toContainText("claude fixture ready");
  let alphaAgent: LaunchedAgent | undefined;
  await expect.poll(async () => {
    alphaAgent = (await launches()).find((launch) => launch.sessionId !== beta.sessionId);
    return alphaAgent !== undefined;
  }).toBe(true);
  // Its hooks name its conversation, then it starts working.
  await sendHook(alphaAgent!, "Stop", { session_id: conversations.alpha, last_assistant_message: "Ready." });
  await sendHook(alphaAgent!, "UserPromptSubmit", { session_id: conversations.alpha, prompt: "Refactor the parser" });

  const banner = page.getByRole("status", { name: "New version" });
  await release(deployRoot, "main-change", "other");
  await banner.getByRole("button", { name: "Restart when idle" }).click();
  await expect(banner).toContainText("Restart waits for");
  await expect(banner).toContainText("Claude");
  // Quitting must not ask: answering "Cancel" would keep Alfred open and the test waiting.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });

  let restarted = await harness.restartFromApp(() => sendHook(alphaAgent!, "Stop", { session_id: conversations.alpha, last_assistant_message: "Done." }));
  page = restarted.page;
  // Both come back, the one in the project that was not on screen too.
  await expect.poll(() => resumesOf(conversations.alpha)).toBe(1);
  await expect.poll(() => resumesOf(conversations.beta)).toBe(1);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toContainText("claude fixture ready");
  expect(await realpath(path.join(deployRoot, "current"))).toBe(await realpath(path.join(deployRoot, "releases", "main-change")));

  // A resumed agent keeps its conversation for the next update restart, with no hook since.
  await release(deployRoot, "second", "another");
  const nextBanner = page.getByRole("status", { name: "New version" });
  await expect(nextBanner).toContainText("second0");
  restarted = await harness.restartFromApp(async () => {
    await restarted.app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 0;
    });
    await nextBanner.getByRole("button", { name: "Restart Alfred" }).click();
  });
  await expect.poll(() => resumesOf(conversations.alpha)).toBe(2);
  await expect.poll(() => resumesOf(conversations.beta)).toBe(2);
  await harness.closeActiveTerminals();
});
