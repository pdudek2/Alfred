import { activitySentence, presentActivityEvents } from "../shared/activity-presentation.js";
import type { SessionActivityEvent } from "../shared/session-activity.js";

/** The tools an orchestrator agent runs its workers with. Alfred serves them over MCP; this module answers the calls. */

export const MAX_LIVE_WORKERS = 4;
const DEFAULT_WAIT_SECONDS = 60;
const MAX_WAIT_SECONDS = 120;
const MAX_TEXT_LENGTH = 20_000;
const MAX_TITLE_LENGTH = 80;
const RECENT_ACTIVITY = 10;

export type WorkerAgent = "claude" | "codex";
/** The effort levels each CLI takes: Claude's --effort, Codex's model_reasoning_effort. */
const EFFORTS: Record<WorkerAgent, readonly string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh"],
};
const MODEL_NAME = /^[A-Za-z0-9][\w.:\-[\]/]{0,79}$/;
export type WorkerState = "starting" | "working" | "your turn" | "needs you" | "ended";

/**
 * A worker's turns as its hooks or notifications report them. Each mark is a sequence number from one counter
 * (0 = never), so a prompt and the Stop after it order correctly even within one millisecond.
 */
export type WorkerTurn = {
  /** The last prompt: a message it received or a tool it ran, both of which mean it is working. */
  lastPrompt: number;
  /** The last end of a turn: Claude's or Codex's Stop, or Codex's turn-end notification. */
  lastTurnEnd: number;
  waitingApproval: boolean;
  exited: boolean;
};

export type WorkerRecord = {
  clientId: string;
  title: string;
  agent: string;
  turn: WorkerTurn;
  /** The worker's full final answer of its last turn. */
  lastAnswer?: string | undefined;
  activityEvents: SessionActivityEvent[];
};

export type WorkerStartRequest = {
  agent: WorkerAgent;
  prompt: string;
  isolated: boolean;
  title?: string;
  model?: string;
  effort?: string;
};

export type WorkerHost = {
  /** The live session whose MCP server called, by the session id Alfred started that server with. */
  caller(sessionId: string): { clientId: string; title: string; isAgent: boolean; isWorker: boolean } | undefined;
  /** Live workers under the parent, plus the ones that ended or are still starting. */
  workersOf(parentClientId: string): WorkerRecord[];
  startWorker(parentClientId: string, request: WorkerStartRequest): Promise<{ clientId: string; title: string }>;
  /** Types the text into the worker's terminal and presses Enter. */
  send(clientId: string, text: string): void;
  /** Ends the worker's process; its checkout stays. */
  stop(clientId: string): void;
  /** The orchestrator has read these workers' current state, so Alfred need not wake it about them. */
  markSeen(parentClientId: string, workerClientIds: string[]): void;
  onChange(listener: () => void): () => void;
};

/** Text Alfred types into an agent's terminal starts with one of these, so the agent and Details tell it from yours. */
export function orchestratorMessage(orchestratorTitle: string, message: string): string {
  return `Message from your orchestrator, Alfred session "${orchestratorTitle}" (not from the user):\n\n${message}`;
}

export function alfredNotice(text: string): string {
  return `Message from Alfred (not from the user): ${text}`;
}

const ORCHESTRATOR_LABEL = /^Message from your orchestrator, Alfred session "[^"\n]*" \(not from the user\):\s*/;
const ALFRED_LABEL = /^Message from Alfred \(not from the user\):\s*/;

/** Who wrote a prompt, read from its label: the orchestrator or Alfred itself; nothing for the user's own message. */
export function typedPromptSource(prompt: string): { title: string; text: string } | undefined {
  const text = prompt.trim();
  const orchestrator = ORCHESTRATOR_LABEL.exec(text);
  if (orchestrator) return { title: "Orchestrator asked", text: text.slice(orchestrator[0].length) };
  const alfred = ALFRED_LABEL.exec(text);
  if (alfred) return { title: "Alfred reported", text: text.slice(alfred[0].length) };
  return undefined;
}

/** A refusal the agent should read: why the call cannot be done now. */
export class WorkerToolError extends Error {}

export function workerState(turn: WorkerTurn): WorkerState {
  if (turn.exited) return "ended";
  if (turn.waitingApproval) return "needs you";
  if (turn.lastPrompt > turn.lastTurnEnd) return "working";
  return turn.lastTurnEnd > 0 ? "your turn" : "starting";
}

const workerId = { type: "string", description: "The worker_id start_worker or list_workers returned." } as const;

/** What the agent sees in tools/list. The descriptions are the only manual it gets. */
export const WORKER_TOOL_DEFINITIONS = [
  {
    name: "start_worker",
    description:
      "Start a worker agent in Alfred, in this project, with a first prompt. This is how you run a separate task or a "
      + "worker thread here: it runs in its own terminal under you in Alfred's session tree, where the user can watch it. "
      + `You can run up to ${MAX_LIVE_WORKERS} live workers. Give each one a self-contained task: it does not see your `
      + "conversation. When a worker you started finishes a turn while you wait for the user, Alfred sends you a message "
      + "saying so, so you can end your turn instead of waiting.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["claude", "codex"], description: "Which agent runs the worker." },
        prompt: { type: "string", description: "The worker's first message: the whole task, with what done looks like." },
        isolated: {
          type: "boolean",
          description: "Run it in its own git worktree. Use this when several workers edit files at once. Default: the shared project folder.",
        },
        title: { type: "string", description: "A short name for the worker in the session tree." },
        model: { type: "string", description: "The model to run it on, as the agent's --model takes it. Default: the agent's own." },
        effort: {
          type: "string",
          description: `Reasoning effort. Claude: ${EFFORTS.claude.join(", ")}. Codex: ${EFFORTS.codex.join(", ")}. Default: the agent's own.`,
        },
      },
      required: ["agent", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "list_workers",
    description: "List your workers with their state (starting, working, your turn, needs you, ended) and last answer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_worker",
    description: "Read one worker: its state, its final answer of its last turn, and its last steps.",
    inputSchema: { type: "object", properties: { worker_id: workerId }, required: ["worker_id"], additionalProperties: false },
  },
  {
    name: "wait_for_worker",
    description:
      "Wait until the worker finishes the turn it is on (your turn, needs you or ended), then read it as read_worker "
      + `does. Returns timed_out after timeout_seconds (default ${DEFAULT_WAIT_SECONDS}, at most ${MAX_WAIT_SECONDS}); call it again to keep waiting.`,
    inputSchema: {
      type: "object",
      properties: { worker_id: workerId, timeout_seconds: { type: "number", minimum: 1, maximum: MAX_WAIT_SECONDS } },
      required: ["worker_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_to_worker",
    description:
      "Send a worker its next message, typed into its terminal under a line saying it comes from you, not the user. "
      + "Only while it waits for one (state: your turn); it never answers an approval the worker asks the user for.",
    inputSchema: {
      type: "object",
      properties: { worker_id: workerId, message: { type: "string" } },
      required: ["worker_id", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "stop_worker",
    description: "Stop a worker: its process ends, and its files and worktree stay as they are.",
    inputSchema: { type: "object", properties: { worker_id: workerId }, required: ["worker_id"], additionalProperties: false },
  },
] as const;

export function createWorkerTools(host: WorkerHost) {
  // Starts still waiting for the window count against the limit, so parallel calls cannot run past it.
  const startsInFlight = new Map<string, number>();
  return {
    async call(sessionId: string, tool: string, args: unknown): Promise<unknown> {
      const caller = host.caller(sessionId);
      if (!caller) throw new WorkerToolError("This session is not running in Alfred any more.");
      if (!caller.isAgent) throw new WorkerToolError("Only a Claude or Codex session can run workers.");
      if (caller.isWorker) throw new WorkerToolError("A worker cannot start or run workers of its own.");
      const input: Record<string, unknown> = typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
      const workers = () => host.workersOf(caller.clientId);

      switch (tool) {
        case "start_worker": {
          const agent = input.agent;
          if (agent !== "claude" && agent !== "codex") throw new WorkerToolError("agent must be \"claude\" or \"codex\".");
          const prompt = requiredText(input.prompt, "prompt");
          const title = typeof input.title === "string" ? input.title.trim().slice(0, MAX_TITLE_LENGTH) : "";
          const model = optionalChoice(input.model, "model", (value) => MODEL_NAME.test(value), "a model name such as the agent's --model takes");
          const effort = optionalChoice(input.effort, "effort", (value) => EFFORTS[agent].includes(value), `one of ${EFFORTS[agent].join(", ")} for ${agent}`);
          const inFlight = startsInFlight.get(caller.clientId) ?? 0;
          const live = workers().filter((worker) => workerState(worker.turn) !== "ended").length + inFlight;
          if (live >= MAX_LIVE_WORKERS) {
            throw new WorkerToolError(
              `You already run ${MAX_LIVE_WORKERS} live workers, the most Alfred allows. Wait for one to end, or ask the user to close one.`,
            );
          }
          startsInFlight.set(caller.clientId, inFlight + 1);
          try {
            const started = await host.startWorker(caller.clientId, {
              agent,
              prompt,
              isolated: input.isolated === true,
              ...(title ? { title } : {}),
              ...(model ? { model } : {}),
              ...(effort ? { effort } : {}),
            });
            return {
              worker_id: started.clientId,
              title: started.title,
              state: "starting",
              ...(model ? { model } : {}),
              ...(effort ? { effort } : {}),
            };
          } finally {
            const left = (startsInFlight.get(caller.clientId) ?? 1) - 1;
            if (left > 0) startsInFlight.set(caller.clientId, left);
            else startsInFlight.delete(caller.clientId);
          }
        }
        case "list_workers": {
          const listed = workers();
          host.markSeen(caller.clientId, listed.map((worker) => worker.clientId));
          return { workers: listed.map(summary) };
        }
        case "read_worker": {
          const worker = findWorker(workers(), input.worker_id);
          host.markSeen(caller.clientId, [worker.clientId]);
          return detail(worker);
        }
        case "wait_for_worker": {
          const id = findWorker(workers(), input.worker_id).clientId;
          const seconds = typeof input.timeout_seconds === "number" && Number.isFinite(input.timeout_seconds)
            ? Math.min(MAX_WAIT_SECONDS, Math.max(1, input.timeout_seconds))
            : DEFAULT_WAIT_SECONDS;
          const current = () => findWorker(workers(), id);
          host.markSeen(caller.clientId, [id]);
          if (isSettled(current())) return detail(current());
          const settled = await new Promise<boolean>((resolve, reject) => {
            const finish = (value: boolean) => {
              clearTimeout(timer);
              stop();
              resolve(value);
            };
            const timer = setTimeout(() => finish(false), seconds * 1000);
            const stop = host.onChange(() => {
              try {
                if (isSettled(current())) finish(true);
              } catch (error) {
                clearTimeout(timer);
                stop();
                reject(error);
              }
            });
          });
          host.markSeen(caller.clientId, [id]);
          return settled ? detail(current()) : { ...detail(current()), timed_out: true };
        }
        case "send_to_worker": {
          const worker = findWorker(workers(), input.worker_id);
          const message = requiredText(input.message, "message");
          const state = workerState(worker.turn);
          if (state !== "your turn") throw new WorkerToolError(SEND_REFUSALS[state]);
          host.send(worker.clientId, orchestratorMessage(caller.title, message));
          return { worker_id: worker.clientId, sent: true, state: "working" };
        }
        case "stop_worker": {
          const worker = findWorker(workers(), input.worker_id);
          if (workerState(worker.turn) === "ended") throw new WorkerToolError("The worker has already ended.");
          host.stop(worker.clientId);
          host.markSeen(caller.clientId, [worker.clientId]);
          return { worker_id: worker.clientId, stopped: true };
        }
        default:
          throw new WorkerToolError(`Alfred has no tool named ${tool}.`);
      }
    },
  };
}

const SEND_REFUSALS: Record<Exclude<WorkerState, "your turn">, string> = {
  starting: "The worker is still starting on its first prompt. Use wait_for_worker until its turn ends.",
  working: "The worker is working. Use wait_for_worker until its turn ends, then send the message.",
  "needs you": "The worker waits for the user to approve something in its terminal. A message cannot answer that.",
  ended: "The worker has ended.",
};

function isSettled(worker: WorkerRecord): boolean {
  const state = workerState(worker.turn);
  return state === "your turn" || state === "needs you" || state === "ended";
}

function findWorker(workers: WorkerRecord[], id: unknown): WorkerRecord {
  const worker = typeof id === "string" ? workers.find((candidate) => candidate.clientId === id) : undefined;
  if (!worker) throw new WorkerToolError("No worker of yours has that worker_id. list_workers shows them.");
  return worker;
}

function optionalChoice(value: unknown, name: string, valid: (value: string) => boolean, expected: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !valid(value.trim())) throw new WorkerToolError(`${name} must be ${expected}.`);
  return value.trim();
}

function requiredText(value: unknown, name: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new WorkerToolError(`${name} must be a non-empty string.`);
  if (text.length > MAX_TEXT_LENGTH) throw new WorkerToolError(`${name} is longer than ${MAX_TEXT_LENGTH} characters.`);
  return text;
}

function summary(worker: WorkerRecord) {
  return {
    worker_id: worker.clientId,
    title: worker.title,
    agent: worker.agent,
    state: workerState(worker.turn),
    ...(worker.lastAnswer ? { last_answer: worker.lastAnswer } : {}),
  };
}

function detail(worker: WorkerRecord) {
  const steps = presentActivityEvents(worker.activityEvents, { limit: RECENT_ACTIVITY }).visibleEvents;
  return { ...summary(worker), recent_steps: steps.map(activitySentence) };
}
