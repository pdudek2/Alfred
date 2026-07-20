import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(resolve(process.cwd(), "src/main/preload.cts"), "utf8");

describe("sandboxed preload runtime boundary", () => {
  it("keeps every shared relative import type-only", () => {
    const runtimeSharedImports = [...preloadSource.matchAll(
      /^import(?!\s+type\b).*from\s+["']\.\.\/shared\/[^"']+["'];?$/gm,
    )].map((match) => match[0]);

    expect(runtimeSharedImports).toEqual([]);
  });
});
