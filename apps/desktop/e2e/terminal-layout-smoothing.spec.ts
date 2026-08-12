import type { ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { chooseWorkLayout } from "./support/work-layout";

test("keeps four xterm hosts mounted while Grid shows one primary and two companions", async ({ harness }) => {
  const { page } = harness;

  await addManualTerminal(page);
  await addManualTerminal(page);
  await addManualTerminal(page);

  await expect(page.getByTestId("terminal-tile")).toHaveCount(4);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.locator('[data-presentation-slot="primary"]')).toHaveCount(1);
  await expect(page.locator('[data-presentation-slot="secondary"]')).toHaveCount(1);
  await expect(page.locator('[data-presentation-slot="tertiary"]')).toHaveCount(1);
  await expect(page.getByRole("toolbar", { name: "Work layout controls" })).toContainText("3 visible sessions");

  const beforeHosts = await captureHosts(page, 4);
  const initialHiddenSessionId = await singleHiddenSessionId(page);
  const hiddenSession = page.locator(`[data-testid="terminal-tile"][data-session-id="${initialHiddenSessionId}"]`);
  await expect(hiddenSession).toHaveAttribute("aria-hidden", "true");

  await installAnimateRecorder(page);
  await page.locator(`button.project-session[data-session-id="${initialHiddenSessionId}"]`).click();
  await expect.poll(() => shellTransformAnimationCount(page)).toBeGreaterThan(0);
  await expect(hiddenSession).not.toHaveAttribute("aria-hidden", "true");
  await expect(hiddenSession).toHaveAttribute("data-presentation-slot", "primary");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.getByRole("toolbar", { name: "Work layout controls" })).toContainText("3 visible sessions");
  await expectSameHosts(beforeHosts, page, "select hidden project session");
  await expectNoInternalAnimateRecords(page, "first hidden-session promotion");

  await settleTileAnimations(page);
  await page.locator(`button.project-session[data-session-id="${await singleHiddenSessionId(page)}"]`).click();
  await settleTileAnimations(page);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.locator('[data-presentation-slot="primary"]')).toHaveCount(1);
  await expectSameHosts(beforeHosts, page, "interrupt promotion sequence");

  const selectedSessionId = await primarySession(page);
  expect(selectedSessionId).not.toBeNull();
  await expect.poll(() => focusedTerminalSessionId(page)).toBe(selectedSessionId);

  await openInbox(page);
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await selectSurface(page, "Sessions");
  await expect(page.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await expect.poll(() => focusedTerminalSessionId(page)).toBe(selectedSessionId);
  await expectSameHosts(beforeHosts, page, "Work reactivation");
});

test("restarts interrupted tile motion without moving xterm internals", async ({ harness }) => {
  const { page } = harness;

  await addManualTerminal(page);
  await addManualTerminal(page);
  const beforeHosts = await captureHosts(page, 3);
  await installAnimateRecorder(page);

  const interruption = await interruptCompanionPromotion(page);
  expect(interruption.animationWasRunning).toBe(true);
  await expect.poll(async () => (await shellMotionMetrics(page)).totalShellAnimateCount)
    .toBeGreaterThan(interruption.firstPhaseShellAnimateCount);
  await expect.poll(async () => (await shellMotionMetrics(page)).totalShellCancelCount)
    .toBeGreaterThan(interruption.firstPhaseShellCancelCount);
  const secondPhaseMetrics = await shellMotionMetrics(page);
  const replacedShell = secondPhaseMetrics.shells.find((shell) =>
    shell.sessionId === interruption.animatedShellSessionId
    && shell.animateCount > 1
    && shell.cancelCount > 0
    && shell.canceledAnimationIds.includes(interruption.firstAnimationId),
  );
  expect(replacedShell).toBeTruthy();
  expect(secondPhaseMetrics.maxRunningAnimationsPerShell).toBeLessThanOrEqual(1);
  await expectNoInternalAnimateRecords(page, "interrupted companion promotion");
  await expectSameHosts(beforeHosts, page, "interrupted companion promotion");
  await expect.poll(() => focusedTerminalSessionId(page)).not.toBeNull();
});

test("skips terminal tile motion when reduced motion is enabled", async ({ harness }) => {
  const { page } = harness;

  await page.emulateMedia({ reducedMotion: "reduce" });
  await installAnimateRecorder(page);
  await addManualTerminal(page);
  await addManualTerminal(page);
  await addManualTerminal(page);

  const hiddenSessionId = await singleHiddenSessionId(page);
  await page.locator(`button.project-session[data-session-id="${hiddenSessionId}"]`).click();

  expect(await animateRecordCount(page)).toBe(0);
});

test.describe("staged Arrange layout", () => {
  test.use({ fixtureOptions: { inboxItems: 1 } });

  test("keeps staged Arrange placement on the direct terminal-grid child", async ({ harness }) => {
    const { page } = harness;

    const stagedTile = page.locator('[data-testid="terminal-tile"][data-session-id="fixture-item-1"]');
    await expect(stagedTile).toBeVisible();
    await chooseWorkLayout(page, "Arrange");
    await expect(page.getByText("Arrange mode", { exact: true })).toBeVisible();

    await expect.poll(async () => readDirectGridChildStyle(page, "fixture-item-1")).toEqual({
      gridColumn: "1 / span 12",
      gridRow: "1 / span 8",
    });
  });
});

async function addManualTerminal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New manual terminal" }).click();
}

async function openInbox(page: Page): Promise<void> {
  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
}

async function selectSurface(page: Page, surface: "Work" | "Sessions"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function captureHosts(page: Page, expectedCount: number): Promise<ElementHandle<HTMLElement>[]> {
  const hosts = page.getByTestId("xterm-host");
  await expect(hosts).toHaveCount(expectedCount);
  const handles: ElementHandle<HTMLElement>[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    handles.push(await requiredHandle(hosts.nth(index), `xterm host ${index + 1}`));
  }
  return handles;
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function expectSameHosts(
  before: ElementHandle<HTMLElement>[],
  page: Page,
  transition: string,
): Promise<void> {
  const hosts = page.getByTestId("xterm-host");
  await expect(hosts).toHaveCount(before.length);
  for (const [index, prior] of before.entries()) {
    const current = await requiredHandle(hosts.nth(index), `${transition}: xterm host ${index + 1}`);
    const same = await prior.evaluate(
      (node, currentNode) => node.isSameNode(currentNode) && node.isConnected,
      current,
    );
    expect(same, `${transition}: xterm host ${index + 1} changed`).toBe(true);
  }
}

async function readDirectGridChildStyle(
  page: Page,
  sessionId: string,
): Promise<{ gridColumn: string; gridRow: string }> {
  return page.evaluate((id) => {
    const tile = document.querySelector(`[data-testid="terminal-tile"][data-session-id="${id}"]`);
    if (!(tile instanceof HTMLElement)) {
      throw new Error(`Terminal tile ${id} is missing.`);
    }
    const wrapper = tile.parentElement;
    const grid = document.querySelector('[data-testid="terminal-grid"]');
    if (!(wrapper instanceof HTMLElement) || !(grid instanceof HTMLElement) || wrapper.parentElement !== grid) {
      throw new Error(`Terminal tile ${id} is not wrapped as a direct terminal-grid child.`);
    }
    return {
      gridColumn: wrapper.style.gridColumn,
      gridRow: wrapper.style.gridRow,
    };
  }, sessionId);
}

async function singleHiddenSessionId(page: Page): Promise<string> {
  const hiddenIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][aria-hidden="true"][data-session-id]'))
      .map((tile) => tile.dataset.sessionId ?? "")
      .filter((id) => id.length > 0),
  );
  expect(hiddenIds).toHaveLength(1);
  return hiddenIds[0]!;
}

async function primarySession(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-testid="terminal-tile"][data-presentation-slot="primary"]')
      ?.dataset.sessionId ?? null,
  );
}

async function settleTileAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][data-session-id]'));
    await Promise.allSettled(
      elements.flatMap((element) => element.getAnimations()).map((animation) => animation.finished),
    );
  });
}

async function focusedTerminalSessionId(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.activeElement?.closest<HTMLElement>('[data-testid="terminal-tile"][data-session-id]')?.dataset.sessionId ?? null,
  );
}

async function installAnimateRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    type MotionRecord = {
      animationId: number;
      sessionId: string | null;
      playState: string;
      hasTransform: boolean;
      targetKind: "tile-shell" | "xterm-host" | "xterm" | "xterm-screen" | "other";
    };
    type CancelRecord = {
      animationId: number;
      sessionId: string | null;
      targetKind: MotionRecord["targetKind"];
    };
    const windowWithRecords = window as Window & {
      __alfredMotionRecords?: MotionRecord[];
      __alfredMotionCancels?: CancelRecord[];
      __alfredMotionNextId?: number;
      __alfredOriginalAnimate?: typeof Element.prototype.animate;
    };
    if (windowWithRecords.__alfredMotionRecords) {
      windowWithRecords.__alfredMotionRecords.length = 0;
      windowWithRecords.__alfredMotionCancels?.splice(0);
      return;
    }
    const originalAnimate = Element.prototype.animate;
    windowWithRecords.__alfredOriginalAnimate = originalAnimate;
    windowWithRecords.__alfredMotionRecords = [];
    windowWithRecords.__alfredMotionCancels = [];
    windowWithRecords.__alfredMotionNextId = 1;
    Element.prototype.animate = function animate(keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions) {
      const animationId = windowWithRecords.__alfredMotionNextId ?? 1;
      windowWithRecords.__alfredMotionNextId = animationId + 1;
      const animation = originalAnimate.call(this, keyframes, options);
      const keyframeList = Array.isArray(keyframes) ? keyframes : [];
      const targetKind = classifyMotionTarget(this);
      windowWithRecords.__alfredMotionRecords?.push({
        animationId,
        sessionId: this instanceof HTMLElement ? this.dataset.sessionId ?? null : null,
        playState: animation.playState,
        hasTransform: keyframeList.some((keyframe) => typeof keyframe.transform === "string"),
        targetKind,
      });
      const originalCancel = animation.cancel.bind(animation);
      animation.cancel = () => {
        windowWithRecords.__alfredMotionCancels?.push({
          animationId,
          sessionId: this instanceof HTMLElement ? this.dataset.sessionId ?? null : null,
          targetKind,
        });
        originalCancel();
      };
      return animation;
    };

    function classifyMotionTarget(target: Element): MotionRecord["targetKind"] {
      if (!(target instanceof HTMLElement)) return "other";
      if (target.matches('[data-testid="terminal-tile"][data-session-id]')) return "tile-shell";
      if (target.matches('[data-testid="xterm-host"]')) return "xterm-host";
      if (target.matches(".xterm-screen")) return "xterm-screen";
      if (target.matches(".xterm")) return "xterm";
      return "other";
    }
  });
}

async function interruptCompanionPromotion(
  page: Page,
): Promise<{
  animatedShellSessionId: string;
  firstAnimationId: number;
  firstPhaseShellAnimateCount: number;
  firstPhaseShellCancelCount: number;
  animationWasRunning: boolean;
}> {
  return page.evaluate(async () => {
    type MotionRecord = { animationId: number; sessionId: string | null; hasTransform: boolean; targetKind: string };
    type CancelRecord = { animationId: number; sessionId: string | null; targetKind: string };
    const recordsWindow = window as Window & {
      __alfredMotionRecords?: MotionRecord[];
      __alfredMotionCancels?: CancelRecord[];
    };
    const firstCompanion = document.querySelector<HTMLElement>(
      '[data-testid="terminal-tile"][data-presentation-slot="secondary"]',
    );
    const firstCompanionSessionId = firstCompanion?.dataset.sessionId;
    if (!firstCompanion || !firstCompanionSessionId) throw new Error("Missing first companion.");
    (firstCompanion.querySelector<HTMLElement>(".terminal-tile-header") ?? firstCompanion).click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const animatedShell = document.querySelector<HTMLElement>(
      `[data-testid="terminal-tile"][data-session-id="${firstCompanionSessionId}"]`,
    );
    const survivor = document.querySelector<HTMLElement>(
      '[data-testid="terminal-tile"][data-presentation-slot="secondary"]',
    );
    const nextCompanion = document.querySelector<HTMLElement>(
      '[data-testid="terminal-tile"][data-presentation-slot="tertiary"]',
    );
    const animatedShellSessionId = animatedShell?.dataset.sessionId;
    if (!animatedShell || !survivor || !nextCompanion || !animatedShellSessionId) {
      throw new Error("Missing deterministic three-pane slots after first companion promotion.");
    }
    const shellRecords = (recordsWindow.__alfredMotionRecords ?? [])
      .filter((record) => record.targetKind === "tile-shell");
    const firstAnimation = shellRecords.findLast((record) =>
      record.sessionId === animatedShellSessionId && record.hasTransform,
    );
    if (!firstAnimation) throw new Error(`Missing animation for secondary ${animatedShellSessionId}.`);
    const animationWasRunning = animatedShell.getAnimations()
      .some((animation) => animation.playState === "running");
    const firstPhaseShellCancelCount = (recordsWindow.__alfredMotionCancels ?? [])
      .filter((record) => record.targetKind === "tile-shell").length;

    (nextCompanion.querySelector<HTMLElement>(".terminal-tile-header") ?? nextCompanion).click();
    await Promise.resolve();
    return {
      animatedShellSessionId,
      firstAnimationId: firstAnimation.animationId,
      firstPhaseShellAnimateCount: shellRecords.length,
      firstPhaseShellCancelCount,
      animationWasRunning,
    };
  });
}

async function shellTransformAnimationCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    (window as Window & {
      __alfredMotionRecords?: Array<{ hasTransform: boolean; targetKind: string }>;
    }).__alfredMotionRecords ?? []
  ).filter((record) => record.targetKind === "tile-shell" && record.hasTransform).length);
}

async function animateRecordCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    (window as Window & { __alfredMotionRecords?: unknown[] }).__alfredMotionRecords?.length ?? 0
  ));
}

async function expectNoInternalAnimateRecords(page: Page, label: string): Promise<void> {
  const internalTargets = await page.evaluate(() => (
    ((window as Window & {
      __alfredMotionRecords?: Array<{ targetKind: string; sessionId: string | null; animationId: number }>;
    }).__alfredMotionRecords ?? [])
      .filter((record) => record.targetKind === "xterm-host" || record.targetKind === "xterm" || record.targetKind === "xterm-screen")
  ));
  expect(internalTargets, `${label}: xterm internals must not animate`).toEqual([]);
}

async function shellMotionMetrics(page: Page): Promise<{
  totalShellAnimateCount: number;
  totalShellCancelCount: number;
  maxRunningAnimationsPerShell: number;
  shells: Array<{ sessionId: string | null; animateCount: number; cancelCount: number; canceledAnimationIds: number[] }>;
}> {
  return page.evaluate(() => {
    const windowWithRecords = window as Window & {
      __alfredMotionRecords?: Array<{ animationId: number; sessionId: string | null; targetKind: string }>;
      __alfredMotionCancels?: Array<{ animationId: number; sessionId: string | null; targetKind: string }>;
    };
    const shellRecords = (windowWithRecords.__alfredMotionRecords ?? [])
      .filter((record) => record.targetKind === "tile-shell");
    const shellCancels = (windowWithRecords.__alfredMotionCancels ?? [])
      .filter((record) => record.targetKind === "tile-shell");
    const sessionIds = [...new Set(shellRecords.map((record) => record.sessionId))];
    const shells = sessionIds.map((sessionId) => ({
      sessionId,
      animateCount: shellRecords.filter((record) => record.sessionId === sessionId).length,
      cancelCount: shellCancels.filter((record) => record.sessionId === sessionId).length,
      canceledAnimationIds: shellCancels
        .filter((record) => record.sessionId === sessionId)
        .map((record) => record.animationId),
    }));
    return {
      totalShellAnimateCount: shellRecords.length,
      totalShellCancelCount: shellCancels.length,
      maxRunningAnimationsPerShell: Math.max(0, ...Array.from(document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][data-session-id]'))
        .map((tile) => tile.getAnimations().length)),
      shells,
    };
  });
}
