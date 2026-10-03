import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { terminalChannels, type TerminalListResult } from "../src/shared/terminal-ipc";
import { openPlan } from "./support/plan-line";
import { settleTerminalTileAnimations } from "./support/work-layout";
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

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Codex/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const xtermHost = page.locator('[data-session-id="codex-1"] [data-testid="xterm-host"]');
  await expect(xtermHost).toBeAttached();
  const xtermHostBefore = await requiredHandle(xtermHost, "connected Codex xterm host");
  // A new session focuses its terminal asynchronously; let that settle so it
  // does not race the popover's initial focus.
  await expect.poll(() => terminalOwnsFocus(page)).toBe(true);

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
  const context = page.getByRole("complementary", { name: "Details" });
  await expect(context).toBeVisible();
  await expect(context.getByRole("button", { name: "Close Details panel" })).toBeFocused();
  await expectSameNode(xtermHostBefore, xtermHost, "Needs you Edit replaced the connected xterm host");
  harness.assertNoRuntimeErrors();
});

test("reviews the real diff of an asleep checkout without replacing the live xterm", async ({ harness }) => {
  const { app, page } = harness;
  await setWindowSize(app, page, 1440, 900);

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Codex/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const xtermHost = page.locator('[data-session-id="codex-1"] [data-testid="xterm-host"]');
  await expect(xtermHost).toBeAttached();
  const xtermHostBefore = await requiredHandle(xtermHost, "connected Codex xterm host");

  await page.getByRole("button", { name: /^Browse \d+ asleep sessions?$/ }).click();
  const sessions = page.getByRole("region", { name: "History" });
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

const mixedFixture = {
  inboxItems: 4,
  blockedInboxItem: 1,
  waitingInboxItem: 2,
  restoredSessions: 6,
  unsafeRecoveryItem: 1,
} as const;

test.describe("mixed Needs you actions", () => {
  test.use({ fixtureOptions: mixedFixture });

  test("canonical counts and actions share blockers and use real handlers", async ({ harness }) => {
    const { app, page } = harness;
    const popover = await bootstrapMixedAttention(page);
    const trigger = page.getByRole("button", { name: "Needs you, 2 sessions" });
    const rows = popover.getByRole("list", { name: "Blocked on you" }).getByRole("listitem");
    await expect(trigger).toHaveText("2 need you");
    await expect(rows).toHaveCount(2);
    const headerCount = Number((await trigger.innerText()).match(/^\d+/)?.[0]);
    expect(await rows.count()).toBe(headerCount);
    await expect(popover).not.toContainText("Fixture item 3");
    await expect(popover).not.toContainText("Fixture item 4");
    await expect(popover).not.toContainText("Restored fixture");
    expect(await rows.locator("button").allTextContents()).toEqual(["Edit", "Open"]);
    await expect(popover.getByText("Fixture safety policy blocks launch outside the approved root.", { exact: true }))
      .toBeVisible();
    await expect(popover.getByText("Approval required: allow deterministic fixture?", { exact: true })).toBeVisible();

    await installTerminalWriteProbe(app);
    expect(await terminalWriteCount(app)).toBe(0);
    await popover.getByRole("button", { name: "Open Fixture item 2 in Fixture Beta" }).click();
    await expect(popover).toBeHidden();
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
    await expect(page.locator('[data-session-id="fixture-item-2"] .xterm-screen textarea')).toBeFocused();
    expect(await terminalWriteCount(app)).toBe(0);

    await trigger.click();
    await popover.getByRole("button", { name: "Edit Fixture item 1 in Fixture Alpha" }).click();
    await expect(popover).toBeHidden();
    const context = page.getByRole("complementary", { name: "Details" });
    await expect(context).toBeVisible();
    await expect(context).toContainText("Fixture item 1");
    await expect(page.getByRole("button", { name: "Fixture Alpha project" })).toHaveAttribute("aria-current", "location");
    // Editing a draft opens Details without putting the draft on the deck.
    await expect(page.locator('[data-testid="terminal-tile"][data-session-id="fixture-item-1"]')).toHaveCount(0);
    expect(await terminalWriteCount(app)).toBe(0);
    expect((await listMainProcessTerminals(page)).sessions.some((session) => session.clientId === "fixture-item-1"))
      .toBe(false);

    // Ready drafts still launch from the plan line using the real handler.
    await context.getByRole("button", { name: "Close Details panel" }).click();
    const drafts = await openPlan(page);
    await drafts.getByRole("button", { name: "Launch Fixture item 3" }).click();
    await expect.poll(async () => {
      const listed = await listMainProcessTerminals(page);
      const snapshot = [...listed.sessions, ...(listed.restoredSessions ?? [])].find(
        (session) => session.clientId === "fixture-item-3",
      );
      return snapshot
        ? { args: snapshot.args, command: snapshot.command, workspaceId: snapshot.workspaceId }
        : null;
    }).toEqual({ args: ["fixture item 3\n"], command: "/usr/bin/printf", workspaceId: "A" });
    await expect(trigger).toHaveText("2 need you");

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });

  test("terminal continuity and geometry preserve one xterm node across History and Needs you", async ({ harness }) => {
    const { app, page } = harness;
    await bootstrapMixedAttention(page);
    await page.keyboard.press("Escape");
    const screen = page.locator('[data-session-id="fixture-item-2"] .xterm-screen');
    const before = await requiredHandle(screen, "waiting runtime xterm screen");

    for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
      await setWindowSize(app, page, width, height);
      const grid = page.getByTestId("terminal-grid");
      await page.getByRole("button", { name: "Open Surfaces menu" }).click();
      await page.getByRole("menuitem", { name: "History" }).click();
      await expect(page.getByRole("region", { name: "History" })).toBeVisible();
      await expectSameNode(before, screen, "Work→History replaced the xterm screen");
      expect(await documentOverflow(page)).toBe(0);
      await page.getByRole("button", { name: "Back to Work" }).click();
      await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
      await expectSameNode(before, screen, "History→Work replaced the xterm screen");
      await expect(screen.locator("textarea")).toBeFocused();
      await settleTerminalTileAnimations(page);
      const gridBefore = await elementGeometry(grid);

      const trigger = page.getByRole("button", { name: "Needs you, 2 sessions" });
      await trigger.click();
      const popover = page.getByRole("dialog", { name: "Needs you" });
      await expect(popover).toBeVisible();
      await expectSameNode(before, screen, "opening Needs you replaced the xterm screen");
      expect(await elementGeometry(grid)).toEqual(gridBefore);
      expect(await popover.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
      expect(await documentOverflow(page)).toBe(0);
      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();
      await expect(trigger).toBeFocused();
      await expectSameNode(before, screen, "closing Needs you replaced the xterm screen");
    }

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });

  test("keyboard navigation keeps row focus and runs actions with Enter and Space", async ({ harness }) => {
    const { page } = harness;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const popover = await bootstrapMixedAttention(page);
    const first = popover.getByRole("button", { name: "Edit Fixture item 1 in Fixture Alpha" });
    const last = popover.getByRole("button", { name: "Open Fixture item 2 in Fixture Beta" });
    await expect(first).toBeFocused();
    await first.press("End");
    await expect(last).toBeFocused();
    await last.press("Home");
    await expect(first).toBeFocused();
    await first.press("ArrowDown");
    await expect(last).toBeFocused();
    await last.press("ArrowUp");
    await expect(first).toBeFocused();
    await first.press("ArrowDown");
    await last.press("Enter");
    await expect(popover).toBeHidden();
    await expect(page.locator('[data-session-id="fixture-item-2"] .xterm-screen textarea')).toBeFocused();

    await page.getByRole("button", { name: "Needs you, 2 sessions" }).click();
    await expect(first).toBeFocused();
    await first.press("Space");
    await expect(popover).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });
});

async function bootstrapMixedAttention(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Fixture Beta project" }).click();
  await (await openPlan(page)).getByRole("button", { name: "Launch Fixture item 2" }).click();
  await expect(page.locator('[data-session-id="fixture-item-2"] .xterm-screen')).toBeAttached();
  await expect.poll(async () => {
    const session = (await listMainProcessTerminals(page)).sessions.find(
      (candidate) => candidate.clientId === "fixture-item-2",
    );
    return session ? { buffer: session.buffer, lastKind: session.activityEvents?.at(-1)?.kind ?? null } : null;
  }).toEqual({
    buffer: expect.stringContaining("Approval required: allow deterministic fixture?"),
    lastKind: "approval",
  });
  // Wait for renderer hydration before opening the list.
  try {
    await expect(page.getByRole("button", { name: "Needs you, 2 sessions" })).toBeVisible();
  } catch (error) {
    // Name what the renderer and main process saw for the waiting session, so a CI-only miss is diagnosable.
    const main = (await listMainProcessTerminals(page)).sessions.find((session) => session.clientId === "fixture-item-2");
    const tile = await page.locator('[data-session-id="fixture-item-2"]').first().innerText().catch(() => "(no tile)");
    const trigger = await page.getByRole("button", { name: /^Needs you, / }).getAttribute("aria-label").catch(() => null);
    throw new Error(`${String(error)}\n${JSON.stringify({
      trigger,
      tile: tile.replace(/\s+/g, " ").slice(0, 160),
      now: Date.now(),
      main: main && {
        lastOutputAt: main.lastOutputAt,
        shellBusy: main.shellBusy,
        buffer: main.buffer?.slice(-200),
        events: main.activityEvents?.map(({ kind, title, at }) => ({ kind, title, at })),
      },
    })}`, { cause: error });
  }
  await page.getByRole("button", { name: "Needs you, 2 sessions" }).click();
  const popover = page.getByRole("dialog", { name: "Needs you" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Approval required: allow deterministic fixture?");
  await expect(popover.getByRole("button").first()).toBeFocused();
  return popover;
}

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

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

async function listMainProcessTerminals(page: Page): Promise<TerminalListResult> {
  return page.evaluate(async () => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return terminalApi.list();
  });
}

async function installTerminalWriteProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, channel) => {
    const probe = globalThis as typeof globalThis & { __alfredE2ETerminalWriteCount?: number };
    probe.__alfredE2ETerminalWriteCount = 0;
    ipcMain.on(channel, () => {
      probe.__alfredE2ETerminalWriteCount = (probe.__alfredE2ETerminalWriteCount ?? 0) + 1;
    });
  }, terminalChannels.write);
}

async function terminalWriteCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    const probe = globalThis as typeof globalThis & { __alfredE2ETerminalWriteCount?: number };
    return probe.__alfredE2ETerminalWriteCount ?? 0;
  });
}
