import { describe, expect, it } from "vitest";
import { buildOrchestratorViewModel } from "./orchestrator-view-model";
import type { SessionTile } from "../session-state";

const sessions: SessionTile[] = [
  { id: "manual-1", title: "Manual · zsh 1", workspaceId: "A", cwd: "/repo", source: "manual", stage: "live" },
  {
    id: "alfred-1",
    title: "web - pnpm dev",
    workspaceId: "A",
    cwd: "/repo",
    source: "alfred",
    stage: "live",
    agentKind: "dev-server",
    command: "pnpm",
    args: ["dev"],
  },
  {
    id: "alfred-2",
    title: "spec-review",
    workspaceId: "A",
    cwd: "/repo",
    source: "alfred",
    stage: "staged",
    agentKind: "claude",
    command: "claude",
    args: ["--continue"],
  },
  {
    id: "alfred-3",
    title: "db migrate",
    workspaceId: "A",
    cwd: "/repo",
    source: "alfred",
    stage: "staged",
    agentKind: "shell",
    command: "pnpm",
    args: ["db:migrate"],
    safetyNote: "database migration",
  },
  { id: "manual-2", title: "Other workspace", workspaceId: "B", cwd: "/repo", source: "manual", stage: "live" },
];

describe("buildOrchestratorViewModel", () => {
  it("derives mission counts for the active workspace without hiding live terminals", () => {
    const vm = buildOrchestratorViewModel({
      activeWorkspaceId: "A",
      activeWorkspaceLabel: "Alfred",
      model: "anthropic/claude-sonnet-4-6",
      openRouterConfigured: true,
      pendingPlan: {
        id: "plan-1",
        prompt: "prepare auth work",
        sessionIds: ["alfred-2", "alfred-3"],
        workspaceId: "A",
      },
      sessions,
    });

    expect(vm.counts).toEqual({
      live: 2,
      manual: 1,
      staged: 2,
      unsafe: 1,
      terminals: 4,
    });
    expect(vm.graphNodes.map((node) => node.id)).toEqual(["manual-1", "alfred-1", "alfred-2", "alfred-3"]);
    expect(vm.controlRail.guardrails).toContain("approval before unsafe command");
    expect(vm.missionTitle).toBe("prepare auth work");
  });

  it("treats approved unsafe tiles as live graph nodes, not pending unsafe work", () => {
    const vm = buildOrchestratorViewModel({
      activeWorkspaceId: "A",
      activeWorkspaceLabel: "Alfred",
      model: "anthropic/claude-sonnet-4-6",
      openRouterConfigured: true,
      pendingPlan: null,
      sessions: [
        {
          id: "alfred-unsafe-live",
          title: "approved migration",
          workspaceId: "A",
          cwd: "/repo",
          source: "alfred",
          stage: "live",
          agentKind: "shell",
          command: "pnpm",
          args: ["db:migrate"],
          safetyNote: "database migration",
        },
      ],
    });

    expect(vm.counts.unsafe).toBe(0);
    expect(vm.missionDetail).toContain("0 unsafe");
    expect(vm.graphNodes[0]).toMatchObject({ id: "alfred-unsafe-live", tone: "live" });
  });

  it("preserves an explicit unconfigured model status", () => {
    const vm = buildOrchestratorViewModel({
      activeWorkspaceId: "A",
      activeWorkspaceLabel: "Alfred",
      model: undefined,
      openRouterConfigured: false,
      pendingPlan: null,
      sessions: [],
    });

    expect(vm.controlRail).toMatchObject({
      model: "unknown",
      modelConfigured: false,
    });
  });
});
