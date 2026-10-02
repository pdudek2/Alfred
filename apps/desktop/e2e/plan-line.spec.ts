import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { openPlan } from "./support/plan-line";
import { neutralScreenshotPointer, privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";
import { settleTerminalTileAnimations } from "./support/work-layout";

const evidenceDir = path.resolve(import.meta.dirname, "../../../output/playwright/plan-line");

// Fixture Alpha gets items 1, 3 and 5 (5 is blocked by preflight); Fixture Beta gets 2 and 4.
test.use({ fixtureOptions: { inboxItems: 5, blockedInboxItem: 5, activeWorkspaceId: "A" } });

test("launches and discards drafts from the plan line without touching live terminals", async ({ harness }) => {
  const { app, page } = harness;
  await mkdir(evidenceDir, { recursive: true });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);

  const planLine = page.locator(".plan-line");
  const trigger = planLine.locator(".plan-line__disclose");
  await expect(trigger).toContainText("Fixture plan");
  await expect(trigger).toContainText("3 drafts · 1 needs you");
  await expect(planLine.getByRole("button", { name: "Launch 2 ready drafts" })).toBeEnabled();
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Empty project" })).toContainText("Nothing is running");
  await capture(page, "drafts-only");

  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New manual terminal" }).click();
  const manualId = await page.getByTestId("terminal-tile").first().getAttribute("data-session-id");
  const xtermHost = page.locator(`[data-session-id="${manualId}"] [data-testid="xterm-host"]`);
  await expect(xtermHost.locator(".xterm-screen")).toBeAttached();
  const hostBefore = await requiredHandle(xtermHost, "manual xterm host");
  await settleTerminalTileAnimations(page);
  const tileBefore = await geometry(page.getByTestId("terminal-tile").first());
  await capture(page, "closed");

  // The list overlays the terminals instead of pushing them down.
  const drafts = await openPlan(page);
  await expect(drafts.getByRole("listitem")).toHaveCount(3);
  await expect(drafts.getByRole("listitem", { name: "Draft Fixture item 5" }))
    .toContainText("Blocked: Fixture safety policy blocks launch outside the approved root.");
  await expect(drafts.getByRole("button", { name: "Launch Fixture item 1" })).toBeFocused();
  expect(await geometry(page.getByTestId("terminal-tile").first())).toEqual(tileBefore);
  await capture(page, "open");

  await page.keyboard.press("ArrowDown");
  await expect(drafts.getByRole("button", { name: "Launch Fixture item 3" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drafts).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expectSameNode(hostBefore, xtermHost, "opening the plan replaced the live xterm host");

  await openPlan(page);
  await drafts.getByRole("button", { name: "Launch Fixture item 1" }).click();
  await expect(page.locator('[data-session-id="fixture-item-1"] .xterm-screen')).toBeAttached();
  await expect(drafts.getByRole("listitem")).toHaveCount(2);
  await expect(drafts.getByRole("button", { name: "Launch Fixture item 3" })).toBeFocused();
  await expectSameNode(hostBefore, xtermHost, "launching a draft replaced the live xterm host");

  await page.keyboard.press("Escape");
  await planLine.getByRole("button", { name: "Launch 1 ready draft" }).click();
  await expect(page.locator('[data-session-id="fixture-item-3"] .xterm-screen')).toBeAttached();
  await expect(trigger).toContainText("1 draft · 1 needs you");
  await expect(planLine.getByRole("button", { name: "Launch ready drafts" })).toBeDisabled();

  await openPlan(page);
  await drafts.getByRole("button", { name: "Discard Fixture item 5" }).click();
  await expect(planLine).toHaveCount(0);
  await expectSameNode(hostBefore, xtermHost, "removing the plan line replaced the live xterm host");
  await expect(page.getByRole("button", { name: "Needs you, 0 sessions" })).toHaveCount(0);

  // The other project's drafts stay on its own line.
  await page.getByRole("button", { name: "Fixture Beta project" }).click();
  await expect(page.locator(".plan-line__disclose")).toContainText("2 drafts");
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function capture(page: Page, name: string): Promise<void> {
  await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
  await page.screenshot({ path: path.join(evidenceDir, `plan-line-${name}.png`), style: privacySafeScreenshotStyle });
}

async function geometry(locator: Locator) {
  return locator.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  });
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`Missing ${label}`);
  return handle as ElementHandle<HTMLElement>;
}

async function expectSameNode(before: ElementHandle<HTMLElement>, current: Locator, message: string): Promise<void> {
  const after = await requiredHandle(current, message);
  expect(await before.evaluate((node, next) => node.isSameNode(next) && node.isConnected, after), message).toBe(true);
}
