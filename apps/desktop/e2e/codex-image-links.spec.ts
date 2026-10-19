import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

// The smallest valid PNG: one transparent pixel.
const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("previews the file behind a sent Codex [Image #1] from the rollout its hook names", async ({ harness }) => {
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

  // Codex 0.163 tracks the mouse, including bare movement; then the sent message and its composer.
  await appendFile(marker, "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h› [Image #1] look\n\n› Ask Codex to do anything\n");
  // xterm draws spaces as no-break spaces, which \s matches.
  const sent = tile.locator(".xterm-rows > div").filter({ hasText: /^›\s\[Image\s#1\]\slook\s*$/ });
  await expect(sent).toHaveCount(1);
  const box = (await sent.boundingBox())!;
  const cell = await sent.locator("span").first().evaluate((element) => element.getBoundingClientRect().width / element.textContent!.length);
  // A move inside the row first, so xterm sees the pointer arrive over the placeholder.
  await page.mouse.move(box.x + cell * 4, box.y + box.height / 2);
  await page.mouse.move(box.x + cell * 6.5, box.y + box.height / 2);
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

async function terminalBuffer(page: Page): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === "codex-1")?.buffer ?? "";
}
