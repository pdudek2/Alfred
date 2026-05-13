import { afterEach, describe, expect, it, vi } from "vitest";

describe("web Vite config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses worktree-friendly ports from the environment", async () => {
    vi.stubEnv("WEB_PORT", "4310");
    vi.stubEnv("API_PORT", "4311");
    vi.resetModules();

    const { default: config } = await import("../../vite.config");
    const apiProxy = config.server?.proxy?.["/api"];
    const authProxy = config.server?.proxy?.["/auth"];

    expect(config.server?.port).toBe(4310);
    expect(proxyTarget(apiProxy)).toBe("http://127.0.0.1:4311");
    expect(proxyTarget(authProxy)).toBe("http://127.0.0.1:4311");
  });
});

function proxyTarget(proxy: unknown): string | undefined {
  return typeof proxy === "object" && proxy !== null && "target" in proxy
    ? String(proxy.target)
    : undefined;
}
