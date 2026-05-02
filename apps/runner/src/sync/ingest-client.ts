import type { IngestBatch } from "@alfred/schema";

export type IngestClientConfig = {
  apiUrl: string;
  deviceToken: string;
  vercelAutomationBypassSecret?: string;
  fetchImpl?: typeof fetch;
};

export async function postIngestBatch(config: IngestClientConfig, batch: IngestBatch): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.apiUrl}/v1/ingest/batches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      "Content-Type": "application/json",
      ...(config.vercelAutomationBypassSecret
        ? { "x-vercel-protection-bypass": config.vercelAutomationBypassSecret }
        : {}),
    },
    body: JSON.stringify(batch),
  });

  if (response.status !== 202) {
    throw new Error(`Ingest failed with status ${response.status}`);
  }
}

export async function postRunnerHeartbeat(config: IngestClientConfig): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.apiUrl}/v1/ingest/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      ...(config.vercelAutomationBypassSecret
        ? { "x-vercel-protection-bypass": config.vercelAutomationBypassSecret }
        : {}),
    },
  });

  if (response.status !== 202) {
    throw new Error(`Heartbeat failed with status ${response.status}`);
  }
}
