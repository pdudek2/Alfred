import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { redactText } from "@alfred/schema";
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  createDesktopFixture,
  type DesktopFixtureOptions,
  type DesktopFixturePaths,
} from "./desktop-state-fixture";

const execFileAsync = promisify(execFile);
const desktopRoot = path.resolve(import.meta.dirname, "../..");
const ALLOWED_ELECTRON_WARNING_PREFIX =
  "Electron Security Warning (Insecure Content-Security-Policy)";

type RuntimeMessage = {
  source: "main-stderr" | "main-stdout" | "pageerror" | "renderer";
  level: "error" | "info" | "warning";
  text: string;
};

export type ElectronHarness = {
  app: ElectronApplication;
  page: Page;
  paths: DesktopFixturePaths;
  marker: string;
  assertNoRuntimeErrors(): void;
  closeActiveTerminals(): Promise<void>;
  close(): Promise<void>;
};

type Fixtures = {
  fixtureOptions: DesktopFixtureOptions;
  harness: ElectronHarness;
};

export const test = base.extend<Fixtures>({
  fixtureOptions: [{}, { option: true }],
  harness: async ({ fixtureOptions }, use, testInfo) => {
    const { paths } = await createDesktopFixture(fixtureOptions);
    const marker = `ALFRED_E2E_${randomUUID()}`;
    const messages: RuntimeMessage[] = [];
    const diagnosticDir = testInfo.outputPath("diagnostics");
    await mkdir(diagnosticDir, { recursive: true });

    let app: ElectronApplication;
    try {
      app = await electron.launch({
        args: [desktopRoot, `--user-data-dir=${paths.userData}`],
        artifactsDir: paths.artifacts,
        cwd: desktopRoot,
        env: electronEnvironment(paths),
      });
    } catch (error) {
      await rm(paths.root, { recursive: true, force: true });
      throw error;
    }
    const mainProcess = app.process();
    mainProcess.stdout?.on("data", (chunk: Buffer) => {
      messages.push(runtimeMessage("main-stdout", "info", chunk.toString("utf8")));
    });
    mainProcess.stderr?.on("data", (chunk: Buffer) => {
      messages.push(runtimeMessage("main-stderr", "error", chunk.toString("utf8")));
    });

    const instrumentedPages = new WeakSet<Page>();
    const instrumentPage = (window: Page): void => {
      if (instrumentedPages.has(window)) return;
      instrumentedPages.add(window);
      window.on("pageerror", (error) => {
        messages.push(runtimeMessage("pageerror", "error", error.stack ?? error.message));
      });
      window.on("console", (message) => {
        if (message.type() !== "error" && message.type() !== "warning") return;
        messages.push(
          runtimeMessage(
            "renderer",
            message.type() === "error" ? "error" : "warning",
            message.text(),
          ),
        );
      });
    };
    app.on("window", instrumentPage);

    let page: Page;
    try {
      const actualUserData = await app.evaluate(({ app: electronApp }) =>
        electronApp.getPath("userData"),
      );
      expect(actualUserData).toBe(paths.userData);
      page = await app.firstWindow();
      instrumentPage(page);
    } catch (error) {
      const processCleanup = await stopElectronApplication(app, mainProcess.pid);
      await writeDiagnostics(messages, processCleanup, diagnosticDir);
      await attachDiagnostics(testInfo, diagnosticDir);
      if (processCleanup.alive.length === 0) {
        await rm(paths.root, { recursive: true, force: true });
      }
      if (!processCleanup.clean) {
        throw new Error(`Electron setup cleanup failed: ${JSON.stringify(processCleanup)}`, { cause: error });
      }
      throw error;
    }

    let closed = false;
    const assertNoRuntimeErrors = (): void => {
      const forbidden = messages.filter((message) => {
        const text = message.text.trimStart();
        if (
          message.source === "renderer" &&
          message.level === "warning" &&
          text.startsWith(ALLOWED_ELECTRON_WARNING_PREFIX)
        ) {
          return false;
        }
        return message.level === "error" || message.level === "warning";
      });
      if (forbidden.length > 0) {
        throw new Error(
          `Forbidden Electron runtime output:\n${forbidden
            .map((message) => `[${message.source}/${message.level}] ${message.text}`)
            .join("\n")}`,
        );
      }
    };

    const closeActiveTerminals = async (): Promise<void> => {
      if (page.isClosed()) return;

      const workSurface = page.getByRole("button", { name: "Open Work surface" });
      if ((await workSurface.count()) > 0 && (await workSurface.getAttribute("aria-current")) !== "page") {
        await workSurface.click();
      }
      const gridMode = page.getByRole("button", { name: "Grid", exact: true }).first();
      if ((await gridMode.count()) > 0 && (await gridMode.getAttribute("aria-pressed")) !== "true") {
        await gridMode.click();
      }

      const terminalTiles = page.getByTestId("terminal-tile");
      const closeButtons = terminalTiles.getByRole("button", { name: /^Close / });
      while ((await closeButtons.count()) > 0) {
        const before = await terminalTiles.count();
        await closeButtons.first().click();
        await expect(terminalTiles).toHaveCount(before - 1);
      }
    };

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;

      let uiCleanupError: string | null = null;
      try {
        await closeActiveTerminals();
      } catch (error) {
        uiCleanupError = safeError(error);
      }

      const processCleanup = await stopElectronApplication(app, mainProcess.pid);
      const cleanup = {
        ...processCleanup,
        uiCleanupError,
        clean: processCleanup.clean && uiCleanupError === null,
      };
      await writeDiagnostics(messages, cleanup, diagnosticDir);
      await attachDiagnostics(testInfo, diagnosticDir);

      let runtimeError: unknown = null;
      try {
        assertNoRuntimeErrors();
      } catch (error) {
        runtimeError = error;
      }
      if (processCleanup.alive.length === 0) {
        await rm(paths.root, { recursive: true, force: true });
      }
      if (!cleanup.clean) {
        throw new Error(`Electron cleanup failed: ${JSON.stringify(cleanup)}`, { cause: runtimeError });
      }
      if (runtimeError !== null) throw runtimeError;
    };

    try {
      await use({ app, page, paths, marker, assertNoRuntimeErrors, closeActiveTerminals, close });
      assertNoRuntimeErrors();
    } finally {
      if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
        try {
          await page.screenshot({ path: path.join(diagnosticDir, "last-window.png") });
        } catch (error) {
          messages.push(runtimeMessage("pageerror", "error", `Final screenshot failed: ${safeError(error)}`));
        }
      }
      await close();
    }
  },
});

export { expect };

function electronEnvironment(paths: DesktopFixturePaths): Record<string, string> {
  const inheritedKeys = [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
    "XAUTHORITY",
  ];
  const env = Object.fromEntries(
    inheritedKeys.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  return {
    ...env,
    HOME: paths.home,
    ZDOTDIR: paths.home,
    XDG_CONFIG_HOME: path.join(paths.home, ".config"),
    ALFRED_DESKTOP_WORKSPACE_CWD: paths.workspaceA,
    ALFRED_CODEX_HOME: path.join(paths.home, ".codex"),
    CODEX_HOME: path.join(paths.home, ".codex"),
    ALFRED_CLAUDE_HOME: path.join(paths.home, ".claude"),
    CLAUDE_CONFIG_DIR: path.join(paths.home, ".claude"),
    OPENROUTER_API_KEY: "",
  };
}

function runtimeMessage(
  source: RuntimeMessage["source"],
  level: RuntimeMessage["level"],
  text: string,
): RuntimeMessage {
  return { source, level, text: redactText(text) };
}

function safeError(error: unknown): string {
  return redactText(error instanceof Error ? (error.stack ?? error.message) : String(error));
}

async function collectDescendants(parentPid: number): Promise<number[]> {
  let direct: number[];
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(parentPid)]);
    direct = stdout
      .split("\n")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter(Number.isInteger);
  } catch {
    return [];
  }
  const nested = await Promise.all(direct.map(collectDescendants));
  return [...direct, ...nested.flat()];
}

async function stopElectronApplication(
  app: ElectronApplication,
  mainPid: number | undefined,
): Promise<{
  mainPid: number | undefined;
  descendants: number[];
  alive: number[];
  closeResult: string;
  usedSigkill: boolean;
  clean: boolean;
}> {
  const descendants = mainPid === undefined ? [] : await collectDescendants(mainPid);
  const closePromise = app.close().then(
    () => "closed",
    (error: unknown) => `close-error: ${safeError(error)}`,
  );
  let closeResult = await withTimeout(closePromise, 5_000, "close-timeout");
  let usedSigkill = false;
  if (closeResult !== "closed" && mainPid !== undefined) {
    terminate([...descendants].reverse().concat(mainPid), "SIGTERM");
    const terminated = await waitUntilDead([mainPid, ...descendants], 2_000);
    if (!terminated) {
      usedSigkill = true;
      terminate([...descendants].reverse().concat(mainPid), "SIGKILL");
      await waitUntilDead([mainPid, ...descendants], 1_000);
      closeResult = `${closeResult}; sigkill-fallback`;
    }
  }
  const alive = [mainPid, ...descendants]
    .filter((pid): pid is number => pid !== undefined)
    .filter(isAlive);
  return {
    mainPid,
    descendants,
    alive,
    closeResult,
    usedSigkill,
    clean: alive.length === 0 && closeResult === "closed",
  };
}

function terminate(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of [...new Set(pids)]) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process already exited between discovery and termination.
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isAlive(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pids.every((pid) => !isAlive(pid));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs)),
  ]);
}

async function writeDiagnostics(
  messages: RuntimeMessage[],
  cleanup: Record<string, unknown>,
  diagnosticDir: string,
): Promise<void> {
  const rendererLog = messages
    .filter((message) => message.source === "renderer" || message.source === "pageerror")
    .map((message) => `[${message.source}/${message.level}] ${message.text}`)
    .join("\n");
  const mainLog = messages
    .filter((message) => message.source.startsWith("main-"))
    .map((message) => `[${message.source}/${message.level}] ${message.text}`)
    .join("\n");
  await Promise.all([
    writeFile(path.join(diagnosticDir, "renderer.log"), `${rendererLog}\n`, "utf8"),
    writeFile(path.join(diagnosticDir, "main.log"), `${mainLog}\n`, "utf8"),
    writeFile(
      path.join(diagnosticDir, "cleanup-status.json"),
      `${JSON.stringify(cleanup, null, 2)}\n`,
      "utf8",
    ),
  ]);
}

async function attachDiagnostics(testInfo: TestInfo, diagnosticDir: string): Promise<void> {
  for (const name of ["renderer.log", "main.log", "cleanup-status.json", "last-window.png"]) {
    const file = path.join(diagnosticDir, name);
    try {
      await access(file);
    } catch {
      if (name === "last-window.png") continue;
      throw new Error(`Required Electron diagnostic is missing: ${name}`);
    }
    await testInfo.attach(name, { path: file });
  }
}
