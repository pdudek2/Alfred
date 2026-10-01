import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { neutralScreenshotPointer, privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";

const evidenceDir = path.resolve(import.meta.dirname, "../../../output/playwright/needs-you-production");

test.use({
  fixtureOptions: {
    blockedInboxItem: 1,
    handoffDiff: true,
    inboxItems: 2,
    projectShell: true,
  },
});

test("lists only blocked sessions across projects without reflowing the terminal", async ({ harness }) => {
  const { app, page } = harness;
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 900);

  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New Codex session" }).click();
  const xtermHost = page.locator('[data-session-id="codex-1"] [data-testid="xterm-host"]');
  await expect(xtermHost).toBeAttached();
  const xtermHostBefore = await requiredHandle(xtermHost, "connected Codex xterm host");

  // Fixture item 1 is blocked by preflight; Fixture item 2 is a plain draft
  // and must stay out of Needs you.
  const trigger = page.getByRole("button", { name: "Needs you, 1 session" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("1 needs you");
  const grid = page.getByTestId("terminal-grid");
  const gridBefore = await elementGeometry(grid);

  await trigger.click();
  const popover = page.getByRole("dialog", { name: "Needs you" });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("list", { name: "Blocked on you" }).getByRole("listitem")).toHaveCount(1);
  await expect(popover).toContainText("Fixture item 1");
  await expect(popover).toContainText("Fixture safety policy blocks launch outside the approved root.");
  await expect(popover).not.toContainText("Fixture item 2");
  const edit = popover.getByRole("button", { name: /^Edit Fixture item 1 in / });
  await expect(edit).toBeFocused();
  expect(await elementGeometry(grid)).toEqual(gridBefore);
  expect(await popover.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1440);
  expect(await documentOverflow(page)).toBe(0);
  await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
  await page.screenshot({
    path: path.join(evidenceDir, "needs-you-wide-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectSameNode(xtermHostBefore, xtermHost, "opening Needs you replaced the connected xterm host");

  // The shortcut must work while a terminal owns the keyboard, and Escape
  // hands the keyboard back to that terminal.
  await xtermHost.click();
  await expect.poll(() => terminalOwnsFocus(page)).toBe(true);
  // Ctrl+J is a newline inside Claude and shells; the terminal keeps it.
  await page.keyboard.press("Control+J");
  await expect(popover).toBeHidden();
  await expect.poll(() => terminalOwnsFocus(page)).toBe(true);
  await page.keyboard.press("Meta+J");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect.poll(() => terminalOwnsFocus(page)).toBe(true);

  await setWindowSize(app, page, 1120, 720);
  await page.keyboard.press("Meta+J");
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1120);
  expect(await documentOverflow(page)).toBe(0);
  await page.screenshot({
    path: path.join(evidenceDir, "needs-you-narrow-1120x720.png"),
    style: privacySafeScreenshotStyle,
  });

  await edit.click();
  await expect(popover).toBeHidden();
  const context = page.getByRole("complementary", { name: "Session context" });
  await expect(context).toBeVisible();
  await expect(context.getByRole("button", { name: "Close Context panel" })).toBeFocused();
  await expectSameNode(xtermHostBefore, xtermHost, "Needs you Edit replaced the connected xterm host");
  harness.assertNoRuntimeErrors();
});

test("reviews the real diff of an asleep checkout without replacing the live xterm", async ({ harness }) => {
  const { app, page } = harness;
  await setWindowSize(app, page, 1440, 900);

  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New Codex session" }).click();
  const xtermHost = page.locator('[data-session-id="codex-1"] [data-testid="xterm-host"]');
  await expect(xtermHost).toBeAttached();
  const xtermHostBefore = await requiredHandle(xtermHost, "connected Codex xterm host");

  await page.getByRole("button", { name: /^Browse \d+ asleep sessions?$/ }).click();
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  await expect(sessions).toBeVisible();
  await sessions.getByRole("listbox", { name: "Session results" })
    .getByRole("option", { name: /Fixture diff handoff/ }).click();
  await sessions.getByRole("toolbar", { name: "Asleep checkout actions" })
    .getByRole("button", { name: "Review diff" }).click();

  const diff = page.getByRole("region", { name: "Worktree diff" });
  await expect(diff).toBeVisible();
  await expectRealDiff(diff);
  await expectSameNode(xtermHostBefore, xtermHost, "the diff replaced the connected xterm host");
  expect(await documentOverflow(page)).toBe(0);
  await page.screenshot({
    path: path.join(evidenceDir, "asleep-real-diff-wide-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });

  await diff.getByRole("button", { name: "Close diff" }).click();
  await expect(diff).toBeHidden();
  await expectSameNode(xtermHostBefore, xtermHost, "closing the diff replaced the connected xterm host");
  harness.assertNoRuntimeErrors();
});

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ ...window.getBounds(), ...size });
  }, { width, height });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const bounds = BrowserWindow.getAllWindows()[0]?.getBounds();
    return bounds ? { width: bounds.width, height: bounds.height } : null;
  })).toEqual({ width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width,
    height,
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function terminalOwnsFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('[data-testid="terminal-tile"]') !== null);
}

async function expectRealDiff(diff: Locator): Promise<void> {
  await expect(diff.getByText("1 changed file", { exact: true })).toBeVisible();
  await expect(diff.locator(".worktree-diff-panel__additions")).toHaveText("+1");
  await expect(diff.locator(".worktree-diff-panel__deletions")).toHaveText("−1");
  await expect(diff.getByRole("list", { name: "Changed files" })).toContainText("handoff-status.txt");
  await expect(diff.locator(".kind-add")).toContainText("+handoff status: ready");
  await expect(diff.locator(".kind-remove")).toContainText("-handoff status: pending");
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function expectSameNode(
  before: ElementHandle<HTMLElement>,
  current: Locator,
  message: string,
): Promise<void> {
  const after = await requiredHandle(current, message);
  expect(await before.evaluate((node, next) => node.isSameNode(next) && node.isConnected, after), message).toBe(true);
}

async function elementGeometry(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  return locator.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  });
}
