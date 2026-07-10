import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const removedClientName = ["w", "eb"].join("");
const removedClientPath = path.join(repoRoot, "apps", removedClientName);
const removedPackageName = ["@alfred", removedClientName].join("/");
const removedPortKey = ["W", "EB_PORT"].join("");
const removedTargetKey = ["W", "EB_API_TARGET"].join("");
const removedLocalOrigin = ["http://127.0.0.1:43", "00"].join("");
const removedIdentity = [removedClientName, "-first"].join("");

describe("desktop product boundary", () => {
  it("has no standalone browser client package", () => {
    assert.equal(existsSync(removedClientPath), false);
  });

  it("keeps Vercel deployment API-only", () => {
    const config = readJson("vercel.json");

    assert.match(config.buildCommand, /api/i);
    assert.equal("outputDirectory" in config, false);
    assert.equal("framework" in config, false);
    assert.equal(
      config.rewrites.every((rewrite) => rewrite.destination.startsWith("/api/")),
      true,
    );
  });

  it("starts the desktop client in the main local dev loop", () => {
    const launcher = read("scripts/dev-alfred.mjs");

    assert.match(launcher, /@alfred\/desktop/);
    assert.doesNotMatch(launcher, new RegExp(escapePattern(removedPackageName)));
    assert.doesNotMatch(launcher, new RegExp(removedPortKey));
    assert.doesNotMatch(launcher, new RegExp(removedTargetKey));
  });

  it("documents desktop-only product and local ports", () => {
    const readme = read("README.md");
    const envExample = read(".env.example");

    assert.match(readme, /Electron is the only user client/i);
    assert.match(readme, /no supported standalone browser client/i);
    assert.match(readme, /apps\/desktop/);
    assert.match(readme, /desktop renderer[^\n]*4310/i);
    assert.match(readme, /local API[^\n]*4301/i);
    assert.doesNotMatch(readme, new RegExp(escapePattern(path.join("apps", removedClientName))));
    assert.doesNotMatch(readme, new RegExp(escapePattern(removedIdentity)));
    assert.doesNotMatch(readme, new RegExp(escapePattern(removedLocalOrigin)));
    assert.match(envExample, /^DESKTOP_PORT=4310$/m);
    assert.doesNotMatch(envExample, new RegExp(`^${removedPortKey}=`, "m"));
  });
});

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
