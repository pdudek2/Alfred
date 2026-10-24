import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkerTools,
  MAX_LIVE_WORKERS,
  workerState,
  WorkerToolError,
  type WorkerHost,
  type WorkerRecord,
  type WorkerTurn,
} from "./worker-tools";

const idle: WorkerTurn = { lastPrompt: 0, lastTurnEnd: 0, waitingApproval: false, exited: false };

function fakeHost(workers: WorkerRecord[] = []) {
  const listeners = new Set<() => void>();
  const sent: Array<[string, string]> = [];
  const host: WorkerHost = {
    caller: (sessionId) => {
      if (sessionId === "lead-session") return { clientId: "claude-1", isWorker: false };
      if (sessionId === "worker-session") return { clientId: "codex-1", isWorker: true };
      return undefined;
    },
    workersOf: (parent) => (parent === "claude-1" ? workers : []),
    startWorker: vi.fn(async (_parent, request) => {
      const clientId = `${request.agent}-${workers.length + 1}`;
      workers.push({ clientId, title: request.title ?? "Codex", agent: request.agent, turn: { ...idle }, activityEvents: [] });
      return { clientId, title: request.title ?? "Codex" };
    }),
    send: (clientId, message) => {
      sent.push([clientId, message]);
      const worker = workers.find((candidate) => candidate.clientId === clientId)!;
      worker.turn = { ...worker.turn, lastPrompt: worker.turn.lastTurnEnd + 1 };
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { host, sent, workers, changed: () => listeners.forEach((listener) => listener()), listeners };
}

function worker(clientId: string, turn: Partial<WorkerTurn> = {}, extra: Partial<WorkerRecord> = {}): WorkerRecord {
  return { clientId, title: clientId, agent: "codex", turn: { ...idle, ...turn }, activityEvents: [], ...extra };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a worker's state for its orchestrator", () => {
  it("starts, works on each prompt, and waits for its next message after the turn ends", () => {
    expect(workerState(idle)).toBe("starting");
    expect(workerState({ ...idle, lastPrompt: 1 })).toBe("working");
    expect(workerState({ ...idle, lastPrompt: 1, lastTurnEnd: 2 })).toBe("your turn");
    // A message sent after the turn ended puts it back to work before its hook confirms it.
    expect(workerState({ ...idle, lastPrompt: 3, lastTurnEnd: 2 })).toBe("working");
    // Codex without trusted hooks reports only its turn ends.
    expect(workerState({ ...idle, lastTurnEnd: 1 })).toBe("your turn");
    expect(workerState({ ...idle, lastPrompt: 1, waitingApproval: true })).toBe("needs you");
    expect(workerState({ ...idle, lastPrompt: 1, waitingApproval: true, exited: true })).toBe("ended");
  });
});

describe("worker tools", () => {
  it("starts a worker for a top-level agent and lists it as starting", async () => {
    const { host, workers } = fakeHost();
    const tools = createWorkerTools(host);
    await expect(tools.call("lead-session", "start_worker", { agent: "codex", prompt: " Run the typecheck ", isolated: true }))
      .resolves.toEqual({ worker_id: "codex-1", title: "Codex", state: "starting" });
    expect(host.startWorker).toHaveBeenCalledWith("claude-1", { agent: "codex", prompt: "Run the typecheck", isolated: true });
    expect(workers).toHaveLength(1);
    await expect(tools.call("lead-session", "list_workers", {})).resolves.toEqual({
      workers: [{ worker_id: "codex-1", title: "Codex", agent: "codex", state: "starting" }],
    });
  });

  it("refuses a worker, a session Alfred no longer runs, a bad agent and an empty prompt", async () => {
    const { host } = fakeHost();
    const tools = createWorkerTools(host);
    await expect(tools.call("worker-session", "start_worker", { agent: "codex", prompt: "x" })).rejects.toThrow(/cannot start or run workers/);
    await expect(tools.call("gone", "list_workers", {})).rejects.toThrow(/not running in Alfred/);
    await expect(tools.call("lead-session", "start_worker", { agent: "gemini", prompt: "x" })).rejects.toThrow(/agent must be/);
    await expect(tools.call("lead-session", "start_worker", { agent: "codex", prompt: "  " })).rejects.toBeInstanceOf(WorkerToolError);
    expect(host.startWorker).not.toHaveBeenCalled();
  });

  it(`refuses a worker past ${MAX_LIVE_WORKERS} live ones; ended ones do not count`, async () => {
    const live = Array.from({ length: MAX_LIVE_WORKERS }, (_, index) => worker(`codex-${index + 1}`));
    const { host } = fakeHost(live);
    const tools = createWorkerTools(host);
    await expect(tools.call("lead-session", "start_worker", { agent: "claude", prompt: "x" })).rejects.toThrow(/already run 4 live workers/);
    live[0]!.turn.exited = true;
    await expect(tools.call("lead-session", "start_worker", { agent: "claude", prompt: "x" })).resolves.toMatchObject({ state: "starting" });
  });

  it("reads a worker's last answer and its last steps, newest first", async () => {
    const steps = [
      { id: "a", kind: "prompt" as const, title: "You asked", detail: "Run the typecheck", at: 1 },
      { id: "b", kind: "command" as const, title: "Ran command", detail: "pnpm typecheck", at: 2, payload: { type: "command" as const, command: "pnpm typecheck", description: "Run typecheck" } },
    ];
    const { host } = fakeHost([worker("codex-1", { lastPrompt: 1, lastTurnEnd: 2 }, { lastAnswer: "Typecheck passed.\nNo errors.", activityEvents: steps })]);
    await expect(createWorkerTools(host).call("lead-session", "read_worker", { worker_id: "codex-1" })).resolves.toEqual({
      worker_id: "codex-1",
      title: "codex-1",
      agent: "codex",
      state: "your turn",
      last_answer: "Typecheck passed.\nNo errors.",
      recent_steps: ["Run typecheck", "You asked: Run the typecheck"],
    });
    await expect(createWorkerTools(host).call("lead-session", "read_worker", { worker_id: "codex-9" })).rejects.toThrow(/No worker of yours/);
  });

  it("waits for the turn the worker is on to end, and gives up after the timeout", async () => {
    vi.useFakeTimers();
    const busy = worker("codex-1", { lastPrompt: 1 });
    const { host, changed, listeners } = fakeHost([busy]);
    const tools = createWorkerTools(host);

    const waiting = tools.call("lead-session", "wait_for_worker", { worker_id: "codex-1" });
    await Promise.resolve();
    changed(); // A tool call: still working.
    busy.turn = { ...busy.turn, lastTurnEnd: 2 };
    busy.lastAnswer = "Done.";
    changed();
    await expect(waiting).resolves.toMatchObject({ state: "your turn", last_answer: "Done." });
    expect(listeners.size).toBe(0);

    busy.turn = { ...busy.turn, lastPrompt: 3 };
    const timedOut = tools.call("lead-session", "wait_for_worker", { worker_id: "codex-1", timeout_seconds: 500 });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(timedOut).resolves.toMatchObject({ state: "working", timed_out: true });
    expect(listeners.size).toBe(0);
  });

  it("returns at once when the worker already waits", async () => {
    const { host } = fakeHost([worker("codex-1", { lastPrompt: 1, waitingApproval: true })]);
    await expect(createWorkerTools(host).call("lead-session", "wait_for_worker", { worker_id: "codex-1" }))
      .resolves.toMatchObject({ state: "needs you" });
  });

  it("sends a message only on the worker's turn, and it then counts as working", async () => {
    const waiting = worker("codex-1", { lastPrompt: 1, lastTurnEnd: 2 });
    const { host, sent } = fakeHost([
      waiting,
      worker("codex-2"),
      worker("codex-3", { lastPrompt: 1 }),
      worker("codex-4", { lastPrompt: 1, waitingApproval: true }),
      worker("codex-5", { exited: true }),
    ]);
    const tools = createWorkerTools(host);
    await expect(tools.call("lead-session", "send_to_worker", { worker_id: "codex-1", message: "Now fix the lint." }))
      .resolves.toEqual({ worker_id: "codex-1", sent: true, state: "working" });
    expect(sent).toEqual([["codex-1", "Now fix the lint."]]);
    // The same worker is busy now, so a second message cannot be typed over the first.
    await expect(tools.call("lead-session", "send_to_worker", { worker_id: "codex-1", message: "Again" })).rejects.toThrow(/is working/);
    await expect(tools.call("lead-session", "send_to_worker", { worker_id: "codex-2", message: "x" })).rejects.toThrow(/still starting/);
    await expect(tools.call("lead-session", "send_to_worker", { worker_id: "codex-4", message: "x" })).rejects.toThrow(/cannot answer that/);
    await expect(tools.call("lead-session", "send_to_worker", { worker_id: "codex-5", message: "x" })).rejects.toThrow(/has ended/);
    expect(sent).toHaveLength(1);
  });
});
