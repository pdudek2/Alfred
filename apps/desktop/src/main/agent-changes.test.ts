import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tallyTranscriptChanges } from "./agent-changes.js";

const line = (record: unknown) => `${JSON.stringify(record)}\n`;
const claudeEdit = (lines: string[]) => ({ type: "user", toolUseResult: { structuredPatch: [{ lines }] } });
const codexChange = (changes: unknown, status = "completed") => ({
  type: "event_msg",
  payload: { type: "item_completed", item: { type: "FileChange", status, changes } },
});

describe("tallyTranscriptChanges", () => {
  let dir: string;
  let transcript: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "alfred-agent-changes-"));
    transcript = path.join(dir, "conversation.jsonl");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("counts Claude Code's edits and the files it wrote", async () => {
    await writeFile(transcript, [
      line(claudeEdit([" kept", "-old", "+new", "+newer"])),
      line({ type: "user", toolUseResult: { type: "create", content: "one\ntwo\n", structuredPatch: [] } }),
      line({ type: "user", message: { content: "text that mentions structuredPatch" } }),
    ].join(""));

    await expect(tallyTranscriptChanges(transcript)).resolves.toMatchObject({ additions: 4, deletions: 1 });
  });

  it("counts Codex's completed file changes", async () => {
    await writeFile(transcript, [
      line(codexChange({ "a.ts": { type: "update", unified_diff: "@@ -1,2 +1,2 @@\n kept\n-old\n+new\n", move_path: null } })),
      line(codexChange({ "b.md": { type: "add", content: "one\ntwo" }, "c.md": { type: "delete", content: "gone\n" } })),
      line(codexChange({ "d.ts": { type: "add", content: "failed\n" } }, "failed")),
    ].join(""));

    await expect(tallyTranscriptChanges(transcript)).resolves.toMatchObject({ additions: 3, deletions: 2 });
  });

  it("reads only what was added, leaves a line being written for later and starts over on another transcript", async () => {
    await writeFile(transcript, line(claudeEdit(["+first"])));
    const first = await tallyTranscriptChanges(transcript);

    const secondLine = line(claudeEdit(["+second", "-third"]));
    await appendFile(transcript, secondLine.slice(0, 20));
    const partial = await tallyTranscriptChanges(transcript, first);
    expect(partial).toEqual(first);

    await appendFile(transcript, secondLine.slice(20));
    await expect(tallyTranscriptChanges(transcript, partial)).resolves.toMatchObject({ additions: 2, deletions: 1 });

    const other = path.join(dir, "other.jsonl");
    await writeFile(other, line(claudeEdit(["-only"])));
    await expect(tallyTranscriptChanges(other, partial)).resolves.toMatchObject({ additions: 0, deletions: 1, transcriptPath: other });
  });
});
