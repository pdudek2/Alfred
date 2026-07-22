import { writeFile } from "node:fs/promises";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { chooseWorkLayout } from "./support/work-layout";

type TerminalNodeHandles = {
  tile: ElementHandle<HTMLElement>;
  host: ElementHandle<HTMLElement>;
  screen: ElementHandle<HTMLElement>;
};

test("terminal core flow preserves the real xterm and layout geometry", async ({ harness }, testInfo) => {
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
  await addManualTerminal(page);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(3);

  await expect(page.getByRole("button", { name: "Open layout menu, Grid selected" })).toHaveCount(1);

  const terminalNodes = await captureTerminalNodes(page);
  const identityTransitions: string[] = [];
  const surfaceGeometries = [await readActiveSurfaceGeometry(page, "Work initial")];

  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await expectTerminalNodes(terminalNodes, page, "Inbox");
  identityTransitions.push("Work→Inbox");
  surfaceGeometries.push(await readActiveSurfaceGeometry(page, "Inbox"));

  await selectSurface(page, "Sessions");
  await expect(page.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
  await expectTerminalNodes(terminalNodes, page, "Sessions");
  identityTransitions.push("Inbox→Sessions");
  surfaceGeometries.push(await readActiveSurfaceGeometry(page, "Sessions"));

  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await expectTerminalNodes(terminalNodes, page, "Work restored");
  identityTransitions.push("Sessions→Work");
  surfaceGeometries.push(await readActiveSurfaceGeometry(page, "Work restored"));
  await expect(page.getByTestId("xterm-host").first()).toContainText(marker);

  await chooseWorkLayout(page, "Focus");
  await expect(page.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeVisible();
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(2);
  await expectTerminalNodes(terminalNodes, page, "Focus");
  identityTransitions.push("Work→Focus (2 hidden mounted)");

  await chooseWorkLayout(page, "Split");
  await expect(page.getByRole("button", { name: "Open layout menu, Split selected" })).toBeVisible();
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(1);
  await expectTerminalNodes(terminalNodes, page, "Split");
  identityTransitions.push("Focus→Split (1 hidden mounted)");

  await chooseWorkLayout(page, "Grid");
  await expect(page.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeVisible();
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(0);
  await expectTerminalNodes(terminalNodes, page, "Grid");
  identityTransitions.push("Split→Grid (all restored)");
  await expect(page.getByTestId("xterm-host").first()).toContainText(marker);

  const initialGridScroll = await proveGridScroll(page, "Initial Grid");
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
  const narrowGridScroll = await proveGridScroll(page, "1120×720 Grid");

  const runtimeProofPath = testInfo.outputPath("terminal-core-runtime-proof.json");
  await writeFile(runtimeProofPath, `${JSON.stringify({
      marker,
      markerInputEncoding: "hex",
      markerCommandContainsDecodedMarker: markerCommand.includes(marker),
      identityTransitions,
      surfaceGeometries,
      initialGridScroll,
      narrowGridScroll,
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
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New manual terminal" }).click();
}

async function selectSurface(page: Page, surface: "Work" | "Sessions"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function captureTerminalNodes(page: Page): Promise<TerminalNodeHandles[]> {
  const tiles = page.getByTestId("terminal-tile");
  const hosts = page.getByTestId("xterm-host");
  await expect(tiles).toHaveCount(3);
  await expect(hosts).toHaveCount(3);
  const nodes: TerminalNodeHandles[] = [];
  for (let index = 0; index < 3; index += 1) {
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
): Promise<void> {
  const tiles = page.getByTestId("terminal-tile");
  const hosts = page.getByTestId("xterm-host");
  await expect(tiles).toHaveCount(before.length);
  await expect(hosts).toHaveCount(before.length);
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

async function proveGridScroll(page: Page, label: string) {
  const before = await readTerminalGeometry(page);
  assertGridBeforeScroll(before, label);

  const lastVisibleTile = page
    .locator('[data-testid="desk-runtime-surface"] [data-testid="terminal-tile"]:not([aria-hidden="true"])')
    .last();
  await lastVisibleTile.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await readTerminalGeometry(page)).scrollTop).toBeGreaterThan(0);

  const after = await readTerminalGeometry(page);
  assertGridAfterScroll(after, label);

  const scrollOwner = page.locator('[data-testid="desk-runtime-surface"] .terminal-grid-column');
  await scrollOwner.evaluate((element) => element.scrollTo(0, 0));
  await expect.poll(async () => (await readTerminalGeometry(page)).scrollTop).toBe(0);
  return { label, before, after, restoredScrollTop: 0 };
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
  expect(geometry.scrollHeight, evidence).toBeGreaterThan(geometry.scrollClientHeight);
  expect(["auto", "scroll"], evidence).toContain(geometry.overflowY);
  expect(geometry.tiles, evidence).toHaveLength(3);
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

function assertGridBeforeScroll(
  geometry: Awaited<ReturnType<typeof readTerminalGeometry>>,
  label: string,
): void {
  assertTerminalGeometry(geometry);
  const lastTile = geometry.tiles.at(-1);
  expect(lastTile, "Grid must contain a last visible tile.").toBeDefined();
  expect(geometry.scrollTop, `${label} must start at scrollTop 0.`).toBe(0);
  expect(lastTile?.viewportBottomOverflow, `${label} before scroll: ${JSON.stringify(geometry)}`).toBeGreaterThan(0);
}

function assertGridAfterScroll(
  geometry: Awaited<ReturnType<typeof readTerminalGeometry>>,
  label: string,
): void {
  assertTerminalGeometry(geometry);
  const lastTile = geometry.tiles.at(-1);
  expect(lastTile, "Grid must contain a last visible tile.").toBeDefined();
  expect(geometry.scrollTop, `${label} must have scrolled.`).toBeGreaterThan(0);
  expect(lastTile?.viewportBottomOverflow, `${label} after scroll: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(2);
}
