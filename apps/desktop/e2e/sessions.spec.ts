import type { ElectronApplication, ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { collectControlOverflowEvidence } from "./support/control-overflow-evidence";

type DesktopSessionsWindow = Window & {
  alfredDesktop?: {
    sessions?: {
      getDiagnostics(): Promise<{
        cachedSessionCount: number;
        decodedTranscriptBytes: number;
        summaryCount: number;
        summaryBytes: number;
      }>;
      listExternalSessions(request: {
        projects: Array<{ id: string; label: string; rootPath?: string }>;
        limit?: number;
      }): Promise<unknown>;
      readTranscriptPage(request: { sessionKey: string }): Promise<unknown>;
    };
    terminal?: {
      list(): Promise<{ sessions: Array<{ id: string; buffer: string }> }>;
      snapshot(request: { id: string }): Promise<{ buffer: string } | null>;
      write(request: { id: string; data: string }): void;
    };
  };
};

test.use({ fixtureOptions: { externalSessionFixture: "mixed" } });

test("Sessions gates search, privacy, resources, geometry, lifecycle, and xterm continuity", async ({
  harness,
}, testInfo) => {
  const { app, marker, page, paths } = harness;
  const workScreen = page.locator(".xterm-screen").first();
  await expect(workScreen).toBeAttached();
  const screenBefore = await requiredHandle(workScreen, "Work xterm screen");

  await selectSurface(page, "Sessions");
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  await expect(sessions).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Projects and Free Chats" })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Search sessions" });
  await expect(search).toBeFocused();

  await page.getByRole("group", { name: "Session source" })
    .getByText("External Codex", { exact: true })
    .click();
  await expect(page.getByRole("option")).toHaveCount(12);
  expect(await page.locator(".sessions-result").count()).toBeLessThanOrEqual(80);

  await search.fill("Free chat");
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+f");
  await expect(search).toBeFocused();
  await search.fill("");
  await expect(page.getByRole("option")).toHaveCount(12);

  await page.getByRole("option", { name: /Mapped resumable session 01/i }).click();
  await expect(page.getByRole("button", { name: "Resume in Work" })).toBeVisible();
  await expect(page.getByText("Transcript is incomplete.", { exact: true })).toBeVisible();

  await page.getByRole("option", { name: /Free chat session 04/i }).click();
  await expect(page.getByRole("button", { name: "Add Project…" })).toBeVisible();

  await page.getByRole("option", { name: /Long transcript session 02/i }).click();
  const transcriptBlocks = page.locator(
    ".sessions-transcript [data-testid='transcript-block']",
  );
  await expect(transcriptBlocks).toHaveCount(50);
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    const loadMore = page.getByRole("button", { name: "Load more transcript" });
    if (!(await loadMore.isVisible().catch(() => false))) break;
    const previousCount = await transcriptBlocks.count();
    await loadMore.click();
    await expect.poll(async () => ({
      count: await transcriptBlocks.count(),
      loadMoreVisible: await loadMore.isVisible().catch(() => false),
    })).not.toEqual({ count: previousCount, loadMoreVisible: true });
  }
  const transcriptBlockCount = await transcriptBlocks.count();
  expect(transcriptBlockCount).toBeGreaterThan(0);
  expect(transcriptBlockCount).toBeLessThanOrEqual(120);

  const privacyEvidence = await page.evaluate(async ({ workspaceA, workspaceB }) => {
    const api = (window as DesktopSessionsWindow).alfredDesktop?.sessions;
    if (!api) throw new Error("Desktop Sessions API is unavailable.");
    const list = await api.listExternalSessions({
      projects: [
        { id: "A", label: "Fixture Alpha", rootPath: workspaceA },
        { id: "B", label: "Fixture Beta", rootPath: workspaceB },
      ],
      limit: 80,
    }) as { sessions: Array<{ contentSessionKey: string }> };
    const transcript = await api.readTranscriptPage({
      sessionKey: list.sessions[0]!.contentSessionKey,
    });
    return {
      apiKeys: Object.keys(api),
      serializedResponses: JSON.stringify({ list, transcript }),
    };
  }, { workspaceA: paths.workspaceA, workspaceB: paths.workspaceB });
  expect(privacyEvidence.apiKeys).not.toContain("transcriptPath");
  expect(privacyEvidence.serializedResponses).not.toContain("transcriptPath");
  expect(privacyEvidence.serializedResponses).not.toContain(paths.root);

  const diagnostics = await page.evaluate(() => {
    const api = (window as DesktopSessionsWindow).alfredDesktop?.sessions;
    if (!api) throw new Error("Desktop Sessions API is unavailable.");
    return api.getDiagnostics();
  });
  expect(diagnostics.cachedSessionCount).toBeLessThanOrEqual(3);
  expect(diagnostics.decodedTranscriptBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(diagnostics.summaryCount).toBeLessThanOrEqual(5_000);
  expect(diagnostics.summaryBytes).toBeLessThanOrEqual(10 * 1024 * 1024);

  const geometryEvidence = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1120, height: 720 },
  ]) {
    await setWindowSize(app, page, viewport.width, viewport.height);
    geometryEvidence.push({
      viewport,
      ...(await assertSessionsGeometry(page, `${viewport.width}x${viewport.height}`)),
    });
  }

  const backgroundMarker = `${marker}_SESSIONS_BACKGROUND`;
  const runtimeId = await page.evaluate(async () => {
    const terminal = (window as DesktopSessionsWindow).alfredDesktop?.terminal;
    if (!terminal) throw new Error("Desktop terminal API is unavailable.");
    return (await terminal.list()).sessions[0]?.id ?? null;
  });
  if (!runtimeId) throw new Error("Live Work runtime is unavailable.");
  await page.evaluate(({ id, command }) => {
    const terminal = (window as DesktopSessionsWindow).alfredDesktop?.terminal;
    if (!terminal) throw new Error("Desktop terminal API is unavailable.");
    terminal.write({ id, data: command });
  }, { id: runtimeId, command: `${encodedPrintCommand(backgroundMarker)}\r` });
  await expect.poll(() => page.evaluate(async (id) => {
    const terminal = (window as DesktopSessionsWindow).alfredDesktop?.terminal;
    if (!terminal) throw new Error("Desktop terminal API is unavailable.");
    return (await terminal.snapshot({ id }))?.buffer ?? "";
  }, runtimeId)).toContain(backgroundMarker);

  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  const screenAfter = await requiredHandle(page.locator(".xterm-screen").first(), "restored Work xterm screen");
  const sameXtermScreen = await screenBefore.evaluate(
    (before, after) => before.isSameNode(after) && before.isConnected,
    screenAfter,
  );
  expect(sameXtermScreen).toBe(true);
  await expect(page.locator(".xterm-screen").first()).toContainText(backgroundMarker);

  const evidence = {
    backgroundOutputVisible: await page.locator(".xterm-screen").first().evaluate(
      (screen, value) => screen.textContent?.includes(value) ?? false,
      backgroundMarker,
    ),
    diagnostics,
    externalOptionCount: 12,
    geometry: geometryEvidence,
    privacy: {
      apiHasTranscriptPath: privacyEvidence.apiKeys.includes("transcriptPath"),
      responseBytes: Buffer.byteLength(privacyEvidence.serializedResponses),
      responseHasFixtureRoot: privacyEvidence.serializedResponses.includes(paths.root),
      responseHasTranscriptPath: privacyEvidence.serializedResponses.includes("transcriptPath"),
    },
    sameXtermScreen,
    searchMatchCount: 3,
    transcriptBlockCount,
  };
  await testInfo.attach("sessions-runtime-evidence.json", {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
  console.info(JSON.stringify({ evidence: "sessions-runtime", ...evidence }));

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function selectSurface(page: Page, surface: "Work" | "Sessions"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

function encodedPrintCommand(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  return `printf '${hex}' | /usr/bin/xxd -r -p; printf '\\n'`;
}

async function requiredHandle(
  locator: Locator,
  label: string,
): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width,
    height,
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function assertSessionsGeometry(page: Page, label: string) {
  const [layoutEvidence, controlOverflowEvidence] = await Promise.all([
    page.evaluate(() => {
      const navigatorOwners = Array.from(document.querySelectorAll<HTMLElement>(".sessions-results"));
      const readerOwners = Array.from(document.querySelectorAll<HTMLElement>(".sessions-reader__scroll"));
      const sessionsLayout = document.querySelector<HTMLElement>(".workspace-layout.surface-sessions");
      const sessionsSurface = document.querySelector<HTMLElement>(
        ".workspace-layout.surface-sessions > .orchestrator-surface",
      );
      const layoutRect = sessionsLayout?.getBoundingClientRect();
      const surfaceRect = sessionsSurface?.getBoundingClientRect();
      return {
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
        navigatorOwners: navigatorOwners.map((node) => getComputedStyle(node).overflowY),
        readerOwners: readerOwners.map((node) => getComputedStyle(node).overflowY),
        surfaceOffsetLeft: layoutRect && surfaceRect
          ? Math.abs(surfaceRect.left - layoutRect.left)
          : Number.POSITIVE_INFINITY,
        surfaceWidthDelta: layoutRect && surfaceRect
          ? Math.abs(layoutRect.width - surfaceRect.width)
          : Number.POSITIVE_INFINITY,
      };
    }),
    collectControlOverflowEvidence(page, {
      controlSelector:
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [role="tab"], [role="menuitem"], [role="option"]',
      verticalScrollOwners: [
        { id: "sessions-results", label: "Sessions results", selector: ".sessions-results" },
        { id: "sessions-reader", label: "Sessions reader", selector: ".sessions-reader__scroll" },
      ],
    }),
  ]);
  const evidence = { ...layoutEvidence, controlOverflowEvidence };
  expect(evidence.documentOverflowX, `${label}: document overflow`).toBeLessThanOrEqual(0);
  expect(evidence.bodyOverflowX, `${label}: body overflow`).toBeLessThanOrEqual(0);
  expect(evidence.controlOverflowEvidence, `${label}: control overflow by side`).toEqual([]);
  expect(evidence.navigatorOwners, `${label}: navigator scroll owners`).toEqual(["auto"]);
  expect(evidence.readerOwners, `${label}: reader scroll owners`).toEqual(["auto"]);
  expect(evidence.surfaceOffsetLeft, `${label}: Sessions surface left edge`).toBeLessThanOrEqual(1);
  expect(evidence.surfaceWidthDelta, `${label}: Sessions surface width`).toBeLessThanOrEqual(1);
  return evidence;
}
