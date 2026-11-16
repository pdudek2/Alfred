// The page drawing process: an Electron app of its own, started by page-snapshot-client.ts. A page that blocks this
// process (print() opens a modal panel that stops its main thread) blocks only this one, which Alfred then kills.
// Protocol: one JSON request per stdin line, { id, path }; one JSON answer per stdout line, { id, png } or { id, error }.
import { app } from "electron";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { drawPage } from "./page-snapshot.js";

// Its own profile, so it never shares Alfred's user data or leaves anything behind.
const profile = mkdtempSync(path.join(os.tmpdir(), "alfred-page-snapshot-"));
app.setPath("userData", profile);
app.on("will-quit", () => rmSync(profile, { recursive: true, force: true }));
app.dock?.hide();
app.on("window-all-closed", () => undefined);

// Electron fires "ready" only after an ES module entry has finished, so the module must not wait for it.
void app.whenReady().then(() => {
  let queue: Promise<void> = Promise.resolve();
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    queue = queue.then(() => answer(line));
  });
  lines.on("close", () => void queue.then(() => app.quit()));
});

async function answer(line: string): Promise<void> {
  let id: unknown;
  try {
    const request = JSON.parse(line) as { id?: unknown; path?: unknown };
    id = request.id;
    if (typeof request.path !== "string") throw new Error("No path to draw.");
    const png = await drawPage(request.path);
    process.stdout.write(`${JSON.stringify({ id, png: png.toString("base64") })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}
