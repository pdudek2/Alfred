import { writeFile } from "node:fs/promises";
import type { ElectronApplication, ElementHandle, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./support/electron-app";

type TerminalNodeHandles = {
  tile: ElementHandle<HTMLElement>;
  host: ElementHandle<HTMLElement>;
  screen: ElementHandle<HTMLElement>;
};

test("terminal core flow preserves the real xterm and deck geometry", async ({ harness }, testInfo) => {
  const { app, marker, page } = harness;
  await expect(page.getByTestId("workbench-header")).toBeVisible();
  const firstInput = page.getByRole("textbox", { name: "Terminal input" }).first();
  await expect(firstInput).toBeVisible();
  const markerHex = Buffer.from(marker, "utf8").toString("hex");
  const markerCommand = `printf '${markerHex}' | /usr/bin/xxd -r -p; printf '\\n'`;
  expect(markerCommand).not.toContain(marker);
  await firstInput.fill(markerCommand);
  await firstInput.press("Enter");
  await expect(page.getByTestId("xterm-host").first()).toContainText(marker);

  await addManualTerminal(page);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(2);
  // Both runtimes must exist in the main process before the renderer reloads.
  await expect.poll(() => page.evaluate(async () =>
    (await window.alfredDesktop?.terminal.list())?.sessions.length ?? 0)).toBe(2);

  await page.reload();
  await expect(page.getByTestId("terminal-tile")).toHaveCount(2);
  const survivorNodes = await captureTerminalNodes(page, 2);

  await addManualTerminal(page);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(3);
  // A new session takes focus; the others stay mounted in the stack.
  const addedTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-3"]');
  await expect(addedTile).toHaveClass(/selected/);
  await expect(addedTile).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(2);
  await expect.poll(async () => page.evaluate(() => {
    const owner = document.querySelector(".terminal-grid-column");
    const header = document.querySelector('[data-testid="terminal-tile"][data-session-id="manual-3"] .terminal-tile-header');
    if (!(owner instanceof HTMLElement) || !(header instanceof HTMLElement)) return false;
    const ownerRect = owner.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return headerRect.top >= ownerRect.top && headerRect.bottom <= ownerRect.bottom;
  })).toBe(true);
  await expectTerminalNodes(survivorNodes, page, "deck membership 2→3", 3);
  await captureReviewScreenshot(page, testInfo, "deck-3-1440x920");

  const terminalNodes = await captureTerminalNodes(page);
  const identityTransitions = ["deck membership 2→3 (survivors stable)"];
  const surfaceGeometries = [await readActiveSurfaceGeometry(page, "Work initial")];

  await selectSurface(page, "History");
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  await expectTerminalNodes(terminalNodes, page, "Sessions");
  identityTransitions.push("Work→History");
  surfaceGeometries.push(await readActiveSurfaceGeometry(page, "Sessions"));

  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await expectTerminalNodes(terminalNodes, page, "Work restored");
  identityTransitions.push("History→Work");
  surfaceGeometries.push(await readActiveSurfaceGeometry(page, "Work restored"));

  await page.getByRole("complementary", { name: /^Other sessions in / })
    .locator('[data-session-id="manual-1"]').click();
  await expect(page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]')).not.toHaveAttribute("aria-hidden", "true");
  await expectTerminalNodes(terminalNodes, page, "stack swap");
  identityTransitions.push("stack swap to manual-1 (2 hidden mounted)");
  await expect(page.getByTestId("xterm-host").first()).toContainText(marker);
  await captureReviewScreenshot(page, testInfo, "deck-swap-1440x920");

  const initialGridFit = await proveGridFit(page, "Initial deck");
  const beforeResize = await readWindowGeometry(app, page);
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  await expect.poll(async () => {
    const current = await readWindowGeometry(app, page);
    return {
      boundsWidth: current.bounds.width,
      boundsHeight: current.bounds.height,
      clientViewportChanged:
        current.clientViewport.width !== beforeResize.clientViewport.width ||
        current.clientViewport.height !== beforeResize.clientViewport.height,
    };
  }).toEqual({ boundsWidth: 1120, boundsHeight: 720, clientViewportChanged: true });
  const afterResize = await readWindowGeometry(app, page);
  await captureReviewScreenshot(page, testInfo, "deck-3-1120x720");
  const narrowGridFit = await proveGridFit(page, "1120×720 deck");

  await addManualTerminal(page);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(4);
  await expect(page.locator('[data-testid="terminal-tile"]:not([aria-hidden="true"])')).toHaveCount(1);
  await captureReviewScreenshot(page, testInfo, "deck-4-1120x720");
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, width: 1440, height: 920 });
  });
  await expect.poll(async () => {
    const current = await readWindowGeometry(app, page);
    return { width: current.bounds.width, height: current.bounds.height };
  }).toEqual({ width: 1440, height: 920 });
  await captureReviewScreenshot(page, testInfo, "deck-4-1440x920");

  const runtimeProofPath = testInfo.outputPath("terminal-core-runtime-proof.json");
  await writeFile(runtimeProofPath, `${JSON.stringify({
      marker,
      markerInputEncoding: "hex",
      markerCommandContainsDecodedMarker: markerCommand.includes(marker),
      identityTransitions,
      surfaceGeometries,
      initialGridFit,
      narrowGridFit,
      beforeResize,
      afterResize,
    }, null, 2)}\n`, "utf8");
  await testInfo.attach("terminal-core-runtime-proof.json", {
    path: runtimeProofPath,
    contentType: "application/json",
  });

  for (const geometry of surfaceGeometries) assertSurfaceGeometry(geometry);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function addManualTerminal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Terminal/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
}

async function captureReviewScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(`${name}.png`, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function selectSurface(page: Page, surface: "Work" | "History"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function captureTerminalNodes(page: Page, expectedCount = 3): Promise<TerminalNodeHandles[]> {
  const tiles = page.getByTestId("terminal-tile");
  const hosts = page.getByTestId("xterm-host");
  await expect(tiles).toHaveCount(expectedCount);
  await expect(hosts).toHaveCount(expectedCount);
  const nodes: TerminalNodeHandles[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const host = hosts.nth(index);
    const screen = host.locator(".xterm-screen");
    await expect(screen).toBeAttached();
    nodes.push({
      tile: await requiredHandle(tiles.nth(index), `terminal tile ${index + 1}`),
      host: await requiredHandle(host, `xterm host ${index + 1}`),
      screen: await requiredHandle(screen, `xterm screen ${index + 1}`),
    });
  }
  return nodes;
}

async function expectTerminalNodes(
  before: TerminalNodeHandles[],
  page: Page,
  transition: string,
  expectedCount = before.length,
): Promise<void> {
  const tiles = page.getByTestId("terminal-tile");
  const hosts = page.getByTestId("xterm-host");
  await expect(tiles).toHaveCount(expectedCount);
  await expect(hosts).toHaveCount(expectedCount);
  for (const [index, nodes] of before.entries()) {
    const number = index + 1;
    await expectSameNode(nodes.tile, tiles.nth(index), `${transition}: terminal tile ${number} changed`);
    await expectSameNode(nodes.host, hosts.nth(index), `${transition}: xterm host ${number} changed`);
    await expectSameNode(
      nodes.screen,
      hosts.nth(index).locator(".xterm-screen"),
      `${transition}: xterm screen ${number} changed`,
    );
  }
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
  const same = await before.evaluate(
    (node, currentNode) => node.isSameNode(currentNode) && node.isConnected,
    after,
  );
  expect(same, message).toBe(true);
}

async function readActiveSurfaceGeometry(page: Page, label: string) {
  return page.evaluate((surfaceLabel) => {
    const owner = document.querySelector('[data-testid="workbench-surface"]');
    const activePanel = owner?.querySelector(":scope > .surface-panel.active");
    if (!(owner instanceof HTMLElement) || !(activePanel instanceof HTMLElement)) {
      throw new Error(`Active ${surfaceLabel} surface geometry nodes are missing.`);
    }
    const ownerRect = owner.getBoundingClientRect();
    const panelRect = activePanel.getBoundingClientRect();
    return {
      label: surfaceLabel,
      ownerWidth: ownerRect.width,
      ownerHeight: ownerRect.height,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
      widthDelta: Math.abs(ownerRect.width - panelRect.width),
      heightDelta: Math.abs(ownerRect.height - panelRect.height),
    };
  }, label);
}

async function readTerminalGeometry(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="desk-runtime-surface"]');
    const scrollOwner = stage?.querySelector(".terminal-grid-column");
    if (!(stage instanceof HTMLElement) || !(scrollOwner instanceof HTMLElement)) {
      throw new Error("Terminal stage or grid scroll owner is missing.");
    }
    const stageRect = stage.getBoundingClientRect();
    const scrollOwnerRect = scrollOwner.getBoundingClientRect();
    const overflowY = getComputedStyle(scrollOwner).overflowY;
    const visibleTiles = Array.from(
      stage.querySelectorAll('[data-testid="terminal-tile"]:not([aria-hidden="true"])'),
    );
    const tiles = visibleTiles.map((tile, index) => {
      const host = tile.querySelector('[data-testid="xterm-host"]');
      if (!(tile instanceof HTMLElement) || !(host instanceof HTMLElement)) {
        throw new Error(`Visible terminal geometry nodes are missing for tile ${index + 1}.`);
      }
      const tileRect = tile.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      return {
        index,
        tileWidth: tileRect.width,
        tileHeight: tileRect.height,
        hostWidth: hostRect.width,
        hostHeight: hostRect.height,
        viewportBottomOverflow: tileRect.bottom - scrollOwnerRect.bottom,
        leftOverflow: scrollOwnerRect.left - tileRect.left,
        rightOverflow: tileRect.right - scrollOwnerRect.right,
      };
    });
    return {
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
      scrollClientHeight: scrollOwner.clientHeight,
      scrollHeight: scrollOwner.scrollHeight,
      scrollTop: scrollOwner.scrollTop,
      overflowY,
      tiles,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function proveGridFit(page: Page, label: string) {
  const geometry = await readTerminalGeometry(page);
  assertTerminalGeometry(geometry);
  const lastTile = geometry.tiles.at(-1);
  expect(lastTile, "The deck must show its focused tile.").toBeDefined();
  expect(geometry.scrollTop, `${label} must stay at scrollTop 0.`).toBe(0);
  expect(geometry.scrollHeight, `${label}: ${JSON.stringify(geometry)}`)
    .toBeLessThanOrEqual(geometry.scrollClientHeight + 12);
  expect(lastTile?.viewportBottomOverflow, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(2);
  return { label, geometry };
}

async function readWindowGeometry(app: ElectronApplication, page: Page) {
  const [bounds, clientViewport] = await Promise.all([
    app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      if (!window) throw new Error("Electron window is missing.");
      return window.getBounds();
    }),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);
  return { bounds, clientViewport };
}

function assertSurfaceGeometry(geometry: Awaited<ReturnType<typeof readActiveSurfaceGeometry>>): void {
  const evidence = `${geometry.label} geometry: ${JSON.stringify(geometry)}`;
  expect(geometry.ownerWidth, evidence).toBeGreaterThan(0);
  expect(geometry.ownerHeight, evidence).toBeGreaterThan(0);
  expect(geometry.panelWidth, evidence).toBeGreaterThan(0);
  expect(geometry.panelHeight, evidence).toBeGreaterThan(0);
  expect(geometry.widthDelta, evidence).toBeLessThanOrEqual(2);
  expect(geometry.heightDelta, evidence).toBeLessThanOrEqual(2);
}

function assertTerminalGeometry(geometry: Awaited<ReturnType<typeof readTerminalGeometry>>): void {
  const evidence = `terminal geometry: ${JSON.stringify(geometry)}`;
  expect(geometry.stageWidth, evidence).toBeGreaterThan(0);
  expect(geometry.stageHeight, evidence).toBeGreaterThan(0);
  expect(["auto", "scroll"], evidence).toContain(geometry.overflowY);
  expect(geometry.tiles, evidence).toHaveLength(1);
  for (const tile of geometry.tiles) {
    expect(tile.tileWidth, evidence).toBeGreaterThan(0);
    expect(tile.tileHeight, evidence).toBeGreaterThan(0);
    expect(tile.hostWidth, evidence).toBeGreaterThan(0);
    expect(tile.hostHeight, evidence).toBeGreaterThan(0);
    expect(tile.leftOverflow, evidence).toBeLessThanOrEqual(2);
    expect(tile.rightOverflow, evidence).toBeLessThanOrEqual(2);
  }
  expect(geometry.documentOverflow, evidence).toBeLessThanOrEqual(0);
}
