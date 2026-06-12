import { describe, expect, it, vi } from "vitest";
import { runLlmPlan, type RunLlmPlanInput } from "./alfred-llm.js";

const SYSTEM_PROMPT_FRAGMENT = "Alfred";
const baseInput: Omit<RunLlmPlanInput, "fetchImpl"> = {
  apiKey: "sk-test",
  prompt: "set me up to work on the api",
  model: "anthropic/claude-sonnet-4-6",
  timeoutMs: 5_000,
};

function mockFetchOk(content: string): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function mockFetchSequence(responses: Array<Response | (() => Response)>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("fetch called more times than expected");
    return typeof r === "function" ? r() : r;
  }) as unknown as typeof fetch;
}

describe("runLlmPlan", () => {
  it("returns no_api_key when apiKey is empty", async () => {
    const result = await runLlmPlan({ ...baseInput, apiKey: "", fetchImpl: mockFetchOk("") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_api_key");
  });

  it("returns auth on 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("auth");
  });

  it("returns rate_limit on 429", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate", { status: 429 })) as unknown as typeof fetch;
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("rate_limit");
  });

  it("returns network on fetch rejection", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("network");
  });

  it("returns malformed when JSON parse fails", async () => {
    const fetchImpl = mockFetchOk("not json at all");
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed");
  });

  it("accepts a JSON plan wrapped in a markdown code fence", async () => {
    const plan = `\`\`\`json
{
  "sessions": [
    { "kind": "shell", "title": "pwd", "command": "pwd", "args": [] }
  ]
}
\`\`\``;
    const fetchImpl = mockFetchOk(plan);
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.sessions[0]?.command).toBe("pwd");
    }
  });

  it("accepts a fenced JSON plan with surrounding prose", async () => {
    const plan = `Here is the plan:

\`\`\`json
{
  "sessions": [
    { "kind": "shell", "title": "pwd", "command": "pwd", "args": [] }
  ]
}
\`\`\`

Ready.`;
    const fetchImpl = mockFetchOk(plan);
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.sessions[0]?.command).toBe("pwd");
    }
  });

  it("does not scrape an unfenced JSON object out of prose", async () => {
    const proseWithJson = `Here is the plan:
{
  "sessions": [
    { "kind": "shell", "title": "pwd", "command": "pwd", "args": [] }
  ]
}
Ready.`;
    const fetchImpl = mockFetchSequence([
      new Response(JSON.stringify({ choices: [{ message: { content: proseWithJson } }] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [{ message: { content: proseWithJson } }] }), { status: 200 }),
    ]);

    const result = await runLlmPlan({ ...baseInput, fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once on schema failure then returns ok if retry is valid", async () => {
    const bad = JSON.stringify({ sessions: [{ kind: "wrong", title: "x" }] });
    const good = JSON.stringify({
      sessions: [{ kind: "shell", title: "ok", command: "ls", args: [] }],
    });
    const fetchImpl = mockFetchSequence([
      new Response(JSON.stringify({ choices: [{ message: { content: bad } }] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [{ message: { content: good } }] }), { status: 200 }),
    ]);
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.sessions).toHaveLength(1);
      expect(result.plan.sessions[0]?.kind).toBe("shell");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts and preserves explicit worktree isolation in a valid plan", async () => {
    const plan = JSON.stringify({
      sessions: [
        {
          kind: "codex",
          title: "Isolated refactor",
          command: "codex",
          args: ["Refactor safely"],
          isolation: "worktree",
        },
      ],
    });
    const fetchImpl = mockFetchOk(plan);

    const result = await runLlmPlan({ ...baseInput, fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.sessions[0]).toMatchObject({
        kind: "codex",
        title: "Isolated refactor",
        isolation: "worktree",
      });
    }
  });

  it("returns malformed when retry also fails schema", async () => {
    const bad = JSON.stringify({ sessions: [{ kind: "wrong" }] });
    const fetchImpl = mockFetchSequence([
      new Response(JSON.stringify({ choices: [{ message: { content: bad } }] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [{ message: { content: bad } }] }), { status: 200 }),
    ]);
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed");
  });

  it("attaches safetyNote on dangerous commands without rejecting the plan", async () => {
    const plan = JSON.stringify({
      sessions: [
        { kind: "shell", title: "Clean", command: "rm", args: ["-rf", "/tmp/x"] },
        { kind: "dev-server", title: "API", command: "pnpm", args: ["dev"] },
      ],
    });
    const fetchImpl = mockFetchOk(plan);
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.sessions[0]?.safetyNote).toBe("rm -rf detected");
      expect(result.plan.sessions[1]?.safetyNote).toBeUndefined();
    }
  });

  it("sends the system prompt and the user prompt in the request body", async () => {
    const plan = JSON.stringify({
      sessions: [{ kind: "shell", title: "ok", command: "ls", args: [] }],
    });
    const fetchImpl = mockFetchOk(plan);
    await runLlmPlan({ ...baseInput, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
        body: expect.stringContaining(SYSTEM_PROMPT_FRAGMENT),
      }),
    );
    const body = JSON.parse(((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("anthropic/claude-sonnet-4-6");
    expect(body.messages.find((m: { role: string }) => m.role === "system").content).toContain('Never use "--prompt"');
    expect(body.messages.find((m: { role: string }) => m.role === "user").content).toBe(baseInput.prompt);
  });

  it("includes workspace context in the user message when provided", async () => {
    const plan = JSON.stringify({
      sessions: [{ kind: "shell", title: "ok", command: "ls", args: [] }],
    });
    const fetchImpl = mockFetchOk(plan);

    await runLlmPlan({
      ...baseInput,
      workspace: {
        id: "CLIENT",
        label: "Client App",
        rootPath: "/Users/patryk/Desktop/ClientApp",
        gitBranch: "feature/agent-space",
        missionBrief: {
          goal: "Finish the launcher review without breaking manual terminals.",
          doneWhen: ["Planner returns a safe squad", "Review queue stays clear"],
          guardrails: ["No force push", "Ask before destructive commands"],
        },
        sessions: [
          {
            title: "Codex · api",
            kind: "codex",
            status: "active",
            cwd: "/Users/patryk/Desktop/ClientApp",
            command: "codex",
          },
        ],
      },
      fetchImpl,
    });

    const body = JSON.parse(((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit).body as string);
    const userMessage = body.messages.find((message: { role: string }) => message.role === "user").content;

    expect(userMessage).toContain("Current workspace:");
    expect(userMessage).toContain("- label: Client App");
    expect(userMessage).toContain("- cwd: /Users/patryk/Desktop/ClientApp");
    expect(userMessage).toContain("- branch: feature/agent-space");
    expect(userMessage).toContain("- mission brief:");
    expect(userMessage).toContain("goal: Finish the launcher review without breaking manual terminals.");
    expect(userMessage).toContain("done when: Planner returns a safe squad");
    expect(userMessage).toContain("guardrail: No force push");
    expect(userMessage).toContain("- existing sessions:");
    expect(userMessage).toContain("Codex · api (codex, active, /Users/patryk/Desktop/ClientApp, cmd=codex)");
    expect(userMessage).toContain(baseInput.prompt);
  });

  it("returns timeout when fetch is aborted", async () => {
    // Simulate AbortController firing: fetchImpl rejects with AbortError.
    const fetchImpl = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;
    const result = await runLlmPlan({ ...baseInput, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("timeout");
  });
});
