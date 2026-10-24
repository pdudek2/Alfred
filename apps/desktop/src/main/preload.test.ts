import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { TerminalApi } from "../shared/terminal-ipc.js";

// The sandboxed preload is CommonJS; run its real source against a fake electron module.
function loadPreload() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const exposed: Record<string, unknown> = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; } },
    webUtils: { getPathForFile: () => "" },
    ipcRenderer: {
      invoke: () => Promise.resolve(),
      send: () => {},
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, (listeners.get(channel) ?? new Set()).add(listener));
      },
      off: (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener);
      },
    },
  };
  const source = readFileSync(resolve(process.cwd(), "src/main/preload.cts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function("require", "exports", outputText)((name: string) => (name === "electron" ? electron : {}), {});
  return { listeners, terminal: (exposed.alfredDesktop as { terminal: TerminalApi }).terminal };
}

describe("preload terminal events", () => {
  it("keeps one IPC listener per channel however many terminals subscribe", () => {
    const { listeners, terminal } = loadPreload();
    const received: number[] = [];
    const unsubscribe = Array.from({ length: 12 }, (_, index) => [
      terminal.onData(() => received.push(index)),
      terminal.onExit(() => {}),
    ]).flat();

    expect(listeners.get("alfred:terminal:data")?.size).toBe(1);
    expect(listeners.get("alfred:terminal:exit")?.size).toBe(1);
    for (const listener of listeners.get("alfred:terminal:data") ?? []) listener({}, { id: "t1", data: "x", activities: [] });
    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    unsubscribe.forEach((stop) => stop());
    expect(listeners.get("alfred:terminal:data")?.size ?? 0).toBe(0);
    expect(listeners.get("alfred:terminal:exit")?.size ?? 0).toBe(0);
  });
});
