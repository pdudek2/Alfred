import { mkdir, realpath } from "node:fs/promises";
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
import { openPlan } from "./support/plan-line";
import { openDetails, sessionTree, surfaceButton, treeRow } from "./support/work-layout";

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
  { name: "preview-layer", selector: ".terminal-tile-preview", required: false,
    properties: ["display", "grid-row-start", "grid-column-start", "min-width", "background-color"] },
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

const newSessionProbes: CssOwnerProbe[] = [
  { name: "new-session", selector: ".new-session-sheet", required: true,
    properties: ["display", "width", "min-width", "max-width", "background-color", "border-radius"] },
  { name: "new-session-form", selector: ".new-session-sheet form", required: true,
    properties: ["display", "grid-template-columns", "grid-template-rows", "min-height", "padding", "gap", "background-color"] },
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

test.use({ fixtureOptions: { stagedItems: 1, restoredSessions: 1, unsafeRecoveryItem: 1 } });

test("keeps the drafts-only plan line neutral at wide and narrow widths", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  const launch = page.locator(".plan-line").getByRole("button", { name: "Launch 1 ready draft" });

  // Only "waits for you" carries the signal colour; launching a ready draft is a plain action.
  await setWindowSize(app, page, 1440, 900);
  await expect(launch).toBeVisible();
  await expect(launch).toHaveCSS("color", "rgb(240, 240, 242)");
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("staged-only-wide.png"), style: privacySafeScreenshotStyle });

  await setWindowSize(app, page, 1120, 720);
  await expect(launch).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("staged-only-narrow.png"), style: privacySafeScreenshotStyle });
});

test.describe("draft plan layout", () => {
  test.use({ fixtureOptions: { stagedItems: 4 } });

  test("keeps every draft action inside its row at supported widths", async ({ harness }, testInfo) => {
    const { app, page } = harness;
    const drafts = await openPlan(page);

    for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
      await setWindowSize(app, page, width, height);
      await expect(drafts.getByRole("listitem")).toHaveCount(2);
      const geometry = await drafts.evaluate((node) => ({
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        listRight: node.getBoundingClientRect().right,
        rows: Array.from(node.querySelectorAll<HTMLElement>("li")).map((row) => {
          const rowBounds = row.getBoundingClientRect();
          const actionBounds = row.querySelector<HTMLElement>(".plan-line__actions")?.getBoundingClientRect();
          return {
            actionLeft: actionBounds?.left ?? Number.NaN,
            actionRight: actionBounds?.right ?? Number.NaN,
            rowLeft: rowBounds.left,
            rowRight: rowBounds.right,
          };
        }),
      }));

      expect(geometry.documentOverflowX).toBeLessThanOrEqual(0);
      expect(geometry.listRight).toBeLessThanOrEqual(width);
      for (const row of geometry.rows) {
        expect(row.actionLeft).toBeGreaterThanOrEqual(row.rowLeft);
        expect(row.actionRight).toBeLessThanOrEqual(row.rowRight);
      }
      await page.screenshot({
        path: testInfo.outputPath(`staged-plan-${width}x${height}.png`),
        style: privacySafeScreenshotStyle,
      });
    }
  });
});

test.describe("New session sheet layout", () => {
  test.use({ fixtureOptions: {} });

  test("aligns the picker and inherits native control schemes", async ({ harness }) => {
    const { page } = harness;
    await page.getByRole("button", { name: "New", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "New session", exact: true });
    const title = sheet.locator("header > span");
    const picker = sheet.getByRole("button", { name: "Choose project", exact: true });
    for (const label of [title, picker]) {
      await expect(label).toHaveCSS("font-size", "15px");
      await expect(label).toHaveCSS("line-height", "20px");
      await expect(label).toHaveCSS("font-weight", "500");
    }
    const titleBounds = await title.boundingBox();
    const labelBounds = await picker.locator("span").boundingBox();
    const chevronBounds = await picker.locator("svg").boundingBox();
    expect(titleBounds && labelBounds && chevronBounds).toBeTruthy();
    expect(Math.abs(titleBounds!.y - labelBounds!.y)).toBeLessThanOrEqual(1);
    expect(chevronBounds!.x).toBeGreaterThanOrEqual(labelBounds!.x + labelBounds!.width);
    await expect(sheet).toHaveCSS("color-scheme", "dark");
    // The app currently ships a dark palette; verify inheritance for a light-theme owner too.
    for (const scheme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.style.colorScheme = value; }, scheme);
      await expect(sheet).toHaveCSS("color-scheme", scheme);
      await expect(sheet.getByRole("radio").first()).toHaveCSS("color-scheme", scheme);
      await expect(sheet.getByRole("checkbox")).toHaveCSS("color-scheme", scheme);
    }
    await page.evaluate(() => document.documentElement.style.removeProperty("color-scheme"));
  });

  test("keeps three prompt rows and scrolls beyond them", async ({ harness }, testInfo) => {
    const { page } = harness;
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("radio", { name: /^Plan with Alfred/ }).click();
    const prepareWork = page.getByRole("dialog", { name: "New session" });
    const input = prepareWork.getByRole("textbox", { name: "Goal" });
    const readControlHeights = () => prepareWork.evaluate((node) => ({
      prepare: node.querySelector<HTMLElement>(".new-session-start")?.getBoundingClientRect().height,
      target: node.querySelector<HTMLElement>(".chrome-menu-trigger")?.getBoundingClientRect().height,
    }));
    await expect(input).toHaveCSS("overflow-y", "auto");
    await expect(input).toHaveCSS("resize", "none");
    const initialHeight = await input.evaluate((node) => node.clientHeight);
    const initialControlHeights = await readControlHeights();

    await input.fill("first prompt line\nsecond prompt line\nthird prompt line");
    const threeLines = await input.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(threeLines.clientHeight).toBe(initialHeight);
    expect(threeLines.scrollHeight).toBeLessThanOrEqual(threeLines.clientHeight + 1);
    expect(await readControlHeights()).toEqual(initialControlHeights);

    await input.fill("first prompt line\nsecond prompt line\nthird prompt line\nfourth prompt line");
    const fourLines = await input.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(fourLines.clientHeight).toBe(threeLines.clientHeight);
    expect(fourLines.scrollHeight).toBeGreaterThan(fourLines.clientHeight);
    expect(await readControlHeights()).toEqual(initialControlHeights);
    await page.screenshot({
      path: testInfo.outputPath("new-session-four-lines.png"),
      style: privacySafeScreenshotStyle,
    });
  });
});

test.describe("work session and project identity", () => {
  test.use({ fixtureOptions: { projectShell: true } });

  test("keeps the listed sessions and project identity readable", async ({ harness }, testInfo) => {
    const { app, page, paths } = harness;
    await setWindowSize(app, page, 1800, 900);

    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("radio", { name: /^Codex/ }).click();
    await page.getByRole("button", { name: "Start" }).click();
    for (let index = 0; index < 4; index += 1) await addManualTerminal(page);
    await expect(page.getByTestId("xterm-host")).toHaveCount(6);

    // One session holds focus; all six are listed in the rail's tree, none hidden silently.
    const treeRows = sessionTree(page).locator(".session-tree-row");
    await expect(treeRows).toHaveCount(6);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Fixture Alpha");
    await expect(page.locator(".session-location-meta")).toHaveCount(0);

    const activeProject = page.getByRole("button", { name: "Fixture Alpha project" });
    const projectLabel = activeProject.locator(".project-row-label");
    const expandedGeometry = await projectLabel.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      navigatorWidth: node.closest<HTMLElement>(".project-navigator")?.getBoundingClientRect().width ?? 0,
    }));
    // The rail has one width on the v4 canvas, whatever the window size.
    expect(expandedGeometry.navigatorWidth).toBe(264);
    expect(expandedGeometry.scrollWidth).toBeLessThanOrEqual(expandedGeometry.clientWidth);

    const selectedTile = page.locator("[data-testid='terminal-tile'].selected:not([aria-hidden='true'])");
    const selectedInput = selectedTile.getByRole("textbox", { name: "Terminal input" });
    const selectedHost = selectedTile.getByTestId("xterm-host");
    const canonicalWorkspacePath = await realpath(paths.workspaceA);
    await selectedInput.fill("pwd -P");
    await selectedInput.press("Enter");
    await expect(selectedHost).toContainText(canonicalWorkspacePath);
    await expect(selectedTile.locator(".session-location-meta")).toHaveCount(0);
    const identityScreenshotStyle = `${privacySafeScreenshotStyle}
      .project-row-label {
        color: var(--ink-5) !important;
        -webkit-text-fill-color: currentColor !important;
      }
    `;
    await page.screenshot({
      path: testInfo.outputPath("session-and-project-identity-1800x900.png"),
      style: identityScreenshotStyle,
    });

    // The active project carries one state glyph inside its row.
    const activeGlyph = activeProject.locator(".project-row-state");
    await expect(activeGlyph).toBeVisible();

    await setWindowSize(app, page, 1120, 720);
    await expect(treeRows).toHaveCount(6);
    await expect(treeRows.last()).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("session-and-project-identity-1120x720.png"),
      style: identityScreenshotStyle,
    });

    // Details at the narrow width leaves the rail alone: same width, full labels, glyph inside the row.
    await openContext(page);
    await expect(projectLabel).toBeVisible();
    await expect.poll(() => activeProject.evaluate((node) => node.closest<HTMLElement>(".project-navigator")!.getBoundingClientRect().width))
      .toBe(264);
    const compactProjectGeometry = await activeProject.evaluate((node) => {
      const button = node.getBoundingClientRect();
      const signal = node.querySelector<HTMLElement>(".project-row-state")?.getBoundingClientRect();
      return {
        button: { bottom: button.bottom, left: button.left, right: button.right, top: button.top },
        signal: signal
          ? { bottom: signal.bottom, left: signal.left, right: signal.right, top: signal.top }
          : null,
      };
    });
    expect(compactProjectGeometry.signal).not.toBeNull();
    expect(compactProjectGeometry.signal!.left).toBeGreaterThanOrEqual(compactProjectGeometry.button.left);
    expect(compactProjectGeometry.signal!.right).toBeLessThanOrEqual(compactProjectGeometry.button.right);
    expect(compactProjectGeometry.signal!.top).toBeGreaterThanOrEqual(compactProjectGeometry.button.top);
    expect(compactProjectGeometry.signal!.bottom).toBeLessThanOrEqual(compactProjectGeometry.button.bottom);
    const inactiveProject = page.getByRole("button", { name: "Fixture Beta project" });
    const [activeProjectHeight, inactiveProjectHeight] = await Promise.all([
      activeProject.evaluate((node) => node.getBoundingClientRect().height),
      inactiveProject.evaluate((node) => node.getBoundingClientRect().height),
    ]);
    expect(Math.abs(activeProjectHeight - inactiveProjectHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("project-rail-with-details-1120x720.png"),
      style: identityScreenshotStyle,
    });
  });
});

test("captures deterministic CSS ownership evidence across core states and overlays", async ({ harness }, testInfo) => {
  const { app, marker, page, paths } = harness;
  const evidenceDir = process.env.ALFRED_CSS_EVIDENCE_DIR ?? testInfo.outputDir;
  const states: CssStateEvidence[] = [];
  const privacySelectors = [...privacySafeScreenshotSelectors, ...privacySafeHiddenScreenshotSelectors];
  const privacySelectorRuntimeMatches = new Map(privacySelectors.map((selector) => [selector, false]));
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 900);
  await expect(page.getByTestId("workbench-header")).toBeVisible();
  await expect(page.locator(".plan-line")).toBeVisible();
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);
  // Arm the empty state's asleep row so its privacy masks are exercised.
  const asleep = page.getByRole("region", { name: "Asleep sessions" });
  await asleep.getByRole("button", { name: /^Review resume/ }).click();
  await expect(asleep.locator(".terminal-empty-asleep-warning")).toBeVisible();
  await recordPrivacyMaskCoverage();
  await addManualTerminal(page);
  await addManualTerminal(page);
  await expect(page.getByTestId("xterm-host")).toHaveCount(2);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(2);
  await expectDeck(page);
  await expect(page.locator(".workspace-title-trigger strong")).toHaveText("Fixture Alpha");
  await expect(page.getByTestId("workbench-header")).toHaveClass("workbench-header");
  await recordPrivacyMaskCoverage();

  // The newest terminal holds focus, so the marker goes to manual-2 and is tracked there.
  const firstHost = page.locator('[data-testid="xterm-host"][data-session-id="manual-2"]');
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
  await expect(page.getByTestId("xterm-host")).toHaveCount(3);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(3);
  await expectDeck(page);
  await addManualTerminal(page);
  await expect(page.getByTestId("xterm-host")).toHaveCount(4);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(4);
  await expectDeck(page);
  await expect(page.getByTestId("workbench-header")).toHaveClass("workbench-header");

  await capture("work-deck", [...frameProbes, ...terminalProbes]);

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Plan with Alfred/ }).click();
  await expect(page.getByRole("dialog", { name: "New session" })).toBeVisible();
  await capture("new-session", [...frameProbes, ...terminalProbes, ...newSessionProbes]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New session" })).toHaveCount(0);

  await treeRow(page, "manual-1").click();
  await expect(page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]')).not.toHaveAttribute("aria-hidden", "true");
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "tree swap");
  await expectDeck(page);
  await capture("deck-swap", [...frameProbes, ...terminalProbes]);

  await selectSurface(page, "History");
  const sessions = page.getByRole("region", { name: "History" });
  await expect(sessions).toBeVisible();
  // The rail stays on History.
  await expect(page.locator(".project-navigator")).toBeVisible();
  await sessions
    .getByRole("listbox", { name: "Session results" })
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
  ).toHaveLength(2);
  // Details holds the right column: 320px wide, inside the frame's 16px gutter.
  expect(afterContext.context.position).toBe("static");
  expect(afterContext.context.rightGap).toBeCloseTo(16, 0);
  expect(afterContext.context.width).toBeCloseTo(320, 0);
  expect(afterContext.context.overlapWithTerminal).toBeLessThanOrEqual(0);
  await expect(page.getByLabel("Project preview")).toHaveCount(0);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Details");
  const wideContextEvidence = await capture("context-wide", [...frameProbes, ...terminalProbes, ...contextProbes]);
  expect(wideContextEvidence.documentOverflowX, "Wide Context must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const wideContext = page.getByRole("complementary", { name: "Details" });
  // The heading row is 24px high on the canvas, as the tabs it replaced were.
  expect((await wideContext.locator(".side-column-header").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
  expect((await wideContext.getByRole("button", { name: /Open in terminal/ }).boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(32);
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: "[data-testid='context-column'].open button:not(:disabled)",
    verticalScrollOwners: [{
      id: "context-body",
      label: "Context body",
      selector: ".context-drawer .agent-timeline-body",
    }],
  }), "Wide Context controls must remain within their scroll owner").toEqual([]);

  // Details stays open beside the deck for the narrow captures.
  await addManualTerminal(page);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(5);
  await expectDeck(page);
  await setWindowSize(app, page, 1120, 720);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow deck");
  const narrowWorkEvidence = await capture("narrow", [...frameProbes, ...terminalProbes]);
  expect(narrowWorkEvidence.documentOverflowX, "Narrow Work must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  await expectDeck(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotionEvidence = await capture("narrow-reduced-motion", [...frameProbes, ...terminalProbes]);
  expect(reducedMotionEvidence.documentOverflowX, "Reduced-motion Work must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow reduced-motion deck");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openContext(page);
  const narrowContextGeometry = await readShellOwnerGeometry(page);
  expect(narrowContextGeometry.workspaceGridColumns.trim().split(/\s+/)).toHaveLength(2);
  // The rail no longer collapses, and Details stays a column beside the terminal instead of covering it.
  expect(narrowContextGeometry.context.position).toBe("static");
  expect(narrowContextGeometry.context.rightGap).toBeCloseTo(16, 0);
  expect(narrowContextGeometry.context.width).toBeCloseTo(1120 * 0.24, 0);
  expect(narrowContextGeometry.context.overlapWithTerminal).toBeLessThanOrEqual(0);
  const narrowContextEvidence = await capture("context-narrow", [...frameProbes, ...terminalProbes, ...contextProbes]);
  expect(narrowContextEvidence.documentOverflowX, "Narrow Context must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const narrowContext = page.getByRole("complementary", { name: "Details" });
  for (const tab of await narrowContext.getByRole("tab").all()) {
    expect((await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
  }
  expect((await narrowContext.getByRole("button", { name: /Open in terminal/ }).boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(32);
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: "[data-testid='context-column'].open button:not(:disabled)",
    verticalScrollOwners: [{
      id: "context-body",
      label: "Context body",
      selector: ".context-drawer .agent-timeline-body",
    }],
  }), "Narrow Context controls must remain within their scroll owner").toEqual([]);

  await selectSurface(page, "History");
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  const narrowHistory = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("[data-testid='workbench-shell']");
    const sessionsSurface = document.querySelector<HTMLElement>(".sessions-surface");
    const list = document.querySelector<HTMLElement>(".sessions-navigator");
    const context = document.querySelector<HTMLElement>("[data-testid='context-column']");
    if (!workspace || !sessionsSurface || !list || !context) throw new Error("Narrow History geometry is missing.");
    return {
      contextVisible: context.getClientRects().length > 0,
      listWidth: list.getBoundingClientRect().width,
      sessionsWidth: sessionsSurface.getBoundingClientRect().width,
      workspaceWidth: workspace.getBoundingClientRect().width,
    };
  });
  // Details describes the deck's focused session. Open there, it stays out of History, which keeps the
  // whole work area: the canvas list column and the reader.
  expect(narrowHistory.contextVisible).toBe(false);
  expect(narrowHistory.sessionsWidth).toBeCloseTo(narrowHistory.workspaceWidth, 0);
  expect(narrowHistory.listWidth).toBe(397);
  await proveFirstXtermIdentity(page, hostHandle, screenHandle, "Narrow History");
  const narrowSessionsEvidence = await capture("narrow-sessions", [...sessionsFrameProbes, ...sessionsProbes]);
  expect(
    narrowSessionsEvidence.documentOverflowX,
    "Narrow History must not create horizontal document overflow",
  ).toBeLessThanOrEqual(0);
  await expect(page.getByRole("navigation", {
    name: "Projects and Free Chats",
  })).toBeVisible();

  // A quiet text control on the canvas: 24px of target, not the 32px of a framed button.
  expect((await page.getByRole("button", { name: "Run details" }).boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(24);

  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  // Details comes back with the deck, as it was left.
  await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();

  await selectSurface(page, "Local Data & Privacy");
  const narrowPrivacy = page.getByRole("dialog", { name: "Local Data & Privacy" });
  await expect(narrowPrivacy).toBeVisible();
  const narrowPrivacyEvidence = await capture("privacy-narrow", [...frameProbes, ...overlayProbes.privacy]);
  expect(narrowPrivacyEvidence.documentOverflowX, "Narrow Privacy must not create horizontal document overflow")
    .toBeLessThanOrEqual(0);
  const narrowPrivacyToggle = narrowPrivacy.getByRole("switch", { name: "External Codex indexing" }).locator("..");
  const narrowPrivacyControls = [
    narrowPrivacy.getByRole("button", { name: "Done" }),
    narrowPrivacy.getByRole("button", { name: "Redacted tail" }),
    narrowPrivacyToggle,
    narrowPrivacy.getByRole("button", { name: "Clear asleep sessions…" }),
    narrowPrivacy.getByRole("button", { name: "Reveal in Finder" }),
  ];
  for (const control of narrowPrivacyControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(30);
  }
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: ".privacy-panel button:not(:disabled), .privacy-panel .privacy-toggle",
    verticalScrollOwners: [{
      id: "privacy-body",
      label: "Privacy body",
      selector: ".privacy-panel-body",
    }],
  }), "Narrow Privacy controls must remain within their scroll owner").toEqual([]);
  await narrowPrivacy.getByRole("button", { name: "Done" }).click();
  await expect(narrowPrivacy).toHaveCount(0);

  await setWindowSize(app, page, 1440, 900);
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
    widePrivacy.getByRole("button", { name: "Done" }),
    widePrivacy.getByRole("button", { name: "Redacted tail" }),
    widePrivacyToggle,
    widePrivacy.getByRole("button", { name: "Clear asleep sessions…" }),
    widePrivacy.getByRole("button", { name: "Reveal in Finder" }),
  ];
  for (const control of widePrivacyControls) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(30);
  }
  expect(await collectControlOverflowEvidence(page, {
    controlSelector: ".privacy-panel button:not(:disabled), .privacy-panel .privacy-toggle",
    verticalScrollOwners: [{
      id: "privacy-body",
      label: "Privacy body",
      selector: ".privacy-panel-body",
    }],
  }), "Wide Privacy controls must remain within their scroll owner").toEqual([]);
  await widePrivacy.getByRole("button", { name: "Done" }).click();
  await expect(widePrivacy).toHaveCount(0);

  // A cwd matching the project is intentionally omitted from tile headers. Exercise a nested cwd too.
  const nestedCwd = join(paths.workspaceA, "nested-location-evidence");
  await mkdir(nestedCwd, { recursive: true });
  await page.evaluate(async (cwd) => {
    const terminal = window.alfredDesktop?.terminal;
    if (!terminal) throw new Error("Terminal API is missing");
    await terminal.create({ clientId: "nested-location", title: "Nested location", workspaceId: "A", cwd, cols: 80, rows: 24 });
    // A scratch-root chat in another project shows under Free Chats, the rail's only session rows.
    await terminal.create({ clientId: "privacy-free-chat", title: "Privacy free chat", source: "manual", workspaceId: "B", cols: 80, rows: 24 });
  }, nestedCwd);
  await page.getByRole("button", { name: "Fixture Beta project", exact: true }).click();
  await page.getByRole("button", { name: "Fixture Alpha project", exact: true }).click();
  // Leave a busy shell with reported progress in the tree so its second line is masked too.
  const busyTile = page.locator('[data-testid="terminal-tile"]:visible');
  const busyInput = busyTile.getByRole("textbox", { name: "Terminal input" });
  await busyInput.fill("printf 'Build complete\\n'; sleep 30");
  await busyInput.press("Enter");
  await expect(busyTile.getByTestId("xterm-host")).toContainText("Build complete");
  await treeRow(page, "nested-location").click();
  await expect(page.locator('[data-session-id="nested-location"] .session-location-value')).toBeVisible();
  await expect(page.locator(".session-tree-meta").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Free Chats" }).locator(".project-session-title")).toBeVisible();
  await recordPrivacyMaskCoverage();
  await page.screenshot({ path: join(evidenceDir, "nested-location.png"), style: privacySafeScreenshotStyle });

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
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Terminal/ }).click();
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

async function openContext(page: Page): Promise<void> {
  await selectSurface(page, "Details");
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

async function expectDeck(page: Page): Promise<void> {
  const geometry = await page.getByTestId("terminal-grid").evaluate((grid) => {
    const gridBounds = grid.getBoundingClientRect();
    const tiles = Array.from(grid.querySelectorAll<HTMLElement>("[data-testid='terminal-tile']"))
      .filter((tile) => tile.getAttribute("aria-hidden") !== "true")
      .map((tile) => {
        const bounds = tile.getBoundingClientRect();
        return { height: bounds.height, right: bounds.right, width: bounds.width };
      });
    const details = document.querySelector<HTMLElement>("[data-testid='context-column']")?.getBoundingClientRect() ?? null;
    return {
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      grid: { height: gridBounds.height, width: gridBounds.width },
      details: details ? { left: details.left, width: details.width } : null,
      tiles,
    };
  });

  // One focused terminal fills the deck; Details sits beside it.
  expect(geometry.tiles).toHaveLength(1);
  expect(geometry.documentOverflowX).toBeLessThanOrEqual(0);
  expect(geometry.tiles[0]!.width).toBeGreaterThan(geometry.grid.width * 0.9);
  expect(geometry.tiles[0]!.height).toBeGreaterThan(geometry.grid.height * 0.7);
  expect(geometry.details).not.toBeNull();
  expect(geometry.tiles[0]!.right).toBeLessThanOrEqual(geometry.details!.left);
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
  const host = page.locator(`[data-testid="xterm-host"][data-session-id="${await hostBefore.getAttribute("data-session-id")}"]`);
  const hostNow = await requiredHandle(host, `${transition}: xterm host`);
  const screenNow = await requiredHandle(host.locator(".xterm-screen"), `${transition}: xterm screen`);
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
