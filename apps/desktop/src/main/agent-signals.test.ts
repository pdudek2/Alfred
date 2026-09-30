import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentSignalBridge,
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
    expect(bridge!.launchArgs("codex")).toEqual(["-c", "tui.notifications=true", "-c", 'tui.notification_method="osc9"']);
    expect(bridge!.launchArgs("npm")).toEqual([]);
    expect(bridge!.launchArgs(undefined)).toEqual([]);
  });
});
