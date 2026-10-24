import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import type { TerminalApi } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";
import { openDetails, openNewTerminalSheet, surfaceButton, treeRow } from "./support/work-layout";
import {
  collectControlOverflowEvidence,
  type ControlOverflowViolation,
} from "./support/control-overflow-evidence";
import {
  neutralScreenshotPointer,
  privacySafeScreenshotStyle,
} from "./support/privacy-safe-screenshot";

const evidenceDir = path.resolve(import.meta.dirname, "../../../output/playwright/shell-terminal");

type ShellGeometry = {
  headerHeight: number;
  visibleTileCount: number;
  visibleStripCount: number;
  stripHeights: number[];
  frameHeight: number;
  alertStackHeight: number;
  workspaceLayoutHeight: number;
  terminalColumnClientHeight: number;
  terminalColumnScrollHeight: number;
  terminalColumnScrollTop: number;
  visibleTileViewportIntersection: number;
  frameGridTemplateRows: string;
  frameChildren: Array<{ className: string; height: number; top: number }>;
};

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: TerminalApi };
};

test("proves the adaptive shell and preserves the first real xterm", async ({ harness }, testInfo) => {
  const { app, marker, page } = harness;
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 900);
  const topBar = page.getByTestId("workbench-header");
  await expect(topBar).toBeVisible();

  await expect(page.getByTestId("xterm-host")).toHaveCount(1);
  const firstScreen = page.getByTestId("xterm-host").first().locator(".xterm-screen");
  await expect(firstScreen).toBeAttached();
  const firstScreenHandle = await requiredHandle(firstScreen, "first xterm screen");

  const r0 = await readShellGeometry(page);
  expect(r0.visibleTileCount).toBe(1);
  expect(r0.visibleStripCount).toBe(1);
  expect(
    r0.frameHeight - r0.headerHeight - r0.alertStackHeight,
    `R0 shell geometry: ${JSON.stringify(r0)}`,
  ).toBe(r0.workspaceLayoutHeight);
  const wideTile = visibleTerminalTiles(page).first();
  await expect(wideTile.getByRole("button", { name: "More actions for zsh" })).toBeVisible();
  await expect(wideTile.locator("header")).toHaveCount(0);
  const bannerAlert = await proveBannerAlertGeometry(page);
  expect(bannerAlert.alertStackHeight).toBeGreaterThan(0);
  expect(
    bannerAlert.frameHeight - bannerAlert.headerHeight - bannerAlert.alertStackHeight,
    `Non-empty alert shell geometry: ${JSON.stringify(bannerAlert)}`,
  ).toBe(bannerAlert.workspaceLayoutHeight);
  const diagnosticScreenshotHashes: Record<string, string> = {};
  diagnosticScreenshotHashes["r0-one-session.png"] = await captureEvidence(page, "r0-one-session.png");

  await addManualTerminal(page);
  await expect(page.getByTestId("xterm-host")).toHaveCount(2);
  // New terminal takes focus; the first session waits in the rail's tree.
  await expect(page.locator('[data-testid="terminal-tile"][data-session-id="manual-2"]')).not.toHaveAttribute("aria-hidden", "true");
  await expect(treeRow(page, "manual-1")).toBeVisible();
  await expect(visibleTerminalTiles(page)).toHaveCount(1);
  // The focused tile has no header: its strip sits under the terminal.
  await expect(visibleTerminalTiles(page).locator(".session-strip")).toHaveCount(1);
  const r1 = await readShellGeometry(page);
  expect(r1.visibleTileCount).toBe(1);
  expect(r1.visibleStripCount).toBe(1);
  await page.locator(".terminal-grid-column").evaluate((node) => {
    node.scrollTop = 900;
  });
  const focusGeometry = await readShellGeometry(page);
  expect(focusGeometry.terminalColumnScrollHeight)
    .toBeLessThanOrEqual(focusGeometry.terminalColumnClientHeight + 1);
  expect(focusGeometry.terminalColumnScrollTop).toBe(0);
  expect(focusGeometry.visibleTileViewportIntersection).toBeGreaterThan(0);
  diagnosticScreenshotHashes["r1-focus-two-sessions.png"] = await captureEvidence(
    page,
    "r1-focus-two-sessions.png",
  );

  await treeRow(page, "manual-1").click();
  await expect(visibleTerminalTiles(page).first()).toHaveAttribute("data-session-id", "manual-1");
  const identityTransitions: Record<string, boolean> = {
    "R0→zsh 2→tree→zsh 1": await isSameConnectedNode(firstScreenHandle, firstScreen),
  };
  expect(identityTransitions["R0→zsh 2→tree→zsh 1"]).toBe(true);

  const launchTrigger = page.getByRole("button", { name: "New", exact: true });
  await launchTrigger.focus();
  await page.keyboard.press("Enter");
  const prepareWorkItem = page.getByRole("radio", { name: /^Plan with Alfred/ });
  await prepareWorkItem.click();
  const dispatchInput = page.getByRole("textbox", { name: "Goal" });
  await dispatchInput.focus();
  await expect(dispatchInput).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New session" })).toHaveCount(0);
  await expect(launchTrigger).toBeFocused();
  await expect(visibleTerminalTiles(page)).toHaveCount(1);
  const focusRestoration = {
    openedWithKeyboard: true,
    restoredToLaunchTrigger: true,
    focusStillActive: true,
    visibleTileCount: 1,
  };

  await selectSurface(page, "History");
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  identityTransitions["Focus→Sessions"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Focus→Sessions"]).toBe(true);
  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  identityTransitions["Sessions→Work"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Sessions→Work"]).toBe(true);
  await selectSurface(page, "Details");
  await expect(page.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByTestId("workbench-shell")).toHaveClass(/context-visible/);
  await expect(page.getByLabel("Project preview")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
  identityTransitions["Work→Context"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Work→Context"]).toBe(true);

  await expect(visibleTerminalTiles(page)).toHaveCount(1);
  await setWindowSize(app, page, 1120, 720);
  const narrowTile = visibleTerminalTiles(page).first();
  const compactActionsTrigger = narrowTile.locator(".session-strip-menu .chrome-menu-trigger");
  await expect(compactActionsTrigger).toBeVisible();
  await compactActionsTrigger.click();
  await expect(
    narrowTile.getByRole("menuitem", { name: /Open in external terminal/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(compactActionsTrigger).toBeFocused();
  const narrow = await readNarrowGeometry(page);
  expect(narrow.visibleTileCount).toBe(1);
  expect(narrow.documentOverflow).toBe(0);
  expect(
    narrow.activeControlOverflows,
    `Narrow controls outside viewport: ${JSON.stringify(narrow.activeControlOverflows)}`,
  ).toEqual([]);
  diagnosticScreenshotHashes["narrow-1120x720.png"] = await captureEvidence(page, "narrow-1120x720.png");
  identityTransitions["Context→narrow deck"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Context→narrow deck"]).toBe(true);

  await selectSurface(page, "Details");
  const contextBounds = await page.getByTestId("context-column").boundingBox();
  const terminalBounds = await page.locator(".terminal-stage").boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(contextBounds).not.toBeNull();
  expect(terminalBounds).not.toBeNull();
  expect(terminalBounds!.width).toBeGreaterThanOrEqual(420);
  // Details holds the right column: beside the terminal, inside the frame's 16px gutter.
  expect(contextBounds!.width).toBeCloseTo(viewportWidth * 0.24, 0);
  expect(contextBounds!.x + contextBounds!.width).toBeCloseTo(viewportWidth - 16, 0);
  expect(terminalBounds!.x + terminalBounds!.width).toBeLessThanOrEqual(contextBounds!.x);

  const surfacesTrigger = surfaceButton(page, "Local Data & Privacy");
  await selectSurface(page, "Local Data & Privacy");
  const privacyDialog = page.getByRole("dialog", { name: "Local Data & Privacy" });
  const closePrivacy = privacyDialog.getByRole("button", { name: "Close privacy controls" });
  await expect(closePrivacy).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await privacyDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  const clearSavedTranscripts = privacyDialog.getByRole("button", { name: "Clear saved transcripts…" });
  await clearSavedTranscripts.click();
  const keepData = privacyDialog.getByRole("button", { name: "Keep data" });
  await expect(keepData).toBeFocused();
  await keepData.click();
  await expect(clearSavedTranscripts).toBeFocused();

  const privacyOutputMarker = `ALFRED_E2E_PRIVACY_BACKGROUND_${marker}`;
  const markerHex = Buffer.from(privacyOutputMarker, "utf8").toString("hex");
  const markerCommand = `printf '${markerHex}' | /usr/bin/xxd -r -p; printf '\\n'`;
  expect(markerCommand).not.toContain(privacyOutputMarker);
  const firstRuntimeId = await page.evaluate(async () => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    const runtime = (await terminalApi.list()).sessions.find((session) => session.clientId === "manual-1");
    if (!runtime) throw new Error("Initial manual terminal runtime is missing.");
    return runtime.id;
  });
  await page.evaluate(({ runtimeId, input }) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    terminalApi.write({ id: runtimeId, data: `${input}\r` });
  }, { runtimeId: firstRuntimeId, input: markerCommand });
  await expect.poll(async () => page.evaluate(async ({ runtimeId, expectedMarker }) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return (await terminalApi.snapshot({ id: runtimeId }))?.buffer.includes(expectedMarker) ?? false;
  }, { runtimeId: firstRuntimeId, expectedMarker: privacyOutputMarker })).toBe(true);

  await page.keyboard.press("Escape");
  await expect(privacyDialog).toHaveCount(0);
  await expect(surfacesTrigger).toBeFocused();
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  identityTransitions["Privacy→Work"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Privacy→Work"]).toBe(true);
  await expect(firstScreen).toContainText(privacyOutputMarker);
  const backgroundOutputVisible = (await firstScreen.textContent())?.includes(privacyOutputMarker) ?? false;
  const backgroundOutputPersisted = await page.evaluate(async ({ runtimeId, expectedMarker }) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return (await terminalApi.snapshot({ id: runtimeId }))?.buffer.includes(expectedMarker) ?? false;
  }, { runtimeId: firstRuntimeId, expectedMarker: privacyOutputMarker });
  expect(backgroundOutputVisible).toBe(true);
  expect(backgroundOutputPersisted).toBe(true);

  const runtimeProof = {
    viewport: { initial: { width: 1440, height: 900 }, narrow: { width: 1120, height: 720 } },
    r0,
    bannerAlert,
    r1,
    narrow,
    identityTransitions,
    focusRestoration,
    backgroundOutputVisible,
    backgroundOutputPersisted,
    diagnosticScreenshotSha256: diagnosticScreenshotHashes,
  };
  expect(identityTransitions["Privacy→Work"]).toBe(true);
  expect(runtimeProof.backgroundOutputVisible).toBe(true);
  expect(runtimeProof.backgroundOutputPersisted).toBe(true);
  const proofText = `${JSON.stringify(runtimeProof, null, 2)}\n`;
  expect(proofText).not.toContain(harness.paths.root);
  const proofPath = path.join(evidenceDir, "runtime-proof.json");
  await writeFile(proofPath, proofText, "utf8");
  await testInfo.attach("runtime-proof.json", { path: proofPath, contentType: "application/json" });
  for (const fileName of Object.keys(diagnosticScreenshotHashes)) {
    await testInfo.attach(fileName, { path: path.join(evidenceDir, fileName), contentType: "image/png" });
  }

});

async function addManualTerminal(page: Page): Promise<void> {
  await openNewTerminalSheet(page);
  await page.getByRole("button", { name: "Start" }).click();
}

async function selectSurface(
  page: Page,
  surface: "Work" | "History" | "Details" | "Local Data & Privacy",
): Promise<void> {
  if (surface === "Details") {
    await openDetails(page);
    return;
  }
  await surfaceButton(page, surface).click();
}

function visibleTerminalTiles(page: Page): Locator {
  return page.locator('[data-testid="terminal-tile"]:not([aria-hidden="true"])');
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function isSameConnectedNode(
  before: ElementHandle<HTMLElement>,
  current: Locator,
): Promise<boolean> {
  const after = await requiredHandle(current, "current xterm screen");
  return before.evaluate(
    (beforeNode, afterNode) => beforeNode.isSameNode(afterNode) && beforeNode.isConnected,
    after,
  );
}

async function readShellGeometry(page: Page): Promise<ShellGeometry> {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="workbench-header"]');
    const frame = document.querySelector(".desktop-frame");
    const alertStack = document.querySelector(".desktop-alert-stack");
    const workspaceLayout = document.querySelector(".workspace-layout");
    if (
      !(header instanceof HTMLElement) ||
      !(frame instanceof HTMLElement) ||
      !(alertStack instanceof HTMLElement) ||
      !(workspaceLayout instanceof HTMLElement)
    ) {
      throw new Error("Adaptive shell geometry owners are missing.");
    }
    const visibleTiles = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"]:not([aria-hidden="true"])'),
    );
    const visibleStrips = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="terminal-tile"]:not([aria-hidden="true"]) .session-strip',
      ),
    );
    const terminalColumn = document.querySelector<HTMLElement>(".terminal-grid-column");
    const visibleTile = visibleTiles[0] ?? null;
    if (!terminalColumn) throw new Error("Terminal grid scroll owner is missing.");
    const columnRect = terminalColumn.getBoundingClientRect();
    const tileRect = visibleTile?.getBoundingClientRect() ?? null;
    const visibleTileViewportIntersection = tileRect
      ? Math.max(0, Math.min(columnRect.bottom, tileRect.bottom) - Math.max(columnRect.top, tileRect.top))
      : 0;

    return {
      headerHeight: header.getBoundingClientRect().height,
      visibleTileCount: visibleTiles.length,
      visibleStripCount: visibleStrips.length,
      stripHeights: visibleStrips.map((node) => node.getBoundingClientRect().height),
      frameHeight: frame.getBoundingClientRect().height,
      alertStackHeight: alertStack.getBoundingClientRect().height,
      workspaceLayoutHeight: workspaceLayout.getBoundingClientRect().height,
      terminalColumnClientHeight: terminalColumn.clientHeight,
      terminalColumnScrollHeight: terminalColumn.scrollHeight,
      terminalColumnScrollTop: terminalColumn.scrollTop,
      visibleTileViewportIntersection,
      frameGridTemplateRows: getComputedStyle(frame).gridTemplateRows,
      frameChildren: Array.from(frame.children).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          className: node instanceof HTMLElement ? node.className : node.nodeName,
          height: rect.height,
          top: rect.top,
        };
      }),
    };
  });
}

async function readNarrowGeometry(page: Page): Promise<{
  visibleTileCount: number;
  documentOverflow: number;
  activeControlOverflows: ControlOverflowViolation[];
}> {
  const [geometry, activeControlOverflows] = await Promise.all([
    page.evaluate(() => ({
      visibleTileCount: document.querySelectorAll(
        '[data-testid="terminal-tile"]:not([aria-hidden="true"])',
      ).length,
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    })),
    collectControlOverflowEvidence(page, {
      controlSelector:
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [role="tab"], [role="menuitem"]',
      verticalScrollOwners: [{
        id: "terminal-grid-column",
        label: "Terminal grid column",
        selector: ".terminal-grid-column",
      }],
    }),
  ]);
  return { ...geometry, activeControlOverflows };
}

async function proveBannerAlertGeometry(page: Page): Promise<ShellGeometry> {
  await page.evaluate(() => {
    const alertStack = document.querySelector(".desktop-alert-stack");
    if (!(alertStack instanceof HTMLElement)) throw new Error("Desktop alert stack is missing.");
    const banner = document.createElement("div");
    banner.className = "desktop-save-banner";
    banner.dataset.testAlert = "true";
    banner.ariaHidden = "true";
    banner.innerHTML = "<div><strong>Fixture alert</strong><span>Fixture detail</span></div><button>Retry</button>";
    alertStack.append(banner);
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const geometry = await readShellGeometry(page);
  await page.locator('[data-test-alert="true"]').evaluate((node) => node.remove());
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  return geometry;
}

async function captureEvidence(page: Page, fileName: string): Promise<string> {
  await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const filePath = path.join(evidenceDir, fileName);
  await page.screenshot({ path: filePath, style: privacySafeScreenshotStyle });
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
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
    window.setBounds({ x: 0, y: 0, ...size });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}
