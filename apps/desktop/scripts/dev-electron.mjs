import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const electron = require("electron");

const port = readPort(process.env.DESKTOP_PORT, 4310);
const child = spawn(electron, ["."], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: `http://127.0.0.1:${port}`,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function readPort(value, fallback) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}
