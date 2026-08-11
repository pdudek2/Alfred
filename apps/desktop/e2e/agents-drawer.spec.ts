import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { neutralScreenshotPointer, privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";

const evidenceDir = path.resolve(import.meta.dirname, "../../../output/playwright/agents-drawer-production");

test.use({
  fixtureOptions: {
    handoffDiff: true,
    inboxItems: 1,
    projectShell: true,
  },
});

test("keeps active agents and decisions visible without reflowing the terminal", async ({ harness }) => {
  const { app, page } = harness;
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 900);

  const navigator = page.getByRole("navigation", { name: "Projects and Free Chats" });
  await addSession(page, "New Codex session");
  await navigator.getByRole("button", { name: /Fixture Beta workspace/i }).click();
  await addSession(page, "New Claude session");
  await navigator.getByRole("button", { name: /Fixture Alpha workspace/i }).click();

  const xtermHost = page.locator('[data-session-id="codex-1"] [data-testid="xterm-host"]');
  await expect(xtermHost).toBeAttached();
  const xtermHostBefore = await requiredHandle(xtermHost, "connected Codex xterm host");

  const trigger = page.getByRole("button", { name: "Agents, 2 active" });
  await expect(trigger).toBeVisible();
  const alphaProject = navigator.getByRole("button", { name: "Fixture Alpha workspace" });
  const betaProject = navigator.getByRole("button", { name: "Fixture Beta workspace" });
  await expect(alphaProject).toBeVisible();
  await expect(alphaProject).toHaveAccessibleDescription("1 decision needs review, 1 active agent");
  await expect(betaProject).toBeVisible();
  await expect(betaProject).toHaveAccessibleDescription("1 active agent");

  const grid = page.getByTestId("terminal-grid");
  const gridBefore = await elementGeometry(grid);
  await trigger.click();

  const drawer = page.getByRole("complementary", { name: "Agents" });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Agents" })).toBeFocused();
  await expect(drawer.getByRole("region", { name: "Needs a decision" })).toContainText("Fixture item 1");
  await expect(drawer.getByRole("region", { name: "In progress" })).toContainText("Codex · session 1");
  await expect(drawer.getByRole("region", { name: "In progress" })).toContainText("Claude · session 1");

  const gridAfter = await elementGeometry(grid);
  const triggerBox = await trigger.boundingBox();
  const drawerBox = await drawer.boundingBox();
  if (!triggerBox || !drawerBox) throw new Error("Expected visible shell geometry.");
  expect(gridAfter).toEqual(gridBefore);
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(drawerBox.x);
  expect(await navigator.evaluate((node) => node.getBoundingClientRect().width)).toBe(226);
  expect(await drawer.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(328, 1);
  expect(await documentOverflow(page)).toBe(0);

  await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-drawer-wide-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });

  const decisionHandoff = drawer.getByRole("button", { name: /Review handoff for Fixture item 1/i });
  await decisionHandoff.click();
  await expect(drawer.getByRole("heading", { name: "Handoff", exact: true })).toBeVisible();
  const back = drawer.getByRole("button", { name: "Back to Agents" });
  await expect(back).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Decision" })).toBeVisible();
  const primaryAction = drawer.getByRole("button", { name: "Launch Fixture item 1" });
  await primaryAction.focus();
  await expect(primaryAction).toBeFocused();
  await page.screenshot({
    path: path.join(evidenceDir, "agents-handoff-wide-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(decisionHandoff).toBeFocused();

  await openFixtureDiffHandoff(page, drawer);
  const openDiff = drawer.getByRole("button", { name: "Open diff" });
  await openDiff.focus();
  await expect(openDiff).toBeFocused();
  await openDiff.click();
  const diff = page.getByRole("region", { name: "Worktree diff" });
  await expect(diff).toBeVisible();
  await expect(diff.getByRole("button", { name: "Close diff" })).toBeFocused();
  await expectRealDiff(diff);
  await expectSameNode(xtermHostBefore, xtermHost, "wide diff replaced the connected xterm host");
  expect(await documentOverflow(page)).toBe(0);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-real-diff-wide-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });
  await page.keyboard.press("Escape");
  await expect(diff).toBeHidden();
  await expect.poll(() => terminalOwnsFocus(page)).toBe(true);
  await expectSameNode(xtermHostBefore, xtermHost, "closing wide diff replaced the connected xterm host");

  await setWindowSize(app, page, 1120, 720);
  await navigator.getByRole("button", { name: "Collapse project navigator" }).click();
  await expect(navigator).toHaveCSS("width", "46px");
  const gridNarrowBefore = await elementGeometry(grid);
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expect(navigator).toHaveCSS("width", "46px");
  expect(await navigator.evaluate((node) => node.getBoundingClientRect().width)).toBe(46);
  expect(await drawer.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(300, 1);
  expect(await elementGeometry(grid)).toEqual(gridNarrowBefore);
  expect(await documentOverflow(page)).toBe(0);

  await openFixtureDiffHandoff(page, drawer);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-handoff-narrow-1120x720.png"),
    style: privacySafeScreenshotStyle,
  });
  await drawer.getByRole("button", { name: "Open diff" }).click();
  await expectRealDiff(diff);
  await expectSameNode(xtermHostBefore, xtermHost, "narrow diff replaced the connected xterm host");
  expect(await documentOverflow(page)).toBe(0);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-real-diff-narrow-1120x720.png"),
    style: privacySafeScreenshotStyle,
  });
  await diff.getByRole("button", { name: "Close diff" }).click();
  await expect(diff).toBeHidden();
  await expect.poll(() => terminalOwnsFocus(page)).toBe(true);
  await expectSameNode(xtermHostBefore, xtermHost, "closing narrow diff replaced the connected xterm host");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  await openFixtureDiffHandoff(page, drawer);
  expect(await drawer.evaluate((node) =>
    Math.max(...getComputedStyle(node).transitionDuration.split(", ").map(Number.parseFloat)),
  )).toBeLessThanOrEqual(0.000_001);
  expect(await drawer.locator(".agents-drawer__handoff").evaluate((node) =>
    [node, ...node.querySelectorAll("*")].every((element) =>
      getComputedStyle(element).transitionDuration.split(", ").every((duration) =>
        Number.parseFloat(duration) <= 0.000_001,
      ),
    ),
  )).toBe(true);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-handoff-reduced-motion-1120x720.png"),
    style: privacySafeScreenshotStyle,
  });
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("heading", { name: "Agents" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  harness.assertNoRuntimeErrors();
});

async function addSession(page: Page, name: "New Codex session" | "New Claude session"): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name }).click();
}

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

async function openFixtureDiffHandoff(page: Page, drawer: Locator): Promise<void> {
  const review = drawer.getByRole("button", { name: "Review handoff for Fixture diff handoff" });
  const transitionedFromList = await review.count() > 0;
  if (transitionedFromList) {
    await review.focus();
    await page.keyboard.press("Enter");
  }
  await expect(drawer.getByRole("heading", { name: "Handoff", exact: true })).toBeVisible();
  if (transitionedFromList) {
    await expect(drawer.getByRole("button", { name: "Back to Agents" })).toBeFocused();
  }
  await expect(drawer.getByText("alfred-codex-fixture-handoff", { exact: true })).toBeVisible();
  const primaryAction = drawer.getByRole("button", { name: "Resume Fixture diff handoff" });
  await primaryAction.focus();
  await expect(primaryAction).toBeFocused();
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
