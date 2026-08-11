import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./worktree-diff";

describe("parseUnifiedDiff", () => {
  it("tracks line numbers and totals through a unified diff hunk", () => {
    const patch = [
      "diff --git a/src/app.tsx b/src/app.tsx",
      "@@ -4,2 +4,2 @@",
      "-old value",
      "+new value",
      " unchanged value",
    ].join("\n");

    expect(parseUnifiedDiff(patch).lines).toEqual([
      expect.objectContaining({ kind: "meta", text: "diff --git a/src/app.tsx b/src/app.tsx" }),
      expect.objectContaining({ kind: "hunk", oldLine: null, newLine: null }),
      expect.objectContaining({ kind: "remove", oldLine: 4, newLine: null }),
      expect.objectContaining({ kind: "add", oldLine: null, newLine: 4 }),
      expect.objectContaining({ kind: "context", oldLine: 5, newLine: 5 }),
    ]);
    expect(parseUnifiedDiff(patch)).toMatchObject({ additions: 1, deletions: 1 });
  });

  it("treats added content beginning with two plus signs as an addition", () => {
    const parsed = parseUnifiedDiff("@@ -3 +3 @@\n-old\n+++value\n next");

    expect(parsed.lines[2]).toMatchObject({ kind: "add", oldLine: null, newLine: 3 });
    expect(parsed.lines[3]).toMatchObject({ kind: "context", oldLine: 4, newLine: 4 });
    expect(parsed.additions).toBe(1);
  });

  it("treats removed content beginning with two minus signs as a removal", () => {
    const parsed = parseUnifiedDiff("@@ -8 +8 @@\n---value\n+new\n next");

    expect(parsed.lines[1]).toMatchObject({ kind: "remove", oldLine: 8, newLine: null });
    expect(parsed.lines[3]).toMatchObject({ kind: "context", oldLine: 9, newLine: 9 });
    expect(parsed.deletions).toBe(1);
  });
});
