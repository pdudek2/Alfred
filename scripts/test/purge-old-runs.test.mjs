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

  it("rejects ambiguous or impossible cutoffs before database access", async () => {
    for (const cutoff of [
      "04/05/2026",
      "2026-04-28",
      "2026-04-28T00:00:00",
      "2026-02-30T00:00:00Z",
      "2026-04-28T00:00:00+0200",
    ]) {
      const result = await runNode([
        scriptPath,
        "--before",
        cutoff,
        "--database-url",
        "postgresql://alfred:alfred@127.0.0.1:1/alfred",
      ]);

      assert.equal(result.code, 1, `${cutoff}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /--before is not a valid ISO timestamp/);
      assert.doesNotMatch(result.stdout, /mode:/);
    }
  });

  it("accepts full cutoffs with Z or an explicit offset", async () => {
    for (const [cutoff, normalized] of [
      ["2026-04-28T00:00:00Z", "2026-04-28T00:00:00.000Z"],
      ["2026-04-28T02:30:00+02:00", "2026-04-28T00:30:00.000Z"],
      ["2026-04-28T00:00:00.123Z", "2026-04-28T00:00:00.123Z"],
    ]) {
      const result = await runNode([
        scriptPath,
        "--before",
        cutoff,
        "--database-url",
        "postgresql://alfred:alfred@127.0.0.1:1/alfred",
      ]);

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`cutoff:\\s+${normalized.replaceAll(".", "\\.")}`));
    }
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
