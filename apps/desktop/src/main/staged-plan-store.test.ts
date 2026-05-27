import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStagedPlanSnapshot,
  configureStagedPlanPersistence,
  getStagedPlanSnapshot,
  isStagedSessionLaunchAllowed,
  resetStagedPlanPersistence,
  resolveStagedPlanSessions,
  setStagedPlanSnapshot,
  updateStagedPlanSession,
} from "./staged-plan-store.js";
import { createPersistedDesktopStateStore } from "./persisted-desktop-state.js";
import type { AlfredStagedPlanSnapshot } from "../shared/alfred-ipc.js";

const createPlan = (): AlfredStagedPlanSnapshot => ({
  id: "plan-1",
  name: "Demo",
  prompt: "prepare",
  sessions: [
    {
      id: "alfred-1",
      kind: "shell",
      title: "A",
      command: "echo",
      args: ["a"],
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
      title: "B",
      command: "codex",
      args: [],
      safetyNote: "review",
      launchPreflight: {
        status: "blocked",
        code: "cwd_outside_workspace",
        label: "Workspace mismatch",
        reason: "This agent asked to launch outside the selected workspace. Bind the right folder or adjust the plan.",
      },
    },
  ],
});

let temporaryDirectory: string | null = null;

async function temporaryStateFile(): Promise<string> {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "alfred-staged-plan-store-"));
  return path.join(temporaryDirectory, "desktop-state.json");
}

describe("staged-plan-store", () => {
  beforeEach(async () => {
    resetStagedPlanPersistence();
    await clearStagedPlanSnapshot();
  });

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("stores and returns a cloned staged plan snapshot", async () => {
    const plan = createPlan();
    const response = await setStagedPlanSnapshot(plan);

    expect(response.plan).toEqual(plan);
    plan.sessions[0]?.args.push("mutated");
    expect((await getStagedPlanSnapshot()).plan?.sessions[0]?.args).toEqual(["a"]);
  });

  it("removes resolved sessions and clears the plan when none remain", async () => {
    const plan = createPlan();
    await setStagedPlanSnapshot(plan);

    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-1"] })).plan).toEqual({
      ...plan,
      sessions: [plan.sessions[1]],
    });
    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-2"] })).plan).toBeNull();
  });

  it("allows launch only for matching safe staged sessions", async () => {
    await setStagedPlanSnapshot(createPlan());

    await expect(
      isStagedSessionLaunchAllowed({ clientId: "alfred-1", command: "echo", args: ["a"] }),
    ).resolves.toBe(true);
    await expect(
      isStagedSessionLaunchAllowed({ clientId: "alfred-1", command: "echo", args: ["changed"] }),
    ).resolves.toBe(false);
    await expect(
      isStagedSessionLaunchAllowed({ clientId: "alfred-2", command: "codex", args: [] }),
    ).resolves.toBe(false);
  });

  it("clears the staged plan", async () => {
    const plan = createPlan();
    await setStagedPlanSnapshot(plan);

    await expect(clearStagedPlanSnapshot()).resolves.toEqual({ plan: null });
    await expect(getStagedPlanSnapshot()).resolves.toEqual({ plan: null });
  });

  it("persists staged plans when configured with desktop state storage", async () => {
    const plan = createPlan();
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureStagedPlanPersistence(persistedStateStore);

    await expect(setStagedPlanSnapshot(plan)).resolves.toEqual({ plan });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({ stagedPlan: plan }),
    );
  });

  it("persists updates to command, args, and cwd on one staged session", async () => {
    const plan = createPlan();
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureStagedPlanPersistence(persistedStateStore);
    await setStagedPlanSnapshot(plan);

    const response = await updateStagedPlanSession(
      {
        planId: "plan-1",
        sessionId: "alfred-1",
        patch: { command: "pnpm", args: ["--filter", "@alfred/desktop", "test"], cwd: "apps/desktop" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      },
      { preflightOptions: { commandExists: async () => true } },
    );

    expect(response).toMatchObject({ ok: true });
    if (!response.ok) throw new Error(response.error.message);
    expect(response.plan.sessions[0]).toMatchObject({
      id: "alfred-1",
      command: "pnpm",
      args: ["--filter", "@alfred/desktop", "test"],
      cwd: "apps/desktop",
      launchPreflight: {
        status: "ready",
        isolation: "shared",
      },
    });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({ stagedPlan: response.plan }),
    );
  });

  it("recomputes safety when a staged session becomes unsafe", async () => {
    const plan = createPlan();
    await setStagedPlanSnapshot(plan);

    const response = await updateStagedPlanSession(
      {
        planId: "plan-1",
        sessionId: "alfred-1",
        patch: { command: "rm", args: ["-rf", "/tmp/alfred-risky"] },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      },
      { preflightOptions: { commandExists: async () => true } },
    );

    expect(response).toMatchObject({ ok: true });
    if (!response.ok) throw new Error(response.error.message);
    expect(response.plan.sessions[0]?.safetyNote).toBe("rm -rf detected");
  });

  it("blocks launch preflight when an edited cwd leaves the workspace", async () => {
    const plan = createPlan();
    await setStagedPlanSnapshot(plan);
    const preflightAgentWorktree = vi.fn();

    const response = await updateStagedPlanSession(
      {
        planId: "plan-1",
        sessionId: "alfred-2",
        patch: { cwd: "/other/repo" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      },
      { preflightOptions: { commandExists: async () => true, preflightAgentWorktree } },
    );

    expect(response).toMatchObject({ ok: true });
    if (!response.ok) throw new Error(response.error.message);
    expect(preflightAgentWorktree).not.toHaveBeenCalled();
    expect(response.plan.sessions[1]).toMatchObject({
      id: "alfred-2",
      cwd: "/other/repo",
      launchPreflight: {
        status: "blocked",
        code: "cwd_outside_workspace",
      },
    });
    expect(response.plan.sessions[1]?.safetyNote).toBeUndefined();
  });

  it("leaves persisted state unchanged when the plan or session is stale", async () => {
    const plan = createPlan();
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureStagedPlanPersistence(persistedStateStore);
    await setStagedPlanSnapshot(plan);

    await expect(
      updateStagedPlanSession({
        planId: "stale-plan",
        sessionId: "alfred-1",
        patch: { command: "pnpm" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "not_found", message: "The staged plan has changed. Refresh before editing this session." },
    });
    await expect(persistedStateStore.getState()).resolves.toEqual(expect.objectContaining({ stagedPlan: plan }));

    await expect(
      updateStagedPlanSession({
        planId: "plan-1",
        sessionId: "stale-session",
        patch: { command: "pnpm" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "not_found", message: "The staged session is no longer available." },
    });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({ stagedPlan: plan }),
    );
  });
});
