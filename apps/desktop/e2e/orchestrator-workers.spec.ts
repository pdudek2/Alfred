import { spawn } from "node:child_process";
import { expect, test } from "./support/electron-app";
import { launchedAgent, sendHook } from "./support/fixture-agents";
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
  expect(listed.result.tools.map((tool) => tool.name))
    .toEqual(["start_worker", "list_workers", "read_worker", "wait_for_worker", "send_to_worker", "stop_worker"]);

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
  await sendHook(typecheck, "UserPromptSubmit", { prompt: "Run the typecheck" });
  const waited = orchestrator.call("wait_for_worker", { worker_id: "codex-1", timeout_seconds: 30 });
  await sendHook(typecheck, "PostToolUse", { tool_name: "Bash", tool_input: { command: "pnpm typecheck 2>&1 | tail -40", description: "Run typecheck" } });
  await sendHook(typecheck, "Stop", { last_assistant_message: "Typecheck passed.\nNo errors in 3 projects." });
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
  await expect(workerTile.getByTestId("xterm-host")).toContainText("Message from your orchestrator, Alfred session");
  await expect(workerTile.getByTestId("xterm-host")).toContainText("Now run the lint");
  expect((await workerTile.getByTestId("xterm-host").boundingBox())!.width).toBeGreaterThan(600);

  expect(parse(await orchestrator.call("start_worker", { agent: "claude", prompt: "Review the diff" }))).toMatchObject({ state: "starting" });
  expect(parse(await orchestrator.call("start_worker", { agent: "codex", prompt: "Write the notes", model: "gpt-6.1-sol", effort: "medium" })))
    .toMatchObject({ state: "starting", model: "gpt-6.1-sol", effort: "medium" });
  const notes = await launchedAgent(paths.root, "codex", (args) => args.includes("Write the notes"));
  expect(notes.args.slice(notes.args.indexOf("--") - 4, notes.args.indexOf("--")))
    .toEqual(["-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"']);
  expect(await orchestrator.call("start_worker", { agent: "codex", prompt: "One too many" }))
    .toMatchObject({ isError: true, text: expect.stringMatching(/already run 4 live workers/) });
  await expect(workers.locator(".session-tree-row")).toHaveCount(4);

  // The orchestrator ends its turn; when a worker it started finishes, Alfred tells it, under its own label.
  await treeRow(page, leadId).click();
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveAttribute("data-session-id", leadId);
  await sendHook(lead, "UserPromptSubmit", { prompt: "Hand the work out" });
  await sendHook(lead, "Stop", { last_assistant_message: "Started the workers." });
  const readme = await launchedAgent(paths.root, "codex", (args) => args.includes("Read the README"));
  await sendHook(readme, "UserPromptSubmit", { prompt: "Read the README" });
  await sendHook(readme, "Stop", { last_assistant_message: "The README describes the desktop app." });
  await expect(leadTile.getByTestId("xterm-host")).toContainText("Message from Alfred (not from the user)", { timeout: 10_000 });
  await expect(leadTile.getByTestId("xterm-host")).toContainText('your worker "Codex" (codex-2) finished its turn.');
  await expect(leadTile.getByTestId("xterm-host")).not.toContainText("The README describes the desktop app.");

  // Stopped by the orchestrator, the worker ends and the orchestrator is not told what it did itself.
  const leadText = async () => (await leadTile.getByTestId("xterm-host").textContent()) ?? "";
  const notices = (await leadText()).split("Message from Alfred").length;
  expect(parse(await orchestrator.call("stop_worker", { worker_id: "codex-2" }))).toEqual({ worker_id: "codex-2", stopped: true });
  await expect.poll(async () => (parse(await orchestrator.call("read_worker", { worker_id: "codex-2" })) as { state: string }).state)
    .toBe("ended");
  await page.waitForTimeout(3_000);
  expect((await leadText()).split("Message from Alfred").length).toBe(notices);

  // A worker has no tools of its own; called with its session, Alfred refuses.
  const worker = mcpClient({ ...config, args: [...config.args.slice(0, -1), typecheck.sessionId] });
  expect(await worker.call("start_worker", { agent: "codex", prompt: "Recurse" }))
    .toMatchObject({ isError: true, text: expect.stringMatching(/cannot start or run workers/) });

  await page.screenshot({ path: testInfo.outputPath("orchestrator-workers-1440x900.png") });
  orchestrator.close();
  worker.close();
});


function mcpServerConfig(args: string[]): McpServerConfig {
  const json = args[args.indexOf("--mcp-config") + 1]!;
  return (JSON.parse(json) as { mcpServers: { alfred: McpServerConfig } }).mcpServers.alfred;
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
