import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const installerPath = path.join(repoRoot, "apps/desktop/scripts/install-macos-launcher.sh");

test("macOS launcher bundle exposes its icon before the app starts", { skip: process.platform !== "darwin" }, () => {
  const temporaryHome = mkdtempSync(path.join(tmpdir(), "alfred-launcher-"));

  try {
    execFileSync(installerPath, [], {
      env: { ...process.env, HOME: temporaryHome, PNPM_BIN: "/usr/bin/true" },
      stdio: "pipe",
    });

    const bundlePath = path.join(temporaryHome, "Applications", "Alfred.app", "Contents");
    const iconName = execFileSync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleIconFile", "raw", "-o", "-", path.join(bundlePath, "Info.plist")],
      { encoding: "utf8" },
    ).trim();

    assert.equal(iconName, "alfred-icon.icns");
    assert.equal(existsSync(path.join(bundlePath, "Resources", iconName)), true);
  } finally {
    rmSync(temporaryHome, { force: true, recursive: true });
  }
});
