import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const desktopPort = readPort(process.env.DESKTOP_PORT, 4310);

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/renderer/**/*.test.{ts,tsx}", "e2e/**/*.unit.test.ts"],
          setupFiles: ["./src/renderer/test-setup.ts"],
        },
      },
      {
        extends: true,
        // The main process and shared code run in Node; building a DOM for them was most of the suite's setup time.
        test: { name: "node", environment: "node", include: ["src/main/**/*.test.ts", "src/shared/**/*.test.ts"] },
      },
    ],
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
