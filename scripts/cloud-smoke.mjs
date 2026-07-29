#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const baseUrl = process.env.ALFRED_CLOUD_URL;
const mode = process.env.ALFRED_CLOUD_SMOKE_MODE ?? "public";
const vercelProtectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseUrl) {
  console.error("ALFRED_CLOUD_URL is required");
  process.exit(1);
}

if (!["public", "runner-auth"].includes(mode)) {
  console.error("ALFRED_CLOUD_SMOKE_MODE must be public or runner-auth");
  process.exit(1);
}

if (mode === "runner-auth" && !process.env.RUNNER_DEVICE_TOKEN) {
  console.error("RUNNER_DEVICE_TOKEN is required for runner-auth cloud smoke");
  process.exit(1);
}

if (mode === "runner-auth" && !process.env.RUNNER_WORKSPACE_ID) {
  console.error("RUNNER_WORKSPACE_ID is required for runner-auth cloud smoke");
  process.exit(1);
}

if (mode === "runner-auth" && !process.env.RUNNER_DEVICE_ID) {
  console.error("RUNNER_DEVICE_ID is required for runner-auth cloud smoke");
  process.exit(1);
}

const runnerSmokeBatch = mode === "runner-auth" ? buildRunnerSmokeBatch() : null;
const checks =
  mode === "runner-auth"
    ? [
        { name: "runner heartbeat", path: "/v1/ingest/heartbeat", validate: validateRunnerHeartbeat, method: "POST" },
        {
          name: "runner batch",
          path: "/v1/ingest/batches",
          validate: (response, body) => validateRunnerBatch(response, body, runnerSmokeBatch),
          method: "POST",
          body: runnerSmokeBatch,
        },
      ]
    : [
        { name: "health", path: "/health", validate: validateHealth },
        { name: "auth login", path: "/auth/login", validate: validateNotFound },
        { name: "auth callback", path: "/auth/callback", validate: validateNotFound },
        { name: "auth logout", path: "/auth/logout", validate: validateNotFound, method: "POST" },
        { name: "api auth login", path: "/api/auth/login", validate: validateNotFound },
        { name: "api auth callback", path: "/api/auth/callback", validate: validateNotFound },
        { name: "api auth logout", path: "/api/auth/logout", validate: validateNotFound, method: "POST" },
        { name: "runs", path: "/v1/runs", validate: validateNotFound },
        { name: "run", path: "/v1/runs/retired-run", validate: validateNotFound },
        { name: "api runs", path: "/api/v1/runs", validate: validateNotFound },
        { name: "api run", path: "/api/v1/runs/retired-run", validate: validateNotFound },
        { name: "system", path: "/v1/system/status", validate: validateNotFound },
        { name: "api system", path: "/api/v1/system/status", validate: validateNotFound },
      ];

let failed = false;

for (const check of checks) {
  const headers = {
    ...(mode === "runner-auth" ? { authorization: `Bearer ${process.env.RUNNER_DEVICE_TOKEN}` } : {}),
    ...(check.body ? { "content-type": "application/json" } : {}),
    ...(vercelProtectionBypass ? { "x-vercel-protection-bypass": vercelProtectionBypass } : {}),
  };

  try {
    const response = await fetch(new URL(check.path, baseUrl), {
      method: check.method ?? "GET",
      headers,
      redirect: "manual",
      ...(check.body ? { body: JSON.stringify(check.body) } : {}),
    });
    const body = await response.text();
    const result = check.validate(response, body);
    const ok = result === true || result === "warn";
    const label = result === "warn" ? "WARN" : ok ? "PASS" : "FAIL";
    console.log(`${label} ${check.name}: ${response.status}`);
    if (!ok) {
      failed = true;
      console.error(body.slice(0, 500));
    }
  } catch (error) {
    failed = true;
    console.log(`FAIL ${check.name}: ERROR`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

process.exit(failed ? 1 : 0);

function validateHealth(response, body) {
  if (!response.ok) return false;
  const headers = response.headers;
  const json = parseJson(body, headers);
  return json?.ok === true && json?.service === "alfred-api";
}

function validateNotFound(response) {
  return response.status === 404;
}

function validateRunnerHeartbeat(response, body) {
  if (response.status !== 202) return false;
  const headers = response.headers;
  const json = parseJson(body, headers);
  return json?.ok === true && typeof json?.last_seen_at === "string";
}

function validateRunnerBatch(response, body, expectedBatch) {
  if (response.status !== 202) return false;
  const headers = response.headers;
  const json = parseJson(body, headers);
  return (
    json?.batch_id === expectedBatch.batch_id &&
    json?.accepted_events === expectedBatch.events.length &&
    json?.duplicate_events === 0 &&
    json?.duplicate_batch === false
  );
}

function buildRunnerSmokeBatch() {
  const workspaceId = process.env.RUNNER_WORKSPACE_ID;
  const deviceId = process.env.RUNNER_DEVICE_ID;
  const batchId = randomUUID();
  const runId = `ops-smoke-${Date.now()}`;
  const startedAt = new Date();
  const completedAt = new Date(startedAt.getTime() + 1000);

  return {
    batch_id: batchId,
    workspace_id: workspaceId,
    device_id: deviceId,
    sent_at: completedAt.toISOString(),
    events: [
      buildRunnerSmokeEvent({
        deviceId,
        eventId: `${runId}-started`,
        occurredAt: startedAt.toISOString(),
        runId,
        sourceEventId: `${runId}:started`,
        status: "running",
        type: "run.started",
        workspaceId,
      }),
      buildRunnerSmokeEvent({
        deviceId,
        eventId: `${runId}-completed`,
        occurredAt: completedAt.toISOString(),
        runId,
        sourceEventId: `${runId}:completed`,
        status: "completed",
        type: "run.completed",
        workspaceId,
      }),
    ],
  };
}

function buildRunnerSmokeEvent({ deviceId, eventId, occurredAt, runId, sourceEventId, status, type, workspaceId }) {
  return {
    event_id: eventId,
    workspace_id: workspaceId,
    device_id: deviceId,
    project_key: "ops-smoke",
    source_id: "codex-cli",
    source_run_id: runId,
    source_event_id: sourceEventId,
    type,
    status,
    privacy_mode: "minimal",
    occurred_at: occurredAt,
    payload: { smoke: true, origin: "cloud-smoke" },
  };
}

function parseJson(body, headers) {
  if (!contentType(headers).includes("application/json")) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function contentType(headers) {
  return headers.get("content-type") ?? "";
}
