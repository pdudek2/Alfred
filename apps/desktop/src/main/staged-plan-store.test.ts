import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStagedPlanSnapshot,
  getStagedPlanSnapshot,
  resolveStagedPlanSessions,
  setStagedPlanSnapshot,
} from "./staged-plan-store.js";
import type { AlfredStagedPlanSnapshot } from "../shared/alfred-ipc.js";

const plan: AlfredStagedPlanSnapshot = {
  id: "plan-1",
  name: "Demo",
  prompt: "prepare",
  sessions: [
    { id: "alfred-1", kind: "shell", title: "A", command: "echo", args: ["a"] },
    { id: "alfred-2", kind: "codex", title: "B", command: "codex", args: [], safetyNote: "review" },
  ],
};

describe("staged-plan-store", () => {
  beforeEach(() => {
    clearStagedPlanSnapshot();
  });

  it("stores and returns a cloned staged plan snapshot", () => {
    const response = setStagedPlanSnapshot(plan);

    expect(response.plan).toEqual(plan);
    plan.sessions[0]?.args.push("mutated");
    expect(getStagedPlanSnapshot().plan?.sessions[0]?.args).toEqual(["a"]);
  });

  it("removes resolved sessions and clears the plan when none remain", () => {
    setStagedPlanSnapshot(plan);

    expect(resolveStagedPlanSessions({ sessionIds: ["alfred-1"] }).plan).toEqual({
      ...plan,
      sessions: [plan.sessions[1]],
    });
    expect(resolveStagedPlanSessions({ sessionIds: ["alfred-2"] }).plan).toBeNull();
  });

  it("clears the staged plan", () => {
    setStagedPlanSnapshot(plan);

    expect(clearStagedPlanSnapshot()).toEqual({ plan: null });
    expect(getStagedPlanSnapshot()).toEqual({ plan: null });
  });
});
