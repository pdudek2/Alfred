import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "cloud-smoke.mjs");

describe("cloud smoke", () => {
  it("defaults to public mode even when an auth token is present", async () => {
    const requests = [];
    const result = await runSmoke({
      env: {
        AUTH_DEV_SESSION_TOKEN: "dev-session-token",
        ALFRED_EXPECT_AUTH: "not-configured",
      },
      handler: async (req, res) => {
        requests.push({ cookie: req.headers.cookie, method: req.method, url: req.url });
        if (req.url === "/") return send(res, 200, "text/html", "<html><title>Alfred</title></html>");
        if (req.url === "/health") return sendJson(res, 200, { ok: true, service: "alfred-api" });
        if (req.url === "/auth/login") return sendJson(res, 503, { error: "oidc_not_configured" });
        return send(res, 404, "text/plain", "not found");
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      requests.map((request) => [request.method, request.url]),
      [
        ["GET", "/"],
        ["GET", "/health"],
        ["GET", "/auth/login"],
      ],
    );
    assert.equal(requests.some((request) => request.cookie), false);
  });

  it("checks runner heartbeat and batch ingest with device auth", async () => {
    const workspaceId = randomUUID();
    const deviceId = randomUUID();
    const requests = [];
    const result = await runSmoke({
      env: {
        ALFRED_CLOUD_SMOKE_MODE: "runner-auth",
        RUNNER_DEVICE_TOKEN: "runner-token",
        RUNNER_WORKSPACE_ID: workspaceId,
        RUNNER_DEVICE_ID: deviceId,
      },
      handler: async (req, res) => {
        const body = await readBody(req);
        requests.push({
          authorization: req.headers.authorization,
          body: body ? JSON.parse(body) : null,
          method: req.method,
          url: req.url,
        });
        if (req.url === "/v1/ingest/heartbeat") {
          return sendJson(res, 202, { ok: true, last_seen_at: "2026-05-04T00:00:00.000Z" });
        }
        if (req.url === "/v1/ingest/batches") {
          return sendJson(res, 202, {
            batch_id: requests.at(-1)?.body?.batch_id,
            accepted_events: 2,
            duplicate_events: 0,
            duplicate_batch: false,
          });
        }
        return send(res, 404, "text/plain", "not found");
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      requests.map((request) => [request.method, request.url, request.authorization]),
      [
        ["POST", "/v1/ingest/heartbeat", "Bearer runner-token"],
        ["POST", "/v1/ingest/batches", "Bearer runner-token"],
      ],
    );

    const batch = requests[1].body;
    assert.equal(batch.workspace_id, workspaceId);
    assert.equal(batch.device_id, deviceId);
    assert.equal(batch.events.length, 2);
    assert.deepEqual(batch.events.map((event) => event.type), ["run.started", "run.completed"]);
    assert.equal(batch.events.every((event) => event.workspace_id === workspaceId), true);
    assert.equal(batch.events.every((event) => event.device_id === deviceId), true);
  });

  it("fails runner-auth mode when the batch response is a no-op duplicate", async () => {
    const result = await runSmoke({
      env: {
        ALFRED_CLOUD_SMOKE_MODE: "runner-auth",
        RUNNER_DEVICE_TOKEN: "runner-token",
        RUNNER_WORKSPACE_ID: randomUUID(),
        RUNNER_DEVICE_ID: randomUUID(),
      },
      handler: async (req, res) => {
        await readBody(req);
        if (req.url === "/v1/ingest/heartbeat") {
          return sendJson(res, 202, { ok: true, last_seen_at: "2026-05-04T00:00:00.000Z" });
        }
        if (req.url === "/v1/ingest/batches") {
          return sendJson(res, 202, {
            batch_id: randomUUID(),
            accepted_events: 0,
            duplicate_events: 2,
            duplicate_batch: true,
          });
        }
        return send(res, 404, "text/plain", "not found");
      },
    });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /FAIL runner batch: 202/);
  });
});

async function runSmoke({ env, handler }) {
  const server = http.createServer((req, res) => {
    void handler(req, res).catch((error) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.stack : String(error));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    return await runNode(scriptPath, {
      ...process.env,
      ...env,
      ALFRED_CLOUD_URL: `http://127.0.0.1:${address.port}`,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function runNode(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  send(res, status, "application/json", JSON.stringify(body));
}

function send(res, status, contentType, body) {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}
