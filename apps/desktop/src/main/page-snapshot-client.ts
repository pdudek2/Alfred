import { app, nativeImage, type NativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "page-snapshot-worker.js");
// Counted from the moment the process says it is ready. The drawing gives up on a page after 8 s; past this, the
// process itself is stuck. Starting up gets as long again.
const STUCK_MS = 10_000;
// A worker costs a few hundred megabytes; one that sat idle this long is closed and started again when needed.
const IDLE_MS = 60_000;

type Answer = { png?: string | undefined; error?: string | undefined };
type Worker = {
  child: ChildProcess;
  profile: string;
  ready: Promise<void>;
  answers: Map<number, (answer: Answer) => void>;
};

let worker: Worker | null = null;
let nextId = 0;
let idle: NodeJS.Timeout | undefined;
let drawing: Promise<unknown> = Promise.resolve();
let quitHooked = false;

/**
 * An HTML or SVG file as a browser shows it, drawn in a process of its own so that no page can stop Alfred.
 * Pages are drawn one at a time, in the order asked.
 * shortcut: the worker runs as a script of the Electron binary Alfred runs on, which a packaged build does not allow;
 * a packaged build needs it as a helper app or a flag of its own.
 */
export function pageSnapshot(filePath: string): Promise<NativeImage> {
  const turn = drawing.then(() => draw(filePath));
  drawing = turn.catch(() => undefined);
  return turn;
}

async function draw(filePath: string): Promise<NativeImage> {
  // A packaged Alfred would start another copy of itself here instead of the worker.
  if (app.isPackaged) throw new Error("Pages are not drawn in a packaged build.");
  clearTimeout(idle);
  const current = worker ?? startWorker();
  const id = nextId++;
  try {
    await withinLimit(current, current.ready);
    const answer = await withinLimit(current, new Promise<Answer>((resolve) => {
      current.answers.set(id, resolve);
      current.child.stdin?.write(`${JSON.stringify({ id, path: filePath })}\n`);
    }));
    if (answer.error !== undefined || !answer.png) throw new Error(answer.error ?? "The page drew nothing.");
    return nativeImage.createFromBuffer(Buffer.from(answer.png, "base64"));
  } finally {
    current.answers.delete(id);
    if (worker === current) idle = setTimeout(() => closeWorker(current), IDLE_MS);
  }
}

/** `step`, or the worker killed when it has not answered in time. */
async function withinLimit<T>(current: Worker, step: Promise<T>): Promise<T> {
  let stuck: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    stuck = setTimeout(() => {
      stopWorker(current);
      reject(new Error("The page stopped the drawing process."));
    }, STUCK_MS);
  });
  try {
    return await Promise.race([step, limit]);
  } finally {
    clearTimeout(stuck);
  }
}

function startWorker(): Worker {
  if (!quitHooked) {
    quitHooked = true;
    // Alfred may be gone before the worker's exit is reported, so its profile goes now.
    app.on("will-quit", () => {
      if (!worker) return;
      const { profile } = worker;
      stopWorker(worker);
      rmSync(profile, { recursive: true, force: true });
    });
  }
  // Its own profile, made and removed here, so a worker that had to be killed leaves nothing behind either.
  const profile = mkdtempSync(path.join(os.tmpdir(), "alfred-page-snapshot-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [WORKER, profile], { env, stdio: ["pipe", "pipe", "ignore"] });
  let markReady = () => {};
  let markFailed = (_error: Error) => {};
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  ready.catch(() => undefined);
  const started: Worker = { child, profile, ready, answers: new Map() };
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let message: Answer & { id?: unknown; ready?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (message.ready === true) markReady();
    else if (typeof message.id === "number") started.answers.get(message.id)?.({ png: message.png, error: message.error });
  });
  const ended = () => {
    if (worker === started) worker = null;
    markFailed(new Error("The drawing process ended."));
    for (const resolve of started.answers.values()) resolve({ error: "The drawing process ended." });
    rmSync(profile, { recursive: true, force: true });
  };
  child.on("exit", ended);
  child.on("error", ended);
  child.stdin?.on("error", () => undefined);
  worker = started;
  return started;
}

/** Lets the process finish what it was asked and quit. */
function closeWorker(closed: Worker): void {
  if (worker === closed) worker = null;
  closed.child.stdin?.end();
}

/** Ends a stuck process this module started: it holds nothing worth keeping, and only SIGKILL reaches a main thread a modal panel holds. */
function stopWorker(stopped: Worker): void {
  if (worker === stopped) worker = null;
  stopped.child.kill("SIGKILL");
}
