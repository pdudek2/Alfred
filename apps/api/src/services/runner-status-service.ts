export type RunnerFreshnessState = "live" | "quiet" | "offline";

export type RunnerStatusInput = {
  now: Date;
  lastDeviceSeenAt: Date | null;
  lastIngestAt: Date | null;
  latestRunUpdatedAt: Date | null;
};

export type RunnerStatus = {
  state: RunnerFreshnessState;
  last_device_seen_at: string | null;
  last_ingest_at: string | null;
  latest_run_updated_at: string | null;
  seconds_since_last_ingest: number | null;
};

const LIVE_AFTER_MS = 60_000;

export function buildRunnerStatus(input: RunnerStatusInput): RunnerStatus {
  const lastIngestMs = input.lastIngestAt?.getTime() ?? null;
  const secondsSinceLastIngest =
    lastIngestMs === null ? null : Math.max(Math.floor((input.now.getTime() - lastIngestMs) / 1000), 0);

  let state: RunnerFreshnessState = "offline";
  if (input.lastDeviceSeenAt && input.lastIngestAt) {
    state = input.now.getTime() - input.lastIngestAt.getTime() <= LIVE_AFTER_MS ? "live" : "quiet";
  }

  return {
    state,
    last_device_seen_at: toIso(input.lastDeviceSeenAt),
    last_ingest_at: toIso(input.lastIngestAt),
    latest_run_updated_at: toIso(input.latestRunUpdatedAt),
    seconds_since_last_ingest: secondsSinceLastIngest,
  };
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
