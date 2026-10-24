import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentSignalBridge,
  isTerminalReport,
  isShellProcess,
  parseOsc9,
  signalFromHook,
  signalFromOsc9,
  type AgentSignalBridge,
  type AgentSignalUpdate,
} from "./agent-signals.js";

describe("isShellProcess", () => {
  it("recognizes shells, login shells and nested shells, and nothing else", () => {
    for (const name of ["zsh", "-zsh", "bash", "/bin/fish", "sh"]) expect(isShellProcess(name)).toBe(true);
    for (const name of ["sleep", "vim", "node", "2.1.285", "Python", ""]) expect(isShellProcess(name)).toBe(false);
  });
});

describe("parseOsc9", () => {
  it("extracts BEL and ST terminated messages", () => {
    expect(parseOsc9("", "a\x1b]9;one\x07b\x1b]9;two\x1b\\c").messages).toEqual(["one", "two"]);
  });

  it("carries a sequence split across chunks", () => {
    const first = parseOsc9("", "text\x1b]9;Approval req");
    expect(first.messages).toEqual([]);
    expect(parseOsc9(first.carry, "uested: ls\x07").messages).toEqual(["Approval requested: ls"]);
  });

  it("drops an endless unterminated sequence", () => {
    expect(parseOsc9("", `\x1b]9;${"x".repeat(5_000)}`).carry).toBe("");
  });
});

describe("signals", () => {
  it("maps Codex notifications to Needs you and Your turn", () => {
    expect(signalFromOsc9("Approval requested: /bin/zsh -lc 'touch probe.txt'")).toEqual({
      state: "needs-you",
      detail: "Approval requested: /bin/zsh -lc 'touch probe.txt'",
    });
    expect(signalFromOsc9("Created probe.txt")).toEqual({ state: "your-turn", detail: "Created probe.txt" });
    expect(signalFromOsc9("   ")).toBeNull();
  });

  it("reads Codex's edit approvals and plan prompts as Needs you, and its questions as Your turn", () => {
    for (const message of [
      "Codex wants to edit src/session-status.ts",
      "Codex wants to edit 3 files",
      "Approval requested by github",
      "Plan mode prompt: Implement this plan?",
    ]) {
      expect(signalFromOsc9(message)).toEqual({ state: "needs-you", detail: message });
    }
    expect(signalFromOsc9("Question: Which database?")).toEqual({ state: "your-turn", detail: "Question: Which database?" });
  });

  it("tells what the terminal reports on its own apart from typed input", () => {
    for (const report of [
      "\x1b[I",
      "\x1b[O\x1b[I",
      // Mouse movement, a click and a scroll, as SGR and as X10 reports.
      "\x1b[<35;40;12M\x1b[<35;41;12M",
      "\x1b[<0;10;5M\x1b[<0;10;5m",
      "\x1b[<64;10;5M",
      "\x1b[M #!",
      // Answers to cursor position, device attributes, a mode, keyboard flags and a colour query.
      "\x1b[12;40R",
      "\x1b[?62;22c",
      "\x1b[?2004;1$y",
      "\x1b[?0u",
      "\x1b]11;rgb:0000/0000/0000\x1b\\",
      "\x1b]10;rgb:ffff/ffff/ffff\x07",
    ]) {
      expect(isTerminalReport(report)).toBe(true);
    }
    for (const typed of ["y", "\r", "\x1b", "\x1b[A", "\x1b[Iy", "\x1b[<35;40;12My", "\x1b[200~text\x1b[201~", ""]) {
      expect(isTerminalReport(typed)).toBe(false);
    }
  });

  it("maps Claude hooks to states and describes the permission request", () => {
    expect(signalFromHook("UserPromptSubmit", {})).toEqual({ state: "working" });
    expect(signalFromHook("PostToolUse", {})).toEqual({ state: "working" });
    expect(signalFromHook("Stop", {})).toEqual({ state: "your-turn" });
    expect(signalFromHook("SessionStart", {})).toBeNull();
    expect(
      signalFromHook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "touch probe.txt", description: "Create" } }),
    ).toEqual({ state: "needs-you", detail: "Bash: touch probe.txt" });
    expect(signalFromHook("PermissionRequest", undefined)).toEqual({ state: "needs-you", detail: "Waiting for approval" });
  });

  it("says what a turn ended with: the first line of the agent's last answer", () => {
    expect(signalFromHook("Stop", {
      last_assistant_message: "## Done\n\nUtworzyłem plik `hello world.txt` na **pulpicie**.",
      stop_hook_active: false,
    })).toEqual({
      state: "your-turn",
      detail: "Done",
      // An orchestrator reads its worker's whole answer.
      answer: "## Done\n\nUtworzyłem plik `hello world.txt` na **pulpicie**.",
    });
    expect(signalFromHook("Stop", { last_assistant_message: "\n- Pobrano `example.com` (kod 0).\n- Nie zapisywałem pliku." }))
      .toMatchObject({ state: "your-turn", detail: "Pobrano example.com (kod 0)." });
    expect(signalFromHook("Stop", { last_assistant_message: "x".repeat(500) })?.detail).toHaveLength(240);
    expect(signalFromHook("Stop", { last_assistant_message: "  \n " })).toEqual({ state: "your-turn" });
    expect(signalFromHook("Stop", { last_assistant_message: null })).toEqual({ state: "your-turn" });
  });

  it("records each tool a hooked agent ran, from the PostToolUse payload Claude Code sends", () => {
    const tool = (tool_name: string, tool_input: unknown) => signalFromHook("PostToolUse", { hook_event_name: "PostToolUse", tool_name, tool_input });
    expect(tool("Bash", { command: "pnpm test\n--watch", description: "Run tests" })).toEqual({
      state: "working",
      activity: {
        kind: "command", title: "Ran command", detail: "pnpm test",
        payload: { type: "command", command: "pnpm test\n--watch", description: "Run tests" },
      },
    });
    // Codex's shell gives no description: the command speaks for itself.
    expect(tool("exec_command", { command: "pnpm lint" })?.activity?.payload).toEqual({ type: "command", command: "pnpm lint" });
    expect(tool("Write", { file_path: "/repo/a.txt", content: "alpha" })?.activity).toEqual({
      kind: "file", title: "File activity", detail: "Wrote /repo/a.txt", payload: { type: "file", operation: "wrote", path: "/repo/a.txt" },
    });
    expect(tool("Edit", { file_path: "/repo/a.txt", old_string: "alpha", new_string: "beta" })?.activity?.payload)
      .toEqual({ type: "file", operation: "edited", path: "/repo/a.txt" });
    expect(tool("MultiEdit", { file_path: "/repo/b.ts", edits: [] })?.activity?.payload)
      .toEqual({ type: "file", operation: "edited", path: "/repo/b.ts" });
    expect(tool("Read", { file_path: "/repo/a.txt" })?.activity?.payload).toEqual({ type: "file", operation: "read", path: "/repo/a.txt" });
    expect(tool("TaskCreate", { subject: "Wire the tree", description: "…" })?.activity).toEqual({
      kind: "plan", title: "Plan updated", detail: "Wire the tree", payload: { type: "plan", summary: "Wire the tree" },
    });
    expect(tool("TodoWrite", { todos: [] })?.activity).toMatchObject({ kind: "plan", title: "Plan updated" });
    expect(tool("Glob", { pattern: "**/*.txt", path: "/repo" })?.activity).toEqual({
      kind: "tool", title: "Used Glob", detail: "**/*.txt", payload: { type: "tool", name: "Glob", input: "**/*.txt" },
    });
    expect(tool("mcp__github__get_issue", { owner: "a", repo: "b" })?.activity)
      .toMatchObject({ kind: "tool", payload: { type: "tool", name: "mcp__github__get_issue", input: "" } });
    // An MCP call names what it acts on: the worker, or the new worker's title or first prompt line.
    expect(tool("mcp__alfred__start_worker", { agent: "codex", prompt: "Run the typecheck\nthen report" })?.activity?.payload)
      .toEqual({ type: "tool", name: "mcp__alfred__start_worker", input: "Run the typecheck" });
    expect(tool("mcp__alfred__start_worker", { agent: "codex", prompt: "Run it", title: "Typecheck" })?.activity?.payload)
      .toMatchObject({ input: "Typecheck" });
    expect(tool("mcp__alfred__read_worker", { worker_id: "codex-1" })?.activity?.payload)
      .toEqual({ type: "tool", name: "mcp__alfred__read_worker", input: "codex-1" });
    // Claude Code loads its deferred tools through ToolSearch; that is its housekeeping, not the agent's work.
    expect(tool("ToolSearch", { query: "select:TaskCreate" })).toEqual({ state: "working" });
    expect(signalFromHook("PostToolUse", {})).toEqual({ state: "working" });
  });

  it("records the edit a Codex patch made under its first file", () => {
    const patch = "*** Begin Patch\n*** Add File: src/tree.ts\n+x\n*** Update File: src/app.tsx\n*** End Patch";
    expect(signalFromHook("PostToolUse", { tool_name: "apply_patch", tool_input: { command: patch } })?.activity?.payload)
      .toEqual({ type: "file", operation: "edited", path: "src/tree.ts" });
  });

  it("records the message you sent, its first line", () => {
    expect(signalFromHook("UserPromptSubmit", { prompt: "\n  Split History into a list\nand a reader" })).toEqual({
      state: "working",
      activity: { kind: "prompt", title: "You asked", detail: "Split History into a list" },
    });
    expect(signalFromHook("UserPromptSubmit", { prompt: "x".repeat(500) })?.activity?.detail).toHaveLength(240);
    expect(signalFromHook("UserPromptSubmit", { prompt: "   " })).toEqual({ state: "working" });
    // Claude Code hands a long paste to the hook wrapped in tags; the message is what is inside.
    expect(signalFromHook("UserPromptSubmit", {
      prompt: '\n\n<pasted_content id="71d3">\nMessage from Alfred (not from the user): 2 of your workers changed.\n'
        + '- "Alpha" (claude-2) finished its turn.\n</pasted_content id="71d3">\n',
    })?.activity).toEqual({ kind: "prompt", title: "Alfred reported", detail: "2 of your workers changed." });
    expect(signalFromHook("UserPromptSubmit", { prompt: 'Look at this:\n<pasted_content id="9a">\nTypeError: x is undefined\n</pasted_content id="9a">' })
      ?.activity).toEqual({ kind: "prompt", title: "You asked", detail: "Look at this:" });
    expect(signalFromHook("UserPromptSubmit", { prompt: '<pasted_content id="9a">\nTypeError: x is undefined\n</pasted_content id="9a">' })
      ?.activity).toEqual({ kind: "prompt", title: "You asked", detail: "TypeError: x is undefined" });
    // A message Alfred typed says whose it is instead of reading as yours.
    expect(signalFromHook("UserPromptSubmit", {
      prompt: 'Message from your orchestrator, Alfred session "Lead" (not from the user):\n\nNow fix the lint.',
    })?.activity).toEqual({ kind: "prompt", title: "Orchestrator asked", detail: "Now fix the lint." });
    expect(signalFromHook("UserPromptSubmit", {
      prompt: 'Message from Alfred (not from the user): your worker "Typecheck" (codex-1) finished its turn.\n- "Typecheck" …',
    })?.activity).toEqual({ kind: "prompt", title: "Alfred reported", detail: 'your worker "Typecheck" (codex-1) finished its turn.' });
  });

  it("names the file a Codex edit approval is about instead of the patch", () => {
    const patch = "*** Begin Patch\n*** Update File: src/session-status.ts\n@@\n-old\n+new\n*** End Patch";
    expect(signalFromHook("PermissionRequest", { tool_name: "apply_patch", tool_input: { command: patch } })).toEqual({
      state: "needs-you",
      detail: "Edit src/session-status.ts",
    });
  });
});

describe.skipIf(process.platform === "win32")("agent signal bridge", () => {
  let dir = "";
  let bridge: AgentSignalBridge | null = null;

  afterEach(async () => {
    await bridge?.close();
    if (dir) await rm(dir, { force: true, recursive: true });
    bridge = null;
    dir = "";
  });

  it("delivers a hook event through the real relay command written into the Claude settings", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    expect(bridge).not.toBeNull();

    const received: Array<[string, AgentSignalUpdate]> = [];
    bridge!.setListener((sessionId, update) => received.push([sessionId, update]));

    const [flag, settingsPath] = bridge!.launchArgs("claude");
    expect(flag).toBe("--settings");
    const settings = JSON.parse(await readFile(settingsPath!, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.PermissionRequest![0]!.hooks[0]!.command;

    await new Promise<void>((resolve, reject) => {
      const child = execFile("sh", ["-c", command], { env: { ...process.env, ...bridge!.env("session-1") } }, (error) =>
        error ? reject(error) : resolve(),
      );
      child.stdin!.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
    });
    await expect.poll(() => received.length).toBe(1);
    expect(received[0]).toEqual(["session-1", { state: "needs-you", detail: "Bash: ls" }]);
  });

  it("exits cleanly when Alfred is not listening", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    const settings = JSON.parse(await readFile(bridge!.launchArgs("claude")[1]!, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    await expect(
      new Promise<void>((resolve, reject) => {
        const child = execFile("sh", ["-c", settings.hooks.Stop![0]!.hooks[0]!.command], {
          env: { ...process.env, ALFRED_HOOK_SOCKET: path.join(dir, "missing"), ALFRED_SESSION_ID: "x" },
        }, (error) => (error ? reject(error) : resolve()));
        child.stdin!.end("{}");
      }),
    ).resolves.toBeUndefined();
  });

  it("adds launch arguments only for claude and codex", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    const codex = bridge!.launchArgs("codex");
    expect(codex.slice(0, 6)).toEqual([
      "-c",
      "tui.notifications=true",
      "-c",
      'tui.notification_method="osc9"',
      "-c",
      'tui.notification_condition="always"',
    ]);
    expect(codex.slice(6).filter((_, index) => index % 2 === 1).map((override) => override.split("=", 1)[0])).toEqual([
      "hooks.UserPromptSubmit",
      "hooks.PermissionRequest",
      "hooks.PostToolUse",
      "hooks.Stop",
    ]);
    // The same definition every launch, so Codex's trust in it lasts.
    expect(bridge!.launchArgs("codex")).toEqual(codex);
    expect(bridge!.launchArgs("npm")).toEqual([]);
    expect(bridge!.launchArgs(undefined)).toEqual([]);
  });

  it("delivers a Codex hook event through the relay command in its launch override", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    const received: Array<[string, AgentSignalUpdate, string | undefined]> = [];
    bridge!.setListener((sessionId, update, transcriptPath) => received.push([sessionId, update, transcriptPath]));

    const override = bridge!.launchArgs("codex").find((arg) => arg.startsWith("hooks.Stop="))!;
    const command = JSON.parse(/command=("(?:[^"\\]|\\.)*")/.exec(override)![1]!) as string;
    const rollout = "/Users/p/.codex/sessions/2026/10/19/rollout-2026-10-19T10-42-49-01a15353.jsonl";
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile("sh", ["-c", command], { env: { ...process.env, ...bridge!.env("codex-1") } }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      child.stdin!.end(JSON.stringify({ hook_event_name: "Stop", turn_id: "t1", transcript_path: rollout, last_assistant_message: "Done" }));
    });
    await expect.poll(() => received.length).toBe(1);
    // The rollout is where Codex keeps the paths of the images it shows as [Image #1].
    expect(received[0]).toEqual(["codex-1", { state: "your-turn", detail: "Done", answer: "Done" }, rollout]);
    // Codex adds a UserPromptSubmit hook's plain output to the model's context, so the relay prints nothing.
    expect(output).toBe("");
  });

  it("gives a top-level agent Alfred's worker tools, and a worker none", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    const settingsPath = bridge!.launchArgs("claude")[1]!;
    const lead = bridge!.launchArgs("claude", { id: "session-1", worker: false });
    // --mcp-config takes several values; --settings after it keeps the prompt out of its list.
    expect(lead).toEqual(["--mcp-config", expect.any(String), "--settings", settingsPath]);
    expect(JSON.parse(lead[1]!)).toEqual({
      mcpServers: {
        alfred: {
          type: "stdio",
          command: process.execPath,
          args: [path.join(dir, "d", "alfred-mcp.cjs"), path.join(dir, "s"), "session-1"],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    });
    expect(bridge!.launchArgs("claude", { id: "session-2", worker: true })).toEqual(["--settings", settingsPath]);
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { permissions: { allow: string[] } };
    expect(settings.permissions.allow).toEqual(["mcp__alfred"]);
    expect(bridge!.env("session-1", "claude")).toMatchObject({ MCP_TOOL_TIMEOUT: "150000" });
    expect(bridge!.env("session-1", "codex")).not.toHaveProperty("MCP_TOOL_TIMEOUT");

    const codex = bridge!.launchArgs("codex", { id: "session-3", worker: false });
    expect(codex.slice(0, -10)).toEqual(bridge!.launchArgs("codex"));
    expect(codex.slice(-10)).toEqual([
      "-c", `mcp_servers.alfred.command=${JSON.stringify(process.execPath)}`,
      "-c", `mcp_servers.alfred.args=${JSON.stringify([path.join(dir, "d", "alfred-mcp.cjs"), path.join(dir, "s"), "session-3"])}`,
      "-c", 'mcp_servers.alfred.env={ELECTRON_RUN_AS_NODE="1"}',
      "-c", "mcp_servers.alfred.tool_timeout_sec=150",
      "-c", 'mcp_servers.alfred.default_tools_approval_mode="approve"',
    ]);
    expect(bridge!.launchArgs("codex", { id: "session-4", worker: true })).toEqual(bridge!.launchArgs("codex"));
  });

  it("serves the worker tools over MCP and answers each call through Alfred", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    const calls: unknown[][] = [];
    bridge!.setToolHandler(async (sessionId, tool, args) => {
      calls.push([sessionId, tool, args]);
      if (tool === "send_to_worker") throw new Error("The worker is working.");
      return { worker_id: "codex-1" };
    });
    const server = mcpClient(JSON.parse(bridge!.launchArgs("claude", { id: "session-1", worker: false })[1]!));

    expect(await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }))
      .toMatchObject({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "alfred" } } });
    server.notify("notifications/initialized");
    const listed = await server.request("tools/list", {}) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name))
      .toEqual(["start_worker", "list_workers", "read_worker", "wait_for_worker", "send_to_worker", "stop_worker"]);
    expect(await server.request("tools/call", { name: "start_worker", arguments: { agent: "codex", prompt: "Run it" } })).toMatchObject({
      result: { content: [{ type: "text", text: JSON.stringify({ worker_id: "codex-1" }, null, 2) }] },
    });
    expect(await server.request("tools/call", { name: "send_to_worker", arguments: { worker_id: "codex-1", message: "x" } })).toMatchObject({
      result: { content: [{ type: "text", text: "The worker is working." }], isError: true },
    });
    expect(await server.request("resources/list", {})).toMatchObject({ error: { code: -32601 } });
    expect(calls).toEqual([
      ["session-1", "start_worker", { agent: "codex", prompt: "Run it" }],
      ["session-1", "send_to_worker", { worker_id: "codex-1", message: "x" }],
    ]);

    // Hooks keep arriving on the same socket.
    const received: AgentSignalUpdate[] = [];
    bridge!.setListener((_sessionId, update) => received.push(update));
    const settings = JSON.parse(await readFile(bridge!.launchArgs("claude")[1]!, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    await new Promise<void>((resolve, reject) => {
      const child = execFile("sh", ["-c", settings.hooks.Stop![0]!.hooks[0]!.command], { env: { ...process.env, ...bridge!.env("session-1") } },
        (error) => (error ? reject(error) : resolve()));
      child.stdin!.end(JSON.stringify({ last_assistant_message: "Done" }));
    });
    await expect.poll(() => received).toEqual([{ state: "your-turn", detail: "Done", answer: "Done" }]);
    server.close();
  });

  it("tells the agent when Alfred is not there instead of failing it", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "as-"));
    bridge = await createAgentSignalBridge({ dir: path.join(dir, "d"), execPath: process.execPath, socketPath: path.join(dir, "s") });
    const config = JSON.parse(bridge!.launchArgs("claude", { id: "session-1", worker: false })[1]!) as McpConfig;
    await bridge!.close();
    bridge = null;
    const server = mcpClient(config);
    expect(await server.request("tools/call", { name: "list_workers", arguments: {} })).toMatchObject({
      result: { content: [{ type: "text", text: "Alfred is not reachable. It may have quit." }], isError: true },
    });
    server.close();
  });
});

type McpConfig = { mcpServers: { alfred: { args: string[]; command: string; env: Record<string, string> } } };

/** Talks to the generated MCP server the way Claude Code and Codex do: one JSON-RPC message per line on stdio. */
function mcpClient(config: McpConfig) {
  const { command, args, env } = config.mcpServers.alfred;
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
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
  return {
    request: (method: string, params: unknown) => new Promise<unknown>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    }),
    notify: (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    close: () => child.stdin.end(),
  };
}
