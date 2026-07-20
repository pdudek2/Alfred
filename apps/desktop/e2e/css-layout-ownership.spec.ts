import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import {
  captureReadinessForState,
  captureCssEvidence,
  writeCssEvidence,
  type CssEvidenceStateName,
  type CssOwnerProbe,
  type CssStateEvidence,
} from "./support/css-layout-evidence";
import {
  rendererViewportMatches,
  selectDisplayBounds,
  windowBoundsExpectation,
  type EvidenceDisplay,
} from "./support/display-placement";
import {
  neutralScreenshotPointer,
  privacySafeHiddenScreenshotSelectors,
  privacySafeScreenshotSelectors,
  privacySafeScreenshotStyle,
} from "./support/privacy-safe-screenshot";

const frameProbes: CssOwnerProbe[] = [
  { name: "desktop-frame", selector: ".desktop-frame", required: true,
    properties: ["display", "grid-template-rows", "overflow", "padding", "background-color", "border-radius"] },
  { name: "mission-bar", selector: ".mission-bar", required: true,
    properties: ["display", "min-height", "padding", "gap", "background-color", "border-bottom-width"] },
  { name: "project-navigator", selector: ".project-navigator", required: true,
    properties: ["display", "width", "min-width", "overflow", "background-color"] },
  { name: "workbench-shell", selector: "[data-testid='workbench-shell']", required: true,
    properties: ["display", "grid-template-columns", "min-width", "min-height", "overflow"] },
];
const sessionsFrameProbes = frameProbes.filter((probe) => probe.name !== "project-navigator");

const extendedVisualProbes: CssOwnerProbe[] = [
  { name: "workspace-title-trigger", selector: ".workspace-title-trigger", required: true,
    properties: [
      "display", "width", "min-width", "max-width", "min-height", "grid-template-columns",
      "overflow", "font-family", "font-size", "font-weight", "line-height", "color",
    ] },
];

const terminalProbes: CssOwnerProbe[] = [
  { name: "work-surface-toolbar", selector: ".work-surface-toolbar", required: true,
    properties: ["display", "height", "min-width", "overflow", "background-color"] },
  { name: "workbench-surface", selector: "[data-testid='workbench-surface']", required: true,
    properties: ["display", "min-width", "min-height", "overflow", "background-color"] },
  { name: "terminal-stage", selector: "[data-testid='desk-runtime-surface']", required: true,
    properties: ["display", "height", "min-height", "max-height", "overflow"] },
  { name: "terminal-grid-column", selector: ".terminal-grid-column", required: true,
    properties: ["height", "min-height", "max-height", "overflow-x", "overflow-y", "padding-bottom"] },
  { name: "terminal-grid", selector: ".terminal-grid", required: true,
    properties: ["display", "grid-template-columns", "min-height", "padding-bottom", "gap"] },
  { name: "terminal-tile", selector: "[data-testid='terminal-tile']:not([aria-hidden='true'])", required: true,
    properties: ["display", "min-width", "min-height", "overflow", "background-color", "border-radius"] },
  { name: "xterm-host", selector: "[data-testid='xterm-host']", required: true,
    properties: ["display", "width", "height", "min-height", "overflow", "background-color"] },
];

const contextProbes: CssOwnerProbe[] = [
  { name: "context-column", selector: "[data-testid='context-column']", required: true,
    properties: ["display", "width", "min-width", "overflow"] },
  { name: "context-drawer", selector: "[data-testid='context-drawer']", required: false,
    properties: ["display", "width", "overflow-x", "overflow-y", "background-color"] },
];

const prepareWorkProbes: CssOwnerProbe[] = [
  { name: "prepare-work", selector: ".prepare-work-popover", required: true,
    properties: ["display", "width", "min-width", "max-width", "background-color", "border-radius"] },
  { name: "composer", selector: ".composer-bar", required: true,
    properties: ["display", "grid-template-columns", "grid-template-rows", "min-height", "padding", "gap", "background-color"] },
];

const inboxProbes: CssOwnerProbe[] = [
  { name: "inbox", selector: ".inbox-docket", required: true,
    properties: ["display", "min-height", "overflow", "background-color"] },
  { name: "inbox-scroll-owner", selector: ".inbox-docket__canvas", required: true,
    properties: ["display", "min-height", "overflow-x", "overflow-y", "padding", "max-width"] },
  { name: "inbox-detail", selector: ".inbox-docket__detail-grid", required: true,
    properties: ["display", "grid-template-columns", "min-width", "overflow"] },
];

const sessionsProbes: CssOwnerProbe[] = [
  { name: "sessions", selector: ".sessions-surface", required: true,
    properties: ["display", "grid-template-columns", "min-height", "overflow", "background-color"] },
  { name: "sessions-navigator", selector: ".sessions-navigator", required: true,
    properties: ["display", "min-height", "overflow", "background-color", "border-right-width"] },
  { name: "sessions-results", selector: ".sessions-results", required: true,
    properties: ["min-height", "overflow-x", "overflow-y", "background-color"] },
  { name: "sessions-reader", selector: ".sessions-reader", required: true,
    properties: ["display", "grid-template-rows", "min-width", "min-height", "overflow", "background-color"] },
  { name: "sessions-reader-scroll", selector: ".sessions-reader__scroll", required: true,
    properties: ["min-height", "overflow-x", "overflow-y", "background-color"] },
];

const overlayProbes: Record<"command-palette" | "privacy", CssOwnerProbe[]> = {
  "command-palette": [
    { name: "command-palette-backdrop", selector: ".command-palette-backdrop", required: true,
      properties: ["display", "position", "inset", "padding-top", "background-color"] },
    { name: "command-palette", selector: ".command-palette", required: true,
      properties: ["display", "width", "max-height", "overflow", "background-color", "border-radius"] },
  ],
  privacy: [
    { name: "privacy-backdrop", selector: ".privacy-backdrop", required: true,
      properties: ["display", "position", "inset", "padding", "background-color"] },
    { name: "privacy-panel", selector: ".privacy-panel", required: true,
      properties: ["display", "width", "max-height", "overflow", "background-color", "border-radius"] },
  ],
};

test.use({ fixtureOptions: { inboxItems: 1 } });

test("captures deterministic CSS ownership evidence across core states and overlays", async ({ harness }, testInfo) => {
  const { app, marker, page } = harness;
  const evidenceDir = process.env.ALFRED_CSS_EVIDENCE_DIR ?? testInfo.outputDir;
  const states: CssStateEvidence[] = [];
  const privacySelectors = [...privacySafeScreenshotSelectors, ...privacySafeHiddenScreenshotSelectors];
  const privacySelectorRuntimeMatches = new Map(privacySelectors.map((selector) => [selector, false]));
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 920);
  await expect(page.getByTestId("workbench-header")).toBeVisible();
  await addManualTerminal(page);
  await expect(page.getByTestId("xterm-host")).toHaveCount(1);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(2);
  await expect(page.locator(".workspace-title-trigger strong")).toHaveText("Fixture Alpha");
  await expect(page.getByTestId("workbench-header")).toHaveClass("workbench-header");
  await expect(page.getByTestId("workbench-header")).toHaveAttribute("data-chrome-height", "40");
  await recordPrivacyMaskCoverage();

  const firstHost = page.getByTestId("xterm-host").first();
  const firstScreen = firstHost.locator(".xterm-screen");
  await expect(firstScreen).toBeAttached();
  const hostHandle = await requiredHandle(firstHost, "initial xterm host");
  const screenHandle = await requiredHandle(firstScreen, "initial xterm screen");

  const terminalInput = page.getByRole("textbox", { name: "Terminal input" }).first();
  const markerHex = Buffer.from(marker, "utf8").toString("hex");
  const markerCommand = `printf '${markerHex}' | /usr/bin/xxd -r -p; printf '\\n'`;
  expect(markerCommand).not.toContain(marker);
  await terminalInput.fill(markerCommand);
  await terminalInput.press("Enter");
  await expect(firstHost).toContainText(marker);

  await addManualTerminal(page);
  await expect(page.getByTestId("xterm-host")).toHaveCount(2);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(3);
  await expect(page.getByTestId("workbench-header")).toHaveClass("workbench-header");
  await expect(page.getByTestId("workbench-header")).toHaveAttribute("data-chrome-height", "40");

  await capture("work-grid", [...frameProbes, ...terminalProbes]);

  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "Prepare Work" }).click();
  await expect(page.getByRole("dialog", { name: "Prepare Work" })).toBeVisible();
  await capture("prepare-work", [...frameProbes, ...terminalProbes, ...prepareWorkProbes]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Prepare Work" })).toHaveCount(0);

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Focus");
  await capture("focus", [...frameProbes, ...terminalProbes]);

  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveAttribute("aria-pressed", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Split");
  await capture("split", [...frameProbes, ...terminalProbes]);

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Grid", exact: true })).toHaveAttribute("aria-pressed", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Grid restored");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(page.getByText("Arrange mode", { exact: true })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Arrange");
  await capture("arrange", [...frameProbes, ...terminalProbes]);
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(page.getByRole("button", { name: "Arrange", exact: true })).toHaveAttribute("aria-pressed", "false");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Arrange closed");

  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Inbox");
  await capture("inbox", [...frameProbes, ...inboxProbes]);

  await selectSurface(page, "Sessions");
  await expect(page.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
  await expect(page.locator(".project-navigator")).toHaveCount(0);
  await page.getByRole("option").first().click();
  await expect(page.getByRole("article")).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Sessions");
  await capture("sessions", [...sessionsFrameProbes, ...sessionsProbes]);

  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Work restored after surfaces");
  await expect(firstHost).toContainText(marker);
  const beforeContext = await readShellOwnerGeometry(page);
  await openContext(page);
  const afterContext = await readShellOwnerGeometry(page);
  expect(afterContext.workspaceGridColumns).toBe(beforeContext.workspaceGridColumns);
  expect(Math.abs(afterContext.terminalGrid.width - beforeContext.terminalGrid.width)).toBeLessThanOrEqual(1);
  expect(afterContext.context.position).toBe("absolute");
  expect(afterContext.context.rightGap).toBeCloseTo(12, 0);
  expect(afterContext.context.width).toBeLessThanOrEqual(336);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Context");
  await capture("context", [...frameProbes, ...terminalProbes, ...contextProbes]);

  await page.getByRole("button", { name: "Close Context panel" }).click();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await setWindowSize(app, page, 1120, 720);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow Grid");
  await capture("narrow", [...frameProbes, ...terminalProbes]);
  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow Inbox");
  expect(
    await page.locator(".inbox-docket__detail-grid").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
    ),
  ).toHaveLength(1);
  const narrowInboxEvidence = await capture("narrow-inbox", [...frameProbes, ...inboxProbes]);
  expect(
    narrowInboxEvidence.documentOverflowX,
    "Narrow Inbox must not create horizontal document overflow",
  ).toBeLessThanOrEqual(0);
  await page.getByRole("navigation", { name: "Primary surfaces" }).getByRole("button", { name: "Work" }).click();
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();

  await setWindowSize(app, page, 1440, 920);
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await capture("command-palette", [...frameProbes, ...overlayProbes["command-palette"]]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  await selectSurface(page, "Local Data & Privacy");
  await expect(page.getByRole("dialog", { name: "Local Data & Privacy" })).toBeVisible();
  await capture("privacy", [...frameProbes, ...overlayProbes.privacy]);
  await page.getByRole("button", { name: "Close privacy controls" }).click();
  await expect(page.getByRole("dialog", { name: "Local Data & Privacy" })).toHaveCount(0);

  expect(
    [...privacySelectorRuntimeMatches].filter(([, matched]) => !matched).map(([selector]) => selector),
    "Every privacy screenshot selector must match the fixture DOM in at least one exercised state",
  ).toEqual([]);

  await writeCssEvidence(testInfo, evidenceDir, states);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();

  async function capture(state: CssEvidenceStateName, probes: CssOwnerProbe[]): Promise<CssStateEvidence> {
    await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    }));
    const readiness = captureReadinessForState(state);
    if (readiness) await expect(page.locator(readiness.selector)).toHaveCount(1);
    await page.locator(".tile-utility-actions, .tile-danger-actions").evaluateAll(async (elements) => {
      await Promise.allSettled(elements.flatMap((element) => element.getAnimations()).map((animation) => animation.finished));
    });
    const captureProbes = process.env.ALFRED_CSS_EXTENDED_VISUAL_PROBES === "1"
      ? [...probes, ...extendedVisualProbes]
      : probes;
    const evidence = await captureCssEvidence(page, state, captureProbes);
    states.push(evidence);
    await recordPrivacyMaskCoverage();
    await page.screenshot({
      path: join(evidenceDir, `${state}.png`),
      style: privacySafeScreenshotStyle,
    });
    return evidence;
  }

  async function recordPrivacyMaskCoverage(): Promise<void> {
    for (const selector of privacySelectors) {
      if (!privacySelectorRuntimeMatches.get(selector) && await page.locator(selector).count() > 0) {
        privacySelectorRuntimeMatches.set(selector, true);
      }
    }
  }
});

async function addManualTerminal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New manual terminal" }).click();
}

async function selectSurface(
  page: Page,
  surface: "Work" | "Sessions" | "Context" | "Local Data & Privacy",
): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function openContext(page: Page): Promise<void> {
  await selectSurface(page, "Context");
  await expect(page.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
}

async function readShellOwnerGeometry(page: Page): Promise<{
  workspaceGridColumns: string;
  terminalGrid: { width: number };
  context: { position: string; rightGap: number; width: number };
}> {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("[data-testid='workbench-shell']");
    const terminalGrid = document.querySelector<HTMLElement>("[data-testid='terminal-grid']");
    const context = document.querySelector<HTMLElement>("[data-testid='context-column']");
    if (!workspace || !terminalGrid || !context) throw new Error("Shell geometry owner is missing.");

    const workspaceBounds = workspace.getBoundingClientRect();
    const terminalGridBounds = terminalGrid.getBoundingClientRect();
    const contextBounds = context.getBoundingClientRect();
    return {
      workspaceGridColumns: getComputedStyle(workspace).gridTemplateColumns,
      terminalGrid: { width: terminalGridBounds.width },
      context: {
        position: getComputedStyle(context).position,
        rightGap: workspaceBounds.right - contextBounds.right,
        width: contextBounds.width,
      },
    };
  });
}

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function proveFirstXtermIdentity(
  page: Page,
  hostBefore: ElementHandle<HTMLElement>,
  screenBefore: ElementHandle<HTMLElement>,
  transition: string,
): Promise<void> {
  const hostNow = await requiredHandle(page.getByTestId("xterm-host").first(), `${transition}: xterm host`);
  const screenNow = await requiredHandle(
    page.getByTestId("xterm-host").first().locator(".xterm-screen"),
    `${transition}: xterm screen`,
  );
  expect(await hostBefore.evaluate((node, current) => node.isSameNode(current) && node.isConnected, hostNow),
    `${transition}: xterm host identity changed`).toBe(true);
  expect(await screenBefore.evaluate((node, current) => node.isSameNode(current) && node.isConnected, screenNow),
    `${transition}: xterm screen identity changed`).toBe(true);
}

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const targetScaleFactorValue = process.env.ALFRED_CSS_TARGET_SCALE_FACTOR;
  const targetScaleFactor = targetScaleFactorValue === undefined
    ? undefined
    : Number(targetScaleFactorValue);
  let bounds = { x: 0, y: 0, width, height };

  if (targetScaleFactor !== undefined) {
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map((display) => ({
      id: display.id,
      scaleFactor: display.scaleFactor,
      workArea: display.workArea,
    }))) as EvidenceDisplay[];
    bounds = selectDisplayBounds(displays, targetScaleFactor, { width, height }).bounds;
  }

  await app.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds(size);
  }, bounds);
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    return window?.getBounds() ?? null;
  })).toMatchObject(windowBoundsExpectation(bounds, targetScaleFactor !== undefined));
  if (targetScaleFactor !== undefined) {
    await expect.poll(
      () => page.evaluate(() => window.devicePixelRatio),
      { message: `Expected Electron renderer devicePixelRatio ${targetScaleFactor}` },
    ).toBe(targetScaleFactor);
  }
  await expect.poll(
    async () => rendererViewportMatches(
      await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
      { width, height },
    ),
    { message: `Expected renderer viewport ${width}x${height}` },
  ).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
}
