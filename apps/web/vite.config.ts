import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const webPort = readPort(process.env.WEB_PORT, 4300);
const apiTarget = process.env.WEB_API_TARGET ?? `http://127.0.0.1:${readPort(process.env.API_PORT, 4301)}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: webPort,
    allowedHosts: ["host.docker.internal"],
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/auth": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});

function readPort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}
