import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import {
  assertCssEvidenceMatchesBaseline,
  captureReadinessForState,
  captureCssEvidence,
  readCssEvidence,
  writeCssEvidence,
  type CssEvidenceStateName,
  type CssOwnerProbe,
  type CssStateEvidence,
} from "./support/css-layout-evidence";
import {
  selectDisplayBounds,
  windowBoundsExpectation,
  type EvidenceDisplay,
} from "./support/display-placement";

const frameProbes: CssOwnerProbe[] = [
  { name: "desktop-frame", selector: ".desktop-frame", required: true,
    properties: ["display", "grid-template-rows", "overflow", "padding", "background-color", "border-radius"] },
  { name: "mission-bar", selector: ".mission-bar", required: true,
    properties: ["display", "min-height", "padding", "gap", "background-color", "border-bottom-width"] },
  { name: "primary-nav", selector: ".primary-nav-rail", required: true,
    properties: ["display", "width", "overflow", "padding", "background-color"] },
  { name: "workspace-navigation", selector: ".workspace-navigation-panel", required: true,
    properties: ["display", "width", "min-width", "overflow", "background-color"] },
  { name: "workbench-shell", selector: "[data-testid='workbench-shell']", required: true,
    properties: ["display", "grid-template-columns", "min-width", "min-height", "overflow"] },
];

const terminalProbes: CssOwnerProbe[] = [
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

const contextAndComposerProbes: CssOwnerProbe[] = [
  { name: "context-column", selector: "[data-testid='context-column']", required: true,
    properties: ["display", "width", "min-width", "overflow"] },
  { name: "context-drawer", selector: "[data-testid='context-drawer']", required: false,
    properties: ["display", "width", "overflow-x", "overflow-y", "background-color"] },
  { name: "composer", selector: ".composer-bar", required: true,
    properties: ["display", "grid-template-columns", "grid-template-rows", "min-height", "padding", "gap", "background-color"] },
];

const inboxProbes: CssOwnerProbe[] = [
  { name: "inbox", selector: ".inbox-surface", required: true,
    properties: ["display", "min-height", "overflow", "background-color"] },
  { name: "inbox-scroll-owner", selector: ".inbox-section-stack", required: true,
    properties: ["display", "min-height", "overflow-x", "overflow-y", "padding", "gap"] },
];

const observatoryProbes: CssOwnerProbe[] = [
  { name: "observatory", selector: ".observatory-surface", required: true,
    properties: ["display", "min-height", "overflow", "background-color"] },
  { name: "observatory-grid", selector: ".observatory-grid", required: true,
    properties: ["display", "grid-template-columns", "min-height", "overflow", "gap"] },
];

const overlayProbes: Record<"command-palette" | "privacy" | "session-quick-switch", CssOwnerProbe[]> = {
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
  "session-quick-switch": [
    { name: "session-observatory-backdrop", selector: ".session-observatory-backdrop", required: true,
      properties: ["display", "position", "inset", "padding", "background-color"] },
    { name: "session-observatory-panel", selector: ".session-observatory-panel", required: true,
      properties: ["display", "width", "max-height", "overflow", "background-color", "border-radius"] },
  ],
};

const privacySafeScreenshotStyle = `
  body *, body *::before, body *::after {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    caret-color: transparent !important;
  }
`;

test.use({ fixtureOptions: { inboxItems: 1 } });

test("captures deterministic CSS ownership evidence across core states and overlays", async ({ harness }, testInfo) => {
  const { app, marker, page } = harness;
  const evidenceDir = process.env.ALFRED_CSS_EVIDENCE_DIR ?? testInfo.outputDir;
  const states: CssStateEvidence[] = [];
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 920);
  await expect(page.getByTestId("workbench-header")).toBeVisible();
  const newTerminalButton = page.getByTestId("workbench-header").getByRole("button", { name: "New terminal" });
  await newTerminalButton.click();
  await expect(page.getByTestId("xterm-host")).toHaveCount(1);

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

  await capture("work-grid", [...frameProbes, ...terminalProbes, ...contextAndComposerProbes]);

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Focus");
  await capture("focus", [...frameProbes, ...terminalProbes, ...contextAndComposerProbes]);

  await newTerminalButton.click();
  await expect(page.getByTestId("xterm-host")).toHaveCount(2);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveAttribute("aria-pressed", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Split");
  await capture("split", [...frameProbes, ...terminalProbes, ...contextAndComposerProbes]);

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Grid", exact: true })).toHaveAttribute("aria-pressed", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Grid restored");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(page.getByText("Arrange mode", { exact: true })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Arrange");
  await capture("arrange", [...frameProbes, ...terminalProbes, ...contextAndComposerProbes]);
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(page.getByRole("button", { name: "Arrange", exact: true })).toHaveAttribute("aria-pressed", "false");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Arrange closed");

  await page.getByTestId("primary-nav-rail").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Inbox");
  await capture("inbox", [...frameProbes, ...inboxProbes]);

  await page.getByRole("button", { name: "Open History surface" }).click();
  await expect(page.getByRole("region", { name: "History workspace" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Observatory");
  await capture("observatory", [...frameProbes, ...observatoryProbes]);

  await page.getByRole("button", { name: "Open Work surface" }).click();
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Work restored after surfaces");
  await expect(firstHost).toContainText(marker);
  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Context drawer/i }).click();
  await expect(page.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Context");
  await capture("context", [...frameProbes, ...terminalProbes, ...contextAndComposerProbes]);

  await page.getByRole("button", { name: "Close Context panel" }).click();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await setWindowSize(app, page, 1120, 720);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow Grid");
  await capture("narrow", [...frameProbes, ...terminalProbes, ...contextAndComposerProbes]);

  await setWindowSize(app, page, 1440, 920);
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await capture("command-palette", [...frameProbes, ...overlayProbes["command-palette"]]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open Local Data & Privacy" }).click();
  await expect(page.getByRole("dialog", { name: "Local Data & Privacy" })).toBeVisible();
  await capture("privacy", [...frameProbes, ...overlayProbes.privacy]);
  await page.getByRole("button", { name: "Close privacy controls" }).click();
  await expect(page.getByRole("dialog", { name: "Local Data & Privacy" })).toHaveCount(0);

  await page.getByTestId("workbench-header").getByRole("button", { name: /Open session quick switch/i }).click();
  await expect(page.getByRole("dialog", { name: "Session quick switch" })).toBeVisible();
  await capture("session-quick-switch", [...frameProbes, ...overlayProbes["session-quick-switch"]]);
  await page.getByRole("button", { name: "Close session quick switch" }).click();
  await expect(page.getByRole("dialog", { name: "Session quick switch" })).toHaveCount(0);

  await writeCssEvidence(testInfo, evidenceDir, states);
  const baselineDir = process.env.ALFRED_CSS_BASELINE_DIR;
  if (baselineDir) {
    const baseline = await readCssEvidence(baselineDir);
    assertCssEvidenceMatchesBaseline(states, baseline, { geometryTolerance: 1 });
  }

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();

  async function capture(state: CssEvidenceStateName, probes: CssOwnerProbe[]): Promise<void> {
    const readiness = captureReadinessForState(state);
    if (readiness) await expect(page.locator(readiness.selector)).toHaveCount(1);
    states.push(await captureCssEvidence(page, state, probes));
    await page.screenshot({
      path: join(evidenceDir, `${state}.png`),
      style: privacySafeScreenshotStyle,
    });
  }
});

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
  await page.waitForTimeout(50);
}
