import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAgentEventLines, shellPrograms, summarizeAgentEvents, type AnalyticsLine } from "./agent-analytics";

// Monday 2026-11-23, 12:00 in Warsaw.
const NOW = Date.parse("2026-11-23T11:00:00Z");
// From 04:00 that day.
const at = (minutes: number) => new Date(NOW - 8 * 60 * 60 * 1000 + minutes * 60_000).toISOString();
const line = (minutes: number, event: string, attributes: Record<string, unknown> = {}, session = "claude-1", agent: AnalyticsLine["agent"] = "claude"): AnalyticsLine =>
  ({ agent, at: at(minutes), attributes, event, session });
const prompt = (minutes: number, session = "claude-1", extra: Record<string, unknown> = {}) => line(minutes, "user_prompt", { prompt_length: "9", ...extra }, session);
const stop = (minutes: number, session = "claude-1") => line(minutes, "hook_execution_start", { hook_event: "Stop" }, session);
const request = (minutes: number, attributes: Record<string, unknown>, session = "claude-1") =>
  line(minutes, "api_request", { model: "claude-opus-5-5", query_source: "repl_main_thread", input_tokens: 10, cache_creation_tokens: 20, cache_read_tokens: 300, output_tokens: 40, cost_usd: 1.5, ...attributes }, session);
const summarize = (lines: AnalyticsLine[], period: "7d" | "30d" | "all" = "7d") =>
  summarizeAgentEvents(lines, { now: NOW, period, timeZone: "Europe/Warsaw", recording: true });

describe("summarizeAgentEvents", () => {
  it("adds up cost and tokens per model, and leaves requests to another provider and Codex unpriced", () => {
    const summary = summarize([
      request(0, {}),
      request(1, { agent_id: "a1", cost_usd: 0.5 }),
      line(2, "subagent_completed", { agent_id: "a1" }),
      request(3, { model: "deepseek-flash", "anthropic.custom_base_url": true, cost_usd: 0.15 }, "claude-2"),
      line(4, "codex.sse_event", { "event.kind": "response.completed", model: "gpt-6.1-sol", input_token_count: 100, cached_token_count: 80, output_token_count: 5 }, "codex-1", "codex"),
      line(5, "codex.sse_event", { "event.kind": "response.completed", model: "gpt-6.1-sol", input_token_count: "[redacted]", cached_token_count: 0, output_token_count: 1 }, "codex-1", "codex"),
      // Before the period: Tuesday a week ago.
      { ...request(0, { cost_usd: 99 }), at: "2026-11-16T12:00:00Z" },
    ]);

    expect(summary.days.map((day) => day.day)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(summary.costUsd).toBe(2);
    expect(summary.cost).toEqual({ mainUsd: 1.5, subagentsUsd: 0.5, subagentRuns: 1 });
    expect(summary.sessions).toBe(3);
    expect(summary.models.map((model) => [model.model, model.costUsd, model.sessions, model.tokensPartial])).toEqual([
      ["claude-opus-5-5", 2, 1, false],
      ["deepseek-flash", null, 1, false],
      ["gpt-6.1-sol", null, 1, true],
    ]);
    expect(summary.models[0]!.tokens).toEqual({ input: 20, cacheWrite: 40, cacheRead: 600, output: 80 });
    // OpenAI counts cached input inside the input; an unknown count is not a zero.
    expect(summary.models[2]!.tokens).toEqual({ input: 20, cacheWrite: 0, cacheRead: 80, output: 6 });
    expect(summary.days.at(-1)!.costUsd).toEqual({ "claude-opus-5-5": 2 });
  });

  it("times turns and your replies, ends a turn you stopped with Esc at its last step, and leaves an orchestrator's worker out", () => {
    const summary = summarize([
      prompt(0), request(1, {}), stop(2),
      // You answer after 3 minutes, then after 5; the agent works 10 minutes.
      prompt(5), request(14, {}), stop(15),
      // Esc: no Stop, the next message comes 50 minutes later.
      prompt(20), request(22, {}), prompt(72), stop(73),
      // Away for 5 hours.
      prompt(373), stop(374),
      // Typed while the agent works: your message, not a new turn.
      prompt(374.5, "claude-1", { "delivery.mode": "mid_turn" }),
      // A second session works alongside the first.
      prompt(6, "claude-2"), stop(16, "claude-2"),
      // An orchestrator's worker: its messages are not yours.
      line(0, "alfred.worker_started", {}, "claude-9"),
      prompt(30, "claude-9"), stop(40, "claude-9"), prompt(41, "claude-9"),
      line(10, "user_prompt", { command_name: "model" }),
    ]);

    expect(summary.waiting).toMatchObject({ answered: 2, away: 1, medianSec: 180, totalSec: 180 + 300 });
    expect(summary.waiting.bins).toEqual([0, 0, 0, 2, 0, 0]);
    expect(summary.working.turns).toBe(7);
    expect(summary.working.longestTurnSec).toBe(600);
    // 0-2, 5-15 and 6-16 overlap from minute 6 to 15.
    expect(summary.working.minutesAtOnce[1]).toBe(10);
    expect(summary.messages.total).toBe(7);
    expect(summary.messages.byWeekdayHour[0]![4]).toBe(4);
  });

  it("counts shell calls, their failures, compactions and refused requests", () => {
    const bash = (minutes: number, command: string, success = true) =>
      line(minutes, "tool_result", { tool_name: "Bash", success, tool_parameters: JSON.stringify({ full_command: command }) });
    const summary = summarize([
      bash(0, "cd /repo && git status"), bash(1, "pnpm test | tail -5", false), bash(2, "git diff"),
      line(3, "compaction", {}), line(4, "api_error", { status_code: "429" }), line(5, "api_error", { status_code: 500 }),
    ]);

    expect(summary.shell).toEqual({ calls: 3, failed: 1, programs: [{ name: "git", count: 2 }, { name: "pnpm", count: 1 }, { name: "tail", count: 1 }] });
    expect(summary.behaviour).toMatchObject({ compactions: 1, rateLimited: 1 });
  });

  it("starts All at the first recorded day", () => {
    expect(summarize([request(0, {})], "all").days.map((day) => day.day)).toEqual(["2026-11-23"]);
    expect(summarize([], "all").days.map((day) => day.day)).toEqual(["2026-11-23"]);
  });
});

describe("shellPrograms", () => {
  it("names the programs of the first line only, without arguments, variables or shell words", () => {
    expect(shellPrograms(JSON.stringify({ full_command: "cd /x && FOO=1 env node a.js; for f in *; do cat $f; done | /usr/bin/grep -c x" }))).toEqual(["node", "cat", "grep"]);
    expect(shellPrograms(JSON.stringify({ full_command: "python3 - <<'EOF'\nimport os\nos.remove('x')\nEOF" }))).toEqual(["python3"]);
    expect(shellPrograms("not json")).toEqual([]);
  });
});

describe("readAgentEventLines", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads the day files of the period and skips lines it cannot use", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "alfred-analytics-"));
    const kept = JSON.stringify(request(0, {}));
    await writeFile(path.join(dir, "2026-11-23.jsonl"), [kept, "{\"cut", JSON.stringify({ event: "x" }), JSON.stringify(line(0, "hook_registered")), ""].join("\n"));
    await writeFile(path.join(dir, "2026-11-01.jsonl"), kept + "\n");
    await writeFile(path.join(dir, "notes.txt"), kept + "\n");

    expect(await readAgentEventLines(dir, "7d", NOW)).toHaveLength(1);
    expect(await readAgentEventLines(dir, "all", NOW)).toHaveLength(2);
    expect(await readAgentEventLines(path.join(dir, "missing"), "all", NOW)).toEqual([]);
  });
});
