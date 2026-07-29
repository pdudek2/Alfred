#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const worktreesRoot = join(repoRoot, ".worktrees");

const tasks = [
  {
    slot: "01",
    tool: "codex",
    task: "runner-cutoff",
    title: "Runner Codex import cutoff",
    owned: "apps/runner/src/env.ts, apps/runner/src/config.ts, apps/runner/src/sources/codex/**, apps/runner/src/test/codex-adapter.test.ts, apps/runner/src/test/config.test.ts",
    forbidden: "apps/api/**, packages/db/**, drizzle/**, pnpm-lock.yaml",
    goal:
      "Add ALFRED_CODEX_SINCE support so the runner skips Codex events before a configured ISO timestamp. Default behavior must remain unchanged when unset.",
    checks: "pnpm --filter @alfred/runner test && pnpm --filter @alfred/runner typecheck",
  },
  {
    slot: "05",
    tool: "codex",
    task: "dev-doctor",
    title: "Developer diagnostics command",
    owned: "scripts/dev-doctor.mjs",
    forbidden: "apps/**, packages/**, drizzle/**, pnpm-lock.yaml, package.json",
    goal:
      "Create a node script that checks Docker/Postgres, API health, desktop renderer health, and basic repo commands. It should print actionable PASS/FAIL lines and never mutate data.",
    checks: "node scripts/dev-doctor.mjs",
  },
  {
    slot: "06",
    tool: "claude",
    task: "purge-old-runs",
    title: "Local purge helper",
    owned: "scripts/purge-old-runs.mjs",
    forbidden: "apps/**, packages/**, drizzle/**, pnpm-lock.yaml, package.json",
    goal:
      "Create a safe local script that prints SQL and supports a dry-run for deleting runs older than an ISO timestamp. Default must be dry-run and require --execute to mutate.",
    checks: "node scripts/purge-old-runs.mjs --before 2026-04-28T00:00:00.000Z",
  },
  {
    slot: "08",
    tool: "claude",
    task: "privacy-redactor",
    title: "Privacy redactor hardening",
    owned: "apps/runner/src/privacy/redactor.ts, apps/runner/src/test/redactor.test.ts",
    forbidden: "apps/api/**, packages/db/**, drizzle/**, pnpm-lock.yaml",
    goal:
      "Expand redaction tests and implementation for common secret-like keys and nested objects while preserving current privacy modes.",
    checks: "pnpm --filter @alfred/runner test && pnpm --filter @alfred/runner typecheck",
  },
  {
    slot: "09",
    tool: "codex",
    task: "outbox-maintenance",
    title: "Outbox maintenance primitives",
    owned: "apps/runner/src/outbox/outbox-db.ts, apps/runner/src/test/outbox.test.ts",
    forbidden: "apps/api/**, packages/db/**, drizzle/**, pnpm-lock.yaml",
    goal:
      "Add small maintenance helpers for counting queued records and pruning old failed records. Keep existing enqueue/flush behavior unchanged.",
    checks: "pnpm --filter @alfred/runner test && pnpm --filter @alfred/runner typecheck",
  },
  {
    slot: "10",
    tool: "claude",
    task: "claude-adapter-spike",
    title: "Claude adapter fixture spike",
    owned: "apps/runner/src/sources/claude/**, apps/runner/src/test/claude-adapter.test.ts, apps/runner/src/test/fixtures/claude-session.jsonl",
    forbidden: "apps/api/**, packages/db/**, drizzle/**, pnpm-lock.yaml",
    goal:
      "Create an isolated Claude Code adapter spike using fixtures only. Do not wire it into the live runner yet; expose a collect/normalize function and tests.",
    checks: "pnpm --filter @alfred/runner test && pnpm --filter @alfred/runner typecheck",
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  return (result.stdout ?? "").trim();
}

function slugFor(agent) {
  return `${agent.slot}-${agent.task}`;
}

function branchFor(agent) {
  return `agent/${slugFor(agent)}`;
}

function promptFor(agent, worktreePath) {
  const port = 4310 + Number.parseInt(agent.slot, 10);
  const desktopPort = 4410 + Number.parseInt(agent.slot, 10);

  return `Jestes rownoleglym agentem Alfreda.

Katalog pracy: ${worktreePath}
Branch: ${branchFor(agent)}
Slot: ${agent.slot}
Narzędzie: ${agent.tool}
Tytuł zadania: ${agent.title}

Cel:
${agent.goal}

Wolno edytowac tylko:
${agent.owned}

Nie wolno edytowac:
${agent.forbidden}

Zasady:
- Przeczytaj AGENTS.md i README.md.
- Nie pushuj.
- Nie force pushuj.
- Nie dodawaj AI co-author trailers.
- Nie cofaj cudzych zmian.
- Nie uruchamiaj realnego runnera na ~/.codex, chyba ze Twoje zadanie wyraznie tego wymaga; uzywaj fixture lub tymczasowego ALFRED_CODEX_HOME.
- Jesli musisz uruchomic serwer, uzyj API_PORT=${port} i DESKTOP_PORT=${desktopPort}.
- Zacznij od testu lub malej reprodukcji, potem implementacja.
- Na koniec uruchom: ${agent.checks}
- Zrob lokalny commit na swoim branchu z jasnym komunikatem.
- W odpowiedzi koncowej wypisz: zmienione pliki, wykonane testy, commit hash, ryzyka/uwagi.

Nie wychodz poza zakres zadania. Jesli cos wymaga zmiany w pliku zabronionym, opisz to w koncowej notatce zamiast edytowac.
`;
}

function runScriptFor(agent, worktreePath) {
  const promptPath = join(worktreePath, ".agent", "prompt.md");
  const logPath = join(worktreePath, ".agent", "run.log");
  const port = 4310 + Number.parseInt(agent.slot, 10);
  const desktopPort = 4410 + Number.parseInt(agent.slot, 10);
  const common = `#!/usr/bin/env zsh
set -u
cd "${worktreePath}"
export API_PORT=${port}
export DESKTOP_PORT=${desktopPort}
export RUNNER_API_URL="http://127.0.0.1:${port}"
export ALFRED_RUNNER_DB_PATH=".alfred-runner/outbox.sqlite"
echo "== Alfred ${agent.tool.toUpperCase()} agent ${agent.slot}: ${agent.task} =="
echo "Worktree: ${worktreePath}"
echo "Branch: ${branchFor(agent)}"
echo "Prompt: ${promptPath}"
echo
if [ ! -d node_modules ]; then
  echo "== pnpm install --frozen-lockfile =="
  pnpm install --frozen-lockfile
fi
echo
echo "== starting ${agent.tool} =="
`;

  const command =
    agent.tool === "codex"
      ? `codex exec --full-auto --cd "${worktreePath}" - < "${promptPath}" 2>&1 | tee "${logPath}"`
      : `claude -p --setting-sources project --dangerously-skip-permissions --effort medium --max-budget-usd 4 "$(cat "${promptPath}")" 2>&1 | tee "${logPath}"`;

  return `${common}${command}
echo
echo "== agent ${agent.slot} finished; log: ${logPath} =="
echo "Press enter to close this window."
read
`;
}

function ensureWorktree(agent) {
  const slug = slugFor(agent);
  const branch = branchFor(agent);
  const worktreePath = join(worktreesRoot, slug);

  if (!existsSync(worktreePath)) {
    run("git", ["worktree", "add", worktreePath, "-b", branch, "HEAD"], { stdio: "inherit" });
  }

  const agentDir = join(worktreePath, ".agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "prompt.md"), promptFor(agent, worktreePath));
  writeFileSync(join(agentDir, "run.sh"), runScriptFor(agent, worktreePath), { mode: 0o755 });

  return worktreePath;
}

function launchGhostty(worktreePath) {
  const runScript = join(worktreePath, ".agent", "run.sh");
  spawnSync("open", ["-na", "Ghostty", "--args", `--working-directory=${worktreePath}`, "-e", runScript], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function main() {
  const prepareOnly = process.argv.includes("--prepare-only");

  run("git", ["rev-parse", "--show-toplevel"]);
  run("git", ["check-ignore", ".worktrees/example"]);
  mkdirSync(worktreesRoot, { recursive: true });

  const created = tasks.map((agent) => {
    const worktreePath = ensureWorktree(agent);
    if (!prepareOnly) launchGhostty(worktreePath);
    return `${agent.slot} ${agent.tool.padEnd(6)} ${branchFor(agent)} ${worktreePath}`;
  });

  console.log(created.join("\n"));
}

main();
