import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_STATE,
  DESKTOP_STATE_VERSION,
  createPersistedDesktopStateStore,
} from "./persisted-desktop-state.js";
import type { DesktopStateSnapshot } from "./persisted-desktop-state.js";

let temporaryDirectory: string | null = null;

async function temporaryStateFile(): Promise<string> {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "alfred-desktop-state-"));
  return path.join(temporaryDirectory, "desktop-state.json");
}

describe("persisted-desktop-state", () => {
  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("returns the default desktop state when the file is missing", async () => {
    const filePath = await temporaryStateFile();
    const store = createPersistedDesktopStateStore({ filePath });

    await expect(store.getState()).resolves.toEqual(DEFAULT_DESKTOP_STATE);
  });

  it("writes and reads a versioned desktop state file", async () => {
    const filePath = await temporaryStateFile();
    const state: DesktopStateSnapshot = {
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        {
          id: "UI",
          label: "Interface",
          shortLabel: "UI",
          rootPath: "/Users/patryk/Desktop/Interface",
          gitBranch: "main",
        },
      ],
      activeWorkspaceId: "UI",
      layoutsByWorkspace: {
        UI: {
          "manual-1": { tileId: "manual-1", col: 1, row: 1, colSpan: 12, rowSpan: 8 },
        },
      },
      viewStateByWorkspace: {
        UI: { workMode: "focus", selectedSessionId: "manual-1" },
      },
      windowState: {
        bounds: { x: 120, y: 80, width: 1512, height: 982 },
        maximized: true,
      },
      stagedPlan: {
        id: "plan-1",
        prompt: "prepare ui",
        sessions: [{ id: "alfred-1", kind: "shell", title: "Test", command: "pnpm", args: ["test"] }],
      },
      restoredTerminalSessions: [
        {
          clientId: "manual-1",
          title: "Manual · zsh 1",
          source: "manual",
          cwd: "/Users/patryk/Desktop/Interface",
          shell: "/bin/zsh",
          buffer: "ready\n",
          lastActivityAt: 123,
          lastOutputAt: 124,
          activityEvents: [
            {
              id: "manual-1-activity-123-1",
              kind: "output",
              title: "Progress reported",
              detail: "ready",
              at: 123,
            },
          ],
        },
      ],
    };

    const writer = createPersistedDesktopStateStore({ filePath });
    await writer.setState(state);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const reader = createPersistedDesktopStateStore({ filePath });

    expect(raw).toEqual({ version: DESKTOP_STATE_VERSION, ...state });
    await expect(reader.getState()).resolves.toEqual(state);
  });

  it("serializes state updates so concurrent writers do not drop fields", async () => {
    const filePath = await temporaryStateFile();
    const store = createPersistedDesktopStateStore({ filePath });

    await Promise.all([
      store.updateState(async (current) => {
        await Promise.resolve();
        return {
          ...current,
          restoredTerminalSessions: [
            {
              clientId: "manual-1",
              title: "Manual",
              source: "manual",
              cwd: "/repo",
              shell: "/bin/zsh",
              buffer: "ready\n",
            },
          ],
        };
      }),
      store.updateState((current) => ({
        ...current,
        windowState: {
          bounds: { x: 64, y: 48, width: 1600, height: 1000 },
          maximized: true,
        },
      })),
    ]);

    await expect(store.getState()).resolves.toEqual(
      expect.objectContaining({
        restoredTerminalSessions: [
          expect.objectContaining({
            clientId: "manual-1",
            buffer: "ready\n",
          }),
        ],
        windowState: {
          bounds: { x: 64, y: 48, width: 1600, height: 1000 },
          maximized: true,
        },
      }),
    );
  });

  it("normalizes missing and undersized window state", async () => {
    const filePath = await temporaryStateFile();
    await writeFile(
      filePath,
      JSON.stringify({
        version: DESKTOP_STATE_VERSION,
        workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }],
        activeWorkspaceId: "A",
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "manual-1" },
          BAD: { workMode: "huge", selectedSessionId: "" },
        },
        windowState: {
          bounds: { x: 10.4, y: 20.6, width: 500, height: 300 },
          maximized: "yes",
        },
      }),
      "utf8",
    );
    const store = createPersistedDesktopStateStore({ filePath });

    await expect(store.getState()).resolves.toMatchObject({
      windowState: {
        bounds: { x: 10, y: 21, width: 1120, height: 720 },
        maximized: false,
      },
      viewStateByWorkspace: {
        A: { workMode: "focus", selectedSessionId: "manual-1" },
      },
    });
  });

  it("falls back safely when persisted JSON is corrupt", async () => {
    const filePath = await temporaryStateFile();
    await writeFile(filePath, "{not json", "utf8");
    const warnings: string[] = [];
    const store = createPersistedDesktopStateStore({
      filePath,
      onWarning: (message) => {
        warnings.push(message);
      },
    });

    await expect(store.getState()).resolves.toEqual(DEFAULT_DESKTOP_STATE);
    expect(warnings).toEqual(["Failed to parse desktop state; using defaults."]);
  });

  it("falls back safely when persisted state has an unsupported version", async () => {
    const filePath = await temporaryStateFile();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 999,
        workspaces: [{ id: "UI", label: "Interface", shortLabel: "UI" }],
        activeWorkspaceId: "UI",
      }),
      "utf8",
    );
    const store = createPersistedDesktopStateStore({ filePath });

    await expect(store.getState()).resolves.toEqual(DEFAULT_DESKTOP_STATE);
  });
});
