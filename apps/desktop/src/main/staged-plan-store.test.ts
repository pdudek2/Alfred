import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearStagedPlanSnapshot,
  configureStagedPlanPersistence,
  getStagedPlanSnapshot,
  resetStagedPlanPersistence,
  resolveStagedPlanSessions,
  setStagedPlanSnapshot,
} from "./staged-plan-store.js";
import { createPersistedDesktopStateStore } from "./persisted-desktop-state.js";
import type { AlfredStagedPlanSnapshot } from "../shared/alfred-ipc.js";

const plan: AlfredStagedPlanSnapshot = {
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
};

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
    const response = await setStagedPlanSnapshot(plan);

    expect(response.plan).toEqual(plan);
    plan.sessions[0]?.args.push("mutated");
    expect((await getStagedPlanSnapshot()).plan?.sessions[0]?.args).toEqual(["a"]);
  });

  it("removes resolved sessions and clears the plan when none remain", async () => {
    await setStagedPlanSnapshot(plan);

    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-1"] })).plan).toEqual({
      ...plan,
      sessions: [plan.sessions[1]],
    });
    expect((await resolveStagedPlanSessions({ sessionIds: ["alfred-2"] })).plan).toBeNull();
  });

  it("clears the staged plan", async () => {
    await setStagedPlanSnapshot(plan);

    await expect(clearStagedPlanSnapshot()).resolves.toEqual({ plan: null });
    await expect(getStagedPlanSnapshot()).resolves.toEqual({ plan: null });
  });

  it("persists staged plans when configured with desktop state storage", async () => {
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureStagedPlanPersistence(persistedStateStore);

    await expect(setStagedPlanSnapshot(plan)).resolves.toEqual({ plan });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({ stagedPlan: plan }),
    );
  });
});
