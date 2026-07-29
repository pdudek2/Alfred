import { fileURLToPath } from "node:url";

import { redactPayload, type IngestEvent } from "@alfred/schema";

import { loadRunnerConfig, type RunnerConfig } from "./config.js";
import { OutboxDb } from "./outbox/outbox-db.js";
import { flushOutboxOnce, type FlushOutboxResult } from "./outbox/outbox-worker.js";
import { createClaudeAdapter } from "./sources/claude/claude-adapter.js";
import { createCodexAdapter } from "./sources/codex/codex-adapter.js";
import type { SourceAdapter, SourceCollection } from "./sources/source-adapter.js";
import { postRunnerHeartbeat } from "./sync/ingest-client.js";

export type RunRunnerOptions = {
  adapter?: SourceAdapter;
  adapters?: SourceAdapter[];
  fetchImpl?: typeof fetch;
  onWarning?: (message: string) => void;
};

export type RunRunnerLoopOptions = RunRunnerOptions & {
  maxIterations?: number;
  onError?: (error: unknown) => void;
  onIteration?: (result: { collectedEvents: number; flushedEvents: number }) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

export async function runRunnerOnce(
  config: RunnerConfig = loadRunnerConfig(),
  options: RunRunnerOptions = {},
): Promise<{ collectedEvents: number; flushedEvents: number }> {
  const outbox = new OutboxDb(config.outboxPath);
  const adapters =
    options.adapters ??
    (options.adapter
      ? [options.adapter]
      : createDefaultAdapters(config, outbox, options.onWarning));

  try {
    let collectedEvents = 0;
    const collectionErrors: unknown[] = [];

    for (const adapter of adapters) {
      let collection: SourceCollection;
      try {
        collection = await adapter.collect();
      } catch (error) {
        collectionErrors.push(error);
        continue;
      }
      collectedEvents += collection.events.length;
      for (const event of collection.events) {
        outbox.enqueue(redactEvent(event, config.privacyMode));
      }
      for (const cursor of collection.cursorUpdates) {
        outbox.setSourceCursor(cursor.key, cursor.value);
      }
    }

    const flushResult = await flushOutbox(outbox, {
      apiUrl: config.apiUrl,
      deviceToken: config.deviceToken,
      ...(config.vercelAutomationBypassSecret
        ? { vercelAutomationBypassSecret: config.vercelAutomationBypassSecret }
        : {}),
      workspaceId: config.workspaceId,
      deviceId: config.deviceId,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    });

    if (flushResult.sent === 0) {
      await postRunnerHeartbeat({
        apiUrl: config.apiUrl,
        deviceToken: config.deviceToken,
        ...(config.vercelAutomationBypassSecret
          ? { vercelAutomationBypassSecret: config.vercelAutomationBypassSecret }
          : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    }

    if (collectionErrors.length > 0) {
      throw new AggregateError(collectionErrors, "Runner collection failed");
    }

    return {
      collectedEvents,
      flushedEvents: flushResult.sent,
    };
  } finally {
    outbox.close();
  }
}

export async function runRunnerLoop(
  config: RunnerConfig = loadRunnerConfig(),
  options: RunRunnerLoopOptions = {},
): Promise<void> {
  const sleep = options.sleep ?? sleepFor;
  let iterations = 0;

  while (!options.signal?.aborted) {
    try {
      const result = await runRunnerOnce(config, options);
      options.onIteration?.(result);
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        throw error;
      }
    }

    iterations += 1;
    if (options.maxIterations !== undefined && iterations >= options.maxIterations) {
      return;
    }

    await sleep(config.pollMs ?? 5_000);
  }
}

async function flushOutbox(
  outbox: OutboxDb,
  config: Parameters<typeof flushOutboxOnce>[1],
): Promise<FlushOutboxResult> {
  const total = { sent: 0, quarantined: 0 };

  while (true) {
    const result = await flushOutboxOnce(outbox, config);
    total.sent += result.sent;
    total.quarantined += result.quarantined;
    if (result.sent + result.quarantined === 0) return total;
  }
}

function createDefaultAdapters(
  config: RunnerConfig,
  outbox: OutboxDb,
  onWarning?: (message: string) => void,
): SourceAdapter[] {
  const sources = config.runnerSources ?? ["codex"];
  return sources.map((source) => {
    if (source === "claude") {
      return createDefaultClaudeAdapter(config, outbox, onWarning);
    }
    return createDefaultCodexAdapter(config, outbox, onWarning);
  });
}

function createDefaultCodexAdapter(
  config: RunnerConfig,
  outbox: OutboxDb,
  onWarning?: (message: string) => void,
): SourceAdapter {
  return createCodexAdapter({
    ...config,
    getCursor: (key) => outbox.getSourceCursor(key),
    ...(onWarning ? { onWarning } : {}),
  });
}

function createDefaultClaudeAdapter(
  config: RunnerConfig,
  outbox: OutboxDb,
  onWarning?: (message: string) => void,
): SourceAdapter {
  return createClaudeAdapter({
    ...config,
    claudeHome: config.claudeHome ?? `${process.env.HOME ?? "."}/.claude`,
    getCursor: (key) => outbox.getSourceCursor(key),
    ...(onWarning ? { onWarning } : {}),
  });
}

function redactEvent(event: IngestEvent, privacyMode: RunnerConfig["privacyMode"]): IngestEvent {
  return {
    ...event,
    payload: redactPayload(event.payload, privacyMode),
  };
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadRunnerConfig();
  const logResult = (result: { collectedEvents: number; flushedEvents: number }) => {
    console.log(
      `Alfred runner collected ${result.collectedEvents} event(s), flushed ${result.flushedEvents} event(s)`,
    );
  };
  const onWarning = (message: string) => console.warn(message);

  if (process.env.ALFRED_RUNNER_LOOP === "1") {
    console.log(`Alfred runner watching every ${config.pollMs ?? 5_000}ms`);
    runRunnerLoop(config, {
      onIteration: logResult,
      onError: (error) => {
        console.error(error instanceof Error ? error.message : error);
      },
      onWarning,
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  } else {
    runRunnerOnce(config, { onWarning })
      .then(logResult)
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
