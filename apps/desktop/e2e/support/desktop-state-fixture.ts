import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { managedProjectWorktreeRoot, workspaceRootFingerprint } from "../../src/main/git-worktree";
import {
  DEFAULT_DESKTOP_STATE,
  DESKTOP_STATE_FILE_NAME,
  DESKTOP_STATE_VERSION,
  type DesktopStateFile,
} from "../../src/main/persisted-desktop-state";
import type { AlfredStagedPlanSnapshot } from "../../src/shared/alfred-ipc";
import type { PersistedTerminalSessionSnapshot } from "../../src/shared/terminal-ipc";
import {
  writeCodexSummaryFixtures,
  writeLargeCodexTranscriptFixture,
  writeMixedCodexSessionFixtures,
} from "../../src/test-support/codex-session-fixtures";

const execFileAsync = promisify(execFile);

export type DesktopStateFixtureOptions = {
  activeWorkspaceId?: "A" | "B";
  handoffDiff?: boolean;
  inboxItems?: number;
  blockedInboxItem?: number;
  waitingInboxItem?: number;
  projectShell?: boolean;
  restoredScratchSessions?: number;
  restoredSessions?: number;
  unsafeRecoveryItem?: number;
  externalSessionFixture?: "mixed";
  externalSessionSummaryCount?: number;
  largeExternalTranscript?: boolean;
  missingWorkspaceId?: "A" | "B";
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
  options: DesktopStateFixtureOptions = {},
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
    await mkdir(path.join(paths.home, "bin"), { recursive: true });
    await Promise.all([
      mkdir(path.join(paths.home, ".config"), { recursive: true }),
      mkdir(path.join(paths.home, ".codex"), { recursive: true }),
      mkdir(path.join(paths.home, ".claude"), { recursive: true }),
      ...["codex", "claude"].map((agent) =>
        writeFile(
          path.join(paths.home, "bin", agent),
          `#!/bin/sh\nmarker="\${TMPDIR:-/tmp}/alfred-${agent}-fixture-$$"\nprintf '${agent} fixture ready\\n' > "$marker"\nexec /usr/bin/tail -f "$marker"\n`,
          { encoding: "utf8", mode: 0o755 },
        )
      ),
      ...["codex", "claude"].map((agent) =>
        writeFile(
          path.join(paths.home, "bin", `${agent}.cmd`),
          `@echo off\r\necho ${agent} fixture ready\r\nmore\r\n`,
          "utf8",
        )
      ),
    ]);
    if (options.missingWorkspaceId) {
      await rm(options.missingWorkspaceId === "A" ? paths.workspaceA : paths.workspaceB, {
        recursive: true,
        force: true,
      });
    }

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
    const restoredSessions = options.restoredSessions ?? 0;
    assertFixtureIndex("blockedInboxItem", options.blockedInboxItem, inboxItems);
    assertFixtureIndex("waitingInboxItem", options.waitingInboxItem, inboxItems);
    assertFixtureIndex("unsafeRecoveryItem", options.unsafeRecoveryItem, restoredSessions);
    if (
      options.blockedInboxItem !== undefined &&
      options.blockedInboxItem === options.waitingInboxItem
    ) {
      throw new Error("blockedInboxItem and waitingInboxItem must identify different items.");
    }
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
              const waiting = number === options.waitingInboxItem;
              const blocked = number === options.blockedInboxItem;
              return {
                id: `fixture-item-${number}`,
                workspaceId,
                kind: "shell" as const,
                title: `Fixture item ${number}`,
                cwd,
                command: waiting ? "/bin/sh" : "/usr/bin/printf",
                args: waiting
                  ? [
                      "-c",
                      "/bin/echo 'Approval required: allow deterministic fixture?'; exec /bin/cat",
                    ]
                  : [`fixture item ${number}\n`],
                isolation: "shared" as const,
                launchPreflight: blocked
                  ? {
                      status: "blocked" as const,
                      code: "cwd_outside_workspace" as const,
                      label: "Blocked",
                      reason: "Fixture safety policy blocks launch outside the approved root.",
                      detail: "Edit the working directory before launch.",
                    }
                  : {
                      status: "ready" as const,
                      label: "Ready",
                      detail: waiting
                        ? "Deterministic PTY waits for explicit input."
                        : "Deterministic local fixture command.",
                      isolation: "shared" as const,
                      cwd,
                    },
              };
            }),
          };
    const restoredTerminalSessions: PersistedTerminalSessionSnapshot[] = Array.from(
      { length: restoredSessions },
      (_, index) => {
        const number = index + 1;
        const workspaceId = number % 2 === 0 ? "B" : "A";
        const unsafe = number === options.unsafeRecoveryItem;
        return {
          clientId: `restored-${number}`,
          title: `Restored fixture ${number}`,
          source: "manual" as const,
          workspaceId,
          cwd: workspaceId === "A" ? paths.workspaceA : paths.workspaceB,
          shell: "/bin/zsh",
          command: unsafe ? "/bin/sh" : "/usr/bin/printf",
          args: unsafe
            ? ["-c", "/usr/bin/printf 'unsafe recovery confirmed\\n'"]
            : [`restored fixture ${number}\n`],
          createdAt: 1_720_000_000_000 + number,
          buffer: `restored fixture ${number}\n`,
        };
      },
    );
    restoredTerminalSessions.push(
      ...Array.from({ length: options.restoredScratchSessions ?? 0 }, (_, index) => {
        const number = index + 1;
        return {
          clientId: `restored-scratch-${number}`,
          title: `Restored scratch fixture ${number}`,
          source: "manual" as const,
          workspaceId: "B",
          cwd: path.join(paths.home, "Documents", "Codex", `restored-scratch-${number}`),
          shell: "/bin/zsh",
          command: "/usr/bin/printf",
          args: [`restored scratch fixture ${number}\n`],
          createdAt: 1_720_100_000_000 + number,
          buffer: `restored scratch fixture ${number}\n`,
        };
      }),
    );
    if (options.handoffDiff) {
      restoredTerminalSessions.push(await createHandoffDiffFixture(paths));
    }
    const state: DesktopStateFile = {
      ...structuredClone(DEFAULT_DESKTOP_STATE),
      version: DESKTOP_STATE_VERSION,
      workspaces,
      activeWorkspaceId: options.activeWorkspaceId ?? "A",
      stagedPlan,
      restoredTerminalSessions,
      privacySettings: {
        terminalScrollbackRetention: "redactedTail",
        externalSessionIndexingEnabled:
          options.externalSessionFixture !== undefined
          || options.externalSessionSummaryCount !== undefined
          || options.largeExternalTranscript === true,
      },
    };

    const codexHome = path.join(paths.home, ".codex");
    if (options.externalSessionFixture === "mixed") {
      await writeMixedCodexSessionFixtures(codexHome, {
        workspaceA: paths.workspaceA,
        workspaceB: paths.workspaceB,
        freeChatRoot: path.join(paths.home, "Documents", "Codex"),
      });
    }
    if (options.externalSessionSummaryCount !== undefined) {
      await writeCodexSummaryFixtures(codexHome, options.externalSessionSummaryCount, paths.workspaceA);
    }
    if (options.largeExternalTranscript) {
      await writeLargeCodexTranscriptFixture(codexHome);
    }

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

async function createHandoffDiffFixture(
  paths: DesktopFixturePaths,
): Promise<PersistedTerminalSessionSnapshot> {
  const branchName = "alfred-codex-fixture-handoff";
  const trackedFile = "handoff-status.txt";
  const worktreeRoot = managedProjectWorktreeRoot(path.join(paths.userData, "worktrees"), paths.workspaceA);
  const cwd = path.join(worktreeRoot, branchName);

  await execFileAsync("git", ["-C", paths.workspaceA, "init"]);
  await writeFile(path.join(paths.workspaceA, trackedFile), "handoff status: pending\ncontext stays stable\n", "utf8");
  await execFileAsync("git", ["-C", paths.workspaceA, "add", trackedFile]);
  await execFileAsync("git", [
    "-C",
    paths.workspaceA,
    "-c",
    "user.name=Alfred E2E",
    "-c",
    "user.email=alfred-e2e@example.invalid",
    "commit",
    "-m",
    "fixture: seed handoff diff",
  ]);
  await mkdir(worktreeRoot, { recursive: true });
  await execFileAsync("git", [
    "-C",
    paths.workspaceA,
    "worktree",
    "add",
    "-b",
    branchName,
    cwd,
    "HEAD",
  ]);
  await writeFile(path.join(cwd, trackedFile), "handoff status: ready\ncontext stays stable\n", "utf8");

  return {
    clientId: "fixture-handoff-diff",
    title: "Fixture diff handoff",
    source: "alfred",
    agentKind: "codex",
    workspaceId: "A",
    workspaceRootFingerprint: workspaceRootFingerprint(paths.workspaceA),
    isolation: "worktree",
    branchName,
    baseCwd: paths.workspaceA,
    cwd,
    createdAt: 1_720_200_000_000,
    shell: "codex",
    command: "codex",
    args: [],
    buffer: "Handoff ready for review.\n",
    activityEvents: [{
      id: "fixture-handoff-diff-activity-1720200000000-1",
      kind: "file",
      title: "Updated handoff status",
      detail: "Changed handoff-status.txt from pending to ready.",
      at: 1_720_200_000_000,
      payload: { type: "file", operation: "edited", path: trackedFile },
    }],
    lastActivityAt: 1_720_200_000_000,
    lastOutputAt: 1_720_200_000_000,
  };
}

function assertFixtureIndex(
  option: string,
  index: number | undefined,
  itemCount: number,
): void {
  if (index === undefined) return;
  if (!Number.isInteger(index) || index < 1 || index > itemCount) {
    throw new Error(`${option} must be an integer between 1 and ${itemCount}.`);
  }
}
