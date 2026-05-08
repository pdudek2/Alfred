import type { AlfredRuntimeStatus } from "../../shared/alfred-ipc";
import type { SquadPlan } from "../alfred-state";
import type { SessionTile } from "../session-state";
import { sessionTileKind, type TileKind } from "../tile-kind";

export type GraphNodeTone = "live" | "waiting" | "unsafe" | "manual";

export type MissionGraphNode = {
  id: string;
  title: string;
  kind: TileKind;
  tone: GraphNodeTone;
  detail: string;
};

export type OrchestratorViewModel = {
  missionTitle: string;
  missionDetail: string;
  counts: {
    live: number;
    manual: number;
    staged: number;
    unsafe: number;
    terminals: number;
  };
  graphNodes: MissionGraphNode[];
  controlRail: {
    model: string;
    modelConfigured: boolean;
    guardrails: string[];
  };
};

type BuildInput = {
  activeWorkspaceId: string;
  activeWorkspaceLabel: string;
  model: AlfredRuntimeStatus["model"] | undefined;
  openRouterConfigured: boolean;
  pendingPlan: SquadPlan | null;
  sessions: SessionTile[];
};

export function buildOrchestratorViewModel(input: BuildInput): OrchestratorViewModel {
  const activeSessions = input.sessions.filter((session) => session.workspaceId === input.activeWorkspaceId);
  const live = activeSessions.filter((session) => session.stage === "live");
  const staged = activeSessions.filter((session) => session.stage === "staged");
  const unsafe = staged.filter((session) => Boolean(session.safetyNote));
  const manual = live.filter((session) => session.source === "manual");

  return {
    missionTitle: input.pendingPlan?.prompt ?? `${input.activeWorkspaceLabel} workspace`,
    missionDetail: `${live.length} live · ${staged.length} staged · ${unsafe.length} unsafe`,
    counts: {
      live: live.length,
      manual: manual.length,
      staged: staged.length,
      unsafe: unsafe.length,
      terminals: activeSessions.length,
    },
    graphNodes: activeSessions.map(toGraphNode),
    controlRail: {
      model: input.model ?? "unknown",
      modelConfigured: input.openRouterConfigured,
      guardrails: [
        "approval before unsafe command",
        "workspace scoped",
        "manual terminals remain live",
      ],
    },
  };
}

function toGraphNode(session: SessionTile): MissionGraphNode {
  const stagedUnsafe = session.stage === "staged" && Boolean(session.safetyNote);

  return {
    id: session.id,
    title: session.title,
    kind: sessionTileKind(session),
    tone: stagedUnsafe
      ? "unsafe"
      : session.stage === "staged"
        ? "waiting"
        : session.source === "manual"
          ? "manual"
          : "live",
    detail:
      session.stage === "staged"
        ? "staged, no process yet"
        : session.command
          ? [session.command, ...(session.args ?? [])].join(" ")
          : "interactive shell",
  };
}
