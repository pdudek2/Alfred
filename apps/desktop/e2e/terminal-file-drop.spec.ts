import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test("pastes the path of a file dropped on a live Claude terminal", async ({ harness }) => {
  const { page } = harness;
  const dir = await mkdtemp(path.join(os.tmpdir(), "alfred-drop-"));
  const file = path.join(dir, "Screenshot 11.52.png");
  await writeFile(file, "not really a png");

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Claude/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const host = page.locator('[data-session-id="claude-1"] [data-testid="xterm-host"]');
  await expect(host).toBeAttached();
  await expect.poll(() => terminalBuffer(page)).toContain("claude fixture ready");

  // A real file input gives the File a path on disk, as Finder does on a drag.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "drop-source";
    input.hidden = true;
    document.body.append(input);
  });
  await page.setInputFiles("#drop-source", file);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add((document.getElementById("drop-source") as HTMLInputElement).files![0]!);
    return transfer;
  });

  await host.dispatchEvent("dragenter", { dataTransfer });
  await host.dispatchEvent("dragover", { dataTransfer });
  const overlay = page.locator('[data-session-id="claude-1"] .terminal-drop-overlay');
  await expect(overlay).toHaveText(/Drop to attach to Claude\s*The file path goes into the prompt/);

  // The whole session box takes the file, strip included, and the overlay dims it all (Drop board).
  const strip = page.locator('[data-testid="terminal-tile"][data-session-id="claude-1"] .session-strip');
  await strip.dispatchEvent("dragenter", { dataTransfer });
  await host.dispatchEvent("dragleave", { dataTransfer });
  await expect(overlay).toBeVisible();
  const [overlayBox, stripBox] = [await overlay.boundingBox(), await strip.boundingBox()];
  expect(overlayBox!.y + overlayBox!.height).toBeGreaterThanOrEqual(stripBox!.y + stripBox!.height);
  expect(overlayBox!.x).toBeLessThanOrEqual(stripBox!.x);

  await strip.dispatchEvent("drop", { dataTransfer });
  await expect(overlay).toBeHidden();
  await expect.poll(() => terminalBuffer(page)).toContain(`${dir}/Screenshot\\ 11.52.png `);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
  await rm(dir, { recursive: true, force: true });
});

async function terminalBuffer(page: import("@playwright/test").Page): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === "claude-1")?.buffer ?? "";
}
