import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const installerPath = path.join(repoRoot, "apps/desktop/scripts/install-macos-launcher.sh");

test("macOS installer builds isolated Stable and Preview launcher bundles", { skip: process.platform !== "darwin" }, () => {
  const stableHome = mkdtempSync(path.join(tmpdir(), "alfred-launcher-stable-"));
  const previewHome = mkdtempSync(path.join(tmpdir(), "alfred-launcher-preview-"));

  try {
    const install = (home, channel = undefined) => {
      execFileSync(installerPath, channel ? [channel] : [], {
        env: { ...process.env, HOME: home, PNPM_BIN: "/usr/bin/true" },
        stdio: "pipe",
      });

      const appName = channel === "preview" ? "Alfred Preview" : "Alfred";
      const contents = path.join(home, "Applications", `${appName}.app`, "Contents");
      const plist = path.join(contents, "Info.plist");
      const plistValue = (key) =>
        execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" }).trim();

      return {
        bundleName: plistValue("CFBundleName"),
        bundleIdentifier: plistValue("CFBundleIdentifier"),
        iconName: plistValue("CFBundleIconFile"),
        contents,
        launcher: readFileSync(path.join(contents, "MacOS", "Alfred"), "utf8"),
      };
    };

    const stable = install(stableHome);
    const preview = install(previewHome, "preview");

    assert.equal(stable.bundleName, "Alfred");
    assert.equal(stable.bundleIdentifier, "dev.patryk.alfred.desktop");
    assert.match(stable.launcher, /export DESKTOP_PORT="4310"/);
    assert.equal(stable.iconName, "alfred-icon.icns");
    assert.equal(existsSync(path.join(stable.contents, "Resources", stable.iconName)), true);

    assert.equal(preview.bundleName, "Alfred Preview");
    assert.equal(preview.bundleIdentifier, "dev.patryk.alfred.desktop.preview");
    assert.match(preview.launcher, /export DESKTOP_PORT="4311"/);
    assert.match(
      preview.launcher,
      /export ALFRED_DESKTOP_USER_DATA_DIR=".*Library\/Application Support\/Alfred Preview"/,
    );
    assert.equal(existsSync(path.join(preview.contents, "Resources", "alfred-icon.icns")), true);
  } finally {
    rmSync(stableHome, { force: true, recursive: true });
    rmSync(previewHome, { force: true, recursive: true });
  }
});
