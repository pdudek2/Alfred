import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { expect } from "@playwright/test";

export type LaunchedAgent = { args: string[]; sessionId: string; socketPath: string };

/** The fixture agent writes what Alfred launched it with and where its hooks report; waits for one that matches. */
export async function launchedAgent(root: string, agent: string, matches: (args: string[]) => boolean): Promise<LaunchedAgent> {
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

/** Sends one hook the way the relay does. */
export function sendHook(agent: LaunchedAgent, event: string, payload: Record<string, unknown>): Promise<void> {
  const message = JSON.stringify({ sessionId: agent.sessionId, event, payload: JSON.stringify({ hook_event_name: event, ...payload }) });
  return new Promise((resolve, reject) => {
    const socket = net.connect(agent.socketPath, () => socket.end(`${message}\n`));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}
