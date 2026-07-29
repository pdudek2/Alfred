import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alfredChannels, type AlfredPlanRequest, type AlfredPlanResponse } from "../shared/alfred-ipc.js";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  preflightAlfredPlan: vi.fn(),
  runLlmPlan: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));
vi.mock("./alfred-llm.js", () => ({
  DEFAULT_MODEL: "test-model",
  runLlmPlan: mocks.runLlmPlan,
}));
vi.mock("./alfred-launch-preflight.js", () => ({
  preflightAlfredPlan: mocks.preflightAlfredPlan,
}));

const planRequest: AlfredPlanRequest = { prompt: "prepare a test plan" };
const successfulPlan = {
  sessions: [{ kind: "shell" as const, title: "test", command: "pnpm", args: ["test"] }],
};
const safeFailure: AlfredPlanResponse = {
  ok: false,
  error: {
    code: "malformed",
    message: "Alfred could not prepare this plan.",
  },
};

async function planRequestHandler(): Promise<(event: unknown, request: AlfredPlanRequest) => Promise<AlfredPlanResponse>> {
  const { registerAlfredIpc } = await import("./alfred-orchestrator.js");
  registerAlfredIpc();
  const handler = mocks.handlers.get(alfredChannels.planRequest);
  if (!handler) throw new Error("Alfred plan IPC handler was not registered");
  return handler as (event: unknown, request: AlfredPlanRequest) => Promise<AlfredPlanResponse>;
}

describe("Alfred plan IPC", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.preflightAlfredPlan.mockReset();
    mocks.runLlmPlan.mockReset();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("returns a safe failure and releases inFlight after preflight throws", async () => {
    mocks.runLlmPlan.mockResolvedValue({ ok: true, plan: successfulPlan });
    mocks.preflightAlfredPlan.mockRejectedValueOnce(new Error("fixture preflight exploded")).mockResolvedValueOnce(successfulPlan);
    const handler = await planRequestHandler();

    await expect(handler({}, planRequest)).resolves.toEqual(safeFailure);
    await expect(handler({}, planRequest)).resolves.toMatchObject({ ok: true });
  });

  it("returns a safe failure and releases inFlight after the planner throws", async () => {
    mocks.runLlmPlan.mockRejectedValueOnce(new Error("fixture planner exploded")).mockResolvedValueOnce({ ok: true, plan: successfulPlan });
    mocks.preflightAlfredPlan.mockResolvedValue(successfulPlan);
    const handler = await planRequestHandler();

    await expect(handler({}, planRequest)).resolves.toEqual(safeFailure);
    await expect(handler({}, planRequest)).resolves.toMatchObject({ ok: true });
  });
});
