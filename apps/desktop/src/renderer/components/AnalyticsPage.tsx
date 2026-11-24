import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type AnalyticsApi, type AnalyticsModel, type AnalyticsPeriod, type AnalyticsSummary } from "../../shared/analytics-ipc";
import { TileKindIcon } from "../tile-kind-icon";
import "./analytics.css";

type AnalyticsPageProps = {
  api: AnalyticsApi | null;
  onLeave: () => void;
};

type Measure = "cost" | "tokens";

const PERIODS: Array<{ id: AnalyticsPeriod; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All" },
];
const CLAUDE_COLORS = ["#D97757", "#F2C3A6", "#B98A74", "#8E8E97"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WAITING_LABELS = ["<30 s", "30–60 s", "1–3 min", "3–10 min", "10–30 min", "30 min+"];

/** Analytics is a surface beside Deck and History: what the agent event log says about the period. */
export function AnalyticsPage({ api, onLeave }: AnalyticsPageProps) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const [measure, setMeasure] = useState<Measure>("cost");
  const [breakdown, setBreakdown] = useState<"model" | "day">("model");
  const [result, setResult] = useState<{ period: AnalyticsPeriod; summary?: AnalyticsSummary; error?: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!api) return;
    let current = true;
    api.summary({ period, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(
      (summary) => current && setResult({ period, summary }),
      () => current && setResult({ period, error: "Alfred could not read its agent event log." }),
    );
    return () => {
      current = false;
    };
  }, [api, period]);

  const summary = result?.summary;
  const stale = result?.period !== period;
  const empty = summary !== undefined && summary.models.length === 0 && summary.messages.total === 0;
  const colors = modelColors(summary?.models ?? []);

  return (
    <section
      className="analytics-page"
      aria-label="Analytics"
      aria-busy={stale || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onLeave();
      }}
    >
      <header className="analytics-header">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>Analytics</h1>
          <p>{summary ? `Sessions Alfred ran · ${rangeLabel(summary)}` : "Sessions Alfred ran"}</p>
        </div>
        <div className="analytics-controls">
          <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
          <Segmented label="Measure" options={[{ id: "cost", label: "Cost" }, { id: "tokens", label: "Tokens" }]} value={measure} onChange={setMeasure} />
        </div>
      </header>

      {summary && !summary.recording && (
        <p className="analytics-note">Recording is off. Alfred records agent events only while it saves terminal data, in Settings.</p>
      )}
      {result?.error && <p className="analytics-note">{result.error}</p>}
      {empty && <p className="analytics-note">No agent sessions were recorded in this period.</p>}

      {summary && !empty && (
        <div className={stale ? "analytics-body stale" : "analytics-body"}>
          <section className="analytics-spend" aria-label="Spend">
            <div className="analytics-spend-list">
              <div>
                <div className="analytics-total">{measure === "cost" ? usd(summary.costUsd) : tokens(totalTokens(summary.models))}</div>
                <p className="analytics-meta">
                  {measure === "cost" ? "At API prices · your plan covers it" : "Processed tokens"} · {count(summary.sessions, "session")}
                </p>
              </div>
              {summary.models.map((model) => (
                <div key={`${model.agent}:${model.model}`} className="analytics-model">
                  <dl>
                    <dt>
                      <span className="analytics-dot" style={{ background: colors.get(model.model) }} aria-hidden="true" />
                      <TileKindIcon kind={modelKind(model)} />
                      <span>{modelLabel(model.model)}</span>
                      <span className="analytics-faint">{count(model.sessions, "session")}</span>
                    </dt>
                    <dd className={model.costUsd === null && measure === "cost" ? "analytics-faint" : undefined}>
                      {measure === "cost" ? (model.costUsd === null ? "Unpriced" : usd(model.costUsd)) : tokens(modelTokens(model))}
                    </dd>
                  </dl>
                  <p className="analytics-meta">{modelNote(model, summary, measure)}</p>
                </div>
              ))}
            </div>
            <div className="analytics-chart">
              <h2>{measure === "cost" ? "Daily cost" : "Daily tokens"}</h2>
              <DailyChart summary={summary} measure={measure} colors={colors} />
            </div>
          </section>

          <section className="analytics-section" aria-label="Totals">
            <h2>Totals</h2>
            <dl className="analytics-metrics five">
              <Metric label="Processed tokens" value={tokens(totalTokens(summary.models))} />
              <Metric label="Cached input" value={tokens(sum(summary.models, "cacheRead"))} />
              <Metric label="Uncached input" value={tokens(sum(summary.models, "input") + sum(summary.models, "cacheWrite"))} note={`incl. ${tokens(sum(summary.models, "cacheWrite"))} cache writes`} />
              <Metric label="Output" value={tokens(sum(summary.models, "output"))} />
              <Metric label="Cache hit" value={percent(cacheHit(summary.models))} note="of input read from cache" />
            </dl>
          </section>

          <section className="analytics-shares" aria-label="Shares">
            <ShareBar
              label="Tokens by type"
              segments={[
                { label: "Cached input", value: sum(summary.models, "cacheRead"), color: "#D97757", text: tokens(sum(summary.models, "cacheRead")) },
                { label: "Cache write", value: sum(summary.models, "cacheWrite"), color: "#E8B08F", text: tokens(sum(summary.models, "cacheWrite")) },
                { label: "Input", value: sum(summary.models, "input"), color: "#9A9AA3", text: tokens(sum(summary.models, "input")) },
                { label: "Output", value: sum(summary.models, "output"), color: "var(--text-primary)", text: tokens(sum(summary.models, "output")) },
              ]}
            />
            <ShareBar
              label="Cost: your sessions and their subagents"
              segments={[
                { label: "Main sessions", value: summary.cost.mainUsd, color: "#D97757", text: usd(summary.cost.mainUsd) },
                { label: count(summary.cost.subagentRuns, "subagent"), value: summary.cost.subagentsUsd, color: "#C6A6FF", text: usd(summary.cost.subagentsUsd) },
              ]}
            />
          </section>

          <section className="analytics-section" aria-label="Breakdown">
            <div className="analytics-section-head">
              <h2>Breakdown</h2>
              <Segmented label="Breakdown by" options={[{ id: "model", label: "Model" }, { id: "day", label: "Day" }]} value={breakdown} onChange={setBreakdown} />
            </div>
            {breakdown === "model" ? <ModelTable summary={summary} measure={measure} colors={colors} /> : <DayTable summary={summary} />}
          </section>

          <div className="analytics-part">
            <h2>You and your agents</h2>
            <p>What only Alfred sees: how long agents wait for you, how many run at once, and what they do.</p>
          </div>
          <div className="analytics-cards">
            <WaitingCard summary={summary} />
            <WorkingCard summary={summary} />
            <HeatCard summary={summary} />
            <ShellCard summary={summary} />
          </div>
          <section className="analytics-card" aria-label="Model behaviour">
            <h2>Model behaviour</h2>
            <dl className="analytics-metrics five">
              {summary.models.flatMap((model) => summary.behaviour.outputTokensPerSec.filter((speed) => speed.model === model.model)).slice(0, 2).map((speed) => (
                <Metric key={speed.model} label={modelLabel(speed.model)} value={`${Math.round(speed.value)} tok/s`} note="output speed" />
              ))}
              <Metric label="First token" value={summary.behaviour.firstTokenMs === null ? "–" : `${(summary.behaviour.firstTokenMs / 1000).toFixed(1)} s`} note="median" />
              <Metric label="Compactions" value={String(summary.behaviour.compactions)} note="context squeezed" />
              <Metric label="Rate limits" value={String(summary.behaviour.rateLimited)} note="requests refused" />
            </dl>
          </section>
        </div>
      )}
    </section>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="analytics-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <dd className="analytics-meta">{note}</dd>}
    </div>
  );
}

function ShareBar({ label, segments }: { label: string; segments: Array<{ label: string; value: number; color: string; text: string }> }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="analytics-share">
      <h2>{label}</h2>
      <div className="analytics-share-bar" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.label} style={{ flexBasis: `max(4px, ${total > 0 ? (segment.value / total) * 100 : 0}%)`, background: segment.color }} />
        ))}
      </div>
      <ul aria-label={label}>
        {segments.map((segment) => (
          <li key={segment.label}>
            <span className="analytics-swatch" style={{ background: segment.color }} aria-hidden="true" />
            <span className="analytics-faint">{segment.label}</span>
            <span>{segment.text}{total > 0 && segment.value / total >= 0.01 ? ` · ${percent(segment.value / total)}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DailyChart({ summary, measure, colors }: { summary: AnalyticsSummary; measure: Measure; colors: Map<string, string> }) {
  const shown = summary.models.filter((model) => measure === "tokens" || model.costUsd !== null).slice(0, 4);
  const values = (model: string) => summary.days.map((day) => (measure === "cost" ? day.costUsd : day.tokens)[model] ?? 0);
  const peak = Math.max(0, ...shown.flatMap((model) => values(model.model)));
  const step = niceStep(peak / 3);
  const top = step * 3 || 1;
  const width = 760;
  const left = 52;
  const right = 744;
  const bottom = 170;
  const x = (index: number) => left + (summary.days.length < 2 ? (right - left) / 2 : (index * (right - left)) / (summary.days.length - 1));
  const y = (value: number) => bottom - (value / top) * 150;
  const every = Math.ceil(summary.days.length / 8);
  const best = shown[0];
  return (
    <svg
      className="analytics-chart-svg"
      viewBox={`0 0 ${width} 200`}
      role="img"
      aria-label={best
        ? `${measure === "cost" ? "Daily cost" : "Daily tokens"} by model; ${modelLabel(best.model)} leads with ${measure === "cost" ? usd(best.costUsd ?? 0) : tokens(modelTokens(best))}.`
        : "No activity in this period."}
    >
      {[0, 1, 2, 3].map((line) => (
        <g key={line}>
          <line x1={left} x2={right} y1={y(line * step)} y2={y(line * step)} className="analytics-grid" />
          <text x={left - 8} y={y(line * step) + 4} textAnchor="end">{measure === "cost" ? usd(line * step, true) : tokens(line * step)}</text>
        </g>
      ))}
      {shown.map((model) => {
        const points = values(model.model).map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
        const color = colors.get(model.model);
        return (
          <g key={model.model}>
            <path d={`M${x(0)},${bottom} L${points.join(" L")} L${x(summary.days.length - 1)},${bottom} Z`} fill={color} fillOpacity={0.12} />
            <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
          </g>
        );
      })}
      {summary.days.map((day, index) => (index % every === 0 || index === summary.days.length - 1) && (
        <text key={day.day} x={x(index)} y={192} textAnchor="middle" className={index === summary.days.length - 1 ? "today" : undefined}>
          {dayLabel(day.day)}
        </text>
      ))}
    </svg>
  );
}

function ModelTable({ summary, measure, colors }: { summary: AnalyticsSummary; measure: Measure; colors: Map<string, string> }) {
  const value = (model: AnalyticsModel) => (measure === "cost" ? model.costUsd ?? 0 : modelTokens(model));
  const peak = Math.max(0, ...summary.models.map(value));
  return (
    <table className="analytics-table">
      <thead>
        <tr><th scope="col">#</th><th scope="col" className="wide">Model</th><th scope="col">Cost</th><th scope="col">Share</th><th scope="col">Tokens</th></tr>
      </thead>
      <tbody>
        {summary.models.map((model, index) => (
          <tr key={`${model.agent}:${model.model}`}>
            <td className="analytics-faint">{index + 1}</td>
            <td className="wide">
              <span className="analytics-table-model"><TileKindIcon kind={modelKind(model)} />{modelLabel(model.model)}</span>
              {peak > 0 && value(model) > 0 && (
                <span className="analytics-table-bar" aria-hidden="true">
                  <span style={{ width: `max(6px, ${(value(model) / peak) * 100}%)`, background: colors.get(model.model) }} />
                </span>
              )}
            </td>
            <td className={model.costUsd === null ? "analytics-faint" : undefined}>{model.costUsd === null ? "Unpriced" : usd(model.costUsd)}</td>
            <td className="analytics-faint">{model.costUsd === null || summary.costUsd === 0 ? "" : percent(model.costUsd / summary.costUsd)}</td>
            <td className="analytics-faint">{tokens(modelTokens(model))}{model.tokensPartial ? "+" : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayTable({ summary }: { summary: AnalyticsSummary }) {
  return (
    <table className="analytics-table">
      <thead>
        <tr><th scope="col" className="wide">Day</th><th scope="col">Cost</th><th scope="col">Tokens</th></tr>
      </thead>
      <tbody>
        {[...summary.days].reverse().map((day) => (
          <tr key={day.day}>
            <td className="wide">{dayLabel(day.day)}</td>
            <td>{usd(Object.values(day.costUsd).reduce((total, value) => total + value, 0))}</td>
            <td className="analytics-faint">{tokens(Object.values(day.tokens).reduce((total, value) => total + value, 0))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WaitingCard({ summary }: { summary: AnalyticsSummary }) {
  const { waiting } = summary;
  const peak = Math.max(1, ...waiting.bins);
  return (
    <section className="analytics-card" aria-label="Waiting on you">
      <div className="analytics-section-head"><h2>Waiting on you</h2><span className="analytics-faint">{count(waiting.answered + waiting.away, "turn end")}</span></div>
      <dl className="analytics-metrics three">
        <Metric label="Typical reply" value={duration(waiting.medianSec)} note="median" />
        <Metric label="Slow replies" value={duration(waiting.p90Sec)} note="1 in 10 slower" />
        <Metric label="Agents idle" value={duration(waiting.totalSec)} note="waiting for you" />
      </dl>
      <ul className="analytics-bars" aria-label="Replies by time to answer">
        {waiting.bins.map((value, index) => (
          <li key={WAITING_LABELS[index]}>
            <span className="analytics-faint">{WAITING_LABELS[index]}</span>
            <span className="analytics-bar you" aria-hidden="true" style={{ width: `${(value / peak) * 100}%`, opacity: 0.35 + 0.65 * (value / peak) }} />
            <span>{value}</span>
          </li>
        ))}
      </ul>
      <p className="analytics-meta">
        From a turn's end to your next message.{waiting.away > 0 ? ` ${count(waiting.away, "gap")} over 4 h count as away.` : ""}
      </p>
    </section>
  );
}

function WorkingCard({ summary }: { summary: AnalyticsSummary }) {
  const { working } = summary;
  const minutes = working.minutesAtOnce.reduce((total, value) => total + value, 0);
  const levels = [
    { label: "1 session", value: working.minutesAtOnce[0], alpha: 0.45 },
    { label: "2 at once", value: working.minutesAtOnce[1], alpha: 0.75 },
    { label: "3 or more", value: working.minutesAtOnce[2], alpha: 1 },
  ].filter((level) => level.value > 0);
  return (
    <section className="analytics-card" aria-label="Agents working">
      <div className="analytics-section-head"><h2>Agents working</h2><span className="analytics-faint">{count(working.turns, "turn")}</span></div>
      <dl className="analytics-metrics three">
        <Metric label="Agent time" value={duration(working.agentSec)} note="some session working" />
        <Metric label="Typical turn" value={duration(working.medianTurnSec)} note={`median · 1 in 10 over ${duration(working.p90TurnSec)}`} />
        <Metric label="Longest turn" value={duration(working.longestTurnSec)} />
      </dl>
      <div className="analytics-share">
        <span className="analytics-faint">Sessions working at once</span>
        <div className="analytics-share-bar" aria-hidden="true">
          {levels.map((level) => (
            <span key={level.label} style={{ flexBasis: `max(4px, ${minutes > 0 ? (level.value / minutes) * 100 : 0}%)`, background: `rgba(240, 240, 242, ${level.alpha})` }} />
          ))}
        </div>
        <ul aria-label="Sessions working at once">
          {levels.map((level) => (
            <li key={level.label}>
              <span className="analytics-swatch" style={{ background: `rgba(240, 240, 242, ${level.alpha})` }} aria-hidden="true" />
              <span className="analytics-faint">{level.label}</span>
              <span>{duration(level.value * 60)}{minutes > 0 ? ` · ${percent(level.value / minutes)}` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="analytics-meta">A turn runs from your message to the agent's stop.</p>
    </section>
  );
}

function HeatCard({ summary }: { summary: AnalyticsSummary }) {
  const { byWeekdayHour, total } = summary.messages;
  const peak = Math.max(1, ...byWeekdayHour.flat());
  const busiestDay = byWeekdayHour.map((hours, index) => ({ index, total: hours.reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total)[0];
  const busiest = byWeekdayHour.flatMap((hours, day) => hours.map((value, hour) => ({ day, hour, value }))).sort((a, b) => b.value - a.value)[0];
  const sentence = total === 0 || !busiest || !busiestDay
    ? "No messages from you in this period."
    : `Busiest on ${WEEKDAYS[busiestDay.index]}, ${count(busiestDay.total, "message")}; busiest hour ${WEEKDAYS[busiest.day]} ${String(busiest.hour).padStart(2, "0")}:00.`;
  return (
    <section className="analytics-card" aria-label="When you work">
      <div className="analytics-section-head"><h2>When you work</h2><span className="analytics-faint">{count(total, "message")}</span></div>
      <div className="analytics-heat" role="img" aria-label={`Your messages by weekday and hour. ${sentence}`}>
        {byWeekdayHour.map((hours, day) => [
          <span key={`d${day}`} className="analytics-faint">{WEEKDAYS[day]}</span>,
          ...hours.map((value, hour) => (
            <span key={`${day}-${hour}`} className="analytics-heat-cell" style={value > 0 ? { background: "var(--signal)", opacity: 0.22 + 0.78 * (value / peak) } : undefined} />
          )),
        ])}
        <span />
        {Array.from({ length: 24 }, (_, hour) => <span key={`h${hour}`} className="analytics-heat-hour">{hour % 6 === 0 ? hour : ""}</span>)}
      </div>
      <p className="analytics-meta">{sentence}</p>
    </section>
  );
}

function ShellCard({ summary }: { summary: AnalyticsSummary }) {
  const { shell } = summary;
  const peak = Math.max(1, ...shell.programs.map((program) => program.count));
  return (
    <section className="analytics-card" aria-label="What agents run">
      <div className="analytics-section-head">
        <h2>What agents run</h2>
        <span className="analytics-faint">{count(shell.calls, "shell call")} · {shell.failed} failed</span>
      </div>
      <ul className="analytics-programs" aria-label="Programs in shell calls">
        {shell.programs.map((program) => (
          <li key={program.name}>
            <code>{program.name}</code>
            <span className="analytics-bar shell" aria-hidden="true" style={{ width: `${(program.count / peak) * 100}%` }} />
            <span className="analytics-faint">{program.count.toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
      <p className="analytics-meta">Program names only, never arguments or paths. One call can run several.</p>
    </section>
  );
}

function modelColors(models: AnalyticsModel[]): Map<string, string> {
  const colors = new Map<string, string>();
  let claude = 0;
  for (const model of models) {
    const kind = modelKind(model);
    colors.set(model.model, kind === "codex" ? "#B4BBFF" : kind === "deepseek" ? "#6F86FF" : CLAUDE_COLORS[Math.min(claude++, CLAUDE_COLORS.length - 1)]!);
  }
  return colors;
}

function modelKind(model: AnalyticsModel): "claude" | "codex" | "deepseek" {
  if (model.agent === "codex") return "codex";
  return model.model.startsWith("deepseek") ? "deepseek" : "claude";
}

/** claude-opus-5-5 → Opus 5.5, deepseek-flash → DeepSeek Flash; other names as the agent wrote them. */
export function modelLabel(model: string): string {
  const claude = /^claude-([a-z]+)-(\d+(?:-\d+)*)/.exec(model);
  if (claude) return `${claude[1]![0]!.toUpperCase()}${claude[1]!.slice(1)} ${claude[2]!.replaceAll("-", ".")}`;
  const deepSeek = /^deepseek-([a-z]+)/.exec(model);
  if (deepSeek) return `DeepSeek ${deepSeek[1]![0]!.toUpperCase()}${deepSeek[1]!.slice(1)}`;
  return model;
}

function modelNote(model: AnalyticsModel, summary: AnalyticsSummary, measure: Measure): string {
  const modelTotal = modelTokens(model);
  if (model.costUsd === null) return `${tokens(modelTotal)}${model.tokensPartial ? "+" : ""} tokens · no API price on record`;
  if (measure === "tokens") return `${percent(modelTotal / Math.max(1, totalTokens(summary.models)))} of tokens · ${usd(model.costUsd)}`;
  return `${percent(model.costUsd / Math.max(Number.EPSILON, summary.costUsd))} of cost · ${tokens(modelTotal)} tokens`;
}

function modelTokens(model: AnalyticsModel): number {
  return model.tokens.input + model.tokens.cacheWrite + model.tokens.cacheRead + model.tokens.output;
}

function totalTokens(models: AnalyticsModel[]): number {
  return models.reduce((total, model) => total + modelTokens(model), 0);
}

function sum(models: AnalyticsModel[], key: keyof AnalyticsModel["tokens"]): number {
  return models.reduce((total, model) => total + model.tokens[key], 0);
}

function cacheHit(models: AnalyticsModel[]): number {
  const input = sum(models, "input") + sum(models, "cacheWrite") + sum(models, "cacheRead");
  return input === 0 ? 0 : sum(models, "cacheRead") / input;
}

function rangeLabel(summary: AnalyticsSummary): string {
  const first = summary.days[0]?.day;
  const last = summary.days.at(-1)?.day;
  if (!first || !last) return "";
  return first === last ? dayLabel(first) : `${dayLabel(first)} – ${dayLabel(last)}`;
}

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[(date.getUTCDay() + 6) % 7]} ${date.getUTCDate()}`;
}

export function usd(value: number, axis = false): string {
  if (axis || value >= 1000) return `$${Math.round(value).toLocaleString("en-US")}`;
  return `$${value.toFixed(2)}`;
}

export function tokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

function percent(value: number): string {
  return value > 0 && value < 0.01 ? "<1%" : `${Math.round(value * 100)}%`;
}

export function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 36_000) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}

function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value) ?? 10) * magnitude;
}
