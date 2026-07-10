import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
import {
  isAllowedElectronMainOutput,
  isAllowedElectronWarning,
  isPgrepNoChildren,
} from "./electron-harness-pure";

const execFileAsync = promisify(execFile);
const desktopRoot = path.resolve(import.meta.dirname, "../..");

type RuntimeMessage = {
  source: "main-stderr" | "main-stdout" | "pageerror" | "renderer";
  level: "error" | "warning";
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
    try {
      await mkdir(diagnosticDir, { recursive: true });
    } catch (error) {
      await rm(paths.root, { recursive: true, force: true });
      throw error;
    }

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
    for (const window of app.windows()) instrumentPage(window);

    const mainProcess = app.process();
    mainProcess.stdout?.on("data", (chunk: Buffer) => {
      messages.push(runtimeMessage("main-stdout", "error", chunk.toString("utf8")));
    });
    mainProcess.stderr?.on("data", (chunk: Buffer) => {
      messages.push(runtimeMessage("main-stderr", "error", chunk.toString("utf8")));
    });

    let page: Page;
    try {
      const actualUserData = await app.evaluate(({ app: electronApp }) =>
        electronApp.getPath("userData"),
      );
      expect(await realpath(actualUserData)).toBe(await realpath(paths.userData));
      page = await app.firstWindow();
      instrumentPage(page);
    } catch (error) {
      const processCleanup = await stopElectronApplication(app, mainProcess.pid);
      try {
        await writeDiagnostics(messages, processCleanup, diagnosticDir);
        await attachDiagnostics(testInfo, diagnosticDir);
      } finally {
        if (processCleanup.alive.length === 0) {
          await rm(paths.root, { recursive: true, force: true });
        }
      }
      if (!processCleanup.clean) {
        throw new Error(`Electron setup cleanup failed: ${JSON.stringify(processCleanup)}`, { cause: error });
      }
      throw error;
    }

    let closeAttempt: Promise<void> | null = null;
    const assertNoRuntimeErrors = (): void => {
      const forbidden = messages.filter((message) => {
        if (message.text.trim().length === 0) return false;
        if (
          message.source === "renderer" &&
          message.level === "warning" &&
          isAllowedElectronWarning(message.text)
        ) {
          return false;
        }
        if (
          (message.source === "main-stderr" || message.source === "main-stdout") &&
          isAllowedElectronMainOutput(message.text)
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
        await closeButtons.first().click({ force: true });
        await expect(terminalTiles).toHaveCount(before - 1);
      }
    };

    const performClose = async (): Promise<void> => {
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
      try {
        await writeDiagnostics(messages, cleanup, diagnosticDir);
        await attachDiagnostics(testInfo, diagnosticDir);
      } finally {
        if (processCleanup.alive.length === 0) {
          await rm(paths.root, { recursive: true, force: true });
        }
      }

      let runtimeError: unknown = null;
      try {
        assertNoRuntimeErrors();
      } catch (error) {
        runtimeError = error;
      }
      if (!cleanup.clean) {
        throw new Error(`Electron cleanup failed: ${JSON.stringify(cleanup)}`, { cause: runtimeError });
      }
      if (runtimeError !== null) throw runtimeError;
    };

    const close = (): Promise<void> => {
      if (closeAttempt !== null) return closeAttempt;
      closeAttempt = performClose().catch((error: unknown) => {
        closeAttempt = null;
        throw error;
      });
      return closeAttempt;
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
    "PATH",
    "SHELL",
    "TERM",
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
    TMPDIR: paths.root,
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
  } catch (error) {
    if (isPgrepNoChildren(error)) return [];
    throw new Error(`Failed to discover descendants for Electron PID ${parentPid}.`, { cause: error });
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
  descendantDiscoveryError: string | null;
  requiredSignalFallback: boolean;
  usedSigkill: boolean;
  clean: boolean;
}> {
  let descendants: number[] = [];
  let descendantDiscoveryError: string | null = null;
  if (mainPid !== undefined) {
    try {
      descendants = await collectDescendants(mainPid);
    } catch (error) {
      descendantDiscoveryError = safeError(error);
    }
  }
  let closePromise: Promise<string>;
  try {
    closePromise = app.close().then(
      () => "closed",
      (error: unknown) => `close-error: ${safeError(error)}`,
    );
  } catch (error) {
    closePromise = Promise.resolve(`close-error: ${safeError(error)}`);
  }
  let closeResult = await withTimeout(closePromise, 5_000, "close-timeout");
  const trackedPids = [mainPid, ...descendants].filter((pid): pid is number => pid !== undefined);
  const aliveAfterClose = trackedPids.filter(isAlive);
  const requiredSignalFallback = aliveAfterClose.length > 0;
  let usedSigkill = false;
  if (requiredSignalFallback) {
    terminate([...aliveAfterClose].reverse(), "SIGTERM");
    const terminated = await waitUntilDead(aliveAfterClose, 2_000);
    if (!terminated) {
      usedSigkill = true;
      terminate([...aliveAfterClose].reverse(), "SIGKILL");
      await waitUntilDead(aliveAfterClose, 1_000);
      closeResult = `${closeResult}; sigkill-fallback`;
    }
  }
  const alive = trackedPids.filter(isAlive);
  return {
    mainPid,
    descendants,
    alive,
    closeResult,
    descendantDiscoveryError,
    requiredSignalFallback,
    usedSigkill,
    clean:
      alive.length === 0 &&
      closeResult === "closed" &&
      descendantDiscoveryError === null &&
      !requiredSignalFallback,
  };
}

function terminate(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of [...new Set(pids)]) {
    try {
      process.kill(pid, signal);
    } catch {
      // The final liveness check records any process that did not exit.
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
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
