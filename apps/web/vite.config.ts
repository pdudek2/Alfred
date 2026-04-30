import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4300,
    allowedHosts: ["host.docker.internal"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4301",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/auth": {
        target: "http://127.0.0.1:4301",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
