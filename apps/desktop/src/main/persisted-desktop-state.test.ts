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
