import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
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
const vercelOutputDirectory = "vercel-static";
const vercelMarker = "Alfred cloud deployment exposes API endpoints only.\n";

describe("desktop product boundary", () => {
  it("has no standalone browser client package", () => {
    assert.equal(existsSync(removedClientPath), false);
  });

  it("keeps Vercel deployment API-only", () => {
    const config = readJson("vercel.json");

    assert.deepEqual(config, {
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: null,
      outputDirectory: vercelOutputDirectory,
      installCommand: "pnpm install --frozen-lockfile",
      buildCommand: "node scripts/build-vercel-api.mjs",
      rewrites: [
        { source: "/api/:path*", destination: "/api/:path*" },
        { source: "/auth/:path*", destination: "/api/auth/:path*" },
        { source: "/v1/:path*", destination: "/api/v1/:path*" },
        { source: "/health", destination: "/api/health" },
      ],
    });
    assert.notEqual(config.outputDirectory, ".");
    assert.notEqual(config.outputDirectory, path.join("apps", removedClientName));
  });

  it("builds only an API marker in the Vercel output directory", () => {
    const outputDirectory = path.join(repoRoot, vercelOutputDirectory);
    const generatedApiDirectory = path.join(repoRoot, "api", ".generated");
    const generatedApiBundle = path.join(generatedApiDirectory, "app.cjs");

    rmSync(outputDirectory, { force: true, recursive: true });
    rmSync(generatedApiDirectory, { force: true, recursive: true });
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-vercel-api.mjs")], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    assert.equal(existsSync(outputDirectory), true);
    assert.deepEqual(readdirSync(outputDirectory), ["api-only.txt"]);
    assert.equal(readFileSync(path.join(outputDirectory, "api-only.txt"), "utf8"), vercelMarker);
    assert.ok(statSync(generatedApiBundle).size > 0);

    const gitignore = read(".gitignore");
    assert.match(gitignore, /^vercel-static\/$/m);
    assert.match(gitignore, /^api\/\.generated\/$/m);
  });

  it("starts the desktop client in the main local dev loop", () => {
    const launcher = read("scripts/dev-alfred.mjs");
    const rootPackage = readJson("package.json");

    assert.equal(rootPackage.scripts["dev:alfred"], "node scripts/dev-alfred.mjs");
    assert.match(launcher, /@alfred\/desktop/);
    assert.doesNotMatch(launcher, new RegExp(escapePattern(removedPackageName)));
    assert.doesNotMatch(launcher, new RegExp(removedPortKey));
    assert.doesNotMatch(launcher, new RegExp(removedTargetKey));
  });

  it("documents desktop-only product and local ports", () => {
    const readme = read("README.md");
    const envExample = read(".env.example");
    const desktopDevelopment = readSection(readme, "Desktop development");
    const apiAndCloudSync = readSection(readme, "API and cloud sync");

    assert.match(readme, /Electron is the only user client/i);
    assert.match(readme, /no supported standalone browser client/i);
    assert.match(readme, /apps\/desktop/);
    assert.match(desktopDevelopment, /\b4310\b/);
    assert.match(apiAndCloudSync, /\b4301\b/);
    assert.doesNotMatch(readme, new RegExp(escapePattern(path.join("apps", removedClientName))));
    assert.doesNotMatch(readme, new RegExp(escapePattern(removedIdentity)));
    assert.doesNotMatch(readme, new RegExp(escapePattern(removedLocalOrigin)));
    assert.match(envExample, /^DESKTOP_PORT=4310$/m);
    assert.doesNotMatch(envExample, new RegExp(`^${removedPortKey}=`, "m"));
  });

  it("documents safe runnable local service commands", () => {
    const readme = read("README.md");
    const apiAndCloudSync = readSection(readme, "API and cloud sync");
    const runner = readSection(readme, "Runner");

    assert.match(
      apiAndCloudSync,
      /API_PORT=4301\s+ALFRED_ALLOW_DEV_AUTH=1\s+pnpm --filter @alfred\/api dev/,
    );
    assert.doesNotMatch(runner, /ALFRED_ALLOW_DEV_CONFIG=1\s+pnpm --filter @alfred\/runner/);
    assert.match(runner, /never point[\s\S]{0,120}~\/\.codex/i);
  });
});

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readSection(markdown, heading) {
  const marker = `## ${heading}\n`;
  const sectionStart = markdown.indexOf(marker);
  assert.notEqual(sectionStart, -1, `Missing README section: ${heading}`);

  const contentStart = sectionStart + marker.length;
  const nextSection = markdown.indexOf("\n## ", contentStart);
  return markdown.slice(contentStart, nextSection === -1 ? undefined : nextSection);
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
