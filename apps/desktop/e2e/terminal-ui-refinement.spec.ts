import { expect, test } from "./support/electron-app";
import { chooseWorkLayout } from "./support/work-layout";

test("terminal identity marks and compact Grid stay visible", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  await addSession(page, "New Codex session");
  await addSession(page, "New Claude session");

  const tiles = page.getByTestId("terminal-tile");
  await expect(tiles).toHaveCount(3);
  await expect(page.locator(".terminal-tile .tile-kind-mark.codex .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".terminal-tile .tile-kind-mark.claude .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".project-session-kind.kind-codex .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".project-session-kind.kind-claude .kind-brand-icon")).toBeVisible();

  const manualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  const manualInput = manualTile.getByRole("textbox", { name: "Terminal input" });
  await manualInput.fill("codex");
  await manualInput.press("Enter");
  await expect(manualTile.locator(".tile-kind-mark.codex .kind-brand-icon")).toBeVisible();
  await expect(page.locator('.project-session[data-session-id="manual-1"]')
    .locator(".project-session-kind.kind-codex .kind-brand-icon")).toBeVisible();
  await expect.poll(() => tiles.evaluateAll(
    (nodes) => nodes.every((node) => node.classList.contains("ready")),
  )).toBe(true);

  const placement = await tiles.evaluateAll((nodes) => nodes.map((node) => ({
    id: (node as HTMLElement).dataset.sessionId,
    column: (node as HTMLElement).style.gridColumn,
    row: (node as HTMLElement).style.gridRow,
  })));
  expect(placement.map(({ column, row }) => ({ column, row }))).toEqual(
    Array.from({ length: 3 }, () => ({ column: "", row: "" })),
  );
  await expect(manualTile).toHaveClass(/selected/);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-1120x720.png") });

  await chooseWorkLayout(page, "Split");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-split-1120x720.png") });

  await chooseWorkLayout(page, "Grid");
  await addSession(page, "New manual terminal");
  const secondManualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-2"]');
  await expect(secondManualTile).toHaveClass(/ready/);
  await expect(secondManualTile).toHaveClass(/selected/);
  await addSession(page, "New manual terminal");
  await expect(tiles).toHaveCount(5);
  const thirdManualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-3"]');
  await expect(thirdManualTile).toHaveClass(/ready/);
  await expect(thirdManualTile).toHaveClass(/selected/);
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/many-up/);
  expect(await tiles.evaluateAll((nodes) => nodes.map((node) => ({
    column: (node as HTMLElement).style.gridColumn,
    row: (node as HTMLElement).style.gridRow,
  })))).toEqual(Array.from({ length: 5 }, () => ({ column: "", row: "" })));

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1686, height: 980 });
  });
  const wideFiveUp = await tileGeometry(tiles);
  expect(uniqueCoordinates(wideFiveUp, "left")).toHaveLength(3);
  expect(uniqueCoordinates(wideFiveUp, "top")).toHaveLength(2);
  expect(Math.min(...wideFiveUp.map(({ height }) => height))).toBeGreaterThan(760);
  expect(wideFiveUp.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-5-1686x980.png") });

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  const narrowFiveUp = await tileGeometry(tiles);
  expect(uniqueCoordinates(narrowFiveUp, "left")).toHaveLength(2);
  expect(uniqueCoordinates(narrowFiveUp, "top")).toHaveLength(3);
  expect(Math.min(...narrowFiveUp.map(({ height }) => height))).toBeGreaterThanOrEqual(540);
  expect(narrowFiveUp.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-5-1120x720.png") });

  await addSession(page, "New manual terminal");
  await expect(tiles).toHaveCount(6);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1686, height: 980 });
  });
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/many-up/);
  await expect(page.getByTestId("terminal-grid")).toHaveClass(/six-up/);
  const wideSixUp = await tileGeometry(tiles);
  expect(uniqueCoordinates(wideSixUp, "left")).toHaveLength(3);
  expect(uniqueCoordinates(wideSixUp, "top")).toHaveLength(2);
  expect(Math.min(...wideSixUp.map(({ height }) => height))).toBeGreaterThan(760);
  expect(wideSixUp.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-6-1686x980.png") });

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  const narrowSixUp = await tileGeometry(tiles);
  expect(uniqueCoordinates(narrowSixUp, "left")).toHaveLength(2);
  expect(uniqueCoordinates(narrowSixUp, "top")).toHaveLength(3);
  expect(Math.min(...narrowSixUp.map(({ height }) => height))).toBeGreaterThanOrEqual(540);
  expect(narrowSixUp.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-6-1120x720.png") });
});

test("scrolls the terminal Grid only from its right scrollbar gutter", async ({ harness }) => {
  const { app, page } = harness;
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();
  await input.fill("seq 1 240");
  await input.press("Enter");

  const host = page.getByTestId("xterm-host").first();
  await expect(host).toContainText("240");
  const initialTerminalRowCount = await host.locator(".xterm-rows > div").count();
  expect(initialTerminalRowCount).toBeGreaterThan(0);
  for (let index = 0; index < 5; index += 1) {
    await addSession(page, "New manual terminal");
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });

  const screen = host.locator(".xterm-screen");
  const column = page.locator(".terminal-grid-column");
  const slider = host.locator(".scrollbar.vertical .slider");
  await column.evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
  await expect.poll(async () => {
    const [screenBounds, columnBounds] = await Promise.all([screen.boundingBox(), column.boundingBox()]);
    if (!screenBounds || !columnBounds) return false;
    return screenBounds.y >= columnBounds.y && screenBounds.y < columnBounds.y + columnBounds.height;
  }).toBe(true);
  await expect.poll(() => host.locator(".xterm-rows > div").count()).toBeLessThan(initialTerminalRowCount);
  await screen.hover();

  const terminalPositionBeforeHistoryScroll = await slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  );
  await page.mouse.wheel(0, -10_000);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
  await expect.poll(() => slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  )).not.toBe(terminalPositionBeforeHistoryScroll);
  const terminalHistoryPosition = await slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  );

  let terminalBottomPosition = terminalHistoryPosition;
  await expect.poll(async () => {
    const positionBeforeWheel = await slider.evaluate(
      (element) => Number.parseFloat((element as HTMLElement).style.top),
    );
    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    terminalBottomPosition = await slider.evaluate(
      (element) => Number.parseFloat((element as HTMLElement).style.top),
    );
    return terminalBottomPosition === positionBeforeWheel;
  }, { intervals: [16] }).toBe(true);
  expect(terminalBottomPosition).toBeGreaterThan(terminalHistoryPosition);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);

  await page.mouse.wheel(0, 120);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  )).toBe(terminalBottomPosition);

  await page.locator('[data-testid="terminal-tile"]').first().locator(".tile-header").hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);

  const columnBounds = await column.boundingBox();
  expect(columnBounds).not.toBeNull();
  await page.mouse.move(columnBounds!.x + columnBounds!.width - 2, columnBounds!.y + columnBounds!.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("manual terminal adopts the Claude runtime identity", async ({ harness }, testInfo) => {
  const { page } = harness;
  const manualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  const manualInput = manualTile.getByRole("textbox", { name: "Terminal input" });

  await manualInput.fill("claude");
  await manualInput.press("Enter");

  await expect(manualTile.locator(".tile-kind-mark.claude .kind-brand-icon")).toBeVisible();
  await expect(page.locator('.project-session[data-session-id="manual-1"]')
    .locator(".project-session-kind.kind-claude .kind-brand-icon")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("manual-claude-runtime-identity.png") });
});

async function addSession(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name }).click();
}

async function tileGeometry(tiles: import("@playwright/test").Locator) {
  return tiles.evaluateAll((nodes) => nodes.map((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      scrollWidth: element.scrollWidth,
      top: Math.round(rect.top),
    };
  }));
}

function uniqueCoordinates(
  geometry: Awaited<ReturnType<typeof tileGeometry>>,
  axis: "left" | "top",
): number[] {
  return [...new Set(geometry.map((tile) => tile[axis]))];
}
