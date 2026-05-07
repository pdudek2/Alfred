import * as AjvModule from "ajv";
import type { ValidateFunction } from "ajv";

const Ajv = ((AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule) as unknown as typeof import("ajv").default;
import type {
  AlfredError,
  AlfredPlan,
  AlfredPlanResponse,
  AlfredPlanSession,
} from "../shared/alfred-ipc.js";
import { checkSafety } from "./alfred-safety.js";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
export const DEFAULT_TIMEOUT_MS = 30_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are Alfred, an agent orchestrator for a desktop coding cockpit.
The user will describe a workspace they want to prepare.
You return a JSON plan of terminal sessions to launch — but you do NOT launch
them. The user reviews and approves each session before it runs.

Each session has: kind, title, cwd, command, args.
- kind ∈ ["codex", "claude", "dev-server", "shell"]
- "codex" runs the codex CLI for AI coding assistance
- "claude" runs the claude (Claude Code) CLI
- "dev-server" runs a local dev server (e.g. pnpm dev, next dev)
- "shell" is a generic fallback for arbitrary commands (tail, docker logs, tests, etc.)

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
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validatePlan: ValidateFunction = ajv.compile(planSchema);

export type RunLlmPlanInput = {
  apiKey: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl: typeof fetch;
};

export async function runLlmPlan(input: RunLlmPlanInput): Promise<AlfredPlanResponse> {
  const { apiKey, prompt, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = input;

  if (!apiKey) {
    return errorResponse("no_api_key", "Set OPENROUTER_API_KEY in .env to use Alfred.");
  }

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  // First attempt
  const first = await callOpenRouter({ apiKey, model, messages, timeoutMs, fetchImpl });
  if (!first.ok) return first;
  const firstParsed = parseAndValidate(first.content);
  if (firstParsed.ok) return success(firstParsed.plan);

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
  if (secondParsed.ok) return success(secondParsed.plan);

  return errorResponse("malformed", "Alfred returned an invalid plan. Try a clearer prompt.");
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

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function success(plan: AlfredPlan): AlfredPlanResponse {
  const annotated: AlfredPlanSession[] = plan.sessions.map((s) => {
    const result = checkSafety(s.command, s.args);
    return result.unsafe ? { ...s, safetyNote: result.reason } : s;
  });
  return { ok: true, plan: { ...plan, sessions: annotated } };
}

function errorResponse(code: AlfredError["code"], message: string): AlfredPlanResponse & { ok: false } {
  return { ok: false, error: { code, message } };
}
