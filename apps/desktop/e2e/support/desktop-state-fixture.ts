import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_DESKTOP_STATE,
  DESKTOP_STATE_FILE_NAME,
  DESKTOP_STATE_VERSION,
  type DesktopStateFile,
} from "../../src/main/persisted-desktop-state";
import type { AlfredStagedPlanSnapshot } from "../../src/shared/alfred-ipc";
import type { PersistedTerminalSessionSnapshot } from "../../src/shared/terminal-ipc";

export type DesktopFixtureOptions = {
  activeWorkspaceId?: "A" | "B";
  inboxItems?: number;
  projectShell?: boolean;
  restoredSessions?: number;
};

export type DesktopFixturePaths = {
  root: string;
  home: string;
  userData: string;
  workspaceA: string;
  workspaceB: string;
  artifacts: string;
};

export async function createDesktopFixture(
  options: DesktopFixtureOptions = {},
): Promise<{ paths: DesktopFixturePaths; state: DesktopStateFile }> {
  const root = await mkdtemp(path.join(tmpdir(), "alfred-electron-"));
  try {
    const paths: DesktopFixturePaths = {
      root,
      home: path.join(root, "home"),
      userData: path.join(root, "user-data"),
      workspaceA: path.join(root, "workspace-a"),
      workspaceB: path.join(root, "workspace-b"),
      artifacts: path.join(root, "artifacts"),
    };

    await Promise.all(
      Object.values(paths)
        .filter((value) => value !== root)
        .map((value) => mkdir(value, { recursive: true })),
    );
    await Promise.all([
      mkdir(path.join(paths.home, ".config"), { recursive: true }),
      mkdir(path.join(paths.home, ".codex"), { recursive: true }),
      mkdir(path.join(paths.home, ".claude"), { recursive: true }),
    ]);

    const workspaces = [
      { id: "A", label: "Fixture Alpha", shortLabel: "FA", rootPath: paths.workspaceA },
      { id: "B", label: "Fixture Beta", shortLabel: "FB", rootPath: paths.workspaceB },
      ...(options.projectShell
        ? [
            { id: "C", label: "Fixture Gamma", shortLabel: "FG" },
            { id: "D", label: "Fixture Delta", shortLabel: "FD" },
            { id: "E", label: "Fixture Epsilon", shortLabel: "FE" },
            {
              id: "LONG",
              label: "Fixture Project With A Deliberately Long Navigator Label",
              shortLabel: "FL",
            },
            { id: "G", label: "Fixture Eta", shortLabel: "FE2" },
          ]
        : []),
    ];
    const inboxItems = options.inboxItems ?? 0;
    const stagedPlan: AlfredStagedPlanSnapshot | null =
      inboxItems === 0
        ? null
        : {
            id: "fixture-plan",
            prompt: "Run deterministic fixture commands.",
            name: "Fixture plan",
            sessions: Array.from({ length: inboxItems }, (_, index) => {
              const number = index + 1;
              const workspaceId = number % 2 === 0 ? "B" : "A";
              const cwd = workspaceId === "A" ? paths.workspaceA : paths.workspaceB;
              return {
                id: `fixture-item-${number}`,
                workspaceId,
                kind: "shell" as const,
                title: `Fixture item ${number}`,
                cwd,
                command: "/usr/bin/printf",
                args: [`fixture item ${number}\n`],
                isolation: "shared" as const,
                launchPreflight: {
                  status: "ready" as const,
                  label: "Ready",
                  detail: "Deterministic local fixture command.",
                  isolation: "shared" as const,
                  cwd,
                },
              };
            }),
          };
    const restoredTerminalSessions: PersistedTerminalSessionSnapshot[] = Array.from(
      { length: options.restoredSessions ?? 0 },
      (_, index) => {
        const number = index + 1;
        const workspaceId = number % 2 === 0 ? "B" : "A";
        return {
          clientId: `restored-${number}`,
          title: `Restored fixture ${number}`,
          source: "manual" as const,
          workspaceId,
          cwd: workspaceId === "A" ? paths.workspaceA : paths.workspaceB,
          shell: "/bin/zsh",
          command: "/usr/bin/printf",
          args: [`restored fixture ${number}\n`],
          createdAt: 1_720_000_000_000 + number,
          buffer: `restored fixture ${number}\n`,
        };
      },
    );
    const state: DesktopStateFile = {
      ...structuredClone(DEFAULT_DESKTOP_STATE),
      version: DESKTOP_STATE_VERSION,
      workspaces,
      activeWorkspaceId: options.activeWorkspaceId ?? "A",
      stagedPlan,
      restoredTerminalSessions,
      privacySettings: {
        terminalScrollbackRetention: "redactedTail",
        externalSessionIndexingEnabled: false,
      },
    };

    if (state.version !== DESKTOP_STATE_VERSION) throw new Error("Fixture state version drifted.");
    const expectedWorkspaceCount = options.projectShell ? 7 : 2;
    if (state.workspaces.length !== expectedWorkspaceCount) {
      throw new Error(`Fixture must contain ${expectedWorkspaceCount} workspaces.`);
    }
    await writeFile(
      path.join(paths.userData, DESKTOP_STATE_FILE_NAME),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
    return { paths, state };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
