import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { killAllTerminalSessions, registerTerminalIpc } from "./terminal-manager.js";
import { registerAlfredIpc } from "./alfred-orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

// Load repo-root .env before any IPC registration so OPENROUTER_API_KEY is visible.
// Repo root is two levels up from app.getAppPath() (apps/desktop) — same logic as
// terminal-manager.ts:defaultTerminalCwd().
loadDotenv({ path: path.resolve(app.getAppPath(), "../..", ".env") });

registerTerminalIpc();
registerAlfredIpc();

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Alfred Agent Space",
    backgroundColor: "#050607",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL!);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killAllTerminalSessions();
});
