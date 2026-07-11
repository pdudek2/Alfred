import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDesktopAppIconPath } from "./app-icon.js";

describe("desktop app icon", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "alfred-app-icon-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  it("resolves the app-owned PNG icon when it exists", () => {
    const appPath = path.join(temporaryDirectory, "app");
    const expectedIconPath = path.join(appPath, "assets", "alfred-icon.png");
    mkdirSync(path.dirname(expectedIconPath), { recursive: true });
    writeFileSync(expectedIconPath, "test icon");

    expect(resolveDesktopAppIconPath(appPath)).toBe(expectedIconPath);
  });

  it("omits the icon when the asset is unavailable", () => {
    const missingAppPath = path.join(temporaryDirectory, "missing-app");

    expect(resolveDesktopAppIconPath(missingAppPath)).toBeUndefined();
  });
});
