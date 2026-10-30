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
  const { marker, tile } = await startCodexWithSentMessages(harness, [{ text: "[Image #1] look", image: "Screenshot 11.52.png" }]);

  // The sent message, then the composer.
  await appendFile(marker, `${MOUSE_TRACKING}› [Image #1] look\n\n› Ask Codex to do anything\n`);
  await hoverPlaceholder(page, sentRow(tile, /^›\s\[Image\s#1\]\slook\s*$/));
  const peek = tile.locator(".terminal-image-peek");
  await expect(peek).toContainText("Screenshot 11.52.png");
  // The terminal reported the movement to Codex (the PTY echoes it), so tracking was on during the hover.
  await expect.poll(() => terminalBuffer(page)).toContain("[<35;");
  await expect.poll(() => peek.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);
});

test("tells screenshots sent on their own apart and keeps their preview while Codex redraws", async ({ harness }) => {
  test.skip(process.platform !== "darwin", "Command-click opens Quick Look, which Alfred has only on macOS.");
  const { app, page, paths } = harness;
  // Screenshots sent with no words are all "[Image #1]"; the message before them pins which is which.
  const { marker, tile } = await startCodexWithSentMessages(harness, [
    { text: "[Image #1]", image: "first.png" },
    { text: "kontynuuj" },
    { text: "[Image #1]", image: "second.png" },
    { text: "[Image #1]", image: "third.png" },
  ]);
  // Quick Look would open on screen; record what it was asked to show instead.
  await app.evaluate(({ BrowserWindow }) => {
    const shown: string[] = [];
    (globalThis as { alfredQuickLook?: string[] }).alfredQuickLook = shown;
    BrowserWindow.prototype.previewFile = (file: string) => {
      shown.push(file);
    };
  });

  // Codex draws on its alternate screen and, while it works, redraws the rows around the messages many times a second.
  const frame = "\x1b[3;1H› kontynuuj\x1b[5;1H› [Image #1]\x1b[7;1H› [Image #1]\x1b[9;1H› Ask Codex to do anything";
  await appendFile(marker, `\x1b[?1049h\x1b[H\x1b[2J${MOUSE_TRACKING}${frame}`);
  let working = true;
  const redraws = (async () => {
    while (working) {
      await appendFile(marker, frame);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })();

  try {
    const screenshots = sentRow(tile, /^›\s\[Image\s#1\]\s*$/);
    await expect(screenshots).toHaveCount(2);
    const peek = tile.locator(".terminal-image-peek");
    await hoverPlaceholder(page, screenshots.first());
    await expect(peek).toContainText("second.png");
    await hoverPlaceholder(page, screenshots.last());
    await expect(peek).toContainText("third.png");
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
    await expect.poll(() => app.evaluate(() => (globalThis as { alfredQuickLook?: string[] }).alfredQuickLook))
      .toEqual(Array(5).fill(path.join(paths.root, "third.png")));
  } finally {
    working = false;
    await redraws;
  }
});

test("keeps the previews while Codex pins a scrolled-off message to the top row", async ({ harness }) => {
  const { page } = harness;
  const { marker, tile } = await startCodexWithSentMessages(harness, [
    { text: "stworz plik hello word na desktopie" },
    { text: "kontynuuj" },
    { text: "[Image #1]", image: "first.png" },
    { text: "[Image #1]", image: "second.png" },
    { text: "hej" },
  ]);
  // As Codex 0.163 draws a resumed session: "kontynuuj" scrolled off, so a copy of it is pinned to the top row,
  // and the end of its reply is drawn right under it.
  const screen = (underPinned: string) => [
    "\x1b[H\x1b[2J",
    `\x1b[1;1H› kontynuuj\x1b[2;1H${underPinned}`,
    "\x1b[5;1H› [Image #1]\x1b[8;1H• Komunikat dotyczył pierwszej próby.\x1b[10;1H  Worked for 11s • 11:52",
    "\x1b[13;1H› [Image #1]\x1b[16;1H• Widzę pusty, ciemny obszar.\x1b[18;1H  Worked for 5s • 13:32",
    "\x1b[21;1H› hej\x1b[24;1H› Ask Codex to do anything",
  ].join("");
  await appendFile(marker, `\x1b[?1049h${MOUSE_TRACKING}${screen("  Worked for 24s • Oct 18 at 12:14")}`);

  const screenshots = sentRow(tile, /^›\s\[Image\s#1\]\s*$/);
  await expect(screenshots).toHaveCount(2);
  const peek = tile.locator(".terminal-image-peek");
  await hoverPlaceholder(page, screenshots.first());
  await expect(peek).toContainText("first.png");
  await hoverPlaceholder(page, screenshots.last());
  await expect(peek).toContainText("second.png");

  // Scrolled by a row, a blank row is under the pinned copy instead.
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);
  await appendFile(marker, screen(""));
  await expect(sentRow(tile, /Worked\sfor\s24s/)).toHaveCount(0);
  await hoverPlaceholder(page, screenshots.first());
  await expect(peek).toContainText("first.png");
});

type SentMessage = { text: string; image?: string };

/** A Codex session whose hook named a rollout with these sent messages, as Codex 0.163 records them. */
async function startCodexWithSentMessages(harness: ElectronHarness, sent: SentMessage[]): Promise<{ marker: string; tile: Locator }> {
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

  // Each message is the user message carrying its image's path, then the UserMessage that marks it as sent.
  const rollout = path.join(paths.root, "rollout-2026-10-19T10-56-29.jsonl");
  const lines: string[] = [];
  for (const { text, image } of sent) {
    const imagePath = image ? path.join(paths.root, image) : undefined;
    if (imagePath) await writeFile(imagePath, PIXEL_PNG);
    const tags = imagePath ? [{ type: "input_text", text: `<image name=[Image #1] path="${imagePath}">` }, { type: "input_text", text: "</image>" }] : [];
    const content = [...tags, { type: "input_text", text }];
    const item = { type: "UserMessage", content: [...(imagePath ? [{ type: "local_image", path: imagePath }] : []), { type: "text", text }] };
    lines.push(JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content } }));
    lines.push(JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item } }));
  }
  await writeFile(rollout, `${lines.join("\n")}\n`);
  // The hook Codex runs when a message is sent, as Alfred's relay forwards it.
  await new Promise<void>((resolve, reject) => {
    const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit", transcript_path: rollout, prompt: sent.at(-1)!.text });
    const socket = net.connect(socketPath!, () => socket.end(`${JSON.stringify({ sessionId, event: "UserPromptSubmit", payload })}\n`));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
  await expect(tile).toHaveClass(/session-working/);
  return { marker, tile };
}

// xterm draws spaces as no-break spaces, which \s matches.
function sentRow(tile: Locator, text: RegExp): Locator {
  return tile.locator(".xterm-rows > div").filter({ hasText: text });
}

async function hoverPlaceholder(page: Page, row: Locator): Promise<void> {
  await expect(row).toHaveCount(1);
  // Where the "[" of the placeholder is drawn, however xterm splits the row into elements.
  const bracket = await row.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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
