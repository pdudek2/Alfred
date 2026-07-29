import { fileURLToPath } from "node:url";

import { redactPayload, type IngestEvent } from "@alfred/schema";

import { loadRunnerConfig, type RunnerConfig } from "./config.js";
import { OutboxDb } from "./outbox/outbox-db.js";
import { flushOutboxOnce } from "./outbox/outbox-worker.js";
import { createClaudeAdapter } from "./sources/claude/claude-adapter.js";
import { createCodexAdapter } from "./sources/codex/codex-adapter.js";
import type { SourceAdapter } from "./sources/source-adapter.js";
import { postRunnerHeartbeat } from "./sync/ingest-client.js";

export type RunRunnerOptions = {
  adapter?: SourceAdapter;
  adapters?: SourceAdapter[];
  fetchImpl?: typeof fetch;
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
  const adapters = options.adapters ?? (options.adapter ? [options.adapter] : createDefaultAdapters(config, outbox));

  try {
    let collectedEvents = 0;

    for (const adapter of adapters) {
      const collection = await adapter.collect();
      collectedEvents += collection.events.length;
      for (const event of collection.events) {
        outbox.enqueue(redactEvent(event, config.privacyMode));
      }
      for (const cursor of collection.cursorUpdates) {
        outbox.setSourceCursor(cursor.key, cursor.value);
      }
    }

    const flushedEvents = await flushOutbox(outbox, {
      apiUrl: config.apiUrl,
      deviceToken: config.deviceToken,
      ...(config.vercelAutomationBypassSecret
        ? { vercelAutomationBypassSecret: config.vercelAutomationBypassSecret }
        : {}),
      workspaceId: config.workspaceId,
      deviceId: config.deviceId,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    if (flushedEvents === 0) {
      await postRunnerHeartbeat({
        apiUrl: config.apiUrl,
        deviceToken: config.deviceToken,
        ...(config.vercelAutomationBypassSecret
          ? { vercelAutomationBypassSecret: config.vercelAutomationBypassSecret }
          : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    }

    return {
      collectedEvents,
      flushedEvents,
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
  return createCodexAdapter({
    ...config,
    getCursor: (key) => outbox.getSourceCursor(key),
  });
}

function createDefaultClaudeAdapter(config: RunnerConfig, outbox: OutboxDb): SourceAdapter {
  return createClaudeAdapter({
    ...config,
    claudeHome: config.claudeHome ?? `${process.env.HOME ?? "."}/.claude`,
    getCursor: (key) => outbox.getSourceCursor(key),
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

  if (process.env.ALFRED_RUNNER_LOOP === "1") {
    console.log(`Alfred runner watching every ${config.pollMs ?? 5_000}ms`);
    runRunnerLoop(config, {
      onIteration: logResult,
      onError: (error) => {
        console.error(error instanceof Error ? error.message : error);
      },
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  } else {
    runRunnerOnce(config)
      .then(logResult)
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
