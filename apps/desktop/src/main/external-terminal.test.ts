import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { externalTerminalLaunch, openExternalTerminal } from "./external-terminal.js";

let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-external-terminal-"));
});

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("external-terminal", () => {
  it("builds a Ghostty launch command on macOS by default", () => {
    expect(externalTerminalLaunch("/repo/Alfred", { platform: "darwin", env: {} })).toEqual({
      command: "open",
      args: ["-a", "Ghostty", "/repo/Alfred"],
      terminal: "Ghostty",
    });
  });

  it("allows the macOS terminal app to be overridden by env", () => {
    expect(
      externalTerminalLaunch("/repo/Alfred", {
        platform: "darwin",
        env: { ALFRED_EXTERNAL_TERMINAL_APP: "Terminal" },
      }),
    ).toEqual({
      command: "open",
      args: ["-a", "Terminal", "/repo/Alfred"],
      terminal: "Terminal",
    });
  });

  it("builds platform launch commands for Windows and Linux", () => {
    expect(externalTerminalLaunch("C:\\repo\\Alfred", { platform: "win32" })).toEqual({
      command: "wt.exe",
      args: ["-d", "C:\\repo\\Alfred"],
      terminal: "Windows Terminal",
    });
    expect(externalTerminalLaunch("/repo/Alfred", { platform: "linux" })).toEqual({
      command: "xdg-terminal-exec",
      args: ["--dir=/repo/Alfred"],
      terminal: "system terminal",
    });
  });

  it("opens an existing directory with the platform launcher", async () => {
    const spawned = vi.fn((_command, _args, _options) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    await expect(
      openExternalTerminal(
        { cwd: temporaryDirectory },
        { platform: "darwin", env: {}, spawnImpl: spawned as never },
      ),
    ).resolves.toEqual({
      ok: true,
      resolvedPath: temporaryDirectory,
      terminal: "Ghostty",
    });
    expect(spawned).toHaveBeenCalledWith("open", ["-a", "Ghostty", temporaryDirectory], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("rejects invalid or missing directories without spawning", async () => {
    const spawned = vi.fn();

    await expect(openExternalTerminal(null, { spawnImpl: spawned as never })).resolves.toEqual({
      ok: false,
      error: "Invalid external terminal request.",
    });
    await expect(openExternalTerminal({ cwd: " " }, { spawnImpl: spawned as never })).resolves.toEqual({
      ok: false,
      error: "No cwd to open.",
    });
    await expect(openExternalTerminal({ cwd: path.join(temporaryDirectory, "missing") }, { spawnImpl: spawned as never })).resolves.toEqual({
      ok: false,
      error: "Directory does not exist.",
      resolvedPath: path.join(temporaryDirectory, "missing"),
    });
    expect(spawned).not.toHaveBeenCalled();
  });
});
