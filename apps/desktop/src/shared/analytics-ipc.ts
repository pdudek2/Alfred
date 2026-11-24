export type AnalyticsPeriod = "7d" | "30d" | "all";

export type AnalyticsRequest = { period: AnalyticsPeriod; timeZone: string };

export type AnalyticsTokens = { input: number; cacheWrite: number; cacheRead: number; output: number };

export type AnalyticsModel = {
  agent: "claude" | "codex";
  model: string;
  sessions: number;
  /** null: no API price on record (Codex, or a request through another provider). */
  costUsd: number | null;
  tokens: AnalyticsTokens;
  /** Some of its token counts were not recorded. */
  tokensPartial: boolean;
};

export type AnalyticsDay = { day: string; costUsd: Record<string, number>; tokens: Record<string, number> };

export type AnalyticsSummary = {
  recording: boolean;
  /** Local days in range, oldest first (YYYY-MM-DD). */
  days: AnalyticsDay[];
  sessions: number;
  costUsd: number;
  models: AnalyticsModel[];
  cost: { mainUsd: number; subagentsUsd: number; subagentRuns: number };
  waiting: { answered: number; away: number; medianSec: number | null; p90Sec: number | null; totalSec: number; bins: number[] };
  working: {
    turns: number;
    agentSec: number;
    medianTurnSec: number | null;
    p90TurnSec: number | null;
    longestTurnSec: number | null;
    /** Minutes with one, two, and three or more sessions working. */
    minutesAtOnce: [number, number, number];
  };
  /** Your messages by weekday (Monday first) and hour. */
  messages: { total: number; byWeekdayHour: number[][] };
  shell: { calls: number; failed: number; programs: Array<{ name: string; count: number }> };
  behaviour: {
    outputTokensPerSec: Array<{ model: string; value: number }>;
    firstTokenMs: number | null;
    compactions: number;
    rateLimited: number;
  };
};

/** Upper bounds of the Waiting on you bins, in seconds; the last bin is open. */
export const WAITING_BINS_SEC = [30, 60, 180, 600, 1800] as const;

export const analyticsChannels = {
  summary: "alfred:analytics:summary",
} as const;

export type AnalyticsChannels = typeof analyticsChannels;

export type AnalyticsApi = {
  summary(request: AnalyticsRequest): Promise<AnalyticsSummary>;
};
