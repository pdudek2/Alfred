import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { Page } from "@playwright/test";
import type {
  TerminalApi,
  TerminalListResult,
  TerminalSnapshotResult,
} from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: TerminalApi };
  alfredE2eTerminalDataWaits?: Map<
    string,
    {
      result: Promise<{ ok: true } | { ok: false; error: string }>;
      cleanup: () => void;
    }
  >;
};

test.use({ fixtureOptions: { activeWorkspaceId: "A" } });

test("workspace switch keeps the same xterm node and streams background output", async ({
  harness,
}) => {
  const { marker, page, paths } = harness;
  const terminalInput = page.getByRole("textbox", { name: "Terminal input" });
  const terminalHost = page.getByTestId("xterm-host");
  const terminalTiles = page.getByTestId("terminal-tile");
  const firstMarkerCommand = encodedPrintCommand(marker);

  expect(firstMarkerCommand).not.toContain(marker);
  await expect(terminalInput).toBeVisible();
  await terminalInput.fill(firstMarkerCommand);
  await terminalInput.press("Enter");
  await expect(terminalHost).toContainText(marker);
  await expect(terminalTiles).toHaveCount(1);
  const beforeSwitchRuntimes = await listMainProcessTerminals(page);
  expect(beforeSwitchRuntimes.sessions).toHaveLength(1);
  const runtimeId = beforeSwitchRuntimes.sessions[0]?.id;
  if (runtimeId === undefined) throw new Error("Workspace A runtime is missing before switch.");
  const alphaTile = page.locator('article[data-session-id="manual-1"]');
  const alphaScreen = alphaTile.locator(".xterm-screen");
  await expect(alphaScreen).toBeAttached();
  const screenBefore = await alphaScreen.elementHandle();
  if (!screenBefore) throw new Error("Workspace A xterm screen is missing before switch.");

  const betaWorkspace = page.getByRole("tab", { name: /Fixture Beta workspace/i });
  const alphaWorkspace = page.getByRole("tab", { name: /Fixture Alpha workspace/i });
  await betaWorkspace.click();
  await expect(betaWorkspace).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("status", { name: "Empty workspace" })).toBeVisible();
  await expect(alphaWorkspace).toHaveAttribute("aria-selected", "false");
  await expect(alphaTile).toHaveAttribute("data-testid", "background-terminal-tile");
  expect(await screenBefore.evaluate((node) => node.isConnected)).toBe(true);

  const backgroundMarker = `ALFRED_E2E_BACKGROUND_${randomUUID()}`;
  const rendererDataWait = await installRendererTerminalDataWait(page, runtimeId, backgroundMarker);
  try {
    await Promise.all([
      rendererDataWait.received,
      (async () => {
        await writeMainProcessTerminal(page, runtimeId, `${encodedPrintCommand(backgroundMarker)}\r`);
        await expect
          .poll(async () => (await snapshotMainProcessTerminal(page, runtimeId)).buffer)
          .toContain(backgroundMarker);
      })(),
    ]);
  } finally {
    await rendererDataWait.cleanup();
  }

  await alphaWorkspace.click();
  await expect(alphaWorkspace).toHaveAttribute("aria-selected", "true");
  await expect(terminalTiles).toHaveCount(1);
  await expect(terminalHost).toContainText(marker);
  const screenAfter = await alphaTile.locator(".xterm-screen").elementHandle();
  if (!screenAfter) throw new Error("Workspace A xterm screen is missing after return.");
  const sameNode = await screenBefore.evaluate(
    (before, after) => before.isSameNode(after) && before.isConnected,
    screenAfter,
  );
  expect(sameNode).toBe(true);
  await expect(alphaTile.locator(".xterm-screen")).toContainText(backgroundMarker);
  const afterReturnRuntimes = await listMainProcessTerminals(page);
  expect(afterReturnRuntimes.sessions).toHaveLength(1);
  expect(afterReturnRuntimes.sessions[0]?.id).toBe(runtimeId);
  const afterReturnSnapshot = await snapshotMainProcessTerminal(page, runtimeId);
  expect(afterReturnSnapshot.id).toBe(runtimeId);
  expect(afterReturnSnapshot.buffer).toContain(marker);
  const cwdLabel = terminalTiles.locator('[aria-label^="cwd "]');
  await expect(cwdLabel).toHaveCount(1);
  const cwdAriaLabel = await cwdLabel.getAttribute("aria-label");
  if (cwdAriaLabel === null) throw new Error("Terminal CWD label is missing.");
  const actualCwd = cwdAriaLabel.slice("cwd ".length);
  expect(await realpath(actualCwd)).toBe(await realpath(paths.workspaceA));

  const secondMarker = `ALFRED_E2E_AFTER_SWITCH_${randomUUID()}`;
  const secondMarkerCommand = encodedPrintCommand(secondMarker);
  expect(secondMarkerCommand).not.toContain(secondMarker);
  await expect(terminalInput).toBeVisible();
  await terminalInput.fill(secondMarkerCommand);
  await terminalInput.press("Enter");
  await expect(terminalHost).toContainText(marker);
  await expect(terminalHost).toContainText(secondMarker);
  await expect(terminalTiles).toHaveCount(1);
  const afterWriteRuntimes = await listMainProcessTerminals(page);
  expect(afterWriteRuntimes.sessions.map((session) => session.id)).toEqual([runtimeId]);
  const afterWriteSnapshot = await snapshotMainProcessTerminal(page, runtimeId);
  expect(afterWriteSnapshot.buffer).toContain(marker);
  expect(afterWriteSnapshot.buffer).toContain(secondMarker);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

function encodedPrintCommand(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  return `printf '${hex}' | /usr/bin/xxd -r -p; printf '\\n'`;
}

async function writeMainProcessTerminal(page: Page, id: string, data: string): Promise<void> {
  await page.evaluate(({ runtimeId, input }) => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    terminalApi.write({ id: runtimeId, data: input });
  }, { runtimeId: id, input: data });
}

async function installRendererTerminalDataWait(
  page: Page,
  id: string,
  marker: string,
): Promise<{ received: Promise<void>; cleanup: () => Promise<void> }> {
  const waitId = randomUUID();
  await page.evaluate(({ runtimeId, expectedMarker, key }) => {
    const desktopWindow = window as DesktopTerminalWindow;
    const terminalApi = desktopWindow.alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    const waits = desktopWindow.alfredE2eTerminalDataWaits ?? new Map();
    desktopWindow.alfredE2eTerminalDataWaits = waits;
    if (waits.has(key)) throw new Error(`Renderer terminal data wait ${key} already exists.`);

    let accumulated = "";
    let settled = false;
    let unsubscribe = () => {};
    let resolveResult!: (result: { ok: true } | { ok: false; error: string }) => void;
    const result = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
      resolveResult = resolve;
    });
    const finish = (waitResult: { ok: true } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolveResult(waitResult);
    };
    const timeoutId = window.setTimeout(() => {
      finish({
        ok: false,
        error: `Timed out waiting for renderer terminal data ${expectedMarker}.`,
      });
    }, 15_000);
    unsubscribe = terminalApi.onData((event) => {
      if (event.id !== runtimeId) return;
      accumulated += event.data;
      if (accumulated.includes(expectedMarker)) finish({ ok: true });
    });
    waits.set(key, {
      result,
      cleanup: () => finish({ ok: false, error: `Renderer terminal data wait ${key} was cancelled.` }),
    });
  }, { runtimeId: id, expectedMarker: marker, key: waitId });

  const received = page.evaluate(async (key) => {
    const wait = (window as DesktopTerminalWindow).alfredE2eTerminalDataWaits?.get(key);
    if (!wait) throw new Error(`Renderer terminal data wait ${key} is missing.`);
    const result = await wait.result;
    if (!result.ok) throw new Error(result.error);
  }, waitId);

  return {
    received,
    cleanup: async () => {
      await page.evaluate((key) => {
        const waits = (window as DesktopTerminalWindow).alfredE2eTerminalDataWaits;
        const wait = waits?.get(key);
        wait?.cleanup();
        waits?.delete(key);
      }, waitId);
    },
  };
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
