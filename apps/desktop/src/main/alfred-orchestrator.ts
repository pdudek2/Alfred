import { ipcMain } from "electron";
import { alfredChannels, type AlfredPlanRequest, type AlfredPlanResponse } from "../shared/alfred-ipc.js";
import { runLlmPlan, DEFAULT_MODEL } from "./alfred-llm.js";

let inFlight = false;

export function registerAlfredIpc(): void {
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
