import { app, nativeImage, type NativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "page-snapshot-worker.js");
// The drawing gives up on a page after 8 s; past that, the process itself is stuck.
const STUCK_MS = 10_000;
// A worker costs a few hundred megabytes; one that sat idle this long is closed and started again when needed.
const IDLE_MS = 60_000;

type Answer = { png?: string | undefined; error?: string | undefined };
type Worker = { child: ChildProcess; answers: Map<number, (answer: Answer) => void> };

let worker: Worker | null = null;
let nextId = 0;
let idle: NodeJS.Timeout | undefined;
let drawing: Promise<unknown> = Promise.resolve();
let quitHooked = false;

/**
 * An HTML or SVG file as a browser shows it, drawn in a process of its own so that no page can stop Alfred.
 * Pages are drawn one at a time, in the order asked.
 * shortcut: the worker runs as a script of the Electron binary Alfred runs on, which a packaged build would not allow;
 * a packaged build needs it as a helper app or a flag of its own.
 */
export function pageSnapshot(filePath: string): Promise<NativeImage> {
  const turn = drawing.then(() => draw(filePath));
  drawing = turn.catch(() => undefined);
  return turn;
}

async function draw(filePath: string): Promise<NativeImage> {
  clearTimeout(idle);
  const current = worker ?? startWorker();
  const id = nextId++;
  let stuck: NodeJS.Timeout | undefined;
  try {
    const answer = await new Promise<Answer>((resolve, reject) => {
      current.answers.set(id, resolve);
      stuck = setTimeout(() => {
        stopWorker(current);
        reject(new Error("The page stopped the drawing process."));
      }, STUCK_MS);
      current.child.stdin?.write(`${JSON.stringify({ id, path: filePath })}\n`);
    });
    if (answer.error !== undefined || !answer.png) throw new Error(answer.error ?? "The page drew nothing.");
    return nativeImage.createFromBuffer(Buffer.from(answer.png, "base64"));
  } finally {
    clearTimeout(stuck);
    current.answers.delete(id);
    if (worker === current) idle = setTimeout(() => closeWorker(current), IDLE_MS);
  }
}

function startWorker(): Worker {
  if (!quitHooked) {
    quitHooked = true;
    app.on("will-quit", () => {
      if (worker) (worker.answers.size > 0 ? stopWorker : closeWorker)(worker);
    });
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [WORKER], { env, stdio: ["pipe", "pipe", "ignore"] });
  const started: Worker = { child, answers: new Map() };
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let answer: Answer & { id?: unknown };
    try {
      answer = JSON.parse(line) as typeof answer;
    } catch {
      return;
    }
    if (typeof answer.id === "number") started.answers.get(answer.id)?.({ png: answer.png, error: answer.error });
  });
  const fail = () => {
    if (worker === started) worker = null;
    for (const resolve of started.answers.values()) resolve({ error: "The drawing process ended." });
  };
  child.on("exit", fail);
  child.on("error", fail);
  child.stdin?.on("error", () => undefined);
  worker = started;
  return started;
}

/** Lets the process finish what it was asked and quit, removing its profile. */
function closeWorker(closed: Worker): void {
  if (worker === closed) worker = null;
  closed.child.stdin?.end();
}

/**
 * Ends a stuck process this module started: it holds nothing worth keeping, and only SIGKILL reaches a main thread
 * a modal panel holds. shortcut: its temporary profile stays behind for the system to clear.
 */
function stopWorker(stopped: Worker): void {
  if (worker === stopped) worker = null;
  stopped.child.kill("SIGKILL");
}
