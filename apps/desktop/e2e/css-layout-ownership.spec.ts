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
import { collectControlOverflowEvidence } from "./support/control-overflow-evidence";
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
import { chooseWorkLayout } from "./support/work-layout";

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
  { name: "preview-split", selector: ".workspace-preview-split.open", required: false,
    properties: ["display", "grid-template-columns", "min-width", "overflow"] },
  { name: "preview-dock", selector: ".workspace-preview-dock", required: false,
    properties: ["display", "width", "min-width", "overflow", "background-color"] },
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
  {
    name: "context-column",
    selector: "[data-testid='context-column']",
    required: true,
    properties: [
      "display",
      "position",
      "width",
      "min-width",
      "overflow-x",
      "overflow-y",
      "border-left-width",
      "background-color",
    ],
  },
  {
    name: "context-drawer",
    selector: "[data-testid='context-drawer']",
    required: true,
    properties: [
      "display",
      "height",
      "overflow",
      "border-radius",
      "box-shadow",
    ],
  },
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
  { name: "inbox-toolbar", selector: ".inbox-docket__toolbar", required: true,
    properties: ["display", "height", "min-height", "padding", "background-color"] },
  { name: "inbox-scroll-owner", selector: ".inbox-docket__canvas", required: true,
    properties: ["display", "min-height", "overflow-x", "overflow-y", "padding", "max-width"] },
  { name: "inbox-list", selector: ".inbox-docket__list", required: true,
    properties: ["border-width", "border-radius", "background-color", "overflow"] },
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
  {
    name: "sessions-reader-body",
    selector: ".sessions-reader__body",
    required: true,
    properties: ["display", "grid-template-columns", "min-width", "min-height", "overflow"],
  },
  { name: "sessions-reader-scroll", selector: ".sessions-reader__scroll", required: true,
    properties: ["min-height", "overflow-x", "overflow-y", "background-color"] },
  {
    name: "sessions-run-details",
    selector: ".sessions-run-details",
    required: false,
    properties: [
      "display",
      "width",
      "min-width",
      "overflow-x",
      "overflow-y",
      "background-color",
      "border-left-width",
      "border-radius",
      "box-shadow",
    ],
  },
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
    {
      name: "privacy-body",
      selector: ".privacy-panel-body",
      required: true,
      properties: ["display", "min-height", "overflow-x", "overflow-y", "padding"],
    },
    {
      name: "privacy-row",
      selector: ".privacy-control-row",
      required: true,
      properties: [
        "display",
        "min-height",
        "border-bottom-width",
        "border-radius",
        "background-color",
      ],
    },
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
  await expect(page.getByTestId("workbench-header")).toHaveAttribute("data-chrome-height", "44");
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
  await expect(page.getByTestId("workbench-header")).toHaveAttribute("data-chrome-height", "44");

  await capture("work-grid", [...frameProbes, ...terminalProbes]);

  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "Prepare Work" }).click();
  await expect(page.getByRole("dialog", { name: "Prepare Work" })).toBeVisible();
  await capture("prepare-work", [...frameProbes, ...terminalProbes, ...prepareWorkProbes]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Prepare Work" })).toHaveCount(0);

  await chooseWorkLayout(page, "Focus");
  await expect(page.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Focus");
  await capture("focus", [...frameProbes, ...terminalProbes]);

  await chooseWorkLayout(page, "Split");
  await expect(page.getByRole("button", { name: "Open layout menu, Split selected" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Split");
  await capture("split", [...frameProbes, ...terminalProbes]);

  await chooseWorkLayout(page, "Grid");
  await expect(page.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Grid restored");
  await chooseWorkLayout(page, "Arrange");
  await expect(page.getByRole("button", { name: "Open layout menu, Arrange selected" })).toBeVisible();
  await expect(page.getByText("Arrange mode", { exact: true })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Arrange");
  await capture("arrange", [...frameProbes, ...terminalProbes]);
  await chooseWorkLayout(page, "Arrange");
  await expect(page.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Arrange closed");

  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Inbox");
  await capture("inbox", [...sessionsFrameProbes, ...inboxProbes]);

  await selectSurface(page, "Sessions");
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  await expect(sessions).toBeVisible();
  await expect(page.locator(".project-navigator")).toHaveCount(0);
  await sessions
    .getByRole("listbox", { name: "Conversation results" })
    .getByRole("option")
    .first()
    .click();
  await expect(page.getByRole("article")).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Sessions");
  await capture("sessions", [...sessionsFrameProbes, ...sessionsProbes]);

  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Work restored after surfaces");
  await expect(firstHost).toContainText(marker);
  await openContext(page);
  const afterContext = await readShellOwnerGeometry(page);
  expect(
    afterContext.workspaceGridColumns.trim().split(/\s+/),
  ).toHaveLength(3);
  expect(afterContext.context.position).toBe("static");
  expect(afterContext.context.rightGap).toBeCloseTo(0, 0);
  expect(afterContext.context.width).toBeCloseTo(318, 0);
  expect(afterContext.context.overlapWithTerminal).toBeLessThanOrEqual(0);
  await expect(page.getByLabel("Workspace preview")).toHaveCount(0);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Context");
  const wideContextEvidence = await capture("context-wide", [...frameProbes, ...terminalProbes, ...contextProbes]);
  expect(wideContextEvidence.documentOverflowX, "Wide Context must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const wideContext = page.getByRole("complementary", { name: "Session context" });
  const wideContextControls = [
    wideContext.getByRole("button", { name: "Close Context panel" }),
    wideContext.getByRole("button", { name: /Open external terminal/ }),
  ];
  for (const control of wideContextControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  }
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: "[data-testid='context-column'].open button:not(:disabled)",
    verticalScrollOwners: [{
      id: "context-body",
      label: "Context body",
      selector: ".context-drawer .agent-timeline-body",
    }],
  }), "Wide Context controls must remain within their scroll owner").toEqual([]);

  await page.getByRole("button", { name: "Close Context panel" }).click();
  await chooseWorkLayout(page, "Grid");
  await expect(page.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeVisible();
  await setWindowSize(app, page, 1120, 720);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow Grid");
  await capture("narrow", [...frameProbes, ...terminalProbes]);
  await openContext(page);
  const narrowContextEvidence = await capture("context-narrow", [...frameProbes, ...terminalProbes, ...contextProbes]);
  expect(narrowContextEvidence.documentOverflowX, "Narrow Context must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const narrowContext = page.getByRole("complementary", { name: "Session context" });
  const narrowContextControls = [
    narrowContext.getByRole("button", { name: "Close Context panel" }),
    narrowContext.getByRole("button", { name: /Open external terminal/ }),
  ];
  for (const control of narrowContextControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  }
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: "[data-testid='context-column'].open button:not(:disabled)",
    verticalScrollOwners: [{
      id: "context-body",
      label: "Context body",
      selector: ".context-drawer .agent-timeline-body",
    }],
  }), "Narrow Context controls must remain within their scroll owner").toEqual([]);
  await page.getByRole("button", { name: "Close Context panel" }).click();
  await page.getByTestId("workbench-header").getByRole("button", { name: /Open Inbox surface/i }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow Inbox");
  expect(
    await page.locator(".inbox-docket__detail-grid").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
    ),
  ).toHaveLength(1);
  const narrowInboxEvidence = await capture("narrow-inbox", [...sessionsFrameProbes, ...inboxProbes]);
  expect(
    narrowInboxEvidence.documentOverflowX,
    "Narrow Inbox must not create horizontal document overflow",
  ).toBeLessThanOrEqual(0);
  await expect(page.getByRole("navigation", {
    name: "Projects and Free Chats",
  })).toHaveCount(0);
  await expect(page.locator(".inbox-docket__statusbar")).toHaveCount(0);
  await expect(page.locator(".inbox-docket__toolbar")).toHaveCSS("height", "52px");
  await expect(page.locator(".inbox-docket__list")).toHaveCSS("border-radius", "0px");

  const frequentControls = [
    page.getByRole("button", { name: "Back to Work" }),
    page.locator(".inbox-docket__primary"),
  ];
  for (const control of frequentControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  }

  await page.getByRole("button", { name: "Back to Work" }).click();
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();

  await selectSurface(page, "Local Data & Privacy");
  const narrowPrivacy = page.getByRole("dialog", { name: "Local Data & Privacy" });
  await expect(narrowPrivacy).toBeVisible();
  const narrowPrivacyEvidence = await capture("privacy-narrow", [...frameProbes, ...overlayProbes.privacy]);
  expect(narrowPrivacyEvidence.documentOverflowX, "Narrow Privacy must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const narrowPrivacyToggle = narrowPrivacy.getByRole("switch", { name: "External Codex indexing" }).locator("..");
  const narrowPrivacyControls = [
    narrowPrivacy.getByRole("button", { name: "Close privacy controls" }),
    narrowPrivacy.getByRole("button", { name: "Redacted tail" }),
    narrowPrivacyToggle,
    narrowPrivacy.getByRole("button", { name: "Clear saved transcripts…" }),
    narrowPrivacy.getByRole("button", { name: "Reveal in Finder" }),
  ];
  for (const control of narrowPrivacyControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  }
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: ".privacy-panel button:not(:disabled), .privacy-panel .privacy-toggle",
    verticalScrollOwners: [{
      id: "privacy-body",
      label: "Privacy body",
      selector: ".privacy-panel-body",
    }],
  }), "Narrow Privacy controls must remain within their scroll owner").toEqual([]);
  await narrowPrivacy.getByRole("button", { name: "Close privacy controls" }).click();
  await expect(narrowPrivacy).toHaveCount(0);

  await setWindowSize(app, page, 1440, 920);
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await capture("command-palette", [...frameProbes, ...overlayProbes["command-palette"]]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  await selectSurface(page, "Local Data & Privacy");
  const widePrivacy = page.getByRole("dialog", { name: "Local Data & Privacy" });
  await expect(widePrivacy).toBeVisible();
  const widePrivacyEvidence = await capture("privacy-wide", [...frameProbes, ...overlayProbes.privacy]);
  expect(widePrivacyEvidence.documentOverflowX, "Wide Privacy must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const widePrivacyToggle = widePrivacy.getByRole("switch", { name: "External Codex indexing" }).locator("..");
  const widePrivacyControls = [
    widePrivacy.getByRole("button", { name: "Close privacy controls" }),
    widePrivacy.getByRole("button", { name: "Redacted tail" }),
    widePrivacyToggle,
    widePrivacy.getByRole("button", { name: "Clear saved transcripts…" }),
    widePrivacy.getByRole("button", { name: "Reveal in Finder" }),
  ];
  for (const control of widePrivacyControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
  }
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: ".privacy-panel button:not(:disabled), .privacy-panel .privacy-toggle",
    verticalScrollOwners: [{
      id: "privacy-body",
      label: "Privacy body",
      selector: ".privacy-panel-body",
    }],
  }), "Wide Privacy controls must remain within their scroll owner").toEqual([]);
  await widePrivacy.getByRole("button", { name: "Close privacy controls" }).click();
  await expect(widePrivacy).toHaveCount(0);

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
  context: { position: string; rightGap: number; width: number; overlapWithTerminal: number };
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
        overlapWithTerminal: Math.max(
          0,
          terminalGridBounds.right - contextBounds.left,
        ),
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
