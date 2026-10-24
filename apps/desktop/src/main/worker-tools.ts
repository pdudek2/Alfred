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

export type WorkerStartRequest = { agent: WorkerAgent; prompt: string; isolated: boolean; title?: string };

export type WorkerHost = {
  /** The live session whose MCP server called, by the session id Alfred started that server with. */
  caller(sessionId: string): { clientId: string; isWorker: boolean } | undefined;
  /** Live workers under the parent, plus the ones that ended or are still starting. */
  workersOf(parentClientId: string): WorkerRecord[];
  startWorker(parentClientId: string, request: WorkerStartRequest): Promise<{ clientId: string; title: string }>;
  /** Types the message into the worker's terminal and presses Enter. */
  send(clientId: string, message: string): void;
  onChange(listener: () => void): () => void;
};

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
      "Start a worker agent in Alfred, in this project, with a first prompt. It runs in its own terminal under you in "
      + "Alfred's session tree, where the user can watch it. You can run up to "
      + `${MAX_LIVE_WORKERS} live workers. Give each one a self-contained task: it does not see your conversation.`,
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
      "Send a worker its next message, as if typed into its terminal. Only while it waits for one (state: your turn); "
      + "it never answers an approval the worker asks the user for.",
    inputSchema: {
      type: "object",
      properties: { worker_id: workerId, message: { type: "string" } },
      required: ["worker_id", "message"],
      additionalProperties: false,
    },
  },
] as const;

export function createWorkerTools(host: WorkerHost) {
  return {
    async call(sessionId: string, tool: string, args: unknown): Promise<unknown> {
      const caller = host.caller(sessionId);
      if (!caller) throw new WorkerToolError("This session is not running in Alfred any more.");
      if (caller.isWorker) throw new WorkerToolError("A worker cannot start or run workers of its own.");
      const input: Record<string, unknown> = typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
      const workers = () => host.workersOf(caller.clientId);

      switch (tool) {
        case "start_worker": {
          const agent = input.agent;
          if (agent !== "claude" && agent !== "codex") throw new WorkerToolError("agent must be \"claude\" or \"codex\".");
          const prompt = requiredText(input.prompt, "prompt");
          const title = typeof input.title === "string" ? input.title.trim().slice(0, MAX_TITLE_LENGTH) : "";
          const live = workers().filter((worker) => workerState(worker.turn) !== "ended");
          if (live.length >= MAX_LIVE_WORKERS) {
            throw new WorkerToolError(
              `You already run ${live.length} live workers, the most Alfred allows. Wait for one to end, or ask the user to close one.`,
            );
          }
          const started = await host.startWorker(caller.clientId, {
            agent,
            prompt,
            isolated: input.isolated === true,
            ...(title ? { title } : {}),
          });
          return { worker_id: started.clientId, title: started.title, state: "starting" };
        }
        case "list_workers":
          return { workers: workers().map(summary) };
        case "read_worker":
          return detail(findWorker(workers(), input.worker_id));
        case "wait_for_worker": {
          const id = findWorker(workers(), input.worker_id).clientId;
          const seconds = typeof input.timeout_seconds === "number" && Number.isFinite(input.timeout_seconds)
            ? Math.min(MAX_WAIT_SECONDS, Math.max(1, input.timeout_seconds))
            : DEFAULT_WAIT_SECONDS;
          const current = () => findWorker(workers(), id);
          if (isSettled(current())) return detail(current());
          const settled = await new Promise<boolean>((resolve) => {
            const finish = (value: boolean) => {
              clearTimeout(timer);
              stop();
              resolve(value);
            };
            const timer = setTimeout(() => finish(false), seconds * 1000);
            const stop = host.onChange(() => {
              if (isSettled(current())) finish(true);
            });
          });
          return settled ? detail(current()) : { ...detail(current()), timed_out: true };
        }
        case "send_to_worker": {
          const worker = findWorker(workers(), input.worker_id);
          const message = requiredText(input.message, "message");
          const state = workerState(worker.turn);
          if (state !== "your turn") throw new WorkerToolError(SEND_REFUSALS[state]);
          host.send(worker.clientId, message);
          return { worker_id: worker.clientId, sent: true, state: "working" };
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
