#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const worktreesRoot = join(repoRoot, ".worktrees");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function tail(path, lines = 8) {
  if (!existsSync(path)) return "(no log yet)";
  const content = readFileSync(path, "utf8").trim();
  if (!content) return "(empty log)";
  return content.split(/\r?\n/).slice(-lines).join("\n");
}

function main() {
  if (!existsSync(worktreesRoot)) {
    console.log("No .worktrees directory yet.");
    return;
  }

  const worktrees = readdirSync(worktreesRoot)
    .filter((name) => /^\d\d-/.test(name))
    .sort();

  for (const name of worktrees) {
    const path = join(worktreesRoot, name);
    const branch = run("git", ["branch", "--show-current"], path).stdout || "(unknown)";
    const status = run("git", ["status", "--short"], path).stdout || "(clean)";
    const lastCommit = run("git", ["log", "-1", "--oneline"], path).stdout || "(no commit)";
    const logPath = join(path, ".agent", "run.log");

    console.log(`\n=== ${name} ===`);
    console.log(`path: ${path}`);
    console.log(`branch: ${branch}`);
    console.log(`last: ${lastCommit}`);
    console.log(`status:\n${status}`);
    console.log(`log tail:\n${tail(logPath)}`);
  }
}

main();
