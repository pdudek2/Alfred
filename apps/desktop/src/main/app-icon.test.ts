import { beforeEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
}));

import { resolveDesktopAppIconPath } from "./app-icon.js";

describe("desktop app icon", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
  });

  it("resolves the app-owned PNG icon when it exists", () => {
    existsSyncMock.mockReturnValue(true);

    expect(resolveDesktopAppIconPath("/Users/patryk/Desktop/Alfred/apps/desktop")).toBe(
      "/Users/patryk/Desktop/Alfred/apps/desktop/assets/alfred-icon.png",
    );
  });

  it("omits the icon when the asset is unavailable", () => {
    existsSyncMock.mockReturnValue(false);

    expect(resolveDesktopAppIconPath("/missing/app")).toBeUndefined();
  });
});
