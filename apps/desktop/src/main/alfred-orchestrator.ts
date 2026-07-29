import { ipcMain } from "electron";
import {
  alfredChannels,
  type AlfredPlanRequest,
  type AlfredPlanResponse,
  type AlfredRuntimeStatus,
  type AlfredStagedPlanSessionUpdateRequest,
  type AlfredStagedPlanSessionUpdateResponse,
  type AlfredStagedPlanResolveRequest,
  type AlfredStagedPlanSetRequest,
  type AlfredStagedPlanSnapshotResponse,
} from "../shared/alfred-ipc.js";
import { runLlmPlan, DEFAULT_MODEL } from "./alfred-llm.js";
import { preflightAlfredPlan } from "./alfred-launch-preflight.js";
import {
  clearStagedPlanSnapshot,
  getStagedPlanSnapshot,
  resolveStagedPlanSessions,
  setStagedPlanSnapshot,
  updateStagedPlanSession,
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
  ipcMain.handle(
    alfredChannels.planSessionUpdate,
    async (_event, request: AlfredStagedPlanSessionUpdateRequest): Promise<AlfredStagedPlanSessionUpdateResponse> => {
      try {
        return await updateStagedPlanSession(request);
      } catch (error: unknown) {
        console.error("[alfred-orchestrator] failed to update staged session", error);
        return {
          ok: false,
          error: {
            code: "malformed",
            message: error instanceof Error ? error.message : "Failed to update staged session.",
          },
        };
      }
    },
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
          ...(request.dispatchTarget === undefined ? {} : { dispatchTarget: request.dispatchTarget }),
          prompt: request.prompt,
          ...(request.workspace === undefined ? {} : { workspace: request.workspace }),
          model,
          fetchImpl: globalThis.fetch,
        });
        if (!response.ok) {
          console.error("[alfred-orchestrator]", response.error);
          return response;
        }
        return {
          ok: true,
          plan: await preflightAlfredPlan(response.plan, request.workspace),
        };
      } catch (error: unknown) {
        console.error("[alfred-orchestrator] failed to prepare plan", error);
        return {
          ok: false,
          error: {
            code: "malformed",
            message: "Alfred could not prepare this plan.",
          },
        };
      } finally {
        inFlight = false;
      }
    },
  );
}
