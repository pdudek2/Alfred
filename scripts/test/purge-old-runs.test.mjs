import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "purge-old-runs.mjs");

describe("purge old runs helper", () => {
  it("keeps its built-in self-test passing", async () => {
    const result = await runNode([scriptPath, "--self-test"]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /self-test ok/);
  });

  it("does not pin pg to a pnpm store version path", async () => {
    const source = await readFile(scriptPath, "utf8");

    assert.doesNotMatch(source, /\.pnpm\/pg@/);
  });
});

function runNode(args) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stderr: `${stderr}\nprocess timed out`, stdout });
    }, 10_000);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      finish({ code, stderr, stdout });
    });
    child.on("error", (error) => {
      finish({ code: null, stderr: `${stderr}\n${error.message}`, stdout });
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }
  });
}
