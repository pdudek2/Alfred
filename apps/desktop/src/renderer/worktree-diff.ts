import type { TerminalWorktreeDiffResult } from "../shared/terminal-ipc";

export type WorktreeDiffLine = {
  kind: "add" | "context" | "hunk" | "meta" | "remove";
  newLine: number | null;
  oldLine: number | null;
  text: string;
};

export type WorktreeDiffView =
  | { status: "loading"; instanceKey: string; sessionId: string; sessionTitle: string }
  | {
      status: "ready";
      instanceKey: string;
      sessionId: string;
      sessionTitle: string;
      result: Extract<TerminalWorktreeDiffResult, { ok: true }>;
    }
  | { status: "error"; instanceKey: string; sessionId: string; sessionTitle: string; error: string };

export function parseUnifiedDiff(patch: string): {
  additions: number;
  deletions: number;
  lines: WorktreeDiffLine[];
} {
  let oldCursor: number | null = null;
  let newCursor: number | null = null;
  let additions = 0;
  let deletions = 0;
  const lines = patch
    .split("\n")
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .map((text): WorktreeDiffLine => {
      if (text.startsWith("diff --git ")) {
        oldCursor = null;
        newCursor = null;
        return { kind: "meta", oldLine: null, newLine: null, text };
      }
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        oldCursor = Number(hunk[1]);
        newCursor = Number(hunk[2]);
        return { kind: "hunk", oldLine: null, newLine: null, text };
      }
      if (oldCursor !== null && newCursor !== null && text.startsWith("+")) {
        const line = newCursor;
        newCursor += 1;
        additions += 1;
        return { kind: "add", oldLine: null, newLine: line, text };
      }
      if (oldCursor !== null && text.startsWith("-")) {
        const line = oldCursor;
        oldCursor += 1;
        deletions += 1;
        return { kind: "remove", oldLine: line, newLine: null, text };
      }
      if (oldCursor !== null && newCursor !== null && text.startsWith(" ")) {
        const oldLine = oldCursor;
        const newLine = newCursor;
        oldCursor += 1;
        newCursor += 1;
        return { kind: "context", oldLine, newLine, text };
      }
      return { kind: "meta", oldLine: null, newLine: null, text };
    });

  return { additions, deletions, lines };
}
