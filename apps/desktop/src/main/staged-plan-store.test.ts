import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStagedPlanSnapshot,
  configureStagedPlanPersistence,
  getStagedPlansSnapshot,
  isStagedSessionLaunchAllowed,
  resetStagedPlanPersistence,
  resolveStagedPlanSessions,
  setStagedPlanSnapshot,
  updateStagedPlanSession,
} from "./staged-plan-store.js";
import { createPersistedDesktopStateStore, DEFAULT_DESKTOP_STATE } from "./persisted-desktop-state.js";
import type { AlfredStagedPlanSnapshot } from "../shared/alfred-ipc.js";

const createPlan = (): AlfredStagedPlanSnapshot => ({
  id: "plan-1",
  workspaceId: "A",
  name: "Demo",
  prompt: "prepare",
  sessions: [
    {
      id: "alfred-1",
      workspaceId: "A",
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
      workspaceId: "A",
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
    await clearStagedPlanSnapshot({ workspaceId: "A" });
  });

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it.each([false, true])("keeps independent plans through concurrent set, resolve and clear (persisted: %s)", async (persisted) => {
    if (persisted) configureStagedPlanPersistence(createPersistedDesktopStateStore({ filePath: await temporaryStateFile() }));
    const a = createPlan();
    const b = { ...createPlan(), id: "plan-b", workspaceId: "B", sessions: createPlan().sessions.map(
      (session) => ({ ...session, id: `${session.id}-b`, workspaceId: "B" }),
    ) };
    await Promise.all([setStagedPlanSnapshot(a), setStagedPlanSnapshot(b)]);
    expect((await getStagedPlansSnapshot()).plans).toEqual([a, b]);
    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-1", "alfred-1-b", "alfred-2-b"] })).plans).toEqual([
      { ...a, sessions: [a.sessions[1]] },
    ]);
    await setStagedPlanSnapshot(b);
    expect((await clearStagedPlanSnapshot({ workspaceId: "A" })).plans).toEqual([b]);
  });

  it("authorizes a draft in a non-first plan only with its exact command and args", async () => {
    await setStagedPlanSnapshot(createPlan());
    const session = { ...createPlan().sessions[0]!, id: "draft-b", workspaceId: "B" };
    await setStagedPlanSnapshot({ ...createPlan(), id: "plan-b", workspaceId: "B", sessions: [session] });
    await expect(isStagedSessionLaunchAllowed({ clientId: "draft-b", command: "echo", args: ["a"] })).resolves.toBe(true);
    await expect(isStagedSessionLaunchAllowed({ clientId: "draft-b", command: "sh", args: ["a"] })).resolves.toBe(false);
    await expect(isStagedSessionLaunchAllowed({ clientId: "draft-b", command: "echo", args: [] })).resolves.toBe(false);
  });

  it("rejects missing plan workspace and sessions belonging to another workspace", async () => {
    const plan = createPlan();
    await expect(setStagedPlanSnapshot({ ...plan, workspaceId: "" })).rejects.toMatchObject({ code: "malformed" });
    await expect(setStagedPlanSnapshot({ ...plan, sessions: [{ ...plan.sessions[0]!, workspaceId: "B" }] })).rejects.toMatchObject({ code: "malformed" });
    expect((await getStagedPlansSnapshot()).plans).toEqual([]);
  });

  it.each([false, true])("preserves another project's concurrent write during an asynchronous edit (persisted: %s)", async (persisted) => {
    if (persisted) configureStagedPlanPersistence(createPersistedDesktopStateStore({ filePath: await temporaryStateFile() }));
    await setStagedPlanSnapshot(createPlan());
    const b = { ...createPlan(), id: "plan-b", workspaceId: "B", sessions: [{ ...createPlan().sessions[0]!, id: "draft-b", workspaceId: "B" }] };
    const edit = updateStagedPlanSession({ planId: "plan-1", sessionId: "alfred-1", patch: { title: "Edited" } }, {
      preflightOptions: { commandExists: async () => { await Promise.resolve(); return true; } },
    });
    await Promise.all([edit, setStagedPlanSnapshot(b)]);
    expect((await getStagedPlansSnapshot()).plans).toEqual([
      expect.objectContaining({ id: "plan-1", sessions: [expect.objectContaining({ title: "Edited" }), expect.any(Object)] }), b,
    ]);
  });

  it("returns an edited plan without exposing mutable in-memory state", async () => {
    await setStagedPlanSnapshot(createPlan());
    const result = await updateStagedPlanSession({ planId: "plan-1", sessionId: "alfred-1", patch: { title: "Edited" } }, {
      preflightOptions: { commandExists: async () => true },
    });
    if (!result.ok) throw new Error(result.error.message);
    result.plan.sessions[0]!.args.push("changed");
    expect((await getStagedPlansSnapshot()).plans[0]!.sessions[0]!.args).toEqual(["a"]);
    await expect(isStagedSessionLaunchAllowed({ clientId: "alfred-1", command: "echo", args: ["a"] })).resolves.toBe(true);
  });

  it("stores and returns a cloned staged plan snapshot", async () => {
    const plan = createPlan();
    const response = await setStagedPlanSnapshot(plan);

    expect(response.plans).toEqual([plan]);
    plan.sessions[0]?.args.push("mutated");
    expect((await getStagedPlansSnapshot()).plans[0]?.sessions[0]?.args).toEqual(["a"]);
  });

  it("removes resolved sessions and clears the plan when none remain", async () => {
    const plan = createPlan();
    await setStagedPlanSnapshot(plan);

    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-1"] })).plans).toEqual([{
      ...plan,
      sessions: [plan.sessions[1]],
    }]);
    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-2"] })).plans).toEqual([]);
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

    await expect(clearStagedPlanSnapshot({ workspaceId: "A" })).resolves.toEqual({ plans: [] });
    await expect(getStagedPlansSnapshot()).resolves.toEqual({ plans: [] });
  });

  it("persists staged plans when configured with desktop state storage", async () => {
    const plan = createPlan();
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureStagedPlanPersistence(persistedStateStore);

    await expect(setStagedPlanSnapshot(plan)).resolves.toEqual({ plans: [plan] });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({ stagedPlans: { A: plan } }),
    );
  });

  it.each(["off", "redactedTail"] as const)("keeps full staged plans in memory with %s retention and applies privacy only to disk", async (retention) => {
    const filePath = await temporaryStateFile();
    const store = createPersistedDesktopStateStore({ filePath });
    await store.setState({ ...DEFAULT_DESKTOP_STATE, privacySettings: { terminalScrollbackRetention: retention } });
    configureStagedPlanPersistence(store);
    const plan: AlfredStagedPlanSnapshot = {
      ...createPlan(),
      prompt: "Work in /Users/x/repo with password=hunter2",
      sessions: [{
        ...createPlan().sessions[0]!,
        command: "/Users/x/bin/cli --token=hunter2",
        args: ["--add-dir", "/Users/x/repo", "--password", "hunter2"],
        safetyNote: "Authorization: Bearer abc.def.ghi",
      }],
    };

    await expect(setStagedPlanSnapshot(plan)).resolves.toEqual({ plans: [plan] });
    await expect(getStagedPlansSnapshot()).resolves.toEqual({ plans: [plan] });
    await store.updateState((current) => ({ ...current, windowState: { ...current.windowState, maximized: true } }));
    await expect(getStagedPlansSnapshot()).resolves.toEqual({ plans: [plan] });
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    if (retention === "off") {
      expect(saved.stagedPlans).toEqual({});
    } else {
      expect(saved.stagedPlans.A).toMatchObject({
        prompt: expect.stringMatching(/^Work in \[redacted-path:[a-f0-9]{8}\] with password=\[redacted\]$/),
        sessions: [{
          command: "/Users/x/bin/cli --token=[redacted]",
          args: ["--add-dir", "/Users/x/repo", "--password", "[redacted]"],
          safetyNote: "Authorization: [redacted]",
        }],
      });
    }
    expect(await readFile(filePath, "utf8")).not.toContain("hunter2");
    await expect(getStagedPlansSnapshot()).resolves.toEqual({ plans: [plan] });
  });

  it("lets other state writes finish while an edited draft is preflighted", async () => {
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureStagedPlanPersistence(persistedStateStore);
    await setStagedPlanSnapshot(createPlan());
    let finishPreflight!: (exists: boolean) => void;
    const preflight = new Promise<boolean>((resolve) => { finishPreflight = resolve; });

    const edit = updateStagedPlanSession(
      { planId: "plan-1", sessionId: "alfred-1", patch: { args: ["b"] }, workspace: { id: "A", label: "Alfred", rootPath: "/repo" } },
      { preflightOptions: { commandExists: () => preflight } },
    );
    // A window or terminal save, unrelated to the plan, does not wait for git and the shell.
    let otherWrite = "pending";
    void persistedStateStore.updateState((state) => state).then(() => { otherWrite = "done"; });
    await vi.waitFor(() => expect(otherWrite).toBe("done"));

    finishPreflight(true);
    await expect(edit).resolves.toMatchObject({ ok: true, plan: { sessions: [expect.objectContaining({ args: ["b"] }), expect.anything()] } });
  });

  it("refuses an edit when the plan was replaced while it was preflighted", async () => {
    configureStagedPlanPersistence(createPersistedDesktopStateStore({ filePath: await temporaryStateFile() }));
    await setStagedPlanSnapshot(createPlan());
    let finishPreflight!: (exists: boolean) => void;
    const preflight = new Promise<boolean>((resolve) => { finishPreflight = resolve; });

    const edit = updateStagedPlanSession(
      { planId: "plan-1", sessionId: "alfred-1", patch: { args: ["b"] }, workspace: { id: "A", label: "Alfred", rootPath: "/repo" } },
      { preflightOptions: { commandExists: () => preflight } },
    );
    await resolveStagedPlanSessions({ sessionIds: ["alfred-2"] });
    finishPreflight(true);

    await expect(edit).resolves.toMatchObject({ ok: false });
    expect((await getStagedPlansSnapshot()).plans[0]?.sessions).toEqual([expect.objectContaining({ id: "alfred-1", args: ["a"] })]);
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
      { preflightOptions: { commandExists: async () => true, directoryExists: async () => true } },
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
      expect.objectContaining({ stagedPlans: { A: response.plan } }),
    );
  });

  it.each(["codex", "claude"] as const)("persists %s isolation updates and recomputes worktree preflight", async (kind) => {
    const plan = createPlan();
    if (plan.sessions[0]) {
      plan.sessions[0] = { ...plan.sessions[0], kind, command: kind, args: [] };
    }
    await setStagedPlanSnapshot(plan);
    const preflightAgentWorktree = vi.fn().mockResolvedValue({
      ok: true,
      branchName: `alfred-${kind}-isolated`,
      baseCwd: "/repo",
      cwd: `/repo/.alfred-worktrees/alfred-${kind}-isolated`,
    });

    const response = await updateStagedPlanSession(
      {
        planId: "plan-1",
        sessionId: "alfred-1",
        patch: { isolation: "worktree" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      },
      { preflightOptions: { commandExists: async () => true, preflightAgentWorktree } },
    );

    expect(response).toMatchObject({ ok: true });
    if (!response.ok) throw new Error(response.error.message);
    expect(preflightAgentWorktree).toHaveBeenCalled();
    expect(response.plan.sessions[0]).toMatchObject({
      id: "alfred-1",
      kind,
      isolation: "worktree",
      launchPreflight: {
        status: "ready",
        isolation: "worktree",
        branchName: `alfred-${kind}-isolated`,
      },
    });
  });

  it.each(["shell", "dev-server"] as const)("rejects %s worktree isolation patches", async (kind) => {
    const plan = createPlan();
    if (plan.sessions[0]) {
      plan.sessions[0] = { ...plan.sessions[0], kind };
    }
    await setStagedPlanSnapshot(plan);

    await expect(
      updateStagedPlanSession({
        planId: "plan-1",
        sessionId: "alfred-1",
        patch: { isolation: "worktree" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "malformed",
        message: "Staged session worktree isolation requires a codex or claude session.",
      },
    });
  });

  it.each(["codex", "claude"] as const)("rejects %s worktree isolation patches without a workspace root", async (kind) => {
    const plan = createPlan();
    if (plan.sessions[0]) {
      plan.sessions[0] = { ...plan.sessions[0], kind, command: kind, args: [] };
    }
    await setStagedPlanSnapshot(plan);

    await expect(
      updateStagedPlanSession({
        planId: "plan-1",
        sessionId: "alfred-1",
        patch: { isolation: "worktree" },
        workspace: { id: "A", label: "Alfred" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "malformed",
        message: "Staged session worktree isolation requires a workspace root.",
      },
    });
  });

  it("rejects invalid isolation patches", async () => {
    await setStagedPlanSnapshot(createPlan());

    await expect(
      updateStagedPlanSession({
        planId: "plan-1",
        sessionId: "alfred-1",
        patch: { isolation: "detached" as "worktree" },
        workspace: { id: "A", label: "Alfred", rootPath: "/repo" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed", message: "Staged session isolation must be shared or worktree." },
    });
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
    await expect(persistedStateStore.getState()).resolves.toEqual(expect.objectContaining({ stagedPlans: { A: plan } }));

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
      expect.objectContaining({ stagedPlans: { A: plan } }),
    );
  });
});
