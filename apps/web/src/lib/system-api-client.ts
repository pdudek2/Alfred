export type SystemStatus = {
  runner: {
    state: "live" | "quiet" | "offline";
    last_device_seen_at: string | null;
    last_ingest_at: string | null;
    latest_run_updated_at: string | null;
    seconds_since_last_device_seen: number | null;
    seconds_since_last_ingest: number | null;
  };
};

export async function getSystemStatus(fetchImpl: typeof fetch = fetch): Promise<SystemStatus> {
  const response = await fetchImpl("/api/v1/system/status", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`System status failed: ${response.status}`);
  }

  return (await response.json()) as SystemStatus;
}
