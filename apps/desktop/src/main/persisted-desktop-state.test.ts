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
          missionBrief: {
            goal: "Ship the desktop launcher without losing manual control.",
            doneWhen: ["Staged agents can be launched", "Manual terminals keep focus"],
            guardrails: ["No force push", "Ask before destructive commands"],
          },
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
        sessions: [
          {
            id: "alfred-1",
            kind: "shell",
            title: "Test",
            command: "pnpm",
            args: ["test"],
            launchPreflight: {
              status: "ready",
              label: "Ready",
              detail: "Will launch in the selected workspace.",
              isolation: "shared",
            },
          },
          {
            id: "alfred-2",
            kind: "codex",
            title: "Codex",
            command: "codex",
            args: [],
            isolation: "worktree",
            launchPreflight: {
              status: "blocked",
              code: "cwd_outside_workspace",
              label: "Workspace mismatch",
              reason: "This agent asked to launch outside the selected workspace. Bind the right folder or adjust the plan.",
            },
          },
        ],
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
              kind: "file",
              title: "Edit file",
              detail: "apps/desktop/src/renderer/app.tsx",
              payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
              at: 123,
            },
            {
              id: "manual-1-activity-124-2",
              kind: "approval",
              title: "Waiting for approval",
              detail: "Allow edit?",
              payload: { type: "approval", prompt: "Allow edit in app.tsx?" },
              at: 124,
            },
            {
              id: "manual-1-activity-125-3",
              kind: "tool",
              title: "WebSearch tool",
              detail: "terminal UX",
              payload: { type: "tool", name: "WebSearch", input: "terminal UX" },
              at: 125,
            },
            {
              id: "manual-1-activity-126-4",
              kind: "plan",
              title: "Plan updated",
              detail: "next step",
              payload: { type: "plan", summary: "next step" },
              at: 126,
            },
            {
              id: "manual-1-activity-127-5",
              kind: "error",
              title: "Error reported",
              detail: "build failed",
              payload: { type: "error", message: "build failed" },
              at: 127,
            },
            {
              id: "manual-1-activity-128-6",
              kind: "warning",
              title: "Warning reported",
              detail: "deprecated API",
              payload: { type: "warning", message: "deprecated API" },
              at: 128,
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

  it("normalizes workspace mission briefs", async () => {
    const filePath = await temporaryStateFile();
    await writeFile(
      filePath,
      JSON.stringify({
        version: DESKTOP_STATE_VERSION,
        workspaces: [
          {
            id: " A ",
            label: " Alfred ",
            shortLabel: " A ",
            missionBrief: {
              goal: "  Prepare   a calm launch desk  ",
              doneWhen: ["  plan reviewed  ", "", "plan reviewed", "agents launch"],
              guardrails: [" no destructive commands ", "no destructive commands"],
            },
          },
          {
            id: "EMPTY",
            label: "Empty",
            shortLabel: "E",
            missionBrief: { goal: "   ", doneWhen: [" "], guardrails: [] },
          },
        ],
        activeWorkspaceId: "A",
      }),
      "utf8",
    );
    const store = createPersistedDesktopStateStore({ filePath });

    await expect(store.getState()).resolves.toEqual({
      workspaces: [
        {
          id: "A",
          label: "Alfred",
          shortLabel: "A",
          missionBrief: {
            goal: "Prepare a calm launch desk",
            doneWhen: ["plan reviewed", "agents launch"],
            guardrails: ["no destructive commands"],
          },
        },
        {
          id: "EMPTY",
          label: "Empty",
          shortLabel: "E",
        },
      ],
      activeWorkspaceId: "A",
      layoutsByWorkspace: {},
      viewStateByWorkspace: {},
      stagedPlan: null,
      restoredTerminalSessions: [],
      windowState: DEFAULT_DESKTOP_STATE.windowState,
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

  it("rejects state updates when the desktop state file cannot be written", async () => {
    const warnings: string[] = [];
    const store = createPersistedDesktopStateStore({
      filePath: "/dev/null/desktop-state.json",
      onWarning: (message) => warnings.push(message),
    });

    await expect(store.setState(DEFAULT_DESKTOP_STATE)).rejects.toThrow("Failed to persist desktop state.");
    expect(warnings).toEqual(["Failed to persist desktop state."]);
  });
});
