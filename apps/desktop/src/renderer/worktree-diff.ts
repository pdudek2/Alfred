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
  files: Record<string, { additions: number; deletions: number }>;
} {
  let oldCursor: number | null = null;
  let newCursor: number | null = null;
  let additions = 0;
  let deletions = 0;
  let oldPath: string | null = null;
  let fileStats: { additions: number; deletions: number } | null = null;
  const files: Record<string, { additions: number; deletions: number }> = Object.create(null);
  const lines = patch
    .split("\n")
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .map((text): WorktreeDiffLine => {
      if (text.startsWith("diff --git ")) {
        oldCursor = null;
        newCursor = null;
        oldPath = null;
        fileStats = null;
        return { kind: "meta", oldLine: null, newLine: null, text };
      }
      if (oldCursor === null && text.startsWith("--- ")) oldPath = diffHeaderPath(text.slice(4));
      if (newCursor === null && text.startsWith("+++ ")) {
        const path = diffHeaderPath(text.slice(4)) ?? oldPath;
        if (path !== null) {
          fileStats = { additions: 0, deletions: 0 };
          files[path] = fileStats;
        }
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
        if (fileStats) fileStats.additions += 1;
        return { kind: "add", oldLine: null, newLine: line, text };
      }
      if (oldCursor !== null && text.startsWith("-")) {
        const line = oldCursor;
        oldCursor += 1;
        deletions += 1;
        if (fileStats) fileStats.deletions += 1;
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

  return { additions, deletions, lines, files };
}

// Git quotes unusual paths with C escapes, including octal UTF-8 bytes.
function diffHeaderPath(header: string): string | null {
  let path = header.split("\t")[0] ?? "";
  if (path.startsWith('"')) {
    const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
    try {
      path = decodeURIComponent(path.slice(1, -1).replace(/\\([0-7]{1,3}|[abtnvfr"\\])|([^\\]+)/g,
        (_match, escape: string | undefined, literal: string | undefined) => {
          if (literal !== undefined) return encodeURIComponent(literal);
          const byte = escapes[escape!] ?? Number.parseInt(escape!, 8);
          return `%${byte.toString(16).padStart(2, "0")}`;
        }));
    } catch {
      return null;
    }
  }
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}
