import type { IngestBatch } from "@alfred/schema";

export type IngestClientConfig = {
  apiUrl: string;
  deviceToken: string;
  fetchImpl?: typeof fetch;
};

export async function postIngestBatch(config: IngestClientConfig, batch: IngestBatch): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.apiUrl}/v1/ingest/batches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batch),
  });

  if (response.status !== 202) {
    throw new Error(`Ingest failed with status ${response.status}`);
  }
}
