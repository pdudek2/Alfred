import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test("keeps a Codex approval as Needs you while the mouse moves over and clicks its terminal", async ({ harness }) => {
  const { page, paths } = harness;
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Codex/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const tile = page.locator('[data-testid="terminal-tile"][data-session-id="codex-1"]');
  const host = tile.getByTestId("xterm-host");
  await expect.poll(() => terminalBuffer(page)).toContain("codex fixture ready");
  const markers = (await readdir(paths.root)).filter((name) => name.startsWith("alfred-codex-fixture-"));
  expect(markers).toHaveLength(1);

  // As Codex 0.163 does: turn on any-motion mouse tracking, then ask for approval.
  await appendFile(
    path.join(paths.root, markers[0]!),
    "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b]9;Approval requested: /bin/zsh -lc 'touch probe.txt'\x07",
  );
  await expect(tile).toHaveClass(/session-needs-you/);

  const box = (await host.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await host.click();
  // The terminal reported the pointer to Codex: the PTY echoes the SGR mouse reports.
  await expect.poll(() => terminalBuffer(page)).toContain("[<35;");
  // Sampled, not awaited: a cleared approval comes back on its own after 15 s of quiet output, which a real
  // Codex never gives while it animates its prompt.
  const states: string[] = [];
  for (let sample = 0; sample < 10; sample += 1) {
    states.push(/session-needs-you/.test((await tile.getAttribute("class")) ?? "") ? "needs-you" : "other");
    await page.waitForTimeout(100);
  }
  expect(states).toEqual(Array(10).fill("needs-you"));

  await page.keyboard.type("y");
  await expect(tile).not.toHaveClass(/session-needs-you/);
});

async function terminalBuffer(page: Page): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === "codex-1")?.buffer ?? "";
}
