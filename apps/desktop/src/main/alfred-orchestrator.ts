import { ipcMain } from "electron";
import {
  alfredChannels,
  type AlfredPlanRequest,
  type AlfredPlanResponse,
  type AlfredRuntimeStatus,
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
  ipcMain.handle(alfredChannels.runtimeStatus, (): AlfredRuntimeStatus => ({
    model: DEFAULT_MODEL,
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  }));
  ipcMain.handle(alfredChannels.planGet, (): Promise<AlfredStagedPlanSnapshotResponse> => getStagedPlanSnapshot());
  ipcMain.handle(
    alfredChannels.planSet,
    (_event, request: AlfredStagedPlanSetRequest): Promise<AlfredStagedPlanSnapshotResponse> =>
      setStagedPlanSnapshot(request),
  );
  ipcMain.handle(
    alfredChannels.planResolve,
    (_event, request: AlfredStagedPlanResolveRequest): Promise<AlfredStagedPlanSnapshotResponse> =>
      resolveStagedPlanSessions(request),
  );
  ipcMain.handle(alfredChannels.planClear, (): Promise<AlfredStagedPlanSnapshotResponse> => clearStagedPlanSnapshot());
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
          ...(request.workspace === undefined ? {} : { workspace: request.workspace }),
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
