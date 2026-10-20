import type { ElementHandle, Locator, Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test("pins the shell under a Claude focus 3:2, types into it, and unpins it without remounting", async ({ harness }) => {
  const { page } = harness;
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Claude/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const focusTile = page.locator('[data-testid="terminal-tile"][data-session-id="claude-1"]');
  const shellTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  await expect(focusTile).not.toHaveAttribute("aria-hidden", "true");
  await expect(shellTile).toHaveAttribute("aria-hidden", "true");
  const focusHost = await handle(focusTile.getByTestId("xterm-host"));
  const shellHost = await handle(shellTile.getByTestId("xterm-host"));
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText("Claude");

  const stack = page.getByRole("complementary", { name: /^Other sessions in / });
  await stack.locator('[data-session-id="manual-1"]').hover();
  await stack.getByRole("button", { name: "Pin under the focus" }).click();

  await expect(shellTile).not.toHaveAttribute("aria-hidden", "true");
  await expect(shellTile).toHaveAttribute("aria-label", /^Pinned: /);
  await expect(stack.locator('[data-session-id="manual-1"]')).toHaveCount(0);
  await expect(shellTile.getByRole("button", { name: /^Unpin / })).toBeFocused();
  const [focusBox, shellBox] = [await focusTile.boundingBox(), await shellTile.boundingBox()];
  expect(focusBox && shellBox && focusBox.y + focusBox.height < shellBox.y).toBe(true);
  expect(focusBox!.height / shellBox!.height).toBeGreaterThan(1.4);
  expect(focusBox!.height / shellBox!.height).toBeLessThan(1.6);
  await expectSameNode(focusHost, focusTile.getByTestId("xterm-host"));
  await expectSameNode(shellHost, shellTile.getByTestId("xterm-host"));

  // Typing in the pinned shell reaches its PTY and leaves the focus on Claude.
  await shellTile.getByTestId("xterm-host").click();
  await page.keyboard.type("echo pinned-input");
  await page.keyboard.press("Enter");
  await expect.poll(() => terminalBuffer(page, "manual-1")).toContain("pinned-input");
  await expect(breadcrumb).toContainText("Claude");

  await shellTile.getByRole("button", { name: /^Unpin / }).click();
  await expect(shellTile).toHaveAttribute("aria-hidden", "true");
  await expect(stack.locator('[data-session-id="manual-1"]')).toHaveCount(1);
  await expect(focusTile).toBeFocused();
  await expectSameNode(focusHost, focusTile.getByTestId("xterm-host"));
  await expectSameNode(shellHost, shellTile.getByTestId("xterm-host"));
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function handle(locator: Locator): Promise<ElementHandle<HTMLElement>> {
  const element = await locator.elementHandle();
  if (!element) throw new Error("Expected the xterm host to be attached.");
  return element as ElementHandle<HTMLElement>;
}

async function expectSameNode(before: ElementHandle<HTMLElement>, current: Locator): Promise<void> {
  const after = await handle(current);
  expect(await before.evaluate((node, next) => node.isSameNode(next) && node.isConnected, after)).toBe(true);
}

async function terminalBuffer(page: Page, clientId: string): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === clientId)?.buffer ?? "";
}
