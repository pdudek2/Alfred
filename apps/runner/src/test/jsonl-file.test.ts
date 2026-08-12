import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanJsonlLines } from "../sources/jsonl-file.js";

async function scan(path: string) {
  const lines = [];
  for await (const line of scanJsonlLines(path)) lines.push(line);
  return lines;
}

describe("scanJsonlLines", () => {
  it("keeps prefix hashes stable across append and accepts a valid final line without newline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-jsonl-cursor-"));
    const file = join(dir, "session.jsonl");
    try {
      writeFileSync(file, JSON.stringify({ id: 1 }));
      const first = await scan(file);
      appendFileSync(file, `\n${JSON.stringify({ id: 2 })}\n`);
      const second = await scan(file);
      expect(first[0]).toMatchObject({ lineNumber: 1, record: { id: 1 } });
      expect(second[0]?.prefixHash).toBe(first[0]?.prefixHash);
      expect(second.at(-1)).toMatchObject({ lineNumber: 2, record: { id: 2 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not advance over an invalid unterminated tail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-jsonl-tail-"));
    const file = join(dir, "session.jsonl");
    try {
      writeFileSync(file, `${JSON.stringify({ id: 1 })}\n{"id":`);
      const invalidLines: number[] = [];
      const lines = [];
      for await (const line of scanJsonlLines(file, (lineNumber) => invalidLines.push(lineNumber))) {
        lines.push(line);
      }
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ lineNumber: 1, record: { id: 1 } });
      expect(invalidLines).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
