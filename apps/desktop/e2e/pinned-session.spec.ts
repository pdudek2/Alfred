import type { ElementHandle, Locator, Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";
import { startAgent, treeRow } from "./support/work-layout";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test("pins an agent under a Claude focus 3:2, types into it, and unpins it without remounting", async ({ harness }) => {
  const { page } = harness;
  // Only agents pin; the first one waits while the second takes the focus.
  const pinTile = await startAgent(page, "claude-1");
  const focusTile = await startAgent(page, "claude-2");
  await expect(focusTile).not.toHaveAttribute("aria-hidden", "true");
  await expect(pinTile).toHaveAttribute("aria-hidden", "true");
  const focusHost = await handle(focusTile.getByTestId("xterm-host"));
  const pinHost = await handle(pinTile.getByTestId("xterm-host"));
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText("Claude");

  // Pin sits on the agent's row in the rail's tree; the pinned row stays listed but offers no second Pin.
  const pinRow = treeRow(page, "claude-1");
  const pinEntry = pinRow.locator("xpath=..");
  await pinRow.hover();
  await pinEntry.getByRole("button", { name: "Pin under the focus" }).click();

  await expect(pinTile).not.toHaveAttribute("aria-hidden", "true");
  await expect(pinTile).toHaveAttribute("aria-label", /^Pinned: /);
  await expect(pinEntry.getByRole("button", { name: "Pin under the focus" })).toHaveCount(0);
  await expect(pinTile.getByRole("button", { name: /^Unpin / })).toBeFocused();
  const [focusBox, pinBox] = [await focusTile.boundingBox(), await pinTile.boundingBox()];
  expect(focusBox && pinBox && focusBox.y + focusBox.height < pinBox.y).toBe(true);
  expect(focusBox!.height / pinBox!.height).toBeGreaterThan(1.4);
  expect(focusBox!.height / pinBox!.height).toBeLessThan(1.6);
  await expectSameNode(focusHost, focusTile.getByTestId("xterm-host"));
  await expectSameNode(pinHost, pinTile.getByTestId("xterm-host"));

  // Typing in the pinned agent reaches its PTY and leaves the focus where it was.
  await pinTile.getByTestId("xterm-host").click();
  await page.keyboard.type("echo pinned-input");
  await page.keyboard.press("Enter");
  await expect.poll(() => terminalBuffer(page, "claude-1")).toContain("pinned-input");
  await expect(breadcrumb).toContainText("Claude");

  // Beside the focus, half and half (v5 Split), and back under it, without remounting either terminal.
  await pinTile.getByRole("button", { name: /beside the focus$/ }).click();
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/pin-beside/);
  const [leftBox, rightBox] = [await focusTile.boundingBox(), await pinTile.boundingBox()];
  expect(leftBox!.x + leftBox!.width).toBeLessThan(rightBox!.x);
  expect(Math.abs(leftBox!.width - rightBox!.width)).toBeLessThan(4);
  await expectSameNode(focusHost, focusTile.getByTestId("xterm-host"));
  await expectSameNode(pinHost, pinTile.getByTestId("xterm-host"));
  await pinTile.getByRole("button", { name: /under the focus$/ }).click();
  await expect(page.getByTestId("terminal-grid")).not.toHaveClass(/pin-beside/);

  await pinTile.getByRole("button", { name: /^Unpin / }).click();
  await expect(pinTile).toHaveAttribute("aria-hidden", "true");
  await expect(pinEntry.getByRole("button", { name: "Pin under the focus" })).toHaveCount(1);
  await expect(focusTile).toBeFocused();
  await expectSameNode(focusHost, focusTile.getByTestId("xterm-host"));
  await expectSameNode(pinHost, pinTile.getByTestId("xterm-host"));
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
