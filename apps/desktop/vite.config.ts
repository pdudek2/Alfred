import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const desktopPort = readPort(process.env.DESKTOP_PORT, 4310);

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/renderer/test-setup.ts"],
  },
  build: {
    outDir: "dist/renderer",
  },
  server: {
    host: "127.0.0.1",
    port: desktopPort,
  },
});

function readPort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}
