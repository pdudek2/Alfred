import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopFixture } from "./desktop-state-fixture";

describe("desktop state fixture", () => {
  it("provides hermetic agent commands for POSIX and Windows lookup", async () => {
    const { paths } = await createDesktopFixture();

    try {
      for (const agent of ["codex", "claude"]) {
        const posixPath = path.join(paths.home, "bin", agent);
        expect((await stat(posixPath)).mode & 0o111).not.toBe(0);
        expect(await readFile(posixPath, "utf8")).toContain(`${agent} fixture ready`);
        expect(await readFile(`${posixPath}.cmd`, "utf8")).toContain(`${agent} fixture ready`);
      }
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });
});
