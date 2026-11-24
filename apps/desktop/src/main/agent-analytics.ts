import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  WAITING_BINS_SEC,
  type AnalyticsDay,
  type AnalyticsModel,
  type AnalyticsPeriod,
  type AnalyticsSummary,
} from "../shared/analytics-ipc.js";

/** One line of the agent event log (agent-events.ts). */
export type AnalyticsLine = {
  agent: "claude" | "codex";
  at: string;
  attributes: Record<string, unknown>;
  event: string;
  session: string;
};

type SummaryOptions = { now: number; period: AnalyticsPeriod; timeZone: string; recording: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<Exclude<AnalyticsPeriod, "all">, number> = { "7d": 7, "30d": 30 };
/** A reply later than this means you were away, not slow. */
const AWAY_SEC = 4 * 60 * 60;
/** A turn longer than this lost its end. */
const LONGEST_TURN_SEC = 6 * 60 * 60;
/** About a third of the log is the agents' own start-up chatter, which nothing here reads. */
const UNREAD_EVENT = /"event":"(?:hook_execution_complete|hook_registered|hook_plugin_metrics|plugin_loaded|mcp_server_connection|managed_settings_resolved)"/;
/** Words before the program in a command: `do cat x`, `env FOO=1 node`. */
const LEADING_WORDS = new Set(["do", "then", "else", "env", "time", "exec", "!", "{", "("]);
const SKIPPED_PROGRAMS = new Set([
  "cd", "export", "echo", "true", "set", "source", "do", "done", "then", "else", "elif", "fi", "if", "for", "while", "until",
  "case", "esac", "in", "function", "local", "return", "break", "continue",
]);

/** The day files that can hold events of the period: they are named by UTC date, so one more day on each side. */
export async function readAgentEventLines(dir: string, period: AnalyticsPeriod, now: number): Promise<AnalyticsLine[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const first = period === "all" ? "" : new Date(now - (PERIOD_DAYS[period] + 1) * DAY_MS).toISOString().slice(0, 10);
  const last = new Date(now + DAY_MS).toISOString().slice(0, 10);
  const lines: AnalyticsLine[] = [];
  for (const name of names.sort()) {
    const day = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)?.[1];
    if (!day || day < first || day > last) continue;
    // shortcut: every open reads and parses the files again (59 MB took 65–190 ms); cache per file past ~300 ms.
    const text = await readFile(path.join(dir, name), "utf8").catch(() => "");
    for (const raw of text.split("\n")) {
      if (!raw || UNREAD_EVENT.test(raw)) continue;
      try {
        const line: unknown = JSON.parse(raw);
        if (isLine(line)) lines.push(line);
      } catch {
        // A line cut short by a crash.
      }
    }
  }
  return lines;
}

export function summarizeAgentEvents(lines: AnalyticsLine[], options: SummaryOptions): AnalyticsSummary {
  const clock = localClock(options.timeZone);
  const events = lines
    .map((line) => ({ line, at: Date.parse(line.at) }))
    .filter(({ at }) => Number.isFinite(at) && at <= options.now)
    .sort((a, b) => a.at - b.at);
  const today = clock(options.now).day;
  const firstDay = options.period === "all"
    ? (events[0] ? clock(events[0].at).day : today)
    : clock(options.now - (PERIOD_DAYS[options.period] - 1) * DAY_MS).day;
  const days = dayRange(firstDay, today);
  const dayIndex = new Map(days.map((day, index) => [day.day, index]));

  const workers = new Set(events.filter(({ line }) => line.event === "alfred.worker_started").map(({ line }) => line.session));
  const models = new Map<string, AnalyticsModel & { sessionIds: Set<string> }>();
  const sessions = new Set<string>();
  const cost = { mainUsd: 0, subagentsUsd: 0, subagentRuns: 0 };
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let messages = 0;
  const waits: number[] = [];
  let away = 0;
  const turns: Array<[number, number]> = [];
  const open = new Map<string, { start: number; lastMain?: number }>();
  const stoppedAt = new Map<string, number>();
  const shell = { calls: 0, failed: 0, programs: new Map<string, number>() };
  const speeds = new Map<string, number[]>();
  const firstTokens: number[] = [];
  let compactions = 0;
  let rateLimited = 0;

  const modelFor = (agent: AnalyticsLine["agent"], name: string, priced: boolean) => {
    const key = `${agent}:${name}`;
    let model = models.get(key);
    if (!model) {
      model = {
        agent, model: name, sessions: 0, costUsd: priced ? 0 : null,
        tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, tokensPartial: false, sessionIds: new Set(),
      };
      models.set(key, model);
    }
    if (!priced) model.costUsd = null;
    return model;
  };
  const closeTurn = (session: string, end: number | undefined) => {
    const turn = open.get(session);
    open.delete(session);
    if (!turn || end === undefined) return;
    const seconds = (end - turn.start) / 1000;
    if (seconds >= 0 && seconds <= LONGEST_TURN_SEC) turns.push([turn.start, end]);
  };

  for (const { line, at } of events) {
    const local = clock(at);
    const index = dayIndex.get(local.day);
    if (index === undefined) continue;
    const day = days[index]!;
    const attributes = line.attributes;
    const mainThread = attributes["agent_id"] === undefined;

    if (line.event === "api_request" || (line.event === "codex.sse_event" && attributes["event.kind"] === "response.completed")) {
      const codex = line.event === "codex.sse_event";
      const name = String(attributes["model"] ?? attributes["slug"] ?? "unknown");
      const priced = !codex && attributes["anthropic.custom_base_url"] !== true && attributes["anthropic.custom_base_url"] !== "true";
      const model = modelFor(line.agent, name, priced);
      const counts = codex
        ? codexTokens(attributes)
        : [count(attributes["input_tokens"]), count(attributes["cache_creation_tokens"]), count(attributes["cache_read_tokens"]), count(attributes["output_tokens"])];
      const [input, cacheWrite, cacheRead, output] = counts;
      if (counts.some((value) => value === undefined)) model.tokensPartial = true;
      model.tokens.input += input ?? 0;
      model.tokens.cacheWrite += cacheWrite ?? 0;
      model.tokens.cacheRead += cacheRead ?? 0;
      model.tokens.output += output ?? 0;
      const tokens = (input ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0) + (output ?? 0);
      day.tokens[name] = (day.tokens[name] ?? 0) + tokens;
      model.sessionIds.add(line.session);
      sessions.add(line.session);
      const usd = priced ? count(attributes["cost_usd"]) ?? 0 : 0;
      if (priced && model.costUsd !== null) model.costUsd += usd;
      if (priced) {
        day.costUsd[name] = (day.costUsd[name] ?? 0) + usd;
        if (mainThread) cost.mainUsd += usd;
        else cost.subagentsUsd += usd;
      }
      if (!codex && mainThread && attributes["query_source"] === "repl_main_thread") {
        const turn = open.get(line.session);
        if (turn) turn.lastMain = at;
        const ttft = count(attributes["ttft_ms"]);
        const duration = count(attributes["duration_ms"]);
        const outputTokens = output ?? 0;
        if (ttft !== undefined && ttft > 0) firstTokens.push(ttft);
        if (ttft !== undefined && duration !== undefined && outputTokens > 200 && duration > ttft) {
          const list = speeds.get(name) ?? [];
          list.push(outputTokens / ((duration - ttft) / 1000));
          speeds.set(name, list);
        }
      }
      continue;
    }

    if (line.event === "user_prompt" || line.event === "codex.user_prompt") {
      if (attributes["command_name"] !== undefined) continue;
      sessions.add(line.session);
      const yours = !workers.has(line.session);
      if (yours) {
        messages += 1;
        heat[local.weekday]![local.hour]! += 1;
      }
      if (line.event === "codex.user_prompt" || attributes["delivery.mode"] === "mid_turn") continue;
      const turn = open.get(line.session);
      // No Stop since the last message: Esc, a rejection or a local command ended that turn at its last step.
      if (turn) closeTurn(line.session, turn.lastMain);
      open.set(line.session, { start: at });
      const stopped = stoppedAt.get(line.session);
      stoppedAt.delete(line.session);
      if (stopped !== undefined && yours) {
        const seconds = (at - stopped) / 1000;
        if (seconds > AWAY_SEC) away += 1;
        else waits.push(seconds);
      }
      continue;
    }

    if (line.event === "hook_execution_start" && attributes["hook_event"] === "Stop" && mainThread) {
      closeTurn(line.session, at);
      stoppedAt.set(line.session, at);
      continue;
    }

    if (line.event === "tool_result") {
      if (mainThread) {
        const turn = open.get(line.session);
        if (turn) turn.lastMain = at;
      }
      if (attributes["tool_name"] !== "Bash") continue;
      shell.calls += 1;
      if (attributes["success"] === false || attributes["success"] === "false") shell.failed += 1;
      for (const program of shellPrograms(attributes["tool_parameters"])) {
        shell.programs.set(program, (shell.programs.get(program) ?? 0) + 1);
      }
      continue;
    }

    if (line.event === "subagent_completed") cost.subagentRuns += 1;
    else if (line.event === "compaction") compactions += 1;
    else if (line.event === "api_error" && String(attributes["status_code"]) === "429") rateLimited += 1;
  }
  for (const [session, turn] of open) closeTurn(session, turn.lastMain);

  const atOnce = new Map<number, number>();
  for (const [start, end] of turns) {
    for (let minute = Math.ceil(start / 60_000); minute <= Math.floor(end / 60_000); minute += 1) {
      atOnce.set(minute, (atOnce.get(minute) ?? 0) + 1);
    }
  }
  const minutesAtOnce: [number, number, number] = [0, 0, 0];
  for (const working of atOnce.values()) minutesAtOnce[Math.min(working, 3) - 1]! += 1;
  const turnSeconds = turns.map(([start, end]) => (end - start) / 1000).sort((a, b) => a - b);
  waits.sort((a, b) => a - b);

  const modelList = [...models.values()]
    .map(({ sessionIds, ...model }) => ({ ...model, sessions: sessionIds.size }))
    .sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1) || totalTokens(b) - totalTokens(a));
  return {
    recording: options.recording,
    days,
    sessions: sessions.size,
    costUsd: modelList.reduce((sum, model) => sum + (model.costUsd ?? 0), 0),
    models: modelList,
    cost,
    waiting: {
      answered: waits.length,
      away,
      medianSec: quantile(waits, 0.5),
      p90Sec: quantile(waits, 0.9),
      totalSec: waits.reduce((sum, seconds) => sum + seconds, 0),
      bins: [...WAITING_BINS_SEC, Infinity].map((upper, index) =>
        waits.filter((seconds) => seconds < upper && seconds >= (index === 0 ? 0 : WAITING_BINS_SEC[index - 1]!)).length),
    },
    working: {
      turns: turns.length,
      agentSec: atOnce.size * 60,
      medianTurnSec: quantile(turnSeconds, 0.5),
      p90TurnSec: quantile(turnSeconds, 0.9),
      longestTurnSec: turnSeconds.at(-1) ?? null,
      minutesAtOnce,
    },
    messages: { total: messages, byWeekdayHour: heat },
    shell: {
      calls: shell.calls,
      failed: shell.failed,
      programs: [...shell.programs].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    },
    behaviour: {
      outputTokensPerSec: [...speeds]
        .map(([model, values]) => ({ model, value: quantile(values.sort((a, b) => a - b), 0.5)! }))
        .sort((a, b) => b.value - a.value),
      firstTokenMs: quantile(firstTokens.sort((a, b) => a - b), 0.5),
      compactions,
      rateLimited,
    },
  };
}

/** The programs one shell call ran: names only, never their arguments. */
export function shellPrograms(parameters: unknown): string[] {
  let command: unknown;
  try {
    command = typeof parameters === "string" ? (JSON.parse(parameters) as Record<string, unknown>)["full_command"] : undefined;
  } catch {
    return [];
  }
  if (typeof command !== "string") return [];
  // A heredoc's body is the program's input, not more commands.
  const firstLine = command.split("\n", 1)[0]!;
  const programs = new Set<string>();
  for (const part of firstLine.split(/&&|\|\||;|\|/)) {
    const words = part.trim().split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    while (words.length > 0 && LEADING_WORDS.has(words[0]!)) words.shift();
    const program = words[0]?.split("/").at(-1);
    if (program && /^[a-z][\w.+-]*$/.test(program) && !SKIPPED_PROGRAMS.has(program)) programs.add(program);
  }
  return [...programs];
}

function codexTokens(attributes: Record<string, unknown>): Array<number | undefined> {
  const input = count(attributes["input_token_count"]);
  const cached = count(attributes["cached_token_count"]);
  // OpenAI counts cached tokens inside the input.
  return [input === undefined || cached === undefined ? undefined : Math.max(0, input - cached), 0, cached, count(attributes["output_token_count"])];
}

function count(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function totalTokens(model: AnalyticsModel): number {
  return model.tokens.input + model.tokens.cacheWrite + model.tokens.cacheRead + model.tokens.output;
}

function quantile(sorted: number[], q: number): number | null {
  return sorted.length === 0 ? null : sorted[Math.floor(q * (sorted.length - 1))]!;
}

function localClock(timeZone: string): (at: number) => { day: string; weekday: number; hour: number } {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23",
  });
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Every time zone's offset is a whole number of quarter hours, so a quarter hour has one local day and hour.
  const quarters = new Map<number, { day: string; weekday: number; hour: number }>();
  return (at) => {
    const quarter = Math.floor(at / 900_000);
    let local = quarters.get(quarter);
    if (!local) {
      const parts = Object.fromEntries(format.formatToParts(quarter * 900_000).map((part) => [part.type, part.value]));
      local = { day: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, weekday: weekdays.indexOf(parts["weekday"]!), hour: Number(parts["hour"]) };
      quarters.set(quarter, local);
    }
    return local;
  };
}

function dayRange(first: string, last: string): AnalyticsDay[] {
  const days: AnalyticsDay[] = [];
  for (let at = Date.parse(`${first}T12:00:00Z`); new Date(at).toISOString().slice(0, 10) <= last; at += DAY_MS) {
    days.push({ day: new Date(at).toISOString().slice(0, 10), costUsd: {}, tokens: {} });
  }
  return days;
}

function isLine(value: unknown): value is AnalyticsLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (line["agent"] === "claude" || line["agent"] === "codex")
    && typeof line["at"] === "string"
    && typeof line["event"] === "string"
    && typeof line["session"] === "string"
    && !!line["attributes"] && typeof line["attributes"] === "object";
}
