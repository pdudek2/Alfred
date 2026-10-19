import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test, type ElectronHarness } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

// The smallest valid PNG: one transparent pixel.
const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
// Codex 0.163 tracks the mouse, including bare movement.
const MOUSE_TRACKING = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";

test("previews the file behind a sent Codex [Image #1] from the rollout its hook names", async ({ harness }) => {
  const { page } = harness;
  const { marker, tile } = await startCodexWithSentImage(harness);

  // The sent message, then the composer.
  await appendFile(marker, `${MOUSE_TRACKING}› [Image #1] look\n\n› Ask Codex to do anything\n`);
  await hoverPlaceholder(page, tile);
  const peek = tile.locator(".terminal-image-peek");
  await expect(peek).toContainText("Screenshot 11.52.png");
  // The terminal reported the movement to Codex (the PTY echoes it), so tracking was on during the hover.
  await expect.poll(() => terminalBuffer(page)).toContain("[<35;");
  await expect.poll(() => peek.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

test("keeps the preview and opens it on ⌘-click while Codex redraws the message", async ({ harness }) => {
  const { app, page } = harness;
  const { image, marker, tile } = await startCodexWithSentImage(harness);
  // Quick Look would open on screen; record what it was asked to show instead.
  await app.evaluate(({ BrowserWindow }) => {
    const shown: string[] = [];
    (globalThis as { alfredQuickLook?: string[] }).alfredQuickLook = shown;
    BrowserWindow.prototype.previewFile = (file: string) => {
      shown.push(file);
    };
  });

  // Codex draws on its alternate screen and, while it works, redraws the rows around the message many times a second.
  const frame = "\x1b[5;1H› [Image #1] look\x1b[7;1H› Ask Codex to do anything";
  await appendFile(marker, `\x1b[?1049h\x1b[H\x1b[2J${MOUSE_TRACKING}${frame}`);
  let working = true;
  const redraws = (async () => {
    while (working) {
      await appendFile(marker, frame);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })();

  try {
    await hoverPlaceholder(page, tile);
    const peek = tile.locator(".terminal-image-peek");
    await expect(peek).toContainText("Screenshot 11.52.png");
    const visible: boolean[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      visible.push(await peek.isVisible());
      await page.waitForTimeout(25);
    }
    expect(visible).toEqual(Array(20).fill(true));

    await page.keyboard.down("Meta");
    for (let click = 0; click < 5; click += 1) {
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(60);
    }
    await page.keyboard.up("Meta");
    await expect.poll(() => app.evaluate(() => (globalThis as { alfredQuickLook?: string[] }).alfredQuickLook)).toEqual(Array(5).fill(image));
  } finally {
    working = false;
    await redraws;
  }
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

/** A Codex session whose hook named a rollout with one sent message, "[Image #1] look", and its screenshot. */
async function startCodexWithSentImage(harness: ElectronHarness): Promise<{ image: string; marker: string; tile: Locator }> {
  const { page, paths } = harness;
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Codex/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const tile = page.locator('[data-testid="terminal-tile"][data-session-id="codex-1"]');
  await expect(tile).toContainText("codex fixture ready");
  const files = await readdir(paths.root);
  const marker = path.join(paths.root, files.find((name) => name.startsWith("alfred-codex-fixture-"))!);
  const [socketPath, sessionId] = (await readFile(path.join(paths.root, files.find((name) => name.startsWith("alfred-codex-hook-"))!), "utf8"))
    .trim()
    .split("\n");

  // What Codex 0.163 records for a message sent with a pasted screenshot.
  const image = path.join(paths.root, "Screenshot 11.52.png");
  await writeFile(image, PIXEL_PNG);
  const rollout = path.join(paths.root, "rollout-2026-10-19T10-56-29.jsonl");
  const content = [
    { type: "input_text", text: `<image name=[Image #1] path="${image}">` },
    { type: "input_text", text: "</image>" },
    { type: "input_text", text: "[Image #1] look" },
  ];
  await writeFile(rollout, `${JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content } })}\n`);
  // The hook Codex runs when the message is sent, as Alfred's relay forwards it.
  await new Promise<void>((resolve, reject) => {
    const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit", transcript_path: rollout, prompt: "[Image #1] look" });
    const socket = net.connect(socketPath!, () => socket.end(`${JSON.stringify({ sessionId, event: "UserPromptSubmit", payload })}\n`));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
  await expect(tile).toHaveClass(/session-working/);
  return { image, marker, tile };
}

async function hoverPlaceholder(page: Page, tile: Locator): Promise<void> {
  // xterm draws spaces as no-break spaces, which \s matches.
  const sent = tile.locator(".xterm-rows > div").filter({ hasText: /^›\s\[Image\s#1\]\slook\s*$/ });
  await expect(sent).toHaveCount(1);
  // Where the "[" of the placeholder is drawn, however xterm splits the row into elements.
  const bracket = await sent.evaluate((row) => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent!.indexOf("[Image");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y: y + height / 2, width };
    }
    throw new Error("Expected [Image in the row.");
  });
  // Two moves, so xterm sees the pointer arrive over the placeholder.
  await page.mouse.move(bracket.x + bracket.width * 0.5, bracket.y);
  await page.mouse.move(bracket.x + bracket.width * 3.5, bracket.y);
}

async function terminalBuffer(page: Page): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === "codex-1")?.buffer ?? "";
}
