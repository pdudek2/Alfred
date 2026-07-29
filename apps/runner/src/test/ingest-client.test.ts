import { describe, expect, it, vi } from "vitest";
import type { IngestBatch } from "@alfred/schema";

import { postIngestBatch, postRunnerHeartbeat } from "../sync/ingest-client.js";

const batch: IngestBatch = {
  batch_id: "00000000-0000-4000-8000-000000000201",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  device_id: "00000000-0000-4000-8000-000000000101",
  sent_at: "2026-04-28T10:00:00.000Z",
  events: [
    {
      event_id: "123456789012",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      device_id: "00000000-0000-4000-8000-000000000101",
      project_key: "Alfred",
      source_id: "codex-cli",
      source_run_id: "run-1",
      source_event_id: "event-1",
      type: "run.started",
      privacy_mode: "standard",
      occurred_at: "2026-04-28T10:00:00.000Z",
      payload: {},
    },
  ],
};

describe("postIngestBatch", () => {
  it("posts batch to ingest endpoint with auth", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

    await postIngestBatch({
      apiUrl: "http://127.0.0.1:4301",
      deviceToken: "token-1",
      fetchImpl,
    }, batch);

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:4301/v1/ingest/batches", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });
  });

  it("can include a Vercel automation bypass header", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

    await postIngestBatch({
      apiUrl: "https://alfred-preview.vercel.app",
      deviceToken: "token-1",
      vercelAutomationBypassSecret: "bypass-1",
      fetchImpl,
    }, batch);

    expect(fetchImpl).toHaveBeenCalledWith("https://alfred-preview.vercel.app/v1/ingest/batches", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
        "x-vercel-protection-bypass": "bypass-1",
      },
      body: JSON.stringify(batch),
    });
  });

  it("posts runner heartbeat with device auth", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

    await postRunnerHeartbeat({
      apiUrl: "https://alfred-preview.vercel.app",
      deviceToken: "token-1",
      vercelAutomationBypassSecret: "bypass-1",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://alfred-preview.vercel.app/v1/ingest/heartbeat", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "x-vercel-protection-bypass": "bypass-1",
      },
    });
  });

  it("throws on non-accepted response", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));

    await expect(
      postIngestBatch({
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        fetchImpl,
      }, batch),
    ).rejects.toMatchObject({
      name: "IngestRequestError",
      status: 400,
      message: "Ingest failed with status 400",
    });
  });

  it("throws when heartbeat is not accepted", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));

    await expect(
      postRunnerHeartbeat({
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        fetchImpl,
      }),
    ).rejects.toThrow(/Heartbeat failed with status 401/);
  });
});
