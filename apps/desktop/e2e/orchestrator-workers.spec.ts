import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { sessionTree, treeRow } from "./support/work-layout";

type McpServerConfig = { command: string; args: string[]; env: Record<string, string> };
type ToolResult = { text: string; isError: boolean };

test("an orchestrator starts, reads, waits for and messages its workers through Alfred", async ({ harness }, testInfo) => {
  const { app, page, paths } = harness;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);

  await page.getByRole("button", { name: "New", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Claude/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const leadTile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(leadTile).toContainText("claude fixture ready");
  const leadId = (await leadTile.getAttribute("data-session-id"))!;
  const lead = await launchedAgent(paths.root, "claude", () => true);

  // The orchestrator's tools, run as Claude Code runs them: the server and arguments Alfred launched it with.
  const config = mcpServerConfig(lead.args);
  const orchestrator = mcpClient(config);
  await orchestrator.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  const listed = await orchestrator.request("tools/list", {}) as { result: { tools: Array<{ name: string }> } };
  expect(listed.result.tools.map((tool) => tool.name)).toEqual(["start_worker", "list_workers", "read_worker", "wait_for_worker", "send_to_worker"]);

  const leadInput = leadTile.getByRole("textbox", { name: "Terminal input" });
  await leadTile.getByTestId("xterm-host").click();
  await expect(leadInput).toBeFocused();

  const typecheckId = parse(await orchestrator.call("start_worker", { agent: "codex", prompt: "Run the typecheck", title: "Typecheck" }));
  expect(typecheckId).toEqual({ worker_id: "codex-1", title: "Typecheck", state: "starting" });
  expect(parse(await orchestrator.call("start_worker", { agent: "codex", prompt: "Read the README" }))).toMatchObject({ state: "starting" });

  // Both hang under the orchestrator, and nothing you were looking at or typing into moves.
  const workers = sessionTree(page).getByRole("list", { name: /^Workers of / });
  await expect(workers.locator(".session-tree-row")).toHaveCount(2);
  await expect(workers.locator(".session-tree-row").first()).toContainText("Typecheck");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveAttribute("data-session-id", leadId);
  await expect(leadInput).toBeFocused();

  const typecheck = await launchedAgent(paths.root, "codex", (args) => args.includes("Run the typecheck"));
  await hook(typecheck, "UserPromptSubmit", { prompt: "Run the typecheck" });
  const waited = orchestrator.call("wait_for_worker", { worker_id: "codex-1", timeout_seconds: 30 });
  await hook(typecheck, "PostToolUse", { tool_name: "Bash", tool_input: { command: "pnpm typecheck 2>&1 | tail -40", description: "Run typecheck" } });
  await hook(typecheck, "Stop", { last_assistant_message: "Typecheck passed.\nNo errors in 3 projects." });
  const read = parse(await waited) as { last_answer: string; recent_steps: string[]; state: string };
  expect(read).toMatchObject({ state: "your turn", last_answer: "Typecheck passed.\nNo errors in 3 projects." });
  expect(read.recent_steps.slice(0, 3)).toEqual(["Typecheck passed.", "Run typecheck", "You asked: Run the typecheck"]);

  expect(parse(await orchestrator.call("send_to_worker", { worker_id: "codex-1", message: "Now run the lint" })))
    .toEqual({ worker_id: "codex-1", sent: true, state: "working" });
  // Its turn has started, so a second message cannot be typed over the first.
  expect(await orchestrator.call("send_to_worker", { worker_id: "codex-1", message: "Again" })).toMatchObject({ isError: true, text: expect.stringMatching(/is working/) });

  // Opened, the worker started while hidden shows its prompt and the message at full width.
  await treeRow(page, "codex-1").click();
  const workerTile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(workerTile).toHaveAttribute("data-session-id", "codex-1");
  await expect(workerTile.getByTestId("xterm-host")).toContainText("> Run the typecheck");
  await expect(workerTile.getByTestId("xterm-host")).toContainText("Now run the lint");
  expect((await workerTile.getByTestId("xterm-host").boundingBox())!.width).toBeGreaterThan(600);

  expect(parse(await orchestrator.call("start_worker", { agent: "claude", prompt: "Review the diff" }))).toMatchObject({ state: "starting" });
  expect(parse(await orchestrator.call("start_worker", { agent: "codex", prompt: "Write the notes" }))).toMatchObject({ state: "starting" });
  expect(await orchestrator.call("start_worker", { agent: "codex", prompt: "One too many" }))
    .toMatchObject({ isError: true, text: expect.stringMatching(/already run 4 live workers/) });
  await expect(workers.locator(".session-tree-row")).toHaveCount(4);

  // A worker has no tools of its own; called with its session, Alfred refuses.
  const worker = mcpClient({ ...config, args: [...config.args.slice(0, -1), typecheck.sessionId] });
  expect(await worker.call("start_worker", { agent: "codex", prompt: "Recurse" }))
    .toMatchObject({ isError: true, text: expect.stringMatching(/cannot start or run workers/) });

  await page.screenshot({ path: testInfo.outputPath("orchestrator-workers-1440x900.png") });
  orchestrator.close();
  worker.close();
});

type LaunchedAgent = { args: string[]; sessionId: string; socketPath: string };

/** The fixture agent writes what Alfred launched it with and where its hooks report. */
async function launchedAgent(root: string, agent: string, matches: (args: string[]) => boolean): Promise<LaunchedAgent> {
  let found: LaunchedAgent | undefined;
  await expect.poll(async () => {
    for (const name of await readdir(root)) {
      const [, pid] = new RegExp(`^alfred-${agent}-args-(\\d+)$`).exec(name) ?? [];
      if (!pid) continue;
      const args = (await readFile(path.join(root, name), "utf8")).split("\n").slice(0, -1);
      if (!matches(args)) continue;
      const hookFile = await readFile(path.join(root, `alfred-${agent}-hook-${pid}`), "utf8").catch(() => "");
      const [socketPath, sessionId] = hookFile.trim().split("\n");
      if (socketPath && sessionId) found = { args, sessionId, socketPath };
    }
    return found !== undefined;
  }).toBe(true);
  return found!;
}

function mcpServerConfig(args: string[]): McpServerConfig {
  const json = args[args.indexOf("--mcp-config") + 1]!;
  return (JSON.parse(json) as { mcpServers: { alfred: McpServerConfig } }).mcpServers.alfred;
}

/** What Alfred's relay forwards when an agent runs a hook. */
function hook(agent: LaunchedAgent, event: string, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const message = JSON.stringify({ sessionId: agent.sessionId, event, payload: JSON.stringify({ hook_event_name: event, ...payload }) });
    const socket = net.connect(agent.socketPath, () => socket.end(`${message}\n`));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

/** One JSON-RPC message per line on stdio, as Claude Code and Codex talk to an MCP server. */
function mcpClient(config: McpServerConfig) {
  const child = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map<number, (message: unknown) => void>();
  let pending = "";
  let nextId = 1;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    for (let end = pending.indexOf("\n"); end !== -1; end = pending.indexOf("\n")) {
      const message = JSON.parse(pending.slice(0, end)) as { id: number };
      pending = pending.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });
  const request = (method: string, params: unknown) => new Promise<unknown>((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  return {
    request,
    call: async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const reply = await request("tools/call", { name, arguments: args }) as { result: { content: Array<{ text: string }>; isError?: boolean } };
      return { text: reply.result.content[0]!.text, isError: reply.result.isError === true };
    },
    close: () => child.stdin.end(),
  };
}

function parse(result: ToolResult): unknown {
  expect(result.isError, result.text).toBe(false);
  return JSON.parse(result.text);
}
