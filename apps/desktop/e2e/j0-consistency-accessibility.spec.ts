import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { collectControlOverflowEvidence } from "./support/control-overflow-evidence";
import { privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";

test.use({
  fixtureOptions: {
    externalSessionFixture: "mixed",
    inboxItems: 1,
    restoredSessions: 1,
  },
});

test("keeps J0 utility surfaces accessible without replacing xterm", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  await setWindowSize(app, page, 1440, 900);

  const workScreen = page.locator(".xterm-screen").first();
  await expect(workScreen).toBeAttached();
  const screenBefore = await requiredHandle(workScreen, "initial Work xterm screen");

  const workspaceTrigger = page.getByRole("button", { name: "Workspace menu for Fixture Alpha" });
  await workspaceTrigger.click();
  const workspaceActions = page.getByRole("dialog", { name: "Workspace actions" });
  await expect(workspaceActions).toBeVisible();
  await expectMinimumHeight(workspaceActions.getByRole("button").first(), 40);
  await expectFont(workspaceActions.locator("button strong").first(), "13px", false);
  await page.keyboard.press("Escape");
  await expect(workspaceTrigger).toBeFocused();

  const launchTrigger = page.getByRole("button", { name: "Open launch menu" });
  await launchTrigger.click();
  await page.getByRole("menuitem", { name: "Prepare Work" }).click();
  const prepareWork = page.getByRole("dialog", { name: "Prepare Work" });
  await expect(prepareWork).toBeVisible();
  await expectFont(prepareWork.getByRole("button").first(), "13px", false);
  await page.keyboard.press("Escape");
  await expect(launchTrigger).toBeFocused();

  const paletteTrigger = page.getByRole("button", { name: "Open command palette" });
  await paletteTrigger.click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expectMinimumHeight(palette.getByRole("option").first(), 40);
  await expectFont(palette.locator("[role='option'] span").first(), "13px", false);
  await palette.getByRole("textbox", { name: "Search commands" }).fill("no-such-command");
  await expect(palette.getByRole("status")).toHaveText("No matching command.");
  await page.keyboard.press("Escape");
  await expect(paletteTrigger).toBeFocused();

  const surfacesTrigger = page.getByRole("button", { name: "Open Surfaces menu" });
  await selectSurface(page, "Context");
  const context = page.getByRole("complementary", { name: "Session context" });
  await expect(context).toBeVisible();
  await context.getByRole("button", { name: "Close Context panel" }).click();
  await expect(surfacesTrigger).toBeFocused();

  await selectSurface(page, "Local Data & Privacy");
  const privacy = page.getByRole("dialog", { name: "Local Data & Privacy" });
  await expect(privacy).toBeVisible();
  await expectMinimumHeight(privacy.getByRole("button", { name: "Redacted tail" }), 32);
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: ".privacy-panel button:not(:disabled), .privacy-panel .privacy-toggle",
    verticalScrollOwners: [{ id: "privacy-body", label: "Privacy body", selector: ".privacy-panel-body" }],
  })).toEqual([]);
  await privacy.getByRole("button", { name: "Close privacy controls" }).click();
  await expect(surfacesTrigger).toBeFocused();

  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  const inbox = page.getByRole("region", { name: "Inbox workspace" });
  await expect(inbox).toBeVisible();
  await expectMinimumHeight(inbox.locator(".inbox-docket__primary"), 32);
  await inbox.getByRole("button", { name: "Back to Work" }).click();

  await selectSurface(page, "Sessions");
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  await sessions
    .getByRole("listbox", { name: "Conversation results" })
    .getByRole("option", { name: /Mapped resumable session 01/i })
    .click();
  const runDetailsTrigger = page.getByRole("button", { name: "Run details" });
  await expectMinimumHeight(runDetailsTrigger, 32);

  await page.screenshot({
    path: testInfo.outputPath("j0-consistency-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });

  await setWindowSize(app, page, 1120, 720);
  await runDetailsTrigger.click();
  const runDetails = page.getByRole("complementary", { name: "Run details" });
  await expect(runDetails).toBeVisible();
  await expectMinimumHeight(runDetails.getByRole("button", { name: "Close Run details" }), 32);
  await expect(page.locator(".sessions-reader__scroll")).toBeHidden();
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: ".sessions-run-details button:not(:disabled)",
    verticalScrollOwners: [{
      id: "run-details",
      label: "Run details",
      selector: ".sessions-run-details",
    }],
  })).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("j0-consistency-1120x720.png"),
    style: privacySafeScreenshotStyle,
  });
  await runDetails.getByRole("button", { name: "Close Run details" }).click();
  await expect(runDetailsTrigger).toBeFocused();

  await selectSurface(page, "Work");
  const screenAfter = await requiredHandle(page.locator(".xterm-screen").first(), "restored Work xterm screen");
  expect(await screenBefore.evaluate(
    (before, after) => before.isSameNode(after) && before.isConnected,
    screenAfter,
  )).toBe(true);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function selectSurface(
  page: Page,
  surface: "Work" | "Sessions" | "Context" | "Local Data & Privacy",
): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function expectMinimumHeight(locator: Locator, minimum: number): Promise<void> {
  await expect(locator).toBeVisible();
  expect((await locator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(minimum);
}

async function expectFont(locator: Locator, size: string, monospace: boolean): Promise<void> {
  await expect(locator).toBeVisible();
  const style = await locator.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { family: computed.fontFamily, size: computed.fontSize };
  });
  expect(style.size).toBe(size);
  expect(style.family.toLowerCase().includes("mono")).toBe(monospace);
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width,
    height,
  });
}
