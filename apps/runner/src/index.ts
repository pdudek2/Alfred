import { fileURLToPath } from "node:url";

import type { IngestEvent } from "@alfred/schema";

import { loadRunnerConfig, type RunnerConfig } from "./config.js";
import { OutboxDb } from "./outbox/outbox-db.js";
import { flushOutboxOnce } from "./outbox/outbox-worker.js";
import { redactPayload } from "./privacy/redactor.js";
import { createCodexAdapter } from "./sources/codex/codex-adapter.js";
import type { SourceAdapter } from "./sources/source-adapter.js";

export type RunRunnerOptions = {
  adapter?: SourceAdapter;
  fetchImpl?: typeof fetch;
};

export async function runRunnerOnce(
  config: RunnerConfig = loadRunnerConfig(),
  options: RunRunnerOptions = {},
): Promise<{ collectedEvents: number; flushedEvents: number }> {
  const outbox = new OutboxDb(config.outboxPath);
  const adapter = options.adapter ?? createCodexAdapter(config);

  try {
    const events = await adapter.collect();
    for (const event of events) {
      outbox.enqueue(redactEvent(event, config.privacyMode));
    }

    const flushedEvents = await flushOutboxOnce(outbox, {
      apiUrl: config.apiUrl,
      deviceToken: config.deviceToken,
      workspaceId: config.workspaceId,
      deviceId: config.deviceId,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    return {
      collectedEvents: events.length,
      flushedEvents,
    };
  } finally {
    outbox.close();
  }
}

function redactEvent(event: IngestEvent, privacyMode: RunnerConfig["privacyMode"]): IngestEvent {
  return {
    ...event,
    payload: redactPayload(event.payload, privacyMode),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRunnerOnce()
    .then((result) => {
      console.log(
        `Alfred runner collected ${result.collectedEvents} event(s), flushed ${result.flushedEvents} event(s)`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
