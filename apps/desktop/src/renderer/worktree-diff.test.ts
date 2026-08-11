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
});
