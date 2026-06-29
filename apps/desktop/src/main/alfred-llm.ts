import * as AjvModule from "ajv";
import type { ValidateFunction } from "ajv";

const Ajv = ((AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule) as unknown as typeof import("ajv").default;
import type {
  AlfredError,
  AlfredPlan,
  AlfredPlanResponse,
  AlfredPlanSession,
  AlfredWorkspaceContext,
} from "../shared/alfred-ipc.js";
import type { DispatchTargetSnapshot } from "../shared/layout-ipc.js";
import { checkSafety } from "./alfred-safety.js";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
export const DEFAULT_TIMEOUT_MS = 30_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are Alfred, an agent orchestrator for a desktop coding cockpit.
The user will describe a workspace they want to prepare.
Use the provided workspace context when choosing cwd defaults and labels.
Use the existing session list to avoid launching duplicate agents unless the
user explicitly asks for another parallel copy.
You return a JSON plan of terminal sessions to launch — but you do NOT launch
them. The user reviews and approves each session before it runs.

Each session has: kind, title, cwd, command, args.
- kind ∈ ["codex", "claude", "dev-server", "shell"]
- isolation is optional and may be "shared" or "worktree". Omit it unless the
  user explicitly asks for an isolated worktree.
- "codex" runs the codex CLI for AI coding assistance
- "claude" runs the claude (Claude Code) CLI
- "dev-server" runs a local dev server (e.g. pnpm dev, next dev)
- "shell" is a generic fallback for arbitrary commands (tail, docker logs, tests, etc.)
- For codex prompts, use command "codex" with the prompt as a positional
  arg, e.g. args ["Review the backend"]. Never use "--prompt".
- For claude prompts, use command "claude" with the prompt as a positional
  arg for interactive sessions. Use "--print" only for intentionally
  non-interactive one-shot output. Never use "--prompt".
- The positional arg is the first user message sent TO the coding agent. It
  must be an assignment or role brief for that agent, never Alfred speaking to
  Patryk. Do not write first-person readiness text such as "I'm ready to help",
  "Jestem gotowy do pomocy", or "Tell me what you want to do".
- When the user asks for standby/helper coding agents, give each agent a clear
  role brief, e.g. "You are Codex Assistant #1 for this workspace. Patryk asked
  Alfred to prepare helper agents for: ... Inspect context and wait for the next
  concrete instruction. Do not edit files yet."

Title is a short human label (max 60 chars).
cwd is optional; if absent, current workspace cwd is used.
Keep plans focused: max 5 sessions.
Default to safe, idempotent commands. Never include destructive operations
(rm -rf, force-push, drop database). The user will run those manually.
Return a raw JSON object only. Do not wrap it in markdown or code fences.`;

const planSchema = {
  type: "object",
  required: ["sessions"],
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 80 },
    sessions: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        required: ["kind", "title", "command", "args"],
        additionalProperties: false,
        properties: {
          kind: { enum: ["codex", "claude", "dev-server", "shell"] },
          title: { type: "string", maxLength: 60 },
          cwd: { type: "string" },
          command: { type: "string", minLength: 1 },
          args: { type: "array", items: { type: "string" } },
          isolation: { enum: ["shared", "worktree"] },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validatePlan: ValidateFunction = ajv.compile(planSchema);

export type RunLlmPlanInput = {
  apiKey: string;
  dispatchTarget?: DispatchTargetSnapshot;
  prompt: string;
  workspace?: AlfredWorkspaceContext;
  model?: string;
  timeoutMs?: number;
  fetchImpl: typeof fetch;
};

export async function runLlmPlan(input: RunLlmPlanInput): Promise<AlfredPlanResponse> {
  const { apiKey, dispatchTarget, prompt, workspace, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = input;

  if (!apiKey) {
    return errorResponse("no_api_key", "Set OPENROUTER_API_KEY in .env to use Alfred.");
  }

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPromptWithWorkspace(prompt, workspace, dispatchTarget) },
  ];

  // First attempt
  const first = await callOpenRouter({ apiKey, model, messages, timeoutMs, fetchImpl });
  if (!first.ok) return first;
  const firstParsed = parseAndValidate(first.content);
  if (firstParsed.ok) return success(firstParsed.plan, prompt, workspace);

  // Retry once on malformed/schema with the bad reply attached as assistant turn
  const retryMessages = [
    ...messages,
    { role: "assistant" as const, content: first.content },
    {
      role: "user" as const,
      content: `Your previous response did not match the required schema. Field errors: ${firstParsed.errorDetail}. Please respond again with a raw JSON object only, no markdown fences.`,
    },
  ];
  const second = await callOpenRouter({ apiKey, model, messages: retryMessages, timeoutMs, fetchImpl });
  if (!second.ok) return second;
  const secondParsed = parseAndValidate(second.content);
  if (secondParsed.ok) return success(secondParsed.plan, prompt, workspace);

  return errorResponse("malformed", "Alfred returned an invalid plan. Try a clearer prompt.");
}

function userPromptWithWorkspace(
  prompt: string,
  workspace: AlfredWorkspaceContext | undefined,
  dispatchTarget: DispatchTargetSnapshot | undefined,
): string {
  if (!workspace) {
    return dispatchTarget
      ? [
          "Dispatch target:",
          `- kind: ${dispatchTarget.kind}`,
          `- id: ${dispatchTarget.id}`,
          `- label: ${dispatchTarget.label}`,
          "",
          "User request:",
          prompt,
        ].join("\n")
      : prompt;
  }
  const missionBrief = workspace.missionBrief;
  const hasMissionBrief =
    missionBrief !== undefined &&
    (missionBrief.goal.trim() || missionBrief.doneWhen.length > 0 || missionBrief.guardrails.length > 0);

  return [
    "Current workspace:",
    `- id: ${workspace.id}`,
    `- label: ${workspace.label}`,
    workspace.rootPath ? `- cwd: ${workspace.rootPath}` : null,
    workspace.gitBranch ? `- branch: ${workspace.gitBranch}` : null,
    ...(dispatchTarget
      ? [
          "- dispatch target:",
          `  kind: ${dispatchTarget.kind}`,
          `  id: ${dispatchTarget.id}`,
          `  label: ${dispatchTarget.label}`,
        ]
      : []),
    ...(hasMissionBrief
      ? [
          "- mission brief:",
          missionBrief.goal.trim() ? `  goal: ${missionBrief.goal.trim()}` : null,
          ...missionBrief.doneWhen.map((item) => `  done when: ${item}`),
          ...missionBrief.guardrails.map((item) => `  guardrail: ${item}`),
        ]
      : []),
    ...(workspace.sessions && workspace.sessions.length > 0
      ? [
          "- existing sessions:",
          ...workspace.sessions.slice(0, 8).map((session) => {
            const parts = [
              session.kind ?? "shell",
              session.status,
              session.cwd,
              session.command ? `cmd=${session.command}` : null,
            ].filter((item): item is string => Boolean(item));
            return `  - ${session.title}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
          }),
        ]
      : []),
    "",
    "User request:",
    prompt,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

type CallResult = { ok: true; content: string } | (AlfredPlanResponse & { ok: false });

async function callOpenRouter(args: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<CallResult> {
  const { apiKey, model, messages, timeoutMs, fetchImpl } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return errorResponse("auth", "OpenRouter rejected the API key. Verify .env.");
    }
    if (response.status === 429) {
      return errorResponse("rate_limit", "Rate limited by OpenRouter. Try again in a moment.");
    }
    if (!response.ok) {
      return errorResponse("network", `OpenRouter returned HTTP ${response.status}.`);
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return errorResponse("malformed", "OpenRouter response missing message content.");
    }
    return { ok: true, content };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return errorResponse("timeout", "Alfred took too long. Try a clearer prompt or check connection.");
    }
    return errorResponse("network", "Can't reach OpenRouter. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

type ParseResult = { ok: true; plan: AlfredPlan } | { ok: false; errorDetail: string };

function parseAndValidate(content: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate(content));
  } catch {
    return { ok: false, errorDetail: "JSON parse error" };
  }
  if (!validatePlan(parsed)) {
    const detail = (validatePlan.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`)
      .join("; ");
    return { ok: false, errorDetail: detail || "schema validation failed" };
  }
  return { ok: true, plan: parsed as AlfredPlan };
}

function jsonCandidate(content: string): string {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  return trimmed;
}

function success(plan: AlfredPlan, prompt: string, workspace: AlfredWorkspaceContext | undefined): AlfredPlanResponse {
  const annotated: AlfredPlanSession[] = plan.sessions.map((s, index) => {
    const normalized = normalizeCodingAgentPrompt(s, index, prompt, workspace);
    const result = checkSafety(normalized.command, normalized.args);
    return result.unsafe ? { ...normalized, safetyNote: result.reason } : normalized;
  });
  return { ok: true, plan: { ...plan, sessions: annotated } };
}

function errorResponse(code: AlfredError["code"], message: string): AlfredPlanResponse & { ok: false } {
  return { ok: false, error: { code, message } };
}

const SPOKEN_AS_ALFRED_PATTERNS = [
  /\bjestem gotow(?:y|a)\b/i,
  /\bgotow(?:y|a) do pomocy\b/i,
  /\bopisz co chcesz\b/i,
  /\bco chcesz zrobi(?:ć|c)\b/i,
  /\bi(?:'| a)?m ready\b/i,
  /\bi am ready\b/i,
  /\bready to help\b/i,
  /\btell me what you (?:want|need)\b/i,
  /\bwhat would you like\b/i,
] as const;

function normalizeCodingAgentPrompt(
  session: AlfredPlanSession,
  index: number,
  prompt: string,
  workspace: AlfredWorkspaceContext | undefined,
): AlfredPlanSession {
  if (session.kind !== "codex" && session.kind !== "claude") return session;
  const positionalPrompt = session.args.join(" ").trim();
  if (!looksLikeAlfredSpeakingToUser(positionalPrompt)) return session;

  return {
    ...session,
    args: [codingAgentRoleBrief(session, index, prompt, workspace)],
  };
}

function looksLikeAlfredSpeakingToUser(value: string): boolean {
  return Boolean(value) && SPOKEN_AS_ALFRED_PATTERNS.some((pattern) => pattern.test(value));
}

function codingAgentRoleBrief(
  session: AlfredPlanSession,
  index: number,
  prompt: string,
  workspace: AlfredWorkspaceContext | undefined,
): string {
  const title = session.title.trim() || `${agentKindLabel(session.kind)} Assistant #${index + 1}`;
  const workspaceLabel = workspace?.label?.trim() || "this workspace";
  const details = [
    `You are ${title} for the ${workspaceLabel} workspace.`,
    `Patryk asked Alfred to prepare this agent session for: "${prompt.trim()}".`,
    workspace?.rootPath ? `Workspace cwd: ${workspace.rootPath}.` : null,
    workspace?.gitBranch ? `Current branch: ${workspace.gitBranch}.` : null,
    "Treat this as your assignment brief, not as text from you to Patryk.",
    "Inspect the project context if useful, then wait for Patryk's next concrete instruction.",
    "Do not edit files or run destructive commands until Patryk asks for a specific task.",
  ];
  return details.filter((item): item is string => item !== null).join(" ");
}

function agentKindLabel(kind: AlfredPlanSession["kind"]): string {
  return kind === "claude" ? "Claude" : kind === "codex" ? "Codex" : "Agent";
}
