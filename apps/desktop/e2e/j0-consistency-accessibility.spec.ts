import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { collectControlOverflowEvidence } from "./support/control-overflow-evidence";
import { privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";

test.use({
  fixtureOptions: {
    externalSessionFixture: "mixed",
    handoffDiff: true,
    inboxItems: 1,
    restoredSessions: 1,
  },
});

test("keeps J0 utility surfaces accessible without replacing xterm", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  await setWindowSize(app, page, 1440, 900);
  await showWindowForNativeObservation(app);

  await page.getByRole("toolbar", { name: "Work layout controls" })
    .getByRole("button", { name: "New terminal" })
    .click();
  const workScreen = page.locator(".xterm-screen").first();
  await expect(workScreen).toBeAttached();
  const screenBefore = await requiredHandle(workScreen, "initial Work xterm screen");
  await expectFixedCellTerminalFont(page.locator(".xterm-rows").first(), "12.5px");
  await expectSansFont(page.getByTestId("terminal-tile").first().locator(".tile-title small"));

  const runtimeId = await page.evaluate(async () => {
    const terminalApi = window.alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    const runtime = (await terminalApi.list()).sessions.find((session) => session.clientId === "manual-1");
    if (!runtime) throw new Error("Manual terminal runtime is missing.");
    return runtime.id;
  });
  const terminalEvidence = "ZAŻÓŁĆ_GĘŚLĄ_JAŹŃ";
  const terminalEvidenceCommand = [
    "printf '%s\\n' '+------+----------------+\\n| ANSI | fixed cell     |\\n+------+----------------+'",
    "printf '%b\\n' '\\033[31mANSI czerwony\\033[0m'",
    "printf '%s\\n' '/Users/alfred/very/long/path/with-punctuation--[]{}()!@#$%^&+=/session-trust-work-polish.txt'",
    "printf '%s\\n' 'git diff -- apps/desktop/src/renderer/styles.css; pnpm test -- --runInBand?!'",
    `printf '%s\\n' '${terminalEvidence}'`,
  ].join("; ");
  await page.evaluate(({ id, data }) => {
    const terminalApi = window.alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    terminalApi.write({ id, data: `${data}\r` });
  }, { id: runtimeId, data: terminalEvidenceCommand });
  await expect.poll(() => workScreen.textContent()).toContain(terminalEvidence);
  await expectNativeTerminalInk(app, workScreen);
  await page.screenshot({
    path: testInfo.outputPath("j0-sans-xterm-1440x900.png"),
  });
  await page.getByRole("toolbar", { name: "Work layout controls" })
    .getByRole("button", { name: "New terminal" })
    .click();

  const workspaceTrigger = page.getByRole("button", { name: "Workspace menu for Fixture Alpha" });
  await workspaceTrigger.click();
  const workspaceActions = page.getByRole("dialog", { name: "Workspace actions" });
  await expect(workspaceActions).toBeVisible();
  await expectMinimumHeight(workspaceActions.getByRole("button").first(), 40);
  await expectSansFont(workspaceActions.locator("button strong").first(), "13px");
  await page.keyboard.press("Escape");
  await expect(workspaceTrigger).toBeFocused();

  const launchTrigger = page.getByRole("button", { name: "Open launch menu" });
  await launchTrigger.click();
  await page.getByRole("menuitem", { name: "Prepare Work" }).click();
  const prepareWork = page.getByRole("dialog", { name: "Prepare Work" });
  await expect(prepareWork).toBeVisible();
  await expectSansFont(prepareWork.getByRole("button").first(), "13px");
  await page.keyboard.press("Escape");
  await expect(launchTrigger).toBeFocused();

  const paletteTrigger = page.getByRole("button", { name: "Open command palette" });
  await paletteTrigger.click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expectMinimumHeight(palette.getByRole("option").first(), 40);
  await expectSansFont(palette.locator("[role='option'] span").first(), "13px");
  await expectSansFont(palette.locator("kbd").first());
  await palette.getByRole("textbox", { name: "Search commands" }).fill("no-such-command");
  await expect(palette.getByRole("status")).toHaveText("No matching command.");
  await page.keyboard.press("Escape");
  await expect(paletteTrigger).toBeFocused();

  const surfacesTrigger = page.getByRole("button", { name: "Open Surfaces menu" });
  await selectSurface(page, "Context");
  const context = page.getByRole("complementary", { name: "Session context" });
  await expect(context).toBeVisible();
  await expectSansFont(context);
  await context.getByRole("button", { name: "Close Context panel" }).click();
  await expect(surfacesTrigger).toBeFocused();

  await selectSurface(page, "Local Data & Privacy");
  const privacy = page.getByRole("dialog", { name: "Local Data & Privacy" });
  await expect(privacy).toBeVisible();
  await expectSansFont(privacy);
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
  await expectSansFont(inbox);
  await expectMinimumHeight(inbox.locator(".inbox-docket__primary"), 32);
  await inbox.getByRole("button", { name: "Back to Work" }).click();

  await selectSurface(page, "Sessions");
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  await expectSansFont(sessions);
  await sessions
    .getByRole("listbox", { name: "Conversation results" })
    .getByRole("option", { name: /Mapped resumable session 01/i })
    .click();
  const runDetailsTrigger = page.getByRole("button", { name: "Run details" });
  await expectMinimumHeight(runDetailsTrigger, 32);
  await expectSansFont(sessions.locator("time").first());

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
  const agentsTrigger = page.getByRole("button", { name: /^Agents,/ });
  await agentsTrigger.click();
  const agents = page.getByTestId("agents-drawer");
  await expect(agents).toHaveAttribute("aria-hidden", "false");
  await expectSansFont(agents);
  await agents.getByRole("button", { name: "Review handoff for Fixture diff handoff" }).click();
  await agents.getByRole("button", { name: "Open diff" }).click();
  const diff = page.getByRole("region", { name: "Worktree diff" });
  await expect(diff).toBeVisible();
  await expectSansFont(diff.locator(".worktree-diff-panel__files code").first());
  await expectSansFont(diff.locator(".worktree-diff-panel__line").first());
  await diff.getByRole("button", { name: "Close diff" }).click();
  await chooseWorkLayout(page, "Grid");
  const navigator = page.getByRole("navigation", { name: "Projects and Free Chats" });
  await navigator.getByRole("button", { name: "Manual · zsh 2", exact: true }).click();
  await chooseWorkLayout(page, "Focus");
  await expect(page.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeVisible();
  const hiddenFirstTerminal = page.locator(
    'article[data-testid="terminal-tile"][data-session-id="manual-1"]',
  );
  await expect(hiddenFirstTerminal).toHaveAttribute("aria-hidden", "true");
  expect(Number.parseInt(await hiddenFirstTerminal.evaluate((node) => (
    node instanceof HTMLElement ? node.style.gridRow : ""
  )), 10)).toBeGreaterThanOrEqual(9);
  await navigator.getByRole("button", { name: "Manual · zsh 1", exact: true }).click();
  const firstTerminalScreen = hiddenFirstTerminal.locator(".xterm-screen");
  await expect(hiddenFirstTerminal).not.toHaveAttribute("aria-hidden", "true");
  await expect(firstTerminalScreen).toBeVisible();
  await expect(firstTerminalScreen).toContainText(terminalEvidence);
  await expect.poll(() => hiddenFirstTerminal.evaluate((node) => (
    node instanceof HTMLElement ? node.style.gridRow : ""
  ))).toBe("1 / span 8");
  await firstTerminalScreen.locator(".xterm-helper-textarea").focus();
  await page.evaluate(() => new Promise<void>((resolve) => {
    let remainingFrames = 8;
    const nextFrame = () => {
      remainingFrames -= 1;
      if (remainingFrames === 0) resolve();
      else requestAnimationFrame(nextFrame);
    };
    requestAnimationFrame(nextFrame);
  }));
  await page.screenshot({
    path: testInfo.outputPath("j0-sans-xterm-1120x720.png"),
  });
  await expectNativeTerminalInk(app, firstTerminalScreen);

  const screenAfter = await requiredHandle(firstTerminalScreen, "restored Work xterm screen");
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

async function chooseWorkLayout(page: Page, layout: "Focus" | "Grid"): Promise<void> {
  await page.getByRole("button", { name: /^Open layout menu,/ }).click();
  await page.getByRole("menuitem", { name: layout, exact: true }).click();
}

async function expectMinimumHeight(locator: Locator, minimum: number): Promise<void> {
  await expect(locator).toBeVisible();
  expect((await locator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(minimum);
}

async function expectSansFont(locator: Locator, size?: string): Promise<void> {
  await expect(locator).toBeVisible();
  const style = await locator.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { family: computed.fontFamily, size: computed.fontSize };
  });
  if (size) expect(style.size).toBe(size);
  expect(style.family.toLowerCase()).toContain("sans-serif");
}

async function expectFixedCellTerminalFont(locator: Locator, size?: string): Promise<void> {
  await expect(locator).toBeVisible();
  const style = await locator.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { family: computed.fontFamily, size: computed.fontSize };
  });
  if (size) expect(style.size).toBe(size);
  expect(style.family).toContain("ui-monospace");
  expect(style.family).toContain("SFMono-Regular");
  expect(style.family).toContain("Menlo");
}

async function expectNativeTerminalInk(app: ElectronApplication, screen: Locator): Promise<void> {
  const bounds = await screen.boundingBox();
  if (!bounds) throw new Error("Terminal screen has no native capture bounds.");
  const pixels = await app.evaluate(async ({ BrowserWindow }, rect) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Electron window is missing.");
    return (await window.capturePage(rect)).toBitmap().toString("base64");
  }, {
    height: Math.ceil(bounds.height),
    width: Math.ceil(bounds.width),
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
  });
  const bitmap = Buffer.from(pixels, "base64");
  let inkPixels = 0;
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    if ((bitmap[offset] ?? 0) > 100 && (bitmap[offset + 1] ?? 0) > 100 && (bitmap[offset + 2] ?? 0) > 100) {
      inkPixels += 1;
    }
  }
  expect(inkPixels).toBeGreaterThan(50);
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

async function showWindowForNativeObservation(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.show();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
  )).toBe(true);
}
