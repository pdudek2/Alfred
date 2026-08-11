import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./support/electron-app";
import { chooseWorkLayout } from "./support/work-layout";

test.use({
  fixtureOptions: {
    externalSessionFixture: "mixed",
    handoffDiff: true,
    inboxItems: 1,
    waitingInboxItem: 1,
    restoredSessions: 1,
  },
});

test("keeps the production Work story trustworthy across every utility surface", async ({ harness }) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);

  // One staged row must stay visually distinct before it becomes connected live work.
  const stagedTile = page.getByTestId("terminal-tile").first();
  await expect(stagedTile).toHaveClass(/staged/);
  await expect(stagedTile.locator(".staged-body")).toBeVisible();
  await expect(stagedTile.locator(".xterm-screen")).toHaveCount(0);
  await captureAuditScreenshot(page, "work-staged-wide");
  await stagedTile.getByRole("button", { name: "Launch Fixture item 1" }).click();
  const screen = page.locator('[data-testid="terminal-tile"][data-session-id="fixture-item-1"] .xterm-screen');
  await expect(screen).toBeAttached();
  const screenBefore = await requiredHandle(screen, "launched fixture xterm");
  await expectFixedCellFont(page.locator(".xterm-rows").first());
  await expectSans(page.locator('[data-testid="terminal-tile"]').first().locator(".tile-title small"));

  // Normal Work geometry progresses through one, two, three, then many live sessions.
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/single/);
  await addTerminal(page);
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/split/);
  await addTerminal(page);
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/dense/);
  await addTerminal(page);
  await addTerminal(page);
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/many-up/);

  await createRuntimeBlockers(page, paths.root);
  const identityText = await page.locator(".tile-title, .project-session-title, .workbench-session-title").allTextContents();
  expect(identityText.join("\n")).not.toContain("\u001b");
  expect(identityText.join("\n")).not.toContain("hidden-title");
  await expect(page.getByTestId("terminal-grid").getByText("Claude authentication", { exact: true })).toBeVisible();
  await expect(page.getByTestId("terminal-grid").getByText("Codex MCP startup", { exact: true })).toBeVisible();
  await captureAuditScreenshot(page, "work-live-blockers-wide");

  const inboxTrigger = page.getByRole("button", { name: /Open Inbox surface/ });
  await inboxTrigger.click();
  const inbox = page.getByRole("region", { name: "Inbox workspace" });
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText("Not logged in", { exact: true })).toHaveCount(1);
  await expect(inbox.getByText("MCP server github failed to start: interrupted", { exact: true })).toHaveCount(1);
  await expectSans(inbox);
  await captureAuditScreenshot(page, "inbox-blockers-wide");
  const codexDecision = inbox.getByText("MCP server github failed to start: interrupted", { exact: true })
    .locator("xpath=ancestor::li[1]");
  await codexDecision.getByRole("button").first().click();
  await codexDecision.getByRole("button", { name: /Open in Work Codex MCP startup/ }).click();
  const codexTile = page.getByTestId("terminal-tile").filter({ hasText: "Codex MCP startup" });
  await expect(codexTile).toBeVisible();
  await expect(codexTile.getByRole("textbox", { name: "Terminal input" })).toBeFocused();

  await selectSurface(page, "Context");
  const context = page.getByRole("complementary", { name: "Session context" });
  await expect(context).toBeVisible();
  await expectSans(context);
  await captureAuditScreenshot(page, "context-wide");
  await context.getByRole("button", { name: "Close Context panel" }).click();
  await expect(page.getByRole("button", { name: "Open Surfaces menu" })).toBeFocused();

  await page.getByRole("button", { name: /^Agents,/ }).click();
  const agents = page.getByTestId("agents-drawer");
  await expect(agents).toHaveAttribute("aria-hidden", "false");
  await expectSans(agents);
  await agents.getByRole("button", { name: "Review handoff for Fixture diff handoff" }).click();
  await expectDrawerOpen(agents, agents.locator(".agents-drawer__handoff-primary"));
  await captureAuditScreenshot(page, "agents-handoff-wide");
  await agents.getByRole("button", { name: "Open diff" }).click();
  const diff = page.getByRole("region", { name: "Worktree diff" });
  await expect(diff).toBeVisible();
  await expectDrawerClosed(agents);
  await expectNoDocumentOrBodyOverflow(page);
  await expectWithinViewport(diff, "Worktree diff");
  await expectSans(diff.locator("code").first());
  await expectSans(diff.locator(".worktree-diff-panel__line").first());
  await captureAuditScreenshot(page, "worktree-diff-wide");
  await diff.getByRole("button", { name: "Close diff" }).click();

  await selectSurface(page, "Sessions");
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  await expect(sessions).toBeVisible();
  await expectSans(sessions.locator("time").first());
  await sessions.getByRole("listbox", { name: "Conversation results" })
    .getByRole("option", { name: /Mapped resumable session 01/i }).click();
  await captureAuditScreenshot(page, "sessions-wide");

  await page.getByRole("button", { name: "Open command palette" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expectSans(palette.locator("kbd").first());
  expect(await palette.locator(".command-palette-list").evaluate((node) => getComputedStyle(node).scrollbarColor))
    .not.toBe("auto");
  await captureAuditScreenshot(page, "command-palette-wide");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "Prepare Work" }).click();
  const prepare = page.getByRole("dialog", { name: "Prepare Work" });
  await expect(prepare).toBeVisible();
  await expectSans(prepare.getByRole("button").first());
  await captureAuditScreenshot(page, "prepare-work-wide");
  await page.keyboard.press("Escape");

  await selectSurface(page, "Local Data & Privacy");
  const privacy = page.getByRole("dialog", { name: "Local Data & Privacy" });
  await expect(privacy).toBeVisible();
  await expectSans(privacy);
  await captureAuditScreenshot(page, "privacy-wide");
  await privacy.getByRole("button", { name: "Close privacy controls" }).click();

  await selectSurface(page, "Work");
  const navigator = page.getByRole("navigation", { name: "Projects and Free Chats" });
  for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
    await setWindowSize(app, page, width, height);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await navigator.getByRole("button", { name: "Codex MCP startup", exact: true }).click();
    await chooseWorkLayout(page, "Focus");
    await expect(codexTile).toBeVisible();
    const terminalInput = codexTile.getByRole("textbox", { name: "Terminal input" });
    await terminalInput.focus();
    await expect(terminalInput).toBeFocused();
    if (width === 1440) await captureAuditScreenshot(page, "work-focus-wide-reduced-motion");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await chooseWorkLayout(page, "Split");
    if (width === 1440) await captureAuditScreenshot(page, "work-split-wide-reduced-motion");
    await chooseWorkLayout(page, "Grid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === 1120) await captureAuditScreenshot(page, "work-grid-narrow-reduced-motion");
  }

  const screenAfter = await requiredHandle(screen, "post-transition fixture xterm");
  expect(await screenBefore.evaluate((before, after) => before.isSameNode(after) && before.isConnected, screenAfter))
    .toBe(true);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

test.describe("captures protective empty and missing workspace evidence", () => {
  test("keeps an empty workspace calm while another runtime remains connected", async ({ harness }) => {
    const { app, page } = harness;
    await setWindowSize(app, page, 1120, 720);
    const navigator = page.getByRole("navigation", { name: "Projects and Free Chats" });
    await navigator.getByRole("button", { name: "Fixture Beta workspace", exact: true }).click();
    await expect(page.getByRole("status", { name: "Empty workspace" })).toBeVisible();
    await captureAuditScreenshot(page, "empty-workspace-narrow");
    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });
});

test.describe("missing workspace fixture", () => {
  test.use({ fixtureOptions: { activeWorkspaceId: "A", missingWorkspaceId: "A" } });
  test("keeps a missing workspace non-launchable", async ({ harness }) => {
    const { app, page } = harness;
    await setWindowSize(app, page, 1120, 720);
    const unavailable = page.getByRole("status", { name: "Unavailable workspace folder" });
    await expect(unavailable).toBeVisible();
    await expect(unavailable.getByRole("button", { name: "New terminal" })).toHaveCount(0);
    await captureAuditScreenshot(page, "missing-workspace-narrow");
    harness.assertNoRuntimeErrors();
  });
});

async function addTerminal(page: Page): Promise<void> {
  await page.getByRole("toolbar", { name: "Work layout controls" })
    .getByRole("button", { name: "New terminal" }).click();
}

async function createRuntimeBlockers(page: Page, fixtureRoot: string): Promise<void> {
  await createFixtureAgentSession(page, "New Claude session", "\u001b]0;hidden-title\u0007Claude authentication");
  await appendFixtureAgentOutput(fixtureRoot, "claude", "Not logged in\n");
  await createFixtureAgentSession(page, "New Codex session", "\u001b[31mCodex MCP startup\u001b[0m");
  await appendFixtureAgentOutput(fixtureRoot, "codex", "MCP server github failed to start: interrupted\n");
  await expect.poll(() => page.locator("body").innerText()).toContain("Not logged in");
  await expect.poll(() => page.locator("body").innerText()).toContain("MCP server github failed to start: interrupted");
}

async function createFixtureAgentSession(page: Page, menuItem: string, titleInput: string): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: menuItem }).click();
  const input = page.getByRole("textbox", { name: "Terminal input" }).last();
  await expect(input).toBeVisible();
  await input.fill(titleInput);
  await input.press("Enter");
}

async function appendFixtureAgentOutput(root: string, agent: "claude" | "codex", message: string): Promise<void> {
  await expect.poll(async () => (await readdir(root)).find((entry) => entry.startsWith(`alfred-${agent}-fixture-`)))
    .toBeTruthy();
  const marker = (await readdir(root)).find((entry) => entry.startsWith(`alfred-${agent}-fixture-`));
  if (!marker) throw new Error(`${agent} fixture marker did not appear.`);
  await appendFile(join(root, marker), message, "utf8");
}

async function selectSurface(page: Page, surface: "Work" | "Sessions" | "Context" | "Local Data & Privacy"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
}

async function expectSans(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  expect((await locator.evaluate((node) => getComputedStyle(node).fontFamily)).toLowerCase()).toContain("sans-serif");
}

async function expectFixedCellFont(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const family = await locator.evaluate((node) => getComputedStyle(node).fontFamily);
  expect(family).toContain("ui-monospace");
  expect(family).toContain("SFMono-Regular");
  expect(family).toContain("Menlo");
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function captureAuditScreenshot(page: Page, name: string): Promise<void> {
  const directory = process.env.ALFRED_PRODUCTION_AUDIT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function expectWithinViewport(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  const bounds = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top, viewport: innerWidth };
  });
  expect(bounds.left, `${label} starts outside the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.right, `${label} exceeds the viewport`).toBeLessThanOrEqual(bounds.viewport);
}

async function expectDrawerOpen(drawer: Locator, primaryAction: Locator): Promise<void> {
  await expect.poll(async () => drawer.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      ariaHidden: node.getAttribute("aria-hidden"),
      inert: node.hasAttribute("inert"),
      interactable: style.pointerEvents !== "none",
      visible: style.visibility === "visible",
      withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
    };
  })).toEqual({
    ariaHidden: "false",
    inert: false,
    interactable: true,
    visible: true,
    withinViewport: true,
  });
  await expect.poll(async () => primaryAction.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      disabled: (node as HTMLButtonElement).disabled,
      interactable: style.pointerEvents !== "none",
      visible: style.visibility === "visible",
      withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
    };
  })).toEqual({
    disabled: false,
    interactable: true,
    visible: true,
    withinViewport: true,
  });
}

async function expectDrawerClosed(drawer: Locator): Promise<void> {
  await expect.poll(async () => drawer.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    return {
      ariaHidden: node.getAttribute("aria-hidden"),
      finalTransformApplied: style.transform !== "none",
      inert: node.hasAttribute("inert"),
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      visibleWidth,
    };
  })).toEqual({
    ariaHidden: "true",
    finalTransformApplied: true,
    inert: true,
    pointerEvents: "none",
    visibility: "hidden",
    visibleWidth: 0,
  });
}

async function expectNoDocumentOrBodyOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth },
    document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
  }));
  expect(widths.document.scrollWidth, "document has horizontal overflow").toBeLessThanOrEqual(widths.document.clientWidth);
  expect(widths.body.scrollWidth, "body has horizontal overflow").toBeLessThanOrEqual(widths.body.clientWidth);
}
