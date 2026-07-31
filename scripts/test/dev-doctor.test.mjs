import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const doctorPath = path.join(repoRoot, "scripts", "dev-doctor.mjs");

const fakeToolSource = `#!/usr/bin/env node
const tool = process.argv[1].split(/[\\\\/]/).at(-1);
const args = process.argv.slice(2);
const healthy = process.env.ALFRED_DOCTOR_FIXTURE === "healthy";
if (tool === "pnpm") {
  if (args[0] === "--version") console.log("10.0.0");
  else console.log(JSON.stringify({ tasks: [
    { task: "test" }, { task: "typecheck" }, { task: "build" }
  ] }));
} else if (tool === "docker") {
  if (args[0] === "--version") console.log("Docker version fixture");
  else if (!healthy && args[0] === "info") {
    console.error("fixture daemon unavailable");
    process.exitCode = 1;
  } else if (args[0] === "info") console.log("29.1.5");
  else if (args[0] === "inspect") console.log(JSON.stringify({
    Running: true, Status: "running", Health: { Status: "healthy" }
  }));
  else if (args[0] === "exec") console.log("accepting connections");
} else if (tool === "ps") {
  console.log(healthy
    ? "4242 1 00:10 node apps/runner/src/index.ts"
    : "PID PPID ELAPSED COMMAND");
}`;

async function installFakeTools(binDirectory) {
  for (const name of ["pnpm", "docker", "ps"]) {
    const target = path.join(binDirectory, name);
    await writeFile(target, fakeToolSource);
    await chmod(target, 0o755);
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture port is unavailable");
  return address.port;
}

async function reserveTcpPort() {
  const server = createTcpServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ code: null, stderr: `${stderr}\n${error.message}`, stdout });
    });
  });
}

async function runDoctorFixture({ healthy }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "alfred-dev-doctor-"));
  const binDirectory = path.join(root, "bin");
  await mkdir(binDirectory);
  await installFakeTools(binDirectory);

  const http = createHttpServer((request, response) => {
    if (!healthy) {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("fixture unavailable");
    } else if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "alfred-api" }));
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<div id="root"></div>');
    }
  });
  const tcp = createTcpServer((socket) => socket.end());
  const httpPort = await listen(http);
  const tcpPort = healthy ? await listen(tcp) : await reserveTcpPort();

  try {
    return await runNode([doctorPath], {
      ...process.env,
      ALFRED_DOCTOR_FIXTURE: healthy ? "healthy" : "unhealthy",
      API_HEALTH_URL: `http://127.0.0.1:${httpPort}/health`,
      DATABASE_URL: `postgres://alfred:alfred@127.0.0.1:${tcpPort}/alfred`,
      DESKTOP_HEALTH_URL: `http://127.0.0.1:${httpPort}/`,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    });
  } finally {
    await Promise.all([
      new Promise((resolve) => http.close(resolve)),
      healthy ? new Promise((resolve) => tcp.close(resolve)) : Promise.resolve(),
    ]);
    await rm(root, { force: true, recursive: true });
  }
}

describe("dev doctor", () => {
  it("reports a fully healthy controlled environment", async () => {
    const result = await runDoctorFixture({ healthy: true });

    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Alfred dev doctor \(read-only\)/);
    assert.match(result.stdout, /PASS docker daemon:/);
    assert.match(result.stdout, /PASS postgres readiness:/);
    assert.match(result.stdout, /PASS runner process:/);
    assert.match(result.stdout, /Summary: 12 passed, 0 failed\./);
  });

  it("finishes all checks and prints recovery actions when dependencies fail", async () => {
    const result = await runDoctorFixture({ healthy: false });

    assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /FAIL docker daemon:/);
    assert.match(result.stdout, /Action: start Docker Desktop/);
    assert.match(result.stdout, /FAIL postgres tcp:/);
    assert.match(result.stdout, /FAIL api health:/);
    assert.match(result.stdout, /FAIL runner process:/);
    assert.match(result.stdout, /FAIL desktop renderer health:/);
    assert.match(result.stdout, /Summary: \d+ passed, [1-9]\d* failed\./);
  });
});
