import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(resolve(process.cwd(), "src/main/preload.cts"), "utf8");

describe("sandboxed preload runtime boundary", () => {
  it("detects every relative runtime dependency form", () => {
    const fixture = [
      'import "./preload-helper.js";',
      'import value from "../foo.js";',
      'import { runtimeValue } from "../shared/runtime.js";',
      "void value; void runtimeValue;",
      'void import("./dynamic-helper.js");',
      'const legacy = require("./legacy.cjs");',
    ].join("\n");

    expect(runtimeRelativeDependencies(fixture)).toEqual([
      "./preload-helper.js",
      "../foo.js",
      "../shared/runtime.js",
      "./dynamic-helper.js",
      "./legacy.cjs",
    ]);
  });

  it("allows relative imports that are erased because they are type-only", () => {
    const fixture = [
      'import type { Foo } from "./types.js";',
      'import { type Bar } from "../shared/types.js";',
    ].join("\n");

    expect(runtimeRelativeDependencies(fixture)).toEqual([]);
  });

  it("emits the real preload without relative runtime dependencies", () => {
    expect(runtimeRelativeDependencies(preloadSource)).toEqual([]);
  });
});

function runtimeRelativeDependencies(source: string): string[] {
  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return [...emitted.matchAll(/\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)]
    .map((match) => match[1]!);
}
