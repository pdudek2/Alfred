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
  const companionSessionId = await firstVisibleCompanionId(page);
  expect(companionSessionId).not.toBeNull();
  await waitForAnimateRecord(page, companionSessionId!);
  await settleTileAnimations(page);

  await expect(hiddenSession).not.toHaveAttribute("aria-hidden", "true");
  await expect(hiddenSession).toHaveAttribute("data-presentation-slot", "primary");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.getByRole("toolbar", { name: "Work layout controls" })).toContainText("3 visible sessions");
  await expectSameHosts(beforeHosts, page, "select hidden project session");

  const primarySessionId = await primarySession(page);
  expect(primarySessionId).not.toBeNull();
  expect(companionSessionId).not.toBeNull();

  await page.locator(`[data-testid="terminal-tile"][data-session-id="${primarySessionId!}"]`).click();
  await page.locator(`[data-testid="terminal-tile"][data-session-id="${companionSessionId!}"]`).click();
  await page.locator(`button.project-session[data-session-id="${await singleHiddenSessionId(page)}"]`).click();

  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.locator('[data-presentation-slot="primary"]')).toHaveCount(1);
  await settleTileAnimations(page);
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

async function firstVisibleCompanionId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const primaryId = document.querySelector<HTMLElement>('[data-testid="terminal-tile"][data-presentation-slot="primary"]')
      ?.dataset.sessionId;
    const companion = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][data-session-id]'),
    ).find((tile) =>
      tile.getAttribute("aria-hidden") !== "true"
      && tile.dataset.sessionId
      && tile.dataset.sessionId !== primaryId,
    );
    return companion?.dataset.sessionId ?? null;
  });
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
      sessionId: string | null;
      playState: string;
      hasTransform: boolean;
    };
    const windowWithRecords = window as Window & {
      __alfredMotionRecords?: MotionRecord[];
      __alfredOriginalAnimate?: typeof Element.prototype.animate;
    };
    if (windowWithRecords.__alfredMotionRecords) {
      windowWithRecords.__alfredMotionRecords.length = 0;
      return;
    }
    const originalAnimate = Element.prototype.animate;
    windowWithRecords.__alfredOriginalAnimate = originalAnimate;
    windowWithRecords.__alfredMotionRecords = [];
    Element.prototype.animate = function animate(keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions) {
      const animation = originalAnimate.call(this, keyframes, options);
      const keyframeList = Array.isArray(keyframes) ? keyframes : [];
      windowWithRecords.__alfredMotionRecords?.push({
        sessionId: this instanceof HTMLElement ? this.dataset.sessionId ?? null : null,
        playState: animation.playState,
        hasTransform: keyframeList.some((keyframe) => typeof keyframe.transform === "string"),
      });
      return animation;
    };
  });
}

async function waitForAnimateRecord(page: Page, sessionId: string): Promise<void> {
  try {
    await page.waitForFunction((id) => {
      const records = (window as Window & {
        __alfredMotionRecords?: Array<{ sessionId: string | null; hasTransform: boolean; playState: string }>;
      }).__alfredMotionRecords ?? [];
      return records.some((record) => record.sessionId === id && record.hasTransform);
    }, sessionId, { polling: "raf", timeout: 3_000 });
  } catch (error) {
    const probe = await page.evaluate((id) => {
      const grid = document.querySelector<HTMLElement>('[data-testid="terminal-grid"]');
      const records = (window as Window & {
        __alfredMotionRecords?: Array<{ sessionId: string | null; hasTransform: boolean; playState: string }>;
      }).__alfredMotionRecords ?? [];
      return {
        targetSessionId: id,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        gridClassName: grid?.className ?? null,
        gridHiddenAncestor: Boolean(grid?.closest('[aria-hidden="true"], [hidden], [inert]')),
        gridAnimateType: grid ? typeof grid.animate : null,
        tiles: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][data-session-id]')).map((tile) => {
          const rect = tile.getBoundingClientRect();
          return {
            sessionId: tile.dataset.sessionId ?? null,
            slot: tile.dataset.presentationSlot ?? null,
            hidden: tile.getAttribute("aria-hidden") === "true",
            rect: {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          };
        }),
        records,
      };
    }, sessionId);
    throw new Error(`Missing animate record: ${JSON.stringify(probe)}`, { cause: error });
  }
}

async function animateRecordCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    (window as Window & { __alfredMotionRecords?: unknown[] }).__alfredMotionRecords?.length ?? 0
  ));
}
