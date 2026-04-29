import { fileURLToPath } from "node:url";

import type { IngestEvent } from "@alfred/schema";

import { loadRunnerConfig, type RunnerConfig } from "./config.js";
import { OutboxDb } from "./outbox/outbox-db.js";
import { flushOutboxOnce } from "./outbox/outbox-worker.js";
import { redactPayload } from "./privacy/redactor.js";
import { createClaudeAdapter } from "./sources/claude/claude-adapter.js";
import { createCodexAdapter } from "./sources/codex/codex-adapter.js";
import type { SourceAdapter } from "./sources/source-adapter.js";

export type RunRunnerOptions = {
  adapter?: SourceAdapter;
  adapters?: SourceAdapter[];
  fetchImpl?: typeof fetch;
};

export async function runRunnerOnce(
  config: RunnerConfig = loadRunnerConfig(),
  options: RunRunnerOptions = {},
): Promise<{ collectedEvents: number; flushedEvents: number }> {
  const outbox = new OutboxDb(config.outboxPath);
  const adapters = options.adapters ?? (options.adapter ? [options.adapter] : createDefaultAdapters(config, outbox));

  try {
    let collectedEvents = 0;

    for (const adapter of adapters) {
      const events = await adapter.collect();
      collectedEvents += events.length;
      for (const event of events) {
        outbox.enqueue(redactEvent(event, config.privacyMode));
      }
      updateSourceCursor(outbox, adapter.sourceId, events);
    }

    const flushedEvents = await flushOutbox(outbox, {
      apiUrl: config.apiUrl,
      deviceToken: config.deviceToken,
      workspaceId: config.workspaceId,
      deviceId: config.deviceId,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    return {
      collectedEvents,
      flushedEvents,
    };
  } finally {
    outbox.close();
  }
}

async function flushOutbox(
  outbox: OutboxDb,
  config: Parameters<typeof flushOutboxOnce>[1],
): Promise<number> {
  let flushedEvents = 0;

  while (true) {
    const flushedBatchEvents = await flushOutboxOnce(outbox, config);
    if (flushedBatchEvents === 0) return flushedEvents;
    flushedEvents += flushedBatchEvents;
  }
}

function createDefaultAdapters(config: RunnerConfig, outbox: OutboxDb): SourceAdapter[] {
  const sources = config.runnerSources ?? ["codex"];
  return sources.map((source) => {
    if (source === "claude") {
      return createDefaultClaudeAdapter(config, outbox);
    }
    return createDefaultCodexAdapter(config, outbox);
  });
}

function createDefaultCodexAdapter(config: RunnerConfig, outbox: OutboxDb): SourceAdapter {
  const storedCursor = outbox.getSourceCursor("codex-cli");
  const codexSince = config.codexSince ?? storedCursor ?? undefined;
  return createCodexAdapter({
    ...config,
    ...(codexSince ? { codexSince } : {}),
  });
}

function createDefaultClaudeAdapter(config: RunnerConfig, outbox: OutboxDb): SourceAdapter {
  const storedCursor = outbox.getSourceCursor("claude-code");
  const claudeSince = config.claudeSince ?? storedCursor ?? undefined;
  return createClaudeAdapter({
    ...config,
    claudeHome: config.claudeHome ?? `${process.env.HOME ?? "."}/.claude`,
    ...(claudeSince ? { claudeSince } : {}),
  });
}

function updateSourceCursor(outbox: OutboxDb, sourceId: string, events: IngestEvent[]): void {
  const newestOccurredAt = maxOccurredAt(events);
  if (newestOccurredAt) {
    outbox.setSourceCursor(sourceId, newestOccurredAt);
  }
}

function maxOccurredAt(events: IngestEvent[]): string | null {
  let newestMs = Number.NEGATIVE_INFINITY;
  let newest: string | null = null;

  for (const event of events) {
    const occurredAtMs = Date.parse(event.occurred_at);
    if (Number.isNaN(occurredAtMs) || occurredAtMs < newestMs) continue;
    newestMs = occurredAtMs;
    newest = event.occurred_at;
  }

  return newest;
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
