import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test("passes the wheel to a program on the alternate screen, as Codex scrolls its own transcript", async ({ harness }) => {
  const { page, paths } = harness;
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Codex/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const tile = page.locator('[data-testid="terminal-tile"][data-session-id="codex-1"]');
  await expect(tile).toContainText("codex fixture ready");
  const marker = path.join(paths.root, (await readdir(paths.root)).find((name) => name.startsWith("alfred-codex-fixture-"))!);
  const screen = tile.getByTestId("xterm-host").locator(".xterm-screen");

  // Codex 0.163 draws on the alternate screen and tracks the mouse: the wheel reaches it as mouse reports.
  await appendFile(marker, "\x1b[?1049h\x1b[H\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h› Ask Codex to do anything");
  await expect(tile).toContainText("Ask Codex to do anything");
  await screen.hover();
  await page.mouse.wheel(0, -120);
  // The PTY echoes what the terminal sends: 64 is the wheel turned up.
  await expect.poll(() => terminalBuffer(page)).toContain("[<64;");

  // A program there that does not track the mouse, such as less or vim, gets the arrow keys instead.
  // xterm applies output in order, so once the text after the mode switch shows, the switch has happened.
  await appendFile(marker, "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006lMouse tracking off");
  await expect(tile).toContainText("Mouse tracking off");
  await page.mouse.wheel(0, 120);
  await expect.poll(() => terminalBuffer(page)).toContain("^[[B");
});

async function terminalBuffer(page: Page): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === "codex-1")?.buffer ?? "";
}
