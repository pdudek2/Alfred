import { ipcMain } from "electron";
import {
  alfredChannels,
  type AlfredPlanRequest,
  type AlfredPlanResponse,
  type AlfredStagedPlanResolveRequest,
  type AlfredStagedPlanSetRequest,
  type AlfredStagedPlanSnapshotResponse,
} from "../shared/alfred-ipc.js";
import { runLlmPlan, DEFAULT_MODEL } from "./alfred-llm.js";
import {
  clearStagedPlanSnapshot,
  getStagedPlanSnapshot,
  resolveStagedPlanSessions,
  setStagedPlanSnapshot,
} from "./staged-plan-store.js";

let inFlight = false;

export function registerAlfredIpc(): void {
  ipcMain.handle(alfredChannels.planGet, (): AlfredStagedPlanSnapshotResponse => getStagedPlanSnapshot());
  ipcMain.handle(
    alfredChannels.planSet,
    (_event, request: AlfredStagedPlanSetRequest): AlfredStagedPlanSnapshotResponse =>
      setStagedPlanSnapshot(request),
  );
  ipcMain.handle(
    alfredChannels.planResolve,
    (_event, request: AlfredStagedPlanResolveRequest): AlfredStagedPlanSnapshotResponse =>
      resolveStagedPlanSessions(request),
  );
  ipcMain.handle(alfredChannels.planClear, (): AlfredStagedPlanSnapshotResponse => clearStagedPlanSnapshot());
  ipcMain.handle(
    alfredChannels.planRequest,
    async (_event, request: AlfredPlanRequest): Promise<AlfredPlanResponse> => {
      if (inFlight) {
        return {
          ok: false,
          error: { code: "in_flight", message: "Alfred is still working on the previous prompt." },
        };
      }
      inFlight = true;
      try {
        const apiKey = process.env.OPENROUTER_API_KEY ?? "";
        const model = process.env.ALFRED_LLM_MODEL ?? DEFAULT_MODEL;
        const response = await runLlmPlan({
          apiKey,
          prompt: request.prompt,
          model,
          fetchImpl: globalThis.fetch,
        });
        if (!response.ok) {
          console.error("[alfred-orchestrator]", response.error);
        }
        return response;
      } finally {
        inFlight = false;
      }
    },
  );
}
