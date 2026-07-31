import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import type {
  TerminalApi,
  TerminalListResult,
  TerminalSnapshotResult,
} from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";
import {
  neutralScreenshotPointer,
  privacySafeScreenshotStyle,
} from "./support/privacy-safe-screenshot";
import { chooseWorkLayout } from "./support/work-layout";

const evidenceDir = path.resolve(
  import.meta.dirname,
  "../../../docs/audits/local-artifacts/2026-07-23-phase-j0-slice-4-context-privacy/slice-2-project-shell",
);

const longProjectLabel = "Fixture Project With A Deliberately Long Navigator Label";
const longSessionLabel = "Manual terminal with a deliberately long session label for truncation proof";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: TerminalApi };
};

type GridRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type NarrowProjectShell = {
  activeControlOverflows: Array<{
    label: string;
    className: string;
    left: number;
    right: number;
    overflow: number;
  }>;
  documentOverflow: number;
  gridTemplateColumns: string;
  layoutX: number;
  navigatorWidth: number;
  navigatorRight: number;
  orchestratorX: number;
  visibleTileCount: number;
  visibleTileHeaderHeights: number[];
};

test.use({
  fixtureOptions: {
    activeWorkspaceId: "A",
    projectShell: true,
    restoredScratchSessions: 1,
  },
});

test("proves the project-first shell without replacing xterm", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  expect(evidenceDir).toContain("2026-07-23-phase-j0-slice-4-context-privacy/slice-2-project-shell");
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, page, 1440, 900);

  const header = page.getByTestId("workbench-header");
  await expect(header).toHaveAttribute("data-chrome-height", "44");
  await expect(header).toHaveCSS("height", "44px");
  const navigator = page.getByRole("navigation", { name: "Projects and Free Chats" });
  await expect(navigator).toBeVisible();

  const projectButtons = navigator.getByRole("list", { name: "Workspaces" })
    .getByRole("button", { name: / workspace(?:,|$)/i });
  await expect(projectButtons).toHaveCount(5);
  const projectOverflow = navigator.getByRole("button", { name: "Show 2 more projects" });
  await expect(projectOverflow).toBeVisible();
  await projectOverflow.click();
  await expect(projectButtons).toHaveCount(7);
  await expect(navigator.getByRole("button", { name: `${longProjectLabel} workspace` })).toBeVisible();

  const workToolbar = page.getByRole("toolbar", { name: "Work layout controls" });
  await workToolbar.getByRole("button", { name: "New terminal" }).click();
  await expect(page.locator('article[data-session-id="manual-1"] .xterm-screen')).toBeAttached();
  await seedProjectShellTerminals(page, harness.paths.workspaceA);
  await switchProject(page, "Fixture Beta");
  await switchProject(page, "Fixture Alpha");

  const activeSessionGroup = navigator.getByRole("group", { name: "Fixture Alpha sessions" });
  await expect(activeSessionGroup.getByRole("button")).toHaveCount(6);
  await expect(activeSessionGroup.getByRole("button", { name: longSessionLabel })).toBeVisible();
  const freeChats = navigator.getByRole("group", { name: "Free Chats" });
  await expect(freeChats.getByRole("button")).toHaveCount(4);
  await expect(activeSessionGroup.getByRole("button", { name: "Restored scratch fixture 1" })).toHaveCount(0);
  await expect(freeChats.getByRole("button", { name: "Restored scratch fixture 1" })).toHaveCount(0);
  await expect((await listMainProcessTerminals(page)).restoredSessions).toHaveLength(1);
  await expect(header.getByRole("button", { name: "Open Inbox surface" })).toBeVisible();
  await expect(navigator.getByRole("button", { name: "Fixture Beta workspace" })).not.toHaveAttribute(
    "data-attention",
  );

  const alphaScreen = page.locator('article[data-session-id="manual-1"] .xterm-screen');
  const before = await requiredHandle(alphaScreen, "Alpha xterm screen");
  const gridBeforeContext = await terminalGridRect(page);

  const surfacesTrigger = page.getByRole("button", { name: "Open Surfaces menu" });
  await openContext(page);
  const gridAfterContext = await terminalGridRect(page);
  const contextWidth = await page.getByTestId("context-column").evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  expect(gridBeforeContext.width - gridAfterContext.width).toBe(318);
  expect(gridAfterContext.width).toBeGreaterThanOrEqual(420);
  expect(contextWidth).toBe(318);
  expect(Math.abs(gridAfterContext.height - gridBeforeContext.height)).toBeLessThanOrEqual(1);
  expect(await isSameConnectedNode(before, alphaScreen)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "true");
  await expect(surfacesTrigger).toBeFocused();

  await switchProject(page, "Fixture Beta");
  const backgroundMarker = await writeBackgroundMarker(page, "manual-1");
  await switchProject(page, "Fixture Alpha");
  const sameConnectedAlphaScreen = await isSameConnectedNode(before, alphaScreen);
  expect(sameConnectedAlphaScreen).toBe(true);
  await expect(alphaScreen).toContainText(backgroundMarker);

  await chooseWorkLayout(page, "Grid");
  await expect(page.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeVisible();
  await setWindowSize(app, page, 1120, 720);
  const narrow = await readNarrowProjectShell(page);
  expect(narrow.navigatorWidth).toBe(226);
  expect(narrow.gridTemplateColumns).toBe("226px 894px");
  expect(narrow.orchestratorX - narrow.layoutX).toBe(226);
  expect(narrow.orchestratorX).toBe(narrow.navigatorRight);
  expect(narrow.documentOverflow).toBe(0);
  expect(
    narrow.activeControlOverflows,
    `Narrow controls outside viewport: ${JSON.stringify(narrow.activeControlOverflows)}`,
  ).toEqual([]);
  expect(narrow.visibleTileCount).toBe(6);
  expect(narrow.visibleTileHeaderHeights.length).toBeGreaterThan(0);
  expect(narrow.visibleTileHeaderHeights).toHaveLength(narrow.visibleTileCount);
  expect(narrow.visibleTileHeaderHeights.every((height) => height === 44)).toBe(true);
  expect(await isSameConnectedNode(before, alphaScreen)).toBe(true);

  const narrowWorkspaceActions = await operateNarrowWorkspaceActions(page, navigator);
  harness.assertNoRuntimeErrors();

  const screenshotSha256 = {
    "project-shell-1120x720.png": await captureEvidence(page, "project-shell-1120x720.png"),
  };
  const runtimeProof = {
    schemaVersion: 1,
    viewport: {
      initial: { width: 1440, height: 900 },
      narrow: { width: 1120, height: 720 },
    },
    shell: {
      chromeHeight: 44,
      navigationLandmark: "Projects and Free Chats",
      projectCount: 7,
      activeSessionCount: 6,
      freeChatCount: 4,
      restoredSessionCount: 1,
      restoredSessionsExcluded: 1,
      restoredScratchExcludedFromActiveRows: true,
      restoredScratchExcludedFromFreeChats: true,
      currentReviewItemCount: 0,
      reviewAttentionWorkspace: null,
      longProjectLabelPreserved: true,
      longSessionLabelPreserved: true,
    },
    context: {
      gridBefore: gridBeforeContext,
      gridAfter: gridAfterContext,
      focusRestoredToSurfacesTrigger: true,
    },
    projectSwitch: {
      transition: "Fixture Alpha -> Fixture Beta -> Fixture Alpha",
      sameConnectedXtermScreen: sameConnectedAlphaScreen,
      backgroundOutputObserved: true,
    },
    narrow,
    narrowWorkspaceActions,
    screenshotSha256,
    runtimeErrors: 0,
  };
  const proofText = `${JSON.stringify(runtimeProof, null, 2)}\n`;
  expect(proofText).not.toContain(harness.paths.root);
  const proofPath = path.join(evidenceDir, "runtime-proof.json");
  await writeFile(proofPath, proofText, "utf8");
  await testInfo.attach("runtime-proof.json", { path: proofPath, contentType: "application/json" });
  await testInfo.attach("project-shell-1120x720.png", {
    path: path.join(evidenceDir, "project-shell-1120x720.png"),
    contentType: "image/png",
  });

  await harness.closeActiveTerminals();
});

async function seedProjectShellTerminals(page: Page, workspaceACwd: string): Promise<void> {
  await page.evaluate(async ({ activeCwd, longTitle }) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");

    const activeRequests = Array.from({ length: 5 }, (_, index) => {
      const number = index + 2;
      return terminalApi.create({
        clientId: `manual-${number}`,
        title: number === 6 ? longTitle : `Manual fixture ${number}`,
        source: "manual",
        workspaceId: "A",
        cwd: activeCwd,
        cols: 80,
        rows: 24,
      });
    });
    const freeChatRequests = Array.from({ length: 4 }, (_, index) => {
      const number = index + 1;
      return terminalApi.create({
        clientId: `free-chat-${number}`,
        title: `Free Chat ${number}`,
        source: "manual",
        workspaceId: "B",
        cols: 80,
        rows: 24,
      });
    });
    await Promise.all([...activeRequests, ...freeChatRequests]);
  }, { activeCwd: workspaceACwd, longTitle: longSessionLabel });

  await expect.poll(async () => (await listMainProcessTerminals(page)).sessions.length).toBe(10);
}

async function operateNarrowWorkspaceActions(page: Page, navigator: Locator) {
  const trigger = navigator.getByRole("button", { name: "Workspace menu for Fixture Alpha" });
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toBeVisible();
  await trigger.click();

  const actions = page.getByRole("dialog", { name: "Workspace actions" });
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button", { name: /Add mission brief/i })).toBeVisible();
  await actions.getByRole("button", { name: /Rename workspace/i }).click();

  const rename = page.getByRole("dialog", { name: "Rename workspace" });
  const input = rename.getByRole("textbox", { name: "Workspace name" });
  await expect(rename).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("Fixture Alpha Narrow");
  await input.press("Enter");
  await expect(navigator.getByRole("button", { name: "Fixture Alpha Narrow workspace" })).toBeVisible();
  await expect(navigator.getByRole("button", { name: "Workspace menu for Fixture Alpha Narrow" })).toBeVisible();

  return {
    missionBriefEntryVisible: true,
    renamedWorkspace: "Fixture Alpha Narrow",
    triggerCount: 1,
  };
}

async function openContext(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: "Context" }).click();
  await expect(page.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
}

async function switchProject(page: Page, label: "Fixture Alpha" | "Fixture Beta"): Promise<void> {
  const destination = page.getByRole("navigation", { name: "Projects and Free Chats" })
    .getByRole("button", { name: `${label} workspace` });
  await destination.click();
  await expect(destination).toHaveAttribute("aria-current", "location");
}

async function writeBackgroundMarker(page: Page, clientId: string): Promise<string> {
  const sessions = await listMainProcessTerminals(page);
  const runtime = sessions.sessions.find((session) => session.clientId === clientId);
  if (!runtime) throw new Error(`Main-process terminal ${clientId} is missing.`);

  const marker = `ALFRED_E2E_BACKGROUND_${randomUUID()}`;
  await page.evaluate(({ runtimeId, command }) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    terminalApi.write({ id: runtimeId, data: `${command}\r` });
  }, { runtimeId: runtime.id, command: encodedPrintCommand(marker) });
  await expect
    .poll(async () => (await snapshotMainProcessTerminal(page, runtime.id)).buffer)
    .toContain(marker);
  return marker;
}

function encodedPrintCommand(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const command = `printf '${hex}' | /usr/bin/xxd -r -p; printf '\\n'`;
  if (command.includes(value)) throw new Error("Encoded marker command exposed the marker.");
  return command;
}

async function listMainProcessTerminals(page: Page): Promise<TerminalListResult> {
  return page.evaluate(async () => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return terminalApi.list();
  });
}

async function snapshotMainProcessTerminal(
  page: Page,
  id: string,
): Promise<NonNullable<TerminalSnapshotResult>> {
  const snapshot = await page.evaluate(async (runtimeId) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return terminalApi.snapshot({ id: runtimeId });
  }, id);
  if (snapshot === null) throw new Error(`Main-process terminal ${id} is missing.`);
  return snapshot;
}

async function terminalGridRect(page: Page): Promise<GridRect> {
  return page.getByTestId("terminal-grid").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
  });
}

async function readNarrowProjectShell(page: Page): Promise<NarrowProjectShell> {
  return page.evaluate(() => {
    const navigator = document.querySelector<HTMLElement>("[data-testid='project-navigator']");
    if (!navigator) throw new Error("Project navigator is missing.");
    const layout = document.querySelector<HTMLElement>(".workspace-layout");
    if (!layout) throw new Error("Workspace layout is missing.");
    const orchestrator = layout.querySelector<HTMLElement>(":scope > .orchestrator-surface");
    if (!orchestrator) throw new Error("Orchestrator surface is missing.");
    const layoutRect = layout.getBoundingClientRect();
    const navigatorRect = navigator.getBoundingClientRect();
    const orchestratorRect = orchestrator.getBoundingClientRect();
    const visibleTiles = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"]:not([aria-hidden="true"])'),
    );
    const visibleTileHeaders = visibleTiles.flatMap((tile) =>
      Array.from(tile.querySelectorAll<HTMLElement>(".terminal-tile-header")),
    );
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
    return {
      activeControlOverflows: controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        const overflow = Math.max(0, -rect.left, rect.right - innerWidth);
        if (overflow <= 0.5) return [];
        return [{
          label: control.getAttribute("aria-label") ?? control.getAttribute("title") ?? control.textContent?.trim() ?? "",
          className: control.className,
          left: rect.left,
          right: rect.right,
          overflow,
        }];
      }),
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      gridTemplateColumns: getComputedStyle(layout).gridTemplateColumns,
      layoutX: layoutRect.x,
      navigatorWidth: navigatorRect.width,
      navigatorRight: navigatorRect.right,
      orchestratorX: orchestratorRect.x,
      visibleTileCount: visibleTiles.length,
      visibleTileHeaderHeights: visibleTileHeaders.map((header) => header.getBoundingClientRect().height),
    };
  });
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
