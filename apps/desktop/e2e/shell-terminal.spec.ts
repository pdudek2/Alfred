import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import {
  neutralScreenshotPointer,
  privacySafeScreenshotStyle,
} from "./support/privacy-safe-screenshot";

const evidenceDir = path.resolve(
  import.meta.dirname,
  "../../../docs/audits/local-artifacts/2026-07-13-phase-i-slice-1-shell-terminal",
);

type ShellGeometry = {
  headerHeight: number;
  visibleTileCount: number;
  visibleTileHeaderCount: number;
  tileHeaderHeights: number[];
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

test("proves the adaptive shell and preserves the first real xterm", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 900);
  await expect(page.getByTestId("workbench-header")).toBeVisible();

  await expect(page.getByTestId("xterm-host")).toHaveCount(1);
  const firstScreen = page.getByTestId("xterm-host").first().locator(".xterm-screen");
  await expect(firstScreen).toBeAttached();
  const firstScreenHandle = await requiredHandle(firstScreen, "first xterm screen");

  const r0 = await readShellGeometry(page);
  expect(r0.headerHeight).toBe(40);
  expect(r0.visibleTileCount).toBe(1);
  expect(r0.visibleTileHeaderCount).toBe(1);
  expect(r0.tileHeaderHeights).toEqual([30]);
  expect(
    r0.frameHeight - r0.headerHeight - r0.alertStackHeight,
    `R0 shell geometry: ${JSON.stringify(r0)}`,
  ).toBe(r0.workspaceLayoutHeight);
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
  await page.getByRole("button", { name: /^Manual · zsh 2,/i }).click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await readHeaderHeight(page)).toBe(40);
  await expect(visibleTerminalTiles(page)).toHaveCount(1);
  await expect(visibleTerminalTiles(page).locator(".terminal-tile-header")).toHaveCount(0);
  const r1 = await readShellGeometry(page);
  expect(r1.headerHeight).toBe(40);
  expect(r1.visibleTileCount).toBe(1);
  expect(r1.visibleTileHeaderCount).toBe(0);
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

  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveAttribute("aria-pressed", "true");
  const r6 = await readShellGeometry(page);
  expect(r6.headerHeight).toBe(40);
  expect(r6.visibleTileCount).toBe(2);
  expect(r6.visibleTileHeaderCount).toBe(2);
  expect(r6.tileHeaderHeights).toEqual([30, 30]);
  diagnosticScreenshotHashes["r6-split.png"] = await captureEvidence(page, "r6-split.png");

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  const identityTransitions: Record<string, boolean> = {
    "R0→Focus→Split→Focus": await isSameConnectedNode(firstScreenHandle, firstScreen),
  };
  expect(identityTransitions["R0→Focus→Split→Focus"]).toBe(true);

  const launchTrigger = page.getByRole("button", { name: "Open launch menu" });
  await launchTrigger.focus();
  await page.keyboard.press("Enter");
  const prepareWorkItem = page.getByRole("menuitem", { name: "Prepare Work" });
  await expect(prepareWorkItem).toBeFocused();
  await page.keyboard.press("Enter");
  const dispatchInput = page.getByRole("textbox", { name: "Dispatch instruction" });
  await expect(dispatchInput).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Prepare Work" })).toHaveCount(0);
  await expect(launchTrigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(visibleTerminalTiles(page)).toHaveCount(1);
  const focusRestoration = {
    openedWithKeyboard: true,
    restoredToLaunchTrigger: true,
    focusStillActive: true,
    visibleTileCount: 1,
  };

  await selectSurface(page, "Observatory");
  await expect(page.getByRole("region", { name: "History workspace" })).toBeVisible();
  identityTransitions["Focus→Observatory"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Focus→Observatory"]).toBe(true);
  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  identityTransitions["Observatory→Work"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Observatory→Work"]).toBe(true);
  await selectSurface(page, "Context");
  await expect(page.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
  identityTransitions["Work→Context"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Work→Context"]).toBe(true);
  await page.getByRole("button", { name: "Close Context panel" }).click();

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Grid", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(visibleTerminalTiles(page)).toHaveCount(2);
  await setWindowSize(app, page, 1120, 720);
  const narrow = await readNarrowGeometry(page);
  expect(narrow.layout).toBe("Grid");
  expect(narrow.visibleTileCount).toBe(2);
  expect(narrow.documentOverflow).toBe(0);
  expect(narrow.activeControlOverflow).toBeLessThanOrEqual(0.5);
  diagnosticScreenshotHashes["narrow-1120x720.png"] = await captureEvidence(page, "narrow-1120x720.png");
  identityTransitions["Context→narrow Grid"] = await isSameConnectedNode(firstScreenHandle, firstScreen);
  expect(identityTransitions["Context→narrow Grid"]).toBe(true);

  const runtimeProof = {
    viewport: { initial: { width: 1440, height: 900 }, narrow: { width: 1120, height: 720 } },
    r0,
    bannerAlert,
    r1,
    r6,
    narrow,
    identityTransitions,
    focusRestoration,
    diagnosticScreenshotSha256: diagnosticScreenshotHashes,
  };
  const proofText = `${JSON.stringify(runtimeProof, null, 2)}\n`;
  expect(proofText).not.toContain(harness.paths.root);
  const proofPath = path.join(evidenceDir, "runtime-proof.json");
  await writeFile(proofPath, proofText, "utf8");
  await testInfo.attach("runtime-proof.json", { path: proofPath, contentType: "application/json" });
  for (const fileName of Object.keys(diagnosticScreenshotHashes)) {
    await testInfo.attach(fileName, { path: path.join(evidenceDir, fileName), contentType: "image/png" });
  }

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function addManualTerminal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New manual terminal" }).click();
}

async function selectSurface(page: Page, surface: "Work" | "Observatory" | "Context"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

function visibleTerminalTiles(page: Page): Locator {
  return page.locator('[data-testid="terminal-tile"]:not([aria-hidden="true"])');
}

async function readHeaderHeight(page: Page): Promise<number> {
  return page.getByTestId("workbench-header").evaluate((node) => node.getBoundingClientRect().height);
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
    const visibleTileHeaders = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="terminal-tile"]:not([aria-hidden="true"]) .terminal-tile-header',
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
      visibleTileHeaderCount: visibleTileHeaders.length,
      tileHeaderHeights: visibleTileHeaders.map((node) => node.getBoundingClientRect().height),
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
  layout: string;
  visibleTileCount: number;
  documentOverflow: number;
  activeControlOverflow: number;
}> {
  return page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [role="tab"], [role="menuitem"]',
      ),
    ).filter((control) => {
      const style = getComputedStyle(control);
      const rect = control.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !control.closest('[aria-hidden="true"], [inert]')
      );
    });
    const activeControlOverflow = controls.reduce((maximum, control) => {
      const rect = control.getBoundingClientRect();
      return Math.max(maximum, Math.max(0, -rect.left, rect.right - window.innerWidth));
    }, 0);
    return {
      layout: document.querySelector('.work-surface-layout button[aria-pressed="true"]')?.textContent?.trim() ?? "",
      visibleTileCount: document.querySelectorAll(
        '[data-testid="terminal-tile"]:not([aria-hidden="true"])',
      ).length,
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      activeControlOverflow,
    };
  });
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
