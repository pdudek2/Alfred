import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { realpath } from "node:fs/promises";
import { terminalChannels, type TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

const mixedFixture = {
  inboxItems: 4,
  blockedInboxItem: 1,
  waitingInboxItem: 2,
  restoredSessions: 6,
  unsafeRecoveryItem: 1,
} as const;

test.describe("deterministic mixed Decision Inbox", () => {
  test.use({ fixtureOptions: mixedFixture });

  test("canonical counts and actions share blockers and use real handlers", async ({ harness }) => {
    const { app, page } = harness;
    const inbox = await bootstrapMixedInbox(page);

    await expect(page.getByRole("button", { name: "Open Inbox surface, 4 items" })).toBeVisible();
    await expect(page.getByRole("navigation", {
      name: "Projects and Free Chats",
    })).toHaveCount(0);
    await expect(inbox.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(inbox.getByText("All projects", { exact: true })).toBeVisible();
    await expect(inbox.locator(".inbox-docket__statusbar")).toHaveCount(0);
    await expect(inbox.getByText("4 need you · 6 recovery", { exact: true })).toBeVisible();
    await expect(inbox.getByRole("list", { name: "Needs you items" }).locator(":scope > li")).toHaveCount(4);
    await expect(inbox.getByRole("list", {
      name: "Needs you items",
    }).locator(":scope > li[aria-expanded='true']")).toHaveCount(1);
    const recoveryToggle = inbox.getByRole("button", { name: "Recovery · 6 saved sessions" });
    await expect(recoveryToggle).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect((await recoveryToggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);

    const blockerIds = await inbox
      .getByRole("list", { name: "Needs you items" })
      .locator(":scope > li")
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")));
    expect(blockerIds).toEqual([
      "inbox-decision-A:fixture-item-1",
      "inbox-decision-B:fixture-item-2",
      "inbox-decision-A:fixture-item-3",
      "inbox-decision-B:fixture-item-4",
    ]);

    const blocked = inbox.getByTestId("inbox-decision-A:fixture-item-1");
    await expect(blocked.locator(".inbox-docket__primary")).toHaveText("Review / Edit");
    await expect(blocked.locator(".inbox-docket__primary")).toHaveCount(1);
    await expect(blocked.getByText("Run anyway", { exact: true })).toHaveCount(0);
    await expect(blocked.getByText("Launch", { exact: true })).toHaveCount(0);
    await expect(blocked.getByText("Discard", { exact: true })).toHaveCount(0);

    const waiting = inbox.getByTestId("inbox-decision-B:fixture-item-2");
    await waiting.getByTestId("inbox-decision-select-B:fixture-item-2").click();
    await expect(waiting.locator(".inbox-docket__primary")).toHaveText("Open in Work");
    await installTerminalWriteProbe(app);
    expect(await terminalWriteCount(app)).toBe(0);
    await waiting.getByRole("button", { name: "Open in Work Fixture item 2 in Fixture Beta" }).click();
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
    expect(await terminalWriteCount(app)).toBe(0);

    await openInbox(page);
    const staged = inbox.getByTestId("inbox-decision-A:fixture-item-3");
    await staged.getByTestId("inbox-decision-select-A:fixture-item-3").click();
    await staged.getByRole("button", { name: "Launch Fixture item 3 in Fixture Alpha" }).click();
    await expect(staged).toHaveCount(0);
    await expect.poll(async () => {
      const listed = await listMainProcessTerminals(page);
      const snapshot = [...listed.sessions, ...(listed.restoredSessions ?? [])].find(
        (session) => session.clientId === "fixture-item-3",
      );
      return snapshot
        ? { args: snapshot.args, command: snapshot.command, workspaceId: snapshot.workspaceId }
        : null;
    }).toEqual({
      args: ["fixture item 3\n"],
      command: "/usr/bin/printf",
      workspaceId: "A",
    });
    await expect(page.getByRole("button", { name: "Open Inbox surface, 3 items" })).toBeVisible();

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });

  test("recovery safety requires review, supports Escape disarm, and starts only on confirm", async ({
    harness,
  }) => {
    const { page, paths } = harness;
    const inbox = await bootstrapMixedInbox(page);
    const recoveryToggle = inbox.getByRole("button", { name: "Recovery · 6 saved sessions" });
    await recoveryToggle.click();
    await expect(inbox.getByRole("list", { name: "Recovery items" }).locator(":scope > li")).toHaveCount(6);

    const unsafeAction = inbox.getByRole("button", {
      name: "Review relaunch Restored fixture 1 in Fixture Alpha",
    });
    const beforeReview = await listMainProcessTerminals(page);
    expect(beforeReview.sessions.some((session) => session.clientId === "restored-1")).toBe(false);
    expect(beforeReview.restoredSessions?.find((session) => session.clientId === "restored-1")?.buffer)
      .not.toContain("unsafe recovery confirmed");
    await unsafeAction.click();

    const confirm = inbox.getByRole("button", {
      name: "Confirm relaunch Restored fixture 1 in Fixture Alpha",
    });
    await expect(confirm).toBeVisible();
    await expect(inbox.getByText("shell command replay needs review", { exact: true })).toBeVisible();
    await expect(inbox.getByText(paths.workspaceA, { exact: true })).toBeVisible();
    await expect(
      inbox.getByText(
        "/bin/sh -c /usr/bin/printf 'unsafe recovery confirmed\\n'",
        { exact: true },
      ),
    ).toBeVisible();
    const armedSnapshot = await listMainProcessTerminals(page);
    expect(armedSnapshot.sessions.some((session) => session.clientId === "restored-1")).toBe(false);
    expect(armedSnapshot.restoredSessions?.find((session) => session.clientId === "restored-1")?.buffer)
      .not.toContain("unsafe recovery confirmed");

    await page.keyboard.press("Escape");
    await expect(inbox).toBeVisible();
    await expect(confirm).toHaveCount(0);
    await expect(inbox.getByRole("button", {
      name: "Review relaunch Restored fixture 1 in Fixture Alpha",
    })).toBeVisible();
    await expect(inbox.getByText(paths.workspaceA, { exact: true })).toHaveCount(0);

    await inbox.getByRole("button", {
      name: "Review relaunch Restored fixture 1 in Fixture Alpha",
    }).click();
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
    const canonicalWorkspaceA = await realpath(paths.workspaceA);
    await expect.poll(async () => {
      const listed = await listMainProcessTerminals(page);
      const session = [...listed.sessions, ...(listed.restoredSessions ?? [])].find(
        (candidate) => candidate.clientId === "restored-1",
      );
      const sentinelCount = session?.buffer.match(/unsafe recovery confirmed/g)?.length ?? 0;
      return session ? { command: session.command, cwd: session.cwd, sentinelCount } : null;
    }).toEqual({ command: "/bin/sh", cwd: canonicalWorkspaceA, sentinelCount: 1 });

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });

  test("recovery toggle remains within rendered viewport pixels at 1120 by 720", async ({ harness }) => {
    const { app, page } = harness;
    await setWindowSize(app, page, 1120, 720);
    const inbox = await bootstrapMixedInbox(page);
    const recoveryToggle = inbox.getByRole("button", { name: "Recovery · 6 saved sessions" });
    await recoveryToggle.scrollIntoViewIfNeeded();

    await assertNoHorizontalOverflow(page, "Inbox", [recoveryToggle]);
    expect(await recoveryToggle.evaluate((control) => {
      const rect = control.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, innerHeight - 1) === control;
    })).toBe(true);

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });

  test("terminal continuity and geometry preserve one xterm node and restore focus", async ({ harness }) => {
    const { app, page } = harness;
    await setWindowSize(app, page, 1440, 900);
    const preservedAlphaScreen = page.locator('[data-session-id="restored-1"] .xterm-screen');
    await expect(preservedAlphaScreen).toBeAttached();
    const preservedAlphaHandle = await requiredHandle(
      preservedAlphaScreen,
      "pre-transition Fixture Alpha xterm screen",
    );
    let inbox = await bootstrapMixedInbox(page);
    await inbox.getByTestId("inbox-decision-select-B:fixture-item-2").click();
    await inbox.getByRole("button", { name: "Open in Work Fixture item 2 in Fixture Beta" }).click();
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();

    expect(await preservedAlphaScreen.evaluate(
      (node, previousNode) => node.isSameNode(previousNode) && node.isConnected,
      preservedAlphaHandle,
    ), "Work→Inbox→Fixture Beta Work changed the original Fixture Alpha xterm screen").toBe(true);

    const terminalScreen = page.locator('[data-session-id="fixture-item-2"] .xterm-screen');
    await expect(terminalScreen).toBeAttached();
    const beforeHandle = await requiredHandle(terminalScreen, "waiting runtime xterm screen");

    for (const size of [
      { width: 1440, height: 900 },
      { width: 1120, height: 720 },
    ]) {
      await setWindowSize(app, page, size.width, size.height);
      const activeTile = page.locator(
        '[data-testid="terminal-tile"][data-session-id="fixture-item-2"]',
      );
      await assertNoHorizontalOverflow(page, "Work", [
        page.getByTestId("workbench-header"),
        activeTile.getByRole("textbox", { name: "Terminal input" }),
      ]);

      await openInbox(page);
      inbox = page.getByRole("region", { name: "Inbox workspace" });
      await inbox.getByRole("button", { name: "Recovery · 6 saved sessions" }).scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(page, "Inbox", [
        inbox.locator(".inbox-docket__toolbar"),
        inbox.getByTestId("inbox-decision-select-B:fixture-item-2"),
        inbox.getByRole("button", { name: "Recovery · 6 saved sessions" }),
      ]);
      await inbox.getByTestId("inbox-decision-select-B:fixture-item-2").click();
      await inbox.getByRole("button", { name: "Open in Work Fixture item 2 in Fixture Beta" }).click();
      await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();

      expect(await terminalScreen.evaluate(
        (node, previousNode) => node.isSameNode(previousNode) && node.isConnected,
        beforeHandle,
      ), `${size.width}x${size.height}: .xterm-screen identity changed`).toBe(true);
      await expect.poll(
        () => terminalScreen.evaluate((screen) => screen.contains(document.activeElement)),
        { message: `${size.width}x${size.height}: terminal focus was not restored` },
      ).toBe(true);
      await assertNoHorizontalOverflow(page, "Work restored", [
        page.getByTestId("workbench-header"),
        activeTile.getByRole("textbox", { name: "Terminal input" }),
      ]);
    }

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });
});

test.describe("long Decision Inbox", () => {
  test.use({
    fixtureOptions: {
      inboxItems: 18,
      blockedInboxItem: 1,
      waitingInboxItem: 2,
      restoredSessions: 6,
      unsafeRecoveryItem: 1,
    },
  });

  test("keyboard navigation keeps selection, scroll, flat actions, and reduced motion deterministic", async ({
    harness,
  }) => {
    const { page } = harness;
    await page.emulateMedia({ reducedMotion: "reduce" });
    let inbox = await bootstrapMixedInbox(page);
    const scrollOwner = inbox.locator(".inbox-docket__canvas");

    const initiallySelected = inbox.getByTestId("inbox-decision-select-B:fixture-item-2");
    await initiallySelected.press("End");
    const lastItem = inbox
      .getByRole("list", { name: "Needs you items" })
      .locator(":scope > li")
      .last();
    const last = lastItem.locator(".inbox-docket__item-row");
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-expanded", "true");
    await expect(lastItem.locator(".inbox-docket__primary")).toHaveText("Launch");
    const endGeometry = await selectedScrollGeometry(scrollOwner, last);
    expect(endGeometry.scrollTop).toBeGreaterThan(0);
    expect(endGeometry.itemTop).toBeGreaterThanOrEqual(endGeometry.ownerTop - 1);
    expect(endGeometry.itemBottom).toBeLessThanOrEqual(endGeometry.ownerBottom + 1);
    await expect(inbox.locator(".inbox-docket__statusbar")).toHaveCount(0);

    await last.press("Home");
    const first = inbox.getByTestId("inbox-decision-select-A:fixture-item-1");
    await expect(first).toBeFocused();
    await expect(inbox.getByTestId("inbox-decision-A:fixture-item-1")
      .locator(".inbox-docket__primary")).toHaveText("Review / Edit");
    await first.press("ArrowDown");
    const waiting = inbox.getByTestId("inbox-decision-select-B:fixture-item-2");
    await expect(waiting).toBeFocused();
    await expect(inbox.getByTestId("inbox-decision-B:fixture-item-2")
      .locator(".inbox-docket__primary")).toHaveText("Open in Work");
    await waiting.press("ArrowUp");
    await expect(first).toBeFocused();

    const tenth = inbox.getByTestId("inbox-decision-select-B:fixture-item-10");
    await tenth.focus();
    await page.keyboard.press("Space");
    await expect(tenth).toBeFocused();
    await expect(tenth).toHaveAttribute("aria-expanded", "true");
    await expect(inbox.getByTestId("inbox-decision-B:fixture-item-10")
      .locator(".inbox-docket__primary")).toHaveText("Launch");

    const transitionDurations = await inbox.locator(".inbox-docket__detail").first().evaluate((detail) =>
      getComputedStyle(detail).transitionDuration.split(",").map((value) => Number.parseFloat(value)),
    );
    expect(Math.max(...transitionDurations)).toBeLessThanOrEqual(0.001);
    await expect(scrollOwner).toHaveCSS("scroll-behavior", "auto");

    await tenth.press("Home");
    await first.press("ArrowDown");
    await waiting.press("Enter");
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
    await expect(page.locator('[data-session-id="fixture-item-2"] .xterm-screen')).toBeAttached();

    await openInbox(page);
    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();

    await page.getByRole("button", { name: "Open Surfaces menu" }).click();
    await page.getByRole("menuitem", { name: "Sessions" }).click();
    await expect(page.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
    const inboxSwitcher = page.getByTestId("workbench-header")
      .getByRole("button", { name: /Open Inbox surface/i });
    await inboxSwitcher.click();
    inbox = page.getByRole("region", { name: "Inbox workspace" });
    await expect(inbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();

    harness.assertNoRuntimeErrors();
    await harness.closeActiveTerminals();
  });
});

async function bootstrapMixedInbox(page: Page): Promise<Locator> {
  await expect(page.getByRole("article", { name: /Restored fixture 1/i })).toBeVisible();
  await openInbox(page);
  const inbox = page.getByRole("region", { name: "Inbox workspace" });
  await inbox.getByTestId("inbox-decision-select-B:fixture-item-2").click();
  await inbox.getByRole("button", { name: "Launch Fixture item 2 in Fixture Beta" }).click();
  await expect(page.locator('[data-session-id="fixture-item-2"] .xterm-screen')).toBeAttached();
  await expect.poll(async () => {
    const session = (await listMainProcessTerminals(page)).sessions.find(
      (candidate) => candidate.clientId === "fixture-item-2",
    );
    return session
      ? {
          buffer: session.buffer,
          lastKind: session.activityEvents?.at(-1)?.kind ?? null,
        }
      : null;
  }).toEqual({
    buffer: expect.stringContaining("Approval required: allow deterministic fixture?"),
    lastKind: "approval",
  });
  await expect(inbox.getByTestId("inbox-decision-B:fixture-item-2")).toContainText("Needs response · inferred");
  return inbox;
}

async function openInbox(page: Page): Promise<void> {
  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
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

async function requiredHandle(
  locator: Locator,
  label: string,
): Promise<ElementHandle<HTMLElement>> {
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
  await app.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ ...window.getBounds(), ...size });
  }, { width, height });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    const bounds = window?.getBounds();
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

async function assertNoHorizontalOverflow(
  page: Page,
  state: string,
  activeControls: Locator[],
): Promise<void> {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body, `${state}: body horizontal overflow`).toBeLessThanOrEqual(0);
  expect(overflow.document, `${state}: document horizontal overflow`).toBeLessThanOrEqual(0);

  for (const control of activeControls) {
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error(`${state}: active control has no bounding box.`);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    expect(Math.ceil(bounds.x * viewport.dpr), `${state}: active control clips left`).toBeGreaterThanOrEqual(0);
    expect(Math.ceil(bounds.y * viewport.dpr), `${state}: active control clips top`).toBeGreaterThanOrEqual(0);
    expect(Math.floor((bounds.x + bounds.width) * viewport.dpr), `${state}: active control clips right`)
      .toBeLessThanOrEqual(Math.floor(viewport.width * viewport.dpr));
    expect(Math.floor((bounds.y + bounds.height) * viewport.dpr), `${state}: active control clips bottom`)
      .toBeLessThanOrEqual(Math.floor(viewport.height * viewport.dpr));
  }
}

async function selectedScrollGeometry(scrollOwner: Locator, item: Locator) {
  const [ownerBox, itemBox, scrollTop] = await Promise.all([
    scrollOwner.boundingBox(),
    item.boundingBox(),
    scrollOwner.evaluate((element) => element.scrollTop),
  ]);
  if (!ownerBox || !itemBox) throw new Error("Inbox selection geometry is unavailable.");
  return {
    scrollTop,
    ownerTop: ownerBox.y,
    ownerBottom: ownerBox.y + ownerBox.height,
    itemTop: itemBox.y,
    itemBottom: itemBox.y + itemBox.height,
  };
}
