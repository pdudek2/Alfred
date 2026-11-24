import { trustedIpc } from "./trusted-ipc.js";
import { readAgentEventLines, summarizeAgentEvents } from "./agent-analytics.js";
import { analyticsChannels, type AnalyticsPeriod, type AnalyticsSummary } from "../shared/analytics-ipc.js";

type AnalyticsIpcOptions = { dir: string; isRecording: () => boolean; now?: () => number };

const PERIODS: ReadonlySet<string> = new Set<AnalyticsPeriod>(["7d", "30d", "all"]);

export function registerAnalyticsIpc(options: AnalyticsIpcOptions): void {
  trustedIpc.handle(analyticsChannels.summary, async (_event, request: unknown): Promise<AnalyticsSummary> => {
    const { period, timeZone } = (request ?? {}) as { period?: unknown; timeZone?: unknown };
    if (typeof period !== "string" || !PERIODS.has(period)) throw new Error("Invalid analytics request.");
    const now = options.now?.() ?? Date.now();
    const lines = await readAgentEventLines(options.dir, period as AnalyticsPeriod, now);
    return summarizeAgentEvents(lines, { now, period: period as AnalyticsPeriod, timeZone: knownTimeZone(timeZone), recording: options.isRecording() });
  });
}

function knownTimeZone(value: unknown): string {
  if (typeof value !== "string") return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}
